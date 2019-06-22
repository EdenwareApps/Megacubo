
class PlaybackMp4Intent extends PlaybackBaseIntent {    
    constructor(entry, options){
        super(entry, options)
        this.type = 'mp4'
        this.entry = entry
        this.streamURL = this.entry.url
        this.mimetype = PLAYBACK_MP4_MIMETYPE
        this.tester = false
        this.streamType = 'video'
        if(options){
            this.apply(options)
        }
    }  
    confirm(){
        if(this.videoCodec == 'copy' && this.audioCodec == 'copy'){
            this.mimetype = PLAYBACK_MP4_MIMETYPE
            this.streamURL = this.entry.url
            this.start(test)
        } else {
            this.mimetype = PLAYBACK_HLS_MIMETYPE
            this.decoder = this.ffmpeg(this.entry.url)
            this.decoder.file = path.resolve(this.workDir + path.sep + this.uid + path.sep + 'output.m3u8')
            this.streamURL = this.playback.proxyLocal.proxify(this.decoder.file)
            this.decoder.addOption('-hls_flags ' + (fs.existsSync(this.decoder.file) ? 'delete_segments+append_list' :  'delete_segments'))
            mkdirr(dirname(this.decoder.file))
            this.waiter = waitFileTimeout(this.decoder.file, (exists) => {
                if(!this.ended && !this.error && !this.destroyed){
                    if(exists){
                        this.start(test)
                    } else {
                        console.error('M3U8 file creation timeout.');
                        this.fail('transcode')
                    }
                }
            }, 1800)
            this.decoder.output(this.decoder.file).run()
        }
    }
    run(){    
        if(isLocal(this.entry.url)){
            this.start(true)
        } else if(isHTTP(this.entry.url)){
            this.ping((result) => {
                if(!this.error && !this.ended && !this.destroyed){
                    console.log('Content-Type', this.entry.url, result)
                    if(this.validateContentType(result.type) && this.validateStatusCode(result.status)){
                        this.start(!!result.type)
                    } else if(!this.started) {
                        console.error('Bad HTTP response for '+this.type, result)
                        this.fail(status || 'connect')
                    }
                }
            })        
        } else {
            console.error('Not HTTP(s)', this.entry.url)
            this.fail('invalid')
        }
    }
}

PlaybackMp4Intent.supports = (entry) => {
    return isHTTP(entry.url) && entry.url.match(new RegExp('\\.(mp4|webm|ogv)($|\\?)', 'i'))
}

Playback.registerEngine('mp4', PlaybackMp4Intent, 3)