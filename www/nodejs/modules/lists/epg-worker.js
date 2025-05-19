import fs from 'fs'
import zlib from 'zlib'
import pLimit from 'p-limit'
import Download from '../download/download.js'
import config from '../config/config.js'
import listsTools from '../lists/tools.js'
import setupUtils from '../multi-worker/utils.js'
import Mag from './mag.js'
import { Trias } from 'trias'
import { Database } from 'jexidb'
import { Parser } from 'xmltv-stream'
import { EventEmitter } from 'node:events'
import { temp } from '../paths/paths.js'
import { getFilename } from 'cross-dirname'
import { basename, moveFile, parseCommaDelimitedURIs, time, traceback, ucWords } from '../utils/utils.js'

const utils = setupUtils(getFilename())
const DBOPTS = {
    indexes: {ch: 'string', start: 'number', e: 'number', c: 'string'},
    index: {channels: {}, terms: {}},
    compressIndex: false,
    v8: false,
    create: true,
    maxMemoryUsage: 1024 * 1024 // 1MB
}

class EPGDataCompleter {
    constructor(trias){
        this.learning = {}
        this.readyListeners = []
        this.triasQueueSize = 50
        this.triasQueue = []
        this.trias = trias
    }
    format(t){
        return t.trim().toLowerCase()
    }
    learn(programme){
        if(!programme.i && !programme?.c?.length) {
            return
        }
        const key = this.format(programme.t)
        if(!this.learning[key]){
            this.learning[key] = {
                c: programme.c || [],
                i: programme.i
            }
        } else {
            if(programme.c && programme.c.length){
                programme.c.forEach(c => {
                    this.learning[key].updated = true
                    this.learning[key].c.includes(c) || this.learning[key].c.push(c)
                })
            }
            if(programme.i && !this.learning[key].i){
                this.learning[key].updated = true
                this.learning[key].i = programme.i
            }
            if(programme.desc && !this.learning[key].desc){
                this.learning[key].updated = true
            }
        }
        if(programme?.c?.length) {
            const txt = [programme.t, programme.desc, ...programme.c].filter(s => s).join(' ')
            this.triasQueue.push({input: txt, output: programme.c})
            if(this.triasQueue.length >= this.triasQueueSize) {
                this.trias?.train(this.triasQueue).catch(err => console.error(err))
                this.triasQueue = []
            }
        }
    }
    async extractCategories(programme){
        if (this.trias) {
            const txt = [programme.t, programme.desc, ...programme.c].filter(s => s).join(' ')
            const c = await this.trias.predict(txt, {as: 'array', limit: 3})
            programme.c = [...programme.c, ...c]
        }
        return programme.c || []
    }
    async apply(db) {
        const tmpFile = temp +'/'+ basename(db.fileHandler.file) +'.refine'
        try {
            if (this.triasQueue.length) {
                await this.trias.train(this.triasQueue).catch(err => console.error(err))
                this.triasQueue = []
            }
            const rdb = new Database(tmpFile, Object.assign(Object.assign({}, DBOPTS), {clear: true, create: true}))
            await rdb.init()
            for await (const programme of db.walk()) {
                if (this.destroyed) return
                delete programme._
                const key = this.format(programme.t)
                if(key) {
                    const has = !Array.isArray(programme.c) || !programme.c.length
                    if(this.learning[key] && this.learning[key].updated) {
                        if(!has) {
                            if(this.learning[key].c.length) {
                                programme.c = this.learning[key].c
                            } else {
                                programme.c = await this.extractCategories(programme)
                            }
                        }
                        if(!programme.i && this.learning[key].i) {
                            programme.i = this.learning[key].i
                        }
                    } else {
                        if(!has) {
                            programme.c = await this.extractCategories(programme)
                        }
                    }
                }
                await rdb.insert(programme)
            }
            rdb.indexManager.index = db.indexManager.index
            await rdb.save()
            await rdb.destroy()
            await this.trias?.save().catch(err => console.error(err))
            await fs.promises.unlink(db.fileHandler.file).catch(() => {})
            await moveFile(tmpFile, db.fileHandler.file)
        } catch(e) {
            console.error('REFINER APPLY ERROR', e)
        } finally { 
            await fs.promises.unlink(tmpFile).catch(() => {})
            this.learning = {}
        }
    }
    destroy(){
        this.learning = {}
        this.completer = null
        this.trias = null
    }
}

