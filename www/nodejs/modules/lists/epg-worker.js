import fs from 'fs'
import pLimit from 'p-limit';
import { moveFile, parseCommaDelimitedURIs, textSimilarity, time, ucWords } from '../utils/utils.js'
import Download from '../download/download.js'
import config from '../config/config.js';
import { EventEmitter } from 'events'
import listsTools from '../lists/tools.js'
import setupUtils from '../multi-worker/utils.js'
import Mag from './mag.js'
import { Parser } from 'xmltv-stream'
import { getFilename } from 'cross-dirname'
import { Database } from 'jexidb'
import { workerData } from 'worker_threads'

const utils = setupUtils(getFilename())
const DBOPTS = {
    indexes: {ch: 'string', start: 'number', e: 'number', c: 'number'},
    index: {channels: {}, terms: {}},
    compressIndex: false,
    v8: false
}

class EPGDataRefiner {
    constructor(){
        this.data = {}
    }
    format(t){
        return t.trim().toLowerCase()
    }
    learn(programme){
        const key = this.format(programme.t)
        if(!this.data[key]){
            this.data[key] = {
                title: programme.t,
                c: new Set(programme.c),
                i: programme.i,
                programmes: [
                    {ch: programme.ch, start: programme.start}
                ]
            }
        } else {
            if(programme.c && programme.c.length){
                programme.c.forEach(c => {
                    this.data[key].updated = true
                    this.data[key].c.has(c) || this.data[key].c.add(c)
                })
            }
            if(programme.i && !this.data[key].i){
                this.data[key].updated = true
                this.data[key].i = programme.i
            }
            this.data[key].programmes.push({ch: programme.ch, start: programme.start})
        }
    }
    async apply(db) {
        const start = time()
        try {
            const tmpFile = db.fileHandler.filePath +'.refine'
            const rdb = new Database(tmpFile, Object.assign({clear: true}, DBOPTS))
            await rdb.init()
            for await (const programme of db.walk()) {
                delete programme._
                const key = this.format(programme.t)
                if(key && this.data[key] && this.data[key].updated) {
                    if(!programme.c.length && this.data[key].c.size) {
                        programme.c = [...this.data[key].c]
                    }
                    if(!programme.i && this.data[key].i) {
                        programme.i = this.data[key].i
                    }
                }
                await rdb.insert(programme)
            }
            rdb.indexManager.index = db.indexManager.index
            await rdb.save()
            await rdb.destroy()
            await fs.promises.unlink(db.fileHandler.filePath)
            await moveFile(tmpFile, db.fileHandler.filePath)
            console.error('REFINER APPLIED IN '+ parseInt(time() - start) +'s', tmpFile)
        } catch(e) {
            console.error('REFINER APPLY ERROR', e)
        } finally { 
            this.data = {}
        }
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
        //console.log('namdiff res', c)
        return c
    }
    getRangeName(names, lastName, nextName){
        var l, start = '0', end = 'Z', r = new RegExp('[a-z\\d]', 'i'), r2 = new RegExp('[^a-z\\d]+$', 'i')
        //console.log('last', JSON.stringify(lastName))
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
        //console.log('next')
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
    paginateChannelList(snames){
        let ret = {}, folderSizeLimit = config.get('folder-size-limit')
        snames = snames.map(s => this.prepareChannelName(s)).sort().unique()
        folderSizeLimit = Math.min(folderSizeLimit, snames.length / 8) // generate at least 8 pages to ease navigation
        let nextName, lastName
        for(let i=0; i<snames.length; i += folderSizeLimit){
            let gentries = snames.slice(i, i + folderSizeLimit)
            nextName = snames.slice(i + folderSizeLimit, i + folderSizeLimit + 1)
            nextName = nextName.length ? nextName[0] : null
            let gname = this.getRangeName(gentries, lastName, nextName)
            if(gentries.length){
                lastName = gentries[gentries.length - 1]
            }
            ret[gname] = gentries
        }
        return ret
    }
}

class EPGUpdater extends EventEmitter {
    constructor(url){
        super()
        this.refiner = new EPGDataRefiner()
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
        if(this.parser) {
            console.error('already updating')
            return
        }
        await this.db.init().catch(console.error)
        const now = time()
        const lastFetchedAt = this.db.index.fetchCtrlKey
        const lastModifiedAt = this.db.index.lastmCtrlKey
        if(this.db.length < this.minExpectedEntries || !lastFetchedAt || lastFetchedAt < (time() - (this.ttl / 2))){
            if(this.request || this.parser){
                console.error('already updating')
                return
            }
            if(!this.loaded){
                this.state = 'connecting'
            }
            let validEPG, failed, hasErr, newLastModified, received = 0, errorCount = 0
            this.error = null
            console.log('epg updating...')
            const onErr = err => {
                if(failed){
                    return
                }
                hasErr = true
                //console.error('EPG FAILED DEBUG')
                errorCount++
                console.error(err)
                if(errorCount >= 128){
                    // sometimes we're receiving scrambled response, not sure about the reason, do a dirty workaround for now
                    failed = true
                    if(this.request){
                        this.request.destroy() 
                        this.request = null
                    }
                    if(this.parser){
                        this.parser.end() 
                    }
                    this.state = 'error'
                    this.error = 'EPG_BAD_FORMAT'
                    if(this.listenerCount('error')){
                        this.emit('error', lang.EPG_BAD_FORMAT)
                    }
                    this.scheduleNextUpdate(30)
                }
                return true
            }
            if(this.url.endsWith('#mag')) {
                this.parser = new Mag.EPG(this.url)
            } else {
                const req = {
                    debug: false,
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
                    console.log('EPG RESPONSE', code, headers)
                    if(this.loaded){
                        if(headers['last-modified']) {
                            if(headers['last-modified'] == lastModifiedAt) {
                                console.log('epg update skipped by last-modified '+ lastModifiedAt)
                                this.request.destroy()
                                return
                            } else {
                                newLastModified = headers['last-modified']
                            }
                        }
                    } else {
                        this.state = 'connected' // only update state on initial connect
                    }
                })
                this.request.on('data', chunk => {
                    received += chunk.length
                    try {
                        this.parser.write(chunk)
                    } catch(e) {
                        console.error(e)
                    }
                    if(!validEPG && chunk.toLowerCase().includes('<programme')){
                        validEPG = true
                    }
                })
                this.request.once('end', () => {
                    this.request.destroy() 
                    this.request = null
                    console.log('EPG REQUEST ENDED', validEPG, received, this.udb?.length)
                    this.parser.end()
                })
                this.request.start()
            }
            this.udb = new Database(this.tmpFile, Object.assign({clear: true}, DBOPTS))
            await this.udb.init()
            this.parser.on('programme', this.programme.bind(this))
            this.parser.on('channel', this.channel.bind(this))
            this.parser.on('error', onErr)
            console.log('EPG UPDATE START')
            await (new Promise(resolve => {
                this.parser.once('close', resolve)
                this.parser.once('end', resolve)
            })).catch(console.error)
            console.log('EPG UPDATE END 0', this.udb.length)
            this.parser && this.parser.destroy() // TypeError: Cannot read property 'destroy' of null
            this.parser = null                     
            this.scheduleNextUpdate()
            console.log('EPG UPDATE END', this.udb.length)
            if(this.udb.length){
                if(newLastModified){
                    this.udb.index.lastmCtrlKey = newLastModified
                }
                this.udb.index.fetchCtrlKey = now
                this.state = 'loaded'
                this.loaded = true
                this.error = null
                
                await this.udb.save()

                console.log('EPG apply 1')
                await this.refiner.apply(this.udb).catch(console.error)

                console.log('EPG apply 2')
                await this.udb.destroy()
                await this.db.destroy()
                await moveFile(this.tmpFile, this.file)
                
                this.db = new Database(this.file, DBOPTS)
                await this.db.init()
                this.emit('load')
            } else {
                this.state = 'error'
                this.error = validEPG ? 'EPG_OUTDATED' : 'EPG_BAD_FORMAT'
                if(this.listenerCount('error')){
                    this.emit('error', this.error)
                }
                await this.udb.destroy()
                await fs.promises.unlink(this.tmpFile).catch(console.error)
            }
            this.udb = null
        } else {
            console.log('epg update skipped')
            this.scheduleNextUpdate()
        }
    }
    cidToDisplayName(cid){
        return typeof(this.udb.index.channels[cid]) == 'undefined' ? 
            cid : 
            this.udb.index.channels[cid].name
    }
    programme(programme){
        if(programme && programme.channel && programme.title.length) {
            const now = time()
            const start = programme.start
            const end = programme.end
            if(end >= now && end <= (now + this.dataLiveWindow)) {
                const ch = this.cidToDisplayName(programme.channel)
                let t = programme.title.shift() || 'Untitled'
                if(t.includes('/')) {
                    t = this.fixSlashes(t)
                }
                let i
                if(programme.icon) {
                    i = programme.icon
                } else if(programme.images.length) {
                    const weight = {
                        'large': 1,
                        'medium': 0,
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
                this.indexate({
                    start, e: end,
                    t, i, ch, 
                    c: programme.category || []
                })
            }
        }
    }
    indexate(data){
        this.udb.insert(data).catch(console.error)
        this.refiner.learn(data)
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
        this.autoUpdateTimer = setTimeout(() => this.update().catch(console.error), timeSecs * 1000)
    }
}

class EPG extends EPGUpdater {
    constructor(url){
        super()
        this.url = url
        this.file = storage.resolve('epg-'+ url)
        this.tmpFile = storage.resolve('epg-'+ url) +'-'+ Math.random().toString(36).substring(7)
        this.debug = false
        this.data = {}
        this.errorCount = 0
        this.errorCountLimit = 3
        this.acceptRanges = false
        this.bytesLength = -1
        this.transferred = 0
        this.loaded = false
        this.ttl = 3600
        this.dataLiveWindow = 72 * 3600
        this.autoUpdateIntervalSecs = 1800
        this.minExpectedEntries = 72
        this.state = 'uninitialized'
        this.error = null
        this.db = new Database(this.file, DBOPTS)
    }
    ready(){
        return new Promise((resolve, reject) => {
            const respond = () => {
                if(this.state == 'error') {
                    reject(this.error)
                } else {
                    resolve(true)
                }
            }
            if(this.loaded) return respond()
            if(this.state == 'uninitialized') {
                this.start().catch(e => {
                    console.error(e)
                    if(this.state != 'loaded') {
                        this.error = e || 'start error'
                        this.state = 'error'
                    }
                }).finally(() => respond())
            } else {
                this.once('load', () => respond())
            }
        })
    }
    async start(){
        if(!this.loaded){ // initialize
            this.state = 'loading'
            console.log('START EPG', this.url)
            await this.db.init().catch(err => {
                this.error = err
            })
            const updatePromise = this.update().catch(err => {
                this.error = err
            })
            console.log('START EPG2', this.url)
            if(this.db.length < this.minExpectedEntries) {
                await updatePromise // will update anyway, but only wait for if it has few programmes
            }
            console.log('epg loaded', this.db.length)
            this.loaded = true
            this.emit('load')
        }
    }
    async getState(){
		return {            
            progress: this.request ? this.request.progress : (this.state == 'loaded' ? 100 : 0),
            state: this.state,
            error: this.error
        }
    }
    async destroy(){
        this.autoUpdateTimer && clearInterval(this.autoUpdateTimer)
        this.state = 'uninitialized'
        this.request && this.request.destroy()
        this.parser && this.parser.destroy()
        this.db && this.db.destroy()
        this.udb && this.udb.destroy()
        this.data = {}
        this.removeAllListeners()
    }
}

class EPGManager extends EPGPaginateChannelsList {
    constructor(){
        super()
        this.limit = pLimit(2)
        this.epgs = {}
        this.config = []
    }
    async start(config){
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
    async sync(config){
        this.config = config
        const activeEPGs = this.activeEPGs()
        for(const url in this.epgs) {
            if(!activeEPGs.includes(url)) {
                await this.remove(url)
            }
        }
        for(const url of activeEPGs) {
            if(!this.epgs[url]) {
                await this.add(url)
            }
        }
    }
    async suggest(urls) {
        const epgs = Object.values(this.epgs)
        if(epgs.length) return
        let added
        const tasks = urls.map(url => {
            return async () => {
                if(added === true) return
                await this.add(url, true)
                if(this.epgs[url]){
                    await this.epgs[url].ready()
                    if(added === true || this.epgs[url].state !== 'loaded') {
                        await this.remove(url)
                    } else {
                        added = true
                    }
                }
            }
        }).map(this.limit)
        await Promise.allSettled(tasks)
    }
    async add(url, suggested){
        console.log('epg.add', url, suggested, Object.keys(this.epgs))
        if(!this.epgs[url]){
            this.epgs[url] = new EPG(url)
            this.epgs[url].start().then(() => {
                utils.emit('update', url)
            }).catch(err => {
                console.error('epg start error', url, err)
            })
            this.epgs[url].suggested = !!suggested
        }
        if(!suggested) {
            let satisfied
            for(const u in this.epgs) {
                if(satisfied && this.epgs[u].suggested && u != url){
                    await this.remove(u)
                }
                if(this.epgs[u].state === 'loaded'){
                    satisfied = true
                }
            }
        }
    }
    async remove(url){
        if(this.epgs[url]){
            const e = this.epgs[url]
            delete this.epgs[url]
            e.destroy()
            utils.emit('update', url)
        }
    }
    async ready(){
        for(const url in this.epgs){
            if(this.epgs[url].state === 'loaded') return true
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
        const categories = {}, now = time()
        let updateAfter = 600
        for(const url in this.epgs) {
            if(this.epgs[url].state !== 'loaded') continue
            const db = this.epgs[url].db
            for(const ch of db.indexManager.readColumnIndex('ch')) {
                const name = this.prepareChannelName(ch)
                const programmes = await db.query({ch, start: {'<=': now}, e: {'>': now}})
                for(const programme of programmes) {
                    if(programme.e > now && parseInt(programme.start) <= now){
                        if(Array.isArray(programme.c)){
                            this.liveNowChannelsListFilterCategories(programme.c).forEach(category => {
                                category = ucWords(category)
                                if(category.includes('/')){
                                    category = category.replaceAll('/', ' ')
                                }
                                if(typeof(categories[category]) == 'undefined'){
                                    categories[category] = new Set
                                }
                                if(!categories[category].has(name)){
                                    categories[category].add(name)
                                }
                            })
                        }
                        let requiresUpdateAfter = Math.max(programme.e - now, 10)
                        if(requiresUpdateAfter < updateAfter){
                            updateAfter = requiresUpdateAfter
                        }
                        break
                    }
                }
            }
        }
        if(!Object.keys(categories).length){
            const category = lang.ALL            
            for(const url in this.epgs) {
                if(this.epgs[url].state !== 'loaded') continue
                const db = this.epgs[url].db
                for(const ch of db.indexManager.readColumnIndex('ch')) {
                    const name = this.prepareChannelName(ch)
                    const programmes = await db.query({ch, start: {'<=': now}, e: {'>': now}})
                    for(const programme of programmes) {
                        if(programme.e > now && parseInt(programme.start) <= now){
                            if(typeof(categories[category]) == 'undefined'){
                                categories[category] = new Set
                            }
                            if(!categories[category].has(name)){
                                categories[category].add(name)
                            }
                            let requiresUpdateAfter = Math.max(programme.e - now, 10)
                            if(requiresUpdateAfter < updateAfter){
                                updateAfter = requiresUpdateAfter
                            }
                            break
                        }
                    }
                }
            }            
        }
        for(const c in categories) {
            categories[c] = [...categories[c]].sort()
        }
        return {categories, updateAfter}
    }
    async expandRecommendations(cats, limit=1532){
        const relatedTerms = []
        const tasks = Object.values(this.epgs).map(({db}) => {
            return async () => {
                if(db === undefined || db.state !== 'loaded') return
                for await (const programme of db.walk({c: Object.keys(cats)})) {
                    if(programme.c && programme.c.length){
                        let score = 0
                        for(const t of programme.c) {
                            if(typeof(cats[t]) != 'undefined') {
                                score += cats[t]
                            }
                        }
                        for(const t of programme.c) {
                            if(typeof(cats[t]) != 'undefined') return
                            if(typeof(relatedTerms[t]) == 'undefined'){
                                relatedTerms[t] = 0
                            }
                            relatedTerms[t] += score
                        }
                    }
                }
            }
        })
        await Promise.allSettled(tasks.map(this.limit))
        return this.equalize(relatedTerms, limit)
    }
    equalize(tags, limit) {
        let max = 0
        const ret = {}, pass = new Set(Object.keys(tags).sort((a, b) => relatedTerms[b] - relatedTerms[a]).slice(0, limit))
        for(const t in pass) {
            if(tags[t] > max) {
                max = tags[t]
            }
            ret[t] = tags[t]
        }
        for(const t in ret) {
            ret[t] = ret[t] / max
        }
        return ret
    }
    async getRecommendations(categories, until, limit = 24, searchTitles){
        const lcCategories = Object.keys(categories), now = time()
        if(!lcCategories.length){
            return {}
        }
        let results = []
        if(!until){
            until = now + (6 * 3600)
        }        
        for(const url in this.epgs) {
            if(this.epgs[url].state !== 'loaded') continue
            const db = this.epgs[url].db
            for(const ch of db.indexManager.readColumnIndex('ch')) {
                const programmes = await db.query({ch, start: {'<=': until}, e: {'>': now}})
                for(const programme of programmes) {
                    const start = programme.start
                    if(programme.e > now && parseInt(start) <= until){
                        let added
                        if(Array.isArray(programme.c)){
                            for(const c of programme.c) {
                                if(lcCategories.includes(c)){
                                    if(typeof(results[ch]) == 'undefined'){
                                        results[ch] = {}
                                    }
                                    const row = programme
                                    row.meta = {ch, start, score: 0}
                                    results.push(row)
                                    added = true
                                    break
                                }
                            }
                        }
                        if(!added && searchTitles){
                            let lct = (programme.t +' '+  programme.c.join(' ')).toLowerCase()
                            for(const l of lcCategories) {
                                if(lct.includes(l)){
                                    const row = programme
                                    row.meta = {ch, start, score: 0}
                                    results.push(row)
                                    break
                                }
                            }
                        }
                    }
                }
            }
        }
        for(let i=0; i<results.length; i++) {
            if(results[i].c && results[i].c.length){
                let score = 0
                for(const t of results[i].c) {
                    if(categories[t]){
                        score += categories[t]
                    }
                }
                results[i].score = score
            }
        }
        let quota = limit, already = new Set()
        results = results.sortByProp('score', true).filter(r => {
            if(quota) { // limit by titles count instead of entries count to avoid duplicates from diff channels
                if(!already.has(r.t)){
                    quota--
                    already.add(r.t)
                }
                return true
            }
        })
        const ret = {}
        for(const row of results) {
            if(typeof(ret[row.meta.ch]) == 'undefined'){
                ret[row.meta.ch] = {}
            }
            ret[row.meta.ch][row.meta.start] = row
            delete ret[row.meta.ch][row.meta.start].meta
        }
        return ret
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
    async getState(){
        const info = []
        let max = 0, maxData = {progress: -1, state: 'uninitialized', error: null}
        for(const url in this.epgs) {
            const state = await this.epgs[url].getState()
            state.url = url
            info.push(state)
            if(state.progress > max) {
                max = state.progress
                maxData = state
            }
        }
        Object.assign(maxData, {lang, info, workerData})
		return maxData
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
                    if(this.epgs[url].state !== 'loaded') continue
                    const db = this.epgs[url].db
                    const availables = db.indexManager.readColumnIndex('ch')
                    if(availables.has(channel.searchName)){
                        query.ch = channel.searchName
                        return await db.query(query, {orderBy: 'start', limit})
                    }
                }
            }
            const n = await this.findChannel(this.extractTerms(channel))
            for(const url in this.epgs) {
                if(this.epgs[url].state !== 'loaded') continue
                const db = this.epgs[url].db
                const availables = db.indexManager.readColumnIndex('ch')
                if(n && availables.has(n)){
                    query.ch = n
                    return await db.query(query, {orderBy: 'start', limit})
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
            if(this.epgs[url].state !== 'loaded') continue
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
            if(this.epgs[url].state !== 'loaded') continue
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
            if(this.epgs[url].state !== 'loaded') continue
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
            if(this.epgs[url].state !== 'loaded') continue
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
                if(this.epgs[url].state !== 'loaded') continue
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
            if(this.epgs[url].state !== 'loaded') continue
            const db = this.epgs[url].db
            const availables = db.indexManager.readColumnIndex('ch')
            for(const ch of availables) {
                const query = {ch, e: {'>': now}}
                if(nowLive) query['<='] = now
                for await (const programme of db.walk(query)) {
                    let t = programme.t
                    if(programme.c.length){
                        t += ' '+ programme.c.join(' ')
                    }
                    let pterms = listsTools.terms(t)
                    if(listsTools.match(terms, pterms, true)){
                        if(typeof(epgData[ch]) == 'undefined'){
                            epgData[ch] = {}
                        }
                        epgData[ch][programme.start] = programme
                    }
                }
            }
        }
        return epgData
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
        config.removeListener('change', this.changeListener)
    }
}

EPGManager.EPG = EPG

export default EPGManager