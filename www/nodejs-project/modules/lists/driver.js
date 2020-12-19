
const async = require('async'), path = require('path'), Events = require('events'), fs = require('fs'), crypto = require('crypto')

const Common = require(global.APPDIR + '/modules/lists/common.js')
const EPG = require(global.APPDIR + '/modules/lists/epg.js')

const Storage = require(APPDIR + '/modules/storage')
const Cloud = require(APPDIR + '/modules/cloud')
const Mega = require(APPDIR + '/modules/mega')

require(APPDIR + '/modules/supercharge')(global)

const FETCHER_CACHE_KEY_MASK = 'data-{0}'
const FETCHER_CACHE_TIME_KEY_MASK = 'time-{0}'

const LIST_HASH_KEY_MASK = 'list-hash-{0}'
const LIST_DATA_KEY_MASK = 'list-data-{0}'

storage = new Storage()  
tstorage = new Storage('', {temp: true, clear: false, cleanup: false})  
rstorage = new Storage() 
rstorage.useJSON = false

Download = require(APPDIR + '/modules/download')
cloud = new Cloud()
mega = new Mega()

class List {
	constructor(url, parent){
		this.debug = false
		this.parent = parent
		if(url.substr(0, 2) == '//'){
			url = 'http:'+ url
		}
		this.url = url
		this.inMemory = false
		this.inMemoryEntriesLimit = 1
        this.hashKey = LIST_HASH_KEY_MASK.format(url)
		this.dataKey = LIST_DATA_KEY_MASK.format(url)
		this.data = []
        this.constants = {
			BREAK: -1
		}
		this._log = [
			this.url
		]
	}	
	log(...args){
		args.unshift((new Date()).getTime() / 1000)
		this._log.push(args)
	}
	termify(t){ // any str to terms list joined by space
		if(Array.isArray(t)){
			return t.map(s => this.termify(s))
		}
		return this.parent.terms(t).join(' ')
	}
	load(content, skipCache){
		return new Promise((resolve, reject) => {
			let chash = crypto.createHash('md5').update(content).digest('hex')
			global.rstorage.get(this.hashKey, hash => {
				//console.log('load', content, hash, chash)
				if(skipCache !== true && hash && hash == chash){ // no changes, load pre parsed cache
					if(!this.data.length){
						global.rstorage.get(this.dataKey, data => {
							if(data){
								this.data = data.split("\n")
								let arr = JSON.parse('[' + this.data.join(",") + ']')
								if(Array.isArray(arr)){
									this.inMemory = this.indexate(arr)
									this.data = this.prepareData(this.inMemory)
									if(this.data.length > this.inMemoryEntriesLimit){
										this.inMemory = false
									}
									global.rstorage.set(this.dataKey, this.data.join("\n"), 30 * (24 * 3600), () => {
										this.log('updated and saved')
									})
								}
								resolve(true)
							} else {
								this.load(content, true).then(resolve).catch(reject)
							}
						})
					} else {
						resolve(true)
					}
				} else { // content changed, reparse
					global.rstorage.set(this.hashKey, chash, true)
					this.log('parsing...')
					let s = time(), i = 0, entries = []
					entries = this.parent.parser.parse(content)
					entries = this.indexate(entries)
					this.log('parsed in ' + Math.round(time() - s, 2) + 's, now saving...', entries)
					this.data = this.prepareData(entries)
					if(entries.length <= this.inMemoryEntriesLimit){
						this.inMemory = entries
					} else {
						this.inMemory = false
					}
					resolve(true)
					global.rstorage.set(this.dataKey, this.data.join("\n"), 30 * (24 * 3600), () => {
						this.log('updated and saved')
					})
				}
			})
		})
	}
	indexate(entries){
		this.parent.removeListData(this.url)
		let ret = this.parent.prepareEntries(entries).map((e, i) => {
			this.parent.addTerms(e, i, this.url)
			return e
		})
		this.parent.saveData()
		return ret
	}
	prepareData(entries){
		let content = JSON.stringify(entries)
		content = content.substr(1, content.length - 2).replace(new RegExp('\},\{', 'g'), "}\n{")
		return content.split("\n")
	}
	iterate(fn, cb, map){
		if(!Array.isArray(map)){
			map = false
		}
		if(this.inMemory){
			this.inMemory.some((e, i) => {
				if(!map || map.indexOf(i) != -1){
					let ne = fn(e)
					return ne === this.constants.BREAK
				}
			})
			if(typeof(cb) == 'function'){
				cb()
			}
		} else {
			let line, ne, buf = []
			this.data.forEach((line, i) => {
				if(line.length > 4 && (!map || map.indexOf(i) != -1)){
					buf.push(line)
				}
			})
			if(buf.length){
				try{
					buf = '['+ buf.join(',') +']'
					JSON.parse(buf).some((e, j) => {
						ne = fn(e)
						return ne === this.constants.BREAK
					})
				} catch(e) {
					console.log('JSON PARSE ERR', buf, e)
				}
			}
			if(typeof(cb) == 'function'){
				cb()
			}
		}
	}
	some(fn, cb){
		let some = false
		this.iterate(e => {
			if(fn(e)){
				some = true
				return this.constants.BREAK
			}
		}, () => {
			cb(some)
		})
	}
	fetchAll(){
		if(this.inMemory){
			return this.inMemory.slice(0)
		} else {
			let entries
			try {
				entries = JSON.parse('['+ this.data.join(',') +']')
			} catch(e) {
				console.error('JSON PARSE ERR', '['+ buf.join(',') +']', e)
				entries = []
			}
			return entries
		}
	}
	remove(){
		[this.dataKey, this.hashKey].forEach(k => {
			global.rstorage.delete(k)
		})
	}
	destroy(){
		delete this.parent
		delete this.inMemory
		delete this.data
		delete this._log
	}
}

