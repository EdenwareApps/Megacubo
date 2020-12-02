const fs = require('fs'), StreamerBaseIntent = require('./base.js'), StreamerMagnetAdapter = require('../adapters/magnet.js')

class StreamerMagnetIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        super(data, opts, info)
        this.type = 'magnet'
        this.mimetype = this.mimeTypes.video
        this.mediaType = 'video'
    }  
    _start(){   
        return new Promise((resolve, reject) => {
            this.adapter = new StreamerMagnetAdapter(this.data.url, this.opts)
            this.adapter.opts.bitrateCheckingAmount = 1
            this.connectAdapter(this.adapter)
            this.adapter.start().then(() => {
                this.endpoint = this.adapter.endpoint
                resolve()
            }).catch(e => {
                reject(e)
            })
        })
    }
}

StreamerMagnetIntent.mediaType = 'video'
StreamerMagnetIntent.supports = (info) => {
    if(info.url){
        if(info.url.match(new RegExp('^magnet:', 'i'))){
            return true
        }
        if(info.ext == 'torrent'){
            return true
        }
    }
    return false
}

module.exports = StreamerMagnetIntent
