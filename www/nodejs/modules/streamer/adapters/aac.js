
const StreamerAdapterBase = require('./base.js')
		
class StreamerAdapterAAC extends StreamerAdapterBase {
	constructor(url, opts){
		super(url, opts)
		this.bitrateChecker.opts.minCheckSize = 128 * 1024
		this.bitrateChecker.opts.maxCheckSize = 0.25 * (1024 * 1024)
		this.defaults = this.opts
		if(opts){
			this.setOpts(opts)
		}
		this.bitrate = false
		this.bitrates = []
		this.clients = []
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

			const Downloader = require('../utils/downloader.js')
			this.source = new Downloader(this.url, this.opts)
			this.connectAdapter(this.source)
			this.source.start().then(resolve).catch(reject)
		})
	}
}

module.exports = StreamerAdapterAAC