class WatchingList extends List {
	constructor(url, parent){
		super(url, parent)
	}
	load(skipCache){
		return new Promise((resolve, reject) => {
			cloud.get('watching', true).then(content => {
				let chash = crypto.createHash('md5').update(content).digest('hex')
				global.rstorage.get(this.hashKey, hash => {
					//console.log('load', content, hash, chash)
					if(skipCache !== true && hash && hash == chash){ // no changes, load pre parsed cache
						if(this.data.length){
							resolve(true)
						} else {
							global.rstorage.get(this.dataKey, content => {
								if(content){
									this.data = content.split("\n")
									if(this.data.length <= this.inMemoryEntriesLimit){
										this.inMemory = JSON.parse('[' + this.data.join(",") + ']')
									} else {
										this.inMemory = false
									}
									resolve(true)
								} else {
									this.load(true).then(resolve).catch(reject)
								}
							})
						}
					} else { // content changed, reparse
						global.rstorage.set(this.hashKey, chash, true)
						this.log('parsing...')
						let s = time(), i = 0, entries = JSON.parse(content)
						entries = entries.filter(e => {
							return e.url && !global.mega.isMega(e.url)
						}).map(e => {
							if(typeof(e.logo) != 'undefined'){
								e.icon = e.logo
							}
							if(typeof(e.groups) == 'undefined'){
								e.groups = []
								e.group = ''
								e.groupName = ''
							}
							return e
						})
						entries = this.indexate(entries)
						this.log('parsed in ' + Math.round(time() - s, 2) + 's, now saving...', entries)
						this.data = this.prepareData(entries)
						if(entries.length <= this.inMemoryEntriesLimit){
							this.inMemory = entries
						} else {
							this.inMemory = false
						}
						resolve(true)
						global.rstorage.set(this.dataKey, this.data.join("\n"), true, () => {
							this.log('updated and saved')
						})
					}
				})
			}).catch(err => {
				console.error(err)
				resolve(false)
			})
		})
	}
	remove(){
		this.entries = null
	}
}

