const StreamerBaseIntent = require('./base.js'), StreamerProxyHLS = require('../utils/proxy.js'), fs = require('fs'), Any2HLS = require('../utils/any2hls')

class StreamerVODHLSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'vodhls'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'video'
    }  
    transcode(){
        return new Promise((resolve, reject) => {
            if(this.adapter){
                this.disconnectAdapter(this.adapter)
                this.adapter.destroy()
                this.adapter = null
            }
            let opts = {
                audioCodec: 'aac',
                videoCodec: 'libx264',
                workDir: this.opts.workDir, 
                debug: this.opts.debug,
                authURL: this.data.source,
                isLive: false
            }
            this.transcoderStarting = true
            this.resetTimeout()
            this.transcoder = new Any2HLS(this.data.url, opts)
            this.connectAdapter(this.transcoder)
            this.transcoder.start().then(() => {
                this.transcoderStarting = false
                this.endpoint = this.transcoder.endpoint
                resolve({endpoint: this.endpoint, mimetype: this.mimetype})
                this.emit('transcode-started')
            }).catch(e => {                
                this.transcoderStarting = false
                reject(e)
            })
        })
    }
    _start(){ 
        return new Promise((resolve, reject) => {
            this.adapter = new StreamerProxyHLS(this.opts)
            this.connectAdapter(this.adapter)
            this.adapter.start().then(() => {
                this.endpoint = this.adapter.proxify(this.data.url)
                resolve({endpoint: this.endpoint, mimetype: this.mimetype})
            }).catch(e => {
                console.warn('COMMITERR', this.endpoint, e)
                reject(e || 'vod hls adapter failed')
            })
        })
    }
}

StreamerVODHLSIntent.mediaType = 'video'
StreamerVODHLSIntent.supports = info => {
    if(info.sample && global.isVODM3U8(info.sample)){
        return true
    }
    return false
}

module.exports = StreamerVODHLSIntent
