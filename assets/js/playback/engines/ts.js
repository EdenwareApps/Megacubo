
class PlaybackTsIntent extends PlaybackTranscodeIntent {  
    constructor(entry, options){
        super(entry, options)
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
        this.on('restart-decoder', () => {
            if(this.proxy){
                this.proxy.prepareQuickRecovering()
            }
        })
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
                        console.log('M3U8 file created.', this.started)
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
            this.proxy.prepareQuickRecovering()
            this.proxy.on('codecData', (codecData) => {
                if(!this.destroyed && !this.error && !this.unloaded){
                    this.emit('codecData', codecData)
                }
            })
            this.proxy.on('timeout', (...args) => {
                console.warn('TIMEOUTT', JSON.stringify(args))
            })
            this.proxy.on('destroy', () => {
                if(!this.error && !this.destroyed){
                    this.fail(this.proxy.statusCode || 504)
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

const TSInfiniteProxy = require(path.resolve('modules/infinite-ts'))

class TSInfiniteProxyPool {
	constructor(request){
		this.pool = {}
		this.request = request	
		this.debug = debugAllow(false) ? console.warn : false
	}
	updateConfig(){
		Object.keys(this.pool).forEach(u => {
			if(!this.pool[u].destroyed){
				this.pool[u].opts.needleSize = Config.get('ts-joining-needle-size') * 1024 
                this.pool[u].opts.backBufferSize = Config.get('ts-joining-stack-size') * (1024 * 1024)
			}
		})
	}
	get(url, cb, opts){
		let ready = (endpoint) => {
			if(typeof(cb) == 'function'){
				cb(endpoint)
				cb = null
			}
		}
		if(typeof(this.pool[url]) == 'undefined' || this.pool[url].destroyed){
			console.warn('TSPOOLCREATE', url, traceback())
			if(typeof(this.pool[url]) != 'undefined'){
				console.warn('TSPOOLNFO', this.pool[url].destroyed, !this.pool[url].endpoint)
			}
			this.pool[url] = new TSInfiniteProxy(url, Object.assign({
				ready, 
				request: this.request,
                debug: this.debug,
                ffmpeg: path.resolve('../ffmpeg/ffmpeg'),
                backBufferSize: Config.get('ts-joining-stack-size') * (1024 * 1024),
                needleSize: Config.get('ts-joining-needle-size') * 1024
			}, opts || {}))
			this.pool[url].on('destroy', () => {
				delete this.pool[url]
			})
		} else {
			console.warn('TSPOOLREUSE', url, traceback())
			this.pool[url].on('ready', ready)
			if(this.pool[url].endpoint){
				ready(this.pool[url].endpoint)
			}
		}
		return this.pool[url]
	}
	destroy(){
        console.warn('TSPool.destroy()', traceback())
		Object.keys(this.pool).forEach(url => {
			this.pool[url].destroy()
		})
		this.pool = []
	}
}

const TSPool = new TSInfiniteProxyPool(requestForever)

$win.on('beforeunload', () =>{
    console.warn('Closing servers');
    if(TSPool){
        TSPool.destroy()
    }
    console.warn('Closing servers OK')
})