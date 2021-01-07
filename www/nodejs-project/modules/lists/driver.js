
const async = require('async'), path = require('path'), Events = require('events'), fs = require('fs'), crypto = require('crypto')
const readline = require('readline'), Parser = require('./parser'), LegalIPTV = require('../legal-iptv')

const ConnRacing = require(global.APPDIR + '/modules/conn-racing')
const Common = require(global.APPDIR + '/modules/lists/common.js')
const EPG = require(global.APPDIR + '/modules/lists/epg.js')

const Storage = require(APPDIR + '/modules/storage')
const Cloud = require(APPDIR + '/modules/cloud')
const Mega = require(APPDIR + '/modules/mega')

require(APPDIR + '/modules/supercharge')(global)

const LIST_DATA_KEY_MASK = 'list-data-{0}'
const LIST_META_KEY_MASK = 'list-meta-{0}'
const LIST_UPDATE_FROM_KEY_MASK = 'list-time-{0}'

storage = new Storage()  
tstorage = new Storage('', {temp: true, clear: false, cleanup: false})  
rstorage = new Storage() 
rstorage.useJSON = false

Download = require(APPDIR + '/modules/download')
cloud = new Cloud()
mega = new Mega()

class List extends Events {
	constructor(url, directURL, parent){
		super()
		this.debug = false
		this.meta = {}
		this.parent = parent
		if(url.substr(0, 2) == '//'){
			url = 'http:'+ url
		}
		this.url = url
		this.directURL = directURL || url
		this.data = []
		this.indexateIterator = 0
		this.dataKey = LIST_DATA_KEY_MASK.format(url)
		this.metaDataKey = LIST_META_KEY_MASK.format(url)
		this.updateAfterKey = LIST_UPDATE_FROM_KEY_MASK.format(url)
        this.constants = {
			BREAK: -1
		}
		this._log = [
			this.url
		]
		this.loaded = false
		this.on('destroy', () => {
			if(this.stream){
				this.stream.destroy()
				this.stream = null
			}
			if(this.rl){
				this.rl.close()
				this.rl = null
			}
			if(this.parser){
				this.parser.destroy()
			}
		})
	}	
	start(){
		this.loadCache()
	}
	clear(){
		this.parent.removeListData(this.url)
		if(this.destroyed) return
		this.data = []
		this.indexateIterator = 0
	}
	log(...args){
		if(this.destroyed) return
		args.unshift((new Date()).getTime() / 1000)
		this._log.push(args)
	}
	termify(t){ // any str to terms list joined by space
		if(Array.isArray(t)){
			return t.map(s => this.termify(s))
		}
		return this.parent.terms(t).join(' ')
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.on('ready', fn)
		}
	}
	loadCache(){
		const file = global.rstorage.resolve(this.dataKey)
		fs.stat(file, (err, stat) => {
			if(this.debug){
				console.log('loadCache', this.url, stat)
			}
			if(stat && stat.size){
				global.storage.get(this.metaDataKey, meta => {
					if(meta){
						this.meta = Object.assign(meta, this.meta)
						this.emit('meta', this.meta)
					}
				})
				this.rl = readline.createInterface({
					input: fs.createReadStream(file),
					crlfDelay: Infinity
				})
				let initialized
				this.rl.on('line', (line) => {
					if(!this.destroyed){
						if(line.length > 8){
							if(!initialized){
								initialized = true
								this.clear()
							}
							this.data.push(line)
							let entry = JSON.parse(line)
							this.indexateEntry(entry)
						}
					}
				})
				this.rl.on('close', () => {
					if(initialized){
						if(!this.loaded){
							this.validateListQuality().then(() => {
								this.loaded = true
								this.emit('load')
							}).catch(err => {
								if(this.debug){
									console.log('validateListQuality failed on loadCache()', this.url, err)
								}
								this.load().catch(console.error)
							})
						}
					}
					this.isReady = true
					this.emit('ready')
					this.rl.close()
					this.rl = null
				})
			} else {
				this.isReady = true
				this.emit('ready')
				this.load().catch(console.error)
			}
		})
	}
	shouldUpdate(cb){
		if(!this.data.length){
			cb(true)
		} else {
			global.storage.get(this.updateAfterKey, updateAfter => {
				let now = global.time()
				cb(!updateAfter || now >= updateAfter)
			})
		}
	}
	load(){
		return new Promise((resolve, reject) => {
			this.ready(() => {
				this.shouldUpdate(should => {
					if(this.debug){
						console.log('load', should)
					}
					if(should){
						let now = global.time()
						global.storage.set(this.updateAfterKey, now + 180, true) // initial updating lock
						let path = this.directURL
						if(path.substr(0, 2)=='//'){
							path = 'http:' + path
						}
						if(path.match('^https?:')){
							const opts = {
								url: path,
								retries: 1,
								followRedirect: true,
								keepalive: false,
								headers: {
									'accept-charset': 'utf-8, *;q=0.1'
								},
								downloadLimit: 20 * (1024 * 1024) // 20Mb
							}
							this.stream = new global.Download(opts)
							this.stream.on('response', (statusCode, headers) => {
								now = global.time()
								if(statusCode >= 200 && statusCode < 300){
									global.storage.set(this.updateAfterKey, now + (12 * 3600), true)
									this.parseStream().then(resolve).catch(reject)
								} else {
									global.storage.set(this.updateAfterKey, now + 180, true)
									if(!this.loaded) {
										this.emit('failure', 'http error '+ statusCode)
									}
									if(this.stream){
										this.stream.destroy()
										this.stream = null
									}
									reject('http error '+ statusCode)
								}
							})
						} else {
							fs.stat(file, (err, stat) => {
								if(stat && stat.size){
									this.stream = fs.createReadStream(file)
									this.parseStream().then(resolve).catch(reject)
								} else {
									reject('file not found or empty')
								}
							})
						}
					} else {
						if(this.loaded) {
							resolve(true)
						} else {
							let msg = 'already updated, bad content'
							this.emit('failure', msg)
							reject(msg)
						}
					}
				})
			})
		})
	}
	validateListQuality(){
		return new Promise((resolve, reject) => {
			if(this.skipValidating){
				return resolve(true)
			}
			let tests = 4, hits = 0, dls = [], entries = [], results = [], len = this.data.length, mtp = Math.floor((len - 1) / (tests - 1))
			if(len < tests){
				return reject('insufficient streams')
			}
			for(let i = 0; i < len; i += mtp){
				try {
					let e = JSON.parse(this.data[i])
					entries.push(e)
				} catch(err) {
					console.error(err, this.data[i])
				}
			}
			if(this.debug){
				console.log('validateListQuality', this.url, tests, mtp, entries)
			}
			const racing = new ConnRacing(entries.map(e => e.url)), next = () => {
				if(racing.ended){
					if(this.debug){
						console.log('validateListQuality FAIL', this.url, results)
					}
					reject('list streams doesn\'t connect')
				} else {
					racing.next(res => {
						results.push(res)
						if(res && res.valid){
							if(this.debug){
								console.log('validateListQuality SUCCESS', this.url)
							}
							resolve(true)
							racing.end()
						} else {
							next()
						}
					})
				}
			}
			next()
		})
	}
	parseStream(stream){	
		return new Promise((resolve, reject) => {
			if(stream && this.stream != stream){
				this.stream = stream
			}
			this.log('parsing...')
			let initialized, s = time(), i = 0, entries = []
			this.parser = new Parser(this.stream)
			this.parser.on('meta', meta => {
				if(this.destroyed || !Object.keys(meta).length){
					return	
				}
				this.meta = Object.assign(this.meta, meta)
				this.emit('meta', this.meta)
				global.storage.set(this.metaDataKey, this.meta, true)
			})
			this.parser.on('entry', entry => {
				if(this.destroyed){
					return	
				}
				if(!initialized){
					initialized = true
					this.clear()
				}
				entry = this.indexateEntry(entry)
				this.data.push(JSON.stringify(entry))
			})
			this.parser.on('end', () => {
				if(initialized){
					if(!this.loaded){
						this.validateListQuality().then(() => {
							this.loaded = true
							this.emit('load')
						}).catch(err => {
							if(this.debug){
								console.log('validateListQuality failed', this.url, err)
							}
							this.emit('failure', err, this.stream)
							this.destroy()
						})
					}
					global.rstorage.set(this.dataKey, this.data.join("\r\n"), true)
				} else if(!this.loaded) {
					this.emit('failure', 'no entries found', this.stream)
					if(!this.skipValidating){
						this.destroy()
					}
				}
				if(this.stream){
					this.stream.destroy()
					this.stream = null
				}
				this.log('parsed in ' + Math.round(time() - s, 2) + 's')
				resolve(true)
				if(this.parser){
					this.parser.destroy()
					delete this.parser
				}
			})
		})
	}
	indexateEntry(entry){
		if(this.destroyed) return
		entry = this.parent.prepareEntry(entry)
		if(!entry.source){
			entry.source = this.url
		}
		this.parent.addTerms(entry, this.indexateIterator, this.url)
		this.indexateIterator++
		return entry
	}
	iterate(fn, map){
		if(!Array.isArray(map)){
			map = false
		}
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
	}
	some(fn, cb){
		let some = false
		this.iterate(e => {
			if(fn(e)){
				some = true
				return this.constants.BREAK
			}
		})
		return some
	}
	fetchAll(){
		let entries
		try {
			entries = JSON.parse('['+ this.data.join(',') +']')
		} catch(e) {
			console.error('JSON PARSE ERR', '['+ buf.join(',') +']', e)
			entries = []
		}
		return entries
	}
	remove(){
		[this.dataKey].forEach(k => {
			global.rstorage.delete(k)
		})
	}
	destroy(){
		if(!this.destroyed){
			if(this.parser){
				this.parser.destroy()
			}
			if(this.rl){
				this.rl.close()
			}
			this.clear()
			this.destroyed = true
			this.data = []
			this.emit('destroy')
			delete this.parent
			delete this._log
		}
	}
}

