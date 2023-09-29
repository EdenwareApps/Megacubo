const { EventEmitter } = require('events'), fs = require('fs')
const Reader = require('../reader'), { Writable } = require('stream')

class LineEmitter extends Writable {
	constructor(options = {}) {
		super(options)
		this.buffer = ''
		this.maxBufferSize = options.maxBufferSize || 1024 * 1024
	}
	_write(chunk, encoding, callback) {
		this.buffer += chunk
		if (this.buffer.length > this.maxBufferSize) {
			this.emitLines()
		}
		let startIndex = 0
		let lineIndex
		while ((lineIndex = this.buffer.indexOf('\n', startIndex)) !== -1) {
			const line = this.buffer.substring(startIndex, lineIndex)
			this.emit('line', line)
			startIndex = lineIndex + 1
		}
		this.buffer = this.buffer.substring(startIndex)
		callback()
	}
	_final(callback) {
		this.emitLines()
		this.emit('close')
		callback()
	}
	emitLines() {
		const lines = this.buffer.split('\n')
		const lastLine = lines.pop()
		for (const line of lines) {
			this.emit('line', line)
		}
		this.buffer = lastLine || ''
	}
}

class LineReader extends EventEmitter {
	constructor(opts={}) {
		super()
		this.opts = Object.assign({bufferSize: 8192}, opts)
		this.readOffset = 0
		this.reader = null
		this.readline = null
		this.opts = Object.assign({encoding: 'utf8'}, opts)
		if(!this.opts.file) throw 'LineReader initialized with no file specified'
		process.nextTick(() => this.start())
	}
	start() {
		this.readline = new LineEmitter()
		this.readline.on('line', line => this.emit('line', line))
		this.readline.on('close', () => {
			this.emit('close')
			this.destroy()
		})
		this.reader = new Reader(this.opts.file, this.opts)
		this.reader.on('error', err => {
			console.error(err)
			this.emit('error', err)
		})
		this.reader.on('data', chunk => this.readline.write(chunk))
		this.reader.on('close', () => this.readline.end())
	}
	end() {
		this.opts.persistent = false
		this.reader && this.reader.endPersistence()
	}
	destroy() {
		this.destroyed = true
		this.reader && this.reader.close()
		this.readline && this.readline.destroy()
		this.removeAllListeners()
	}
}

module.exports = LineReader
