
const Downloader = require('./downloader.js'), MPEGTSPacketProcessor = require('./ts-packet-processor.js')
	
class Joiner extends Downloader {
	constructor(url, opts){
		super(url, opts)
		//this.opts.debug = console.log
		this.opts.checkSyncByte = true
		this.type = 'joiner'
		this.joinerDestroyed = false
		this.delayUntil = 0
		this.processor = new MPEGTSPacketProcessor()
		this.processor.on('data', data => this.output(data))
		this.processor.on('fail', () => this.emit('fail'))
		this.on('bitrate', bitrate => {
			let idealBufferSize = 3 * bitrate
			if(this.processor.bufferSize < idealBufferSize){
				console.warn('MPEGTSPacketProcessor buffer size increase', idealBufferSize)
				this.processor.bufferSize = idealBufferSize
			}
        })
		this.on('destroy', () => {
			if(!this.joinerDestroyed){
				this.joinerDestroyed = true
				this.processor.destroy()
			}
		})
	}
	handleData(data){
		if(this.handleDataValidate(data)){
			this.processor.push(data)
        } else {
			console.error('invalid data (may cause match problems)', data)
		}
	}
	output(data, len){
		if(this.destroyed || this.joinerDestroyed){
			return
        }
        if(typeof(len) != 'number'){
            len = this.len(data)
        }
		if(len){
			if(this.bitrate){
				this.delayUntil = this.lastConnectionEndTime + (len / this.bitrate) - this.connectTime
			} else {
				this.delayUntil = 0
			}
			super.output(data, len)
		}
	}
	pump(){
		if(this.opts.debug){
			console.log('[' + this.type + '] pump', this.destroyed || this.joinerDestroyed)
		}
		let next = () => { 
			this.processor.flush(true) // join prematurely to be ready for next connection anyway
			let now = global.time(), ms = 0
			if(this.delayUntil && now < this.delayUntil){
				ms = this.delayUntil - now
				if(ms < 0){
					ms = 0
				}
				ms = parseInt(ms * 1000)
			}
            this.timer = setTimeout(this.pump.bind(this), ms) /* avoiding nested call to next pump to prevent mem leaking */
            if(this.opts.debug){
                console.log('[' + this.type + '] delaying ' + ms + 'ms', 'now: ' + now, 'delayUntil: ' + this.delayUntil)
            }
		}
		this.download(next)
	}
}
	
module.exports = Joiner
