const StreamerBaseIntent = require('./base.js')

class StreamerTSIntent extends StreamerBaseIntent {    
    constructor(data, opts, info){
        console.log('TSOPTS', opts)
        Object.assign(opts, {
            audioCodec: 'copy'
        })
        super(data, opts, info)
        this.type = 'ts'
        this.mimetype = this.mimeTypes.hls
        this.mediaType = 'live'
    }
    transcode(){
        return new Promise((resolve, reject) => {
            if(!this.transcoder && !this.decoder){
                this.transcoderStarting = true
                this.resetTimeout()
                let resolved, opts = this.getTranscodingOpts()
                const StreamerFFmpeg = require('../utils/ffmpeg')
                const decoder = new StreamerFFmpeg(this.downloader.source.endpoint, opts)
                this.mimetype = this.mimeTypes[decoder.opts.outputFormat]
                this.transcoder = decoder
                this.connectAdapter(decoder)
                decoder.opts.audioCodec = this.opts.audioCodec
                decoder.start().then(() => {
                    if(!resolved){
                        this.endpoint = decoder.endpoint
                        resolved = true
                        resolve({endpoint: this.endpoint, mimetype: this.mimetype})
                        this.emit('transcode-started')
                    }
                }).catch(err => {
                    if(!resolved){
                        this.emit('transcode-failed', err)
                        resolved = true
                        reject(this.errors)
                    }
                }).finally(() => {
                    this.transcoderStarting = false
                })
            } else {
                resolve() // already transcoding
            }
        })
    }
    useFF(){
        const choice = global.config.get('ffmpeg-broadcast-pre-processing')
        return choice === 'yes' || choice === 'mpegts'
    }
    async _start(){ 
        this.mimetype = this.mimeTypes.mpegts
        const StreamerAdapterTS = require('../adapters/ts.js')
        this.downloader = new StreamerAdapterTS(this.info.url || this.data.url, Object.assign({
            authURL: this.data.authURL || this.data.source
        }, this.opts))
        this.connectAdapter(this.downloader)
        await this.downloader.start()
        if(this.useFF()){
            const StreamerFFmpeg = require('../utils/ffmpeg')
            const decoder = new StreamerFFmpeg(this.downloader.source.endpoint, this.opts)
            this.mimetype = this.mimeTypes[decoder.opts.outputFormat]
            this.decoder = decoder
            this.connectAdapter(decoder)
            decoder.opts.audioCodec = this.opts.audioCodec
            await decoder.start()
            this.endpoint = decoder.endpoint
            return {endpoint: this.endpoint, mimetype: this.mimetype}
        }
        this.mimetype = this.mimeTypes.mpegts
        this.endpoint = this.downloader.source.endpoint        
        return {endpoint: this.endpoint, mimetype: this.mimetype}
    }
}

StreamerTSIntent.mediaType = 'live'
StreamerTSIntent.supports = info => {
    if(info.ext && ['mp4'].includes(info.ext)) { // mp4 files have been seen with video/MP2T contentType
        return false
    }
    if(info.headers && info.headers['content-length']) {
        return false // not live
    }
    if(info.contentType) {
        let c = info.contentType
        if(c.indexOf('mpegurl') != -1){ // is hls
            return false
        }
        if(c.indexOf('mp2t') != -1){
            return true
        } else {
            return false // other video content type
        }
    }
    if(info.ext && ['ts', 'mts', 'm2ts'].includes(info.ext)) {
        return true
    }
    return false
}

module.exports = StreamerTSIntent

