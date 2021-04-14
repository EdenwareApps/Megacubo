
const StreamerAdapterBase = require('./base.js'), Downloader = require('../utils/downloader.js')
		
class StreamerAdapterAAC extends StreamerAdapterBase {
	constructor(url, opts, cb){
		super(url, opts)
		this.opts = {
			minBitrateCheckSize: 128 * 1024,
			maxBitrateCheckSize: 0.25 * (1024 * 1024)
		};
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
			this.source = new Downloader(this.url, this.opts)
			this.connectAdapter(this.source)
			this.source.start().then(resolve).catch(reject)
		})
	}
	speed(){
		this.downloadLogging = this.source.downloadLogging
		return super.currentSpeed
	}
}

module.exports = StreamerAdapterAAC
