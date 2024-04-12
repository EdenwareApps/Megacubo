const StreamerHLSIntent = require('./hls.js')

class StreamerVODHLSIntent extends StreamerHLSIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'vodhls'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'video'
    }
}

StreamerVODHLSIntent.mediaType = 'video'
StreamerVODHLSIntent.supports = info => {
    if(info.sample){
        if(String(info.sample).match(new RegExp('#ext(m3u|inf)', 'i'))){
            const StreamerBaseIntent = require('./base.js')
            if(StreamerBaseIntent.isVODM3U8(info.sample, info.contentLength, info.headers)){
                return true
            } else {
                return false // is live hls
            }
        }
    }
    return false
}

module.exports = StreamerVODHLSIntent
