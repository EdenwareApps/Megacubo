const fs = require('fs'), Events = require('events')

class Writer extends Events {
	constructor(file){
		super()
		this.debug = false
		this.file = file
		this.writing = false
		this.writeQueue = []
		this.position = 0
	}
	write(data){
		if(typeof(data) == 'string'){
			data = Buffer.from(data, 'utf8')
		}
		this.writeQueue.push({data, position: this.position})
		this.position += data.length
		this.pump()
	}
	prepare(cb){
		fs.stat(this.file, (err) => {
			if(err){
				if(this.debug){
					console.log('writeat creating', this.file)
				}
				fs.writeFile(this.file, '', cb)
			} else {
				cb()
			}
		})
	}
	pump(){
		if(this.writing) {
			return
		}
		if(!this.writeQueue.length){
			return this.emit('end')
		}
		this.writing = true
		this.prepare(() => {
			fs.open(this.file, 'r+', (err, fd) => {
				if(err){
					console.error(err)
					this.writing = false
					this.pump()
				} else {
					this._write(fd, () => {
						fs.close(fd, () => {})
						this.writing = false
						return this.emit('end')
					})
				}
			})
		})
	}
	_write(fd, cb){
		if(this.writeQueue.length){
			let {data, position} = this.writeQueue.shift(), len = data.length
			if(this.debug){
				console.log('writeat writing', this.file, fs.statSync(this.file).size, len, fs.statSync(this.file).size + len, position)
			}
			fs.write(fd, data, 0, data.length, position, (err, writtenBytes) => {
				if(err){
					if(this.debug){
						console.error('writeat error', err)
					}
					this.writeQueue.unshift({data, position})
				} else {
					if(writtenBytes < len){
						if(this.debug){
							console.warn('writeat written PARTIALLY', this.file, fs.statSync(this.file).size)
						}
						this.writeQueue.push({data: data.slice(writtenBytes), position: position + writtenBytes})
					} else {
						if(this.debug){
							console.log('writeat written', this.file, fs.statSync(this.file).size)
						}
					}
				}
				this._write(fd, cb)
			})
		} else {
			cb()
		}
	}
	ended(cb){
		if(!this.writing && !this.writeQueue.length){
			cb()
		} else {
			this.once('end', cb)
		}
	}	
	destroy(){
		this.removeAllListeners()
		this.writeQueue = []
	}
}

module.exports = Writer
