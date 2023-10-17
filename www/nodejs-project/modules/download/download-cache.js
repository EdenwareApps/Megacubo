const fs = require('fs'), Events = require('events'), Reader = require('../reader')

const CACHE_MEM_ONLY = false

class DownloadCacheFileReader extends Events {
    constructor(master, opts){
        super()
        this.file = master.file
        this.opts = opts
        this.opts.persistent = !master.finished
        master.once('finish', () => {
            this.opts.persistent = false
            this.stream && this.stream.endPersistence()
        })
        this.on('error', console.error)
        process.nextTick(() => this.init())
    }
    init(){
        this.stream = new Reader(this.file, this.opts);
        ['data', 'end', 'error', 'finish', 'close'].forEach(n => this.forward(n))
    }
    forward(name){
        this.stream.on(name, (...args) => this.emit(name, ...args))
    }
    destroy(){
        this.emit('close')
        this.emit('finish')
        this.removeAllListeners()
        this.stream && this.stream.close && this.stream.close()
    }
}

/*
Cache saver to disk which allows to read it even while saving, with createReadStream()
*/
class DownloadCacheChunks extends Events {
    constructor(url){
        super()
        this.setMaxListeners(99)
        this.folder = global.storage.folder +'/dlcache/'
        this.uid = 'dcc-'+ url.replace(new RegExp('^https?://'), '').replace(new RegExp('[^A-Za-z0-9]+', 'g'), '-').substr(0, 260 - (this.folder.length + 4))
        this.file = this.folder + this.uid + '.bin'
        this.chunks = []
        this.size = 0
        this.created = false
    }
    push(chunk){
        this.emit('data', chunk, this.size) 
        this.chunks.push({
            type: 'buffer',
            data: chunk,
            start: this.size,
            length: chunk.length
        })
        this.size += chunk.length
        this.pump()
    }
    pump(){
        if(this.finished || this.pumping) {
            return
        }
        let chunks = this.chunks.filter((c, i) => {
            if(c.type == 'buffer'){
                this.chunks[i].writing = true
                return true
            }
        }).map(c => c.data)
        if(chunks.length && !CACHE_MEM_ONLY){
            this.pumping = true
            const next = () => {
                fs.appendFile(this.file, Buffer.concat(chunks), {encoding: null}, err => {
                    if(err){
                        return this.fail(err)
                    }
                    this.chunks.filter((c, i) => {
                        if(c.type == 'buffer' && c.writing == true){
                            this.chunks[i].type = 'file'
                            this.chunks[i].data = null
                            delete this.chunks[i].writing
                        }
                    })
                    this.pumping = false
                    this.pump()
                })
            }
            if(this.created) {
                next()
            } else {
                this.created = true
                fs.writeFile(this.file, '', { flag: 'wx'}, next)
            }
        } else if(this.ended && !this.finished) {
            this.finished = true
            this.emit('finish')
        }
    }
    finish(){
        if(!this.finished) {
            this.finished = true
            this.emit('finish')
        }
    }
    fail(err){
        this.emit('error', err)
        this.end()
        this.finish()
        this.destroy()
    }
    end(){
        this.ended = true // before pump()
        this.pump()
    }
    createReadStream(opts={}){
        return new DownloadCacheFileReader(this, opts)
    }
    destroy(){
        this.chunks = []
        this.finish()
        this.removeAllListeners()
    }
}

