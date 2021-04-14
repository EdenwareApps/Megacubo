const xmltv = require('xmltv'), fs = require('fs'), Events = require('events')

class EPG extends Events {
    constructor(url){
        super()
        this.debug = false
        this.url = url
        this.key = 'epg-' + this.url
        this.termsKey = 'epg-terms-' + this.url
        this.fetchCtrlKey = 'epg-fetch-' + this.url
        this.icons = {}
        this.data = {}
        this.terms = {}
        this.errorCount = 0
        this.errorCountLimit = 3
        this.acceptRanges = false
        this.bytesLength = -1
        this.transferred = 0
        this.loaded = false
        this.ttl = 72 * 3600
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
                if(!this.loaded){
                    this.state = 'connecting'
                }
                this.error = null
                console.log('epg updating...')
                if(!this.parser){ // initialize
                    this.parser = new xmltv.Parser()
                    let i = 0
                    this.parser.on('programme', this.programme.bind(this))
                    this.parser.on('channel', this.channel.bind(this))
                    this.parser.on('error', err => {
                        //console.error(err)
                        return true
                    })
                    this.parser.once('end', () => {
                        this.applyIcons()
                        this.save.bind(this)
                        this.request.destroy()
                        this.parser.destroy()
                        this.parser = null
                    })
                }
                let received = 0
                const req = {
                    debug: true,
                    url: this.url,
                    followRedirect: true,
                    keepalive: false,
                    retries: 5,
                    headers: {
                        'accept-charset': 'utf-8, *;q=0.1',
                        'range': 'bytes=0-'
                    }
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
                    // console.log('epg received', String(chunk))
                    this.parser.write(chunk)
                })
                this.request.once('end', () => {
                    console.log('EPG REQUEST ENDED', received, Object.keys(this.data).length)
                    global.storage.set(this.fetchCtrlKey, now, this.ttl)
                    if(Object.keys(this.data).length){
                        this.state = 'loaded'
                        this.loaded = true
                        this.emit('load')
                    } else {
                        this.state = 'error'
                        let errMessage = 'Bad EPG format'
                        this.error = errMessage
                        this.emit('error', errMessage)
                    }
                    if(this.parser){
                        this.parser.end()
                    }
                })
            } else {
                console.log('epg update skipped')
            }
        })
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
        let cid = channel.name || channel.displayName
        let name = channel.displayName || channel.name
        if(typeof(this.channels[cid]) == 'undefined'){
            this.channels[cid] = {name}
        }
        if(channel.icon){
            this.channels[cid].icon = channel.icon
        }
    }
    cidToDisplayName(cid){
        return typeof(this.channels[cid]) == 'undefined' ? cid : this.channels[cid].name
    }
    programme(programme){
        if(programme && programme.channel){
            const now = this.time(), start = this.time(programme.start), end = this.time(programme.end)
            programme.channel = this.prepareChannelName(this.cidToDisplayName(programme.channel))
            if(end >= now && end <= (now + this.ttl)){
                if(programme.icon){
                    [...new Set(programme.title)].forEach(t => {
                        if(programme.icon != this.icons[t]){
                            this.icons[t] = programme.icon
                        }
                    })
                }
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
                    let t = this.data[channel][start].t
                    if(this.icons[t]){
                        this.data[channel][start].i = this.icons[t]
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
                console.warn('CHANNEL CATEGORIES', channel, channel, categories)
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
    prepareChannelName(name){
        const badTerms = ['H.265', 'H.264', 'SD', 'HD', 'FHD', '2K', '4K', '8K']
        return name.split('[')[0].split(' ').filter(s => s && !badTerms.includes(s)).join(' ')
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
        if(channel.searchName && typeof(this.data[channel.searchName]) != 'undefined'){
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
        let results = {}
        Object.keys(this.terms).forEach(name => {
            let score = global.lists.match(terms, this.terms[name], true)
            if(score){
                results[name] = this.order(this.data[name], limit)
            }
        })
        return results
    }
    findChannel(terms){
        let score, current
        Object.keys(this.terms).forEach(name => {
            score = global.lists.match(terms, this.terms[name], true)
            if(score){
                if(!current || score > current.score){
                    current = {name, score}
                }
            }
        })
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
    search(terms, nowLive){
        return new Promise((resolve, reject) => {
            let epgData = {}, now = this.time()
            Object.keys(this.data).forEach(channel => {
                Object.keys(this.data[channel]).forEach(start => {
                    if(nowLive === true){
                        if(start > now || this.data[channel][start].e < now){
                            return
                        }
                    }
                    let pterms = global.lists.terms(this.data[channel][start].t)
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
    save(){
        console.log('SAVING EPG DATA')
        global.storage.set(this.key, this.data, 3 * this.ttl)
        global.storage.set(this.termsKey, this.terms, 3 * this.ttl)
    }
    destroy(){
        this.data = {}
        this.terms = {}
    }
}

module.exports = EPG
