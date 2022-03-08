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
            this.resetTimeout()
            this.transcoderStarting = true
            this.disconnectAdapter(this.prx)
            this.prx.destroy()
            this.trackSelector.select(this.data.url).then(ret => {
                this.resetTimeout()
                let resolved, opts = Object.assign({
                    workDir: this.opts.workDir, 
                    authURL: this.data.source,
                    debug: this.opts.debug,
                    isLive: false
                }, this.getTranscodingCodecs())
                this.trackUrl = ret.url     
                console.log('TRACKS', this.trackUrl, ret, this.trackSelector.tracks)
                this.prx = new StreamerProxy(Object.assign({authURL: this.data.source}, this.opts))
                this.connectAdapter(this.prx)
                this.prx.start().then(() => {
                    this.transcoder = new Any2HLS(this.prx.proxify(this.trackUrl), opts)
                    this.connectAdapter(this.transcoder)
                    this.transcoder.on('destroy', () => {
                        if(!resolved){
                            this.transcoderStarting = false
                            this.emit('transcode-failed', 'destroyed')
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
                            if(ret.bandwidth){ // do it after resolve for right emit order on global.streamer
                                this.bitrate = ret.bandwidth
                                this.emit('bitrate', ret.bandwidth)
                            }
                        }       
                    }).catch(err => {
                        if(!resolved){
                            resolved = true
                            this.transcoderStarting = false
                            this.emit('transcode-failed', err)
                            reject(err)
                        }
                    })
                }).catch(err => { 
                    if(!resolved){
                        resolved = true
                        this.transcoderStarting = false
                        this.emit('transcode-failed', err)
                        reject(err)
                    }
                })
            }).catch(err => {
                this.transcoderStarting = false
                this.emit('transcode-failed', err)
                console.warn('COMMITERR', this.endpoint, err)
                reject(err || 'hls adapter failed')
            })
        })
    }
    _start(){ 
        return new Promise((resolve, reject) => {
            this.prx = new StreamerProxyHLS(this.opts)
            this.connectAdapter(this.prx)
            this.prx.start().then(() => {
                this.endpoint = this.prx.proxify(this.data.url)
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
