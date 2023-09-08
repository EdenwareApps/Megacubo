const StreamerBaseIntent = require('./base.js'), StreamerFFmpeg = require('../utils/ffmpeg')

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
    async _start(){
        this.tohls = new StreamerFFmpeg(this.data.url, this.opts)
        this.mimetype = this.mimeTypes[this.tohls.opts.outputFormat]
        this.connectAdapter(this.tohls)
        this.tohls.audioCodec = this.opts.audioCodec
        await this.tohls.start()
        this.endpoint = this.tohls.endpoint
        return {endpoint: this.endpoint, mimetype: this.mimetype}
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
