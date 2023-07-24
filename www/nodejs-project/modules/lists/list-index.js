const fs = require('fs'), ListIndexUtils = require('./list-index-utils')

class ListIndex extends ListIndexUtils {
	constructor(file, url){
		super()
        this.url = url
        this.file = file
		this.indexateIterator = 0
    }
    fail(err){
        this.hasFailed = err
        if(this.listenerCount('error')){
            this.emit('error', err)
        }
        this.emit('end')
    }
    async entries(map){        
		map.sort()
        let lines = await this.readLines(map)
        let entries, ids = Object.keys(lines)
        try {
            entries = global.parseJSON('['+ Object.values(lines).join(',') +']') // remove undefineds too
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
            entries.forEach((s, i) => {
                entries[i]._ = parseInt(ids[i])
                if(!entries[i].source) {
                    entries[i].source = this.url
                }
            })
        }
        return entries
    }
    async getMap(map){
        const lines = await this.readLines(map)
        const entries = Object.keys(lines).map((_, i) => {
            const e = JSON.parse(lines[_])
            return e && e.name ? {group: e.group, name: e.name, _: parseInt(_)} : false
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
        const map = [], tbl = {}, ntypes = ['string', 'number']
        for(let i in structure){
            const t = typeof(structure[i]._)
            if(ntypes.includes(t) && !structure[i].url){
                if(t != 'number'){
                    structure[i]._ = parseInt(structure[i]._)
                }
                tbl[structure[i]._] = i
                map.push(structure[i]._)
            }
        }
        if(map.length){
            map.sort()
            const xs = await this.entries(map)
            for(let x=0; x<xs.length; x++){
                let i = tbl[xs[x]._]
                Object.assign(structure[i], xs[x])
                structure[i]._ = xs[x]._ = undefined
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