class Fetcher extends Events {
	constructor(){		
		super()
		this.cancelables = []
		this.minDataLength = 512
		this.maxDataLength = 32 * (1024 * 1024) // 32Mb
		this.ttl = 24 * 3600
	}
	validate(content){
		return typeof(content) == 'string' && content.length >= this.minDataLength && content.toLowerCase().indexOf('#ext') != -1
	}
	fetch(path, cancelable, callbackAgainOnUpdate, callback){
		if(path.substr(0, 2)=='//'){
			path = 'http:' + path
		}
		if(path.match('^https?:')){
			let cacheKey = FETCHER_CACHE_KEY_MASK.format(path), cacheTimeKey = FETCHER_CACHE_TIME_KEY_MASK.format(path), caches = {}
			async.eachOf([cacheKey, cacheTimeKey], (key, i, acb) => {
				global.rstorage.get(key, ret => {
					caches[key] = ret
					acb()
				})
			}, () => {
				let resolved
				if(this.validate(caches[cacheKey])){
					resolved = true
					callback(null, caches[cacheKey])
					if(!callbackAgainOnUpdate){
						return
					}
				}
				let now = global.time(), validFrom = now - this.ttl
				if(!resolved || !caches[cacheTimeKey] || parseInt(caches[cacheTimeKey]) < validFrom){ // should update
					//console.log('FETCHER CACHE INVALID', path, resolved, this.validate(caches[cacheKey]), caches[cacheKey], caches[cacheTimeKey], validFrom, now, this.ttl)
					const opts = {
						url: path,
						keepalive: false,
						retries: 2,
						followRedirect: true
					}
					if(cancelable){ // it's a shared list
						opts.downloadLimit = 12 * (1024 * 1024) // 12Mb
					}					
					const download = new global.Download(opts), onerr = err => {
						if(!resolved){
							resolved = true
							if(String(err).indexOf('Promise was cancelled') == -1){
								console.error(err)
							}
							callback(err)
						}
					}
					if(cancelable === true){
						this.cancelables.push({download, onerr})
					}
					download.on('response', (statusCode, headers) => {
						let length = headers['content-length'] || 0
						if(caches[cacheKey] && length == caches[cacheKey].length){ // not changed
							//console.log('Valid, list content unchanged at ' + path + ' ('+ content.length +')', cacheTimeKey, now)
							download.destroy()
							global.rstorage.set(cacheTimeKey, now, 30 * (24 * 3600))
							if(!resolved){
								resolved = true
								resolve(caches[cacheKey])
							}
						}
					})
					download.on('end', content => {
						if(content){
							content = this.extract(String(content))
						}
						if(content && this.validate(content)){
							if(!resolved || callbackAgainOnUpdate){
								resolved = true
								callback(null, content)
							}
							//console.log('Valid list content at ' + path + ' ('+ content.length +')', cacheTimeKey, now)
							global.rstorage.set(cacheKey, content, 30 * (24 * 3600))
							global.rstorage.set(cacheTimeKey, now, 30 * (24 * 3600))
						} else {
							if(!resolved){
								resolved = true
								callback('Invalid list content at ' + path + ' ('+ content.length +')')
							}
						}
					})
				}
			})
		} else {
			fs.readFile(path, (err, content) => {
				if(err){
					callback(err)
				} else {
					content = this.extract(content)
					if(this.validate(content)){
						callback(null, content)
					} else {
						callback('Invalid list content at ' + path + ' ('+ content.length +')')
					}
				}
			})
		}
	}
	extract(content){ // extract inline lists from HTMLs
		if(typeof(content) != 'string'){
			content = String(content)
		}
		let pos = content.indexOf('#')
		if(pos == -1){
			return ''
		} else {
			content = content.substr(pos)
			pos = content.substr(0, 80000).toLowerCase().indexOf('<body') // maybe a html page containing list embedded
			if(pos != -1){
				content = content.substr(pos)
				var e = (new RegExp('#(EXTM3U|EXTINF).*', 'mis')).exec(content)
				if(e && e.index){
					content = content.substr(e.index)
					content = content.replace(new RegExp('<[ /]*br[ /]*>', 'gi'), "\r\n")
					e = (new RegExp('</[A-Za-z]+>')).exec(content)
					if(e && e.index){
						content = content.substr(0, e.index)
					}
				} else {
					content = ''
				}
			}
		}
        return content
	}
	cancel(){
		this.cancelables.forEach(a => {
			a.download.destroy()
			a.onerr('Promise was cancelled')
		})
		this.cancelables = []
	}
}

class EPGDefaultImport extends Common {
	constructor(opts){
		super(opts)
        global.config.on('change', (keys, data) => {
            if(keys.includes('setup-complete') && data['setup-complete']){
                this.importDefault()
            }
        })
    }
    importDefault(){
        if(!global.config.get('epg')){
            cloud.get('configure').then(c => {
                let key = 'default-epg-' + lang.countryCode
                if(c[key] && !global.config.get('epg')){
                    global.config.set('epg', c[key])
                }
            })
        }
    }
}

