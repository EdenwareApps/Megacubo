const StreamerBaseIntent = require('./base.js'), Any2HLS = require('../utils/any2hls')

class StreamerRTMPIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('RTMPOPTS', opts)
        let audioCodec = global.config.get('ffmpeg-audio-repair') ? 
            'aac' : // force audio recode for RTMP to prevent HLS.js playback hangs
            'copy' // aac disabled for performance
        let videoCodec = global.cordova ? 
            'copy' :
            'libx264' // rtmp can get flickering on HTML5 without transcode
        opts = Object.assign(opts, {audioCodec, videoCodec})
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
            this.rtmp2hls = new Any2HLS(this.data.url, this.opts)
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
    if(info.contentType){
        if(info.contentType.toLowerCase() == 'application/octet-stream' && !['ts', 'aac'].includes(info.ext)){
            return true
        }
    }
    return false
}

module.exports = StreamerRTMPIntent
