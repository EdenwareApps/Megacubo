
var Transform = require('stream').Transform, util = require('util')

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
		this.debug = debugAllow(false)
		this.url = url
		this.opts = {
			bufferSize: 0,
			joinMethod: 2,
			addNullPaddings: 1,
			idleTimeout: 12000,
			needleSize: 36 * 1024,
			intersectBufferSize: 12 * (1024 * 1024),
			maxBufferSize: 28 * (1024 * 1024),
			initialErrorLimit: 1,
			errorLimit: 4
		}
		this.clients = []
		this.port = 0
		this.endpoint = ''
		this.endpointName = 'infinite.ts'
		this.connectable = false
		this.reset()
		if(opts){
			Object.keys(opts).forEach((k) => {
				if(['request'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
					this.on(k, opts[k])
				} else {
					this.opts[k] = opts[k]
				}
			})
		}
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
			this.connected++
			clearTimeout(this.idleTimer)
            var closed, writer = new Writer(client), headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'video/MP2T',
                'Transfer-Encoding': 'chunked'
            }
            if(this.debug){
                console.log('[ts] serving (timeout reset)', this.url)
            }
            this.emit('client-connect', client)
            var code = 200, handler = (buffer) => {
				if(this.destroyed){
					return
				}
				writer.write(buffer, 'binary')
            }, clean = () => {
				writer.end()
			}
            client.writeHead(code, headers)
            client.on('close', () => {
				if(this.destroyed){
					return
				}
				this.connected--
				if(!this.connected){
					if(this.debug){
						console.warn('[ts] timeout start')
					}
					clearTimeout(this.idleTimer)
					this.idleTimer = setTimeout(() => {
						if(this.debug){
							console.warn('[ts] timeout')
						}
						this.destroy()
					}, this.opts.idleTimeout)
				}
				if(this.debug){
					console.log('[ts] disconnect', this.connected)
				}
				this.emit('client-disconnect', client)
				this.removeListener('destroy', clean)
				this.removeListener('broadcast', handler)
            })
            this.hello(handler)
			this.on('broadcast', handler)            
			this.on('destroy', clean)
		}).listen(0, "127.0.0.1", (err) => {
			if (err) {
				console.error("Unable to listen on port", err);
			}
			this.port = this.server.address().port
			this.endpoint = 'http://127.0.0.1:'+this.port+'/'+this.endpointName
			this.emit('ready', this.endpoint)
		})
		this.pump()
	}
	hello(cb){
		if(this.debug){
			console.log('[ts] hello')
		}
		if(this.buffers.length){
			cb(Buffer.concat(this.buffers))
		}
	}
	handleData(data, enc, cb){
		if(this.debug){
			console.log('[ts] Buffer received')
		}
		if(this.destroyed || !data){
			return
		}
		let len = this.len(data)
		if(!len){
			return
		}
		this.buffers = this.buffers.reverse().filter((b, i) => {
			len += this.len(b)
			return len < this.opts.maxBufferSize
		}).reverse()
		this.buffers.push(data)
		if(this.needle && this.opts.joinMethod){
			this.intersectingBuffers.push(data)
			len = this.len(this.intersectingBuffers)
			if(len >= this.opts.intersectBufferSize){
				this.intersectingBuffers = Buffer.concat(this.intersectingBuffers)
				let pos
				switch(this.opts.joinMethod){
					case 1:
						pos = this.intersectingBuffers.indexOf(this.needle)
						break
					case 2:
						pos = this.intersectingBuffers.lastIndexOf(this.needle)
						break
				}
				if(this.debug){
					console.log('[ts] JOIN', this.needle, this.intersectingBuffers, pos, pos + this.len(this.needle), this.len(this.intersectingBuffers))
				}
				if(pos > 0){
					this.intersectingBuffers = this.intersectingBuffers.slice(pos + this.len(this.needle))
				} else if(this.opts.addNullPaddings){
					// this.intersectingBuffers = Buffer.concat([this.nullBuffer, this.intersectingBuffers])
					this.intersectingBuffers = Buffer.concat((new Array(this.opts.addNullPaddings)).fill(this.nullBuffer).concat([this.intersectingBuffers]))
					if(this.debug){
						console.log('[ts] null padding added', this.opts.addNullPaddings)
					}
				}
				this.needle = false
				this.emit('broadcast', this.intersectingBuffers)
				this.intersectingBuffers = []
			}
		} else {
			if(this.opts.bufferSize){
				this.outputBuffers.push(data)
				let c = Buffer.concat(this.outputBuffers)
				if(this.len(c) >= this.opts.bufferSize){
					this.outputBuffers = []
					this.emit('broadcast', c)
				}
			} else {
				this.emit('broadcast', data)
			}
		}
		cb()
	}
	generateNeedle(){
		if(this.debug){
			console.log('[ts] gen needle')
		}
		let len = 0, buffers = this.buffers.reverse().filter((b, i) => {
			len += this.len(b)
			return len <= this.opts.needleSize
		}).reverse()		
		return Buffer.concat(buffers)
	}
	pump(){
		if(this.debug){
			console.log('[ts] pump', this.destroyed)
		}
		if(this.destroyed){
			return
		}
		var h = new this.hermes()
		let next = () => {
			if(this.debug){
				console.log('[ts] host closed')
			}
			if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
				this.currentRequest.abort()
			}
			h.end()
			if(this.destroyed){
				return
			}
			this.needle = this.generateNeedle()
			this.currentRequest = h = null
			if(this.statusCode == 200){
				process.nextTick(this.pump.bind(this)) // break leaking
			} else {
				setTimeout(this.pump.bind(this), 5000) // break leaking
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
			this.errors++
			console.error('[ts] error, timeout', this.url, err)
			if(this.errors >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)){
				console.warn('[ts] error limit reached', this.errors, this.opts.errorLimit)
				this.destroy()
			} else {
				next()
			}
		})
		this.currentRequest.on('response', (response) => {
			if(this.destroyed){
				return
			}
            if(this.debug){
				console.warn('[ts] headers received', response.statusCode, response) // 200
			}
			this.statusCode = response.statusCode
			this.headers = response.headers
			if((this.statusCode && this.statusCode != 200) || (typeof(this.headers['content-type']) != 'undefined' && !this.headers['content-type'].match(new RegExp('^(audio|video|application)')))){
				this.errors++
				console.warn('[ts] error', this.statusCode, this.headers)
				if(this.errors >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)){
					console.warn('[ts] error limit reached', this.errors, this.opts.errorLimit)
					this.destroy()
				}
			} else {
				this.errors = 0
				this.connectable = true
			}
		})
		h.on('finish', next)
		this.currentRequest.pipe(h)
	}
	len(data){
		if(this.debug){
			console.log('[ts] len')
		}
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
	reset(){
		if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
			this.currentRequest.abort()
			this.currentRequest = false
		}
		if(this.idleTimer){
			clearTimeout(this.idleTimer)
			this.idleTimer = 0
		}
		this.buffers = []
		this.outputBuffers = []
		this.intersectingBuffers = []
		this.errors = 0
		this.connected = 0
		this.needle = false
		this.nullBuffer = new Buffer([0x00])
	}
	destroy(){
		if(this.debug){
			console.log('[ts] destroy')
		}
		if(!this.destroyed){
			if(this.debug){
				console.warn('[ts] destroying...', this.currentRequest, traceback())
			}
			this.destroyed = true
			this.emit('destroy')
			this.server.close()
			if(this.currentRequest){
				this.currentRequest.abort()
				this.currentRequest = false
			}
			Object.keys(this).forEach(k => {
				if(typeof(this[k]) == 'object'){
					this[k] = null
				}
			})
			this.emit = () => {}
		}
	}	
}

class TSInfiniteProxyPool {
	constructor(request){
		this.pool = {}
		this.request = request
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
				request: this.request
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
		Object.keys(this.pool).forEach(url => {
			this.pool[url].destroy()
		})
		this.pool = []
	}
}
