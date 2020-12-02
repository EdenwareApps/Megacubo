const StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js'), fs = require('fs')

class StreamerHLSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'hls'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
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
                reject(e || 'hls adapter failed')
            })
        })
    }
}

StreamerHLSIntent.mediaType = 'live'
StreamerHLSIntent.supports = (info) => {
    if(info.sample){
        if(String(info.sample).match(new RegExp('#EXT(M3U|INF)', 'i'))){
            return true
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
