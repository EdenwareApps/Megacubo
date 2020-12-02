const xmltv = require('xmltv'), fs = require('fs'), Events = require('events')

class EPG extends Events {
    constructor(url){
        super()
        this.url = url
        this.key = 'epg-' + this.url
        this.termsKey = 'epg-terms-' + this.url
        this.fetchCtrlKey = 'epg-fetch-' + this.url
        this.data = {}
        this.terms = {}
        this.errorCount = 0
        this.errorCountLimit = 3
        this.acceptRanges = false
        this.bytesLength = -1
        this.transferred = 0
        this.loaded = false
        this.ttl = 72 * 3600
        this.state = 'uninitialized'
        this.start()
    }
    start(){
        if(!Object.keys(this.data).length){ // initialize
            this.state = 'loading'
            this.load().then(() => {
                // console.log('epg loaded', JSON.stringify(this.data))
                if(!this.loaded){
                    if(Object.keys(this.data).length){
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
            if(!Object.keys(this.data).length || !lastFetchedAt || lastFetchedAt < (this.time() - (this.ttl / 2))){
                if(!this.loaded){
                    this.state = 'connecting'
                }
                console.log('epg updating...')
                if(!this.parser){ // initialize
                    this.parser = new xmltv.Parser()
                    let i = 0
                    this.parser.on('programme', this.programme.bind(this))
                    this.parser.on('error', err => {
                        console.error(err)
                        return true
                    })
                    this.parser.on('end', this.save.bind(this))
                }
                const req = {
                    url: this.url,
                    followRedirect: true,
                    keepalive: false,
                    retries: 10,
                    headers: {}
                }
                this.request = new global.Download(req)
                this.request.on('error', err => {
                    console.warn(err)
                    return true
                })
                this.request.on('response', () => {
                    if(!this.loaded){
                        this.state = 'connected'
                    }
                })
                this.request.on('data', chunk => {
                    this.parser.write(chunk)
                })
                this.request.on('end', () => {
                    console.log('EPG REQUEST ENDED')
                    global.storage.set(this.fetchCtrlKey, now, this.ttl)
                    if(Object.keys(this.data).length){
                        this.state = 'loaded'
                        this.loaded = true
                        this.emit('load')
                    } else {
                        this.emit('error', 'Bad EPG format')
                    }
                })
            } else {
                console.log('epg update skipped')
            }
        })
    }
    prepareProgrammeData(programme, end){
        if(!end){
            end = this.time(programme.end)
        }
        return {e: end, t: programme.title.shift() || 'No title', c: programme.category || ''}
    }
    programme(programme){
        const now = this.time(), start = this.time(programme.start), end = this.time(programme.end)
        programme.channel = this.prepareChannelName(programme.channel)
        if(end >= now && end <= (now + this.ttl) && !this.hasProgramme(programme.channel, start)){
            this.indexate(programme.channel, start, this.prepareProgrammeData(programme, end))
        }
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
    get(channel, limit){
        if(typeof(this.data[channel.name]) == 'undefined'){
            channel.name = this.findChannel(channel.terms)
            if(!channel.name || typeof(this.data[channel.name]) == 'undefined'){
                return false
            }
        }
        return this.order(this.data[channel.name], limit)
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
        Object.keys(data).sort().forEach(start => {
            if(limit && data[start].e > now){
                ndata[start] = data[start]
                limit--
            }
        })
        return ndata
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
    search(terms){
        return new Promise((resolve, reject) => {
            let epgData = {}
            Object.keys(this.data).forEach(channel => {
                Object.keys(this.data[channel]).forEach(start => {
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