class WatchingList extends List {
	constructor(url, directURL, parent){
		super(url, directURL, parent)
		this.skipValidating = true
	}
	load(){
		return new Promise((resolve, reject) => {
			this.ready(() => {
				this.shouldUpdate(should => {
					if(should){
						global.cloud.get('watching', true).then(content => {
							let now = global.time()
							global.storage.set(this.updateAfterKey, now + 180, true)
							this.clear()
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
							entries = entries.map(e => this.indexateEntry(e))
							this.log('parsed in ' + Math.round(time() - s, 2) + 's, now saving...', entries)
							this.data = entries.map(JSON.stringify)
							this.loaded = true
							resolve(true)
							global.rstorage.set(this.dataKey, this.data.join("\n"), true, () => {
								this.log('updated and saved')
							})
						}).catch(err => {
							console.error(err)
							if(this.loaded){
								resolve(true)
							} else {
								reject('cloud get err '+ String(err))
							}
						})
					} else {
						if(this.loaded){
							resolve(true)
						} else {
							reject('already updated, bad content')
						}
					}
				})
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
	fetch(path){
		return new Promise((resolve, reject) => {
			if(path.substr(0, 2)=='//'){
				path = 'http:' + path
			}
			if(path.match('^https?:')){
				const dataKey = LIST_DATA_KEY_MASK.format(path)
				global.rstorage.get(dataKey, data => {
					if(this.validate(data)){
						resolve(data.split("\n").filter(s => s.length > 8).map(JSON.stringify))
					} else {
						const opts = {
							url: path,
							keepalive: false,
							retries: 1,
							followRedirect: true,
							headers: {
								'accept-charset': 'utf-8, *;q=0.1'
							},
							downloadLimit: 20 * (1024 * 1024) // 20Mb
						}
						let entries = [], stream = new global.Download(opts)
						stream.on('response', (statusCode, headers) => {
							if(statusCode >= 200 && statusCode < 300){
								let parser = new Parser(stream)
								parser.on('entry', entry => {
									entries.push(entry)
								})
								parser.on('end', () => {
									stream.destroy()
									stream = null
									if(entries.length){
										global.rstorage.set(dataKey, entries.map(JSON.stringify).join("\r\n"), true)
										resolve(entries)
									} else {
										reject('invvalid list')
									}
									parser.destroy()
								})
							} else {
								stream.destroy()
								stream = null
								reject('http error '+ statusCode)
							}
						})
					}
				})
			} else {
				reject('bad URL')
			}
		})
	}
	/*
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
	*/
}

class EPGDefaultImport extends Common {
	constructor(opts){
		super(opts)
		this.enabled = false  // auto-epg-import disabled while we improve it
		if(this.enabled){
			global.config.on('change', (keys, data) => {
				if(keys.includes('setup-complete') && data['setup-complete']){
					this.importDefault()
				}
			})
		}
    }
    importDefault(){
		if(this.enabled){
			if(!global.config.get('epg') && !global.cordova){
				cloud.get('configure').then(c => {
					let key = 'default-epg-' + lang.countryCode
					if(c[key] && !global.config.get('epg')){
						global.config.set('epg', c[key])
					}
				})
			}
		}
    }
}

class Index extends EPGDefaultImport {
	constructor(opts){
		super(opts)
		this.key = 'lists-terms'
		this.epgs = []
		this.data = {urls: {}, terms: {}, groups: {}}
		this.isReady = false
		this.loadData()		
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.on('ready', fn)
		}
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
		Object.keys(this.lists).forEach(url => {
			if(!activeListsURLs.includes(url)){
				this.lists[url].destroy()
				delete this.lists[url]
			}
		})
		this.saveData()
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
	saveData(){
		global.storage.set(this.key, this.data, true)
	}
}

class Lists extends Index {
    constructor(opts){
		super(opts)
		this.setMaxListeners(99)
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
	isListCached(url, cb){
		let dataKey = LIST_DATA_KEY_MASK.format(url)
		let file = global.rstorage.resolve(dataKey)
		fs.stat(file, (err, stat) => {
			cb((stat && stat.size >= 1024))
		})
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
	epgSearchChannel(terms){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg')
			}
			resolve(this._epg.searchChannel(this.applySearchRedirects(terms)))
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
	renameList(url, name){
		let lists = global.config.get('sources')
		for(let i in lists){
			if(lists[i][1] == url){
				if(lists[i][0] != name){
					lists[i][0] = name
					global.config.set('lists', lists)
					break
				}
			}
		}
	}
	loadWatchingList(){
		this.initListData(this.watchingListId)
		this.lists[this.watchingListId] = new WatchingList(this.watchingListId, null, this)
		this.lists[this.watchingListId].start()
	}
	prepareSetLists(myUrls, altUrls, sharingListsLimit){
		this.listsUpdateData = {myUrls, altUrls, sharingListsLimit}
		let fineUrls = myUrls.concat(altUrls).filter(u => {
			return typeof(this.lists[u]) != 'undefined'
		}).slice(0, sharingListsLimit)
		Object.keys(this.lists).forEach(u => {
			if(u != this.watchingListId && !fineUrls.includes(u)){
				this.lists[u].destroy()
				delete this.lists[u]
			}
		})
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
		//console.log('orderByCacheAvailability', urls.join("\r\n"))
		let loadedUrls = [], cachedUrls = []
		urls = urls.filter(u => {
			if(typeof(this.lists[u]) == 'undefined'){
				return true
			}
			loadedUrls.push(u)
		})
		async.eachOfLimit(urls, 8, (url, i, done) => {
			let fine, key = LIST_DATA_KEY_MASK.format(url)
			global.rstorage.has(key, has => {
				//console.log('orderByCacheAvailability', url, key, has, fine)
				if(has){
					cachedUrls.push(url)
				}
				done()
			})
		}, () => {
			this.listsUpdateData.firstRun = !(loadedUrls.length + cachedUrls.length)
			let uncachedUrls = urls.filter(u => { return !loadedUrls.includes(u) && !cachedUrls.includes(u)})
			//console.log('orderByCacheAvailability', urls.join("\r\n"))
			cb(loadedUrls.concat(cachedUrls).concat(uncachedUrls), cachedUrls.length + loadedUrls)
		})
	}
	listsUpdateProgress(){
		return new Promise((resolve, reject) => {
			let progress = 0, firstRun = true
			if(this.listsUpdateData){
				firstRun = this.listsUpdateData.firstRun
				let limit = this.listsUpdateData.sharingListsLimit
				let val = (100 / limit) / 100
				Object.keys(this.lists).forEach(url => {
					if(url == lists.watchingListId) return
					let p = 0
					if(this.lists[url].loaded){
						p = 100
					} else if(this.lists[url].stream){
						p = this.lists[url].stream.progress || 0
					}
					progress += (p * val)
				})
			}
			resolve({progress: Math.min(parseInt(progress), 99), firstRun, done: this.listsUpdateData.done})
		})
	}
	setLists(myUrls, altUrls, sharingListsLimit){ // prevent config.sync errors reeiving sharingListsLimit as parameter, instead of access a not yet updated the config.
		return new Promise((resolve, reject) => {
			this.ready(() => {
				if(this.debug){
					console.log('Adding lists...', myUrls, altUrls, sharingListsLimit)
				}
				this.prepareSetLists(myUrls, altUrls, sharingListsLimit)
				this.myUrls = myUrls
				altUrls = altUrls.filter(u => !myUrls.includes(u))
				this.sharedUrls = Object.keys(this.lists).filter(u => {
					return u != this.watchingListId && !myUrls.includes(u)
				})
				let amount = myUrls.concat(this.sharedUrls).length
				global.listsRequesting = {}
				this.orderByCacheAvailability(altUrls, (altUrls, hasCache) => {
					async.parallel([
						cb => {
							async.eachOf(this.myUrls, (url, i, acb) => {	
								if(this.debug){
									console.log('Adding my list...', url)
								}
								if(typeof(this.lists[url]) != 'undefined'){
									return acb()
								}
								global.listsRequesting[url] = 'loading'
								this.initListData(url)
								this.lists[url] = new List(url, null, this)
								this.lists[url].skipValidating = true
								this.lists[url].on('meta', meta => {
									if(meta['epg'] && !this.epgs.includes(meta['epg'])){
										this.epgs.push(meta['epg'])
									}
									if(meta['name']){
										this.renameList(url, meta['name'])
									}
								})
								this.lists[url].on('load', () => {
									delete global.listsRequesting[url]
									if(this.debug){
										console.log('Added my list...', url, this.lists[url].data.length)
									}
									if(acb){
										acb()
										acb = null
									}
								})
								this.lists[url].on('failure', err => {
									global.listsRequesting[url] = err
									if(acb){
										acb()
										acb = null
									}
								})
								this.lists[url].on('destroy', () => {
									if(global.listsRequesting[url] == 'loading'){
										global.listsRequesting[url] = 'destroyed'
									}
									if(acb){
										acb()
										acb = null
									}
								})
								this.lists[url].start()
							}, cb)
						},
						cb => {
							if(sharingListsLimit && altUrls.length){
								let legalIPTV = new LegalIPTV({shadow: true})
								legalIPTV.getLocalLists().then(lurls => {
									altUrls = lurls.concat(altUrls)
								}).catch(console.error).finally(() => {
									if(this.debug){
										console.log('Adding shared lists... (' + sharingListsLimit + '/' + amount + ')', altUrls.length)
									}
									let ended
									const process = (directURL, url, pcb) => {
										if(ended || typeof(this.lists[url]) != 'undefined' || amount >= sharingListsLimit){
											if(pcb){
												pcb()
												pcb = null
											}
											return
										}
										if(this.debug){
											console.log('Requesting shared list... '+ url + ' | ' + directURL)
										}						
										global.listsRequesting[url] = 'loading'		
										this.initListData(url)
										this.lists[url] = new List(url, directURL, this)
										this.lists[url].on('load', () => {
											if(!this.lists[url]){
												if(global.listsRequesting[url] == 'loading'){
													global.listsRequesting[url] = 'loaded, but destroyed'
												}
												if(this.debug){
													console.log('List '+ url +' already discarded.')
												}
												end()
												if(pcb){
													pcb()
													pcb = null
												}
											} else if(amount > sharingListsLimit) {
												global.listsRequesting[url] = 'quota exceeded'
												if(this.debug){
													console.log('Quota exceeded', url, amount, sharingListsLimit)
												}
												end()
												if(pcb){
													pcb()
													pcb = null
												}
											} else {
												delete global.listsRequesting[url]
												amount++
												if(this.debug){
													console.log('Added shared list...', url, this.lists[url].data.length, amount, sharingListsLimit)
												}
												this.sharedUrls.push(url)											
												if(this.lists[url].meta['epg'] && !this.epgs.includes(this.lists[url].meta['epg'])){
													this.epgs.push(this.lists[url].meta['epg'])
												}
												if(amount == sharingListsLimit){
													if(this.debug){
														console.log('Quota reached', url, amount, sharingListsLimit)
													}
													this.delimitActiveListsData(this.myUrls.concat(this.sharedUrls)) // callc delimitActiveListsData asap to freeup mem, already calls this.saveData()
													end()
												}	
												if(pcb){
													pcb()
													pcb = null
												}
											}
										})
										this.lists[url].on('failure', err => {
											//console.warn('LOAD LIST FAIL', url, this.lists[url])
											global.listsRequesting[url] = err
											if(pcb){
												pcb()
												pcb = null
											}
											if(this.lists[url]){
												this.lists[url].destroy()
											}
										})
										this.lists[url].on('destroy', () => {
											if(global.listsRequesting[url] == 'loading'){
												global.listsRequesting[url] = ['destroyed', global.traceback()]
											}
											if(this.lists[url]){
												delete this.lists[url]
											}
											if(pcb){
												pcb()
												pcb = null
											}
										})
										this.lists[url].start()
									}
									const end = () => {
										if(!ended){
											ended = true
											racing.end()
											cb()
										}
									}
									const racing = new ConnRacing(altUrls), cbs = Array(altUrls.length).fill(_acb => {
										let acb = () => {
											if(_acb){
												try {
													_acb()
												} catch(e) {}
												_acb = null
											}
										}
										racing.next(res => {
											if(res && res.valid){
												process(res.directURL, res.url, acb)
											} else {
												acb()
												if(amount >= sharingListsLimit){
													racing.end()
												}
											}
										})
									})
									console.log('racing', racing)
									async.parallelLimit(cbs, sharingListsLimit, end)
									altUrls.forEach(url => {
										if(!ended){
											this.isListCached(url, res => {
												if(res){
													process(url, url, () => {})
												}
											})
										}
									})
								})
							} else {
								cb()
							}
						}
					], () => {
						this.listsUpdateData.done = true
						this.getLists().then(data => {
							resolve(data)
							if(this.debug){
								console.log('QQQ Lists loaded', Object.keys(this.lists), this.myUrls, this.sharedUrls)
							}
							async.eachOfLimit(Object.keys(this.lists), 2, (url, i, acb) => {
								if(this.lists[url]){
									if(this.debug){
										console.log('QQQ List updating', url)
									}
									this.lists[url].load().catch(console.error).finally(() => {
										if(this.debug){
											console.log('QQQ List updated OK', url)
										}
										acb()
									}) // now force the list cache update, if it haven't did yet
								} else {
									if(this.debug){
										console.log('QQQ List disappeared?!', url, this.lists)
									}
									acb()
								}
							}, () => {
								if(this.debug){
									console.log('QQQ Lists fully updated', Object.keys(this.lists), this.myUrls, this.sharedUrls)
								}
								this.saveData()
							})
						}).catch(reject)
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
            let start = global.time(), xmap, smap, aliases = {}, bestResults = [], results = [], maybe = [], excludeTerms = [], limit = 1024
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
                    if(typeof(this.data.terms[xterm]) != 'undefined'){
						let xtms = global.deepClone(this.data.terms[xterm])
                        if(xmap){
							xmap = this.joinMap(xmap, xtms)
                        } else {
                            xmap = xtms
						}
					}
					excludeTerms.push(xterm)
					return false
                }
				return true
			})
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
			terms = terms.filter(t => !excludeTerms.includes(t))
            terms.some(term => {
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
			})
            if(smap){
                let results = []
                if(xmap){
					smap = this.diffMap(smap, xmap)
				}
				const ks = Object.keys(smap)
				ks.forEach(listId => {
					let ls = smap[listId]['n']
					if(opts.group){
						console.log('ggroup', smap[listId]['g'])
						ls = ls.concat(smap[listId]['g'])
					}
					smap[listId] = ls
				})
                async.eachOf(ks, (listId, i, icb) => {
                    let listUrl = Object.keys(this.data.urls).filter(u => this.data.urls[u] == listId).shift()
                    if(listUrl && typeof(this.lists[listUrl]) != 'undefined'){
						this.lists[listUrl].iterate(e => {
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
						}, smap[listId])
                    }
                    icb()
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
					console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s (cumulated time)', terms)
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
                    if(listUrl && this.lists[listUrl]){
						this.lists[listUrl].iterate(e => {
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
						})
						acb()
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
					})
				}
				icb()
			}, () => {
				//console.log(entries)
				entries = this.tools.dedup(entries)
				entries = this.parentalControl.filter(entries)
				resolve(entries)
			})
		})
	}
    directListRenderer(v){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[v.url]) != 'undefined'){
                let entries = this.lists[v.url].fetchAll()
                this.directListRendererPrepare(entries, v.url).then(resolve).catch(reject)
            } else {
				this.fetcher.fetch(v.url).then(flatList => {
					this.directListRendererPrepare(flatList, v.url).then(resolve).catch(reject)
				}).catch(reject)
            }
        })
    }
    directListRendererParse(content){
        return new Promise((resolve, reject) => {
			let entries = [], parser = new Parser()
			parser.on('entry', e => entries.push(e))
			parser.on('end', () => {
				resolve(entries)
			})
			parser.write(content)
			parser.end()
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
