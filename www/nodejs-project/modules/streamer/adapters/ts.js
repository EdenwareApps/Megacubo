
const StreamerAdapterBase = require('./base.js'), Joiner = require('../utils/joiner.js')
		
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
			this.source = new Joiner(this.url, this.opts)
			this.connectAdapter(this.source)
			this.server = false
			this.connectable = false
			this.source.start().then(resolve).catch(reject)
		})
	}
}

module.exports = StreamerAdapterTS
