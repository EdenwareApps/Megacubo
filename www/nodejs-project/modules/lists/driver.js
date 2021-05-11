
const async = require('async'), path = require('path'), Events = require('events'), fs = require('fs')

const Index = require(global.APPDIR + '/modules/lists/index.js')
const List = require(global.APPDIR + '/modules/lists/list.js')
const EPG = require(global.APPDIR + '/modules/lists/epg.js')
const Parser = require(global.APPDIR + '/modules/lists/parser')
const Storage = require(APPDIR + '/modules/storage')
const Cloud = require(APPDIR + '/modules/cloud')
const Mega = require(APPDIR + '/modules/mega')

require(APPDIR + '/modules/supercharge')(global)

storage = new Storage()  
tstorage = new Storage('', {temp: true, clear: false, cleanup: false})  
rstorage = new Storage() 
rstorage.useJSON = false

Download = require(APPDIR + '/modules/download')
cloud = new Cloud()
mega = new Mega()

const emit = (type, content) => {
	postMessage({id: 0, type: 'event', data: type +':'+ JSON.stringify(content)})
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
						stream.once('response', (statusCode, headers) => {
							if(statusCode >= 200 && statusCode < 300) {
								let parser = new Parser(stream)
								parser.on('entry', entry => {
									entries.push(entry)
								})
								parser.once('end', () => {
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
						stream.start()
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

class Lists extends Index {
    constructor(opts){
		super(opts)
		if(typeof(global.lists) == 'undefined'){
			global.lists = this
		}
		this._epg = false
        this.debug = false
        this.lists = {}
		this.epgs = []
        this.myLists = []
        this.sharingUrls = []
		this.relevantKeywords = []
		this.syncListsQueue = {}
		this.sharedModeReach = global.config.get('shared-mode-reach')
		global.config.on('change', (keys, data) => {
			if(keys.includes('shared-mode-reach')){
				this.sharedModeReach = data['shared-mode-reach']
			}
		})
	}
	isListCached(url, cb){
		let file = global.rstorage.resolve(LIST_DATA_KEY_MASK.format(url))
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
	filterByAvailability(urls, cb){
		//console.log('filterByAvailability', urls.join("\r\n"))
		let loadedUrls = [], cachedUrls = []
		urls = urls.filter(u => {
			if(typeof(this.lists[u]) == 'undefined'){
				return true
			}
			loadedUrls.push(u)
		})
		async.eachOfLimit(urls, 8, (url, i, done) => {
			this.isListCached(url, has => {
				//console.log('filterByAvailability', url, key, has, fine)
				if(has){
					cachedUrls.push(url)
				}
				done()
			})
		}, () => {
			//console.log('filterByAvailability', urls.join("\r\n"))
			cb(loadedUrls.concat(cachedUrls))
		})
	}
	updaterFinished(isFinished){
		return new Promise((resolve, reject) => {
			this.isUpdaterFinished = isFinished
		})
	}
	getUniqueCommunityLists(communityLists){ // remove duplicated communityLists, even from different protocols
		let already = []
		this.myLists.forEach(u => {
			let i = u.indexOf('//')
			already.push(i == -1 ? u : u.substr(i + 2))
		})
		return communityLists.filter(u => {
			let i = u.indexOf('//')
			u = i == -1 ? u : u.substr(i + 2)
			if(!already.includes(u)){
				already.push(u)
				return true
			}
		})
	}
	sync(myLists, communityLists, sharedModeReach, relevantKeywords){ // prevent config.sync errors receiving sharedModeReach as parameter, instead of access a not yet updated the config.
		return new Promise((resolve, reject) => {
			if(relevantKeywords && relevantKeywords.length){
				this.relevantKeywords = relevantKeywords
			}
			if(this.debug){
				console.log('Adding lists...', myLists, communityLists, sharedModeReach)
			}
			communityLists = this.getUniqueCommunityLists(communityLists)
			if(this.myLists.length){
				this.myLists.forEach(u => {
					if(!myLists.includes(u)){
						this.remove(u)
					}
				})
			}
			this.myLists = myLists
			this.sharedModeReach = sharedModeReach
			this.syncListProgressData = {myLists, communityLists} // pick communityLists before filtering
			this.filterByAvailability(communityLists, communityLists => {
				this.syncListProgressData.firstRun = !communityLists.length
				this.delimitActiveLists() // helps to avoid too many lists in memory
				if(!global.listsRequesting){
					global.listsRequesting = {}
				}
				if(!this.sharedModeReach && communityLists.length){
					communityLists = []
				}
				async.eachOf(myLists.concat(communityLists), (url, i, acb) => {
					this.syncList(url).catch(console.error).finally(acb)
				}, () => {
					if(this.debug){
						console.log('sync end')
					}
					resolve(true)
				})	
			})		
		})
    }
	isUpdating(){
		return new Promise((resolve, reject) => {
			resolve(!this.isUpdaterFinished || this.syncingListsCount())
		})
	}
	syncListProgressMessage(url){
		let progress = 0, progresses = [], firstRun = true, satisfyAmount = this.myLists.length				
		let isUpdatingFinished = this.isUpdaterFinished && !this.syncingListsCount()
		if(this.syncListProgressData){
			firstRun = this.syncListProgressData.firstRun
			if(this.myLists.length){
				progresses = progresses.concat(this.myLists.map(url => this.lists[url] ? this.lists[url].progress() : 0))
			}
			if(this.sharedModeReach){
				satisfyAmount = this.communityListsRequiredAmount(this.sharedModeReach, this.syncListProgressData.communityLists.length)
				progresses = progresses.concat(Object.keys(this.lists).filter(url => !this.syncListProgressData.myLists.includes(url)).map(url => this.lists[url].progress()).sort((a, b) => b - a).slice(0, satisfyAmount))
			}
			if(this.debug){
				console.log('syncListProgressMessage() progresses', progresses)
			}
			progress = parseInt(progresses.length ? (progresses.reduce((a, b) => a + b, 0) / satisfyAmount) : 0)
			if(progress == 100){
				if(!isUpdatingFinished && Object.keys(this.lists).length < satisfyAmount){
					progress = 99
				}
			} else {
				if(isUpdatingFinished){
					progress = 100
				}
			}
		}
		let ret = {url, progress, firstRun, satisfyAmount}
		if(progress > 99){
			ret.activeLists = this.getListsRaw()
		}
		return ret
	}
	isSyncing(url, resolve, reject){
		return Object.keys(this.syncListsQueue).some(u => {
			if(u == url){
				if(resolve){
					this.syncListsQueue[url].resolves.push(resolve)
					this.syncListsQueue[url].rejects.push(reject)
				}
				return true
			}
		})
	}
	syncingActiveListsCount(){
		let size = 0
		Object.values(this.syncListsQueue).forEach(e => {
			if(e.active) size++
		})
		return size
	}
	syncingListsCount(){
		let size = 0
		Object.values(this.syncListsQueue).forEach(e => {
			size++
		})
		return size
	}
	syncEnqueue(url, resolve, reject){
		this.syncListsQueue[url] = {
			active: false,
			resolves: [resolve],
			rejects: [reject]
		}
	}
	syncPump(syncedUrl, err){
		if(typeof(this.syncListsQueue[syncedUrl]) != 'undefined'){
			if(err){
				this.syncListsQueue[syncedUrl].rejects.forEach(r => r(err))
			} else {
				this.syncListsQueue[syncedUrl].resolves.forEach(r => r())
			}
			delete this.syncListsQueue[syncedUrl]
			emit('list-added', this.syncListProgressMessage(syncedUrl))
		}
		if(this.syncingActiveListsCount() < 3){
			return Object.keys(this.syncListsQueue).some(url => {
				if(!this.syncListsQueue[url].active){
					this.syncList(url, true).catch(() => {})
					return true
				}
			})
		}
	}
	syncList(url, skipQueue){ // dont trust on config-change sync, it can be delayed
        return new Promise((resolve, reject) => {	
			if(skipQueue !== true){
				if(this.isSyncing(url, resolve, reject)){
					return
				}
				if(this.syncingActiveListsCount() >= 3){
					return this.syncEnqueue(url, resolve, reject)				
				}
			}
			if(typeof(this.syncListsQueue[url]) == 'undefined'){
				this.syncListsQueue[url] = {
					active: true,
					resolves: [],
					rejects: []
				}
			} else {
				this.syncListsQueue[url].active = true
				this.syncListsQueue[url].resolves.push(resolve)
				this.syncListsQueue[url].rejects.push(reject)
			}
			let err
			if(typeof(this.lists[url]) == 'undefined'){
				this.getListContentLength(url, contentLength => {
					this.syncLoadList(url, contentLength).catch(e => err = e).finally(() => this.syncPump(url, err))
				})
			} else {
				this.shouldUpdate(url, contentLength => {
					if(typeof(contentLength) == 'number'){
						this.syncLoadList(url, contentLength).catch(e => err = e).finally(() => this.syncPump(url, err))
					} else {
						err = 'no need to update'
						this.syncPump(url, err)
					}
				})
			}
		})
	}
	syncLoadList(url, contentLength){	
        return new Promise((resolve, reject) => {
			let resolved, isMine = this.myLists.includes(url)
			if(this.debug){
				console.log('syncLoadList start', url)
			}
			global.listsRequesting[url] = 'loading'		
			this.lists[url] = new List(url, this)
			this.lists[url].skipValidating = isMine
			this.lists[url].contentLength = contentLength
			this.lists[url].on('destroy', () => {
				if(!global.listsRequesting[url] || (global.listsRequesting[url] == 'loading')){
					global.listsRequesting[url] = 'destroyed'
				}
				if(isMine){
					console.error('Damn! My list got destroyed!')
				}
				this.remove(url)
				if(!resolved){
					if(this.debug){
						console.log('syncLoadList end: destroyed')
					}
					resolved = true
					reject('list destroyed')
				}
			})
			this.lists[url].start().then(() => {
				if(this.debug){
					console.log('syncLoadList started')
				}
				if(!this.lists[url]) {
					if(!global.listsRequesting[url] || (global.listsRequesting[url] == 'loading')){
						global.listsRequesting[url] = 'loaded, but destroyed'
					}
					if(this.debug){
						console.log('List '+ url +' already discarded.')
					}
					if(this.debug){
						console.log('syncLoadList end: discarded')
					}
					if(!resolved){
						resolved = true
						reject('list discarded')
					}
				} else {				
					this.setListMeta(url, this.lists[url].index.meta)			
					if(this.lists[url].index.meta['epg'] && !this.epgs.includes(this.lists[url].index.meta['epg'])){
						this.epgs.push(this.lists[url].index.meta['epg'])
					}
					this.isContentAlreadyLoaded(this.lists[url], contentAlreadyLoaded => {
						if(contentAlreadyLoaded){
							global.listsRequesting[url] = 'content already loaded'
							if(this.debug){
								console.log('Content already loaded', url)
							}
							if(this.debug){
								console.log('syncLoadList end: already loaded')
							}
							if(!resolved){
								resolved = true
								reject('content already loaded')
							}
						} else {
							let replace
							if(Object.keys(this.lists).length >= this.sharedModeReach){
								replace = this.shouldReplace(this.lists[url])
								if(replace){
									if(this.debug){
										console.log('List', url, this.lists[url].relevance, 'will replace', replace, this.lists[replace].relevance)
									}
									this.remove(replace)
									global.listsRequesting[replace] = 'replaced by '+ url
								}
							}														
							global.listsRequesting[url] = 'added'
							if(this.debug){
								console.log('Added community list...', url, this.lists[url].index.length)
							}
							if(!resolved){
								if(!replace){
									this.delimitActiveLists()
								}
								resolved = true
								resolve(true)
							}
						}
					})
				}
			}).catch(err => {
				//console.warn('LOAD LIST FAIL', url, this.lists[url])
				if(!global.listsRequesting[url] || (global.listsRequesting[url] == 'loading')){
					global.listsRequesting[url] = String(err)
				}
				if(this.debug){
					console.log('syncLoadList end: ', err)
				}
				if(!resolved){
					resolved = true
					reject(err)
				}
				if(this.lists[url] && !this.myLists.includes(url)){
					this.remove(url)												
				}
			})
		})
	}
	getListContentLength(url, cb){
		this.getUpdateMeta(url, updateMeta => {
			cb(updateMeta.contentLength)
		})
	}
	shouldUpdate(url, cb){
		let loadedContentLength = this.lists[url].contentLength
		this.getListContentLength(url, updatedContentLength => {
			if(updatedContentLength > 0 && updatedContentLength == loadedContentLength){
				cb(false)
			} else {
				cb(updatedContentLength)
			}
		})
	}
	shouldReplace(list){
		if(!list){
			console.error('shouldReplace error: no list given', list)
			return
		}
		let weaker
		Object.keys(this.lists).forEach(k => {
			if(this.myLists.includes(k)){
				return
			}
			if(!weaker || (this.lists[k].relevance > -1 && this.lists[k].relevance < this.lists[weaker].relevance)){
				weaker = k
			}
		})
		if(weaker && this.lists[weaker] && this.lists[weaker].relevance < list.relevance){
			return weaker
		}
	}
	isContentAlreadyLoaded(list, cb){
		if(this.myLists.includes(list.url)){
			return cb(false)
		}
		let alreadyLoaded, listDataFile = list.file, listIndexLength = list.index.length
		fs.stat(listDataFile, (err, stat) => {
			if(err || stat.size == 0){
				cb(true) // to trigger list discard
			} else {
				const size = stat.size
				stat = null
				async.eachOfLimit(Object.keys(this.lists), 3, (url, i, done) => {
					if(!alreadyLoaded && url != list.url && this.lists[url] && this.lists[url].index.length == listIndexLength){
						const f = this.lists[url].file
						fs.stat(f, (err, s) => {
							if(!err && !alreadyLoaded){
								if(this.debug){
									console.log('already loaded', list.url, url, f, listDataFile, size, s.size)
								}
								if(size == s.size){
									alreadyLoaded = true
								}
							}
							done()
						})
					} else {
						done()
					}
				}, () => {
					cb(alreadyLoaded)
				})
			}
		})
	}
    getListsRaw(){
		let communityUrls = Object.keys(this.lists).filter(u => !this.myLists.includes(u))
		return {
			my: this.myLists,
			community: communityUrls,
			length: this.myLists.length + communityUrls.length
		}
    }	
    getLists(){
        return new Promise((resolve, reject) => {
			resolve(this.getListsRaw())
        })
    }	
    getList(url){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[url]) == 'undefined'){
                reject('list not loaded')
            } else {
                this.lists[url].fetchAll(resolve)
            }
        })
    }
	delimitActiveLists(){
		if(Object.keys(this.lists).length > (this.myLists.length + this.sharedModeReach)){
			let results = {}
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), this.sharedModeReach)
			}
			Object.keys(this.lists).forEach(url => {
				if(!this.myLists.includes(url)){
					results[url] = this.lists[url].relevance
				}
			})
			let sorted = Object.keys(results).sort((a,b) => results[b] - results[a])
			sorted.slice(this.sharedModeReach).forEach(u => {
				if(this.lists[u]){
					this.remove(u)
					global.listsRequesting[u] = 'destroyed on delimiting (' + this.sharedModeReach + ') '+ JSON.stringify(global.traceback()).replace(new RegExp('[^A-Za-z0-9 /:]+', 'g'), ' ')
				}
			})
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), this.sharedModeReach, results, sorted)
			}
		}
	}
	remove(u){
		if(typeof(this.lists[u]) != 'undefined'){
			this.lists[u].destroy()
			delete this.lists[u]
		}
		if(this.debug){
			console.log('Removed list', u)
		}
	}
    directListRenderer(v){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[v.url]) != 'undefined'){
                this.lists[v.url].fetchAll(entries => {
					this.directListRendererPrepare(entries, v.url).then(resolve).catch(reject)
				})                
            } else {
				let fetcher = new Fetcher()
				fetcher.fetch(v.url).then(flatList => {
					this.directListRendererPrepare(flatList, v.url).then(resolve).catch(reject)
				}).catch(reject)
            }
        })
    }
    directListFileRenderer(file, url){
        return new Promise((resolve, reject) => {
            if(typeof(this.lists[file]) != 'undefined'){
                this.lists[file].fetchAll(entries => {
					this.directListRendererPrepare(entries, v.url).then(resolve).catch(reject)
				})                
            } else {
				let stream = fs.createReadStream(file), entries = [], parser = new Parser()
				parser.on('entry', e => entries.push(e))
				parser.once('end', () => {
					this.directListRendererPrepare(entries, url || file).then(resolve).catch(reject)
				})
				stream.on('data', chunk => {
					parser.write(chunk)
				})
				stream.once('close', () => {
					parser.end()
				})
            }
        })
    }
    directListRendererParse(content){
        return new Promise((resolve, reject) => {
			let entries = [], parser = new Parser()
			parser.on('entry', e => entries.push(e))
			parser.once('end', () => {
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
	setNetworkConnectionState(state){
        return new Promise((resolve, reject) => {
			Download.setNetworkConnectionState(state)
			resolve(true)
		})
	}
}

module.exports = Lists
