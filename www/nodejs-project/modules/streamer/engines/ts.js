const StreamerBaseIntent = require('./base.js'), StreamerAdapterTS = require('../adapters/ts.js'), Any2HLS = require('../utils/any2hls')

class StreamerTSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('TSOPTS', opts)
        Object.assign(opts, {
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
                this.hlsify = new Any2HLS(this.downloader.source.endpoint, this.opts)
                this.connectAdapter(this.hlsify)
                this.hlsify.opts.audioCodec = this.opts.audioCodec
                this.hlsify.start().then(() => {
                    this.endpoint = this.hlsify.endpoint
                    this.downloader.source.cancelWarmCache()
                    resolve()
                }).catch(reject)
            }).catch(reject)
        })
    }
}

StreamerTSIntent.mediaType = 'live'
StreamerTSIntent.supports = info => {
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