class EPGPaginateChannelsList extends EventEmitter {
    constructor(){
        super()
        this.badTerms = new Set(['H.265','H.264','H265','H264','FHD','HD','SD','2K','4K','8K'])
    }
    prepareChannelName(name){
        return ucWords(name.split('[')[0].split(' ').filter(s => s && !this.badTerms.has(s.toUpperCase())).join(' '))
    }
    isASCIIChar(chr){
        let c = chr.charCodeAt(0)
        return ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122))
    }
    getNameDiff(a, b){
        let c = ''
        for(let i=0;i<a.length;i++){
            if(a[i] && b && b[i] && a[i] == b[i]){
                c += a[i]
            } else {
                c += a[i]
                if(this.isASCIIChar(a[i])){
                    break
                }
            }
        }
        return c
    }
    getRangeName(names, lastName, nextName){
        var l, start = '0', end = 'Z', r = new RegExp('[a-z\\d]', 'i'), r2 = new RegExp('[^a-z\\d]+$', 'i')
        for(var i=0; i<names.length; i++){
            if(lastName){
                l = this.getNameDiff(names[i], lastName)
            } else {
                l = names[i].charAt(0)
            }
            if(l.match(r)){
                start = l.toLowerCase().replace(r2, '')
                break
            }
        }
        for(var i=(names.length - 1); i>=0; i--){
            if(nextName){
                l = this.getNameDiff(names[i], nextName)
            } else {
                l = names[i].charAt(0)
            }
            if(l.match(r)){
                end = l.toLowerCase().replace(r2, '')
                break
            }
        }
        return start == end ? ucWords(start) : lang.X_TO_Y.format(start.toUpperCase(), end.toUpperCase())
    }
}

