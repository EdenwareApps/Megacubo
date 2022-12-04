const fs = require('fs'), Events = require('events')

const CACHE_MEM_ONLY = false

class DownloadCacheChunksReader extends Events {
    constructor(master, opts){
        super()
        this.opts = opts || {}
        this.expectedLength = (this.opts.start && this.opts.end) ? (this.opts.end - this.opts.start + 1) : -1
        this.sent = 0 // bytes outputted for client
        this.processed = 0 // bytes processed from whole file, ignoring requested ranges
        this.freaden = 0 // bytes readen from cache file
        this.current = -1
        this.pending = []
        this.master = master
        this.master.chunks.forEach(c => {
            if(c.type == 'buffer' && c.data){
                this.pending.push({data: c.data, offset: c.start})
            }
        })
        this.masterDataListener = (data, offset) => {
            this.pending.push({data, offset})
            this.pump()
        }
        this.masterEndListener = () => {
            this.masterEnded = true
            this.master.removeListener('data', this.masterDataListener)
            this.master.removeListener('end', this.masterEndListener)
            this.pump()
        }
        this.master.on('data', this.masterDataListener)
        this.master.on('end', this.masterEndListener)
        this.stream = fs.createReadStream(this.master.file, this.opts)
        this.stream.on('data', chunk => {
            this.emitData(chunk, (this.opts.start || 0) + this.freaden)
            this.freaden += chunk.length
        })
        const end = err => {
            err && console.error(err)
            if(!this.masterEnded){
                this.masterEnded = this.master.ended
            }
            if(this.stream !== null){
                this.stream = null
                if(this.freaden){
                    this.processed = (this.opts.start || 0) + this.freaden
                }
                this.pump()
            }
        }
        this.stream.on('error', end)
        this.stream.once('end', end)
    }
    pause(){
        this.paused = true
        this.stream && this.stream.pause()
    }
    resume(){
        this.paused = false
        this.stream && this.stream.resume()
        this.pump()
    }
    emitData(data, offset){
        if(typeof(this.opts.start) == 'number'){
            let end, ignoreBytes = 0
            if(offset < this.opts.start){
                ignoreBytes = this.opts.start - offset
            }
            if(this.opts.end){
                if(this.opts.end < offset){
                    return false
                }
                const expectedEnd = (this.opts.end + 1) - offset
                if(expectedEnd < data.length){
                    end = expectedEnd
                }
            }
            if(ignoreBytes >= data.length || (end && ignoreBytes >= end)){
                return false
            }
            this.sent += end - ignoreBytes
            this.emit('data', data.slice(ignoreBytes, end))
            return true
        }
        this.sent += data.length
        this.emit('data', data)
    }
    pump(){
        if(this.stream || this.paused){
            return
        }
        this.pending.forEach((c, i) => {
            if(!c.data) return
            let len = c.data.length, start = c.offset, end = start + len
            if(this.processed < end){
                if(this.processed > start){
                    c.data = c.data.slice(this.processed - start)
                }
                this.emitData(c.data, this.processed)
                this.processed += len
                if(this.processed != end){
                    console.error('BAD pumping', this.processed, end)
                }
                delete this.pending[i].data
            }
        })
        const ended = this.masterEnded || (this.expectedLength >= 0 && this.sent >= this.expectedLength)
        if(ended){
            this.emit('end')
            this.pending = []
            this.removeAllListeners()
        }
    }
}

