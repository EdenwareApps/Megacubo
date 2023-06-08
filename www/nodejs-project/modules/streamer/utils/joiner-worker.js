const Downloader = require('./downloader.js'), MPEGTSPacketProcessor = require('./ts-packet-processor.js')
	
class Joiner extends Downloader {
	constructor(url, opts){
		super(url, opts)
		this.minConnectionInterval = 1
		this.type = 'joiner'
		this.delayUntil = 0
		this.processor = new MPEGTSPacketProcessor()
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
		this.processor.push(data)
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

class JoinerWorker {
	constructor() { }
	async start(url, opts) {
		this.joiner && this.joiner.destroy()
		this.joiner = new Joiner(url, opts)
		await this.joiner.start()
		return this.joiner.endpoint
	}
	async cancelWarmCache() {
		this.joiner.cancelWarmCache()
	}
	async isTranscoding() {
		return false
	}
	async terminate() {
		this.joiner && this.joiner.destroy()
	}
}
	
module.exports = JoinerWorker
