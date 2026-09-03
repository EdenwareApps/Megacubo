import MPEGTSProcessor from './mpegts-processor.js'
import setupUtils from '../../multi-worker/utils.js'
import { getFilename } from 'cross-dirname'           

const utils = setupUtils(getFilename())

class MPEGTSProcessorWorker {
	constructor() {
		this.processor = new MPEGTSProcessor()
		// emitBinary sends raw Buffers (zero-copy when possible) instead of JSON.stringify,
		// drastically reducing the worker heap usage (fixes ERR_WORKER_OUT_OF_MEMORY)
		this.processor.on('data', chunk => utils.emitBinary('data', chunk))
		this.processor.on('fail', err => {
			console.error('WORKER FAILED', err)
			utils.emit('fail', err)
		})
		return true
	}
	async push(chunk) {
		this.processor.push(chunk)
	}
	async flush(...args) {
		this.processor.flush(...args)
	}
	async stats() {
		return {
			bufferLength: this.processor.packetBuffer.length,
			destroyed: this.processor.destroyed
		}
	}
	async isTranscoding() {}
	async addCodecData() {}
	async setPacketFilterPolicy(...args) {
		this.processor.setPacketFilterPolicy(...args)
	}
	async setLive(isLive) {
			this.processor.setLive(isLive)
	}
	async terminate() {
		await this.destroy()
	}
	async destroy() {
		this.processor && this.processor.destroy()
	}
}
	
export default MPEGTSProcessorWorker
