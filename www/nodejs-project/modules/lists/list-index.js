const fs = require('fs'), ListIndexUtils = require('./list-index-utils')

class ListIndex extends ListIndexUtils {
	constructor(file, url){
		super()
        this.url = url
        this.file = file
		this.indexateIterator = 0
    }
    fail(err){
        console.warn('Bad index file', this.file, err)
        this.hasFailed = err
        if(this.listenerCount('error')){
            this.emit('error', err)
        }
        this.emit('end')
    }
    async entries(map){
        let lines = await this.readLines(this.file, map)
        let entries
        try {
            entries = global.parseJSON('['+ lines.filter(l => l.length > 9).join(',') +']') // remove undefineds too
        } catch(e) {}
        if(!Array.isArray(entries)){
            console.error('Failed to get lines', lines, map, entries, this.file)
            throw 'failed to get lines'
        }
        if(entries.length) {
            let last = entries.length - 1
            if(entries[last].length){ // remove index entry
                entries.splice(last, 1)
            }
        }
        return entries
    }
    async getMap(map){
        let lines = await this.readLines(this.file, map)
        let entries = lines.filter(l => l.length > 9).map((s, i) => {
            const e = JSON.parse(s)
            return e && e.name ? {group: e.group, name: e.name, _: map ? map[i] : i} : false
        }).filter(s => s)
        if(entries.length) {
            let last = entries.length - 1
            if(entries[last].length){ // remove index entry
                entries.splice(last, 1)
            }
            if(entries.length) {
                entries[0].source = this.url
            }
        }
        return entries
    }
    async expandMap(structure){
        const map = []
        structure.forEach(e => {
            if(typeof(e._) == 'number'){
                map.push(e._)
            }
        })
        const xs = await this.entries(map)
        let j = 0
        for(let i in structure){
            if(typeof(structure[i]._) == 'number'){
                Object.assign(structure[i], xs[j])
                delete structure[i]._
            }
        }
        return structure        
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
