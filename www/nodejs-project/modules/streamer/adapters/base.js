
const path = require('path'), fs = require('fs'), http = require('http')
const Events = require('events'), Writer = require('../../writer')
const BitrateChecker = require('../utils/bitrate-checker')

class StreamerAdapterBase extends Events {
	constructor(url, opts, data){
		super()
		this.data = data || {}
		this.url = url
		this.opts = {
			addr: '127.0.0.1',
			debug: false,
			port: 0
		};
		this.defaults = this.opts
		if(opts){
			this.setOpts(opts)
		}
		this._dimensions = ''
		this.currentSpeed = -1
		this.connectable = false
		this.adapters = []
		this.bitrate = false
		this.bitrateChecker = new BitrateChecker()
		this.bitrateChecker.on('codecData', this.addCodecData.bind(this))
		this.bitrateChecker.on('dimensions', (...args) => this.emit('dimensions', ...args))
		this.errors = []
        this.type = 'base'
		this.downloadLogging = {}
    }
	getDefaultRequestHeaders(headers={}){		
		if(this.data){
			const ua = this.data['user-agent'] || this.opts.userAgent
			const referer = this.data['referer'] || this.opts.referer
			if(ua) headers['user-agent'] = ua
			if(referer) headers['referer'] = referer
		}
		return headers
	}
    isTranscoding(){
        if(this.transcoderStarting || this.transcoder){
			return true
		}
		return this.adapters.some(a => a.isTranscoding && a.isTranscoding() === true)
    }
    setOpts(opts){
        if(opts && typeof(opts) == 'object'){     
			Object.keys(opts).forEach((k) => {
				if(['debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
					this.on(k, opts[k])
				} else {
					this.opts[k] = opts[k]
					if(typeof(this.defaults[k]) == 'undefined'){
						this.defaults[k] = opts[k]
					}
				}
            })
        }
	}
	addCodecData(codecData, ignoreAdapter){
		let changed
		if(!this.codecData){
			this.codecData = {audio: '', video: ''}
		};
		['audio', 'video'].forEach(type => {
			if(codecData[type] && !this.codecData[type]){
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
    connectAdapter(adapter){  
		this.adapters.push(adapter) 
        adapter.mediaType = this.mediaType
		adapter.on('outside-of-live-window', () => this.emit('outside-of-live-window'))
        adapter.on('dimensions', dimensions => {
			if(dimensions && this._dimensions != dimensions){
				this._dimensions = dimensions
				this.emit('dimensions', this._dimensions)
			}
        })
        adapter.on('codecData', codecData => {
			this.addCodecData(codecData)
        })
        adapter.on('speed', speed => {
			if(speed > 0 && this.currentSpeed != speed){
				this.currentSpeed = speed
			}
        })
		adapter.on('wait', () => this.emit('wait'))
        adapter.on('fail', this.onFail)
		adapter.on('streamer-connect', () => this.emit('streamer-connect'))
		adapter.committed = this.committed
        this.on('commit', () => {
            adapter.emit('commit')
            if(!adapter.committed) {
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
		if(adapter.bitrate){
			if(adapter.bitrate >= 0 && this.bitrate != adapter.bitrate) {
				this.bitrate = adapter.bitrate
				this.emit('bitrate', adapter.bitrate, this.currentSpeed)
			}
		}
    }
    disconnectAdapter(adapter){
        adapter.removeListener('fail', this.onFail);
        ['dimensions', 'codecData', 'bitrate', 'speed', 'commit', 'uncommit', 'wait'].forEach(n => adapter.removeAllListeners(n))
		let pos = this.adapters.indexOf(adapter)
		if(pos != -1){
			this.adapters.splice(pos, 1)
		}
    }
    onFail(err){
        if(!this.destroyed){
            console.log('[' + this.type + '] adapter fail', err)
            this.fail(err)
        }
    }
	ext(url){
		return String(url).split('?')[0].split('#')[0].split('.').pop().toLowerCase()  
	}
	proto(url, len){
		var ret = '', res = url.match(new RegExp('^([A-Za-z0-9]{2,6}):'))
		if(res){
			ret = res[1]
		} else if(url.match(new RegExp('^//[^/]+\\.'))){
			ret = 'http'
		}
		if(ret && typeof(len) == 'number'){
			ret = ret.substr(0, len)
		}
		return ret
	}
	md5(txt){
		if(!this.crypto){
			this.crypto = require('crypto')
		}
		return this.crypto.createHash('md5').update(txt).digest('hex')
	}
	concatSlice(bufArr, limit){
		let len = 0
		bufArr.forEach((chunk, i) => {
			if(len >= limit){
				bufArr[i] = null
			} else if((len + chunk.length) > limit){
				let exceeds = (len + chunk.length) - limit
				bufArr[i] = bufArr[i].slice(0, chunk.length - exceeds)
			} else {
				len += chunk.length
			}
		})
		return Buffer.concat(bufArr.filter(c => c))
	}
	downloadLog(bytes){
		if(this.downloadLogCalcTimer){
			clearTimeout(this.downloadLogCalcTimer)
		}
		let nowMs = global.time(), now = parseInt(nowMs)
		if(typeof(this.downloadLogging[now]) == 'undefined'){
			this.downloadLogging[now] = bytes
		} else {
			this.downloadLogging[now] += bytes
		}
		let downloadLogCalcMinInterval = 1 // 1s
		if(!this.downloadLogCalcLastTime || this.downloadLogCalcLastTime < (nowMs - downloadLogCalcMinInterval)){
			this.downloadLogCalcLastTime = nowMs
			this.downloadLogCalc()
		} else {
			let delay = (this.downloadLogCalcLastTime + downloadLogCalcMinInterval) - nowMs
			this.downloadLogCalcTimer = setTimeout(() => this.downloadLogCalc(), delay * 1000)
		}
	}
	downloadLogCalc(){
		let now = parseInt(global.time())
		let ks = Object.keys(this.downloadLogging)
		if(ks.length){
			let windowSecs = 15, ftime = 0, since = now - windowSecs, downloaded = 0
			ks.reverse().forEach((time, i) => {
				let rtime = parseInt(time)
				if(typeof(rtime) == 'number' && rtime){
					if(rtime >= since || i < 10){ // keep at minimum 5 to prevent currentSpeed=N/A
						if(!ftime || ftime > rtime){
							ftime = rtime
						}
						downloaded += this.downloadLogging[time]
					} else {
						delete this.downloadLogging[time]
					}
				}					
			})
			let speed = parseInt(downloaded / (now - ftime)) * 8 // bytes to bits
			/*
			if(this.opts.debug){
				console.log('[' + this.type + '] download speed:', downloaded, now, ftime, speed, global.kbsfmt(speed) + ((this.bitrate) ? ', required: ' + global.kbsfmt(this.bitrate): ''))
			}
			*/
			if(speed != this.currentSpeed){
				this.currentSpeed = speed
				this.emit('speed', this.currentSpeed)
			}
		}
	}
	removeHeaders(headers, keys){
		keys.forEach(key => {
			if(['accept-encoding', 'content-encoding'].includes(key)){
				headers[key] = 'identity'
			} else {
				delete headers[key]
			}
		})
		return headers
	}
	len(data){
		if (!data) {
			return 0
		}
		if (Array.isArray(data)) {
			return data.reduce((acc, val) => acc + this.len(val), 0)
		}
		return data.byteLength || data.length || 0
	}
	ip(){
		return this.opts.addr
	}
	setCallback(cb){
		this.once('ready', () => {
			if(typeof(cb) == 'function'){
				cb(true)
				cb = null
			}
		})
		this.once('fail', () => {
			if(typeof(cb) == 'function'){
				cb(false)
				cb = null
			}
		})
	}
	fail(err){
		if(!this.destroyed && !this.failed){
			this.failed = err || true
            console.log('[' + this.type + '] fail', err)
			this.errors.push(err)
			if(this.opts.debug){
				console.log('[' + this.type + '] error', this.errors)
			}
			this.emit('fail', err)
			process.nextTick(() => this.destroy())
		}
	}
	destroy(){
		if(this.opts.debug){
			console.log('[' + this.type + '] destroy', global.traceback())
		}
		if(!this.destroyed){
			this.destroyed = true
			this.emit('destroy')
			this.bitrateChecker.clearSamples()
            if(this.serverStopper){
                this.serverStopper.stop()
                this.serverStopper = null
            }
            if(this.server){
                this.server.close()
                this.server = null
            }
            this.adapters.forEach(a => a.destroy())
			this.downloadLogging = {}
			if(this.server){
				this.server.close()
			}
			this.removeAllListeners()
			this.on = this.emit = () => {}
		}
	}	
}

module.exports = StreamerAdapterBase

