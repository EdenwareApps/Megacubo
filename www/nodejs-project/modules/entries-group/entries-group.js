const Events = require('events')

class EntriesGroup extends Events {
	constructor(key){
		super()
		this.key = key
        this.limit = 0
        this.preferMegaUrls = true
        this.allowDupes = false
        this.data = []
        this.isReady = false
		this.load()
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.once('ready', fn)
		}
	}
	load(){
		global.storage.get(this.key, data => {
            if(!Array.isArray(data)){
                data = []
            }
            this.data = this.prepare(data)
            this.emit('load')
            this.isReady = true
            this.emit('ready')
        })
	}
	prepare(entries){ // override to use
		return entries 
	}
    get(index){
        if(typeof(index)=='number'){
            if(typeof(this.data[index])!='undefined'){
                return Object.assign({}, this.data[index])
            }
            return false
        }
        return this.data.slice(0)
    }
    cleanAtts(oentry){
        let entry = Object.assign({}, oentry);
        ['class', 'path', 'users', 'position', 'renderer', 'servedIcon'].forEach(k => {
            if(typeof(entry[k]) != 'undefined'){
                delete entry[k]
            }
        })
        if(entry.entries){
            entry.entries = entry.entries.map(e => this.cleanAtts(e))
        }
        return entry
    }
    equals(e, f){
        if(e.type == 'group' || f.type == 'group'){
            return e.type == 'group' && f.type == 'group' && e.name == f.name && e.entries.length == f.entries.length
        } else {
            return e.url == f.url || (e.originalUrl && f.url == e.originalUrl) || (f.originalUrl && e.url == f.originalUrl)
        }
    }
    has(entry){
        return this.data.some(e => {
            if(this.equals(e, entry)){
                return true
            }
        })
    }
    add(oentry){
        console.log('[entries-group-'+this.key+'] ADD', oentry)
        let entry = this.cleanAtts(oentry)
        if(this.preferMegaUrls){
            if(entry.originalUrl){
                entry.url = entry.originalUrl
            }
            if(entry.originalName){
                entry.name = entry.originalName
            }
        }
        if(entry.originalIcon){
            entry.icon = entry.originalIcon
        }
        if(!this.allowDupes){
            for(var i in this.data){
                if(this.equals(this.data[i], entry)){
                    delete this.data[i]
                }
            }
            this.data = this.data.filter(item => !!item)
        }
        this.data.unshift(entry)
        if(this.limit){
			this.data = this.data.slice(0, this.limit)
		}
        console.log('[entries-group-'+ this.key +'] ADDED', this.data)
        global.storage.set(this.key, this.data, true)
        this.data = this.prepare(this.data)
        this.emit('change', this.data)
    }
    remove(entry){
        for(var i in this.data){
            if(this.equals(this.data[i], entry)){
                delete this.data[i]
            }
        }
        this.data = this.prepare(this.data.filter((item) => {
            return item !== undefined
        }))
        global.storage.set(this.key, this.data, true)
        this.emit('change', this.data)
    }
    clear(){
        this.data = []
        global.storage.set(this.key, this.data, true)
        this.emit('change', this.data)
    }
}

module.exports = EntriesGroup
