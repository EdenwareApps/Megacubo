const Events = require('events'), parseRange = require('range-parser'), got = require('./got-wrapper')

class Download extends Events {
   constructor(opts){
	   	super()
		this.opts = {
			debug: false,
			keepalive: false,
			maxAuthErrors: 2,
			retries: 3,
			headers: {
				'accept': '*/*',
				'user-agent': global.config.get('ua'),
				'accept-language': global.lang.locale + ';q=0.9, *;q=0.5'
			},
			timeout: 5,
			followRedirect: false,
			decompress: true
		}		
		if(opts){
			if(opts.headers){
				opts.headers = Object.assign(this.opts.headers, opts.headers)
			}
			this.opts = Object.assign(this.opts, opts)
		}
		this.currentURL = this.opts.url
		this.opts.headers['connection'] = this.opts.keepalive ? 'keep-alive' : 'close'
		this.buffer = []
		this.failed = false
		this.retryCount = 0
		this.received = 0
		this.acceptRanges = false
		this.receivingRange = false
		this.requestingRange = false
		this.headersSent = false
		this.contentLength = -1
		this.totalContentLength = -1
		this.authErrors = 0
		this.statusCode = 0
		this.ignoreBytes = 0
		this.retryDelay = 100
		this.preventDestroy = false
		if(typeof(this.opts.headers['range']) != 'undefined'){
			this.checkRequestingRange(this.opts.headers['range'])
		}
		this.stream = this.connect()
	}
	checkRequestingRange(range){
		const maxInt = Number.MAX_SAFE_INTEGER
		const ranges = parseRange(maxInt, range)
		if (Array.isArray(ranges)) { // TODO: enable multi-ranging support
			this.requestingRange = ranges[0]
			if(this.requestingRange.end == (maxInt - 1)){ // remove dummy value
				delete this.requestingRange.end
			}
			if(this.requestingRange.end && this.requestingRange.end > 0){
				this.contentLength = this.requestingRange.end - this.requestingRange.start
			}
		}
	}
	connect(){
		if(this.destroyed) return
		const opts = {
			responseType: 'buffer',
			url: this.currentURL,		
			decompress: this.opts.decompress,
			followRedirect: this.opts.followRedirect,
			retry: 0,
			headers: this.opts.headers,
			throwHttpErrors: false
		}
		if(this.opts.downloadLimit){
			opts.downloadLimit = this.opts.downloadLimit
		}
    	const requestHeaders = this.opts.headers
    	if(this.requestingRange){
			let range = 'bytes='
			range += (this.requestingRange.start + this.received) + '-'
			if(this.requestingRange.end){
				range += this.requestingRange.end
			}
			requestHeaders['range'] = range // we dont know yet if the server support ranges, so check again on parseResponse
		} else if(this.acceptRanges) {
			requestHeaders['range'] = 'bytes=' + this.received + '-'
		} else {
			if(this.received){
				this.ignoreBytes = this.received // ignore data already received on last connection so
			}
		}
		opts.headers = requestHeaders
		opts.timeout = this.getTimeoutOptions()
		if(this.opts.debug){
			console.log('>> Download request', this.received, opts.headers.range, this.requestingRange, this.opts.headers['range'], global.traceback())
		}
		const stream = (this.opts.keepalive ? got.ka : got).stream(opts)
		stream.on('redirect', response => {
			if(this.opts.debug){
				console.log('>> Download redirect', response.headers['content-range'], opts.headers.range)
			}
			if(response.headers && response.headers['location']){
				this.currentURL = this.absolutize(response.headers['location'], this.currentURL)
			}
			if(!this.opts.followRedirect){
				this.checkRedirect(response)
				this.end()
			}
		})
		stream.on('response', this.parseResponse.bind(this))
		stream.on('data', () => {}) // if no data handler on stream, response.on('data') will not receive too, WTF!
		stream.on('error', this.errorCallback.bind(this))
		stream.on('download-error', this.errorCallback.bind(this)) // from got-wrapper hook
		stream.on('end', () => {
			if(this.opts.debug){
				console.log('>> Download finished')
			}
			this.delayNext()
		})
		return stream
	}
	errorCallback(err){
		if(err.response){
			if(this.checkRedirect(err.response)){
				return
			}
			this.parseResponse(err.response)
		}
		if(this.opts.debug){
			console.warn('>> Download error', err, global.traceback())
		}
		if(this.listenerCount('error')){
			this.emit('error', err)
		}
		this.delayNext()
	}
    absolutize(path, url){
        if(path.match(new RegExp('^[htps:]*?//'))){
            return path
        }
        let uri = new URL(path, url)
        return uri.href
    }
	getTimeoutOptions(){
		let timeout = {} 
		if(this.opts.timeout > 0){
			let ms = this.opts.timeout * 1000
			'lookup,connect,secureConnect,socket,response'.split(',').forEach(s => timeout[s] = ms)
			'send,request'.split(',').forEach(s => timeout[s] = ms * 2)
			return timeout
		} else {
			let ms = 10000
			'lookup,connect,secureConnect,socket,response'.split(',').forEach(s => timeout[s] = ms)
			'send,request'.split(',').forEach(s => timeout[s] = ms * 99)
			return timeout
		}
	}
	parseResponse(response){
		if(this.opts.debug){
			console.log('>> Download response',response.statusCode, response.headers['content-range'], this.currentURL, this.retryCount)
		}
		if(this.validateResponse(response)){
			if(!this.acceptRanges && typeof(response.headers['accept-ranges']) && response.headers['accept-ranges'] != 'none'){
				this.acceptRanges = true
			}
			if(this.contentLength == -1 && typeof(response.headers['content-length']) != 'undefined'){
				this.contentLength = parseInt(response.headers['content-length'])
				if(this.totalContentLength < this.contentLength){
					this.totalContentLength = this.contentLength
				}
				if(this.requestingRange){
					this.contentLength -= this.requestingRange.start
					if(this.requestingRange.start >= this.contentLength){
						this.statusCode = 416
						return this.end()
					}
				}
			}
			if (typeof(response.headers['content-range']) != 'undefined') { // server support ranges, so we received the right data
				if(!this.acceptRanges){
					this.acceptRanges = true
				}
				let fullLength = 0, range = response.headers['content-range'].replace("bytes ", "bytes=")
				if(range.indexOf('/') != -1){
					fullLength = parseInt(range.split('/').pop())
					if(!isNaN(fullLength) && this.totalContentLength < fullLength){
						this.totalContentLength = fullLength
					}
				}
				const ranges = parseRange(this.totalContentLength, range)
				console.log('>> Download response range', this.totalContentLength, range, ranges)
				if (Array.isArray(ranges)) { // TODO: enable multi-ranging support
					this.receivingRange = ranges[0]
					if(!this.requestingRange){
						this.requestingRange = this.receivingRange
					}
					if(this.contentLength == -1 && this.receivingRange.end && this.receivingRange.end > 0){
						this.contentLength = this.receivingRange.end - this.receivingRange.start
					}
				}
			} else { // no range support, so skip received bytes + requestingRange.start
				this.ignoreBytes = this.received
				if(this.requestingRange){
					this.ignoreBytes += this.requestingRange.start
				}
			}
			if(this.opts.downloadLimit && this.contentLength > this.opts.downloadLimit){
				this.emit('error', 'Download limit exceeds ' + this.contentLength + ' > ' + this.opts.downloadLimit)
				if(!this.headersSent){
					this.statusCode = 500
					this.emit('response', this.statusCode, {})
				}
				this.end()
			} else {
				if(!this.headersSent){
					this.headersSent = true
					let headers = response.headers
					if(typeof(headers['content-length']) != 'undefined'){
						delete headers['content-length']
					}
					if(typeof(headers['content-range']) != 'undefined'){
						delete headers['content-range']
					}
					if(!this.statusCode || this.isPreferredStatusCode(response.statusCode)){
						this.statusCode = response.statusCode
					}
					if(this.requestingRange){
						this.statusCode = 206
						headers['content-range'] = 'bytes ' + this.requestingRange.start + '-'
						if(this.contentLength != -1){
							headers['content-range'] += (this.requestingRange.start + this.contentLength - 1)
							if(this.totalContentLength != -1){
								headers['content-range'] += '/' + this.totalContentLength
							} else {
								headers['content-range'] += '/*'
							}
						}
					}
					if(this.contentLength != -1){
						headers['content-length'] = this.contentLength
					}
					this.emit('response', this.statusCode, headers)
				}
				response.on('data', chunk => {
					if(this.destroyed){
						return this.destroyStream()
					}
					if(this.retryCount){
						this.retryCount = 0
					}
					if(!Buffer.isBuffer(chunk)){
						chunk = Buffer.from(chunk)
					}
					// console.log('received data')
					if(this.ignoreBytes){
						if(this.ignoreBytes >= chunk.length){
							this.ignoreBytes -= chunk.length
							return
						} else {
							chunk = chunk.slice(chunk.length - this.ignoreBytes)
							this.ignoreBytes = 0
						}
					}
					if(this.contentLength != -1 && (chunk.length + this.received) > this.contentLength){
						chunk = chunk.slice(0, this.contentLength - this.received)
					}
					this.received += chunk.length
					if(!this.listenerCount('data')){ // do buffering if no data handler yet
						this.buffer.push(chunk)
					} else {
						if(this.buffer.length){ // data handler binded, freeup any buffer
							this.emit('data', Buffer.concat(this.buffer))
							this.buffer = []
						}
						this.emit('data', chunk)
					}
					this.updateProgress()
					if(this.contentLength != -1 && this.received >= this.contentLength){ // already received whole content requested
						this.end()
					}
				})
				response.on('error', this.errorCallback.bind(this))
				response.on('aborted', () => {
					if(!this.destroyed){
						if(this.opts.debug){
							console.warn('aborted', global.traceback())
						}
						let err = 'request aborted'
						if(this.listenerCount('error')){
							this.emit('error', err)
						}
						this.delayNext()
					}
				})
				if(this.opts.debug){
					console.log('>> Download receiving response', this.opts.url)
				}
			}
		} else {
			this.delayNext()
		}
	}
	validateResponse(response){
		if(this.checkRedirect(response)){ // true = location handled
			return false // return false to skip parseResponse
		} else {
			if(response.statusCode < 200 || response.statusCode >= 400){ // bad response, not a redirect
				let authErrorCodes = [401, 403]
				if(authErrorCodes.includes(response.statusCode)){
					this.authErrors++
					if(this.authErrors >= this.opts.maxAuthErrors){
						return true // accept bad response
					}
				}
				if(this.retryCount < this.opts.retries){
					return false // return false to skip parseResponse and keep trying
				}
			}
			return true
		}
	}
	checkRedirect(response){
		if(typeof(response.headers['location']) != 'undefined'){
			if(!this.opts.followRedirect){
				if(!this.headersSent){
					this.headersSent = true
					this.statusCode = (response.statusCode >= 300 && response.statusCode < 400) ? response.statusCode : 307
					this.headers = response.headers
					this.emit('response', this.statusCode, this.headers)
				}
				this.end()
			}
			return true // location handled, return true to skip parseResponse
		}
	}
	isPreferredStatusCode(statusCode){
		return statusCode >= 200 && statusCode < 400 && 
			![206, 301, 302].includes(statusCode) // softly ignore these temp ones
	}
	addDefaultRequestHeaders(headers){
		headers['connection'] = this.opts.keepalive ? 'keep-alive' : 'close'
		return headers
	}
  	next(){
		this.destroyStream()
		let retry
		const permanentErrorCodes = [400, 404, 405, 410]
		if(this.destroyed || this.ended){
			return this._destroy()
		} else if(permanentErrorCodes.includes(this.statusCode) || this.retryCount >= this.opts.retries) { // no more retrying, permanent error
			retry = false
		} else if(
			(this.contentLength >= 0 && this.received >= this.contentLength) || // requested content already received
			(this.contentLength == -1 && (this.statusCode >= 200 && this.statusCode < 300)) // unknown content length + good response received = no more retrying
			){
			retry = false
    	} else { // keep trying
			retry = true
     		this.retryCount++
     		this.stream = this.connect()
		}
		if(retry){
			if(this.opts.debug){
				console.log('will retry', this.destroyed, this.statusCode, 'content: ' + this.received + '/' + this.contentLength, 'retries: ' + this.retryCount + '/'+ this.opts.retries)
			}
		} else {
			if(this.opts.debug){
				console.log('no retry', this.destroyed, this.statusCode, 'content: ' + this.received + '/' + this.contentLength, 'retries: ' + this.retryCount + '/'+ this.opts.retries)
			}
			this.end()
		}
	}
	delayNext(){
		this.destroyStream()
		if(this.delayNextTimer){
			clearTimeout(this.delayNextTimer)
		}
		this.delayNextTimer = setTimeout(this.next.bind(this), this.retryDelay)
	}
	updateProgress(){
		let current = this.progress
		if(this.contentLength != -1){
			this.progress = parseInt(this.received / (this.contentLength / 100))
			if(this.progress > 99){
				this.progress = 99
			}
		} else {
			this.progress = 99
		}
		if(this.progress != current && this.listenerCount('progress')){
			this.emit('progress', this.progress)
		}
	}
	destroyStream(){
		if(this.stream){	
			this.ignoreBytes = 0 // reset it
			if(this.opts.debug){
				console.log('destroyStream')		
			}
			this.stream.removeAllListeners('response')
			this.stream.removeAllListeners('data')
			this.stream.removeAllListeners('end')
			this.stream.destroy()
			this.stream.removeAllListeners()
			this.stream = null
		}
	}
	end(){
		if(!this.ended){
			if(this.destroyed){
				return this.emit('end')
			}
			this.ended = true
			this.destroyStream()
			if(!this.headersSent){
				this.emit('response', this.statusCode, {})
			}
			this.emit('end', this.buffer.length ? Buffer.concat(this.buffer) : Buffer.from(''))
			this.buffer = []
			this._destroy()
		}
	}
	_destroy(){
		if(!this.destroyed){
			if(this.opts.debug){
				console.log('_destroy')
			}
			this.ended = true
			this.destroyed = true
			this.preventDestroy = false
			this.destroyStream()
			if(!this.statusCode){
				this.statusCode = 504
			}
			this.removeAllListeners()
		}
	}
	destroy(){
		if(this.opts.debug){
			console.log('destroy', this.preventDestroy)
		}
		if(!this.preventDestroy){
			this._destroy()
		}
	}
}

Download.promise = (...args) => {
	return got.apply(got, args)
}

module.exports = Download
