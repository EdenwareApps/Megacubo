const WriteQueueFile = require('./write-queue-file.js')

class WriteQueue {
	constructor(){
		this.pool = {}
	}
	write(file, data, position){
		if(typeof(this.pool[file]) == 'undefined'){
			this.pool[file] = new WriteQueueFile(file)
			this.pool[file].on('end', () => {
				this.pool[file].destroy()
				delete this.pool[file]
			})
		}
		if(!Buffer.isBuffer(data)){
			data = Buffer.from(data)
		}
		this.pool[file].write(data, position)
	}	
}

module.exports = new WriteQueue()