class DownloadCacheMap extends Events {
    constructor(){
        super()
        this.index = {}
        this.debug = false
        this.maxDiskUsage = 512 * (1024 * 1024) // 512MB
        this.maxMaintenanceInterval = 60
        this.folder = global.storage.folder +'/dlcache'
        this.indexFile = this.folder +'/index.json'
        this.tempnamIterator = 0
        this.start().catch(console.error).finally(() => {
            this.emit('update', this.export())
            setTimeout(() => {
                this.maintenance().catch(console.error)
            }, 15000) // delay a bit for performance
        })
    }
    async reload(){
        const data = await this.readIndexFile()
        if(typeof(data) == 'object'){
            Object.keys(data).forEach(url => {
                if(typeof(this.index[url]) == 'undefined' || (this.index[url].ttl < data[url].ttl)){
                    this.index[url] = data[url]
                }
            })
        }
    }
    async readIndexFile(){
        let hasErr, ret = {}
        await fs.promises.access(this.indexFile, fs.constants.R_OK).catch(e => hasErr = e)
        if(hasErr) return ret
        try {
            let data = await fs.promises.readFile(this.indexFile, {encoding: null})
            data = global.parseJSON(data)
            ret = data            
        } catch(e) {
            console.error(e)
        }
        return ret
    }
    async start(){
        if(this.started) return
        this.started = true
        await fs.promises.mkdir(this.folder, {recursive: true}).catch(console.error)
        let caches = await fs.promises.readdir(this.folder).catch(console.error)
        if(Array.isArray(caches)){
            caches = caches.map(f => this.folder +'/'+ f)
        } else {
            caches = []
        }
        if(caches.includes(this.indexFile)){
            let changed
            await this.reload()
            Object.keys(this.index).forEach(url => {
                const file = String(this.index[url].data)
                if(!caches.includes(file) && this.index[url].type == 'file' && this.index[url].size > 0){
                    if(!changed) changed = true
                    if(this.debug){
                        console.warn('DLCACHE RM file missing')
                    }
                    delete this.index[url] // cache file missing
                }
            })
            if(global.ui){
                const indexFiles = Object.values(this.index).map(r => String(r.data))
                caches.forEach(file => {
                    if(!indexFiles.includes(file) && file != this.indexFile){
                        if(this.debug){
                            console.warn('DLCACHE RM orphaned file', file, Object.values(this.index).filter(r => r.type == 'file').map(r => String(r.data)))
                        }
                        fs.promises.unlink(file).catch(console.error)
                    }
                })
            }
            if(this.debug){
                console.warn('DLCACHE RM result', Object.keys(this.index))
            }
            this.emit('update', this.export())
        } else if(caches.length) { // index file missing
            this.truncate()
        }
    }
    export(){
        const ndx = {}, now = global.time()
        Object.keys(this.index).forEach(k => {
            if(now > (this.index[k].ttl - 10)) {
                delete this.index[k]
            } else {
                const v = {};
                ['time', 'ttl', 'size'].forEach(p => v[p] = this.index[k][p])
                ndx[k] = v
            }
        })
        return ndx
    }
    truncate(){
        if(Object.keys(this.index).length){
            if(this.debug){
                console.warn('DLCACHE RM truncate', global.traceback())
            }
            this.index = {}
            global.rmdir && global.rmdir(this.folder, false, () => {})
            this.emit('update', this.export())
        }
    }
    async maintenance(now){
        let expired = [], nextRun = 0, diskUsage = 0
        await this.reload()
        if(!now){
            now = global.time()
        }
        expired = Object.keys(this.index).map(url => {
            return {
                ttl: this.index[url].ttl,
                url
            }
        }).sortByProp('ttl', true).filter(row => {
            if(now > row.ttl) {
                return true // expired
            }
            diskUsage += this.index[row.url].size
            if(diskUsage >= this.maxDiskUsage) {
                return true // freeup
            }
            if(nextRun <= 0 || nextRun > this.index[row.url].ttl) {
                nextRun = this.index[row.url].ttl + 1
            }
        })
        if(expired.length){
            if(this.debug){
                console.warn('DLCACHE RM expired', expired)
            }
            for(let row of expired){
                if(this.index[row.url].type == 'file'){
                    fs.promises.unlink(this.index[row.url].data).catch(() => {})
                }
                delete this.index[row.url]
            }
            this.emit('update', this.export())
        }
        await this.saveIndex().catch(console.error)
        let ms = -1
        if(nextRun && nextRun >= now){
            ms = nextRun - now
        }
        if(ms < 0 || ms > this.maxMaintenanceInterval){
            ms = this.maxMaintenanceInterval
        }
        ms *= 1000
        this.maintenanceTimer && clearTimeout(this.maintenanceTimer)
        if(this.debug){
            console.warn('DLCACHE maintenance', ms)
        }
        this.maintenanceTimer = setTimeout(() => this.maintenance().catch(console.error), ms)
    }
    async saveIndex(){
        const findex = {}
        Object.keys(this.index).forEach(url => {
            if(this.index[url].type == 'file'){
                findex[url] = this.index[url]
            }
        })
        await fs.promises.writeFile(this.indexFile, JSON.stringify(findex)).catch(console.error)
    }
    save(downloader, chunk, ended){
        const opts = downloader.opts
        const url = downloader.currentURL
        if(!global.config.get('in-disk-caching')) return
        if(downloader.requestingRange && 
            (downloader.requestingRange.start > 0 || 
                (downloader.requestingRange.end && downloader.requestingRange.end < (downloader.totalContentLength - 1))
            )
        ){ // partial content request, skip saving
            return
        }
        if(typeof(this.index[url]) == 'undefined') {
            const time = parseInt(global.time())
            let ttl = time + opts.cacheTTL
            if(downloader.lastHeadersReceived && typeof(downloader.lastHeadersReceived['x-cache-ttl']) != 'undefined') {
                const rttl = parseInt(downloader.lastHeadersReceived['x-cache-ttl'])
                if(rttl < ttl) {
                    ttl = rttl
                }
            }
            const headers = downloader.lastHeadersReceived ? Object.assign({}, downloader.lastHeadersReceived) : {}
            const chunks = new DownloadCacheChunks(url)
            chunks.on('error', err => console.error('DownloadCacheChunks error: '+ err))
            if(headers['content-encoding']) {
                delete headers['content-encoding'] // already uncompressed
                if(headers['content-length']) {
                    delete headers['content-length'] // length uncompressed is unknown
                }
            }
            this.index[url] = {
                type: 'saving',
                chunks,
                time,
                ttl,
                status: downloader.lastStatusCodeReceived,
                size: headers['content-length'] || false,
                headers,
                uid: opts.uid,
                traceback: [opts, opts.cacheTTL, global.traceback()]
            }
            this.emit('update', this.export())
        }
        if(this.index[url] && this.index[url].type == 'saving' && this.index[url].uid == opts.uid) {
            if(chunk){
                this.index[url].chunks.push(chunk)
                chunk = null // freeup
            }
            if(ended) {
                const chunks = this.index[url].chunks
                const finish = () => {
                    if(!this.index[url] || this.index[url].type != 'saving') return
                    const expectedLength = this.index[url].size === false ? downloader.totalContentLength : chunks.size
                    if(chunks.error) {
                        console.warn(chunks.error)
                        chunks.destroy()
                        delete this.index[url].chunks
                        delete this.index[url]
                    } else if((this.index[url].size === false && !expectedLength) || (expectedLength != chunks.size)) {
                        console.warn('Bad file size. Expected: '+ this.index[url].size +', received: '+ chunks.size +', discarding http cache.')
                        chunks.destroy()
                        delete this.index[url].chunks
                        delete this.index[url]
                    } else if(downloader.statusCode < 200 || downloader.statusCode > 400 || (downloader.errors.length && !downloader.received)) {
                        console.warn('Bad download. Status: '+ downloader.statusCode +', received: '+ chunks.size, downloader.errors, downloader.received)
                        chunks.destroy()
                        delete this.index[url].chunks
                        delete this.index[url]
                    } else {
                        if(!this.index[url].status){
                            this.index[url].status = downloader.statusCode
                        }
                        if(CACHE_MEM_ONLY){
                            this.index[url].headers['content-length'] = this.index[url].size = chunks.size
                            chunks.end()
                        } else {
                            this.index[url].headers['content-length'] = this.index[url].size = chunks.size
                            this.index[url].data = chunks.file
                            this.index[url].type = 'file'
                            chunks.destroy()
                            delete this.index[url].chunks
                        }
                    }
                }
                if(chunks.finished){
                    finish()
                } else {
                    chunks.on('finish', finish)
                }
                chunks.end()
            }
        }
    }
}

module.exports = DownloadCacheMap
