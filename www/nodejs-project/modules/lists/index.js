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
		if(!Array.isArray(terms)) {
			terms = this.terms(terms)
		}
		if(terms.includes('|')) {
			let excludes = [], aterms = []
			terms.forEach(term => {
				if(term.startsWith('-')) {
					excludes.push(term.substr(1))
				} else {
					aterms.push(term)
				}
			})
			const needles = aterms.join(' ').split(' | ').map(s => s.replaceAll('|', '').split(' '))
			return {
				excludes,
				queries: needles.map(nterms => {
					return this.parseQuery(nterms, opts).queries.shift()
				})
			}
		} else {
			let aliases = {}, excludes = []
			terms = terms.filter(term => { // separate excluding terms
				if(term.startsWith('-')){
					excludes.push(term.substr(1))
					return false
				}
				return true
			})
			terms = this.applySearchRedirects(terms)
			if(opts.partial){
				let filter
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
				const maxAliases = 6, aliasingTerms = {}
				terms.forEach(t => aliasingTerms[t] = 0)
				Object.keys(this.lists).forEach(listUrl => {
					Object.keys(this.lists[listUrl].index.terms).forEach(term => {
						let from
						terms.some(t => {
							if(aliasingTerms[t] < maxAliases && filter(term, t)){
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
								aliasingTerms[from]++
							}
						}
					})
				})
			}
			terms = terms.filter(t => !excludes.includes(t))
			const queries = [terms]
			Object.keys(aliases).forEach(from => {
				const i = terms.indexOf(from)
				if(i == -1) return
				queries.push(...aliases[from].map(alias => {
					const nterms = terms.slice(0)
					nterms[i] = alias
					return nterms
				}))
			})
			return {queries, excludes}
		}
	}
	searchMap(query, opts){
		let fullMap
		this.debug && console.log('searchMap', query)
		opts = this.optimizeSearchOpts(opts)
		query.queries.forEach(q => {
			let map = this.querySearchMap(q, query.excludes, opts)
			fullMap = fullMap ? this.joinMap(fullMap, map) : map
		})
		this.debug && console.log('searchMap', opts)
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
			if(this.debug) {
				console.log('querying term map '+ term)
			}
			Object.keys(this.lists).forEach(listUrl => {
				if(typeof(this.lists[listUrl].index.terms[term]) != 'undefined'){
					map[listUrl] = this.lists[listUrl].index.terms[term]
				}
			})
			if(tmap){
				if(this.debug) {
					console.log('joining map '+ term)
				}
				tmap = this.intersectMap(tmap, map)
			} else {
				tmap = this.cloneMap(map)
			}
		})
		if(this.debug) {
			console.log('querying term map done')
		}
		this.searchMapCache[key] = this.cloneMap(tmap)
		return tmap
	}
	querySearchMap(terms, excludes=[], opts={}){
		let smap
		let key = 'qsm-'+ opts.group +'-'+ terms.join(',') +'_'+ excludes.join(',') + JSON.stringify(opts) // use _ to diff excludes from terms in key
		if(typeof(this.searchMapCache[key]) != 'undefined'){
			return this.cloneMap(this.searchMapCache[key])
		}
		if(typeof(opts.type) != 'string'){
			opts.type = false
		}
		terms.some(term => {
			let tms = [term]
			if(this.debug) {
				console.log('querying term map', tms)
			}
			let tmap = this.queryTermMap(tms)
			//console.warn('TMAPSIZE', term, tmap ? this.mapSize(tmap) : 0)
			//console.warn('SMAPSIZE', term, smap ? this.mapSize(smap) : 0)
			if(tmap){
				if(smap){
					if(this.debug) {
						console.log('intersecting term map')
					}
					smap = this.intersectMap(smap, tmap)
				} else {
					smap = tmap
				}
			} else {
				smap = false
				return true
			}
		})
		if(smap && this.mapSize(smap, opts.group)){
			if(excludes.length){
				if(this.debug) {
					console.log('processing search excludes')
				}
				excludes.some(xterm => {
					this.debug && console.error('before exclude '+ xterm +': '+ this.mapSize(smap, opts.group))
					let xmap = this.queryTermMap([xterm])
					smap = this.diffMap(smap, xmap)
					const ms = this.mapSize(smap, opts.group)
					this.debug && console.error('after exclude '+ xterm +': '+ ms)
					return !this.mapSize(smap, opts.group)
				})
			}
			if(this.debug) {
				console.log('done')
			}
			this.searchMapCache[key] = this.cloneMap(smap)
			return smap
		}
		this.searchMapCache[key] = {}
		return {}
	}
	async search(terms, opts={}) {
		if(typeof(terms) == 'string'){
			terms = this.terms(terms, false, true)
		}
		let start = global.time(), bestResults = [], maybe = []
		const limit = opts.limit || 256, maxWorkingSetLimit = limit * 2
		if(!terms){
			return []
		}
		if(this.debug){
			console.warn('lists.search() parsing query', (global.time() - start) +'s (pre time)')
		}
		const query = this.parseQuery(terms, opts), checkType = opts.type && opts.type != 'all'
		if(this.debug){
			console.warn('lists.search() map searching', (global.time() - start) +'s (pre time)', query)
		}
		let smap = this.searchMap(query, opts), ks = Object.keys(smap)
		if(this.debug){
			console.warn('lists.search() parsing results', terms, opts, (global.time() - start) +'s (pre time)')
		}
		if(ks.length){
			if(this.debug){
				console.warn('lists.search() iterating lists', terms, opts, (global.time() - start) +'s (pre time)')
			}
			let results = []
			ks.forEach(listUrl => {
				let ls
				if(opts.groupsOnly) {
					ls = smap[listUrl]['g']
				} else {
					ls = smap[listUrl]['n']
					if(opts.group){
						ls.push(...smap[listUrl]['g'])
					}
				}
				smap[listUrl] = ls
			})
			const limiter = pLimit(4)
			const alreadyMap = {}
			const tasks = ks.map(listUrl => {
				return async () => {
					if(this.debug){
						console.warn('lists.search() ITERATE LIST '+ listUrl)
					}
					if(typeof(this.lists[listUrl]) == 'undefined' || !smap[listUrl].length) return
					await this.lists[listUrl].iterate(e => {
						if(typeof(alreadyMap[e.url]) != 'undefined') return
						alreadyMap[e.url] = null
						const BREAK = this.lists[listUrl].constants.BREAK
						if(checkType) {
							if(this.validateType(e, opts.type, opts.typeStrict === true)) {
								e.source = listUrl
								bestResults.push(e)
								if(bestResults.length == maxWorkingSetLimit) return BREAK
							}
						} else {
							e.source = listUrl
							bestResults.push(e)
							if(bestResults.length == maxWorkingSetLimit) return BREAK
						}
					}, smap[listUrl])
				}
			}).map(limiter)
			await Promise.allSettled(tasks)			
			if(this.debug){
				console.warn('lists.search() RESULTS', (global.time() - start) +'s (partial time)', (global.time() - start) +'s', terms, bestResults.slice(0), results.slice(0), maybe.slice(0))
			}
			results = bestResults.concat(results)
			if(maybe.length){
				if(!results.length){
					results = maybe
					maybe = []
				}
			}
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
				console.warn('lists.search() RESULTS*', (global.time() - start) +'s (total time)', terms)
			}
			return {results, maybe}
		} else {
			return {results:[], maybe: []}
		}
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
			let domain = global.Download.domain(e.url)
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
		for(const listUrl in b) {
			if(typeof(a[listUrl]) != 'undefined'){
				const gset = new Set(
					a[listUrl].g.length && b[listUrl].g.length ?
					b[listUrl].g : []
				)
				const nset = new Set(
					a[listUrl].n.length && b[listUrl].n.length ?
					b[listUrl].n : []
				)
				c[listUrl] = {
					g: gset.size ? a[listUrl].g.filter(n => gset.has(n)) : [],
					n: nset.size ? a[listUrl].n.filter(n => nset.has(n)) : []
				}
			}
		}
		return c
	}
	joinMap(a, b){
		let c = this.cloneMap(a) // clone it
		for(const listUrl in b) {
			if(typeof(c[listUrl]) == 'undefined'){
				c[listUrl] = {g: [], n: []}
			}
			for(const type in b[listUrl]) {
				let changed
				const map = new Set(c[listUrl][type] || [])
				b[listUrl][type].forEach(n => {
					if(!map.has(n)){
						c[listUrl][type].push(n)
						if(!changed){
							changed = true
						}
					}
				})
				if(changed){
					c[listUrl][type].sort((a, b) => a - b)
				}
			}
		}
		return c
	}
	diffMap(a, b) {
		let c = global.deepClone(a) // cloning needed
		for (const listUrl in b) {
			if (a[listUrl] !== undefined) {
				c[listUrl] = {g: [], n: []}
				const gSet = new Set(a[listUrl].g)
				const nSet = new Set(a[listUrl].n)
				for (const type in b[listUrl]) {
					if (a[listUrl][type] !== undefined) {
						const diffSet = new Set(b[listUrl][type])
						if (type === 'g') {
							c[listUrl].g = [...gSet].filter(n => !diffSet.has(n))
						} else {
							c[listUrl].n = [...nSet].filter(n => !diffSet.has(n))
						}
					}
				}
			}
		}
		return c
	}  
	cloneMap(a){
		return global.deepClone(a)
	}
	async groups(types, myListsOnly){
		let groups = [], map = {}
		if(myListsOnly) {
			myListsOnly = global.config.get('lists').map(l => l[1])
		}
		Object.keys(this.lists).forEach(url => {
			if(myListsOnly && !myListsOnly.includes(url)) return
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
			global.displayErr('GROUP='+JSON.stringify(group))
			throw 'List not loaded'
		}

/*
		let mmap, map = this.lists[group.url].index.groups[group.group].slice(0)
		if(!map) map = []
		Object.keys(this.lists[group.url].index.groups).forEach(s => {
			if(s != group.group && s.indexOf('/') != -1 && s.startsWith(group.group)){
				if(!mmap) { // jit
					mmap = new Map(map.map(m => [m, null]))
					map = [] // freeup mem
				}
				this.lists[group.url].index.groups[s].forEach(n => mmap.has(n) || mmap.set(n, null))
			}
		})

		if(mmap) {
			map = Array.from(mmap, ([key]) => key)
		}
*/
		let entries = [], map = this.lists[group.url].index.groups[group.group] || []
		if(map.length) {
			entries = await this.lists[group.url].getEntries(map)
			return entries
		}
		entries = this.parentalControl.filter(entries, true)
		entries = this.sort(entries)
		return entries
	}
}

module.exports = Index
