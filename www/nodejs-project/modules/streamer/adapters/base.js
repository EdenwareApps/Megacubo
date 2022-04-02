
const path = require('path'), fs = require('fs'), http = require('http'), Events = require('events')
const WriteQueueFile = require(global.APPDIR + '/modules/write-queue/write-queue-file')

class StreamerAdapterBase extends Events {
	constructor(url, opts){
		super()
		this.url = url
		this.opts = {
			addr: '127.0.0.1',
			minBitrateCheckSize: 48 * 1024,
			maxBitrateCheckSize: 3 * (1024 * 1024),
			connectTimeout: global.config.get('connect-timeout') || 5,
			bitrateCheckingAmount: 3,
			maxBitrateCheckingFails: 8,
			debug: false,
			port: 0
		};
		this.downloadTimeout = {}
		let ms = this.opts.connectTimeout * 1000
		'lookup,connect,secureConnect,socket,response'.split(',').forEach(s => this.downloadTimeout[s] = ms)
		'send,request'.split(',').forEach(s => this.downloadTimeout[s] = ms * 2)
		this.defaults = this.opts
		if(opts){
			this.setOpts(opts)
		}
		this._dimensions = ''
		this.currentSpeed = -1
		this.connectable = false
		this.adapters = []
		this.bitrate = false
		this.bitrates = []
		this.errors = []
        this.type = 'base'
		this.getBitrateQueue = []
		this.bitrateChecking = false
		this.bitrateCheckFails = 0
		this.bitrateCheckBuffer = {}
		this.downloadLogging = {}
    }
    isTranscoding(){
        if(this.transcoderStarting || this.transcoder){
			return true
		}
		return this.adapters.some(a => a.isTranscoding && a.isTranscoding())
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
	addCodecData(codecData){
		if(!this.codecData){
			this.codecData = {audio: '', video: ''}
		};
		['audio', 'video'].forEach(type => {
			if(codecData[type]){
				this.codecData[type] = codecData[type]
			}
		})
		this.emit('codecData', this.codecData)
		return this.codecData
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
        adapter.on('codecData', codecData => {
			this.addCodecData(codecData)
        })
        adapter.on('speed', speed => {
			if(speed > 0 && this.currentSpeed != speed){
				this.currentSpeed = speed
			}
        })
        adapter.on('fail', this.onFail)
		adapter.on('streamer-connect', () => this.emit('streamer-connect'))
		adapter.committed = this.committed
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
        adapter.removeListener('fail', this.onFail);
        ['dimensions', 'codecData', 'bitrate', 'speed', 'commit', 'uncommit'].forEach(n => adapter.removeAllListeners(n))
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
	getDomain(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0]
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	}
	ext(url){
		return url.split('?')[0].split('#')[0].split('.').pop().toLowerCase()  
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
	findTwoClosestValues(values){
		let distances = [], closest = [], results = []
		values.forEach((n, i) => {
			distances[i] = []
			values.forEach((m, j) => {
				if(i == j){
					distances[i][j] = Number.MAX_SAFE_INTEGER
				} else {
					distances[i][j] = Math.abs(m - n)
				}
			})
			let minimal = Math.min.apply(null, distances[i])
			closest[i] = distances[i].indexOf(minimal)
			distances[i] = minimal
		})
		let minimal = Math.min.apply(null, distances)
		let a = distances.indexOf(minimal)
		let b = closest[a]
		return [values[a], values[b]]		
	}
	md5(txt){
		if(!this.crypto){
			this.crypto = require('crypto')
		}
		return this.crypto.createHash('md5').update(txt).digest('hex')
	}
	saveBitrate(bitrate){
		let prevBitrate = this.bitrate
		this.bitrates.push(bitrate)
		if(this.bitrates.length >= 3){
			this.bitrate = this.findTwoClosestValues(this.bitrates).reduce((a, b) => a + b, 0) / 2
			this.bitrates = this.bitrates.slice(-3)
		} else {
			this.bitrate = this.bitrates.reduce((a, b) => a + b, 0) / this.bitrates.length
		}
		if(this.bitrate != prevBitrate){
			this.emit('bitrate', this.bitrate, this.currentSpeed)
		}
	}
	pumpGetBitrateQueue(){
		this.bitrateChecking = false
		if(this.getBitrateQueue.length && !this.destroyed){
			this.getBitrate(this.getBitrateQueue.shift())
		}
	}
	getTSFromM3U8(url, cb){
		const download = new Download({
			url,
			responseType: 'text'
		})
		download.on('end', body => {
			let matches = String(body).match(new RegExp('^[^#].+\\..+$','m'))
			if(matches){
				//TODO: Tem que usar a classe toda, pra poder usar o .currentURL no absolutize, lide também com master playlists, use um .getTSFromM3U8			
				const basename = matches[0].trim()
				const nurl = this.absolutize(basename, download.currentURL)
				if(nurl && nurl != url){
					if(basename.toLowerCase().indexOf('.m3u8') == -1){
						cb(nurl)
					} else {
						this.getTSFromM3U8(nurl, cb)
					}
				} else {
					cb(false)
				}
			} else {
				cb(false)
			}
			download.destroy()
		})
		download.start()
	}
	getBitrateHLS(url){
		this.getTSFromM3U8(url, url => {
			if(url){
				this.getBitrate(url)
			}
		})
	}
	getBitrate(file){
		if(this.bitrateChecking){
			if(!this.getBitrateQueue.includes(file)){
				this.getBitrateQueue.push(file)
			}
			return
		}
		this.bitrateChecking = true
		const isHTTP = file.match(new RegExp('^((rtmp|rtsp|https?://)|//)'))
		const next = (err, stat) => {
			if(this.destroyed || this.bitrates.length >= this.opts.bitrateCheckingAmount || this.bitrateCheckFails >= this.opts.maxBitrateCheckingFails){
				this.bitrateChecking = false
				this.getBitrateQueue = []
				this.clearBitrateSampleFiles()
			} else if(err || (!isHTTP && stat.size < this.opts.minBitrateCheckSize)) {
				this.pumpGetBitrateQueue()
			} else {
				//console.log('getBitrate', file, this.url, isHTTP ? null : stat.size, this.opts.minBitrateCheckSize, traceback())
				global.ffmpeg.bitrate(file, (err, bitrate, codecData, dimensions, nfo) => {
					if(!isHTTP){
						fs.unlink(file, () => {})
					}
					if(!this.destroyed){
						if(codecData){
							this.addCodecData(codecData)
						}
						if(dimensions && !this._dimensions){
							this._dimensions = dimensions
							this.emit('dimensions', this._dimensions)
						}
						if(err){
							this.bitrateCheckFails++
							this.opts.minBitrateCheckSize += this.opts.minBitrateCheckSize * 0.5
							this.opts.maxBitrateCheckSize += this.opts.maxBitrateCheckSize * 0.5
						} else {
							if(this.opts.debug){
								console.log('getBitrate', err, bitrate, codecData, dimensions, this.url)
							}
							if(bitrate){
								this.saveBitrate(bitrate)	
							}
							if(this.opts.debug){
								console.log('[' + this.type + '] analyzing: ' + file, isHTTP ? '' : 'sample len: '+ global.kbfmt(stat.size), 'bitrate: '+ global.kbsfmt(this.bitrate), this.bitrates, this.url, nfo)
							}
						}
						this.pumpGetBitrateQueue()
					}
				}, stat.size)
			}
		}
		if(isHTTP){
			next(null, {})
		} else {
			fs.stat(file, next)
		}
	}
	clearBitrateSampleFiles(){
		Object.keys(this.bitrateCheckBuffer).forEach(id => {
			let file = this.bitrateCheckBuffer[id].file
			this.bitrateCheckBuffer[id].destroy()
			fs.unlink(file, () => {})
		})
		this.bitrateCheckBuffer = {}
	}
	bitrateSampleFilename(id){ // normally id is the URL
		let filename = id.split('?')[0].split('/').pop()
		if(!filename){
			filename = String(Math.random())
		}
		if(filename.length >= 42){ // Android filename length limit may be lower https://www.reddit.com/r/AndroidQuestions/comments/65o0ds/filename_50character_limit/
			filename = this.md5(filename)
		}
		return global.streamer.opts.workDir +'/'+ global.sanitize(filename)
	}
	collectBitrateSample(chunk, offset, len, id = 'default'){
		this.downloadLog(len)
		if(this.committed && this.bitrates.length < this.opts.bitrateCheckingAmount && this.bitrateCheckFails < this.opts.maxBitrateCheckingFails){
			if(typeof(this.bitrateCheckBuffer[id]) == 'undefined'){
				let file = this.bitrateSampleFilename(id)
				this.bitrateCheckBuffer[id] = new WriteQueueFile(file)
			}
			this.bitrateCheckBuffer[id].write(chunk, offset)
			if(this.bitrateCheckBuffer[id].written >= this.opts.maxBitrateCheckSize){
				this.finishBitrateSample(id)
				return false
			}
			return true
		}
	}
	finishBitrateSample(id = 'default'){
		if(typeof(this.bitrateCheckBuffer[id]) != 'undefined'){
			if(this.bitrates.length < this.opts.bitrateCheckingAmount){
				this.bitrateCheckBuffer[id].ready(() => {
					if(this.bitrateCheckBuffer[id].written >= this.opts.minBitrateCheckSize){
						this.getBitrate(this.bitrateCheckBuffer[id].file)
					}
				})
			}
		}
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
		if(!data){
			return 0
		} else if(Array.isArray(data)) {
			let len = 0
			data.forEach(d => {
				len += this.len(d)
			})
			return len
		} else if(typeof(data.byteLength) != 'undefined') {
			return data.byteLength
		} else {
			return data.length
		}
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
			this.clearBitrateSampleFiles()
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

