const async = require('async'), Events = require('events')

const {
	NOTFOUND,
	BADFAMILY,
	promises: {
		Resolver: AsyncResolver
	}
} = require('dns')

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
		this.readyQueue = []
		this.saveDelayMs = 3000
		this.resolvers = {}
		this.failedIPs = {}
		this.lastResolvedIP = {}
		Object.keys(servers).forEach(s => {
			this.resolvers[s] = new AsyncResolver()
			this.resolvers[s].setServers(servers[s])
		})
		this.load()
	}
	family(ip){
		if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)) {  
			return 4
		}
		return 6
	}
	preferableIpVersion(){
		return global.config.get('prefer-ipv6') ? 6 : 4
	}
	promotePreferableIpVersion(hostname, ips){
		let family, pref = this.preferableIpVersion()
		let nips = ips.filter(ip => this.family(ip) == pref)
		if(nips.length){
			family = pref
			ips = nips
		} else {
			family = pref == 4 ? 6 : 4
		}
		if(ips.length > 1){
			ips = ips.sort((a, b) => {
				if(!this.failedIPs[hostname]) return 0
				let aa = this.failedIPs[hostname].indexOf(a)
				let bb = this.failedIPs[hostname].indexOf(b)
				return aa > bb ? 1: (bb > aa ? -1 : 0)
			})
			if(this.failedIPs[hostname]) console.log('promotin', ips, this.failedIPs[hostname])
		}
		return {ips, family}
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.readyQueue.push(fn)
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
			family = this.preferableIpVersion()
			return this.get(domain, family, results => {
				if(results && results.length){
					cb(results.length ? results : false)
				} else {
					this.get(domain, family == 4 ? 6 : 4, cb)
				}
			})
		}
		const now = global.time()
		if(typeof(this.data[domain + family]) != 'undefined'){
			if(Array.isArray(this.data[domain + family]) && this.data[domain + family].length){
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
		async.eachOf(Object.keys(this.resolvers), (k, i, done) => {
			if(this.debug){
				console.log('lookup->get solving', domain)
			}
			this.resolvers[k]['resolve'+ family](domain).then(ips => {
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
			}).catch(err => {
				if(this.debug){
					console.error('lookup->get err on '+ k, err)
				}
			}).finally(done)
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
							let ret = this.promotePreferableIpVersion(hostname, ips)
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
							let ret = this.promotePreferableIpVersion(hostname, ips)
							ips = ret.ips
							family = ret.family
							ip = ips[0]
						}
						this.lastResolvedIP[hostname] = ip
						if(this.debug){
							console.log('lookup callback', ip, family)
						}
						const now = Date.now();
						callback(null, ip, family, now + (300 * 1000), 300)
					}
				} else {
					const error = new Error('cannot resolve')
					error.code = NOTFOUND
					callback(error)
				}
			})
		})
	}
	defer(hostname, ip){
		if(typeof(this.failedIPs[hostname]) == 'undefined'){
			this.failedIPs[hostname] = []
		} else {
			this.failedIPs[hostname] = this.failedIPs[hostname].filter(i => i != ip)
		}
		this.failedIPs[hostname].push(ip)
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
			this.readyQueue.forEach(f => f())
			this.readyQueue.length = 0
		})
	}
	save(){
		if(this.saveTimer){
			clearTimeout(this.saveTimer)
		}
		this.saveTimer = setTimeout(() => {
			global.storage.set(this.cacheKey, {data: this.data, ttlData: this.ttlData}, true)
		}, this.saveDelayMs)
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
