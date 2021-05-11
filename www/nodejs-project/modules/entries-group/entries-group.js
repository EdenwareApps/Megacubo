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
    has(entry){
        for(var i in this.data){
            if(this.data[i].url == entry.url || (entry.originalUrl && this.data[i].url == entry.originalUrl)){
                return true
            }
        }
    }
    add(oentry){
        console.log('[entries-group-'+this.key+'] ADD', oentry)
        let entry = Object.assign({}, oentry);
        ['class', 'type', 'path', 'users', 'position'].forEach(k => {
            if(typeof(entry[k]) != 'undefined'){
                delete entry[k]
            }
        })
        if(this.preferMegaUrls){
            if(entry.originalUrl){
                entry.url = entry.originalUrl
            }
            if(entry.originalName){
                entry.name = entry.originalName
            }
        }
        if(!this.allowDupes){
            for(var i in this.data){
                if(this.data[i].url == entry.url){
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
            if(this.data[i].url == entry.url){
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
