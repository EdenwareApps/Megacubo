class StreamWriter {
	constructor(target){
		this.target = target
		this.queue = []
		this.needDrain = false
		this.target.on('drain', this.flush.bind(this))
		this.target.once('close', this.end.bind(this))
		this.target.once('end', this.end.bind(this))
	}
	write(...args){
		if(this.needDrain){
			this.queue.push(args)
		} else {
			this.needDrain = !this.target.write.apply(this.target, args)
		}
	}
	flush(){
		this.needDrain = false
		while(!this.needDrain && this.queue.length){
			this.write.apply(this, this.queue.shift())
		}
	}
	end(){
		if(this.target){
			this.target.end()
			this.target = null
			this.queue = null
			this.needDrain = null
		}
	}
}

module.exports = StreamWriter
