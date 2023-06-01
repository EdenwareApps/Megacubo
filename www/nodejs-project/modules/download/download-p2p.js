const fs = require('fs')

class DownloadP2PStats {
    constructor(){
        this.ui = global.ui
        this.statsWindowSecs = 30
        this.peers = {}
        this._stats = {http: [], p2p: []}
        process.nextTick(() => {
            this.ui = global.ui
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
    }
}

class DownloadP2PHandler extends DownloadP2POptions {
    constructor(opts) {
        super()
        this.responders = {}
        this.opts = opts
        this.cache = opts.cache
        this.discovery = opts.discovery
        this.ui = opts.ui
        this.cache.on('update', index => {
            this.ui.emit('download-p2p-index-update', index)
        })
        this.cache.on('incoming-data', (uids, message) => {
            uids.forEach(uid => {
                this.ui.emit('download-p2p-response', Object.assign({uid}, message))
            })
        })
        this.ui.on('download-p2p-index-update', () => {
            this.ui.emit('download-p2p-index-update', this.cache.index)
        })
        this.discovery.on('found', () => {
            this.ui.emit(this.discovery.key, this.discovery.knownLists) // sync info to renderer, to respond faster on p2p lookups
        })
        this.ui.on(this.discovery.key, () => {
            this.ui.emit(this.discovery.key, this.discovery.knownLists)
        })
        this.ui.on('download-p2p-serve-request', this.serve.bind(this))
        this.ui.on('download-p2p-init', () => this.initializeClient())
        this.initializeClient()
    }
    initializeClient(){    
        const stunServers = global.config.get('p2p-stun-servers') 
        this.ui.emit('init-p2p', this.opts.addr, this.opts.limit, stunServers)
    }
    serve(data) {
        if(!data) return
        if('pause' == data.type){
            console.warn('P2P TRANSFER PAUSED', data, this.responders[data.uid])
            this.responders[data.uid] && this.responders[data.uid].pause()
        } else if('resume' == data.type){
            console.warn('P2P TRANSFER RESUMED', data, this.responders[data.uid])
            this.responders[data.uid] && this.responders[data.uid].resume()
        } else if('accept' == data.type) {
            const type = data.type, exists = typeof(this.cache.index[data.url]) != 'undefined'
            data.type = 'response'
            data.status = exists ? 200 : 404
            if(typeof(this.cache.index[data.url]) != 'undefined'){
                ['time', 'ttl', 'size'].forEach(p => data[p] = this.cache.index[data.url][p])
            }
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

module.exports = DownloadP2PHandler
