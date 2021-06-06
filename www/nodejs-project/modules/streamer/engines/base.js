
const Events = require('events'), fs = require('fs')

class StreamerBaseIntent extends Events {
	constructor(data, opts, info){
        super()
        this.mimeTypes = {
            hls: 'application/x-mpegURL', //; codecs="avc1.42E01E, mp4a.40.2"
            video: 'video/mp4'
        }        
        this.opts = {
            workDir: global.streamer.opts.workDir +'/ffmpeg/data',
            videoCodec: 'copy',
            audioCodec: 'copy'
        }
        this.mediaType = 'video'
        this.codecData = null
        this.type = 'base'
        this.timeout = Math.max(40, global.config.get('connect-timeout'))
        this.committed = false
        this.manual = false
        this.loaded = false
        this.adapters = []
        this.errors = []
        this.data = data
        this.subtitle = false
        this.started = false
        this.ignoreErrors = false
        this.mimetype = ''
        this.failListener = this.onFail.bind(this)
        if(opts){
            this.setOpts(opts)
        }
		fs.mkdir(this.opts.workDir, {recursive: true}, (err) => {
			if (err){
				console.error(err)
			}
		})
        this.info = info
        this.on('error', err => {
            this.unload()
        })
	}
    setOpts(opts){
        if(opts && typeof(opts) == 'object'){     
            Object.keys(opts).forEach((k) => {
                if(['debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
                    this.on(k, opts[k])
                } else {
                    this.opts[k] = opts[k]
                }
            })
        }
    }
    connectAdapter(adapter){    
        this.adapters.push(adapter)  
        adapter.on('dimensions', dimensions => {
			if(dimensions && this._dimensions != dimensions){
				this._dimensions = dimensions
				this.emit('dimensions', this._dimensions)
			}
        })
        adapter.on('codecData', codecData => {
			if(codecData && this.codecData != codecData){
                if(this.codecData){
                    const badCodecs = ['', 'unknown']
                    if(badCodecs.includes(codecData.video)){
                        codecData.video = this.codecData.video
                    }
                    if(badCodecs.includes(codecData.audio)){
                        codecData.audio = this.codecData.audio
                    }
                }
				this.codecData = codecData
				this.emit('codecData', this.codecData)
			}
        })
        adapter.on('speed', speed => {
			if(speed > 0 && this.currentSpeed != speed){
				this.currentSpeed = speed
			}
        })
        adapter.on('fail', this.failListener)
        this.on('commit', () => {
            adapter.emit('commit')
            if(!adapter.committed){
                adapter.committed = true
            }
        })
        this.on('uncommit', () => {
            if(adapter.committed){
                adapter.emit('uncommit')
                adapter.committed = false
            }
        })
        adapter.on('bitrate', (bitrate, speed) => {
			if(speed && speed > 0){
				this.currentSpeed = speed
			}
			if(bitrate && this.bitrate != bitrate){
				this.bitrate = bitrate
				this.emit('bitrate', this.bitrate, this.currentSpeed)
			}
        })
		if(adapter.bitrate){
			this.bitrate = adapter.bitrate
			this.emit('bitrate', adapter.bitrate, this.currentSpeed)
		}
    }
    disconnectAdapter(adapter){
        adapter.removeListener('fail', this.failListener);
        ['dimensions', 'codecData', 'bitrate', 'speed', 'commit', 'uncommit'].forEach(n => adapter.removeAllListeners(n))
    }
    onFail(err){
        if(!this.destroyed){
            console.log('adapter fail', err)
            this.fail(err)
        }
    }
    findLowAdapter(base, types, filter){
        if(!base){
            base = this
        }
        if(base.adapters){
            let ret
            for(let i = 0; i < base.adapters.length; i++){ // not reverse, to find the lower level adapter, useful to get stream download speed
                if(base.adapters[i].type && types.includes(base.adapters[i].type) && (!filter || filter(base.adapters[i]))){
                    ret = base.adapters[i]
                } else {
                    ret = this.findLowAdapter(base.adapters[i], types, filter)
                }
                if(ret){
                    break
                }
            }
            return ret
        }
    }
    findAdapter(base, types, filter){
        if(!base){
            base = this
        }
        if(base.adapters){
            let ret
            for(let i = base.adapters.length - 1; i >= 0; i--){ // reverse lookup to find the higher level adapter, so it should be HTML5 compatible already
                if(base.adapters[i].type && types.includes(base.adapters[i].type) && (!filter || filter(base.adapters[i]))){
                    ret = base.adapters[i]
                } else {
                    ret = this.findAdapter(base.adapters[i], types, filter)
                }
                if(ret){
                    break
                }
            }
            return ret
        }
    }
    findAllAdapters(base, types, filter){
        if(!base){
            base = this
        }
        let adapters = []
        if(base.adapters){
            for(let i = base.adapters.length - 1; i >= 0; i--){ // reverse lookup to find the higher level adapter, so it should be HTML5 compatible already
                if(base.adapters[i].type && types.includes(base.adapters[i].type) && (!filter || filter(base.adapters[i]))){
                    adapters.push(base.adapters[i])
                } else {
                    adapters = adapters.concat(this.findAllAdapters(base.adapters[i], types, filter))
                }
            }
        }
        return adapters
    }
    destroyAdapters(){
        this.adapters.forEach(a => {
            if(a){
                if(a.destroy){
                    if(!a.destroyed){
                        a.destroy()
                    }
                } else if(a.close) {
                    if(a.closed){
                        a.close()
                        a.closed = true
                    }
                } else {
                    console.error('No destroy method for', a)
                }
            }
        })
        this.adapters = []
    }
    dimensions(){
        let dimensions = ''
        if(this._dimensions){
            dimensions = this._dimensions
        } else {
            this.adapters.some(a => {
                if(a._dimensions){
                    dimensions = a._dimensions
                    return true
                }
            })
        }
        return dimensions
    }
    setTimeout(secs){
        if(this.timeout != secs){
            this.timeout = secs
        }
        this.clearTimeout()
        this.timeoutStart = global.time()
        this.timeoutTimer = setTimeout(() => {
            if(this && !this.failed && !this.destroyed && !this.committed){
                console.log('Timeouted engine after '+ (global.time() - this.timeoutStart))
                this.fail('timeout')
            }
        }, secs * 1000)
    }    
    clearTimeout(){
        clearTimeout(this.timeoutTimer)
        this.timeoutTimer = 0
    }
    resetTimeout(){
        this.setTimeout(this.timeout)
    }
    start(){   
        let resolved 
        this.resetTimeout()
        return new Promise((resolve, reject) => {
            this.on('fail', err => {
                if(!resolved){
                    resolved = true
                    reject(err)
                }
            })
            this._start().then(data => {
                if(!resolved){
                    resolve(data)
                }
            }).catch(err => {
                if(!resolved){
                    reject(err)
                }
            })
        })
    }
    startCapture(onData, onFinish){
        this.endCapture()
        let a = this.findLowAdapter(null, ['joiner', 'downloader', 'proxy', 'ffserver']) // suitable adapters for capturing, by priority
        if(a){
            this.capturing = [a, onData, onFinish]
            this.capturing[0].on('data', this.capturing[1])
            global.ui.emit('background-mode-lock', 'capture-'+ this.data.url)
            return true
        }
    }
    endCapture(){
        if(Array.isArray(this.capturing)){
            this.capturing[0].removeListener('data', this.capturing[1])
            this.capturing[2]()
            this.capturing = false
            global.ui.emit('background-mode-unlock', 'capture-'+ this.data.url)
        }
    }
    fail(err){
        if(this && !this.failed && !this.destroyed){
            console.log('fail', err)
            this.failed = err || true
            this.errors.push(err)
            this.emit('fail', err)
            this.destroy()
        }
    }
    destroy(){
        if(!this.destroyed){
            this.destroyAdapters()
            this.endCapture()
            this.destroyed = true
            if(this.committed){
                this.emit('uncommit')
            }
            this.emit('destroy')
            this.removeAllListeners()
            this.adapters.forEach(a => a.destroy())
            this.adapters = []
        }
    } 
}

module.exports = StreamerBaseIntent