class Index extends EPGDefaultImport {
	constructor(opts){
		super(opts)
		this.key = 'lists-terms'
		this.data = {urls: {}, terms: {}, groups: {}}
		this.searchRedirects = []
		this.isReady = false
		this.loadData()		
		this.loadSearchRedirects()
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.on('ready', fn)
		}
	}
	loadSearchRedirects(){
		fs.readFile(path.join(__dirname, 'search-redirects.json'), (err, content) => { // redirects to find right channel names, as sometimes they're commonly refered by shorter names on IPTV lists
			if(!err){
				let data = JSON.parse(String(content))
				if(data && typeof(data) == 'object'){
					let results = []
					Object.keys(data).forEach(k => {
						results.push({from: lists.terms(k), to: lists.terms(data[k])})
					})
					this.searchRedirects = results
				}
			}
		})
	}
	applySearchRedirects(terms){
		this.searchRedirects.forEach(redirect => {
			if(redirect.from && redirect.from.length && redirect.from.every(t => terms.includes(t))){
				terms = terms.filter(t => !redirect.from.includes(t)).concat(redirect.to)
			}
		})
		return terms
	}
	applySearchRedirectsOnObject(e){
		if(Array.isArray(e)){
			e = this.applySearchRedirects(e)
		} else if(e.terms) {
			if(typeof(e.terms.name) != 'undefined' && Array.isArray(e.terms.name)){
				e.terms.name = this.applySearchRedirects(e.terms.name)
			} else if(Array.isArray(e.terms)) {
				e.terms = this.applySearchRedirects(e.terms)
			}
		}
		return e
	}
	initListData(listUrl){
		if(typeof(this.data.urls[listUrl]) == 'undefined'){
			let i = 0, vs = Object.values(this.data.urls)
			while(vs.indexOf(i) != -1){
				i++
			}
			this.data.urls[listUrl] = i
		}
		if(typeof(this.data.groups[listUrl]) == 'undefined'){
			this.data.groups[listUrl] = []
		}
		return this.data.urls[listUrl]
	}
	hasListData(listUrl){
		return typeof(this.data.urls[listUrl]) != 'undefined' && typeof(this.data.groups[listUrl]) != 'undefined' && this.data.groups[listUrl].length
	}
	removeListData(listUrl){
		if(typeof(this.data.urls[listUrl]) != 'undefined'){
			let i = this.data.urls[listUrl]
			delete this.data.urls[listUrl]
			Object.keys(this.data.terms).forEach(term => {
				if(typeof(this.data.terms[term][i]) != 'undefined'){
					delete this.data.terms[term][i]
				}
			})
		}
		if(typeof(this.data.groups[listUrl]) != 'undefined'){
			delete this.data.groups[listUrl]
		}
	}
	delimitActiveListsData(activeListsURLs){
		if(!activeListsURLs.includes(this.watchingListId)){
			activeListsURLs.push(this.watchingListId)
		}
		Object.keys(this.data.groups).forEach(url => {
			if(!activeListsURLs.includes(url)){
				this.removeListData(url)
			}
		})
		Object.keys(this.data.terms).forEach(term => { // remove orphan terms
			if(!Object.keys(this.data.terms[term]).length){
				delete this.data.terms[term]
			}
		})
		this.saveData(() => {})
	}
	/*
	{
		'http://...': 123
	}
	{
	band: {
		'123': { // listId
			name: [0, 4, 7], // array of channel index on lists
			group: [0, 4, 7]
		}
	}
	*/
	addTerms(e, i, listUrl){
		let terms = e.terms.name, groupKeywords = e.terms.group, listId = this.initListData(listUrl)
		terms.concat(groupKeywords).forEach(term => { // prepare creating empty groups
			if(typeof(this.data.terms[term]) == 'undefined'){
				this.data.terms[term] = {}
			}
			if(typeof(this.data.terms[term][listId]) == 'undefined'){
				this.data.terms[term][listId] = {n:[],g:[]}
			}
		})
		terms.forEach(term => {
			if(this.data.terms[term][listId]['n'].indexOf(i) == -1){
				this.data.terms[term][listId]['n'].push(i)
			}
		})
		groupKeywords.forEach(term => {
			if(this.data.terms[term][listId]['g'].indexOf(i) == -1){
				this.data.terms[term][listId]['g'].push(i)
			}
		})
		e.groups.forEach(group => {
			if(!this.data.groups[listUrl].includes(group)){
				this.data.groups[listUrl].push(group)
			}
		})
	}
	loadData(){
		global.storage.get(this.key, data => {
			if(data){
				this.data = data
			}
			this.isReady = true
			this.emit('ready')
		})
	}
	saveData(cb){
		const uid = parseInt(Math.random() * 10000)
		global.storage.set(this.key, this.data, true, () => {
			// console.log('LSTS SAVEDATA OK', uid)
		})
	}
}

