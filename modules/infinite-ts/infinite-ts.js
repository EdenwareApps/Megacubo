
const tmpDir = require('os').tmpdir(), http = require('http'), path = require('path'), fs = require('fs') 
const Writer = require('./writer'), Transform = require('stream').Transform
const util = require('util'), Events = require('events')

function Hermes(options){
	// allow use without new
	if (!(this instanceof Hermes)) {
		return new Hermes(options)
	}
	Transform.call(this, options)
}

util.inherits(Hermes, Transform)
	
class TSInfiniteProxy extends Events {
	constructor(url, opts){
		super()
		this.url = url
		this.opts = {
			debug: false,
			idleTimeout: 10000,
			initialErrorLimit: 2, // at last 2
			errorLimit: 5,
			minNeedleSize: 36 * 1024, // needle
			needleSize: 128 * 1024, // needle
			backBufferSize: 12 * (1024 * 1024), // stack
			sniffingSizeLimit: 128 * 1024, 
			delaySecsLimit: 3,
			minBitrateCheckSize: 2 * (1024 * 1024),
			bitrateCheckingAmount: 3,
			quickRecoveringTimeout: 10,
			delayLevelIncrement: 0.1,
			ffmpeg: path.resolve('ffmpeg/ffmpeg')
		}
		this.bitrate = false
		this.downloadLogging = {}
		this.clients = []
		this.bitrates = []
		this.port = 0
		this.endpoint = ''
		this.endpointName = 'infinite.ts'
		this.connectable = false
		if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
			this.currentRequest.abort()
			this.currentRequest = false
		}
		if(this.idleTimer){
			clearTimeout(this.idleTimer)
			this.idleTimer = 0
		}
		this.reset()
		if(opts){
			Object.keys(opts).forEach((k) => {
				if(['request', 'debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
					this.on(k, opts[k])
				} else {
					this.opts[k] = opts[k]
				}
			})
		}
		this.mediainfo = new MediaInfo(this.opts)
		this.hermes = Hermes
        this.hermes.prototype._transform = (data, enc, cb) => {
			this.handleData(data, enc, cb)
		}
        this.server = http.createServer((request, client) => {
			if(request.url != ('/' + this.endpointName)){
				client.end()
				return 
			}
			if(this.destroyed){
				if(this.server){
					this.server.close()
				}
				return
			}
			this.clients.push(client)
			clearTimeout(this.idleTimer)
            var closed, writer = new Writer(client), headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'video/MP2T',
				'Transfer-Encoding': 'chunked',
				'Content-Length': 99999999999999
            }
            if(this.opts.debug){
                this.opts.debug('[ts] serving (timeout reset)', this.url)
            }
            this.emit('client-connect', client)
            var code = 200, handler = (buffer) => {
				if(this.destroyed){
					return
				}
				if(writer){
					writer.write(buffer, 'binary')
				}
            }, clean = () => {
				if(writer){
					writer.end()
					writer = false
				}
			}
            client.writeHead(code, headers)
            client.on('close', () => {
				clean()
				if(this.destroyed){
					return
				}
				let i = this.clients.indexOf(client)
				if(i != -1){
					delete this.clients[i]
					this.clients = this.clients.filter((item) => {
						return item !== undefined
					})
				}
				if(!this.clients.length){
					let finish = () => {
						if(this.opts.debug){
							this.opts.debug('[ts] timeout reached')
						}
						this.emit('timeout', this.clients ? this.clients.length : 0)
						this.destroy()
					}
					if(this.opts.idleTimeout){
						if(this.opts.debug){
							this.opts.debug('[ts] timeout start')
						}
						clearTimeout(this.idleTimer)
						this.idleTimer = setTimeout(finish, this.opts.idleTimeout)
					} else {
						finish()
					}
				}
				if(this.opts.debug){
					this.opts.debug('[ts] disconnect', this.clients.length)
				}
				this.emit('client-disconnect', client)
				this.removeListener('destroy', clean)
				this.removeListener('broadcast', handler)				
			})
			if(this.opts.debug){
				this.opts.debug('[ts] new connection', request, client)
			}
            this.recover(handler)
			this.on('broadcast', handler)            
			this.on('destroy', clean)
		}).listen(0, "127.0.0.1", (err) => {
			if (err) {
				if(this.opts.debug){
					this.opts.debug("unable to listen on port", err);
				}
			}
			this.port = this.server.address().port
			this.endpoint = 'http://127.0.0.1:'+this.port+'/'+this.endpointName
			this.emit('ready', this.endpoint)
		})
		this.pump()
	}
	getBitrate(){
		if(this.len(this.backBuffer) >= this.opts.minBitrateCheckSize && this.bitrates.length < this.opts.bitrateCheckingAmount && !this.destroyed){
			let i = Math.random(), tmpFile = tmpDir + path.sep + i + '.TS', buffer = Buffer.concat(this.backBuffer)
			fs.writeFile(tmpFile, buffer, (err) => {
				this.mediainfo.bitrate(tmpFile, (err, bitrate, codecData) => {
					if(bitrate){
						this.bitrates.push(bitrate)
						this.bitrate = this.bitrates.reduce((a, b) => a + b, 0) / this.bitrates.length
					}
					if(this.opts.debug){
						this.opts.debug('[ts] analyzing: ' + tmpFile, 'sample len: '+ this.kfmt(this.len(buffer))+'B', 'bitrate: '+ this.kfmt(this.bitrate)+'ps', this.bitrates)
					}
					if(codecData && codecData.video){
						this.emit('codecData', codecData)	
					}
					fs.unlink(tmpFile, () => {})
				})
			})
		}
	}
	speed(){
		let u = this.time(), downloaded = 0, started = 0, maxSampleLen = 10 * (1024 * 1024)
		Object.keys(this.downloadLogging).reverse().forEach((time) => {
			let rtime = Number(time)
			if(typeof(rtime) == 'number' && rtime){
				if(downloaded < maxSampleLen){ // keep
					downloaded += this.downloadLogging[rtime]
					if(!started || rtime < started){
						started = rtime
					}
				} else {
					delete this.downloadLogging[time]
				}
			}			
		})
		let speed = parseInt(downloaded / (u - started))
		if(this.opts.debug){
			this.opts.debug('[ts] download speed:', this.kfmt(speed) + 'Bps' + ((this.bitrate) ? ', required: ' + this.kfmt(this.bitrate) + 'Bps': ''))
		}
		return speed
	}
	prepareQuickRecovering(){
		this.quickRecovering = this.time()
	}
	recover(cb){
		if((this.quickRecovering + this.opts.quickRecoveringTimeout) > this.time()){
			if(this.opts.debug){
				this.opts.debug('[ts] recovering', this.backBuffer.length)
			}
			if(this.backBuffer.length){
				cb(Buffer.concat(this.backBuffer))
			}
		}
	}
	time(){
		return ((new Date()).getTime() / 1000)
	}
	kfmt(num, digits) {
		var si = [
			{ value: 1, symbol: "" },
			{ value: 1E3, symbol: "K" },
			{ value: 1E6, symbol: "M" },
			{ value: 1E9, symbol: "G" },
			{ value: 1E12, symbol: "T" },
			{ value: 1E15, symbol: "P" },
			{ value: 1E18, symbol: "E" }
		]
		var i, rx = /\.0+$|(\.[0-9]*[1-9])0+$/
		for (i = si.length - 1; i > 0; i--) {
			if (num >= si[i].value) {
				break
			}
		}
		return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol
	}
	handleData(data, enc, cb){
		if(this.opts.debug){
			// this.opts.debug('[ts] data received', this.destroyed) // , this.destroyed, this.currentRequest, this.intent)
		}
		if(!data){
			return
		}
		if(this.destroyed){
			return
		}
		let skip, len = this.len(data)
		if(!len){
			skip = true
		} else if(len < this.opts.sniffingSizeLimit){
			let bin = this.isBin(data)
			if(!bin){
				skip = true
				this.triggerError('bad data', String(data))
			}
		}
		if(!skip){
			this.errors = 0
			this.connectable = true
			// this.downloadLogging[this.time()] = len // moved to output()
			if(Array.isArray(this.nextBuffer)){
				this.nextBuffer.push(data)
				if(this.len(this.nextBuffer) >= this.opts.needleSize){
					if(this.opts.debug){
						this.opts.debug('[ts] calling join() from handleData')
					}
					this.join()
				}
			} else {
				this.output(data)
			}
		}
		cb()
	}
	isBin(buf){
		let bin, sample = buf.slice(0, 24).toString()
		for (let i = 0; i < sample.length; i++) {
			let chr = sample.charCodeAt(i)
			// if (chr === 65533 || chr <= 8) {
			if (chr > 127 || chr <= 8) { // https://stackoverflow.com/questions/10225399/check-if-a-file-is-binary-or-ascii-with-node-js
				bin = true
				break
			}
		}
		return bin
	}
	join(){
		let done, needle = Buffer.concat(this.nextBuffer), ns = this.len(needle)
		if(ns >= this.opts.minNeedleSize){
			let start = this.time(), stack = Buffer.concat(this.backBuffer), pos = stack.lastIndexOf(needle)
			if(pos != -1){
				let sl = this.len(stack)
				this.bytesToIgnore = sl - pos
				if(this.opts.debug && this.bytesToIgnore){
					this.opts.debug('[ts] ignoring next ' + this.kfmt(this.bytesToIgnore) + 'B', 'took ' + Math.round(this.time() - start, 1) + 's')
				}
			} else {
				if(this.opts.debug){
					this.opts.debug('[ts] no intersection', 'took ' + Math.round(this.time() - start, 1) + 's')
				}
			}
		} else {
			if(this.opts.debug){
				this.opts.debug('[ts] insufficient needle size, bypassing', this.kfmt(ns) + 'B' + ' < ' + this.kfmt(this.opts.minNeedleSize) + 'B', needle)
			}
		}
		this.output(needle) // release nextBuffer, bytesToIgnore is the key here to joining
		this.nextBuffer = false
		this.getBitrate()
	}
	output(data){
		let len = this.len(data), bLen = 0
		if(this.bytesToIgnore){
			if(len <= this.bytesToIgnore){
				this.bytesToIgnore -= len
				if(this.opts.debug){
					// this.opts.debug('[ts] Discarded chunk with ' + l + ' bytes') 
					this.opts.debug('[ts] discarding') 
				}
				return
			} else {
				data = data.slice(this.bytesToIgnore)
				this.bytesToIgnore = 0
				len -= this.bytesToIgnore
				if(this.opts.debug){
					// this.opts.debug('[ts] Discarded ' + l + ' bytes') 
					this.opts.debug('[ts] discarding') 
				}
			}
		}
		this.downloadLogging[this.time()] = len
		this.emit('broadcast', data)
		this.backBuffer.push(data) // collect backBuffer for future joining calc
		this.backBuffer = this.backBuffer.reverse().filter((b, i) => {
			bLen += this.len(b)
			return bLen < this.opts.backBufferSize
		}).reverse()		
	}
	pump(){
		if(this.opts.debug){
			this.opts.debug('[ts] pump', this.destroyed)
		}
		if(this.destroyed){
			return
		}
		let ctype = '', statusCode = 0, headers = {}, h = new this.hermes()
		let next = () => {
			next = null
			if(this.opts.debug){
				this.opts.debug('[ts] host closed', Array.isArray(this.nextBuffer))
			}
			if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
				this.currentRequest.abort()
			}
			h.end()
			if(this.destroyed){
				return
			}
			if(Array.isArray(this.nextBuffer)){ // we've not joined the recent connection data yet, insufficient needle size
				if(this.opts.debug){
					this.opts.debug('[ts] calling join() from pump after connection close')
				}
				this.join() // join prematurely to be ready for next connection anyway
			}
			this.bytesToIgnore = 0 // bytesToIgnore should be discarded here, as we're starting a new connection which will return data in different offset
			this.nextBuffer = []
			this.currentRequest = h = null
			let speed = this.speed()
			/* break leaking here by avoiding nested call to next pump */
			if([400, 401, 403].indexOf(statusCode) == -1 && (!this.bitrate || speed < this.bitrate)){
				this.delayLevel = 0
				process.nextTick(this.pump.bind(this))
			} else {
				if(this.delayLevel < this.opts.delaySecsLimit){
					this.delayLevel += this.opts.delayLevelIncrement
				}
				setTimeout(this.pump.bind(this), this.opts.delaySecsLimit * 1000)
				if(this.opts.debug){
					this.opts.debug('[ts] delaying ' + this.delayLevel + ' seconds', statusCode == 200, ctype.indexOf('text') == -1, (!this.bitrate || speed < this.bitrate))
				}
			}
		}
		this.currentRequest = this.opts.request({
			method: 'GET', 
			uri: this.url, 
			ttl: 0
		})
		this.currentRequest.on('error', (err) => {
			if(this.destroyed){
				return
			}
			if(!this.triggerError('timeout ' + JSON.stringify(err))){
				next()
			}
		})
		this.currentRequest.on('response', (response) => {
			if(this.destroyed){
				return
			}
            if(this.opts.debug){
				if(this.opts.debug){
					this.opts.debug('[ts] headers received', response.statusCode, response) // 200
				}
			}
			statusCode = response.statusCode
			headers = response.headers
			ctype = typeof(headers['content-type']) != 'undefined' ? headers['content-type'] : ''
			if((!statusCode || statusCode >= 400) || ctype.indexOf('text') != -1){
				this.triggerError('bad response', ctype, this.errors, statusCode, headers)
				if(!this.destroyed){ // recheck after triggerError
					if(ctype.indexOf('text') != -1){
						let errorpage = []
						this.currentRequest.on('data', chunk => {
							errorpage.push(chunk)
						})
						this.currentRequest.on('end', () => {
							if(this.opts.debug){
								this.opts.debug('[ts] errorpage', Buffer.concat(errorpage).toString())
							}
						})
					}
				}
			} else {
				if(this.currentRequest){
					this.currentRequest.pipe(h)
				}
			}
		})
		this.currentRequest.on('end', () => {
			next()
		})
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
	endRequest(){
		if(this.currentRequest){
			try {
				this.currentRequest.abort()
			} catch(e) {
				if(this.opts.debug){
					this.opts.debug('endRequest error', e)	
				}
				this.currentRequest.end()
			}
		}
	}
	reset(){
		if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
			this.currentRequest.abort()
			this.currentRequest = false
		}
		if(this.idleTimer){
			clearTimeout(this.idleTimer)
			this.idleTimer = 0
		}
		this.quickRecovering = this.time()
		this.needle = false
		this.backBuffer = []
		this.nextBuffer = false
		this.errors = 0
		this.bytesToIgnore = 0
		this.delayLevel = 0
	}
	triggerError(...args){
		this.errors++
		if(this.opts.debug){
			this.opts.debug('[ts] error', this.errors, args)
		}
		if(this.errors >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)){
			if(this.opts.debug){
				this.opts.debug('[ts] error limit reached', this.errors, this.opts.errorLimit)
			}
			this.destroy()
			return true
		}
	}
	destroy(){
		if(this.opts.debug){
			this.opts.debug('[ts] destroy')
		}
		this.endRequest()
		if(!this.destroyed){
			if(this.opts.debug){
				this.opts.debug('[ts] destroying...', this.currentRequest)
			}
			this.destroyed = true
			this.emit('destroy')
			this.server.close()
			Object.keys(this).forEach(k => {
				if(k != 'opts' && typeof(this[k]) == 'object'){
					this[k] = null
				}
			})
			this.emit = () => {}
		}
	}	
}

