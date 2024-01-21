const fs = require('fs'), Events = require('events'), Reader = require('../reader')

const url2id = (url, folder) => {
    return 'dlc-'+ url.replace(new RegExp('^https?://'), '').replace(new RegExp('[^A-Za-z0-9]+', 'g'), '-').substr(0, 260 - (folder.length + 4))
}

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
        master.once('error', err => {
            this.emit('error', err)
            this.destroy()
        })
        this.once('close', () => this.destroy())
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
        if(this.destroyed) return
        this.destroyed = true
        this.emit('end')
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
        this.folder = global.storage.folder +'/'
        this.uid = url2id(url, this.folder)
        this.file = global.storage.resolve(this.uid)
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
        this.pump().catch(console.error)
    }
    async pump(){
        if(this.finished || this.pumping) return
        this.pumping = true
        let err, written = 0, amount = this.chunks.length
        if(!this.created) {
            this.created = true
            await fs.promises.writeFile(this.file, '', { flag: 'wx'}).catch(e => err = e)
        }
        for(let i=0; i<amount; i++) {
            if(this.chunks[i].type != 'buffer') continue
            let err
            await fs.promises.appendFile(this.file, this.chunks[i].data, {encoding: null}).catch(e => err = e)
            if(err) {
                console.error(err)
                break
            } else {
                written++
                this.chunks[i].type = 'file'
                this.chunks[i].data = null
            }
        }
        this.pumping = false
        if(amount < this.chunks.length) { // chunks added
            await this.pump().catch(console.error)
        }
        if(this.ended && !this.finished) {
            this.finished = true
            this.emit('finish')
        }
    }
    finish(){
        if(!this.finished) {
            this.ended = true
            this.finished = true
            this.emit('finish')
            this.destroy()
        }
    }
    fail(err){
        this.error = err
        this.emit('error', err)
        this.finish()
        this.file && fs.unlink(this.file, () => {})
    }
    end(){
        this.ended = true // before pump()
        this.pump().catch(console.error)
    }
    createReadStream(opts={}){
        return new DownloadCacheFileReader(this, opts)
    }
    destroy(){
        this.chunks = []
        this.finished || this.finish()
        this.removeAllListeners()
    }
}

class DownloadCacheMap extends Events {
    constructor(){
        super()
        this.saving = {}
        this.debug = false
        this.folder = global.storage.folder +'/'
    }
    async info(url) {
        if(this.saving[url]) return this.saving[url]
        const key = url2id(url, this.folder)
        const hkey = 'dch-'+ key.substr(4)
        if(!global.storage.index[key] || !global.storage.index[hkey]) {
            return null
        }
        const info = await global.storage.get(hkey).catch(() => {})
        if(!info || !info.headers) return null
        const file = global.storage.resolve(key)
        const stat = await fs.promises.stat(file).catch(() => {})
        if(!stat || typeof(stat.size) != 'number') return null
        return {
            status: info.statusCode,
            headers: info.headers,
            size: info.size,
            type: 'file',
            file
        }
    }
    remove(url) {
        if(this.saving[url]) {
            if(this.saving[url].chunks && this.saving[url].chunks.fail) {
                this.saving[url].chunks.fail('Removed')
            }
            delete this.saving[url]
        }
    }
    save(downloader, chunk, ended){
        if(!global.config.get('in-disk-caching-size')) return
        if(downloader.requestingRange && 
            (downloader.requestingRange.start > 0 || 
                (downloader.requestingRange.end && downloader.requestingRange.end < (downloader.totalContentLength - 1))
            )
        ){ // partial content request, skip saving
            return
        }
        const opts = downloader.opts
        const url = downloader.currentURL
        if(typeof(this.saving[url]) == 'undefined') {
            const uid = url2id(url, this.folder)
            const huid = 'dch-'+ uid.substr(4)
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
            this.saving[url] = {
                type: 'saving',
                chunks,
                time,
                ttl,
                status: downloader.lastStatusCodeReceived,
                size: headers['content-length'] || false,
                headers,
                uid,
                huid,
                dlid: opts.uid 
                //, traceback: [opts, opts.cacheTTL, global.traceback()]
            }
        }
        if(this.saving[url] && this.saving[url].type == 'saving' && this.saving[url].dlid == opts.uid) {
            chunk && this.saving[url].chunks.push(chunk)
            if(ended) {
                const chunks = this.saving[url].chunks
                const finish = () => {
                    if(!this.saving[url]) return
                    const expectedLength = this.saving[url].size === false ? downloader.totalContentLength : chunks.size
                    if(chunks.error) {
                        console.warn(chunks.error)
                        chunks.fail(chunks.error)
                        delete this.saving[url]
                    } else if((this.saving[url].size === false && !expectedLength) || (expectedLength > chunks.size)) {
                        const err = 'Bad file size. Expected: '+ this.saving[url].size +', received: '+ chunks.size +', discarding http cache.'
                        console.warn(err)
                        chunks.fail(err)
                        delete this.saving[url]
                    } else if(downloader.statusCode < 200 || downloader.statusCode > 400 || (downloader.errors.length && !downloader.received)) {
                        const err = 'Bad download. Status: '+ downloader.statusCode +', received: '+ chunks.size
                        console.warn(err)
                        chunks.fail(err)
                        delete this.saving[url]
                    } else {
                        const size = chunks.size
                        const ttl = this.saving[url].ttl
                        global.storage.touch(this.saving[url].uid, {
                            raw: true,
                            size,
                            ttl,
                            file: chunks.file,
                            expiration: true
                        })
                        global.storage.set(this.saving[url].huid, {
                            statusCode: this.saving[url].status,
                            headers: this.saving[url].headers,
                            size
                        }, {
                            expiration: true
                        })
                        delete this.saving[url]
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