class EPGUpdater extends EventEmitter {
    constructor(url, trias){
        super()
        this.trias = trias
        this.completer = new EPGDataCompleter(this.trias)
    }
    fixSlashes(txt){
        return txt.replaceAll('/', '|') // this character will break internal app navigation
    }
    channel(channel){
        if(!channel) return
        let name = channel.displayName || channel.name
        if(!name) return;
        [channel.id, channel.name || channel.displayName].filter(s => s).forEach(cid => {
            if(typeof(this.udb.index.channels[cid]) == 'undefined'){
                this.udb.index.channels[cid] = {name}
            } else if(cid != name) {
                this.udb.index.channels[cid].name = name
            }
            if(channel.icon){
                this.udb.index.channels[cid].icon = channel.icon
            }
        })
    }
    async update(){
        if(this.updating) return
        this.updating = true
        try {
            await this.doUpdate()
        } catch(e) {
            console.error(e)
        } finally {
            this.updating = false            
            if(this.parser) {
                this.parser.destroy()
                this.parser = null           
            }
            if(this.request) {
                this.request.destroy()
                this.request = null
            }
            if(this.udb) {
                this.udb.destroy()
                this.udb = null
            }
        }
    }
    async doUpdate(){
        if (this.destroyed) return
        await this.db.init().catch(err => console.error(err))
        const now = time()
        const lastFetchedAt = this.db.index.fetchCtrlKey
        const lastModifiedAt = this.db.index.lastmCtrlKey
        if(this.db.length < this.minExpectedEntries || !lastFetchedAt || lastFetchedAt < (time() - (this.ttl / 2))){
            let validEPG, failed, newLastModified, received = 0, errorCount = 0
            this.readyState == 'loaded' || this.setReadyState('connecting')
            this.error = null
            const onErr = err => {
                if(failed){
                    return
                }
                errorCount++
                console.error(err)
                if(errorCount >= 128 && !validEPG) {
                    // sometimes we're receiving scrambled response, not sure about the reason, do a dirty workaround for now
                    failed = true
                    this.parser && this.parser.end()
                    if(!this.length) {
                        this.setReadyState('error')
                        this.error = lang.EPG_BAD_FORMAT
                        if(this.listenerCount('error')){
                            this.emit('error', lang.EPG_BAD_FORMAT)
                        }
                    }
                }
                return true
            }
            this.udb = new Database(this.tmpFile, Object.assign(Object.assign({}, DBOPTS), {clear: true, create: true}))
            await this.udb.init()
            if(this.url.endsWith('#mag')) {
                this.parser = new Mag.EPG(this.url)
            } else {
                const req = {
                    debug: this.debug,
                    url: this.url,
                    followRedirect: true,
                    keepalive: false,
                    retries: 5,
                    headers: {
                        'accept-charset': 'utf-8, *;q=0.1'
                        // 'range': 'bytes=0-' // was getting wrong content-length from Cloudflare
                    },
                    encoding: 'utf8',
                    cacheTTL: this.ttl - 30,
                    responseType: 'text'
                }
                this.parser = new Parser({
                    timestamps: true
                })
                this.request = new Download(req)
                this.request.on('error', err => {
                    console.warn(err)
                    return true
                })
                this.request.once('response', (code, headers) => {
                    if(this.readyState !== 'loaded'){
                        this.setReadyState('connected') // only update state on initial connect
                    }
                    if(headers['last-modified']) {
                        if(headers['last-modified'] == lastModifiedAt) {
                            this.request.destroy()
                            return
                        } else {
                            newLastModified = headers['last-modified']
                        }
                    }
                })

                if (this.url.includes('.gz')) {
                    const gunzip = zlib.createGunzip()
                    gunzip.on('error', err => {
                        console.error(err)
                        this.request.destroy()
                        this.parser.end()
                    })
                    gunzip.on('data', chunk => this.parser?.write(chunk))
                    gunzip.on('end', () => this.parser?.end())
                    this.request.on('data', chunk => {
                        this.received += chunk.length
                        try {
                            gunzip.write(chunk)
                        } catch(e) {
                            console.error(e)
                        }
                    })
                    this.request.on('end', () => gunzip.end())
                    this.request.on('error', () => gunzip.end())
                } else {
                    this.request.on('data', chunk => {
                        this.received += chunk.length
                        this.parser?.write(chunk)
                    })
                    this.request.once('end', () => {
                        this.request.destroy() 
                        this.request = null
                        this.parser.end()
                    })
                }
                this.request.start()
            }
            this.parser.on('programme', programme => {                
                if(programme?.channel && programme?.title?.length) {
                    if(!validEPG){
                        validEPG = true
                    }
                    if(programme?.end >= now && programme?.end <= (now + this.dataLiveWindow)) {
                        this.programme(programme)
                    }
                }
            })
            this.parser.on('channel', this.channel.bind(this))
            this.parser.on('error', onErr)
            if (this.destroyed) throw new Error('epg destroyed while updating')
            await (new Promise(resolve => {
                const cleanup = () => {
                    this.parser.removeListener('close', cleanup)
                    this.parser.removeListener('end', cleanup)
                    this.removeListener('destroy', cleanup)
                    resolve()
                }
                this.once('destroy', cleanup)
                this.parser.once('close', cleanup)
                this.parser.once('end', cleanup)
            })).catch(err => console.error(err))
            if (this.destroyed) throw new Error('epg destroyed while updating*')
            if(this.udb.length){
                if(newLastModified){
                    this.udb.index.lastmCtrlKey = newLastModified
                }
                this.udb.index.fetchCtrlKey = now
                this.setReadyState('loaded')
                this.error = null
                
                await this.udb.save()
                await this.completer.apply(this.udb).catch(err => console.error(err))
                await Promise.allSettled([
                    this.completer.destroy(),
                    this.udb.destroy(),
                    this.db.destroy()
                ])
                await moveFile(this.tmpFile, this.file)

                this.db = new Database(this.file, Object.assign(Object.assign({}, DBOPTS), {clear: false, create: false}))
                await this.db.init().catch(err => console.error(err))
                this.setReadyState('loaded')
            } else {
                if(this.length) {
                    this.setReadyState('loaded')
                } else {
                    this.setReadyState('error')
                    this.error = validEPG ? 'EPG_OUTDATED' : 'EPG_BAD_FORMAT'
                    if (lang[this.error]) {
                        this.error = lang[this.error]
                    }
                    if(this.listenerCount('error')){
                        this.emit('error', this.error)
                    }
                }
                await this.udb.destroy()
                await fs.promises.unlink(this.tmpFile).catch(err => console.error(err))
            }
        }
        this.scheduleNextUpdate()
    }
    cidToDisplayName(cid){
        return typeof(this.udb.index.channels[cid]) == 'undefined' ? 
            cid : 
            this.udb.index.channels[cid].name
    }
    programme(programme){
        const ch = this.cidToDisplayName(programme.channel)
        let t = programme.title.shift() || 'Untitled'
        if(t.includes('/')) {
            t = this.fixSlashes(t)
        }
        if(Array.isArray(programme.desc)) {
            programme.desc = programme.desc.shift() || ''
        }
        let i
        if(programme.icon) {
            i = programme.icon
        } else if(programme.images.length) {
            const weight = {
                'medium': 0,
                'large': 1,
                'small': 2
            }
            programme.images.sort((a, b) => {
                return weight[a.size] - weight[b.size]
            }).some(a => {
                i = a.url
                return true
            })
        } else {
            i = ''
        }
        if(programme.category){
            if(typeof(programme.category) == 'string'){
                programme.category = programme.category.split(',').map(c => c.trim())
            } else if(Array.isArray(programme.category) && programme.category.length == 1){
                programme.category = programme.category[0].split(',').map(c => c.trim())
            }
        }
        this.indexate({
            start: programme.start,
            e: programme.end,
            t,
            i,
            ch,
            c: programme.category || [],
            desc: programme.desc || ''
        })
    }
    indexate(data){
        if(Array.isArray(data.c)){
            data.c = data.c.map(c => ucWords(c, true))
        }
        if(Array.isArray(data.desc)){
            data.desc = data.desc.shift() || ''
        }
        this.udb.insert(data).catch(err => console.error(err))
        this.completer.learn(data)
        if(!this.udb.index.terms[data.ch] || !Array.isArray(this.udb.index.terms[data.ch])){
            this.udb.index.terms[data.ch] = listsTools.terms(data.ch)
        }
    }
    extractTerms(c){
        if(Array.isArray(c)){
            return c.slice(0)
        } else if(c.terms) {
            if(typeof(c.terms.name) != 'undefined' && Array.isArray(c.terms.name)){
                return c.terms.name.slice(0)
            } else if(Array.isArray(c.terms)) {
                return c.terms.slice(0)
            }
        }
        return []
    }
    scheduleNextUpdate(timeSecs){
        if(this.autoUpdateTimer){
            clearTimeout(this.autoUpdateTimer)
        }
        if(typeof(timeSecs) != 'number'){
            timeSecs = this.autoUpdateIntervalSecs
        }
        this.autoUpdateTimer = setTimeout(() => this.update().catch(err => console.error(err)), timeSecs * 1000)
    }
}

