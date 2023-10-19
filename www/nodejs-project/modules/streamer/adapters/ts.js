const path = require('path'), StreamerAdapterBase = require('./base.js')
const Downloader = require('../utils/downloader.js'), Joiner = require('../utils/joiner.js')

class StreamerAdapterTS extends StreamerAdapterBase {
	constructor(url, opts, cb){
		super(url, opts)
		this.bitrate = false
		this.clients = []
		this.bitrates = []
		this.opts.port = 0
	}
	start(){
		return new Promise((resolve, reject) => {
			this.setCallback(success => (success ? resolve : reject)())
			const args = [this.url, this.opts]
			if(global.config.get('mpegts-packet-filter-policy') == -1){
				this.source = new Downloader(...args)
			} else {
				this.source = new Joiner(...args)
			}
			this.server = false
			this.connectable = false
			this.connectAdapter(this.source)
			this.source.start(...args).then(endpoint => {
				this.source.endpoint = endpoint
				resolve(this.endpoint)
			}).catch(err => {
				if(this.source.terminate) {
					this.source.terminate() // using worker
				} else {
					this.source.destroy()
				}
				reject(err)
			})
		})
	}
}

module.exports = StreamerAdapterTS
