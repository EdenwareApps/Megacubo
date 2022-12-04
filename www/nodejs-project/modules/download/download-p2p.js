const fs = require('fs')

class DownloadP2PStats {
    constructor(){
        this.statsWindowSecs = 30
        this.peers = {}
        this._stats = {http: [], p2p: []}
        process.nextTick(() => {
            this.ui.on('download-p2p-peers', peers => {
                this.peers = peers
            })
        })
    }
    addStats(type, size){
        if(!this._stats[type]) return
        const now = global.time()
        this.trimStats(now)
        this._stats[type].push({
            time: now,
            size
        })
    }
    trimStats(now){
        ['http', 'p2p'].forEach(type => {
            this._stats[type] = this._stats[type].filter(r => {
                return (r.time + this.statsWindowSecs) > now
            })
        })
    }
    stats(){
        const now = global.time(), totalSizes = {http: 0, p2p: 0}
        this.trimStats(now);
        ['http', 'p2p'].forEach(type => {
            this._stats[type].forEach(r => {
                if((r.time + this.statsWindowSecs) > now){
                    totalSizes[type] += r.size
                }
            })
        })
        totalSizes.total = totalSizes.http + totalSizes.p2p
        const pp = totalSizes.total / 100
        return {
            total: totalSizes.total,
            http: {
                percent: pp && totalSizes.http ? totalSizes.http / pp : 0,
                bytes: totalSizes.http
            },
            p2p: {
                percent: pp && totalSizes.p2p ? totalSizes.p2p / pp : 0,
                bytes: totalSizes.p2p
            }
        }
    }
}

class DownloadP2POptions extends DownloadP2PStats {
    constructor() {
        super()
        this.showing = false
        this.osdID = 'p2p-debug'
        this.fa = 'fas fa-users'
        process.nextTick(() => {            
            global.explorer.addFilter(this.hook.bind(this))
        })
    }
    message(){
        const stats = this.stats()
        return 'P2P usage: {0}% &middot; {1} peers'.format(parseInt(stats.p2p.percent), Object.keys(this.peers).length)
    }
    show(){
        this.showing = setInterval(() => {
            const message = this.message()
            if(message == this.lastMessage) return
            this.lastMessage = message
            global.osd.show(message, this.fa, this.osdID, 'persistent')
        }, 1000)
    }
    hide(){
        this.showing && clearInterval(this.showing)
        global.osd.hide(this.osdID)
    }
    async hook(entries, path){
        if(path == global.lang.OPTIONS +'/'+ global.lang.ADVANCED){
            entries.push(this.entry())
        }
        return entries
    }
    entry(){
        return {
            name: 'P2P',
            fa: this.fa,
            type: 'group',
            renderer: this.entries.bind(this)
        }
    }
    async entries(){
        return [
            {
                name: 'Allow P2P',
                type: 'check',
                action: (e, checked) => {
                    global.config.set('p2p', checked)
                    global.osd.show(lang.SHOULD_RESTART, 'fas fa-exclamation-circle faclr-red', 'restart', 'normal')
                }, 
                checked: () => {
                    return global.config.get('p2p')
                }
            },
            {
                name: 'Debug P2P',
                type: 'check',
                action: (e, checked) => {
                    if(checked){
                        this.show()
                    } else {
                        this.hide()
                    }
                }, 
                checked: () => {
                    return this.showing
                }
            }
        ]
    }
}

class DownloadP2PHandler extends DownloadP2POptions {
    constructor(ui, cache) {
        super()
        this.responders = {}
        this.cache = cache
        this.ui = ui
        this.cache.on('update', ndx => {
            this.ui.emit('download-p2p-index-update', ndx)
        })
        this.cache.on('incoming-data', (uids, message) => {
            uids.forEach(uid => {
                this.ui.emit('download-p2p-response', Object.assign({uid}, message))
            })
        })
        this.ui.on('download-p2p-serve-request', this.serve.bind(this))
    }
    serve(data) {
        if(!data) return
        if('pause' == data.type){
            console.warn('P2P TRANSFER PAUSED', data, this.responders[data.uid])
            this.responders[data.uid] && this.responders[data.uid].pause()
        } else if('resume' == data.type){
            console.warn('P2P TRANSFER RESUMED', data, this.responders[data.uid])
            this.responders[data.uid] && this.responders[data.uid].resume()
        } else if(['accept', 'request'].includes(data.type)){
            const type = data.type, exists = typeof(this.cache.index[data.url]) != 'undefined'
            data.type = 'response'
            data.status = exists ? 200 : 404
            if(typeof(this.cache.index[data.url]) != 'undefined'){
                ['time', 'ttl', 'size'].forEach(p => data[p] = this.cache.index[data.url][p])
            }
            if(type == 'request') {
                this.ui.emit('download-p2p-response', data)
            } else if(type == 'accept') {
                if(exists){
                    let stream, sent = 0
                    const reqRange = data.range || {}
                    switch(this.cache.index[data.url].type) {
                        case 'saving':
                            stream = global.Download.cache.index[data.url].chunks.createReadStream(reqRange)
                            break
                        case 'file':
                            const dopts = {
                                highWaterMark: 32 * 1024,
                                encoding: null
                            }
                            if(reqRange){
                                if(reqRange.start) dopts.start = reqRange.start
                                if(reqRange.end) dopts.end = reqRange.end
                            }
                            stream = fs.createReadStream(this.cache.index[data.url].data, dopts)
                            break
                    }
                    this.responders[data.uid] = stream
                    stream.on('data', chunk => {
                        const ndata = Object.assign({}, data)
                        ndata.data = chunk
                        ndata.range = {start: sent, end: sent + ndata.data.length}
                        sent += ndata.data.length
                        this.ui.emit('download-p2p-response', ndata)
                    })
                    stream.once('end', () => {
                        const ndata = Object.assign({}, data)
                        ndata.ended = true
                        this.ui.emit('download-p2p-response', ndata)
                    })
                    stream.on('error', err => {
                        const ndata = Object.assign({}, data)
                        ndata.error = String(err)
                        ndata.ended = true
                        this.ui.emit('download-p2p-response', ndata)
                    })
                } else {
                    data.error = 'Not found'
                    data.ended = true
                    this.ui.emit('download-p2p-response', data)
                }
            }
        }
    }
}

module.exports = DownloadP2PHandler
