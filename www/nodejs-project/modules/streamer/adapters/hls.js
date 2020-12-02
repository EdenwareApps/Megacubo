
const tmpDir = require('os').tmpdir(), http = require('http'), path = require('path'), fs = require('fs'), Events = require('events')
const StreamerAdapterBase = require('./base.js'), decodeEntities = require('decode-entities')

class StreamerAdapterHLS extends StreamerAdapterBase {
	constructor(url, opts){
		super(url, opts)
		this.bitrate = false
		this.idleTimer = 0
		this.bitrates = []
		this.clients = []
		this.type = 'hls'
		if(this.opts.debug){
			this.opts.debug('OPTS', this.opts)
		}
	}
}

module.exports = StreamerAdapterHLS
