const xmltv = require('xmltv'), fs = require('fs'), Events = require('events')

class EPG extends Events {
    constructor(url){
        super()
        this.debug = false
        this.url = url
        this.key = 'epg-' + this.url
        this.termsKey = 'epg-terms-' + this.url
        this.channelsKey = 'epg-channels-' + this.url
        this.fetchCtrlKey = 'epg-fetch-' + this.url
        this.iconsInfo = {}
        this.data = {}
        this.terms = {}
        this.errorCount = 0
        this.errorCountLimit = 3
        this.acceptRanges = false
        this.bytesLength = -1
        this.transferred = 0
        this.loaded = false
        this.ttl = 6 * 3600
        this.autoUpdateInterval = 3600
        this.minExpectedEntries = 72
        this.state = 'uninitialized'
        this.error = null
        this.channels = {}
        this.start()
    }
    start(){
        if(!Object.keys(this.data).length){ // initialize
            this.state = 'loading'
            this.load().then(() => {
                console.log('epg loaded', Object.keys(this.data).length)
                if(!this.loaded){
                    if(Object.keys(this.data).length >= this.minExpectedEntries){
                        this.state = 'loaded'
                        this.loaded = true
                        this.emit('load')
                    }
                }
            }).catch(err => {
                console.error(err)
            }).finally(this.update.bind(this))
        }
    }
    update(){
        storage.get(this.fetchCtrlKey, lastFetchedAt => {
            const now = this.time()
            if(Object.keys(this.data).length < this.minExpectedEntries || !lastFetchedAt || lastFetchedAt < (this.time() - (this.ttl / 2))){
                if(this.request || this.parser){
                    console.error('already updating')
                    return
                }
                if(!this.loaded){
                    this.state = 'connecting'
                }
                let errorCount = 0, failed, hasErr, initialBuffer = []
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
                    console.error('EPG FAILED DEBUG', initialBuffer)
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
                        this.emit('error', global.lang.EPG_BAD_FORMAT)
                        this.scheduleNextUpdate(30)
                    }
                    return true
                })
                this.parser.once('end', () => {
                    console.log('EPG PARSER END')
                    this.applyIcons()
                    this.clean()
                    this.save()
                    this.parser.destroy() 
                    this.parser = null                                
                    this.scheduleNextUpdate()
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
                    encoding: 'utf8'
                }
                this.request = new global.Download(req)
                this.request.on('error', err => {
                    console.warn(err)
                    return true
                })
                this.request.once('response', () => {
                    if(!this.loaded){
                        this.state = 'connected'
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
                    global.storage.set(this.fetchCtrlKey, now, this.ttl)
                    if(Object.keys(this.data).length){
                        this.state = 'loaded'
                        this.loaded = true
                        this.emit('load')
                    } else {
                        this.state = 'error'
                        this.error = validEPG ? global.lang.EPG_OUTDATED : global.lang.EPG_BAD_FORMAT
                        this.emit('error', this.error)
                    }
                    if(this.parser){
                        this.parser.end()
                    }
                })
                this.request.start()
            } else {
                console.log('epg update skipped')
                this.scheduleNextUpdate()
                this.clean()
            }
        })
    }
    scheduleNextUpdate(time){        
        if(this.autoUpdateTimer){
            clearTimeout(this.autoUpdateTimer)
        }
        if(typeof(time) != 'number'){
            time = this.autoUpdateInterval
        }
        this.autoUpdateTimer = setTimeout(() => this.update(), time * 1000)
    }
    forceUpdate(){        
        this.data = {}
        this.terms = {}
        this.loaded = false
        this.update()
    }
    prepareProgrammeData(programme, end){
        if(!end){
            end = this.time(programme.end)
        }
        return {e: end, t: programme.title.shift() || 'No title', c: programme.category || '', i: programme.icon || ''}
    }
    channel(channel){
        let name = channel.displayName || channel.name;
        [channel.id, channel.name || channel.displayName].forEach(cid => {
            if(typeof(this.channels[cid]) == 'undefined'){
                this.channels[cid] = {name}
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
            programme.channel = this.prepareChannelName(this.cidToDisplayName(programme.channel))
            if(end >= now && end <= (now + this.ttl)){
                if(!this.hasProgramme(programme.channel, start)){
                    this.indexate(programme.channel, start, this.prepareProgrammeData(programme, end))
                }
            }
        }
    }
    applyIcons(){
        Object.keys(this.data).forEach(channel => {
            Object.keys(this.data[channel]).forEach(start => {
                if(!this.data[channel][start].i){
                    let t = this.data[channel][start].t.toLowerCase()
                    if(this.iconsInfo[t]){
                        let bestIcon
                        Object.keys(this.iconsInfo[t]).forEach(src => {
                            if(!src) return
                            if(!bestIcon){
                                bestIcon = src
                            } else {
                                if(this.iconsInfo[t][src] > this.iconsInfo[t][bestIcon]){
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
    channelsList(){
        let already = [], data = {}, maxCategoriesCount = 3
        Object.keys(this.data).forEach(channel => {
            let lcname = channel.toLowerCase()
            if(!already.includes(lcname)){
                already.push(lcname)
                let max, categories = {}
                Object.keys(this.data[channel]).forEach(start => {
                    if(Array.isArray(this.data[channel][start].c)){
                        this.data[channel][start].c.forEach(category => {
                            if(category.indexOf('/') != -1){
                                category = category.replaceAll('/', ' ')
                            }
                            if(typeof(categories[category]) == 'undefined'){
                                categories[category] = 0
                            }
                            categories[category]++
                        })
                    }
                })
                categories = Object.fromEntries(Object.entries(categories).sort(([,a],[,b]) => b-a))
                categories = Object.keys(categories).slice(0, maxCategoriesCount).filter(c => {
                    if(!max){
                        max = categories[c]
                        return true
                    }
                    return categories[c] >= (max / 2)
                })
                categories.forEach(c => {
                    if(typeof(data[c]) == 'undefined'){
                        data[c] = []
                    }
                    data[c].push(channel)
                })
            }
        })
        return data
    }
    liveNowChannelsList(){
        let already = [], categories = {}, now = this.time(), updateAfter = 600
        Object.keys(this.data).forEach(channel => {
            let lcname = channel.toLowerCase()
            if(!already.includes(lcname)){
                already.push(lcname)
                Object.keys(this.data[channel]).some(start => {
                    if(this.data[channel][start].e > now && parseInt(start) <= now){
                        if(Array.isArray(this.data[channel][start].c)){
                            this.data[channel][start].c.forEach(category => {
                                if(category.indexOf('/') != -1){
                                    category = category.replaceAll('/', ' ')
                                }
                                if(typeof(categories[category]) == 'undefined'){
                                    categories[category] = []
                                }
                                if(!categories[category].includes(channel)){
                                    categories[category].push(channel)
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
            }
        })
        return {categories, updateAfter}
    }
    prepareChannelName(name){
        return name

        //const badTerms = ['H.265', 'H.264', 'SD', 'HD', 'FHD', '2K', '4K', '8K']
        //return name.split('[')[0].split(' ').filter(s => s && !badTerms.includes(s)).join(' ')
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
        if(typeof(this.terms[channel]) == 'undefined'){
            this.terms[channel] = global.lists.terms(channel)
        }
        if(data.i){
            let t = data.t.toLowerCase()
            if(typeof(this.iconsInfo[t]) == 'undefined'){
                this.iconsInfo[t] = {}
            }
            if(typeof(this.iconsInfo[t][data.i]) == 'undefined'){
                this.iconsInfo[t][data.i] = 1
            } else {
                this.iconsInfo[t][data.i]++
            }
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
    get(channel, limit){
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
            let n = this.findChannel(this.extractTerms(channel))
            //console.log('EPGGETCHANNEL', n)
            if(n && typeof(this.data[n]) != 'undefined'){
                data = this.data[n]
            } else {
                return false
            }
        }
        //console.log('EPGGETCHANNEL', data)
        return this.order(data, limit)
    }
    getMulti(channelsList, limit){
        let results = {}
        channelsList.forEach(ch => {
            results[ch.name] = this.get(ch, limit)
        })
        return results
    }
    order(data, limit){
        let ndata = {}, now = this.time()
        Object.keys(data).sort((a, b) => a - b).forEach(start => {
            if(limit && data[start].e > now){
                ndata[start] = data[start]
                limit--
            }
        })
        return ndata
    }
    searchChannel(terms, limit=2){
        let results = {}, data = []
        Object.keys(this.terms).forEach(name => {
            let score = this.terms[name].filter(t => terms.includes(t)).length
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
    searchChannelIcon(terms){
        let score, results = []
        Object.keys(this.terms).forEach(name => {
            if(typeof(this.channels[name]) != 'undefined' && this.channels[name].icon){
                score = global.lists.match(terms, this.terms[name], true)
                if(score){
                    results.push(this.channels[name].icon)       
                }
            }
        })
        return [...new Set(results)]
    }
    findChannel(terms){
        let score, current
        Object.keys(this.terms).forEach(name => {
            score = global.lists.match(terms, this.terms[name], false)
            if(score){
                if(!current || score > current.score){
                    current = {name, score}
                }
            }
        })
        if(!current){
            Object.keys(this.terms).forEach(name => {
                score = global.lists.match(this.terms[name], terms, false)
                if(score){
                    if(!current || score > current.score){
                        current = {name, score}
                    }
                }
            })
        }
        return current ? current.name : false
    }
    findChannelLog(terms){
        return new Promise((resolve, reject) => {
            let score, current, log = [terms]
            Object.keys(this.terms).forEach(name => {
                score = global.lists.match(terms, this.terms[name], true)
                if(score){
                    log.push({name, terms: this.terms[name], score})
                    if(!current || score > current.score){
                        current = {name, score}
                    }
                }
            })
            if(current){
                log.push(current)
            }
            resolve(log)
        })
    }
    search(terms, nowLive, includeCategories){
        return new Promise((resolve, reject) => {
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
                    let pterms = global.lists.terms(t)
                    if(global.lists.match(terms, pterms, true)){
                        if(typeof(epgData[channel]) == 'undefined'){
                            epgData[channel] = {}
                        }
                        epgData[channel][start] = this.data[channel][start]
                    }
                })
            })
            resolve(epgData)
        })
    }
    load(){
        return new Promise((resolve, reject) => {
            global.storage.get(this.key, data => {
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
                    global.storage.get(this.channelsKey, data => {
                        if(data){
                            Object.keys(data).forEach(name => {
                                if(typeof(this.channels[name]) == 'undefined'){
                                    this.channels[name] = {name}
                                }
                            })
                        }
                    })
                    global.storage.get(this.termsKey, data => {
                        if(data){
                            Object.keys(data).forEach(name => {
                                if(typeof(this.terms[name]) == 'undefined'){
                                    this.terms[name] = data[name]
                                }
                            })
                            resolve(true)
                        } else {
                            reject('no epg terms loaded')
                        }
                    })
                } else {
                    reject('no epg current data loaded')
                }
            })
        })
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
    clean(){
        Object.keys(this.terms).forEach(e => {
            if(typeof(this.data[e]) == 'undefined'){
                delete this.terms[e]
            }
        })
        Object.keys(this.channels).forEach(k => {
            if(typeof(this.data[this.channels[k].name]) == 'undefined'){
                delete this.channels[k]
            }
        })
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
    destroy(){
        if(this.request) this.request.destroy()
        if(this.parser) this.parser.destroy()
        this.data = {}
        this.terms = {}
    }
}

module.exports = EPG