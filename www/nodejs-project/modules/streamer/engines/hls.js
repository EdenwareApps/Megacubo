const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js'), fs = require('fs'), FFServer = require('../utils/ff-server')

class StreamerHLSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'hls'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
    }  
    transcode(){
        return new Promise((resolve, reject) => {
            if(this.adapter){
                this.adapter.destroy()
                this.adapter = null
            }
            let resolved, opts = {
                audioCodec: 'aac',
                videoCodec: 'libx264',
                workDir: this.opts.workDir, 
                debug: this.opts.debug
            }
            this.resetTimeout()
            this.transcoderStarting = true
            this.transcoder = new FFServer(this.data.url, opts)
            this.connectAdapter(this.transcoder)
            this.transcoder.on('destroy', () => {
                if(!resolved){
                    resolved = true
                    reject('destroyed')
                }
            })
            this.transcoder.start().then(() => {        
                if(!resolved){
                    resolved = true
                    this.transcoderStarting = false
                    this.endpoint = this.transcoder.endpoint
                    resolve({endpoint: this.endpoint, mimetype: this.mimetype})
                    this.emit('transcode-started')
                }
            }).catch(e => {                
                if(!resolved){
                    resolved = true
                    this.transcoderStarting = false
                    this.emit('transcode-failed', e)
                    reject(e)
                }
            })
        })
    }
    _start(){ 
        return new Promise((resolve, reject) => {
            this.adapter = new StreamerProxy(Object.assign({authURL: this.data.source}, this.opts))
            this.connectAdapter(this.adapter)
            this.adapter.start().then(() => {
                this.endpoint = this.adapter.proxify(this.data.url)
                resolve({endpoint: this.endpoint, mimetype: this.mimetype})
            }).catch(e => {
                console.warn('COMMITERR', this.endpoint, e)
                reject(e || 'hls adapter failed')
            })
        })
    }
}

StreamerHLSIntent.mediaType = 'live'
StreamerHLSIntent.supports = info => {
    if(info.sample){
        if(String(info.sample).match(new RegExp('#ext(m3u|inf)', 'i'))){
            if(global.isVODM3U8(info.sample)){
                return false // is vodhls
            } else {
                return true
            }
        }
    }
    if(info.contentType){
        if(info.contentType.indexOf('mpegurl') != -1){
            return true
        } else {
            return false // other video content type
        }
    }
    if(info.ext && info.ext == 'm3u8'){
        return true
    }
    return false
}

module.exports = StreamerHLSIntent