class Lists extends Index {
    constructor(opts){
		super(opts)
		if(typeof(global.lists) == 'undefined'){
			global.lists = this
		}
		this._epg = false
        this.debug = false
        this.lists = {}
        this.myUrls = []
        this.sharingUrls = []
        this.fetcher = new Fetcher()
		this.ready(this.loadWatchingList.bind(this))
	}
	loadEPG(url){
		return new Promise((resolve, reject) => {
			if(this._epg){
				if(this._epg.url == url){
					console.log('EPG FORCE UPDATE')
					this._epg.forceUpdate()
					return resolve(true)
				} else {
					this._epg.destroy()
				}
			}
			this._epg = new EPG(url)
			this._epg.once('load', resolve)
			this._epg.once('error', reject)
		})
	}
	epg(channelsList, limit){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			let data
			if(this._epg.state == 'loaded' || Object.values(this._epg.data) >= 200){ // loaded enough
				if(Array.isArray(channelsList)){
					channelsList = channelsList.map(c => this.applySearchRedirectsOnObject(c))
					data = this._epg.getMulti(channelsList, limit)
				} else {
					channelsList = this.applySearchRedirectsOnObject(channelsList)
					data = this._epg.get(channelsList, limit)
				}
			} else {
				data = [this._epg.state]
				if(this._epg.state == 'error'){
					data.push(this._epg.error)
				} else if(this._epg.request){
					data.push(this._epg.request.progress)
				}
			}
			resolve(data)
		})		
	}
	epgSearch(terms, nowLive){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			return this._epg.search(this.applySearchRedirects(terms), nowLive).then(resolve).catch(reject)
		})		
	}
	epgFindChannelLog(terms){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			return this._epg.findChannelLog(this.applySearchRedirects(terms)).then(resolve).catch(reject)
		})		
	}
	epgData(){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			resolve(this._epg.data)
		})		
	}
	epgChannelsList(){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			let data = this._epg.channelsList()
			if(data && Object.keys(data).length){
				resolve(data)
			} else {
				reject('failed')
			}
		})		
	}
	epgChannelsTermsList(){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			let data = this._epg.terms
			if(data && Object.keys(data).length){
				resolve(data)
			} else {
				reject('failed')
			}
		})		
	}
	loadWatchingList(){
		this.initListData(this.watchingListId)
		this.lists[this.watchingListId] = new WatchingList(this.watchingListId, this)
		this.lists[this.watchingListId].load()
	}
	unloadAllLists(){ // except watchingList
		Object.keys(this.lists).forEach(name => {
			if(name != this.watchingListId){
				this.lists[name].destroy()
				delete this.lists[name]
			}
		})
	}
	orderByCacheAvailability(urls, cb){
		let uncachedUrls = []
		//console.log('orderByCacheAvailability', urls.join("\r\n"))
		async.eachOfLimit(urls, 8, (url, i, done) => {
			let fine = true, keys = [FETCHER_CACHE_KEY_MASK, FETCHER_CACHE_TIME_KEY_MASK, LIST_HASH_KEY_MASK, LIST_DATA_KEY_MASK]
			async.eachOf(keys.map(s => s.format(url)), (key, i, adone) => {
				if(fine){
					global.rstorage.has(key, has => {
						//console.log('orderByCacheAvailability', url, key, has, fine)
						if(!has){
							fine = false
						}
						adone()
					})
				} else {
					adone()	
				}
			}, () => {
				if(!fine){
					uncachedUrls.push(url)
				}
				done()
			})
		}, () => {
			urls = urls.filter(u => !uncachedUrls.includes(u)).concat(uncachedUrls)
			//console.log('orderByCacheAvailability', urls.join("\r\n"))
			cb(urls)
		})
	}
	setLists(myUrls, altUrls, sharingListsLimit){
		return new Promise((resolve, reject) => {
			this.ready(() => {
				if(this.debug){
					console.log('Adding lists...', myUrls, altUrls, sharingListsLimit)
				}
				this.unloadAllLists()
				this.myUrls = myUrls
				this.sharedUrls = []
				this.orderByCacheAvailability(altUrls, altUrls => {
					async.parallel([
						cb => {
							async.eachOf(this.myUrls, (url, i, acb) => {
								this.fetcher.fetch(url, false, true, (err, content) => {
									if(err){
										console.error('Adding list error', err)
										if(acb){
											acb()
											acb = null
										}
									} else {
										if(typeof(this.lists[url]) == 'undefined'){
											if(this.debug){
												console.log('Adding list...', url, content.length)
											}
											this.initListData(url)
											this.lists[url] = new List(url, this)
										} else {
											if(this.debug){
												console.log('Updating list...', url, content.length)
											}
										}
										this.lists[url].load(content).finally(() => {
											if(this.debug){
												console.log('List added.', url, global.kbfmt(content.length))
											}
											content = null
											if(acb){
												acb()
												acb = null
											}
										})
									}
								})
							}, cb)
						},
						cb => {
							let amount = 0
							if(sharingListsLimit){
								if(this.debug){
									console.log('Adding alternate lists... (' + sharingListsLimit + '/' + altUrls.length + ')')
								}
								async.eachOfLimit(altUrls, Math.min(8, sharingListsLimit * 2), (url, i, acb) => {
									if(amount >= sharingListsLimit){
										if(acb){
											acb()
											acb = null
										}
										return
									}
									if(this.debug){
										console.log('Requesting alternate list... '+ url)
									}
									this.fetcher.fetch(url, true, true, (err, content) => {
										if(err){
											if(String(err).indexOf('Promise was cancelled') == -1){
												console.error('Adding alternate list error', err)
											}
											if(acb){
												acb()
												acb = null
											}
										} else {
											if(typeof(this.lists[url]) == 'undefined'){
												amount++
												if(this.debug){
													console.log('Received alternate list ('+sharingListsLimit+'/'+amount+') '+ content.length, url, content.length)
												}
												if(amount == sharingListsLimit){
													this.fetcher.cancel()
													if(this.debug){
														console.log('Quota reached', url, amount, sharingListsLimit)
													}
												} else if(amount > sharingListsLimit) {
													if(this.debug){
														console.log('Quota exceeded', url, amount, sharingListsLimit)
													}
													content = null
													if(acb){
														acb()
														acb = null
													}
													return
												}
												if(this.debug){
													console.log('Adding alternate list...', url, content.length)
												}
												this.sharedUrls.push(url)
												this.initListData(url)
												if(typeof(this.lists[url]) == 'undefined'){
													this.lists[url] = new List(url, this)
												}
											} else {
												if(this.debug){
													console.log('Updating alternate list...', url, content.length)
												}
											}
											this.lists[url].load(content).finally(() => {
												if(acb){
													if(this.debug){
														console.log('Shared list added.', url, global.kbfmt(content.length))
													}
													content = null
													if(acb){
														acb()
														acb = null
													}
												}
											})
										}
									})
								}, cb)
							} else {
								cb()
							}
						}
					], () => {
						if(this.debug){
							console.log('Removing deprecated lists', Object.keys(this.lists), this.myUrls, this.sharedUrls)
						}
						this.delimitActiveListsData(this.myUrls.concat(this.sharedUrls))
						this.getLists().then(resolve).catch(reject)
					})
				})
			})
		})
    }	
    getLists(){
        return new Promise((resolve, reject) => {
            resolve({
                my: this.myUrls,
                shared: this.sharedUrls,
                length: this.myUrls.length + this.sharedUrls.length
            })
        })
    }	
    getList(url){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[url]) == 'undefined'){
                reject('list not loaded')
            } else {
                let es = this.lists[url].fetchAll()
                resolve(es)
            }
        })
    }
	remove(u){
		if(typeof(this.lists[u]) != 'undefined'){
			this.lists[u].remove()
			delete this.lists[u]
		}
		this.removeListData(u)
		console.log('Removed list', u)
	}
	/*
	{
		'http://...': 123
	}
	{
	band: {
		'123': {
			n: [0, 4, 7],
			g: [0, 4, 7]
		}
	}
	*/
	has(terms, opts){
		return new Promise((resolve, reject) => {	
			let ret = {}, map = {}
			// console.log('has()', terms, opts)
			if(!terms.length){
                return resolve({})
            }
            terms.map(t => {
                ret[t] = this.applySearchRedirects(this.terms(t))
			})
			if(!opts){
				opts = {}
			}
            Object.keys(ret).forEach(k => {
				let ssmap
                ret[k].some((term, i) => {
                    if(typeof(this.data.terms[term]) == 'undefined'){
                        ret[k] = false
                        return true
                    } else {
						if(ssmap){
							ssmap = this.intersectMap(this.data.terms[term], ssmap)
						} else {
							ssmap = global.deepClone(this.data.terms[term])
						}
                    }
				})
				if(ret[k] != false){
					if(ssmap){
						ret[k] = this.mapSize(ssmap) || false
					} else {
						ret[k] = false
					}
				}
            })
            resolve(ret)
        })
	}
	search(terms, opts){	
		return new Promise((resolve, reject) => {
            if(this.debug){
                console.warn('M3U SEARCH', terms, opts)
            }
            let xmap, smap, aliases = {}, bestResults = [], results = [], maybe = [], excludeTerms = []
            if(!terms){
                return resolve({results, maybe})
            }
            if(typeof(opts.type) != 'string'){
                opts.type = false
            }
            if(!Array.isArray(terms)){
                terms = this.terms(terms, true)
			}
			terms = this.applySearchRedirects(terms)
            if(opts.partial){
				let allTerms = Object.keys(this.data.terms)
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
                    let xterm = term.substr(1)
                    if(typeof(this.data.terms[xterm]) != 'undefined'){
						let xtms = global.deepClone(this.data.terms[xterm])
                        if(xmap){
							xmap = this.joinMap(xmap, xtms)
                        } else {
                            xmap = xtms
						}
					}
					excludeTerms.push(term)
                } else {
					let tmap, tms = [term]
					if(typeof(aliases[term]) != 'undefined'){
						tms = tms.concat(aliases[term])
					}
					tms.forEach(term => {
						if(typeof(this.data.terms[term]) != 'undefined'){
							let ttms = global.deepClone(this.data.terms[term])
							if(tmap){
								tmap = this.joinMap(tmap, ttms)
							} else {
								tmap = ttms
							}
						}
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
				}
			})
			if(excludeTerms.length){
				terms = terms.filter(t => !excludeTerms.includes(t)) // remove excludes from terms
				excludeTerms = excludeTerms.map(t => t.substr(1))
				terms = terms.filter(t => !excludeTerms.includes(t)) // now remove excluded terms
			}
            if(smap){
                let results = []
                if(xmap){
					smap = this.diffMap(smap, xmap)
				}
				const ks = Object.keys(smap)
				ks.forEach(listId => {
					smap[listId] = smap[listId]['n']
					if(opts.group){
						smap[listId] = smap[listId].concat(smap[listId]['g'])
					}
				})
                async.eachOf(ks, (listId, i, icb) => {
                    let listUrl = Object.keys(this.data.urls).filter(u => this.data.urls[u] == listId).shift()
                    if(listUrl){
                        if(typeof(this.lists[listUrl]) != 'undefined'){
                            return this.lists[listUrl].iterate(e => {
								if(opts.type){
                                    if(this.validateType(e, opts.type, opts.typeStrict === true)){
                                        if(opts.typeStrict === true) {
                                            e.listUrl = listUrl
                                            bestResults.push(e)
                                        } else {
                                            e.listUrl = listUrl
                                            results.push(e)
                                        }
                                    }
								} else {
									bestResults.push(e)
								}
                            }, () => {
                                // console.log('iterate cb', listUrl)
                                icb()
                            }, smap[listId])
                        }
                    }
                    icb()
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
					xmap = smap = bestResults = results = maybe = null
                })
            } else {
                resolve({results:[], maybe: []})
            }
        })
	}
	unoptimizedSearch(terms, opts){	// for debugging reasons
		return new Promise((resolve, reject) => {
            if(this.debug){
                console.warn('M3U SEARCH', terms, opts)
            }
            let xmap, smap, aliases = {}, bestResults = [], results = [], maybe = [], excludeTerms = []
            if(!terms){
                return resolve({results, maybe})
            }
            if(typeof(opts.type) != 'string'){
                opts.type = false
            }
            if(!Array.isArray(terms)){
                terms = this.terms(terms, true)
			}
            if(opts.partial){ // like glob to globo
				let allTerms = Object.keys(this.data.terms)
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
					let hits = 0
                    if(listUrl){
						return this.lists[listUrl].iterate(e => {
							if(!e.terms.name.some(t => excludeTerms.includes(t))){
								if(this.match(terms, e.terms.name, true)){
									if(opts.type){
										if(this.validateType(e, opts.type, opts.typeStrict === true)){
											if(opts.typeStrict === true) {
												e.listUrl = listUrl
												bestResults.push(e)
												hits++
											} else {
												e.listUrl = listUrl
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
						}, () => {
							acb()
						})
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
		Object.keys(b).forEach(listId => {
			if(typeof(a[listId]) != 'undefined'){
				c[listId] = {
					g: a[listId].g ? a[listId].g.filter(n => b[listId].g.includes(n)).sort() : [], 
					n: a[listId].n ? a[listId].n.filter(n => b[listId].n.includes(n)).sort() : []
				}
			}
		})
		return c
	}
	mapSize(a, group){
		let c = 0
		Object.keys(a).forEach(listId => {
			c += a[listId].n.length
			if(group){
				c += a[listId].g.length
			}
		})
		return c
	}
	joinMap(a, b){
		let c = global.deepClone(a) // clone it
		Object.keys(b).forEach(listId => {
			if(typeof(c[listId]) == 'undefined'){
				c[listId] = {g: [], n: []}
			}
			Object.keys(b[listId]).forEach(type => {
				let changed
				b[listId][type].forEach(n => {
					if(!c[listId][type].includes(n)){
						c[listId][type].push(n)
						if(!changed){
							changed = true
						}
					}
				})
				if(changed){
					c[listId][type].sort()
				}
			})
		})
		return c
	}
	diffMap(a, b){
		let c = global.deepClone(a) // clone it
		Object.keys(b).forEach(listId => {
			if(typeof(c[listId]) != 'undefined'){
				Object.keys(b[listId]).forEach(type => {
					if(typeof(c[listId][type]) != 'undefined'){
						b[listId][type].forEach(n => {
							let i = c[listId][type].indexOf(n)
							if(i != -1){
								c[listId][type].splice(i, 1)
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
			async.eachOf(Object.keys(this.lists), (listUrl, i, _icb) => {
				let groups = this.data.groups[listUrl] || []
				let icb = () => {
					// console.log(listUrl, i, 'done')
					_icb()
				}
				if(groups.indexOf(group) != -1){
					this.lists[listUrl].iterate(e => {
						if(e.groups && e.groups.indexOf(group) != -1){
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
						// console.log(groups, i)
					}, icb)
				} else {
					icb()
				}
			}, () => {
				//console.log(entries)
				entries = this.tools.dedup(entries)
				entries = this.parentalControl.filter(entries)
				resolve(entries)
			})
		})
	}
    fetchList(url){
        return new Promise((resolve, reject) => {
			this.fetcher.fetch(url, false, false, (err, content) => {
				if(err){
					reject(err)
				} else {
					resolve(content)
				}
			})
        })
    }
    directListRenderer(v){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[v.url]) != 'undefined'){
                let entries = this.lists[v.url].fetchAll()
                this.directListRendererPrepare(entries, v.url).then(resolve).catch(reject)
            } else {
                this.fetcher.fetch(v.url, false, false, (err, content) => {
					if(err){
						reject(err)
					} else {
						this.directListRendererParse(content, v.url).then(resolve).catch(reject)
					}
                })
            }
        })
    }
    directListRendererParse(content, url){
        return new Promise((resolve, reject) => {
            let flatList = this.parser.parse(content)
            this.directListRendererPrepare(flatList, url).then(resolve).catch(reject)
        })
    }
    directListRendererPrepare(list, url){
        return new Promise((resolve, reject) => {
			let next = es => {
				if(es && es.length){
					resolve(es)
				} else {
					resolve([])
				}
			}
            if(list.length){
                list = this.parentalControl.filter(list)
                list = this.tools.dedup(list)
                list = this.prepareEntries(list)
				list = this.tools.deepify(list)
				this.tools.offload(list, url, next)
            } else {
                next()
            }
        })
    }
    allListsMerged(){
        return new Promise((resolve, reject) => {
			const key = 'all-lists-merged', next = es => {
				console.warn('POS Memory usage: ' + global.kbfmt(process.memoryUsage().rss), es.length)
				if(es && es.length){
					resolve(es)
				} else {
					resolve([])
				}
			}
			console.warn('PRE Memory usage: ' + global.kbfmt(process.memoryUsage().rss))
			global.tstorage.get(key, list => {
				if(Array.isArray(list) && list.length){ // already generated
					next(list)
				} else {
					list = [].concat.apply([], Object.values(this.lists).map(l => l.url == this.watchingListId ? [] : l.fetchAll()))
					if(list.length){
						list = this.parentalControl.filter(list)
						list = this.tools.dedup(list)
						list = this.prepareEntries(list)
						list = this.tools.deepify(list)
						this.tools.offload(list, key, list => {
							global.tstorage.set(key, list, 600)
							next(list)
						})
					} else {
						next()
					}
				}
			})
        })
    }
    groups(){
        return new Promise((resolve, reject) => {
            let gs = [...new Set([].concat.apply([], Object.keys(this.data.groups).map(k => this.data.groups[k].filter(s => s))))]
            gs = [...new Set(gs.filter(s => s && s.length >= 2).sort())]
            gs = this.parentalControl.filter(gs)
            resolve(gs)
        })
    }
    getData(){
        return new Promise((resolve, reject) => {
            resolve(this.data)
        })
    }
}

module.exports = Lists
