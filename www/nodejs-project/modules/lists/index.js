const pLimit = require('p-limit'), Common = require('../lists/common.js')

class Index extends Common {
    constructor(opts){
		super(opts)
		this.searchMapCache = {}
		this.defaultsSearchOpts = {
			group: undefined,
			type: undefined,
			typeStrict: undefined,
			partial: undefined
		}
    }
	optimizeSearchOpts(opts){ // ensure opts will have the same order for a more effective searchMapCache key
		let nopts = {}
		Object.keys(this.defaultsSearchOpts).forEach(k => {
			nopts[k] = opts[k] ? opts[k] : undefined
		})
		return nopts
	}
	has(terms, opts){
		return new Promise((resolve, reject) => {	
			let ret = {}, results = {}
			if(!terms.length){
                return resolve({})
            }
            terms.forEach(t => {				
                ret[t.name] = Array.isArray(t.terms) ? t.terms : this.terms(t.terms)
				results[t.name] = false
			})
			if(!opts){
				opts = {}
			}
			Object.keys(ret).forEach(k => {
				const query = this.parseQuery(ret[k], opts)
				let smap = this.searchMap(query, opts)
				results[k] = this.mapSize(smap, opts.group) > 0
			})
            resolve(results)
        })
	}
	searchMapCacheInvalidate(url){
		if(!url){
			this.searchMapCache = {}
		} else {
			Object.keys(this.searchMapCache).forEach(k => {
				if(typeof(this.searchMapCache[k][url]) != 'undefined'){
					delete this.searchMapCache[k][url]
				}
			})
		}
	}
	parseQuery(terms, opts){
		if(!Array.isArray(terms)){
			terms = this.terms(terms, true)
		}
		if(terms.includes('|')){
			let needles = terms.join(' ').split(' | ').map(s => s.split(' '))
			return needles.map(gterms => {
				return this.parseQuery(gterms, opts).shift()
			})
		} else {
			let aliases = {}, excludes = []
			terms = terms.filter(term => { // separate excluding terms
				if(term.charAt(0) == '-'){
					excludes.push(term.substr(1))
					return false
				}
				return true
			})
			terms = this.applySearchRedirects(terms)
			if(opts.partial){
				let filter
				const start = global.time()
				if(global.config.get('search-mode') == 1){
					filter = (term, t) => {
						if(term.indexOf(t) !== -1 && t != term) {
							return true
						}
					}
				} else {
					filter = (term, t) => {
						if(term.startsWith(t) && t != term) {
							return true
						}
					}
				}
				Object.keys(this.lists).forEach(listUrl => {
					Object.keys(this.lists[listUrl].index.terms).forEach(term => {
						let from
						terms.some(t => {
							if(filter(term, t)){
								from = t
								return true
							}
						})
						if(from){
							if(typeof(aliases[from]) == 'undefined'){
								aliases[from] = []
							}
							if(!aliases[from].includes(term)){
								aliases[from].push(term)
							}
						}
					})
				})
			}
			terms = terms.filter(t => !excludes.includes(t))
			return [{terms, excludes, aliases}]
		}
	}
	searchMap(query, opts){
		let fullMap
		//console.log('searchMap', query)
		opts = this.optimizeSearchOpts(opts)
		query.forEach(q => {
			let map = this.querySearchMap(q, opts)
			fullMap = fullMap ? this.joinMap(fullMap, map) : map
		})
		//console.log('searchMap', opts)
		return this.cloneMap(fullMap)
	}
	queryTermMap(terms, group){
		let key = 'qtm-'+ group +'-'+ terms.join(',')
		if(typeof(this.searchMapCache[key]) != 'undefined'){
			return this.cloneMap(this.searchMapCache[key])
		}
		let tmap
		terms.forEach(term => {
			let map = {}
			Object.keys(this.lists).forEach(listUrl => {
				if(typeof(this.lists[listUrl].index.terms[term]) != 'undefined'){
					map[listUrl] = this.lists[listUrl].index.terms[term]
				}
			})
			if(tmap){
				tmap = this.joinMap(tmap, map)
			} else {
				tmap = this.cloneMap(map)
			}
		})
		this.searchMapCache[key] = this.cloneMap(tmap)
		return tmap
	}
	querySearchMap(q, opts){
		let smap
		let key = 'qsm-'+ opts.group +'-'+ q.terms.join(',') + q.excludes.join(',') + JSON.stringify(opts)
		if(typeof(this.searchMapCache[key]) != 'undefined'){
			return this.cloneMap(this.searchMapCache[key])
		}
		if(typeof(opts.type) != 'string'){
			opts.type = false
		}
		q.terms.some(term => {
			let tms = [term]
			if(typeof(q.aliases[term]) != 'undefined'){
				tms.push(...q.aliases[term])
			}
			let tmap = this.queryTermMap(tms)
			//console.warn('TMAPSIZE', term, tmap ? this.mapSize(tmap) : 0)
			//console.warn('SMAPSIZE', term, smap ? this.mapSize(smap) : 0)
			if(tmap){
				if(smap){
					smap = this.intersectMap(smap, tmap)
				} else {
					smap = tmap
				}
			} else {
				smap = false
				return true
			}
		})
		if(smap){
			if(q.excludes.length){
				let ms = this.mapSize(smap, opts.group)
				if(ms){
					let xmap = this.queryTermMap(q.excludes)
					smap = this.diffMap(smap, xmap)
					ms = this.mapSize(smap, opts.group)
					//console.warn('XMAPSIZE', this.mapSize(xmap), ms)
				}
			}
			this.searchMapCache[key] = this.cloneMap(smap)
			return smap
		}
		this.searchMapCache[key] = {}
		return {}
	}
	async search(terms, opts={}){
		if(typeof(terms) == 'string'){
			terms = this.terms(terms, true, true)
		}
		let start = global.time(), bestResults = [], maybe = [], limit = opts.limit || 256
		if(!terms){
			return []
		}
		const query = this.parseQuery(terms, opts)
		let smap = this.searchMap(query, opts), ks = Object.keys(smap)
		if(ks.length){
			if(this.debug){
				console.warn('M3U SEARCH PRE', terms, opts, (global.time() - start) +'s (pre time)', Object.assign({}, smap), (global.time() - start) +'s', terms)
			}
			let results = []
			ks.forEach(listUrl => {
				let ls = smap[listUrl]['n']
				if(opts.group){
					ls.push(...smap[listUrl]['g'])
				}
				smap[listUrl] = ls
			})
			const limiter = pLimit(4)
			const tasks = ks.map(listUrl => {
				return async () => {
					if(this.debug){
						console.warn('M3U SEARCH ITERATE LIST '+ listUrl, smap[listUrl].slice(0))
					}
					if(typeof(this.lists[listUrl]) == 'undefined' || !smap[listUrl].length) return
					let i = 0
					await this.lists[listUrl].iterate(e => {
						i++
						if(this.debug){
							console.warn('M3U SEARCH ITERATE '+ listUrl +':'+ i +' '+ e.url)
						}
						if(opts.type){
							if(this.validateType(e, opts.type, opts.typeStrict === true)){
								if(opts.typeStrict === true) {
									e.source = listUrl
									bestResults.push(e)
								} else {
									e.source = listUrl
									results.push(e)
								}
							}
						} else {
							bestResults.push(e)
						}
					}, smap[listUrl])
				}
			}).map(limiter)
			await Promise.allSettled(tasks)			
			if(this.debug){
				console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s (partial time)', (global.time() - start) +'s', terms, bestResults.slice(0), results.slice(0), maybe.slice(0))
			}
			results = bestResults.concat(results)
			if(maybe.length){
				if(!results.length){
					results = maybe
					maybe = []
				}
			}
			results = this.tools.dedup(results) // dedup before parentalControl to improve blocking
			results = this.prepareEntries(results)

			if(opts.parentalControl !== false){
				results = this.parentalControl.filter(results, true)
				maybe = this.parentalControl.filter(maybe, true)
			}
			results = this.adjustSearchResults(results, opts, limit)
			if(results.length < limit){
				maybe = this.adjustSearchResults(maybe, opts, limit - results.length)
			} else {
				maybe = []
			}
			if(this.debug){
				console.warn('M3U SEARCH RESULTS*', (global.time() - start) +'s (total time)', terms)
			}
			return {results, maybe}
		} else {
			return {results:[], maybe: []}
		}
	}
	getDomain(u){
    	if(u && u.indexOf('//')!=-1){
	        let domain = u.split('//')[1].split('/')[0]
        	if(domain == 'localhost' || domain.indexOf('.') != -1){
	            return domain.split(':')[0]
        	}
    	}
    	return ''
	}
	adjustSearchResults(entries, opts, limit){
		let map = {}, nentries = [];
		if(opts.type == 'live'){
			const livefmt = global.config.get('live-stream-fmt')
			switch(livefmt){
				case 'hls':
					entries = this.isolateHLS(entries, true)
					break
				case 'mpegts':
					entries = this.isolateHLS(entries, false)
					break
			}
		}
		entries.forEach(e => {
			let domain = this.getDomain(e.url)
			if(typeof(map[domain]) == 'undefined'){
				map[domain] = []
			}
			map[domain].push(e)
		})
		let domains = Object.keys(map)
		for(let i=0; nentries.length < limit; i++){
			let keep
			domains.forEach(domain => {
				if(!map[domain] || nentries.length >= limit) return
				if(map[domain].length > i){
					keep = true
					nentries.push(map[domain][i])
				} else {
					delete map[domain]
				}
			})
			if(!keep) break
		}
		return this.sort(nentries)
	}
    ext(file){
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase()
    }
    isolateHLS(entries, elevate){
        let notHLS = []
		entries = entries.filter(a => {
			if(this.ext(a.url) == 'm3u8'){
				return true
			}
			notHLS.push(a)
        })
		if(elevate){
			entries.push(...notHLS)
		} else {
			entries = notHLS.push(...entries)
		}
		return entries
    }
	mapSize(a, group){
		let c = 0
		Object.keys(a).forEach(listUrl => {
			if(a[listUrl].n.length){
				c += a[listUrl].n.length
			}
			if(group && a[listUrl].g.length){
				c += a[listUrl].g.length
			}
		})
		return c
	}
	intersectMap(a, b){
		let c = {}
		Object.keys(b).forEach(listUrl => {
			if(typeof(a[listUrl]) != 'undefined'){
				c[listUrl] = {
					g: a[listUrl].g ? a[listUrl].g.filter(n => b[listUrl].g.includes(n)).sort((a, b) => a - b) : [], 
					n: a[listUrl].n ? a[listUrl].n.filter(n => b[listUrl].n.includes(n)).sort((a, b) => a - b) : []
				}
			}
		})
		return c
	}
	joinMap(a, b){
		let c = this.cloneMap(a) // clone it
		Object.keys(b).forEach(listUrl => {
			if(typeof(c[listUrl]) == 'undefined'){
				c[listUrl] = {g: [], n: []}
			}
			Object.keys(b[listUrl]).forEach(type => {
				let changed
				b[listUrl][type].forEach(n => {
					if(!c[listUrl][type].includes(n)){
						c[listUrl][type].push(n)
						if(!changed){
							changed = true
						}
					}
				})
				if(changed){
					c[listUrl][type].sort((a, b) => a - b)
				}
			})
		})
		return c
	}
	diffMap(a, b){
		let c
		Object.keys(b).forEach(listUrl => {
			if(typeof(a[listUrl]) != 'undefined'){
				Object.keys(b[listUrl]).forEach(type => {
					if(typeof(a[listUrl][type]) != 'undefined'){
						b[listUrl][type].forEach(n => {
							let i = c ? c[listUrl][type].indexOf(n) : a[listUrl][type].indexOf(n)
							if(i != -1){
								if(!c) c = this.cloneMap(a) // clone it lazily
								c[listUrl][type].splice(i, 1)
							}
						})
					}
				})
			}
		})
		return c || a
	}
	cloneMap(a){
		return global.deepClone(a)
	}
	async groups(types){
		let groups = [], map = {}
		Object.keys(this.lists).forEach(url => {
			let entries = this.lists[url].index.groupsTypes
			types.forEach(type => {
				if(!entries || !entries[type]) return
				entries[type].forEach(group => {
					const parts = group.name.split('/')
					if(parts.length > 1){
						parts.forEach((part, i) => {
							const path = parts.slice(0, i + 1).join('/')
							if(typeof(map[path]) == 'undefined') map[path] = []
							if(i < (parts.length - 1)) map[path].push(parts[i + 1])
						})
					}
					groups.push({
						group: group.name,
						name: group.name.split('/').pop(),
						url,
						icon: group.icon
					})
				})
			})
		})
		groups = this.sort(groups)
		const routerVar = {} 
		let ret = groups.filter((group, i) => { // group repeated series
			return Object.keys(map).every(parentPath => {
				let gname = parentPath.split('/').pop()
				return map[parentPath].every(name => {
					const path = parentPath +'/'+ name
					if(group.group == path) {
						let ret = false
						if(typeof(routerVar[parentPath]) == 'undefined'){
							routerVar[parentPath] = i
							const ngroup = Object.assign({}, groups[i])
							groups[i].name = gname
							groups[i].group = parentPath
							groups[i].entries = [ngroup]
							ret = true
						} else {
							groups[routerVar[parentPath]].entries.push(group)
						}
						return ret
					}
					return true
				})
			})
		})
		return ret
	}
    sort(entries, key='name'){
        if(typeof(Intl) != 'undefined'){
            if(typeof(this.collator) == 'undefined'){
                this.collator = new Intl.Collator(global.lang.locale, {numeric: true, sensitivity: 'base'})
            }
            return entries.sort((a, b) => this.collator.compare(a[key], b[key]))
        } else {
            return entries.sort((a, b) => (a[key] > b[key] ? 1 : (a[key] < b[key] ? -1 : 1)))
        }
    }
	async group(group){
		if(!this.lists[group.url]){
			throw 'List not loaded'
		}

		let map = this.lists[group.url].index.groups[group.group]
		if(!map) map = []
		Object.keys(this.lists[group.url].index.groups).forEach(s => {
			if(s.indexOf('/') != -1 && s.startsWith(group.group)){
				this.lists[group.url].index.groups[s].forEach(n => map.includes(n) || map.push(n))
			}
		})

		let entries = await this.lists[group.url].getEntries(map)
		entries = this.tools.dedup(entries) // dedup before parentalControl to improve blocking
		entries = this.parentalControl.filter(entries, true)
		entries = this.sort(entries)

		return entries
	}
}

module.exports = Index