class DownloadCacheChunks extends Events {
    constructor(){
        super()
        this.setMaxListeners(99)
        this.uid = 'dcc-'+ parseInt(Math.random() * 10000000000000)
        this.file = global.storage.folder +'/dlcache/'+ this.uid
        this.chunks = []
        this.size = 0
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
        if(this.pumping) {
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
            fs.appendFile(this.file, Buffer.concat(chunks), {encoding: null}, err => {
                if(err){
                    console.error('DownloadCacheChunks.pump()', err)
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
        } else if(this.ended && !this.finished) {
            this.finished = true
            this.emit('finish')
        }
    }
    end(){
        this.ended = true
        this.pump()
    }
    createReadStream(opts){
        return new DownloadCacheChunksReader(this, opts)
    }
    destroy(){
        this.chunks = []
        this.removeAllListeners()
    }
}

class DownloadCacheMap extends Events {
    constructor(){
        super()
        this.index = {}
        this.minDiskAllocation = 100 * (1024 * 1024) // 100MB
        this.maxDiskAllocation = 1024 * (1024 * 1024) // 1GB
        this.maxMaintenanceInterval = 120
        this.folder = global.storage.folder +'/dlcache'
        this.indexFile = this.folder +'/index.json'
        this.tempnamIterator = 0
        this.start().catch(console.error).finally(() => {            
            this.emit('update', this.export())
            this.maintenance().catch(console.error)
        })
    }
    async reload(){
        const data = await this.readIndexFile()
        Object.keys(data).forEach(url => {
            if(typeof(this.index[url]) == 'undefined' || (this.index[url].ttl < data[url].ttl)){
                this.index[url] = data[url]
            }
        })
    }
    async readIndexFile(){
        let ret = {}
        try {
            let data = JSON.parse(await fs.promises.readFile(this.indexFile, {encoding: null}))
            ret = data            
        } catch(e) {
            console.error(e)
        }
        return ret
    }
    async start(){
        if(this.started) return
        this.started = true
        let caches = await fs.promises.readdir(this.folder).catch(console.error)
        if(Array.isArray(caches)){
            caches = caches.map(f => this.folder +'/'+ f)
        } else {
            caches = []
        }
        if(caches.includes(this.indexFile)){
            await this.reload()
            Object.keys(this.index).forEach(url => {
                const file = String(this.index[url].data)
                if(!caches.includes(file)){ // cache file missing
                    delete this.index[url]
                }
            })
            if(global.ui){
                const indexFiles = Object.values(this.index).map(r => String(r.data))
                caches.forEach(file => {
                    if(!indexFiles.includes(file) && file != this.indexFile){
                        fs.promises.unlink(file).catch(console.error)
                    }
                })
            }
        } else if(caches.length) { // index file missing
            this.truncate()
        } else {
            await fs.promises.mkdir(this.folder, {recursive: true})
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
            console.warn('DLCACHE truncate', global.traceback())
            this.index = {}
            global.rmdir && global.rmdir(this.folder, false, () => {})        
            this.emit('update', this.export())
        }
    }
    async maintenance(now){
        if(!global.diagnostics) return
        let nextRun = 0, diskUsage = 0
        if(!now){
            now = global.time()
        }
        const nfo = await global.diagnostics.checkDisk()
        // use 10% of free space, limited to 1GB, at least 100MB
        this.maxDiskUsage = Math.min(Math.max(nfo.free / 10, this.minDiskAllocation), this.maxDiskAllocation)
        const expired = Object.keys(this.index).map(url => {
            return {
                ttl: this.index[url].ttl,
                url
            }
        }).sortByProp('ttl', true).filter(row => {
            if(now > row.ttl){
                console.warn('DLCACHE expired', row, row.ttl +' < '+ now)
                return true // expired
            }
            diskUsage += this.index[row.url].size
            if(diskUsage >= this.maxDiskUsage){
                console.warn('DLCACHE freed', row, diskUsage)
                return true // freeup
            }
            if(nextRun <= 0 || nextRun > this.index[row.url].ttl) {
                nextRun = this.index[row.url].ttl + 1
            }
        })
        if(expired.length){
            expired.forEach(row => {
                if(this.index[row.url].type == 'file'){
                    fs.promises.unlink(this.index[row.url].data).catch(console.error)
                }
                delete this.index[row.url]
            })   
            this.emit('update', this.export())
        }
        const findex = {}
        Object.keys(this.index).forEach(url => {
            if(this.index[url].type == 'file'){
                findex[url] = this.index[url]
            }
        })
        fs.promises.writeFile(this.indexFile, JSON.stringify(findex)).catch(console.error)
        if(nextRun){
            if(this.maintenanceTimer){
                clearTimeout(this.maintenanceTimer)
            }
            this.maintenanceTimer = setTimeout(() => this.maintenance().catch(console.error), Math.min(this.maxMaintenanceInterval, nextRun - now) * 1000)
        }
    }
    save(downloader, chunk, ended){
        const opts = downloader.opts
        const url = downloader.currentURL
        if(typeof(this.index[url]) == 'undefined') {
            if(downloader.requestingRange && 
                (downloader.requestingRange.start > 0 || 
                    (downloader.requestingRange.end && downloader.requestingRange.end < (downloader.totalContentLength - 1))
                )
            ){ // partial content request, skip saving
                return
            }
            const time = global.time()
            let ttl = time + opts.cacheTTL
            if(downloader.lastHeadersReceived && typeof(downloader.lastHeadersReceived['x-cache-ttl']) != 'undefined') {
                const rttl = parseInt(downloader.lastHeadersReceived['x-cache-ttl'])
                if(rttl < ttl) {
                    ttl = rttl
                }
            }
            const headers = downloader.lastHeadersReceived ? Object.assign({}, downloader.lastHeadersReceived) : {}
            const chunks = new DownloadCacheChunks()
            this.index[url] = {
                type: 'saving',
                chunks,
                time,
                ttl,
                status: downloader.lastStatusCodeReceived,
                size: headers['content-length'] || false,
                headers,
                uid: opts.uid
            }
            this.emit('update', this.export())
        }
        if(this.index[url] && this.index[url].type == 'saving' && this.index[url].uid == opts.uid) {
            let hasErr
            if(chunk){
                this.index[url].size = this.index[url].chunks.size
                this.index[url].chunks.push(chunk)
                chunk = null // freeup
            }
            if(ended) {
                const finish = () => {
                    if(!this.index[url] || this.index[url].type != 'saving'){
                        return
                    }
                    if(this.index[url].chunks.size < this.index[url].size) {
                        hasErr = 'Bad file size. Expected: '+ this.index[url].size +', received: '+ this.index[url].chunks.size +', discarding http cache.'
                        this.index[url].chunks.destroy()
                        delete this.index[url].chunks
                        delete this.index[url]
                    } else {
                        if(CACHE_MEM_ONLY){
                            this.index[url].size = this.index[url].chunks.size
                            this.index[url].chunks.end()
                        } else {
                            this.index[url].size = this.index[url].chunks.size
                            this.index[url].data = this.index[url].chunks.file
                            this.index[url].type = 'file'
                            this.index[url].chunks.destroy()
                            delete this.index[url].chunks
                        }
                    }
                }
                if(this.index[url].chunks.finished){
                    finish()
                } else {
                    this.index[url].chunks.on('finish', finish)
                }
                this.index[url].chunks.end()
            }
        }
    }
}

module.exports = DownloadCacheMap
