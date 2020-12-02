const async = require('async'), dns = require('dns')

class Lookup {
	constructor(servers){
		this.debug = false
		this.data = {}
		this.ttlData = {}
		this.queue = {}
		this.ttl = 3 * 3600
		this.failureTTL = 300
		this.cacheKey = 'lookup'
		this.servers = {
			'default': dns.getServers()
		}
		Object.keys(servers).forEach(name => {
			if(!servers[name].some(ip => this.servers['default'].includes(ip))){
				this.servers[name] = servers[name]
			}
		})
		this.load()
	}
    time(){
        return ((new Date()).getTime() / 1000)
    }
	reset(){
		if(this.debug){
			console.log('lookup->reset', domain)
		}
		Object.keys(this.data).forEach(k => {
			if(!Array.isArray(this.data[k])){
				delete this.data[k]
			}
		})
	}
	get(domain, cb){
		if(this.debug){
			console.log('lookup->get', domain)
		}
		const now = this.time()
		if(typeof(this.data[domain]) != 'undefined'){
			if(Array.isArray(this.data[domain]) && this.ttlData[domain] >= now){
				if(this.debug){
					console.log('lookup->get cached cb', this.data[domain])
				}
				cb(this.data[domain], true)
				return
			} else {
				let locked = now < this.ttlData[domain]
				if(locked){
					if(this.debug){
						console.log('lookup->get cached failure cb', false)
					}
					cb(false, true)
					return
				}
			}
		}
		if(typeof(this.queue[domain]) != 'undefined'){
			if(this.debug){
				console.log('lookup->queued', domain)
			}
			this.queue[domain].push(cb)
			return
		}
		this.queue[domain] = [cb]
		let finished
		async.eachOfLimit(Object.values(this.servers), 1, (servers, i, acb) => {
			if(finished){
				acb()
			} else {
				if(this.debug){
					console.log('lookup->get solving', domain)
				}
				dns.setServers(servers)
				dns.resolve4(domain, (err, ips) => {
					if(this.debug){
						console.log('lookup->get solve response', domain, err, ips, finished)
					}
					if(err){
						console.error(err)
					} else if(!finished) {
						finished = true
						this.finish(domain, ips)
					}
					acb()
				})
			}
		}, () => {
			if(this.debug){
				console.log('lookup->get solved', domain, finished)
			}
			if(!finished){
				this.finish(domain, false)		
			}
		})
	}
	finish(domain, value){
		this.ttlData[domain] = this.time() + (value === false ? this.failureTTL : this.ttl)
		if(typeof(this.data[domain]) == 'undefined' || value !== false){
			this.data[domain] = value
		}
		this.queue[domain].forEach(f => f(value, false))
		delete this.queue[domain]
		if(!Object.keys(this.queue).length){
			this.save()
		}
	}
	lookup(hostname, options, callback){
        if(typeof(options) == 'function'){
            callback = options
            options = {}
        }
        this.get(hostname, ips => {
            if(ips && Array.isArray(ips) && ips.length){
				if(options && options.all){
                    callback(null, ips, 4)
                } else {
                    callback(null, ips[Math.floor(Math.random() * ips.length)], 4)
                }
            } else {
                callback(new Error('cannot resolve'))
            }
        })
	}
	load(){
		let data = global.storage.getSync(this.cacheKey) // use sync to avoid needless networking and specially avoid lookup failure without cached fallback
		if(data && data.data){
			this.data = Object.assign(data.data, this.data)
			this.ttlData = Object.assign(data.ttlData, this.ttlData)
		}
	}
	save(){
		global.storage.set(this.cacheKey, {data: this.data, ttlData: this.ttlData}, true)
	}
}

const lookup = new Lookup({
	gg: ['8.8.4.4', '8.8.8.8', '4.4.4.4'], 
	od: ['208.67.222.222', '208.67.220.220']
})
lookup.lookup = lookup.lookup.bind(lookup)
module.exports = lookup