class EPG extends EPGUpdater {
    constructor(url, trias){
        super(url, trias)
        this.url = url
        this.file = storage.resolve('epg-'+ url)
        this.tmpFile = storage.resolve('epg-'+ url) +'-'+ Math.random().toString(36).substring(7)
        this.debug = false
        this.errorCount = 0
        this.errorCountLimit = 3
        this.acceptRanges = false
        this.bytesLength = -1
        this.transferred = 0
        this.ttl = 3600
        this.dataLiveWindow = 72 * 3600
        this.autoUpdateIntervalSecs = 1800
        this.minExpectedEntries = 72
        this.readyState = 'uninitialized'
        this.state = {progress: 0, state: this.readyState, error: null}
        this.error = null
        this.trias = trias
        this.db = new Database(this.file, Object.assign(Object.assign({}, DBOPTS), {clear: false, create: true}))
    }
    ready(){
        return new Promise((resolve, reject) => {
            const listener = () => respond()
            const respond = () => {
                if(this.readyState == 'error') {
                    reject(this.error)
                } else {
                    resolve(true)
                }
            }
            if(this.readyState == 'loaded') return respond()
            this.start().catch(e => {
                console.error(e)
                if(this.readyState !== 'loaded') {
                    if(this.length) {
                        this.error = null
                        this.setReadyState('loaded')
                    } else {
                        this.error = 'EPG_BAD_FORMAT'
                        this.setReadyState('error')
                    }
                }
            }).finally(listener)
        })
    }
    setReadyState(state){
        this.readyState = state
        this.updateState()
    }
    async start(){
        if(this.startPromise) {
            return this.startPromise
        }
        let resolve, reject
        this.startPromise = this.startPromise || new Promise((r, j) => {
            resolve = r
            reject = j
        })
        try {
            if(this.readyState == 'uninitialized') { // initialize
                this.setReadyState('loading')
                await this.db.init().catch(err => {
                    this.error = err
                })
                const updatePromise = this.update().catch(err => {
                    this.error = err
                })
                if(this.db.length < this.minExpectedEntries) {
                    await updatePromise.catch(err => console.error(err)) // will update anyway, but only wait for if it has few programmes
                }
                if(this.readyState.endsWith('ing')) {
                    this.setReadyState(this.length ? 'loaded' : 'error')
                }
            }
            resolve()
        } catch(e) {
            reject(e)
        }
        this.updateState()
        return this.startPromise
    }
    async updateState(){
		const state = {            
            progress: this?.request?.progress || (this.readyState == 'loaded' ? 100 : 0),
            state: this.readyState,
            error: this.error
        }
        // compare to this.state
        if(state.progress !== this.state.progress || state.state !== this.state.state || state.error !== this.state.error) {
            this.emit('state', state)
            this.state = state
        }
    }
    async destroy() {
        if(this.destroyed) return
        this.destroyed = true;
        this.emit('destroy');
        this.autoUpdateTimer && clearInterval(this.autoUpdateTimer);
        this.request?.destroy();
        this.parser?.destroy();
        this.udb?.destroy();
        this.db?.destroy();
        this.completer?.destroy();
        this.removeAllListeners();
        try {
        } catch(e) {
            console.error(e)
        }
    }
    get length(){
        if (this.destroyed || !this.db) return 0
        try {
            let length = 0
            const now = time()
            const ends = this.db.indexManager.readColumnIndex('e')
            for (const e of ends) {
                if (e > now) {
                    length++
                }
            }
            return length
        } catch(e) {
            return 0
        }
    }
}

