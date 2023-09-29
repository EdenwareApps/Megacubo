const path = require('path'), Downloader = require('./downloader.js')
	
class Joiner extends Downloader {
	constructor(url, opts){
		super(url, opts)
		this.minConnectionInterval = 1
		this.type = 'joiner'
		this.delayUntil = 0
		
		const useWorker = true
		if(useWorker) {
			const exclusiveWorker = true
			const workerPath = path.join(__dirname, './mpegts-processor-worker')
			if(exclusiveWorker) {
				const MultiWorker = require('../../multi-worker')
				this.worker = new MultiWorker()
				this.processor = this.worker.load(workerPath)
				this.once('destroy', () => {
					const done = () => this.worker && this.worker.terminate()
					if(this.processor) {
						this.processor.terminate().catch(console.error).finally(done)
					} else {
						done()
					}
				})
			} else {
				this.processor = global.workers.load(workerPath)
				this.once('destroy', () => this.processor && this.processor.terminate().catch(console.error))
			}
		} else {
			const MPEGTSProcessor = require(path.join(__dirname, './mpegts-processor'))
			this.processor = new MPEGTSProcessor()
			this.once('destroy', () => this.processor && this.processor.terminate().catch(console.error))
		}

		this.processor.on('data', data => this.output(data))
		this.processor.on('fail', () => this.emit('fail'))
		// this.opts.debug = this.processor.debug  = true
		this.once('destroy', () => {
			if(!this.joinerDestroyed) {
				this.joinerDestroyed = true
				this.processor.destroy()
				this.processor = null
			}
		})
	}
	handleData(data){
		this.processor && this.processor.push(data)
	}
	output(data, len){
		if(this.destroyed || this.joinerDestroyed) {
			return
        }
        if(typeof(len) != 'number') {
            len = this.len(data)
        }		
		if(len) {
			if(this.bitrate) {
				this.delayUntil = this.lastConnectionEndTime + (len / this.bitrate) - this.connectTime
			} else {
				this.delayUntil = 0
			}
			super.output(data, len)
		}
	}
	pump(){
		if(this.opts.debug) {
			console.log('[' + this.type + '] pump', this.destroyed || this.joinerDestroyed)
		}
		this.download(() => { 
			this.processor.flush(true) // join prematurely to be ready for next connection anyway
			let now = global.time(), ms = 0
			if(this.delayUntil && now < this.delayUntil){
				ms = this.delayUntil - now
				if(ms < 0){
					ms = 0
				}
				ms = parseInt(ms * 1000)
			}
			const nextConnectionFrom = this.lastConnectionStartTime + this.minConnectionInterval
			if(nextConnectionFrom > (now + (ms / 1000))){
				ms = (nextConnectionFrom - now) * 1000
			}
			if(this.opts.debug){
				console.log('next connection after '+ parseInt(ms) +'ms')
			}
            this.timer = setTimeout(this.pump.bind(this), ms) /* avoiding nested call to next pump to prevent mem leaking */
            if(this.opts.debug){
                console.log('[' + this.type + '] delaying ' + ms + 'ms', 'now: ' + now, 'delayUntil: ' + this.delayUntil)
            }
		})
	}
}

module.exports = Joiner