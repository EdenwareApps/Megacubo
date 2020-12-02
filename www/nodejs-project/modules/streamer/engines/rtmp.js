const StreamerBaseIntent = require('./base.js'), StreamerAdapterHLS = require('../adapters/hls.js'), FFServer = require('../utils/ff-server')

class StreamerRTMPIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('RTMPOPTS', opts)
        opts = Object.assign(opts, {
            audioCodec: !global.cordova ? 
                'aac' : // force audio recode for RTMP to prevent HLS.js playback hangs
                'copy' // aac disabled for performance
        })
        super(data, opts, info)
        this.type = 'rtmp'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
        this.on('destroy', () => {
            console.log('RTMPINTENTDESTROY')
        })
    }  
    _start(){ 
        return new Promise((resolve, reject) => {
            this.rtmp2hls = new FFServer(this.data.url, this.opts)
            this.connectAdapter(this.rtmp2hls)
            this.rtmp2hls.audioCodec = this.opts.audioCodec
            this.rtmp2hls.start().then(() => {
                this.endpoint = this.rtmp2hls.endpoint
                resolve()
            }).catch(reject)
        })
    }
}

StreamerRTMPIntent.mediaType = 'live'
StreamerRTMPIntent.supports = (info) => {
    if(info.url && info.url.match(new RegExp('^rtmp[a-z]*://', 'i'))){
        return true
    }
    return false
}

module.exports = StreamerRTMPIntent

