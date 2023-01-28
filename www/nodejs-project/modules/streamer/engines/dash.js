const StreamerBaseIntent = require('./base.js'), Any2HLS = require('../utils/any2hls')

class StreamerDashIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('DASHOPTS', opts)
        let audioCodec = 'copy'
        let videoCodec = 'copy'
        Object.assign(opts, {audioCodec, videoCodec})
        super(data, opts, info)
        this.type = 'dash'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
        this.once('destroy', () => {
            console.log('DASHINTENTDESTROY')
        })
    }  
    _start(){ 
        return new Promise((resolve, reject) => {
            this.dash2hls = new Any2HLS(this.data.url, this.opts)
            this.connectAdapter(this.dash2hls)
            this.dash2hls.audioCodec = this.opts.audioCodec
            this.dash2hls.start().then(() => {
                this.endpoint = this.dash2hls.endpoint
                resolve()
            }).catch(reject)
        })
    }
}

StreamerDashIntent.mediaType = 'live'
StreamerDashIntent.supports = info => {
    if(info.contentType == 'application/dash+xml'){
        return true
    }
    if(info.ext == 'mpd'){
        return true
    }
    return false
}

module.exports = StreamerDashIntent
