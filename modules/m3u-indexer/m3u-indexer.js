const async = require('async'), M3UParser = require('./m3u-ext-parser'), M3UTools = require('./m3u-indexer-tools'), MediaStreamInfo = require('./media-stream-info'), Events = require('events')

class M3UIndexer extends Events {
	constructor(opts){  // opts.store is required
		super()
        Object.keys(opts).forEach(k => {
            this[k] = opts[k]
		})
		this.stopWords = []
		this.lists = {}
		this.groupsCaching = {}
		this.tools = new M3UTools()
		this.msi = new MediaStreamInfo()
		this.parser = new M3UParser(opts)
		this.filters = []
		this.unsafeIndex = {}
	}
	isSafe(entry){
		return true
	}
	updateSafetyIndex(url){
		this.lists[url].forEach((e, i) => {
			if(e.isSafe === false && typeof(this.unsafeIndex[e.url]) == 'undefined'){
				this.unsafeIndex[e.url] = true
			}
		})
	}
	updateSafetyAll(){
		Object.keys(this.lists).forEach(listUrl => {
			this.lists[listUrl].forEach((e, i) => {
				if(e.isSafe && typeof(this.unsafeIndex[e.url]) != 'undefined'){
					this.lists[listUrl][i].isSafe = false
				}
			})
		})
	}
	setLists(urls){
		let fetchs = []
		Object.keys(this.lists).forEach(u => {
			if(urls.indexOf(u) == -1){
				delete this.lists[u]
			}
		})
		async.eachOfLimit(urls, 1, (url, i, acb) => {
			if(typeof(this.lists[url]) == 'undefined'){
				let key = 'iptv-read-'+url, fbkey = key + '-bak', flatList = this.store.get(key)
				if(Array.isArray(flatList)){
					this.lists[url] = flatList
				 } else {
					fetchs.push(url)
					flatList = this.store.get(fbkey)
					this.lists[url] = Array.isArray(flatList) ? flatList : []
				}
				this.updateSafetyIndex(url)
			}
			acb()
		}, () => {
			this.updateStatsNGroups()
			async.eachOfLimit(fetchs, 2, (url, i, acb) => {
				this.parser.parse(url, (flatList) => {
					if(Array.isArray(flatList) && flatList.length){
						let key = 'iptv-read-'+url, fbkey = key + '-bak'
						this.lists[url] = this.joinDups(flatList).map(entry => {
							entry.terms = {
								name: this.terms(entry.name),
								group: this.terms(entry.group || '')
							}
							entry.mediaType = this.msi.mediaType(entry)
							entry.isAudio = this.msi.isAudio(entry.url) || this.msi.isRadio(entry.name)
							entry.isSafe = this.isSafe(entry)
							return entry
						})
						this.updateSafetyIndex(url)
						this.store.set(key, this.lists[url], (24 * 3600))
						this.store.set(fbkey, this.lists[url], 30 * (24 * 3600))
						this.updateStatsNGroups()
					}
				})
				acb()
			}, () => {
				cb()
			})
		})
	}
	updateGroups(){
		let tpl = {'video': [], 'live': [], 'audio': [], 'adult': []}, ret = Object.assign({}, tpl)
		Object.keys(this.lists).forEach(source => {
			let gs = this.groupsCaching[source]
			if(!Array.isArray(gs)){
				gs = Object.assign({}, tpl)
				this.lists[source].forEach(entry => {
					let gn = entry.groupName, type = entry.mediaType
					if(gn){
						gn = gn.trim()
					}
					if(gn){
						if(entry.isSafe === false && gs['adult'].indexOf(gn) == -1){
							gs['adult'].push(gn)
						}
						if(entry.isAudio === true && gs['audio'].indexOf(gn) == -1){
							gs['audio'].push(gn)
						}
						if(typeof(gs[type]) != 'undefined'){
							if(gs[type].indexOf(gn) == -1){
								gs[type].push(gn)
							}
						}
					}
				})
				this.groupsCaching[source] = gs
			}
			Object.keys(gs).forEach(t => {
				if(gs[t].length){
					gs[t].forEach(n => {
						if(ret[t].indexOf(n) == -1){
							ret[t].push(n)
						}
					})
				}
			})
		})		
		Object.keys(ret).forEach(t => {
			ret[t].sort()
		})
		this.groups = ret
	}
	updateStats(){
		this.stats = {}
		Object.keys(this.lists).forEach(source => {
			let list = this.lists[source]
			list.forEach(entry => {
				if(typeof(this.stats[entry.mediaType]) == 'undefined'){
					this.stats[entry.mediaType] = 0
				}
				this.stats[entry.mediaType]++
			})
		})	
	}
	updateStatsNGroups(){	
		this.updateSafetyAll()	
		this.updateStats()
		this.updateGroups()
		this.emit('stats', this.stats, this.groups)
	}
	remove(url){
		delete this.lists[url]
	}
	terms(txt){
		if(!txt){
			return []
		}
		return txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(' ').filter(s => {
			return s.length > 2 && this.stopWords.indexOf(s) == -1
		})
	}
	matchStrict(aTerms, bTerms){
		let score = 0
		if(aTerms.length && bTerms.length){
			aTerms.forEach(term => {
				if(bTerms.indexOf(term) != -1){
					score++
				}
			})
			if(score){
				if(score == aTerms.length) { // all search terms are present
					if(score == bTerms.length){ // terms are equal
						return 3
					} else {
						return 2
					}
				} else if(aTerms.length >= 3 && score == (aTerms.length - 1)){
					return 1
				}
			}
		}
		return 0
	}
	match(aTerms, bTerms){
		let score = 0
		if(aTerms.length && bTerms.length){
			aTerms.forEach(term => {
				let len = term.length
				bTerms.some(bTerm => {
					if(term == bTerm.substr(0, len)){
						score++
						return true
					}
				})
			})
			if(score){
				if(score == aTerms.length) { // all search terms are present
					if(score == bTerms.length){ // terms are equal
						return 3
					} else {
						return 2
					}
				} else if(aTerms.length >= 3 && score == (aTerms.length - 1)){
					return 1
				}
			}
		}
		return 0
	}
	has(terms, matchGroup, matchPartial, types){
		let results = [], maybe = [] 
		if(!terms){
			return results
		}
		if(typeof(terms) != 'object'){ // not array
			terms = this.terms(terms)
		}
		let has = Object.keys(this.lists).some(source => {
			let list = this.lists[source]
			return list.some(entry => {
				if(types.indexOf(entry.mediaType) != -1){
					const score = this.match(terms, entry.terms.name)
					if(score >= 2){
						return true
					} else if((score == 1 && matchPartial) || (matchGroup && this.match(terms, entry.terms.group))){
						maybe.push(entry)
					}
				}
			})
		})
		if(has){
			return true
		}
		if(matchGroup && !results.length && maybe.length){
			results = maybe
			maybe = []
		}
		return results.length
	}
	search(terms, matchGroup, matchPartial, types, unsafe){
		console.warn('M3U SEARCH', terms, matchGroup, matchPartial, types, unsafe)
		let bestResults = [], results = [], maybe = [], all = types.indexOf('all') != -1
		if(!terms){
			return results
		}
		if(typeof(terms) != 'object'){ // not array
			terms = this.terms(terms)
		}
		Object.keys(this.lists).forEach(source => {
			this.lists[source].forEach(entry => {
				if(all || types.indexOf(entry.mediaType) != -1){
					if(typeof(unsafe) != 'boolean' || entry.isSafe === !unsafe){
						const score = this[matchPartial?'match':'matchStrict'](terms, entry.terms.name)
						if(score == 3) {
							entry.source = source
							bestResults.push(entry)
						} else if(score == 2) {
							entry.source = source
							results.push(entry)
						} else if((matchPartial && score == 1) || (matchGroup && this.match(terms, entry.terms.group))){
							entry.source = source
							maybe.push(entry)
						}
					}
				}
			})
		})
		console.warn('M3U SEARCH RESULTS', terms, bestResults.slice(0), results.slice(0), maybe.slice(0))
		results = bestResults.concat(results)
		if(maybe.length){
			if(!results.length){
				results = maybe
				maybe = []
			}
		} else {
			maybe = this.joinDups(maybe)
		}
		results = this.joinDups(results)
		return {results, maybe}
	}
	queryGroup(group, atts){
		let entries = [], ks = atts ? Object.keys(atts) : []
		Object.keys(this.lists).forEach(source => {
			this.lists[source].forEach(e => {
				if(!e.groups){
					console.log(JSON.stringify(e))
				}
				if(e.groups.indexOf(group) != -1){
					if(ks.length){
						ks.forEach(k => {
							if(atts[k] != e[k]){
								return
							}
						})
					}
					entries.push(e)
				}
			})
		})
		return this.joinDups(entries)
	}
	mergeNames(a, b){
		var la = a.toLowerCase();
		var lb = b.toLowerCase();
		if(la.indexOf(lb)!=-1){
			return a;
		}
		if(lb.indexOf(la)!=-1){
			return b;
		}
		return a+' - '+b;
	}
	groups(type){
		let groups = []
		Object.keys(this.lists).forEach(url => {
			let list = this.lists[url].filter(e => {
				if(e.mediaType == type){
					let group = e.groupName
					if(groups.indexOf(group) == -1){
						groups.push(group)
					}
				}
			})
		})
		return groups		
	}
	group(groupName, type){
		let entries = []
		Object.keys(this.lists).forEach(url => {
			let list = this.lists[url].filter(e => {
				if(e.groupName == groupName && e.mediaType == type){
					entries.push(e)
				}
			})
		})
		return entries
	}
	joinDups(flatList){
		var already = {}, map = {}
		for(var i=0; i<flatList.length; i++){
			if(!flatList[i]){
				delete flatList[i]
			} else if(typeof(flatList[i].type)=='undefined' || flatList[i].type=='stream') {
				if(typeof(already[flatList[i].url]) != 'undefined'){
					var j = map[flatList[i].url]
					if(flatList[j].name != flatList[i].name){
						flatList[j].name = this.mergeNames(flatList[j].name, flatList[i].name)
						flatList[j].rawname = this.mergeNames(flatList[j].rawname || flatList[j].name, flatList[i].rawname || flatList[j].name)
					}
					delete flatList[i]
				} else if(flatList[i].url.substr(0, 7) == 'mega://') {
					delete flatList[i]
				} else {
					already[flatList[i].url] = 1
					map[flatList[i].url] = i
				}
			}
		}
		return flatList.filter(item => {
			return item !== undefined
		})
	}
	deepify(flatList){
		var parsedGroups = {}
		for(var i=0;i<flatList.length;i++){
			if(typeof(parsedGroups[flatList[i].group])=='undefined'){
				parsedGroups[flatList[i].group] = [];
			}
			parsedGroups[flatList[i].group].push(flatList[i]);
		}
		var groupedEntries = [];
		for(var k in parsedGroups){
			groupedEntries.push({name: this.tools.basename(k), path: k, type: 'group', label: '', entries: parsedGroups[k]});
		}
		var recursivelyGroupedList = [];
		for(var i=0; i<groupedEntries.length; i++){
			if(groupedEntries[i].path.indexOf('/')!=-1){ // no path
				recursivelyGroupedList = this.tools.insertAtPath(recursivelyGroupedList, groupedEntries[i].path, groupedEntries[i])
			}
		}
		for(var i=0; i<groupedEntries.length; i++){
			if(groupedEntries[i].path.indexOf('/')==-1){ // no path
				recursivelyGroupedList = this.tools.mergeEntriesWithNoCollision(recursivelyGroupedList, [groupedEntries[i]])
			}
		}
		recursivelyGroupedList = this.tools.sortRecursively(recursivelyGroupedList)
		recursivelyGroupedList = this.tools.paginate(recursivelyGroupedList)
		recursivelyGroupedList = this.tools.labelify(recursivelyGroupedList)
		callback(recursivelyGroupedList, content)
	}
}
module.exports = M3UIndexer
