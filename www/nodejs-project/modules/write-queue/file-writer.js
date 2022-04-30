const fs = require('fs'), Events = require('events')

class Writer extends Events {
	constructor(file){
		super()
		this.debug = false
		this.file = file
		this.writing = false
		this.writeQueue = []
		this.position = 0
		this.uid = (new Date()).getTime()
		if(!global.writers) global.writers = {}
		global.writers[this.uid] = this
	}
	write(data){
		if(!data.length || this.destroyed) return
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
				const close = () => {
					if(fd){
						fs.close(fd, () => {})
						fd = null
					}
				}
				if(fd){
					this.once('destroy', close) // try to prevent E_PERM error, maybe at some cases the file is not correctly closed before destroy() call
				}
				if(err){
					console.error(err)
					this.writing = false
					setTimeout(this.pump.bind(this), 500) // save resources
				} else {
					this._write(fd, () => {
						close()
						this.writing = false
						return this.emit('end')
					})
				}
			})
		})
	}
	_write(fd, cb){ // we'll write once per time, not simultaneously, so no drain would be required anyway
		if(!this.destroyed && this.writeQueue.length){
			let {data, position} = this.writeQueue.shift(), len = data.length
			if(this.debug){
				console.log('writeat writing', this.file, fs.statSync(this.file).size, len, fs.statSync(this.file).size + len, position)
			}
			fs.write(fd, data, 0, data.length, position, (err, writtenBytes) => {
				if(err){
					if(this.debug){
						console.error('writeat error', err)
					}
					if(this.destroyed){
						cb()
					} else {
						this.writeQueue.unshift({data, position})
					}
				} else {
					if(writtenBytes < len){
						if(this.debug){
							console.warn('writeat written PARTIALLY', this.file, fs.statSync(this.file).size)
						}
						this.writeQueue.push({data: data.slice(writtenBytes), position: position + writtenBytes})
					} else {
						if(this.debug){
							console.log('writeat written', this.file, fs.statSync(this.file).size, this.writeQueue.length)
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
		this.destroyed = parseInt(((new Date()).getTime() - this.uid) / 1000)
		this.writeQueue = []
		this.emit('destroy')
		this.removeAllListeners()
	}
}

module.exports = Writer
