const fs = require('fs'), Events = require('events'), Parser = require('./parser')

class CachedListIndex extends Events {
	constructor(file, parent){
		super()
        this.file = file
		this.parent = (() => parent)
		this.indexateIterator = 0
		this.indexTemplate = {
            terms: {},
            groups: {},
            meta: {},
            lastUpdatedAt: 0,
            listContentLength: 0
        }
    }
    fail(err){
        this.emit('error', err)
        this.emit('end')
    }
	start(){
		fs.stat(this.file, (err, stat) => {
			if(this.debug){
				console.log('loadCache', this.url, stat)
			}
			if(stat && stat.size){
                fs.readFile(this.file, (err, content) => {
                    if(err){
                        return this.fail('file not found or empty')
                    }
                    content = String(content).trim().split("\n")
                    let index, dataArr = []
                    try {
                        index = JSON.parse(content.pop())
                        if(typeof(index.terms) == 'undefined'){
                            throw 'bad cache format'
                        }
                        dataArr = content
                    } catch(e) {
                        console.error(e)
                        index = this.indexTemplate
                    }
                    this.emit('data', index, dataArr)
                    this.emit('end')
                })
			} else {
                this.fail('file not found or empty')
			}
		})
	}
	destroy(){
		if(!this.destroyed){
			this.destroyed = true
			this.emit('destroy')
            this.removeAllListeners()
			this.parent = (() => {return {}})
			this._log = []
		}
	}
}

module.exports = CachedListIndex
