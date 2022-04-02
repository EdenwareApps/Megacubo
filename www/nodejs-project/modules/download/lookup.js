const async = require('async'), dns = require('dns'), Events = require('events')

class Lookup extends Events {
	constructor(servers){
		super()
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
		this.isReady = false
		this.preferableIpVersion = 4
		Object.keys(servers).forEach(name => {
			if(!servers[name].some(ip => this.servers['default'].includes(ip))){
				this.servers[name] = servers[name]
			}
		})
		this.setMaxListeners(999)
		this.load()
	}
	family(ip){
		if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)) {  
			return 4
		}
		return 6
	}
	isIpv4(ip){
		return this.family(ip) == 4
	}
	setPreferableIpVersion(v){
		this.preferableIpVersion = v
	}
	promotePreferableIpVersion(ips){
		let pref = this.preferableIpVersion
		let nips = ips.filter(ip => this.family(ip) == pref)
		if(nips.length){
			return {ips: nips, family: pref}
		} else {
			return {ips, family: pref == 4 ? 6 : 4}
		}
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.once('ready', fn)
		}
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
	get(domain, family, cb){
		if(this.debug){
			console.log('lookup->get', domain, family)
		}
		if(family == 0){
			let ret = []
			return async.eachOf([6, 4], (family, i, done) => {
				this.get(domain, family, (results, cached) => {
					if(results){
						if(family == 6){
							ret = ret.concat(results)
						} else {
							ret = results.concat(ret)
						}
					}
					done()
				})
			}, () => {
				cb(ret.length ? ret : false)
			})
		}
		const now = global.time()
		if(typeof(this.data[domain + family]) != 'undefined'){
			if(Array.isArray(this.data[domain + family]) && this.ttlData[domain + family] >= now){
				if(this.debug){
					console.log('lookup->get cached cb', this.data[domain + family])
				}
				cb(this.data[domain + family], true)
				return
			} else {
				let locked = now < this.ttlData[domain + family]
				if(locked){
					if(this.debug){
						console.log('lookup->get cached failure cb', false)
					}
					cb(false, true)
					return
				}
			}
		}
		if(typeof(this.queue[domain + family]) != 'undefined'){
			if(this.debug){
				console.log('lookup->queued', domain)
			}
			this.queue[domain + family].push(cb)
			return
		}
		this.queue[domain + family] = [cb]
		let finished, resultIps = {}
		async.eachOfLimit(Object.values(this.servers), 1, (servers, i, acb) => {
			if(finished){
				acb()
			} else {
				if(this.debug){
					console.log('lookup->get solving', domain)
				}
				dns.setServers(servers)
				dns['resolve'+ family](domain, (err, ips) => {
					if(this.debug){
						console.log('lookup->get solve response', domain, err, ips, finished)
					}
					if(err){
						if(this.debug){
							console.error('lookup->get err on '+ servers.join(','), err)
						}
					} else {
						if(!finished) {
							finished = true
							this.finish(domain, family, ips)
						}
						ips.forEach(ip => {
							if(typeof(resultIps[ip]) == 'undefined'){
								resultIps[ip] = 0
							}
							resultIps[ip]++
						})
					}
					acb()
				})
			}
		}, () => {
			if(this.debug){
				console.log('lookup->get solved', domain, finished)
			}
			let sortedIps = Object.keys(resultIps).sort((a,b) => resultIps[b] - resultIps[a])
			if(!sortedIps.length){
				this.finish(domain, family, false, true)
			} else {
				let max = resultIps[sortedIps[0]] // ensure to get the most trusteable
				let ips = sortedIps.filter(s => resultIps[s] == max)
				this.finish(domain, family, ips, true)
			}
		})
	}
	finish(domain, family, value, save){
		this.ttlData[domain + family] = global.time() + (value === false ? this.failureTTL : this.ttl)
		if(typeof(this.data[domain + family]) == 'undefined' || value !== false){
			this.data[domain + family] = value
		}
		if(this.queue[domain + family]){
			this.queue[domain + family].forEach(f => f(value, false))
			delete this.queue[domain + family]
		}
		if(save && !Object.keys(this.queue).length){
			this.save()
		}
	}
	lookup(hostname, options, callback){
        if(typeof(options) == 'function'){
            callback = options
            options = {}
		}
		this.ready(() => {
			this.get(hostname, options.family, ips => {
				if(ips && Array.isArray(ips) && ips.length){
					let family = options.family
					if(options && options.all){
						if(this.debug){
							console.log('lookup callback', ips, family)
						}
						if(!family){
							let ret = this.promotePreferableIpVersion(ips)
							ips = ret.ips
							family = ret.family
						}
						callback(null, ips, family)
					} else {
						let ip
						if(family){
							ip = ips[Math.floor(Math.random() * ips.length)]
						} else {
							let ret = this.promotePreferableIpVersion(ips)
							ips = ret.ips
							family = ret.family
							ip = ips[Math.floor(Math.random() * ips.length)]
						}
						if(this.debug){
							console.log('lookup callback', ip, family)
						}
						callback(null, ip, family)
					}
				} else {
					callback(new Error('cannot resolve'))
				}
			})
		})
	}
	load(){
		global.storage.get(this.cacheKey, data => {
			if(data && data.data){
				this.data = Object.assign(data.data, this.data)
				this.ttlData = Object.assign(data.ttlData, this.ttlData)
			}
			if(this.debug){
				console.log('lookup->ready')
			}
			this.isReady = true
			this.emit('ready')
		})
	}
	save(){
		global.storage.set(this.cacheKey, {data: this.data, ttlData: this.ttlData}, true)
	}
}

const lookup = new Lookup({
	gg: ['8.8.4.4', '8.8.8.8', '4.4.4.4'], 
	od: ['208.67.222.222', '208.67.220.220'],
	fn: ['80.80.80.80', '80.80.81.81']
})
lookup.lookup = lookup.lookup.bind(lookup)
module.exports = lookup
