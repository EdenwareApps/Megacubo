const fs = require('fs'), StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js')

class StreamerVideoIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'video'
        this.mediaType = 'video'
        if(this.info.contentType && this.info.contentType.indexOf('o/') != -1){
            this.mimetype = this.info.contentType
        } else {
            this.mimetype = this.mimeTypes.video
        }
        this.opts.minBitrateCheckSize = 6 * (1024 * 1024)
        this.opts.maxBitrateCheckSize = 3 * this.opts.minBitrateCheckSize
        this.opts.bitrateCheckingAmount = 1
    } 
	domain(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0].split(':')[0]
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	} 
    _start(){   
        return new Promise((resolve, reject) => {
            const isLocalFile = this.info && this.info.isLocalFile
            const isLocalHost = this.data.url.startsWith('http://127.0.0.1') // proxify https anyway to prevent SSL errors
            if(isLocalFile || isLocalHost) {
                this.endpoint = this.data.url
                if(isLocalFile){
                    global.downloads.serve(this.data.url, false, false).then(url => {
                        this.endpoint = url
                        resolve()
                    }).catch(reject)
                } else { //  if is localhost URL, don't proxify
                    resolve()
                }
            } else {
                this.adapter = new StreamerProxy(Object.assign({authURL: this.data.source}, this.opts))
                this.connectAdapter(this.adapter)
                this.adapter.start().then(() => {
                    this.endpoint = this.adapter.proxify(this.data.url)
                    resolve()
                }).catch(e => {
                    reject(e)
                })
            }
        })
    }
}

StreamerVideoIntent.mediaType = 'video'
StreamerVideoIntent.supports = info => {
    if(info.isLocalFile){
        return true
    }
    if(info.contentType){
        let c = info.contentType.toLowerCase()
        if(c.indexOf('mp2t') != -1 && (!info.headers || !info.headers['content-length'])){
            return false
        }
        if(c.indexOf('video') == 0){
            return true
        }
    }
    if(info.ext){
        if(['mp4', 'mkv', 'm4v', 'mov', 'mpeg', 'webm', 'ogv', 'hevc', 'wmv', 'divx', 'avi', 'asf'].includes(info.ext)){
            return true
        }
        if(info.headers && info.headers['content-length'] && ['ts', 'mts', 'm2ts'].includes(info.ext)){ // not live
            return true
        }
    }
    return false
}

module.exports = StreamerVideoIntent
