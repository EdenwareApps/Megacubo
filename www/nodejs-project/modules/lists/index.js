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
	applySearchOpts(opts){ // ensure opts will have the same order for a more effective searchMapCache key
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
				let smap = this.searchMap(ret[k], opts)
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
	searchMap(terms, opts){
		if(!terms){
			return {}
		}
		opts = this.applySearchOpts(opts)
		let key = terms.join(',') + JSON.stringify(opts)
		if(typeof(this.searchMapCache[key]) != 'undefined'){
			return global.deepClone(this.searchMapCache[key])
		}
		if(terms.includes('|')){
			let needles = terms.join(' ').split(' | ').map(s => s.split(' '))
			let fullMap = {}
			needles.forEach(needle => {
				let map = this.searchMap(needle, opts)
				fullMap = this.joinMap(fullMap, map)
			})
			this.searchMapCache[key] = fullMap
			return global.deepClone(fullMap)
		}
		let xmap, smap, aliases = {}, excludeTerms = []
		if(typeof(opts.type) != 'string'){
			opts.type = false
		}
		if(!Array.isArray(terms)){
			terms = this.terms(terms, true)
		}
		terms = terms.filter(term => { // separate excluding terms
			let isExclude = term.charAt(0) == '-'
			if(isExclude){
				let xterm = term.substr(1)
				excludeTerms.push(xterm)
				return false
			}
			return true
		})
		terms = this.applySearchRedirects(terms)
		if(opts.partial){
			let allTerms = []
			Object.keys(this.lists).forEach(listUrl => {
				Object.keys(this.lists[listUrl].index).forEach(term => {
					if(!allTerms.includes(term)){
						allTerms.push(term)
					}
				})
			})
			terms.forEach(term => {
				let tlen = term.length, nterms = allTerms.filter(t => {
					return t != term && t.length > tlen && (t.substr(0, tlen) == term || t.substr(t.length - tlen) == term)
				})
				if(nterms.length){
					aliases[term] = nterms
				}
			})
		}
		terms = terms.filter(t => !excludeTerms.includes(t))
		terms.some(term => {
			let tmap, tms = [term]
			if(typeof(aliases[term]) != 'undefined'){
				tms = tms.concat(aliases[term])
			}
			tms.forEach(term => {
				Object.keys(this.lists).forEach(listUrl => {
					if(typeof(this.lists[listUrl].index.terms[term]) != 'undefined'){
						let map = {}
						map[listUrl] = this.lists[listUrl].index.terms[term]
						if(tmap){
							tmap = this.joinMap(tmap, map)
						} else {
							tmap = global.deepClone(map)
						}
					}
				})
			})
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
			if(excludeTerms.length){
				let ms = this.mapSize(smap, opts.group)
				if(ms){
					excludeTerms.some(xterm => {
						return Object.keys(this.lists).some(listUrl => {
							if(typeof(this.lists[listUrl].index.terms[xterm]) != 'undefined'){
								let xmap = {}
								xmap[listUrl] = this.lists[listUrl].index.terms[xterm]
								smap = this.diffMap(smap, xmap)
								ms = this.mapSize(smap, opts.group)
								if(!ms) return true // break
							}
						})
					})
				}
			}
			this.searchMapCache[key] = global.deepClone(smap)
			return smap
		}
		this.searchMapCache[key] = {}
		return {}
	}
	search(terms, opts){	
		return new Promise((resolve, reject) => {
            if(this.debug){
				console.warn('M3U SEARCH', terms, opts)
			}
			if(typeof(terms) == 'string'){
				terms = this.terms(terms, true, true)
			}
            let start = global.time(), bestResults = [], maybe = [], limit = 256
            let smap = this.searchMap(terms, opts), ks = Object.keys(smap)
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
                    if(listUrl && typeof(this.lists[listUrl]) != 'undefined'){
						if(this.debug){
							console.warn('M3U SEARCH ITERATE', smap[listUrl].slice(0))
						}
						this.lists[listUrl].iterate(e => {
							if(this.debug){
								console.warn('M3U SEARCH ITERATE', e)
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
					results = this.adjustSearchResults(results, limit)
					if(results.length < limit){
						maybe = this.adjustSearchResults(maybe, limit - results.length)
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
	getDomain(u){
    	if(u && u.indexOf('//')!=-1){
	        let domain = u.split('//')[1].split('/')[0]
        	if(domain == 'localhost' || domain.indexOf('.') != -1){
	            return domain.split(':')[0]
        	}
    	}
    	return ''
	}
	adjustSearchResults(entries, limit){
		let map = {}, nentries = [];
		(global.config.get('tuning-prefer-hls') ? this.preferHLS(entries) : entries).forEach(e => {
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
        return entries.slice(0).sort((a, b) => {
			let aa = this.ext(a.url) == 'm3u8'
			let bb = this.ext(b.url) == 'm3u8'
			return aa == bb ? 0 : (aa && !bb ? -1 : 1)
        })
    }
	unoptimizedSearch(terms, opts){
		return new Promise((resolve, reject) => {
            let xmap, smap, aliases = {}, bestResults = [], results = [], maybe = [], excludeTerms = []
            if(!terms){
                return resolve({results, maybe})
            }
            if(typeof(opts.type) != 'string'){
                opts.type = false
            }
            if(!Array.isArray(terms)){
                terms = this.terms(terms, true, true)
			}
            if(opts.partial){ // like glob to globo
				let allTerms = []
				Object.keys(this.lists).forEach(listUrl => {
					Object.keys(this.lists[listUrl].index).forEach(term => {
						if(!allTerms.includes(term)){
							allTerms.push(term)
						}
					})
				})
				terms.forEach(term => {
					let tlen = term.length, nterms = allTerms.filter(t => {
						return t != term && t.length > tlen && (t.substr(0, tlen) == term || t.substr(t.length - tlen) == term)
					})
					if(nterms.length){
						aliases[term] = nterms
					}
				})
			}
            terms.forEach((term, i) => {
				let isExclude = term.charAt(0) == '-'
                if(isExclude){
					excludeTerms.push(term)
                }
			})
			if(excludeTerms.length){
				terms = terms.filter(t => !excludeTerms.includes(t)) // remove excludes from terms
				excludeTerms = excludeTerms.map(t => t.substr(1))
				terms = terms.filter(t => !excludeTerms.includes(t)) // now remove excluded terms
			}
            if(terms.length){
                let results = []
                async.eachOf(Object.keys(this.lists), (listUrl, i, acb) => {
                    if(listUrl && this.lists[listUrl]){
						this.lists[listUrl].iterate(e => {
							if(!e.terms.name.some(t => excludeTerms.includes(t))){
								let name = e.name.toLowerCase()
								if(terms.every(t => name.indexOf(t) != -1)){
									if(opts.type){
										if(this.validateType(e, opts.type, opts.typeStrict === true)){
											if(opts.typeStrict === true) {
												e.source = listUrl
												bestResults.push(e)
												hits++
											} else {
												e.source = listUrl
												results.push(e)
												hits++
											}
										}
									} else {
										bestResults.push(e)
										hits++
									}
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
            } else {
                resolve({results:[], maybe: []})
            }
        })
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
	joinMap(a, b){
		let c = global.deepClone(a) // clone it
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
							let i = a[listUrl][type].indexOf(n)
							if(i != -1){
								if(!c) c = global.deepClone(a) // clone it lazily
								c[listUrl][type].splice(i, 1)
							}
						})
					}
				})
			}
		})
		return c || a
	}
	group(group, atts){
		return new Promise((resolve, reject) => {
			let entries = [], ks = atts ? Object.keys(atts) : []
			async.eachOf(Object.keys(this.lists), (listUrl, i, done) => {
				if(Object.keys(this.lists[listUrl].index.groups).indexOf(group) != -1){
					this.lists[listUrl].iterate(e => {
						if(e.group == group){
							if(ks.length){
								ks.forEach(k => {
									if(atts[k] != e[k]){
										return
									}
								})
							}
							if(!e.source){
								e.source = listUrl
							}
							entries.push(e)
						}
					}, this.lists[listUrl].index.groups[group], done)
				} else {
				    done()
                }
			}, () => {
				//console.log(entries)
				entries = this.tools.dedup(entries)
				entries = this.parentalControl.filter(entries)
				resolve(entries)
			})
		})
	}
    groups(){
        return new Promise((resolve, reject) => {
			let gs = []
			Object.keys(this.lists).forEach(listUrl => {
				Object.keys(this.lists[listUrl].index.groups).forEach(group => {
					if(group && !gs.includes(group)){
						gs.push(group)
					}
				})
			})
            gs.sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}))
            resolve(gs)
        })
    }
}

module.exports = Index
