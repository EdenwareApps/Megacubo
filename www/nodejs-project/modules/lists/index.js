const async = require('async'), Common = require(global.APPDIR + '/modules/lists/common.js')

class Index extends Common {
    constructor(opts){
		super(opts)
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
	searchMap(terms, opts){
		let xmap, smap, aliases = {}, excludeTerms = []
		if(!terms){
			return {}
		}
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
						map[listUrl] = global.deepClone(this.lists[listUrl].index.terms[term])
						if(tmap){
							tmap = this.joinMap(tmap, map)
						} else {
							tmap = map
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
								xmap[listUrl] = global.deepClone(this.lists[listUrl].index.terms[xterm])
								smap = this.diffMap(smap, xmap)
								ms = this.mapSize(smap, opts.group)
								if(!ms) return true // break
							}
						})
					})
				}
			}
			return smap
		}
		return {}
	}
	search(terms, opts){	
		return new Promise((resolve, reject) => {
            console.warn('M3U SEARCH', terms, opts)
            let start = global.time(), bestResults = [], results = [], maybe = [], limit = 256
            let smap = this.searchMap(terms, opts), ks = Object.keys(smap)
            if(ks.length){
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
						this.lists[listUrl].iterate(e => {
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
						console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s', terms, bestResults.slice(0), results.slice(0), maybe.slice(0))
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
					results = this.parentalControl.filter(results)
					maybe = this.parentalControl.filter(maybe)
					if((results.length + maybe.length) > limit){
						let mlen = maybe.length
						if(mlen > limit){
							maybe = maybe.slice(0, mlen - limit)
						} else if(mlen == limit) {
							maybe = []
						} else {
							maybe = []
							limit -= mlen
							if(results.length > limit){
								results = results.slice(0, limit)
							}
						}
					}
					console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s (total time)', terms)
					resolve({results, maybe})
					smap = bestResults = results = maybe = null
                })
            } else {
                resolve({results:[], maybe: []})
            }
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
					results = this.parentalControl.filter(results)
					maybe = this.parentalControl.filter(maybe)
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
		let c = global.deepClone(a) // clone it
		Object.keys(b).forEach(listUrl => {
			if(typeof(c[listUrl]) != 'undefined'){
				Object.keys(b[listUrl]).forEach(type => {
					if(typeof(c[listUrl][type]) != 'undefined'){
						b[listUrl][type].forEach(n => {
							let i = c[listUrl][type].indexOf(n)
							if(i != -1){
								c[listUrl][type].splice(i, 1)
							}
						})
					}
				})
			}
		})
		return c
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
            gs = this.parentalControl.filter(gs)
            gs.sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}))
            resolve(gs)
        })
    }
}

module.exports = Index
