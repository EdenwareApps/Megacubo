import fs from 'fs'
import pLimit from 'p-limit';
import { moveFile, parseCommaDelimitedURIs, textSimilarity, time, ucWords } from '../utils/utils.js'
import Download from '../download/download.js'
import paths from '../paths/paths.js'
import config from '../config/config.js';
import { EventEmitter } from 'events'
import listsTools from '../lists/tools.js'
import setupUtils from '../multi-worker/utils.js'
import Mag from './mag.js'
import xmltv from 'xmltv'
import { getFilename } from 'cross-dirname'
import { Database } from 'jexidb'
import { workerData } from 'worker_threads'

const utils = setupUtils(getFilename())

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
    }
    fixSlashes(txt){
        return txt.replaceAll('/', '|') // this character will break internal app navigation
    }
    prepareProgrammeData(programme, end){
        if(!end){
            end = time(programme.end)
        }
        let t = programme.title.shift() || 'No title'
        if(t.includes('/')) {
            t = this.fixSlashes(t)
        }
        return {e: end, t, c: programme.category || [], i: programme.icon || ''}
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
            let validEPG, failed, hasErr, newLastModified, received = 0, errorCount = 0, initialBuffer = []            
            this.error = null
            console.log('epg updating...')
            const onErr = err => {
                if(failed){
                    return
                }
                hasErr = true
                //console.error('EPG FAILED DEBUG', initialBuffer)
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
                        this.parser.destroy() 
                        this.parser = null    
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
                this.parser = new xmltv.Parser()
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
                    if(!hasErr) initialBuffer.push(chunk)
                    try {
                        this.parser.write(chunk)
                    } catch(e) {}
                    if(!validEPG && chunk.toLowerCase().includes('<programme')){
                        validEPG = true
                    }
                })
                this.request.once('end', () => {
                    this.request.destroy() 
                    this.request = null
                    console.log('EPG REQUEST ENDED', validEPG, received, Object.keys(this.data).length)
                    this.parser && this.parser.end()
                })
                this.request.start()
            }
            this.udb = new Database(this.tmpFile, {
                clear: true,
                indexes: {channel: 'string', start: 'number', c: 'number'},
                index: {channels: {}, terms: {}},
                v8: false,
                compressIndex: false
            })
            await this.udb.init()
            this.parser.on('programme', this.programme.bind(this))
            this.parser.on('channel', this.channel.bind(this))
            this.parser.on('error', () => {})
            await new Promise(resolve => this.parser.once('end', resolve))
            this.parser && this.parser.destroy() // TypeError: Cannot read property 'destroy' of null
            this.parser = null                     
            this.scheduleNextUpdate()
            if(this.udb.length){
                if(newLastModified){
                    this.udb.index.lastmCtrlKey = newLastModified
                }
                this.udb.index.fetchCtrlKey = now
                this.state = 'loaded'
                this.loaded = true
                this.error = null
                
                await this.udb.save()
                await this.udb.destroy()
                await this.db.destroy()
                await moveFile(this.tmpFile, this.file)
                
                this.db = new Database(this.file, {
                    indexes: {channel: 'string', start: 'number', c: 'number'},
                    index: {channels: {}, terms: {}},
                    v8: false,
                    compressIndex: false
                })
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
        if(programme && programme.channel && programme.title.length){
            const now = time(), start = time(programme.start), end = time(programme.end)
            programme.channel = this.cidToDisplayName(programme.channel)
            if(end >= now && end <= (now + this.dataLiveWindow)){
                this.indexate(programme.channel, start, this.prepareProgrammeData(programme, end))
            }
        }
    }
    indexate(channel, start, data){
        this.udb.insert({channel, start, ...data}).catch(console.error)
        if(!this.udb.index.terms[channel] || !Array.isArray(this.udb.index.terms[channel])){
            this.udb.index.terms[channel] = listsTools.terms(channel)
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
        this.db = new Database(this.file, {
            fields: {channel: 'string', start: 'number', c: 'number'},
            index: {channels: {}, terms: {}},
            v8: false,
            compressIndex: false
        })
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
            await this.db.init().catch(err => {
                this.error = err
            })
            const updatePromise = this.update().catch(err => {
                this.error = err
            })
            if(this.db.length < this.minExpectedEntries) {
                await updatePromise // will update anyway, but only wait for if it has few programmes
            }
            console.log('epg loaded', this.db.length)
            this.loaded = true
            this.emit('load')
        }
    }
    async getTerms(){
        return this.db.index.terms
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
        console.log('epg.SUGGEST()', urls, epgs.length)
        if(epgs.length) return
        let added
        const tasks = urls.map(url => {
            return async () => {
                if(added === true) return
                console.log('epg.SUGGEST() add', url)
                await this.add(url, true)
                if(this.epgs[url]){
                    console.log('epg.SUGGEST() adding', url)
                    await this.epgs[url].ready()
                    console.log('epg.SUGGEST() added', url, this.epgs[url].state)
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
    async liveNowChannelsList(){
        const categories = {}, now = time()
        let updateAfter = 600
        for(const url in this.epgs) {
            if(this.epgs[url].state !== 'loaded') continue
            const db = this.epgs[url].db
            for(const channel of db.indexManager.readColumnIndex('channel')) {
                const name = this.prepareChannelName(channel)
                const programmes = await db.query({channel, start: {'<=': now}, e: {'>': now}})
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
                for(const channel of db.indexManager.readColumnIndex('channel')) {
                    const name = this.prepareChannelName(channel)
                    const programmes = await db.query({channel, start: {'<=': now}, e: {'>': now}})
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
            for(const channel of db.indexManager.readColumnIndex('channel')) {
                const programmes = await db.query({channel, start: {'<=': until}, e: {'>': now}})
                for(const programme of programmes) {
                    const start = programme.start
                    if(programme.e > now && parseInt(start) <= until){
                        let added
                        if(Array.isArray(programme.c)){
                            for(const c of programme.c) {
                                if(lcCategories.includes(c)){
                                    if(typeof(results[channel]) == 'undefined'){
                                        results[channel] = {}
                                    }
                                    const row = programme
                                    row.meta = {channel, start, score: 0}
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
                                    row.meta = {channel, start, score: 0}
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
            if(typeof(ret[row.meta.channel]) == 'undefined'){
                ret[row.meta.channel] = {}
            }
            ret[row.meta.channel][row.meta.start] = row
            delete ret[row.meta.channel][row.meta.start].meta
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
        let data
        if(channel.searchName == '-'){
            data = {}
        } else {
            const now = time()
            if(channel.searchName) {
                for(const url in this.epgs) {
                    if(this.epgs[url].state !== 'loaded') continue
                    const db = this.epgs[url].db
                    const availables = db.indexManager.readColumnIndex('channel')
                    if(availables.has(channel.searchName)){
                        return await db.query(
                            {channel: channel.searchName, e: {'>': now}},
                            {orderBy: 'start', limit}
                        )
                    }
                }
            }
            const n = await this.findChannel(this.extractTerms(channel))
            for(const url in this.epgs) {
                if(this.epgs[url].state !== 'loaded') continue
                const db = this.epgs[url].db
                const availables = db.indexManager.readColumnIndex('channel')
                if(n && availables.has(n)){
                    return await db.query(
                        {channel: n, e: {'>': now}},
                        {orderBy: 'start', limit}
                    )
                }
            }
        }
        return false
    }
    async getData(){
        return Object.keys(this.epgs).map(url => {
            return {
                state: this.epgs[url].state,
                error: this.epgs[url].error,
                length: this.epgs[url].db.length,
            }
        })
    }
    async getTerms(){
        let results = {}        
        for(const url in this.epgs) {
            if(this.epgs[url].state !== 'loaded') continue
            for(const name in this.epgs[url].db.index.terms) {
                if(results[name] !== undefined) continue
                results[name] = this.epgs[url].db.index.terms[name]
            }
        }
        return results
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
            results[r.name] = await this.epgs[r.url].db.query({channel: r.name, end: {'>': time()}}, {limit})
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
    async validateChannelProgramme(channel, start, title){
        const cid = await this.findChannel(channel)
        if(cid) {            
            for(const url in this.epgs) {
                if(this.epgs[url].state !== 'loaded') continue
                const db = this.epgs[url].db
                const programmes = await db.query({channel: cid, start}, {orderBy: 'start asc', limit: 2})
                for(const programme of programmes) {
                    if(programme.t == title || textSimilarity(programme.t, title) > 0.75) {
                        return true
                    }
                }
            }
        }
    }
    async findChannel(data){
        for(const url in this.epgs) {
            if(this.epgs[url].state !== 'loaded') continue
            const db = this.epgs[url].db
            const availables = db.indexManager.readColumnIndex('channel')
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
                    if(Array.isArray(db.index.terms[name])){
                        score = listsTools.match(db.index.terms[name], terms, false)
                        if(score && score >= maxScore){
                            maxScore = score
                            candidates.push({name, score})
                        }
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
            const availables = db.indexManager.readColumnIndex('channel')
            for(const channel of availables) {
                const query = {channel, e: {'>': now}}
                if(nowLive) query['<='] = now
                for await (const programme of db.walk(query)) {
                    let t = programme.t
                    if(programme.c.length){
                        t += ' '+ programme.c.join(' ')
                    }
                    let pterms = listsTools.terms(t)
                    if(listsTools.match(terms, pterms, true)){
                        if(typeof(epgData[channel]) == 'undefined'){
                            epgData[channel] = {}
                        }
                        epgData[channel][programme.start] = programme
                    }
                }
            }
        }
        return epgData
    }
	async terminate(){
        config.removeListener('change', this.changeListener)
    }
}

EPGManager.EPG = EPG

export default EPGManager