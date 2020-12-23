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
			permanentErrorCodes: [400, 404, 405, 410],
			timeout: null,
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
		if(this.opts.responseType && this.opts.responseType == 'json'){
			this.opts.headers['accept'] = 'application/json,text/*;q=0.99'
		}
		this.opts.headers['accept-language'] = global.lang.locale +'-'+ global.lang.countryCode.toUpperCase() +','+ global.lang.locale +';q=0.9,*;q=0.5'
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
		this.retryDelay = 200
		this.preventDestroy = false
		this.currentRequestError = ''
		this.currentResponse = null
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
		if(this.stream){
			console.error('Download error, stream already connected')
			return
		}
		if(this.delayNextTimer){
			clearTimeout(this.delayNextTimer)
		}
		if(this.currentRequestError){
			this.currentRequestError = ''
		}
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
			console.log('>> Download request', this.currentURL, this.received, JSON.stringify(opts.headers), this.requestingRange, this.opts.headers['range'], global.traceback())
		}
		const stream = (this.opts.keepalive ? got.ka : got).stream(opts)
		stream.on('redirect', response => {
			if(this.opts.debug){
				console.log('>> Download redirect', response.headers['location'])
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
		stream.on('data', () => {}) // if no data handler on stream, response.on('data') will not receive too, WTF?!
		stream.on('error', this.errorCallback.bind(this))
		stream.on('download-error', this.errorCallback.bind(this)) // from got-wrapper hook
		stream.on('end', () => {
			if(this.opts.debug){
				console.log('>> Download finished')
			}
			if(this.contentLength == -1 && !this.currentRequestError){ // ended fine
				this.contentLength = this.received // avoid loop retrying
				if(this.opts.debug){
					console.log('>> Download content length adjusted to', this.contentLength)
				}
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
		if(!this.currentRequestError){
			this.currentRequestError = 'error'
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
		if(this.opts.timeout && typeof(this.opts.timeout) == 'object' && this.opts.timeout.lookup){
			return this.opts.timeout
		} else {
			let ms, timeout = {}
			if(typeof(this.opts.timeout) == 'number' && this.opts.timeout > 0){
				ms = this.opts.timeout * 1000
			} else {
				ms = (global.config.get('connect-timeout') || 5) * 1000
			}
			'lookup,connect,secureConnect,socket,response'.split(',').forEach(s => timeout[s] = ms)
			'send,request'.split(',').forEach(s => timeout[s] = ms * 2)
			return timeout
		}
	}
	removeHeaders(headers, keys){
		keys.forEach(key => {
			if(['transfer-encoding', 'accept-encoding', 'content-encoding'].includes(key)){
				headers[key] = 'identity'
			} else {
				delete headers[key]
			}
		})
		return headers
	}
	parseResponse(response){
		if(this.opts.debug){
			console.log('>> Download response', response.statusCode, JSON.stringify(response.headers), this.currentURL, this.retryCount)
		}
		this.currentResponse = response
		let validate = this.validateResponse(response)
		if(validate === true){
			if(!this.acceptRanges && typeof(response.headers['accept-ranges']) && response.headers['accept-ranges'] != 'none'){
				this.acceptRanges = true
			}
			if(this.contentLength == -1 && typeof(response.headers['content-length']) != 'undefined' && response.statusCode == 200){
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
				if(this.opts.debug){
					console.log('>> Download response range', this.totalContentLength, range, ranges)
				}
				if (Array.isArray(ranges)) { // TODO: enable multi-ranging support
					this.receivingRange = ranges[0]
					if(this.contentLength == -1 && this.receivingRange.end && this.receivingRange.end > 0){
						if(this.opts.debug){
							console.log('Download update content length', this.requestingRange ? this.requestingRange.start : -1, this.receivingRange, this.received, fullLength, response.headers['content-range'])
						}
						if(this.requestingRange){
							// if(this.requestingRange.end will be not available here, as contentLength == -1
							this.contentLength = this.totalContentLength - this.requestingRange.start
						} else {
							this.contentLength = this.received + (this.receivingRange.end - this.receivingRange.start) + 1
						}
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
					headers = this.removeHeaders(headers, ['transfer-encoding', 'cookie']) // cookies will be handled internally by got module
					if(this.opts.debug){
						console.log('>> Download response emit', this.statusCode, headers)
					}
					this.emit('response', this.statusCode, headers)
				}
				response.on('data', chunk => {
					if(this.ended || this.destroyed){
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
						if(this.opts.debug){
							console.log('>> Download content received', this.requestingRange, this.received, this.contentLength, this.totalContentLength)
						}
						this.end()
					}
				})
				response.on('error', this.errorCallback.bind(this))
				response.on('aborted', () => {
					if(!this.destroyed){
						if(this.opts.debug){
							console.warn('aborted', global.traceback())
						}
						this.currentRequestError = 'aborted'
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
		} else if(validate === false) {
			this.delayNext()
		}
	}
	validateResponse(response){
		if(this.checkRedirect(response)){ // true = location handled
			return false // return false to skip parseResponse
		} else {
			if(response.statusCode < 200 || response.statusCode >= 400){ // bad response, not a redirect
				let finalize, authErrorCodes = [401, 403]
				if(authErrorCodes.includes(response.statusCode)){
					this.authErrors++
					if(this.authErrors >= this.opts.maxAuthErrors){
						finalize = true
					}
				}
				if(this.opts.permanentErrorCodes.includes(response.statusCode)){
					finalize = true
				}
				if(this.acceptRanges && response.statusCode == 416){ // reached end, abort it
					finalize = true
				}
				if(finalize){
					this.statusCode = response.statusCode
					this.end()
					return undefined // accept bad response and finalize
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
		if(this.opts.debug){
			console.log('next', global.traceback())
		}
		this.destroyStream()
		let retry
		if(this.destroyed || this.ended){
			return this._destroy()
		} else if(this.opts.permanentErrorCodes.includes(this.statusCode) || this.retryCount >= this.opts.retries) { // no more retrying, permanent error
			retry = false
		} else if(
			(this.contentLength >= 0 && this.received >= this.contentLength) || // requested content already received
			((!this.acceptRanges || this.statusCode == 416) && this.contentLength == -1 && (this.statusCode >= 200 && this.statusCode < 300)) // unknown content length + good response received = no more retrying
			){
			retry = false
    	} else { // keep trying
			retry = true
     		this.retryCount++
     		this.stream = this.connect()
		}
		if(retry){
			if(this.opts.debug){
				console.log('retrying', this.destroyed, this.statusCode, this.currentURL, 'content: ' + this.received + '/' + this.contentLength, 'retries: ' + this.retryCount + '/'+ this.opts.retries)
			}
		} else {
			if(this.opts.debug){
				console.log('no retry', this.destroyed, this.statusCode, this.currentURL, 'content: ' + this.received + '/' + this.contentLength, 'retries: ' + this.retryCount + '/'+ this.opts.retries)
			}
			this.end()
		}
	}
	delayNext(){
		if(this.opts.debug){
			console.log('delayNext', global.traceback())
		}
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
		if(this.currentResponse){
			this.currentResponse.removeAllListeners('data')
			this.currentResponse.removeAllListeners('error')
		}
		if(this.stream){	
			this.ignoreBytes = 0 // reset it
			if(this.opts.debug){
				console.log('destroyStream', global.traceback())		
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
