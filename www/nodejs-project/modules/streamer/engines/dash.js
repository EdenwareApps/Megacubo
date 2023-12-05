const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy')

class StreamerDashIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('DASHOPTS', opts)
        let audioCodec = 'copy'
        let videoCodec = 'copy'
        Object.assign(opts, {audioCodec, videoCodec})
        super(data, opts, info)
        this.type = 'dash'
        this.mimetype = this.mimeTypes.dash
        this.mediaType = 'live'
        this.once('destroy', () => {
            console.log('DASHINTENTDESTROY')
        })
    }  
    async _start(){
        this.prx = new StreamerProxy(Object.assign({
            authURL: this.data.authURL || this.data.source
        }, this.opts))
        this.connectAdapter(this.prx)
        await this.prx.start()
        this.endpoint = this.prx.proxify(this.data.url)
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
