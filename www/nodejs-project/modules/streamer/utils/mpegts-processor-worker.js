const utils = require('../../multi-worker/utils')(__filename)
const MPEGTSProcessor = require('./mpegts-processor')

class MPEGTSProcessorWorker {
	constructor() {
		this.processor && this.processor.destroy()
		this.processor = new MPEGTSProcessor()
		this.processor.on('data', chunk => utils.emit('data', chunk))
		this.processor.on('fail', err => utils.emit('fail', err))
		return true
	}
	async push(chunk) {
		this.processor.push(chunk)
	}
	async flush(...args) {
		this.processor.flush(...args)
	}
	async isTranscoding() {}
	async addCodecData() {}
	async terminate() {
		await this.destroy()
	}
	async destroy() {
		this.processor && this.processor.destroy()
	}
}
	
module.exports = MPEGTSProcessorWorker
