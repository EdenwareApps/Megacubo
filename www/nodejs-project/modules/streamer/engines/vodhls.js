const StreamerHLSIntent = require('./hls.js'), fs = require('fs'), Any2HLS = require('../utils/any2hls')

class StreamerVODHLSIntent extends StreamerHLSIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'vodhls'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'video'
    }
    getTranscodingOpts(){
        return Object.assign({
            workDir: this.opts.workDir, 
            authURL: this.data.source,
            debug: this.opts.debug,
            isLive: false
        }, this.getTranscodingCodecs())
    }
}

StreamerVODHLSIntent.mediaType = 'video'
StreamerVODHLSIntent.supports = info => {
    if(info.sample){
        if(String(info.sample).match(new RegExp('#ext(m3u|inf)', 'i'))){
            if(global.isVODM3U8(info.sample, info.contentLength)){
                return true
            } else {
                return false // is live hls
            }
        }
    }
    return false
}

module.exports = StreamerVODHLSIntent
