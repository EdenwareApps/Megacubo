const StreamerBaseIntent = require('./base.js'), StreamerAdapterTS = require('../adapters/ts.js'), Any2HLS = require('../utils/any2hls')

class StreamerTSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('TSOPTS', opts)
        opts = Object.assign(opts, {
            audioCodec: 'copy'
        })
        super(data, opts, info)
        this.type = 'ts'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
    }  
    _start(){ 
        return new Promise((resolve, reject) => {
            this.downloader = new StreamerAdapterTS(this.data.url, Object.assign({authURL: this.data.source}, this.opts))
            this.connectAdapter(this.downloader)
            this.downloader.start().then(() => {
                this.ts2hls = new Any2HLS(this.downloader.source.endpoint, this.opts)
                this.connectAdapter(this.ts2hls)
                this.ts2hls.opts.audioCodec = this.opts.audioCodec
                this.ts2hls.start().then(() => {
                    this.endpoint = this.ts2hls.endpoint
                    resolve()
                }).catch(reject)
            }).catch(reject)
        })
    }
}

StreamerTSIntent.mediaType = 'live'
StreamerTSIntent.supports = (info) => {
    if(info.contentType){
        let c = info.contentType.toLowerCase()
        if(c.indexOf('mpegurl') != -1){ // is hls
            return false
        }
        if(c.indexOf('mp2t') != -1){
            return true
        } else {
            return false // other video content type
        }
    }
    if(info.ext && ['ts', 'mts', 'm2ts'].includes(info.ext)){
        return true
    }
    return false
}

module.exports = StreamerTSIntent

