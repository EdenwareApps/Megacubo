
const StreamerAdapterBase = require('../adapters/base.js'), ReadableStream = require('stream').Readable

class Downloader extends StreamerAdapterBase {
	constructor(url, opts){
		opts = Object.assign({
            debug: false,
			initialErrorLimit: 2, // at last 2
			errorLimit: 5,
			sniffingSizeLimit: 196 * 1024, // if minor, check if is binary or ascii (maybe some error page)
			bitrateCheckingAmount: 3
		}, opts || {})
		super(url, opts)
		this.type = 'downloader'
		this.internalErrorLevel = 0
		this.internalErrors = []
		this.connectable = false
        this._destroyed = false
        this.timer = 0
		this.clients = []
		this.on('destroy', () => {
			if(!this._destroyed){
				console.log('DOWNLOADER DESTROY', this._destroyed)
				this._destroyed = true
				this.endRequest()
				this.stream.removeAllListeners()
				this.stream.destroy()
				this.currentRequest = null
				this.stream = null
			}
		})
		this.stream = new ReadableStream()
		this.stream._read = () => {}
		this.stream.on('error', err => {
			console.error('DOWNLOADER STREAM ERROR', err, traceback())
		})
		this.stream.on('close', () => {
			console.log('DOWNLOADER STREAM CLOSED', traceback())
		})
		this.pump()
	}
	internalError(e){
		if(!this.committed){
			this.internalErrorLevel++
			this.internalErrors.push(e)
			if(this.internalErrorLevel >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)){
				console.error('[' + this.type + '] error limit reached', this.committed, this.internalErrorLevel, this.internalErrors, this.opts.errorLimit)
				this.emit('fail', 'request error')
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
			try{
				this.stream.push(data)
			} catch(e) {
				console.error('stream.push err', e)
			}
		    this.collectBitrateSample(data, len)
			if(this.listenerCount('data')){
				this.emit('data', this.url, data, len)
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
		let contentType = '', statusCode = 0, headers = {}
		const download = this.currentRequest = new global.Download({
			url: this.url,
			keepalive: this.committed && global.config.get('use-keepalive'),
			followRedirect: true,
			acceptRanges: false,
			retries: 0,
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
				global.osd.show((statusCode ? statusCode : 'timeout') + ' error', 'fas fa-times-circle', 'debug-conn-err', 'normal')
			}
		})
		download.on('response', (statusCode, headers) => {
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
					global.osd.show((statusCode ? statusCode : 'timeout') + ' error', 'fas fa-times-circle', 'debug-conn-err', 'normal')
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
            this.timer = setTimeout(this.pump.bind(this), 0) /* avoiding nested call to next pump to prevent mem leaking */
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
