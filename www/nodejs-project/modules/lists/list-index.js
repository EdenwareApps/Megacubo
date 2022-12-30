const fs = require('fs'), ListIndexUtils = require('./list-index-utils')

class ListIndex extends ListIndexUtils {
	constructor(file){
		super()
        this.file = file
		this.indexateIterator = 0
    }
    fail(err){
        console.warn('Bad index file', this.file, err)
        this.hasFailed = err
        this.emit('error', err)
        this.emit('end')
    }
    async entries(map){
        let lines = await this.readLines(this.file, map)
        let entries
        try {
            entries = global.parseJSON('['+ lines.filter(l => l.length > 9).join(',') +']') // remove undefineds too
        } catch(e) {}
        if(Array.isArray(entries) && entries.length) {
            let last = entries.length - 1
            if(entries[last].length){ // remove index entry
                entries.splice(last, 1)
            }
            return entries
        }
        console.error('Failed to get lines', lines, map, this.file)
        throw 'failed to get lines'
    }
	start(){
		fs.stat(this.file, (err, stat) => {
			if(this.debug){
				console.log('loadCache', this.url, stat)
			}
			if(stat && stat.size){
                this.readIndex().then(index => {
                    this.emit('data', index)
                    this.emit('end')                    
                }).catch(err => this.fail(err))
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
