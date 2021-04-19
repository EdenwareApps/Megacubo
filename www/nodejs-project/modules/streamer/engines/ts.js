const StreamerBaseIntent = require('./base.js'), StreamerAdapterTS = require('../adapters/ts.js'), StreamerAdapterHLS = require('../adapters/hls.js'), FFServer = require('../utils/ff-server')

class StreamerTSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('TSOPTS', opts)
        opts = Object.assign(opts, {
            audioCodec: global.config.get('ffmpeg-audio-repair') ? 
                'aac' : // force audio recode for TS to prevent playback hangs
                'copy' // aac disabled for performance
        })
        super(data, opts, info)
        this.type = 'ts'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
    }  
    transcode(){ 
        return new Promise((resolve, reject) => {
            this.resetTimeout()
            this.transcoderStarting = true
            this.transcoder = true
            if(this.downloader){
                this.downloader.destroy()
            }
            if(this.ts2hls){
                this.ts2hls.destroy()
            }
            delete this.opts.videoCodec
            delete this.opts.audioCodec
            this.downloader = new StreamerAdapterTS(this.data.url, this.opts)
            this.connectAdapter(this.downloader)
            this.downloader.start().then(() => {
                let opts = {
                    audioCodec: 'aac',
                    videoCodec: 'libx264',
                    workDir: this.opts.workDir, 
                    debug: this.opts.debug
                }
                this.transcoder = new FFServer(this.downloader.source.endpoint, opts)
                this.connectAdapter(this.transcoder)
                this.transcoder.start().then(() => {
                    this.transcoderStarting = false
                    this.endpoint = this.transcoder.endpoint
                    resolve()
                    this.emit('transcode-started')
                }).catch(e => {                
                    this.transcoderStarting = false
                    reject(e)
                })
            }).catch(e => {
                this.transcoderStarting = false
                reject(e)
            })
        })
    }
    _start(){ 
        return new Promise((resolve, reject) => {
            this.downloader = new StreamerAdapterTS(this.data.url, this.opts)
            this.connectAdapter(this.downloader)
            this.downloader.start().then(() => {
                this.ts2hls = new FFServer(this.downloader.source.endpoint, this.opts)
                this.connectAdapter(this.ts2hls)
                this.ts2hls.opts.audioCodec = this.opts.audioCodec
                this.ts2hls.start().then(() => {
                    this.endpoint = this.ts2hls.endpoint
                    resolve()
                }).catch(reject)
            }).catch(reject)
        })
    }
}

StreamerTSIntent.mediaType = 'live'
StreamerTSIntent.supports = (info) => {
    if(info.contentType){
        let c = info.contentType.toLowerCase()
        if(c.indexOf('mpegurl') != -1){ // is hls
            return false
        }
        if(c.indexOf('mp2t') != -1){
            return true
        } else {
            return false // other video content type
        }
    }
    if(info.ext && ['ts', 'mts', 'm2ts'].includes(info.ext)){
        return true
    }
    return false
}

module.exports = StreamerTSIntent

