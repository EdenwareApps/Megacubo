
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
		if(url.substr(0, 2) == '//'){
			url = 'http:'+ url
		}
		this.url = url
		this.directURL = directURL || url
		this.data = []
		this.groups = []
		this.index = {}
		this.indexateIterator = 0
		this.dataKey = LIST_DATA_KEY_MASK.format(url)
		this.metaDataKey = LIST_META_KEY_MASK.format(url)
		this.updateAfterKey = LIST_UPDATE_FROM_KEY_MASK.format(url)
		this.minListQualityLevel = 60;
        this.constants = {
			BREAK: -1
		}
		this._log = [
			this.url
		]
		this.loaded = false
		this.relevance = 50
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
		this.parent = (() => parent)
	}
	indexate(entry, i){
		entry = this.parent().prepareEntry(entry)
		entry.terms.name.concat(entry.terms.group).forEach(term => {
			if(typeof(this.index[term]) == 'undefined'){
				this.index[term] = {n: [], g: []}
			}
		})
		entry.terms.name.forEach(term => {
			if(!this.index[term].n.includes(i)){
				this.index[term].n.push(i)
			}
		})
		entry.terms.group.forEach(term => {
			if(!this.index[term].g.includes(i)){
				this.index[term].g.push(i)
			}
		})
		entry.groups.forEach(group => {
			if(!this.groups.includes(group)){
				this.groups.push(group)
			}
		})
		return entry
	}
	start(){
		this.loadCache()
	}
	clear(){
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
		return this.parent().terms(t).join(' ')
	}
	ready(fn){
		if(this.isReady){
			fn()
		} else {
			this.once('ready', fn)
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
				this.indexateIterator = 0
				this.rl.on('line', (line) => {
					if(!this.destroyed){
						if(line && line.charAt(0) == '{'){
							if(!initialized){
								initialized = true
								this.clear()
							}
							this.data.push(line)
							let entry = JSON.parse(line)
							this.indexate(entry, this.indexateIterator)
						}
						this.indexateIterator++
					}
				})
				this.rl.on('close', () => {
					if(initialized){
						if(!this.loaded){
							this.validate().then(() => {
								this.loaded = true
								this.emit('load')
							}).catch(err => {
								if(this.debug){
									console.log('validate failed on loadCache()', this.url, err)
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
					if(this.destroyed){
						let msg = 'already destroyed'
						this.emit('failure', msg)
						reject(msg)
					} else if(should) {
						let now = global.time()
						global.storage.set(this.updateAfterKey, now + 180, true) // initial updating lock
						let path = this.directURL
						if(path.substr(0, 2)=='//'){
							path = 'http:' + path
						}
						if(path.match('^https?:')){
							const opts = {
								url: path,
								retries: 5,
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
	progress(){
		let p = 0, f = 0
		if(this.stream){
			p += this.stream.progress || 0
			f++
		} else if(this.data.length) {
			p += 100
			f++
		}
		if(this.validator){
			p += this.validator.progress()
			f++
		}
		return (p / f)
	}
	validate(){
		this.validateListRelevance()
		return this.validateListQuality()
	}
	validateListQuality(){
		return new Promise((resolve, reject) => {
			if(this.skipValidating){
				return resolve(true)
			}
			let tests = 5, hits = 0, entries = [], results = [], len = this.data.length, mtp = Math.floor((len - 1) / (tests - 1))
			if(len < tests){
				return reject('insufficient streams')
			}
			for(let i = 0; i < len; i += mtp){
				try {
					let e = JSON.parse(this.data[i])
					entries.push(e)
				} catch(err) {
					console.error(err, this.url, i, this.data)
				}
			}
			if(this.debug){
				console.log('validating list quality', this.url, tests, mtp, entries)
			}
			const racing = new ConnRacing(entries.map(e => e.url)), end = () => {
				racing.end()
				delete this.validator
				let quality = hits / (entries.length / 100)
				if(this.debug){
					console.log('validated list quality', this.url, quality)
				}
				this.quality = quality
				if(quality >= this.minListQualityLevel){
					resolve(quality)
				} else {
					reject('bad quality list: ' + quality + '%')
				}
			}, next = () => {
				if(racing.ended){
					end()
				} else {
					racing.next(res => {
						results.push(res)
						if(res && res.valid){
							hits++
						}
						next()
					})
				}
			}
			this.validator = racing
			next()
		})
	}
	validateListRelevance(){
		if(this.skipValidating){
			return
		}
		let rks = this.parent().relevantKeywords
		if(!rks || !rks.length){
			console.error('no parent keywords')
			return
		}
		let hits = 0
		rks.forEach(term => {
			if(typeof(this.index[term]) != 'undefined'){
				hits++
			}
		})
		this.relevance = hits / (rks.length / 100)
		rks = null
		return this.relevance
	}
	parseStream(stream){	
		return new Promise((resolve, reject) => {
			if(stream && this.stream != stream){
				this.stream = stream
			}
			this.log('parsing...')
			let initialized, s = time()
			this.indexateIterator = 0
			this.parser = new Parser(this.stream)
			this.parser.on('meta', meta => {
				this.parent().setListMeta(this.url, meta)
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
				entry = this.indexate(entry, this.indexateIterator)
				this.data.push(JSON.stringify(entry))
				this.indexateIterator++
			})
			this.parser.on('end', () => {
				if(initialized){
					if(!this.loaded){
						this.validate().then(() => {
							this.loaded = true
							this.emit('load')
						}).catch(err => {
							if(this.debug){
								console.log('validate failed', this.url, err)
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
			if(this.stream){
				this.stream.destroy()
				this.stream = null
			}
			if(this.validator){
				this.validator.destroy()
				this.validator = null
			}
			this.clear()
			this.destroyed = true
			this.data = []
			this.emit('destroy')
			this.parent = (() => {return {}})
			this._log = []
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
							this.indexateIterator = 0
							entries = entries.map(e => {
								this.indexate(e, this.indexateIterator)								
								this.indexateIterator++
							})
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
							retries: 10,
							followRedirect: true,
							headers: {
								'accept-charset': 'utf-8, *;q=0.1'
							},
							downloadLimit: 20 * (1024 * 1024) // 20Mb
						}
						let entries = [], stream = new global.Download(opts)
						stream.on('response', (statusCode, headers) => {
							if(statusCode >= 200 && statusCode < 300) {
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
										reject('invalid list')
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

/*
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
*/

class Lists extends Common {
    constructor(opts){
		super(opts)
		this.setMaxListeners(99)
		if(typeof(global.lists) == 'undefined'){
			global.lists = this
		}
		this._epg = false
        this.debug = false
        this.lists = {}
		this.epgs = []
        this.myUrls = []
        this.sharingUrls = []
		this.relevantKeywords = []
		this.syncSatisfyLevel = 0.5 // allow user to navigate after this ratio of community lists is loaded
        this.fetcher = new Fetcher()
		this.loadWatchingList.bind(this)
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
				this._epg.destroy()
				delete this._epg
			}
			if(url){
				this._epg = new EPG(url)
				this._epg.once('load', () => {				
					console.log('loadEPG success') //, JSON.stringify(this._epg.data))
					resolve()
				})
				this._epg.once('error', reject)
			} else {
				resolve()
			}
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
	foundEPGs(){
		return new Promise(resolve => resolve(this.epgs))
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
				console.error('epgChannelsList FAILED', JSON.stringify(data), JSON.stringify(this._epg.data))
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
			let progress = 0, progresses = [], firstRun = true
			if(this.listsUpdateData){
				firstRun = this.listsUpdateData.firstRun
				if(this.myUrls.length){
					progresses = progresses.concat(this.myUrls.map(url => this.lists[url] ? this.lists[url].progress() : 0))
				}
				if(this.listsUpdateData.sharingListsLimit){
					let satisfyAmount = Math.floor(this.listsUpdateData.sharingListsLimit * this.syncSatisfyLevel)
					progresses = progresses.concat(Object.keys(this.lists).filter(url => url != lists.watchingListId).filter(url => !this.listsUpdateData.myUrls.includes(url)).map(url => this.lists[url].progress()).sort().reverse().slice(0, satisfyAmount))
				}
				console.log('LISTSUPDATEPROGRESS', progresses)
				progress = progresses.reduce((a, b) => a + b, 0) / progresses.length
			}
			console.log('LISTSUPDATEPROGRESS', progress)
			resolve({progress: Math.min(parseInt(progress), 99), firstRun, done: this.listsUpdateData && this.listsUpdateData.done})
		})
	}
	getUniqueAltUrls(myUrls, altUrls){ // remove duplicated altUrls, even from different protocols
		let already = []
		myUrls.forEach(u => {
			let i = u.indexOf('//')
			already.push(i == -1 ? u : u.substr(i + 2))
		})
		return altUrls.filter(u => {
			let i = u.indexOf('//')
			u = i == -1 ? u : u.substr(i + 2)
			if(!already.includes(u)){
				already.push(u)
				return true
			}
		})
	}
	sync(myUrls, altUrls, sharingListsLimit, relevantKeywords){ // prevent config.sync errors reeiving sharingListsLimit as parameter, instead of access a not yet updated the config.
		return new Promise((resolve, reject) => {
			if(relevantKeywords && relevantKeywords.length){
				this.relevantKeywords = relevantKeywords
			}
			if(!this.legalIPTV){
				this.legalIPTV = new LegalIPTV({shadow: true})
			}
			if(this.debug){
				console.log('Adding lists...', myUrls, altUrls, sharingListsLimit)
			}
			altUrls = altUrls.filter(u => !this.legalIPTV.isKnownURL(u)) // remove urls from other countries/languages
			this.prepareSetLists(myUrls, altUrls, sharingListsLimit) // helps to avoid too many lists in memory
			this.myUrls = myUrls
			altUrls = this.getUniqueAltUrls(myUrls, altUrls).slice(0, sharingListsLimit * 2)
			let amount = Object.keys(this.lists).filter(u => {
				return u != this.watchingListId && !myUrls.includes(u)
			}).length + myUrls.length
			if(!global.listsRequesting){
				global.listsRequesting = {}
			}
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
						this.lists[url] = new List(url, null, this)
						this.lists[url].skipValidating = true
						this.lists[url].on('meta', meta => {
							this.setListMeta(url, meta)
							if(meta['epg'] && !this.epgs.includes(meta['epg'])){
								this.epgs.push(meta['epg'])
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
						this.orderByCacheAvailability(altUrls, (altUrls, hasCacheCount) => {
							if(this.debug){
								console.log('Pre cached URLs count:', hasCacheCount)
							}
							this.legalIPTV.countries.ready(() => {
								this.legalIPTV.getLocalLists().then(lurls => {
									lurls.forEach(lurl => {
										if(!this.myUrls.includes(lurl) && !altUrls.includes(lurl)){
											altUrls.unshift(lurl)
										}
									})
								}).catch(console.error).finally(() => {
									if(this.debug){
										console.log('Adding community lists... (' + sharingListsLimit + '/' + amount + ')', altUrls)
									}
									let ended, satisfied
									const process = (directURL, url, pcb) => {
										if(ended || typeof(this.lists[url]) != 'undefined'){
											return pcb()
										}
										if(this.debug){
											console.log('Requesting community list... '+ url + ' | ' + directURL)
										}						
										global.listsRequesting[url] = 'loading'	
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
											} else {							
												if(this.lists[url].meta['epg'] && !this.epgs.includes(this.lists[url].meta['epg'])){
													this.epgs.push(this.lists[url].meta['epg'])
												}
												let contentAlreadyLoaded = this.isContentAlreadyLoaded(this.lists[url])												
												if(contentAlreadyLoaded){
													global.listsRequesting[url] = 'content already loaded'
													if(this.debug){
														console.log('Content already loaded', url, amount, sharingListsLimit)
													}
													if(amount > (sharingListsLimit * 1.5)){
														this.delimitActiveCommunityLists(sharingListsLimit)
														end()
													}
													if(pcb){
														pcb()
														pcb = null
													}
												} else {
													let replace
													if(Object.keys(this.lists).length > sharingListsLimit) {
														replace = this.shouldReplace(this.lists[url])
														if(replace){
															if(this.debug){
																console.log('List', url, this.lists[url].relevance, 'will replace', replace, this.lists[replace].relevance)
															}
															this.lists[replace].destroy()
															global.listsRequesting[replace] = 'replaced by '+ url
														}
													}
													if(!replace && Object.keys(this.lists).length > sharingListsLimit) {
														global.listsRequesting[url] = 'quota exceeded'
														if(this.debug){
															console.log('Quota exceeded', url, amount, sharingListsLimit)
														}
														if(amount > (sharingListsLimit * 1.5) || amount >= altUrls.length){
															this.delimitActiveCommunityLists(sharingListsLimit)
															end()
														}
														if(pcb){
															pcb()
															pcb = null
														}
													} else {
														delete global.listsRequesting[url]
														amount++
														if(this.debug){
															console.log('Added community list...', url, this.lists[url].data.length, amount, sharingListsLimit)
														}
														if(amount == sharingListsLimit){
															if(this.debug){
																console.log('Quota reached', url, amount, sharingListsLimit)
															}
														}	
														if(pcb){
															pcb()
															pcb = null
														}
													}
													if(Object.keys(this.lists).length > (sharingListsLimit * this.syncSatisfyLevel)) {
														satisfy()
													}
												}
											}
										})
										this.lists[url].on('failure', err => {
											//console.warn('LOAD LIST FAIL', url, this.lists[url])
											if(global.listsRequesting[url] == 'loading'){
												global.listsRequesting[url] = err
											}
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
											console.log('sync pre done')
											ended = true
											racing.end()
											satisfy()
											this.updateAfterSync(sharingListsLimit)
										}
									}
									const satisfy = () => {
										if(!satisfied){
											console.log('sync satisfied')
											satisfied = true
											if(cb){
												cb()
												cb = null
											}
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
								})									
							})								
						})
					} else {
						cb()
					}
				}
			], () => {
				if(this.debug){
					console.log('sync satisfied', Object.keys(this.lists), this.myUrls)
				}
				this.listsUpdateData.done = true
				this.getLists().then(data => {
					resolve(data)
				}).catch(reject)
			})
		})
    }
	updateAfterSync(sharingListsLimit){		
		if(this.debug){
			console.log('QQQ Lists loaded', Object.keys(this.lists), this.myUrls)
		}
		this.delimitActiveCommunityLists(sharingListsLimit)
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
					console.log('QQQ List discarded?!', url, this.lists)
				}
				acb()
			}
		}, () => {
			if(this.debug){
				console.log('QQQ Lists fully updated', Object.keys(this.lists), this.myUrls)
			}
			this.delimitActiveCommunityLists(sharingListsLimit)
		})
	}
	shouldReplace(list){
		let weaker
		Object.keys(this.lists).forEach(k => {
			if(this.watchingListId == k || this.myUrls.includes(k)){
				return
			}
			if(!weaker || this.lists[k].relevance < this.lists[weaker].relevance){
				weaker = k
			}
		})
		if(weaker && this.lists[weaker].relevance < list.relevance){
			return weaker
		}
	}
	isContentAlreadyLoaded(list){
		return Object.keys(this.lists).some(url => {
			if(url != list.url){
				return this.compareListData(list, this.lists[url])
			}
		})		
	}
	compareListData(listA, listB){ // return true if are equals
		return !listA.data.some((line, i) => {
			if(typeof(listB[i]) == 'undefined' || listA[i] != listB[i]){
				return true
			}
		})
	}
    getLists(){
        return new Promise((resolve, reject) => {
			let communityUrls = Object.keys(this.lists).filter(u => {
				return u != this.watchingListId && !this.myUrls.includes(u)
			})
            resolve({
                my: this.myUrls,
                community: communityUrls,
                length: this.myUrls.length + communityUrls.length
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
	delimitActiveCommunityLists(communityListsLimit){
		if(Object.keys(this.lists).length > communityListsLimit){
			let results = {}
			console.log('delimitActiveCommunityLists', Object.keys(this.lists), communityListsLimit)
			Object.keys(this.lists).forEach(url => {
				if(url != this.watchingListId && !this.myUrls.includes(url)){
					results[url] = this.lists[url].relevance
				}
			})
			let sorted = Object.keys(results).sort((a,b) => results[b] - results[a])
			sorted.slice(communityListsLimit).forEach(u => {
				this.lists[u].destroy()
				delete this.lists[u]
			})
			console.log('delimitActiveCommunityLists', Object.keys(this.lists), communityListsLimit, results, sorted)
		}
	}
	remove(u){
		if(typeof(this.lists[u]) != 'undefined'){
			this.lists[u].remove()
			delete this.lists[u]
		}
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
						if(typeof(this.lists[listUrl].index[term]) == 'undefined'){
							ssmap = undefined
							return true
						} else {
							let map = {}
							map[listUrl] = global.deepClone(this.lists[listUrl].index[term])
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
						if(typeof(this.lists[listUrl].index[xterm]) != 'undefined'){
							let map = {}
							map[listUrl] = global.deepClone(this.lists[listUrl].index[xterm])
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
						if(typeof(this.lists[listUrl].index[term]) != 'undefined'){
							let map = {}
							map[listUrl] = global.deepClone(this.lists[listUrl].index[term])
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
						}, smap[listUrl])
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
					console.warn('M3U SEARCH RESULTS', (global.time() - start) +'s (total time)', terms)
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
		Object.keys(b).forEach(listUrl => {
			if(typeof(a[listUrl]) != 'undefined'){
				c[listUrl] = {
					g: a[listUrl].g ? a[listUrl].g.filter(n => b[listUrl].g.includes(n)).sort() : [], 
					n: a[listUrl].n ? a[listUrl].n.filter(n => b[listUrl].n.includes(n)).sort() : []
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
					c[listUrl][type].sort()
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
			async.eachOf(Object.keys(this.lists), (listUrl, i, _icb) => {
				let icb = () => {
					// console.log(listUrl, i, 'done')
					_icb()
				}
				if(this.lists[listUrl].groups.indexOf(group) != -1){
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
    directListFileRenderer(file, url){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[file]) != 'undefined'){
                let entries = this.lists[file].fetchAll()
                this.directListRendererPrepare(entries, v.url).then(resolve).catch(reject)
            } else {
				let stream = fs.createReadStream(file), entries = [], parser = new Parser()
				parser.on('entry', e => entries.push(e))
				parser.on('end', () => {
					this.directListRendererPrepare(entries, url || file).then(resolve).catch(reject)
				})
				stream.on('data', chunk => {
					parser.write(chunk)
				})
				stream.on('close', () => {
					parser.end()
				})
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
			let gs = []
			Object.keys(this.lists).forEach(listUrl => {
				this.lists[listUrl].groups.forEach(group => {
					if(!gs.includes(group)){
						gs.push(group)
					}
				})
			})
            gs = this.parentalControl.filter(gs)
            gs.sort()
            resolve(gs)
        })
    }
	setNetworkConnectionState(state){
        return new Promise((resolve, reject) => {
			Download.setNetworkConnectionState(state)
			resolve(true)
		})
	}
}

module.exports = Lists
