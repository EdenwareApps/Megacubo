const fs = require('fs'), StreamerBaseIntent = require('./base.js'), StreamerProxy = require('../utils/proxy.js')

class StreamerVideoIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'video'
        this.mediaType = 'video'
        if(this.info.contentType && this.info.contentType.indexOf('o/') != -1 && this.info.contentType.indexOf('mp2t') == -1){
            this.mimetype = this.info.contentType
        } else {
            this.mimetype = this.mimeTypes.video
        }
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
                const adapter = new StreamerProxy(Object.assign({
                    authURL: this.data.authURL || this.data.source
                }, this.opts))
                adapter.bitrateChecker.opts.minCheckSize = 6 * (1024 * 1024)
                adapter.bitrateChecker.opts.maxCheckSize = 3 * adapter.bitrateChecker.opts.minCheckSize
                adapter.bitrateChecker.opts.checkingAmount = 1
                this.connectAdapter(adapter)
                adapter.start().then(() => {
                    this.endpoint = adapter.proxify(this.data.url)
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
    if(info.ext){
        if(info.sample && global.streamer.isPacketized(info.sample)) {
            return false // is vod-ts
        }
        if(['mp4', 'mkv', 'm4v', 'mov', 'mpeg', 'webm', 'ogv', 'hevc', 'wmv', 'divx', 'avi', 'asf'].includes(info.ext)){
            return true
        }
    }
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
        if(info.headers && info.headers['content-length'] && ['ts', 'mts', 'm2ts'].includes(info.ext)){ // not live
            return true
        }
    }
    return false
}

module.exports = StreamerVideoIntent
