const StreamerBaseIntent = require('./base.js'), StreamerAdapterTS = require('../adapters/ts.js'), StreamerAdapterHLS = require('../adapters/hls.js'), FFServer = require('../utils/ff-server')

class StreamerTSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('TSOPTS', opts)
        opts = Object.assign(opts, {
            audioCodec: !global.cordova ? 
                'aac' : // force audio recode for TS to prevent HLS.js playback hangs
                'copy' // aac disabled for performance
        })
        super(data, opts, info)
        this.type = 'ts'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
    }  
    _start(){ 
        return new Promise((resolve, reject) => {
            this.downloader = new StreamerAdapterTS(this.data.url, this.opts)
            this.connectAdapter(this.downloader)
            this.downloader.start().then(() => {
                this.ts2hls = new FFServer(this.downloader.source.stream, this.opts)
                this.connectAdapter(this.ts2hls)
                this.ts2hls.audioCodec = this.opts.audioCodec
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