class EPGManager extends EPGPaginateChannelsList {
    constructor(){
        super()
        this.debug = false
        this.epgs = {}
        this.config = []
        this.limit = pLimit(2)
    }
    async start(config, useTrias){
        if (useTrias === true) {                
            this.trias = new Trias({
                create: true,
                size: (512 * 1024), // 512KB
                file: storage.resolve(lang.locale +'.trias'),
                language: lang.locale,
                capitalize: true,
                autoImport: true,
                excludes: ['separator', 'separador', 'hd', 'hevc', 'sd', 'fullhd', 'fhd', 'channels', 'canais', 'aberto', 'abertos', 'world', 'países', 'paises', 'countries', 'ww', 'live', 'ao vivo', 'en vivo', 'directo', 'en directo', 'unknown', 'other', 'others']
            })
        }
        await this.sync(config)
    }
    EPGs() {
        const activeEPG = this.config
        if(activeEPG && activeEPG !== 'disabled') {
            if(Array.isArray(activeEPG)) {
                return activeEPG
            } else {
                return parseCommaDelimitedURIs(activeEPG).map(url => {
                    return {url, active: true}
                })
            }
        }
        return []
    } 
    activeEPGs() {
        return this.EPGs().filter(r => r.active).map(r => r.url)
    }    
    async sync(config) {
        this.config = config
        const activeEPGs = this.activeEPGs()
        const currentEPGs = Object.keys(this.epgs)

        // Remove inactive EPGs
        await Promise.all(currentEPGs.filter(url => !activeEPGs.includes(url)).map(url => {
            if (!this.epgs[url]?.suggested) {
                this.remove(url)
            }
        }))

        // Add new EPGs
        await Promise.all(activeEPGs.filter(url => !currentEPGs.includes(url)).map(url => this.add(url)))
    }
    async suggest(urls) {
        const amount = 2
        const epgs = Object.values(this.epgs)
        this.debug && console.log('suggest start', urls, epgs.length)
        if(epgs.length >= amount) return 0

        const activeEPGs = this.activeEPGs()
        const validate = epg => epg.length >= 32
        const loadedCount = () => Object.values(this.epgs).filter(epg => validate(epg)).length
        const limit = pLimit(2)
        const tasks = urls.filter(url => !activeEPGs.includes(url)).slice(0, 8).map(url => {
            return async () => {
                if(loadedCount() >= amount) return
                let err
                await this.add(url, true).catch(e => err = e)
                this.debug && console.log('suggestted', url, err, !!this.epgs[url])
                if(this.epgs[url]) {
                    await this.epgs[url].ready().catch(e => err = e)
                    await new Promise(resolve => setTimeout(resolve, 100)) // wait a bit to wait for consolidation
                    if(validate(this.epgs[url])) {
                        this.debug && console.log('suggestion accepted', url, !!this.epgs[url])
                    } else {
                        this.debug && console.log('suggestion rejected', url, this.epgs[url].length)
                        await this.remove(url)
                    }
                }
            }
        }).map(limit)
        await Promise.allSettled(tasks)
        this.debug && console.log('suggest end', urls, epgs.length, loadedCount())
    }
    async add(url, suggested) {
        if (this.epgs[url]) return

        const quota = 2;
        const loadedEPGs = Object.values(this.epgs).filter(epg => epg.readyState === 'loaded').map(epg => {
            return {url: epg.url, suggested: epg.suggested, length: epg.length}
        });
        const ownLoadedCount = loadedEPGs.filter(epg => !epg.suggested).length;
        const suggestedLoadedCount = loadedEPGs.length - ownLoadedCount;
        const toRemove = suggestedLoadedCount - (quota - ownLoadedCount);

        if (toRemove > 0) {
            const removalCandidates = loadedEPGs
                .filter(epg => epg.suggested)
                .sort((a, b) => b.length - a.length);
            for (const epg of removalCandidates.slice(0, toRemove)) {
                await this.remove(epg.url);
            }
        }

        this.epgs[url] = new EPG(url, this.trias);
        this.epgs[url].on('state', () => this.updateState())
        this.epgs[url].start().then(() => {
            utils.emit('update', url);
        }).catch(err => console.error(err)).finally(() => this.updateState());
        this.epgs[url].suggested = !!suggested;
    }
    async remove(url){
        if(this.epgs[url]){
            const e = this.epgs[url]
            delete this.epgs[url]
            utils.emit('update', url)
            e.destroy().catch(() => {})
        }
    }
    async ready(){
        for(const url in this.epgs){
            if(this.epgs[url].readyState === 'loaded') return true
        }
        await Promise.race(Object.values(this.epgs).map(epg => epg.ready()))
    }
    liveNowChannelsListFilterCategories(cs){
        cs = cs.filter(c => {
            return c.split(' ').length <= 3
        })
        if(cs.length > 1){
            let ncs = cs.filter(c => {
                return c.match(new RegExp('[A-Za-z]'))
            })
            if(ncs.length){
                cs = ncs
            }
            if(cs.length > 1){
                ncs = cs.filter(c => {
                    return c.split(' ').length <= 2
                })
                if(ncs.length){
                    cs = ncs
                }
            }
        }
        return cs
    }
    async liveNow(ch) {
        const now = time()
        const data = await this.get(ch, 1)
        if(data && data.length) {
            const p = data[0]
            if(p.e > now && parseInt(p.start) <= now){
                return p
            }
        }
        return false
    }
    async liveNowChannelsList(){
        let updateAfter = 600
        const categories = {}, now = time()
        const processProgramme = (programme, name) => {
            if (programme.e > now && parseInt(programme.start) <= now) {
                if (Array.isArray(programme.c)) {
                    this.liveNowChannelsListFilterCategories(programme.c).forEach(category => {
                        category = ucWords(category).replaceAll('/', ' ')
                        if (!categories[category]) {
                            categories[category] = new Set()
                        }
                        categories[category].add(name)
                    })
                }
                updateAfter = Math.min(updateAfter, Math.max(programme.e - now, 10))
                return true
            }
        }
        for (const url in this.epgs) {
            if (this.epgs[url].readyState !== 'loaded') continue
            const db = this.epgs[url].db
            const programmes = await db.query({start: { '<=': now }, e: { '>': now } })
            for (const programme of programmes) {
                processProgramme(programme, this.prepareChannelName(programme.ch))
            }
        }
        for(const c in categories) {
            categories[c] = [...categories[c]].sort()
        }
        return {categories, updateAfter}
    }
    async queryTags(terms) {
        if(!terms.length) return [];
        const query = {c: terms}, results = []
        for (const url in this.epgs) {
            if (this.epgs[url].readyState !== 'loaded') continue;
            const { db } = this.epgs[url];
            for await (const programme of db.walk(query, {caseInsensitive: true, matchAny: true})) {
                results.push(programme)
            }
        }
        return results;
    }
    prepareRegex(arr) {
        if(!this._prepareRegex) {
            this._prepareRegex = new RegExp('[.*+?^${}()[\\]\\\\]', 'g')
        }
        let ret = arr.map(c => c.toLowerCase().trim()).filter(c => c).join('|').replace(this._prepareRegex, '\\$&').replace(new RegExp('\\|+', 'g'), '|')
        if(ret.startsWith('|')) {
            ret = ret.slice(1)
        }
        if(ret.endsWith('|')) {
            ret = ret.slice(0, -1)
        }
        return new RegExp(ret, 'i')
    }
    async getRecommendations(categories, until, limit = 24, searchTitles) {    
        
        const now = time();
        const maxResultSetSize = 4096;
        const lcCategoriesArr = Object.keys(categories).map(c => c.toLowerCase().trim()).filter(c => c);
        const lcCategories = new Set(lcCategoriesArr);
        const searchTitlesRegex = this.prepareRegex(lcCategoriesArr);

        if (!lcCategories.size) {
            return {};
        }
    
        if (!until) until = now + (6 * 3600);
        
        let prs = await this.queryTags([...lcCategories]);
        const resultsMap = new Map();

        for (const programme of prs) {
            processProgramme(programme, programme.ch);
            if (resultsMap.size >= maxResultSetSize) break;
        }

        function processProgramme(programme, ch) {
            const start = programme.start;
            if (programme.e > now && parseInt(start) <= until) {
                let isMatch = false;
                let score = 0;
                
                if (Array.isArray(programme.c) && programme.c.some(c => lcCategories.has(c))) {
                    isMatch = true;
                    // Cálculo do score incremental, logo no processamento
                    score = programme.c.reduce((s, t) => s + (categories[t] || 0), 0);
                } else if (searchTitles && programme.t.match(searchTitlesRegex)) {
                    isMatch = true;
                    score = programme.c ? programme.c.reduce((s, t) => s + (categories[t] || 0), 0) : 0;
                }
                
                if (isMatch) {
                    // Se já existe um resultado com o mesmo título, mantemos aquele com maior score
                    const existing = resultsMap.get(programme.t);
                    if (!existing || score > existing.meta.score) {
                        resultsMap.set(programme.t, { ...programme, meta: { ch, start, score } });
                    }
                }
            }
        }

        const ret = {}
        Array.from(resultsMap.values())
            .sort((a, b) => b.meta.score - a.meta.score)
            .slice(0, limit).forEach(row => {
                if (!ret[row.meta.ch]) ret[row.meta.ch] = {};
                ret[row.meta.ch][row.meta.start] = row;
                delete row.meta;
            });

        return ret;
    }
    extractTerms(c){
        if(Array.isArray(c)){
            return c.slice(0)
        } else if(c.terms) {
            if(typeof(c.terms.name) != 'undefined' && Array.isArray(c.terms.name)){
                return c.terms.name.slice(0)
            } else if(Array.isArray(c.terms)) {
                return c.terms.slice(0)
            }
        }
        return []
    }
    async updateState(force){
        const info = []
        let max = -1, maxData = {progress: -1, state: 'uninitialized', error: null}
        for(const url in this.epgs) {
            const epg = this.epgs[url]
            const state = Object.assign({}, epg.state)

            state.url = url
            state.size = epg.length
            state.suggested = epg.suggested

            info.push(state)
            if(state.progress > max) {
                max = state.progress
                maxData = state
            }
        }
        const hash = JSON.stringify(info)
        if(force || hash !== this.lastHash) {
            this.lastHash = hash
            const state = Object.assign(Object.assign({}, maxData), {info})
            utils.emit('state', state)
            return state
        }
    }
    async get(channel, limit){
        if(channel.searchName == '-'){
            return []
        } else {
            const now = time(), query = {e: {'>': now}}
            if (limit <= 1) {
                query.start = {'<=': now} // will short-up the search
            }
            if(channel.searchName) {
                for(const url in this.epgs) {
                    if(this.epgs[url].readyState !== 'loaded') continue
                    const db = this.epgs[url].db
                    const availables = db.indexManager.readColumnIndex('ch')
                    if(availables.has(channel.searchName)){
                        query.ch = channel.searchName
                        return db.query(query, {orderBy: 'start', limit})
                    }
                }
            }
            const n = await this.findChannel(this.extractTerms(channel))
            if(n) {
                for(const url in this.epgs) {
                    if(this.epgs[url].readyState !== 'loaded') continue
                    const db = this.epgs[url].db
                    const availables = db.indexManager.readColumnIndex('ch')
                    if(availables.has(n)){
                        query.ch = n
                        return db.query(query, {orderBy: 'start', limit})
                    }
                }
            }
        }
        return false
    }
    async getMulti(channelsList, limit){
        let results = {}
        for(const ch of channelsList) {
            results[ch.name] = await this.get(ch, limit)
        }
        return results
    }
    async searchChannel(terms, limit=2){
        let results = {}, data = []        
        for(const url in this.epgs) {
            if(this.epgs[url].readyState !== 'loaded') continue
            for(const name in this.epgs[url].db.index.terms) {
                if(!Array.isArray(this.epgs[url].db.index.terms[name])) {
                    delete this.epgs[url].db.index.terms[name] // clean incorrect format
                    continue
                }
                const score = listsTools.match(terms, this.epgs[url].db.index.terms[name], true)
                score && data.push({name, url, score})
            }
        }
        data = data.sortByProp('score', true).slice(0, 24)
        for(const r of data) {
            results[r.name] = await this.epgs[r.url].db.query({ch: r.name, end: {'>': time()}}, {limit})
        }
        return results
    }
    async searchChannelIcon(terms){
        let score, results = []        
        for(const url in this.epgs) {
            if(this.epgs[url].readyState !== 'loaded') continue
            const db = this.epgs[url].db
            for(const name in db.index.terms) {
                if(typeof(db.index.channels[name]) != 'undefined' && db.index.channels[name].icon){
                    score = listsTools.match(terms, db.index.terms[name], true)
                    if(score){
                        results.push(db.index.channels[name].icon)       
                    }
                }
            }
        }
        return results.unique()
    }
    async findChannel(data){
        for(const url in this.epgs) {
            if(this.epgs[url].readyState !== 'loaded') continue
            const db = this.epgs[url].db
            const availables = db.indexManager.readColumnIndex('ch')
            if(data.searchName && data.searchName != '-' && availables.has(data.searchName)){
                return data.searchName
            } else if(data.name && availables.has(data.name)){
                return data.name
            }
        }
        let score, candidates = [], maxScore = 0, terms = data.terms || data
        for(const url in this.epgs) {
            if(this.epgs[url].readyState !== 'loaded') continue
            const db = this.epgs[url].db
            for(const name in db.index.terms) {
                if(!Array.isArray(db.index.terms[name])) continue
                score = listsTools.match(terms, db.index.terms[name], false)
                if(score && score >= maxScore){
                    maxScore = score
                    candidates.push({name, score})
                }
            }
        }
        if(!candidates.length){
            for(const url in this.epgs) {
                if(this.epgs[url].readyState !== 'loaded') continue
                const db = this.epgs[url].db
                for(const name in db.index.terms) {
                    if(!Array.isArray(db.index.terms[name])) continue
                    score = listsTools.match(db.index.terms[name], terms, false)
                    if(score && score >= maxScore){
                        maxScore = score
                        candidates.push({name, score})
                    }
                }
            }
        }
        candidates = candidates.filter(c => c.score == maxScore)
        return candidates.length ? candidates[0].name : false
    }
    async search(terms, nowLive){
        let epgData = {}, now = time()
        for(const url in this.epgs) {
            if(this.epgs[url].readyState !== 'loaded') continue
            const db = this.epgs[url].db
            const query = {e: {'>': now}}
            if(nowLive) {
                query.start = {'<=': now}
            }
            const options = {}
            for await (const programme of db.walk(query, options)) {
                const prgTerms = listsTools.terms(programme.t)
                const score = listsTools.match(terms, prgTerms, true)
                if (score) {
                    const ch = programme.ch
                    if(typeof(epgData[ch]) == 'undefined'){
                        epgData[ch] = {}
                    }
                    epgData[ch][programme.start] = programme
                }
            }
        }
        return epgData
    }
    async expandTags(tags, options){
        if (!options.amount || options.amount < 1) {
            throw new Error('Invalid amount')
        }
        if (!this.trias) {
            return false
        }
        return this.trias.related(tags, options)
    }
    async reduceTags(tags, options){
        if (!options.amount || options.amount < 1) {
            throw new Error('Invalid amount')
        }
        if (!this.trias) {
            return false
        }
        return this.trias.reduce(tags, options)
    }
    async validateChannels(data) {
        const processed = {}
        for (const channel in data) {
            let err
            const cid = await this.findChannel(data[channel].terms || listsTools.terms(channel))
            const live = await this.liveNow(cid).catch(e => console.error(err = e))
            if (!err && live) {
                for (const candidate of data[channel].candidates) {
                    if (live.t == candidate.t) {
                        processed[channel] = candidate.ch
                        break
                    }
                }
            }
        }
        return processed
    }
    async lang(code, timezone) {
        return global.lang.countryCode || global.lang.locale
    }
	async terminate(){
        this.trias?.destroy().catch(err => console.error(err))
    }
}

EPGManager.EPG = EPG

export default EPGManager