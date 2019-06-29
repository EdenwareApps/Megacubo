
const TSPool = new TSInfiniteProxyPool(requestForever)

class PlaybackTsIntent extends PlaybackTranscodeIntent {  
    constructor(entry, options){
        super(entry, options)
        this.audioCodec = 'aac'
        this.type = 'ts';
        this.folder = '';
        this.proxify = true;
        this.streamURL = false;
        this.streamType = 'live'
        this.videoEvents = {
            'ended': [
                () => {
                    // this.retry()
                    console.error('TS video element ended.', fs.existsSync(this.decoder.file), String(fs.readFileSync(this.decoder.file)))
                }
            ]
        }    
        if(options){
            this.apply(options)
            //console.log('ZZZZ', options, this);
        }  
        this.on('error', () => {
            if(this.proxy){
                this.proxy.destroy()
            }
        })
        this.on('destroy', () => {
            if(this.proxy && (this.committed || this.error)){
                this.proxy.destroy()
            }
        })
    } 
    confirm(){
        console.log('confirm', this.file, traceback(), this.decoder, this.uid)
        if(!this.decoder && !this.destroyed){
            this.decoder = this.ffmpeg(this.proxy.endpoint)
            var hlsFlags = ['delete_segments', 'omit_endlist'], alreadyExists = fs.existsSync(this.file);
            if(alreadyExists) {
                hlsFlags.push('append_list')
            } else {
                mkdirr(dirname(this.file))
            }
            this.decoder.addOption('-hls_flags', hlsFlags.join('+'))
            // setup event handlers
            this.decoder.file = this.file;     
            this.waiter = waitFileTimeout(this.decoder.file, (exists) => {
                if(!this.ended && !this.error && !this.destroyed){
                    if(exists){
                        console.log('M3U8 file created.')
                        if(this.proxy){
                            this.proxy.opts.idleTimeout = 30000
                        }
                        this.start(true)
                    } else {
                        console.error('M3U8 file creation timeout.');
                        this.fail('transcode')
                    }
                }
            }, 1800)
            this.streamURL = this.playback.proxyLocal.proxify(this.decoder.file)
            this.decoder.output(this.decoder.file).run()
        }
        console.log('confirm DONE')
    }
    run(){    
        if(isHTTP(this.entry.url)){
            this.proxy = TSPool.get(this.entry.url, () => {
                process.nextTick(() => {
                    this.confirm()
                })
            })
            this.proxy.on('timeout', (...args) => {
                console.warn('TIMEOUTT', JSON.stringify(args))
            })
            this.proxy.on('destroy', () => {
                if(!this.error && !this.destroyed){
                    this.fail(this.proxy.statusCode || 'invalid')
                }
            })
        } else {
            console.error('Not HTTP(s)', this.entry.url);
            this.fail('invalid')
        }
    }
}

PlaybackTsIntent.supports = (entry) => {
    return isRemoteTS(entry.url)
}
        
Playback.registerEngine('ts', PlaybackTsIntent, 1)

$win.on('beforeunload', () =>{
    console.warn('Closing servers');
    if(TSPool){
        TSPool.destroy()
    }
    console.warn('Closing servers OK')
})