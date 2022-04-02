const fs = require('fs'), ListIndexUtils = require('./list-index-utils')

class ListIndex extends ListIndexUtils {
	constructor(file){
		super()
        this.file = file
		this.indexateIterator = 0
    }
    fail(err){
        this.emit('error', err)
        this.emit('end')
    }
    entries(map){
        return new Promise((resolve, reject) => {
            this.readLines(this.file, map, lines => {
                let entries
                try {
                    entries = JSON.parse('['+ lines.filter(l => l.length > 9).join(',') +']') // remove undefineds too
                } catch(e) {

                }
                if(Array.isArray(entries) && entries.length){
                    let last = entries.length - 1
                    if(entries[last].length){ // remove index entry
                        entries.splice(last, 1)
                    }
                    resolve(entries)
                } else {
                    console.error('Failed to get lines', lines, map, this.file)
                    reject('failed to get lines')
                }
            })
        })
    }
	start(){
		fs.stat(this.file, (err, stat) => {
			if(this.debug){
				console.log('loadCache', this.url, stat)
			}
			if(stat && stat.size){
                this.readIndex(index => {
                    this.emit('data', index)
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
			this._log = []
		}
	}
}

module.exports = ListIndex
