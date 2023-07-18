const ListsCommon = require('../lists/common')
const xmltv = require('xmltv')
const Events = require('events'), utils = require('../multi-worker/utils')

class EPGPaginateChannelsList extends Events {
    constructor(){
        super()
        this.badTerms = new Map([
            ['H.265', null],
            ['H.264', null],
            ['H265', null],
            ['H264', null],
            ['SD', null],
            ['HD', null],
            ['FHD', null],
            ['2K', null],
            ['4K', null],
            ['8K', null]
        ])
    }
    prepareChannelName(name){
        const badTerms = ['H.265', 'H.264', 'H265', 'H264', 'SD', 'HD', 'FHD', '2K', '4K', '8K']
        return global.ucWords(name.split('[')[0].split(' ').filter(s => s && !badTerms.has(s.toUpperCase())).join(' '))
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
        return start == end ? global.ucWords(start) : lang.X_TO_Y.format(start.toUpperCase(), end.toUpperCase())
    }	
    paginateChannelList(snames){
        let ret = {}, folderSizeLimit = global.config.get('folder-size-limit')
        snames = [...new Set(snames.map(s => this.prepareChannelName(s)).sort())]
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

class EPG extends EPGPaginateChannelsList {
    constructor(){
        super()
        this.listsCommon = new ListsCommon()
        this.debug = false
        this.metaCache = {icons:{}, categories: {}}
        this.data = {}
        this.terms = {}
        this.errorCount = 0
        this.errorCountLimit = 3
        this.acceptRanges = false
        this.bytesLength = -1
        this.transferred = 0
        this.loaded = false
        this.ttl = 2 * 3600
        this.autoUpdateIntervalSecs = 3600
        this.minExpectedEntries = 72
        this.state = 'uninitialized'
        this.error = null
        this.channels = {}
    }
    async setURL(url){        
        this.url = url
        this.key = 'epg-' + this.url
        this.termsKey = 'epg-terms-' + this.url
        this.channelsKey = 'epg-channels-' + this.url
        this.fetchCtrlKey = 'epg-fetch-' + this.url
        this.lastmCtrlKey = 'epg-lm-' + this.url
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
            if(this.loaded){
                return respond()
            }
            if(this.state == 'uninitialized'){
                this.start().catch(e => {
                    console.error(e)
                    if(this.state != 'loaded'){
                        this.error = e
                        this.state = 'error'
                    }
                }).finally(() => respond())
            } else {
                this.once('load', () => respond())
            }
        })
    }
    async start(){
        if(!Object.keys(this.data).length){ // initialize
            this.state = 'loading'
            await this.load().catch(console.error)
            const updatePromise = this.update().catch(console.error)
            if(Object.keys(this.data).length < this.minExpectedEntries) {
                await updatePromise // will update anyway, but only wait for if it has few programmes
            }
            console.log('epg loaded', Object.keys(this.data).length)
            if(Object.keys(this.data).length >= this.minExpectedEntries) {
                this.scheduleNextUpdate()
                this.state = 'loaded'
                this.loaded = true
                this.emit('load')
            } else {
                this.scheduleNextUpdate(600)
                if(this.state != 'error') {
                    this.state = 'error'                    
                }
                if(!this.error) {
                    this.error = global.lang.EPG_BAD_FORMAT
                }
                if(this.listenerCount('error')) {
                    this.emit('error', this.error)
                }
                this.loaded = true
                this.emit('load') // return ready() calls
                throw this.error
            }
        }
    }
    async update(){
        let lastFetchedAt = await global.storage.promises.get(this.fetchCtrlKey)
        let lastModifiedAt = await global.storage.promises.get(this.lastmCtrlKey)
        const now = this.time()
        if(Object.keys(this.data).length < this.minExpectedEntries || !lastFetchedAt || lastFetchedAt < (this.time() - (this.ttl / 2))){
            if(this.request || this.parser){
                console.error('already updating')
                return
            }
            if(!this.loaded){
                this.state = 'connecting'
            }
            let errorCount = 0, failed, hasErr, newLastModified, initialBuffer = []
            this.error = null
            console.log('epg updating...')
            this.parser = new xmltv.Parser()
            this.parser.on('programme', this.programme.bind(this))
            this.parser.on('channel', this.channel.bind(this))
            this.parser.on('error', err => {
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
                    this.error = global.lang.EPG_BAD_FORMAT
                    if(this.listenerCount('error')){
                        this.emit('error', global.lang.EPG_BAD_FORMAT)
                    }
                    this.scheduleNextUpdate(30)
                }
                return true
            })
            this.parser.once('end', () => {
                console.log('EPG PARSER END')
                this.applyMetaCache()
                this.clean()
                this.save()
                this.parser && this.parser.destroy() // TypeError: Cannot read property 'destroy' of null
                this.parser = null                                
                this.scheduleNextUpdate()
                if(Object.keys(this.data).length){
                    if(newLastModified){
                        global.storage.set(this.lastmCtrlKey, newLastModified, this.ttl)
                    }
                    global.storage.set(this.fetchCtrlKey, now, this.ttl)
                    this.state = 'loaded'
                    this.loaded = true
                    this.error = null
                    this.emit('load')
                    utils.emit('updated')
                } else {
                    this.state = 'error'
                    this.error = validEPG ? global.lang.EPG_OUTDATED : global.lang.EPG_BAD_FORMAT
                    if(this.listenerCount('error')){
                        this.emit('error', this.error)
                    }
                }
            })
            let validEPG, received = 0
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
                cacheTTL: 3600,
                progress: p => utils.emit('progress', p)
            }
            this.request = new global.Download(req)
            this.request.on('error', err => {
                console.warn(err)
                return true
            })
            this.request.once('response', (code, headers) => {
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
                this.parser.write(chunk)
                if(!validEPG && chunk.toLowerCase().indexOf('<programme') != -1){
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
            await this.ready()
        } else {
            console.log('epg update skipped')
            this.scheduleNextUpdate()
            this.clean()
        }
    }
    fixSlashes(txt){
        return txt.replaceAll('/', '|') // this character will break internal app navigation
    }
    prepareProgrammeData(programme, end){
        if(!end){
            end = this.time(programme.end)
        }
        let t = programme.title.shift() || 'No title'
        if(t.indexOf('/') != -1) {
            t = this.fixSlashes(t)
        }
        return {e: end, t, c: programme.category || [], i: programme.icon || ''}
    }
    channel(channel){
        if(!channel) return
        let name = channel.displayName || channel.name;
        [channel.id, channel.name || channel.displayName].forEach(cid => {
            if(typeof(this.channels[cid]) == 'undefined'){
                this.channels[cid] = {name}
            } else if(cid != name) {
                this.channels[cid].name = name
            }
            if(channel.icon){
                this.channels[cid].icon = channel.icon
            }
        })
    }
    cidToDisplayName(cid){
        return typeof(this.channels[cid]) == 'undefined' ? cid : this.channels[cid].name
    }
    programme(programme){
        if(programme && programme.channel && programme.title.length){
            const now = this.time(), start = this.time(programme.start), end = this.time(programme.end)
            programme.channel = this.cidToDisplayName(programme.channel)
            if(end >= now && end <= (now + this.ttl)){
                if(!this.hasProgramme(programme.channel, start)){
                    this.indexate(programme.channel, start, this.prepareProgrammeData(programme, end))
                }
            }
        }
    }
    applyMetaCache(){
        Object.keys(this.metaCache.categories).forEach(t => {
            if(this.metaCache.categories[t].some(c => c.indexOf('/') != -1)){
                this.metaCache.categories[t] = this.metaCache.categories[t].map((c, i) => {
                    if(c.indexOf('/') != -1){
                        c = c.split('/').map(s => s.trim()).filter(s => s)
                    }
                    return c
                })
                this.metaCache.categories[t] = this.metaCache.categories[t].flat()
            }
            this.metaCache.categories[t] = this.metaCache.categories[t].map(s => s.toLowerCase())
        })
        Object.keys(this.data).forEach(channel => {
            Object.keys(this.data[channel]).forEach(start => {
                let t = this.data[channel][start].t.toLowerCase()
                if(this.metaCache.categories[t] && this.metaCache.categories[t].length){
                    this.data[channel][start].c = this.metaCache.categories[t]
                }
                if(!this.data[channel][start].i){
                    let t = this.data[channel][start].t.toLowerCase()
                    if(this.metaCache.icons[t]){
                        let bestIcon
                        Object.keys(this.metaCache.icons[t]).forEach(src => {
                            if(!src) return
                            if(!bestIcon){
                                bestIcon = src
                            } else {
                                if(this.metaCache.icons[t][src] > this.metaCache.icons[t][bestIcon]){
                                    bestIcon = src
                                }
                            }
                        })
                        if(bestIcon){
                            this.data[channel][start].i = bestIcon
                        }
                    }
                }
            })
        })
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
        let categories = {}, now = this.time(), updateAfter = 600
        Object.keys(this.data).forEach(channel => {
            const name = this.prepareChannelName(channel)
            Object.keys(this.data[channel]).some(start => {
                if(this.data[channel][start].e > now && parseInt(start) <= now){
                    if(Array.isArray(this.data[channel][start].c)){
                        this.liveNowChannelsListFilterCategories(this.data[channel][start].c).forEach(category => {
                            category = global.ucWords(category)
                            if(category.indexOf('/') != -1){
                                category = category.replaceAll('/', ' ')
                            }
                            if(typeof(categories[category]) == 'undefined'){
                                categories[category] = []
                            }
                            if(!categories[category].includes(name)){
                                categories[category].push(name)
                            }
                        })
                    }
                    let requiresUpdateAfter = Math.max(this.data[channel][start].e - now, 10)
                    if(requiresUpdateAfter < updateAfter){
                        updateAfter = requiresUpdateAfter
                    }
                    return true
                }
            })
        })
        if(!Object.keys(categories).length){
            categories = this.paginateChannelList(Object.keys(this.data))
        }
        return {categories, updateAfter}
    }
    async expandSuggestions(categories){
        const results = {}
        Object.values(this.data).forEach(c => {
            Object.values(c).forEach(p => {
                if(!p.c.length) return
                let tms = p.c.filter(t => categories.includes(t))
                if(tms.length) {
                    tms.forEach(term => {
                        if(typeof(results[term]) == 'undefined') {
                            results[term] = []
                        }
                        p.c.forEach(a => {
                            if(!categories.includes(a) && !results[term].includes(a)) {
                                results[term].push(a)
                            }
                        })
                    })
                }
            })
        })
        return results
    }
    async getSuggestions(categories, until, limit = 24, searchTitles){
        if(!Object.keys(categories).length){
            return {}
        }
        const lcCategories = Object.keys(categories), now = this.time()
        let results = []
        if(!until){
            until = now + (24 * 3600)
        }
        Object.keys(this.data).forEach(channel => {
            Object.keys(this.data[channel]).some(start => {
                if(this.data[channel][start].e > now && parseInt(start) <= until){
                    let added
                    if(Array.isArray(this.data[channel][start].c)){
                        added = this.data[channel][start].c.some(c => {
                            if(lcCategories.includes(c)){
                                if(typeof(results[channel]) == 'undefined'){
                                    results[channel] = {}
                                }
                                const row = this.data[channel][start]
                                row.meta = {channel, start, score: 0}
                                results.push(row)
                                return true
                            }
                        })
                    }
                    if(!added && searchTitles){
                        let lct = (this.data[channel][start].t +' '+  this.data[channel][start].c.join(' ')).toLowerCase()
                        lcCategories.some(l => {
                            if(lct.indexOf(l) != -1){
                                const row = this.data[channel][start]
                                row.meta = {channel, start, score: 0}
                                results.push(row)
                                return true
                            }
                        })
                    }
                }
            })
        })
        results.forEach((row, i) => {
            if(row.c && row.c.length){
                let score = 0
                row.c.forEach(t => {
                    if(categories[t]){
                        score += categories[t]
                    }
                })
                results[i].score = score
            }
        })
        results = results.sortByProp('score', true).slice(0, limit)
        const ret = {}
        results.forEach(row => {
            if(typeof(ret[row.meta.channel]) == 'undefined'){
                ret[row.meta.channel] = {}
            }
            ret[row.meta.channel][row.meta.start] = row
            delete ret[row.meta.channel][row.meta.start].meta
        })
        return ret
    }
    hasProgramme(channel, start){
        return typeof(this.data[channel]) != 'undefined' && typeof(this.data[channel][start]) != 'undefined'
    }
    indexate(channel, start, data){
        if(typeof(this.data[channel]) == 'undefined'){
            this.data[channel] = {}
        }
        if(typeof(this.data[channel][start]) == 'undefined'){
            this.data[channel][start] = data
        }
        if(!this.terms[channel] || !Array.isArray(this.terms[channel])){
            this.terms[channel] = this.listsCommon.terms(channel)
        }
        if(data.i){
            let t = data.t.toLowerCase()
            if(typeof(this.metaCache.icons[t]) == 'undefined'){
                this.metaCache.icons[t] = {}
            }
            if(typeof(this.metaCache.icons[t][data.i]) == 'undefined'){
                this.metaCache.icons[t][data.i] = 1
            } else {
                this.metaCache.icons[t][data.i]++
            }
        }
        if(data.c && data.c.length){
            let t = data.t.toLowerCase()
            if(typeof(this.metaCache.categories[t]) == 'undefined'){
                this.metaCache.categories[t] = []
            }
            data.c.map(s => s.toLowerCase()).forEach(c => {
                if(!this.metaCache.categories[t].includes(c)){
                    this.metaCache.categories[t].push(c)
                }
            })            
        }
    }
    time(dt){
        if(!dt){
            dt = new Date()
        }
        return parseInt(dt.getTime() / 1000)
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
    async getTerms(){
        return this.terms
    }
    async getState(){
		return {            
            progress: this.request ? this.request.progress : (this.state == 'loaded' ? 100 : 0),
            state: this.state,
            error: this.error 
        }
    }
    async get(channel, limit){
        let data
        //console.log('EPGGETCHANNEL', channel)
        if(channel.searchName == '-'){
            data = {}
        } else if(channel.searchName && typeof(this.data[channel.searchName]) != 'undefined'){
            data = this.data[channel.searchName]
        } else if(typeof(this.data[channel.name]) != 'undefined'){
            data = this.data[channel.name]
        } else {
            //console.log('EPGGETCHANNEL', this.extractTerms(channel))
            let n = await this.findChannel(this.extractTerms(channel))
            //console.log('EPGGETCHANNEL', n)
            if(n && typeof(this.data[n]) != 'undefined'){
                data = this.data[n]
            } else {
                return false
            }
        }
        Object.keys(data).forEach(k => data[k].start = parseInt(k))
        //console.log('EPGGETCHANNEL', data)
        return this.order(data, limit)
    }
    async getMulti(channelsList, limit){
        let results = {}
        for(const ch of channelsList) {
            results[ch.name] = await this.get(ch, limit)
        }
        return results
    }
    order(data, limit){
        const ndata = {}, now = this.time(), ks = Object.keys(data)
        if(ks.length < 2){
            return data
        }
        ks.sort((a, b) => a - b).forEach(start => {
            if(limit && data[start].e > now){
                ndata[start] = data[start]
                limit--
            }
        })
        return ndata
    }
    async searchChannel(terms, limit=2){
        let results = {}, data = []
        Object.keys(this.terms).forEach(name => {
            if(!Array.isArray(this.terms[name])) delete this.terms[name]
            const score = this.terms[name].filter(t => terms.includes(t)).length
            data.push({name, score})
        })
        data = data.filter(r => r.score).sortByProp('score', true).slice(0, 24)
        data.forEach(r => {
            if(this.data[r.name]){
                results[r.name] = this.order(this.data[r.name], limit)
            }
        })
        return results
    }
    async searchChannelIcon(terms){
        let score, results = []
        Object.keys(this.terms).forEach(name => {
            if(typeof(this.channels[name]) != 'undefined' && this.channels[name].icon){
                score = this.listsCommon.match(terms, this.terms[name], true)
                if(score){
                    results.push(this.channels[name].icon)       
                }
            }
        })
        return [...new Set(results)]
    }
    async findChannel(data){
        if(data.searchName && data.searchName != '-' && typeof(this.data[data.searchName]) != 'undefined'){
            return data.searchName
        } else if(data.name && typeof(this.data[data.name]) != 'undefined'){
            return data.name
        }
        let score, candidates = [], maxScore = 0, terms = data.terms || data
        Object.keys(this.terms).forEach(name => {
            score = this.listsCommon.match(terms, this.terms[name], false)
            if(score && score >= maxScore){
                maxScore = score
                candidates.push({name, score})
            }
        })
        if(!candidates.length){
            Object.keys(this.terms).forEach(name => {
                if(Array.isArray(this.terms[name])){
                    score = this.listsCommon.match(this.terms[name], terms, false)
                    if(score && score >= maxScore){
                        maxScore = score
                        candidates.push({name, score})
                    }
                }
            })
        }
        if(!candidates.length){
            return false
        }
        candidates = candidates.filter(c => c.score == maxScore)
        // console.log('findChannel', candidates)
        if(candidates.length > 1){
            // first spit out the divergent ones
            let maxSimilarityScore = 0, candidatesData = {}, candidatesSimilarityScores = {}
            candidates.forEach(c => {
                candidatesData[c.name] = [...new Set(Object.values(this.data[c.name]).map(p => p.t))]
            })
            Object.keys(candidatesData).forEach(name => {
                let similarityScore = 0
                candidatesData[name].forEach((title, i) => {
                    Object.keys(candidatesData).forEach(n => {
                        if(!candidatesData[n][i]) return
                        if(candidatesData[name][i] == candidatesData[n][i]){
                            similarityScore++
                        }
                    })
                })
                candidatesSimilarityScores[name] = similarityScore
                if(similarityScore > maxSimilarityScore){
                    maxSimilarityScore = similarityScore
                }
            })
            // console.log('findChannel', Object.assign({}, candidatesData))
            Object.keys(candidatesData).forEach(name => {
                if(candidatesSimilarityScores[name] < maxSimilarityScore){
                    delete candidatesData[name]
                }
            })
            // console.log('findChannel', Object.assign({}, candidatesData))
            // now pick the longest one
            let maxEndingTime = 0, ckeys = Object.keys(candidatesData).sort((a, b) => {
                let ak = Object.keys(this.data[a]).pop()
                let bk = Object.keys(this.data[b]).pop()
                let ae = this.data[a][ak].e
                let be = this.data[b][bk].e
                if(ae > maxEndingTime) maxEndingTime = ae
                if(be > maxEndingTime) maxEndingTime = be
                return be - ae
            })
            candidates = candidates.filter(c => {
                return c.name == ckeys[0]
            })
        }
        return candidates.length ? candidates[0].name : false
    }
    async search(terms, nowLive){
        let epgData = {}, now = this.time()
        Object.keys(this.data).forEach(channel => {
            Object.keys(this.data[channel]).forEach(start => {
                if(nowLive === true){
                    if(start > now || this.data[channel][start].e < now){
                        return
                    }
                }
                let t = this.data[channel][start].t
                if(this.data[channel][start].c.length){
                    t += ' '+ this.data[channel][start].c.join(' ')
                }
                let pterms = this.listsCommon.terms(t)
                if(this.listsCommon.match(terms, pterms, true)){
                    if(typeof(epgData[channel]) == 'undefined'){
                        epgData[channel] = {}
                    }
                    epgData[channel][start] = this.data[channel][start]
                }
            })
        })
        return epgData
    }
    async load(){
        let data = await global.storage.promises.get(this.key)
        let loaded
        if(data){
            const now = this.time()
            Object.keys(data).forEach(channel => {
                Object.keys(data[channel]).forEach(start => {
                    if(data[channel][start].e < now || data[channel][start].e > (now + this.ttl)){
                        delete data[channel][start]
                    } else if(!this.hasProgramme(channel, start)) {
                        this.indexate(channel, start, data[channel][start])
                        if(!loaded){
                            loaded = true
                        }
                    }
                })
            })
        }
        if(loaded){
            let cdata = await global.storage.promises.get(this.channelsKey)
            if(cdata){
                Object.keys(cdata).forEach(name => {
                    if(typeof(this.channels[name]) == 'undefined'){
                        this.channels[name] = {name}
                    }
                })
            }
            let tdata = await global.storage.promises.get(this.termsKey)
            if(tdata){
                Object.keys(data).forEach(name => {
                    if(typeof(this.terms[name]) == 'undefined'){
                        this.terms[name] = data[name]
                    }
                })
                return true
            } else {
                throw 'no epg terms loaded'
            }
        } else {
            throw 'no epg current data loaded'
        }
    }
    normalizeChannelClock(programmes){
        let ks = Object.keys(programmes).sort((a, b) => parseInt(a)-parseInt(b)), lt = ''
        for(var i=0, l=0; i<ks.length; i++){
            if(!lt){
                lt = programmes[ks[i]].t
                //console.log(lt, i, ks, programmes[ks[i]])
            } else {
                if(lt == programmes[ks[i]].t){
                    if(typeof(programmes[ks[l]]) != 'undefined'){
                        programmes[ks[l]].e = Math.max(programmes[ks[l]].e, programmes[ks[i]].e)
                        delete programmes[ks[i]]
                    }
                    //console.log(lt, i, ks, programmes[ks[i]])
                } else {
                    if(programmes[ks[l]] && programmes[ks[l]].e >= parseInt(ks[i])){
                        let mt = parseInt(ks[i]) + parseInt((programmes[ks[l]].e - parseInt(ks[i])) / 2), mtn = String(mt + 1)
                        programmes[ks[l]].e = mt
                        programmes[mtn] = programmes[ks[i]]
                        delete programmes[ks[i]]
                        ks[i] = mtn                     
                    }
                    lt = programmes[ks[i]].t
                    //console.log(lt, i, ks, programmes[ks[i]])
                    l = i
                }
            }		
        }
        return programmes
    }
    save(){
        console.log('SAVING EPG DATA')
        Object.keys(this.data).forEach(c => {
            this.data[c] = this.normalizeChannelClock(this.data[c])
        })
        global.storage.set(this.key, this.data, 3 * this.ttl)
        global.storage.set(this.termsKey, this.terms, 3 * this.ttl)
        global.storage.set(this.channelsKey, this.channels, 3 * this.ttl)
    }
    clean(){
        Object.keys(this.terms).forEach(e => {
            if(typeof(this.data[e]) == 'undefined' || !Array.isArray(this.terms[e])){
                delete this.terms[e]
            }
        })
        Object.keys(this.channels).forEach(k => {
            if(typeof(this.data[this.channels[k].name]) == 'undefined'){
                delete this.channels[k]
            }
        })
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
    async terminate(){
        this.autoUpdateTimer && clearInterval(this.autoUpdateTimer)
        this.request && this.request.destroy()
        this.parser && this.parser.destroy()
        this.data = {}
        this.terms = {}
        this.removeAllListeners()
    }
}

module.exports = EPG