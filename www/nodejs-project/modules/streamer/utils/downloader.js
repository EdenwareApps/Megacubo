
const path = require('path'), http = require('http'), StreamerAdapterBase = require('../adapters/base.js'), closed = require(global.APPDIR +'/modules/on-closed')

const SYNC_BYTE = 0x47

class Downloader extends StreamerAdapterBase {
	constructor(url, opts){
		opts = Object.assign({
            debug: false,
			initialErrorLimit: 2, // at last 2
			errorLimit: 5,
			sniffingSizeLimit: 196 * 1024, // if minor, check if is binary or ascii (maybe some error page)
			bitrateCheckingAmount: 3,
			checkSyncByte: false
		}, opts || {})
		super(url, opts)
		this.type = 'downloader'
		this.internalErrorLevel = 0
		this.internalErrors = []
		this.connectable = false
        this._destroyed = false
        this.timer = 0
		this.buffer = []
		this.ext = 'ts'
		let m = url.match(new RegExp('\\.([a-z0-9]{2,4})($|[\\?#])', 'i'))
		if(m && m.length > 1){
			this.ext = m[1]
		}
		this.on('destroy', () => {
			if(!this._destroyed){
				console.log('DOWNLOADER DESTROY', this._destroyed)
				this._destroyed = true
				this.endRequest()
				if(this.server){
					this.server.close()
				}
				this.currentRequest = null
			}
		})		
		this.pump()
	}
	getContentType(){
		if(this.opts.contentType){
			return this.opts.contentType
		} else {
			switch(this.ext){
				case 'aac':
				case 'aacp':
					return 'audio/aacp'
				case 'mp3':
					return 'audio/mpeg'
			}
			return 'video/MP2T'
		}
	}
    checkSyncByte(c, pos){
        if(pos < 0 || pos > (c.length - 4)){
            return false
        } else {
            const header = c.readUInt32BE(pos || 0), packetSync = (header & 0xff000000) >> 24
            return packetSync == SYNC_BYTE
        }
    }
    nextSyncByte(c, pos){
        while(pos < (c.length - 4)){
            if(this.checkSyncByte(c, pos)){
                return pos
            }
            pos++
        }
        return -1
    }
	start(){
		return new Promise((resolve, reject) => {
			this.server = http.createServer((req, res) => {
				if(path.basename(req.url) == 'stream.'+ this.ext){
					res.writeHead(200, {
						'content-type': this.getContentType()
					})
					let byteSyncFound, finished
					const listener = (url, chunk) => {
						if(!byteSyncFound && this.opts.checkSyncByte){
							let pos = this.nextSyncByte(chunk, 0)
							if(pos == -1){
								return // ignore this chunk
							}
							byteSyncFound = true
							if(pos > 0){
								chunk = chunk.slice(pos)
							}
						}
						if(chunk.length){
							res.write(chunk)
						}
					}, finish = () => {
						if(!finished){
							finished = true
							this.removeListener('data', listener)
							this.removeListener('destroy', finish)
							res.end()
						}
					}
					closed(req, res, finish)
					if(this.buffer.length){
						listener('', Buffer.concat(this.buffer))
						this.buffer = []
					}
					this.on('data', listener)
					this.on('destroy', finish)
				} else {
					res.statusCode = 404
					res.end('File not found!')
				}
			}).listen(this.opts.port, '127.0.0.1', err => {
				if(err){
					console.error('unable to listen on port', err)
					return reject(err)
				}
				this.opts.port = this.server.address().port
				this.endpoint = 'http://127.0.0.1:'+ this.opts.port +'/stream.'+ this.ext
				resolve(this.opts.port)
			}) 
		})
	}
	internalError(e){
		if(!this.committed){
			this.internalErrorLevel++
			this.internalErrors.push(e)
			if(this.internalErrorLevel >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)){
				console.error('[' + this.type + '] error limit reached', this.committed, this.internalErrorLevel, this.internalErrors, this.opts.errorLimit)
				this.fail('request error')
			}
		}
		return this.destroyed || this._destroyed
	}
	handleDataValidate(data){
		if(!data || this.destroyed || this._destroyed){
			return
		}
		/*
		if(this.opts.debug){
			this.opts.debug('[' + this.type + '] data received', String(data))
		}
		*/
		let skip, len = this.len(data)
		if(!len){
			skip = true
		} else if(len < this.opts.sniffingSizeLimit){
			if(!global.streamer.isBin(data)){
				skip = true
				console.error('bad data', len, data)
			}
        }
		if(!skip){
			this.internalErrorLevel = 0
			this.connectable = true
            return true
		}
	}
	handleData(data){
		if(this.handleDataValidate(data)){
			this.output(data)
		}
	}
	output(data, len){
		if(this.destroyed || this._destroyed){
			return
		}
        if(typeof(len) != 'number'){
            len = this.len(data)
        }
		if(len > 1){
		    this.collectBitrateSample(data, len)
			if(this.listenerCount('data')){
				this.emit('data', this.url, data, len)
			} else {
				this.buffer.push(data)
			}
		}
    }
    afterDownload(err, callback, data){
        this.endRequest()
        if(this.destroyed || this._destroyed){
            return
        }
        if(this.opts.debug){
            if(err){
                this.opts.debug('[' + this.type + '] DOWNLOAD ERR', err, data)   
            } else {
                this.opts.debug('[' + this.type + '] after download', data)
            }
        }
        if(callback){
            process.nextTick(callback.bind(this, err, data))
        }
    }
	download(callback){
        clearTimeout(this.timer)
		if(this.destroyed || this._destroyed){
			return
		}
		this.finishBitrateSample()
		const download = this.currentRequest = new global.Download({
			url: this.url,
			keepalive: this.committed && global.config.get('use-keepalive'),
			followRedirect: true,
			acceptRanges: false,
			retries: 0,
			timeout: 30,
			headers: {
				'accept-encoding': 'identity' // https://github.com/sindresorhus/got/issues/145
			}
		})
		download.on('error', error => {
            console.warn('['+ this.type +'] ERR', error, this.url)
			if(this.committed){
				let statusCode = 0
				if(error && error.response && error.response.statusCode){
					statusCode = error.response.statusCode
				}
				global.osd.show(global.streamer.humanizeFailureMessage(statusCode || 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
			}
		})
		download.on('response', (statusCode, headers) => {
			let contentType = ''
            if(this.opts.debug){
                this.opts.debug('[' + this.type + '] response', statusCode, headers)
            }
			statusCode = statusCode
			headers = headers
			contentType = typeof(headers['content-type']) != 'undefined' ? headers['content-type'] : ''
			if(this.opts.debug){
				this.opts.debug('[' + this.type + '] headers received', headers, statusCode, contentType) // 200
			}
			if(statusCode >= 200 && statusCode <= 300){
				if(!this.opts.contentType && contentType.match(new RegExp('^(audio|video)'))){
					this.opts.contentType = contentType
				}
				if(this.opts.debug){
					this.opts.debug('[' + this.type + '] handleData hooked') // 200
				}
				download.on('data', chunk => {
					this.handleData(chunk)
				})
				download.on('end', () => {
					this.endRequest()
					if(callback){
						this.afterDownload(null, callback, {contentType, statusCode, headers})
						callback = null
					}
				})
			} else {
				download.end()
				if(this.committed && (!statusCode || statusCode < 200 || statusCode >= 400)){ // skip redirects
					global.osd.show(global.streamer.humanizeFailureMessage(statusCode || 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
				}
				this.internalError('bad response: ' + contentType + ', ' + statusCode)
				if(statusCode){
					setTimeout(() => this.afterDownload('bad response', callback, {contentType, statusCode, headers}), 1000) // delay to avoid abusing
				} else {
					this.afterDownload('bad response', callback, {contentType, statusCode, headers}) // timeout, no delay so
				}				
			}
		})
	}
	pump(){
		this.download(() => {
			if(this.opts.debug){
				this.opts.debug('[' + this.type + '] host closed', Array.isArray(this.nextBuffer))
			}
			this.endRequest()
			if(this.destroyed || this._destroyed){
				return
			}
            this.timer = setTimeout(this.pump.bind(this), 0) 
			/* avoiding nested call to next pump to prevent mem leaking */
		})
	}
	endRequest(){
		if(this.currentRequest){
			this.currentRequest.destroy()
			this.currentRequest = null
		}
	}
}
	
module.exports = Downloader
