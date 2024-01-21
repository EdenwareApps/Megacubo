const fs = require('fs'), Reader = require('../reader'), DownloadStreamBase = require('./stream-base')

class DownloadStreamCache extends DownloadStreamBase {
	constructor(opts){
		super(opts)
        this.type = 'cache'
	}
    async start(){
        if(this.started){
            throw 'Already started'
        }
        if(this.ended){
            throw 'Already ended'
        }
        if(this.destroyed){
            throw 'Already destroyed'
        }
        const url = this.opts.url
        const row = await global.Download.cache.info(url)
        if(!row || !row.status || row.dlid == this.opts.uid) {
            throw 'Not cached'
        }
        let stream, range
        const headers = Object.assign({}, row.headers) || {}
        headers['x-megacubo-dl-source'] = headers['x-megacubo-dl-source'] ? 'cache-'+ headers['x-megacubo-dl-source'] : 'cache'
        if(this.opts.headers.range) {
            range = this.parseRange(this.opts.headers.range)
            if(!range.end && row.size){
                range.end = row.size
            }
            const total = row.type == 'saving' ? '*' : row.size
            const end = range.end || (total == '*' ? '*' : row.size - 1)
            if(range.start > row.processed) throw 'Range not satisfiable'
            headers['content-range'] = 'bytes='+ range.start +'-'+ end +'/'+ total
        }
        headers['x-megacubo-dl-source'] += '-'+ row.type
        this.response = new DownloadStreamBase.Response(range ? 206 : 200, headers)
        this.emit('response', this.response)
        switch(row.type){
            case 'saving':
                stream = row.chunks.createReadStream(range)
                break
            case 'file':
                if(fs.existsSync(row.file)) {
                    stream = new Reader(row.file, range)
                } else {
                    this.emitError('Cache download failed*', false)
                }
                break
        }
        stream.on('error', err => {
            this.response.emit('error', err)
            this.end()
        })
        stream.on('data', chunk => {
            this.response.write(chunk)
        })
        if(stream.isClosed || stream.closed){
            this.end()
        } else {
            stream.once('close', () => this.end())
        }
        return true
    }
}

module.exports = DownloadStreamCache
