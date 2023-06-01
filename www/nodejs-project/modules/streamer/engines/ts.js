const Downloader = require('../utils/downloader')
const StreamerBaseIntent = require('./base.js')
const StreamerAdapterTS = require('../adapters/ts.js')
const StreamerFFmpeg = require('../utils/ffmpeg')

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
                const decoder = new StreamerFFmpeg(this.downloader.source.endpoint, opts)
                this.mimetype = this.mimeTypes[decoder.opts.outputFormat]
                this.transcoder = decoder
                this.connectAdapter(decoder)
                decoder.opts.audioCodec = this.opts.audioCodec
                decoder.start().then(() => {
                    if(!resolved){
                        this.endpoint = decoder.endpoint
                        this.downloader.source.cancelWarmCache()
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
    useFFmpeg(){
        if(global.config.get('ffmpeg-broadcast-pre-processing') == 'yes'){
            return true
        }
        return false         
    }
    async _start(){ 
        this.mimetype = this.mimeTypes.mpegts
        this.downloader = new StreamerAdapterTS(this.data.url, Object.assign({authURL: this.data.source}, this.opts))
        this.connectAdapter(this.downloader)
        await this.downloader.start()
        if(this.useFFmpeg()){
            const decoder = new StreamerFFmpeg(this.downloader.source.endpoint, this.opts)
            this.mimetype = this.mimeTypes[decoder.opts.outputFormat]
            this.decoder = decoder
            this.connectAdapter(decoder)
            decoder.opts.audioCodec = this.opts.audioCodec
            await decoder.start()
            this.endpoint = decoder.endpoint
            this.downloader.source.cancelWarmCache()
            return {endpoint: this.endpoint, mimetype: this.mimetype}
        }
        this.mimetype = this.mimeTypes.mpegts
        this.endpoint = this.downloader.source.endpoint        
        return {endpoint: this.endpoint, mimetype: this.mimetype}
    }
}

StreamerTSIntent.mediaType = 'live'
StreamerTSIntent.supports = info => {
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

