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
			if(global.config.get('ts-packet-filter-policy') == -1){
				this.source = new Downloader(...args)
			} else {
				const useWorker = false
				if(useWorker) {
					const exclusiveWorker = true
					if(exclusiveWorker) {
						const MultiWorker = require('../../multi-worker')
						this.worker = new MultiWorker()
						this.source = this.worker.load(path.join(__dirname, '../utils/joiner-worker'))
						this.once('destroy', () => {
							this.source && this.source.terminate()
							this.worker && this.worker.terminate()
						})
					} else {
						this.source = global.workers.load(path.join(__dirname, '../utils/joiner-worker'))
						this.once('destroy', () => this.source && this.source.terminate())
					}
				} else {
					this.source = new Joiner(...args)
				}
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
