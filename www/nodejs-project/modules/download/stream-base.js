const Events = require('events'), parseRange = require('range-parser')

class DownloadStreamResponse extends Events {
	constructor(statusCode, headers){
		super()
        this.statusCode = statusCode
        this.headers = headers
        this.buffering = []
    }
    write(chunk){
        if(this.paused){
            this.buffering.push(chunk)
        } else {
            this.emit('data', chunk)
        }
    }
    resume(){
        this.buffering.map(c => this.emit('data', c))
        this.buffering = []
        this.paused = false
        if(this.pausedEnded){
            this.end()
        }
    }
    pause(){
        this.paused = true
    }
	emitError(error){
		if(this.listenerCount('error')){
			this.emit('error', error)
		}
		this.end()
	}
    end(){
        if(this.paused){
            this.pausedEnded = true
        } else {
            this.ended = true
            this.emit('end')
            this.removeAllListeners()
        }
    }
}

class DownloadStream extends Events {
	constructor(opts){
		super()
        this.setMaxListeners(20)
		this.opts = opts
        this.timeout = opts.timeout
        this.headersSent = false
        this.on('end', () => {            
            this.response && this.response.end()
        })
        if(!this.opts.uid){
            this.opts.uid = parseInt(Math.random() * 10000000000000)
        }
		process.nextTick(() => {
            this.start().catch(err => this.emitError(err))
        })
	}
	parseRange(range){
        const maxInt = Number.MAX_SAFE_INTEGER
		const ranges = parseRange(maxInt, range.replace('bytes ', 'bytes='))
		if (Array.isArray(ranges)) { // TODO: enable multi-ranging support
			let requestingRange = ranges[0]
			if(typeof(requestingRange.end) != 'number'){ // remove dummy value
				delete requestingRange.end
			} else if(requestingRange.end >= (maxInt - 1)){ // remove dummy value
				delete requestingRange.end
			}
            return requestingRange
		}
	}
    extractMaxAge(headers){
        if(typeof(headers['cache-control']) != 'undefined'){
            const match = headers['cache-control'].match(new RegExp('age=([0-9]+)'))
            if(match){
                return parseInt(match[1])
            }
        }
        return false
    }
    setTimeout(ms){
        this.timeoutTimer && clearTimeout(this.timeoutTimer)
        this.timeoutTimer = setTimeout(() => {
            if(!this.ended){
                this.emitError('timeouted')
            }
        }, ms)
    }
	emitError(error, report){
        this.error = error
        report && console.warn('DownloadStream:'+ this.type, this.opts.url, error)
		if(this.listenerCount('error')){
			this.emit('error', error)
		}
		this.end()
	}
    end(){
        if(!this.ended){
            this.ended = true
            this.emit('end')
        }
        this.destroy()
    }
	destroy(){
        if(!this.ended){
            this.end()
        }
        if(!this.destroyed){
		    this.destroyed = true
            this.emit('destroy')
            this.removeAllListeners()
        }
	}
}

DownloadStream.Response = DownloadStreamResponse
module.exports = DownloadStream
