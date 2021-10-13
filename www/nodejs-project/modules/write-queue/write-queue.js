const WriteQueueFile = require('./write-queue-file')

class WriteQueue {
	constructor(){
		this.pool = {}
	}
	write(file, data, position){
		if(typeof(this.pool[file]) == 'undefined'){
			this.pool[file] = new WriteQueueFile(file)
			this.pool[file].once('end', () => {
				this.pool[file].destroy()
				delete this.pool[file]
			})
		}
		if(!Buffer.isBuffer(data)){
			data = Buffer.from(data)
		}
		this.pool[file].write(data, position)
	}
	ready(file, cb){
		if(typeof(this.pool[file]) == 'undefined'){
			cb()
		} else {
			this.pool[file].ready(cb)
		}
	}
}

module.exports = new WriteQueue()
