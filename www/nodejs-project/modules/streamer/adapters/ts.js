const path = require('path'), StreamerAdapterBase = require('./base.js')
const Downloader = require('../utils/downloader.js')

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
			this.setCallback(success => {
				if(success){
					resolve()
				} else {
					reject()
				}
			})
			let args = []
			if(global.config.get('ts-packet-filter-policy') == -1){
				this.source = new Downloader(this.url, this.opts)
			} else {
				const MultiWorker = require('../../multi-worker')
				this.worker = new MultiWorker()
				this.source = this.worker.load(path.join(__dirname, '../utils/joiner-worker'))
				args = [this.url, this.opts]
				this.once('destroy', () => {
					this.source && this.source.terminate()
					this.worker && this.worker.terminate()
				})
			}
			this.server = false
			this.connectable = false
			this.connectAdapter(this.source)
			this.source.start(...args).then(endpoint => {
				this.source.endpoint = endpoint
				resolve(this.endpoint)
			}).catch(reject)
		})
	}
}

module.exports = StreamerAdapterTS
