const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js'), fs = require('fs'), FFServer = require('../utils/ff-server')

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
                this.adapter.destroy()
                this.adapter = null
            }
            let opts = {
                audioCodec: undefined, // auto
                videoCodec: undefined, // auto
                workDir: this.opts.workDir, 
                debug: this.opts.debug
            }
            this.resetTimeout()
            this.transcoder = new FFServer(this.data.url, opts)
            this.connectAdapter(this.transcoder)
            this.transcoder.start().then(() => {
                this.endpoint = this.transcoder.endpoint
                resolve({endpoint: this.endpoint, mimetype: this.mimetype})
            }).catch(reject)
        })
    }
    _start(){ 
        return new Promise((resolve, reject) => {
            this.adapter = new StreamerProxy(this.opts)
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
    if(info.sample){
        let sample = String(info.sample).toLowerCase()
        if(sample.match(new RegExp('#ext(m3u|inf)')) && sample.indexOf('#ext-x-endlist') != -1){
            return true
        }
    }
    return false
}

module.exports = StreamerVODHLSIntent
