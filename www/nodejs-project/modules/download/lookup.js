const async = require('async'), dns = require('dns'), Events = require('events'), CacheableLookup = require('cacheable-lookup')
const {
	V4MAPPED,
	ADDRCONFIG,
	ALL
} = dns;
const supportsALL = typeof ALL === 'number';
class UltimateLookup extends Events {
	constructor(servers){
		super()
		this.debug = false
		this.data = {}
		this.ttlData = {}
		this.queue = {}
		this.ttl = 3 * 3600
		this.failureTTL = 300
		this.cacheKey = 'lookup'
		this.servers = servers
		this.isReady = false
		this.setMaxListeners(999)
		this.load()
	}
	family(ip){
		if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)) {  
			return 4
		}
		return 6
	}
	promotePreferableIpVersion(ips){
		let pref = global.config.get('prefer-ipv6') ? 6 : 4
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
		if(![4, 6].includes(family)){
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
			if(Array.isArray(this.data[domain + family])){
				if(this.ttlData[domain + family] >= now){
					if(this.debug){
						console.log('lookup->get cached cb', this.data[domain + family])
					}
					cb(this.data[domain + family], true)
					return
				}
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
		const queueKey = domain + family
		if(typeof(this.queue[queueKey]) != 'undefined'){
			if(this.debug){
				console.log('lookup->queued', domain)
			}
			this.queue[queueKey].push(cb)
			return
		}
		this.queue[queueKey] = [cb]
		let finished, resultIps = {}
		async.eachOf(Object.values(this.servers), (servers, i, acb) => {
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
						this.finish(domain, queueKey, ips)
					}
					ips.forEach(ip => {
						if(typeof(resultIps[ip]) == 'undefined'){
							resultIps[ip] = 0
						}
						resultIps[ip]++
					})
				}
				if(acb){
					acb()
					acb = null
				}
			})
			const timeout = 5
			let timer = setTimeout(() => {
				if(!finished && acb){
					acb()
					acb = null
				}
			}, timeout * 1000)
		}, () => {
			if(this.debug){
				console.log('lookup->get solved', domain, finished)
			}
			let sortedIps = Object.keys(resultIps).sort((a,b) => resultIps[b] - resultIps[a])
			if(!sortedIps.length){
				this.finish(domain, queueKey, false, true)
			} else {
				let max = resultIps[sortedIps[0]] // ensure to get the most trusteable
				let ips = sortedIps.filter(s => resultIps[s] == max)
				this.finish(domain, queueKey, ips, true)
			}
		})
	}
	finish(domain, queueKey, value, save){
		this.ttlData[queueKey] = global.time() + (value === false ? this.failureTTL : this.ttl)
		if(typeof(this.data[queueKey]) == 'undefined' || value !== false){
			this.data[queueKey] = value
		}
		if(this.queue[queueKey]){
			if(this.debug){
				console.log('lookup->finish', domain, queueKey, value)
			}
			this.queue[queueKey].forEach(f => f(value, false))
			delete this.queue[queueKey]
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
						ips = ips.map(address => {
							return {address, family: this.family(address)}
						})
						callback(null, ips)
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
						const now = Date.now();
						callback(null, ip, family, now + (300 * 1000), 300)
					}
				} else {
					const error = new Error('cannot resolve')
					error.code = 'ENOTFOUND'
					callback(error)
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
const lookup = new UltimateLookup({
	gg: ['8.8.4.4', '8.8.8.8', '4.4.4.4'], 
	od: ['208.67.222.222', '208.67.220.220'],
	fn: ['80.80.80.80', '80.80.81.81']
})
//lookup.debug = true
lookup.lookup = lookup.lookup.bind(lookup)
module.exports = lookup
