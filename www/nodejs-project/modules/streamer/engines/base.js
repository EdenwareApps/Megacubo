
const Events = require('events'), fs = require('fs')

class StreamerBaseIntent extends Events {
	constructor(data, opts, info){
        super()
        this.mimeTypes = {
            hls: 'application/x-mpegURL', //; codecs="avc1.42E01E, mp4a.40.2"
            mpegts: 'video/MP2T',
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
        this.timeout = Math.max(20, global.config.get('broadcast-start-timeout'))
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
        this.audioTrack = 0
        this.subtitleTrack = null
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
        this.on('error', () => this.unload())
	}
    isTranscoding(){
        if(this.transcoderStarting || this.transcoder){
			return true
		}
		return this.adapters.some(a => a.isTranscoding && a.isTranscoding())
    }
    getTranscodingCodecs(){
        const opts = {audioCodec: 'aac', videoCodec: 'libx264'}
        if(this.codecData){            
            if(this.codecData.video && this.codecData.video.indexOf('h264') != -1){
                opts.videoCodec = 'copy'
            }
            if(this.codecData.audio && this.codecData.audio.indexOf('aac') != -1){
                opts.audioCodec = 'copy'
            }
        }
        return opts
    }
    getTranscodingOpts(){
        return Object.assign({
            workDir: this.opts.workDir, 
            authURL: this.data.source,
            debug: this.opts.debug,
            isLive: this.mediaType == 'live'
        }, this.getTranscodingCodecs())
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
        adapter.mediaType = this.mediaType
        adapter.on('dimensions', dimensions => {
			if(dimensions && this._dimensions != dimensions){
				this._dimensions = dimensions
				this.emit('dimensions', this._dimensions)
			}
        })
        adapter.on('codecData', codecData => this.addCodecData(codecData))
        adapter.on('speed', speed => {
			if(speed > 0 && this.currentSpeed != speed){
				this.currentSpeed = speed
			}
        })
        adapter.on('wait', () => this.resetTimeout())
        adapter.on('fail', this.failListener)
		adapter.on('streamer-connect', () => this.emit('streamer-connect'))
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
			if(bitrate >= 0 && this.bitrate != bitrate){
				this.bitrate = bitrate
				this.emit('bitrate', this.bitrate, this.currentSpeed)
			}
        })
		adapter.committed = this.committed
		if(adapter.bitrate){
			this.bitrate = adapter.bitrate
			this.emit('bitrate', adapter.bitrate, this.currentSpeed)
		}
    }
    disconnectAdapter(adapter){
        adapter.removeListener('fail', this.failListener);
        ['dimensions', 'codecData', 'bitrate', 'speed', 'commit', 'uncommit'].forEach(n => adapter.removeAllListeners(n))
        let pos = this.adapters.indexOf(adapter)
		if(pos != -1){
			this.adapters.splice(pos, 1)
		}
    }
	addCodecData(codecData, ignoreAdapter){
		let changed
		if(!this.codecData){
			this.codecData = {audio: '', video: ''}
		};
		['audio', 'video'].forEach(type => {
			if(codecData[type] && codecData[type] != this.codecData[type]){
				changed = true
				this.codecData[type] = codecData[type]
			}
		})
		if(changed){
			this.emit('codecData', this.codecData)
			this.adapters.forEach(adapter => {
				if(adapter.addCodecData && adapter != ignoreAdapter){
					adapter.addCodecData(codecData)
				}
			})
		}
		return this.codecData
	}
    onFail(err){
        if(!this.destroyed){
            console.log('[' + this.type + '] adapter fail', err)
            this.fail(err)
        }
    }
    findLowAdapter(base, types, filter){
        if(!base){
            base = this
        }
        let adapters = this.findAllAdapters(base, types, filter)
        if(adapters){
            let ret
            for(let i = 0; i < adapters.length; i++){ // not reverse, to find the lower level adapter, useful to get stream download speed
                if(!ret || types.indexOf(adapters[i].type) < types.indexOf(ret.type)){
                    ret = adapters[i]
                }
            }
            return ret
        }
    }
    findAdapter(base, types, filter){
        if(!base){
            base = this
        }
        let adapters = this.findAllAdapters(base, types, filter)
        if(adapters){
            let ret
            for(let i = adapters.length - 1; i >= 0; i--){ // reverse lookup to find the higher level adapter, so it should be HTML5 compatible already
                if(!ret || types.indexOf(adapters[i].type) < types.indexOf(ret.type)){
                    ret = adapters[i]
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
                    adapters.push(...this.findAllAdapters(base.adapters[i], types, filter))
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
        if(this.committed) return
        if(this.timeout != secs){
            this.timeout = secs
        }
        this.clearTimeout()
        this.timeoutStart = global.time()
        this.timeoutTimer = setTimeout(() => {
            if(this && !this.failed && !this.destroyed && !this.committed){
                console.log('Timeouted engine after '+ (global.time() - this.timeoutStart), this.committed)
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
    timeoutStatus(){
        return Math.max(100, (global.time() - this.timeoutStart) / (this.timeout / 100))
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
            this.once('destroy', () => {
                setTimeout(() => { // allow other hooks to process before
                    if(!resolved){
                        resolved = true
                        reject('destroyed')
                    }
                }, 400)
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
	getAudioTracks(){
		if(Array.isArray(this.audioTracks) && this.audioTracks.length){
            return this.audioTracks
        }
		return [
            {id: 0, name: global.lang.DEFAULT, enabled: true}
        ]
	}
	getSubtitleTracks(){
		if(Array.isArray(this.subtitleTracks) && this.subtitleTracks.length){
            return this.subtitleTracks
        }
		return [
            {id: 0, name: global.lang.DEFAULT, enabled: true}
        ]
	}
	selectAudioTrack(trackId){
        this.audioTrack = trackId
        global.ui.emit('audio-track', trackId)
	}
	selectSubtitleTrack(trackId){
        this.subtitleTrack = trackId
        global.ui.emit('subtitle-track', trackId)
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
            this.destroyed = true
            if(this.serverStopper){
                this.serverStopper.stop()
                this.serverStopper = null
            }
            if(this.server){
                this.server.close()
                this.server = null
            }
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
