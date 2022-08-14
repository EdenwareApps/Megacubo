const async = require('async'), Common = require(global.APPDIR + '/modules/lists/common.js')

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
				const hints = [...new Set(terms.map(t => t.substr(0, 2)))], mterms = []
				console.log('parsing query')
				Object.keys(this.lists).forEach(listUrl => {
					Object.keys(this.lists[listUrl].index.terms).forEach(term => {
						if(hints.includes(term.substr(0, 2)) && !mterms.includes(term)){
							mterms.push(term)
						}
					})
				})
				console.log('parsing query2', mterms.length)
				terms.forEach(term => {
					let tlen = term.length
					if(tlen < 3) return // dont autocomplete small words, too many vars
					let nterms = mterms.filter(t => {
						return t != term && t.length > tlen && !excludes.includes(t) && (t.substr(0, tlen) == term || t.substr(t.length - tlen) == term)
					})
					if(nterms.length){
						aliases[term] = nterms
					}
				})
				console.log('parsing query', mterms.length, aliases)
			}
			terms = terms.filter(t => !excludes.includes(t))
			return [{terms, excludes, aliases}]
		}
	}
	searchMap(query, opts){
		let fullMap
		console.log('searchMap')
		opts = this.optimizeSearchOpts(opts)
		query.forEach(q => {
			let map = this.querySearchMap(q, opts)
			fullMap = fullMap ? this.joinMap(fullMap, map) : map
		})
		console.log('searchMap')
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
				tms = tms.concat(q.aliases[term])
			}
			let tmap = this.queryTermMap(tms)
			console.warn('TMAPSIZE', term, tmap ? this.mapSize(tmap) : 0)
			console.warn('SMAPSIZE', term, smap ? this.mapSize(smap) : 0)
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
					console.warn('XMAPSIZE', this.mapSize(xmap), ms)
				}
			}
			this.searchMapCache[key] = this.cloneMap(smap)
			return smap
		}
		this.searchMapCache[key] = {}
		return {}
	}
	search(terms, opts){	
		return new Promise((resolve, reject) => {
			this.debug = true
			if(typeof(terms) == 'string'){
				terms = this.terms(terms, true, true)
			}
            let start = global.time(), bestResults = [], maybe = [], limit = 512
			if(!terms){
				return []
			}
			console.log('searchMap')
			const query = this.parseQuery(terms, opts)
			console.log('searchMap')
            let smap = this.searchMap(query, opts), ks = Object.keys(smap)
			console.log('searchMap')
			if(ks.length){
				if(this.debug){
					console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s (pre time)', Object.assign({}, smap), (global.time() - start) +'s', terms)
				}
                let results = []
				ks.forEach(listUrl => {
					let ls = smap[listUrl]['n']
					if(opts.group){
						ls = ls.concat(smap[listUrl]['g'])
					}
					smap[listUrl] = ls
				})
                async.eachOf(ks, (listUrl, i, icb) => {
                    if(listUrl && typeof(this.lists[listUrl]) != 'undefined' && smap[listUrl].length){
						if(this.debug){
							console.warn('M3U SEARCH ITERATE', smap[listUrl].slice(0))
						}
						this.lists[listUrl].iterate(e => {
							if(this.debug){
								console.warn('M3U SEARCH ITERATE', e)
							}
							if(!this.matchSearchResult(e, query, opts)){ // filter again to prevent false positive due lists-index sync misbehaviour
								return
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
						}, smap[listUrl], icb)
                    } else {
                        icb()
                    }
                }, () => {
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
                    results = this.tools.dedup(results)
					results = this.prepareEntries(results)
					if(opts.parentalControl !== false){
						results = this.parentalControl.filter(results)
						maybe = this.parentalControl.filter(maybe)
					}
					results = this.adjustSearchResults(results, opts, limit)
					if(results.length < limit){
						maybe = this.adjustSearchResults(maybe, opts, limit - results.length)
					} else {
						maybe = []
					}
					if(this.debug){
						console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s (total time)', terms)
					}
					resolve({results, maybe})
					smap = bestResults = results = maybe = null
                })
            } else {
                resolve({results:[], maybe: []})
            }
        })
	}
	matchSearchResult(e, queries, opts){
		let eterms = e.terms.name
		if(opts.group){
			eterms = eterms.concat(e.terms.group)
		}
		return queries.some(query => {
			if(!eterms.some(t => query.excludes.includes(t))){
				const aliases = Object.values(query.aliases).flat()
				const matched = query.terms.every(t => {
					return eterms.includes(t) || aliases.includes(t)
				})
				if(matched){
					return true
				}
			}
		})
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
		(
			(opts && opts.type == 'live' && global.config.get('tuning-prefer-hls')) ? 
			this.preferHLS(entries) : 
			entries
		).forEach(e => {
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
		return nentries
	}
    ext(file){
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase()
    }
    preferHLS(entries){
        let notHLS = []
		entries = entries.slice(0).filter(a => {
			if(this.ext(a.url) == 'm3u8'){
				return true
			}
			notHLS.push(a)
        })
		return entries.concat(notHLS)
    }
	unoptimizedSearch(terms, opts){
		return new Promise((resolve, reject) => {
            let xmap, smap, bestResults = [], results = [], maybe = []
            if(!terms){
                return resolve({results, maybe})
            }
            if(typeof(opts.type) != 'string'){
                opts.type = false
            }
            const query = this.parseQuery(terms, opts)
			async.eachOf(Object.keys(this.lists), (listUrl, i, acb) => {
				if(listUrl && this.lists[listUrl]){
					this.lists[listUrl].iterate(e => {
						if(this.matchSearchResult(e, query, opts)){
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
						}
					}, false, acb)
				} else {
					acb()
				}
			}, () => {
				if(this.debug){
					console.warn('M3U SEARCH RESULTS', terms, bestResults.slice(0), results.slice(0), maybe.slice(0))
				}
				results = bestResults.concat(results)
				if(maybe.length){
					if(!results.length){
						results = maybe
						maybe = []
					}
				}
				results = this.tools.dedup(results)
				results = this.prepareEntries(results)	
				if(typeof(opts.parentalControl) != 'undefined' && opts.parentalControl !== false){
					results = this.parentalControl.filter(results)
					maybe = this.parentalControl.filter(maybe)
				}				
				resolve({results, maybe})
			})
        })
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
		return Object.assign({}, a)
	}
	async groups(type){
		let groups = [], map = {}
		Object.keys(this.lists).forEach(url => {
			let entries = this.lists[url].index.groupsTypes
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
		if(['series', 'vod'].includes(type)){
			const rgx = new RegExp('(^[0-9]{1,2})(?:[^0-9]|$)|(?:[^0-9]|^)([0-9]{1,2}$)') // episode 1 OR 1st episode
			Object.keys(map).forEach(path => { // better filter series by episodes disposition
				if(map[path].length){
					let seemsSeries, ns = map[path].map(n => {
						let m = n.match(rgx)
						return m ? m.slice(0, 2).map(n => parseInt(n)).filter(n => n).shift() : false
					}).filter(n => n)
					if(ns.length >= (map[path].length * 0.75)){
						let dfs = [...new Set(ns)]
						if(dfs.length >= (ns.length * 0.75)){
							//let max = Math.max(...dfs)
							//if(max <= (map[path].length * 1.5)) {
							seemsSeries = true
							//}
						}
					}
					if(type == 'series'){
						if(seemsSeries){
							return
						}
					} else { // vod
						if(!seemsSeries){
							return
						}
					}
				}
				delete map[path]
			})
		}
		if(typeof(Intl) != 'undefined'){
			const collator = new Intl.Collator(global.lang.locale, { numeric: true, sensitivity: 'base' })
			groups.sort((a, b) => collator.compare(a.name, b.name))
		} else {
			groups.sort()
		}
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
	group(group){
		return new Promise((resolve, reject) => {
			let entries = []
			if(!this.lists[group.url]){
				return reject('List unloaded')
			}
			this.lists[group.url].iterate(e => {
				if(e.group == group.group){
					if(!e.source){
						e.source = group.url
					}
					entries.push(e)
				}
			}, this.lists[group.url].index.groups[group.group], () => {
				console.log(entries)
				entries = this.tools.dedup(entries)
				entries = this.parentalControl.filter(entries)
				
				if(typeof(Intl) != 'undefined'){
					const collator = new Intl.Collator(global.lang.locale, { numeric: true, sensitivity: 'base' })
					entries.sort((a, b) => collator.compare(a.name, b.name))
				} else {
					entries.sort()
				}

				resolve(entries)
			})
		})
	}
}

module.exports = Index
