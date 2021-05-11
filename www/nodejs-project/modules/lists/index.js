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
            terms.map(t => {
                ret[t] = this.applySearchRedirects(this.terms(t))
				results[t] = false
			})
			if(!opts){
				opts = {}
			}
			Object.keys(this.lists).forEach((listUrl, i) => {
            	Object.keys(ret).forEach(k => {
					if(results[k] == true) { // already found
						return
					}
					let ssmap
					ret[k].some(term => {
						if(typeof(this.lists[listUrl].index.terms[term]) == 'undefined'){
							ssmap = undefined
							return true
						} else {
							let map = {}
							map[listUrl] = global.deepClone(this.lists[listUrl].index.terms[term])
							if(ssmap){
								ssmap = this.intersectMap(map, ssmap)
							} else {
								ssmap = map
							}
							if(!Object.keys(ssmap).length){
								ssmap = undefined
								return true
							}
						}
					})
					if(ssmap && this.mapSize(ssmap)){
						// found on this list
						results[k] = true
					}
				})
            })
            resolve(results)
        })
	}
	search(terms, opts){	
		return new Promise((resolve, reject) => {
            if(this.debug){
                console.warn('M3U SEARCH', terms, opts)
            }
            let start = global.time(), xmap, smap, aliases = {}, bestResults = [], results = [], maybe = [], excludeTerms = [], limit = 256
            if(!terms){
                return resolve({results, maybe})
            }
            if(typeof(opts.type) != 'string'){
                opts.type = false
            }
            if(!Array.isArray(terms)){
                terms = this.terms(terms, true)
			}
            terms = terms.filter(term => {
				let isExclude = term.charAt(0) == '-'
                if(isExclude){
                    let xterm = term.substr(1)
					Object.keys(this.lists).forEach(listUrl => {
						if(typeof(this.lists[listUrl].index.terms[xterm]) != 'undefined'){
							let map = {}
							map[listUrl] = global.deepClone(this.lists[listUrl].index.terms[xterm])
							if(xmap){
								xmap = this.joinMap(xmap, map)
							} else {
								xmap = map
							}
						}
					})
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
                let results = []
                if(xmap){
					smap = this.diffMap(smap, xmap)
				}
				const ks = Object.keys(smap)
				ks.forEach(listUrl => {
					let ls = smap[listUrl]['n']
					if(opts.group){
						console.log('ggroup', smap[listUrl]['g'])
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
					xmap = smap = bestResults = results = maybe = null
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
			c += a[listUrl].n.length
			if(group){
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
