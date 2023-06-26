const Joiner = require('./joiner')

class JoinerWorker {
	constructor() { }
	async start(url, opts) {
		this.joiner && this.joiner.destroy()
		this.joiner = new Joiner(url, opts)
		return await this.joiner.start()
	}
	async cancelWarmCache() {
		this.joiner.cancelWarmCache()
	}
	async isTranscoding() {}
	async addCodecData() {}
	async terminate() {
		this.joiner && this.joiner.destroy()
	}
}
	
module.exports = JoinerWorker
