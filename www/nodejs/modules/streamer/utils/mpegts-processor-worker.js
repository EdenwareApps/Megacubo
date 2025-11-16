import MPEGTSProcessor from './mpegts-processor.js'
import setupUtils from '../../multi-worker/utils.js'
import { getFilename } from 'cross-dirname'           

const utils = setupUtils(getFilename())

class MPEGTSProcessorWorker {
	constructor() {
		this.processor = new MPEGTSProcessor()
		this.processor.on('data', chunk => utils.emit('data', chunk))
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
