const Events = require('events')

class EntriesGroup extends Events {
	constructor(key){
		super()
		this.key = key
        this.limit = 0
        this.allowDupes = false
        this.emptyEntry = {name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action'}
        this.data = []
		this.load()
	}
	load(){
		global.storage.get(this.key, data => {
            if(!Array.isArray(data)){
                data = []
            }
            this.data = this.prepare(data)
            this.emit('load')
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
    add(entry){
        console.log('[entries-group-'+this.key+'] ADD', entry)
        let nentry = Object.assign({}, entry)
        nentry.class = ''
        if(typeof(nentry.type)!='undefined'){
            delete nentry.type
        }
        if(!this.allowDupes){
            for(var i in this.data){
                if(this.data[i].url == nentry.url){
                    delete this.data[i]
                }
            }
            this.data = this.data.filter((item) => {
                return !!item
            })
        }
        this.data.unshift(nentry)
        if(this.limit){
			this.data = this.data.slice(0, this.limit)
		}
        console.log('[entries-group-'+this.key+'] ADDED', this.data)
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