class MediaInfo {
	constructor(opts){
		this.opts = {
			debug: false
		}
		if(opts){
			Object.keys(opts).forEach(k => {
				this.opts[k] = opts[k]
			})
		}
	}
	duration(nfo) {
	    var dat = nfo.match(new RegExp('[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{2}'))
	    return dat ? this.clockToSeconds(dat[0]) : 0
	}
	codecs(nfo) {
	    var video = nfo.match(new RegExp("Video: ([^,\r\n]+)")), audio = nfo.match(new RegExp("Audio: ([^,\r\n]+)"))
	    video = Array.isArray(video) ? video[1] : ''
	    audio = Array.isArray(audio) ? audio[1] : ''
	    return {video, audio}
	}
	rawBitrate(nfo){
		// bitrate: 1108 kb/s
		let raw = nfo.match(new RegExp("bitrate: ([0-9]+) ([a-z]+)"))
		if(raw.length){
			let n = parseFloat(raw[1])
			switch(raw[2]){
				case "kb":
					n = n * 1024
					break
				case "mb":
					n = n * (1024 * 1024)
					break
			}
			return parseInt(n)
		}
	}
	bitrate(file, cb, length){
		var next = () => {
			this.info(file, nfo => {
				if(nfo){
					let codecs = this.codecs(nfo), rate = this.rawBitrate(nfo)
					if(!rate){
						rate = parseInt(length / this.duration(nfo))
					}
					cb(null, rate, codecs)
				} else {
					cb('FFmpeg unable to process ' + file + ' ' + JSON.stringify(nfo), 0, codecs)
				}
			})
		}
		if(length){
			next()
		} else {
			fs.stat(file, (err, stat) => {
				if(err) { 
					cb('File not found or empty.', 0, false)
				} else {
					length = stat.size
					next()
				}
			})
		}
	}
	info(path, callback){
		if(!this.spawn){
			this.spawn = require('child_process').spawn
		}
		var data = ''
		var child = this.spawn(this.opts.ffmpeg, [
			'-i', this.fmtSlashes(path)
		])
		child.stdout.on('data', function(chunk) {
			data += String(chunk)
		})
		child.stderr.on('data', function(chunk) {
			data += String(chunk)
		})
		child.stderr.on('error', function(err) {
			if(this.opts.debug){
				this.opts.debug('MediaInfo.info() err', err, data)
			}
		})
		var timeout = setTimeout(() => {
			child.kill()
		}, 10000)
		child.on('close', (code) => {
			if(this.opts.debug){
				this.opts.debug('MediaInfo.info() ', path, fs.statSync(path), code, data)
			}
			clearTimeout(timeout)
			callback(data, code)
		})
	}
	clockToSeconds(str) {
		var cs = str.split('.'), p = cs[0].split(':'), s = 0, m = 1
		while (p.length > 0) {
			s += m * parseInt(p.pop(), 10)
			m *= 60
		}    
		if(cs.length > 1 && cs[1].length >= 2){
			s += parseInt(cs[1].substr(0, 2)) / 100
		}
		return s
	}
	fmtSlashes(file){
		return file.replace(new RegExp("[\\\\/]+", "g"), "/")
	}
}

module.exports = TSInfiniteProxy
