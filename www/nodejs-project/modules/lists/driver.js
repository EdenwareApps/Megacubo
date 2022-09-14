
const async = require('async'), path = require('path'), Events = require('events'), fs = require('fs')

const Parser = require(global.APPDIR + '/modules/lists/parser')
const Index = require(global.APPDIR + '/modules/lists/index')
const List = require(global.APPDIR + '/modules/lists/list')
const EPG = require(global.APPDIR + '/modules/epg')
const Cloud = require(APPDIR + '/modules/cloud')
const Mega = require(APPDIR + '/modules/mega')

require(APPDIR + '/modules/supercharge')(global)

storage = require(APPDIR + '/modules/storage')({})

Download = require(APPDIR + '/modules/download')
cloud = new Cloud()
mega = new Mega()

listsRequesting = {}
listsLoadTimes = {}

const emit = (type, content) => {
	postMessage({id: 0, type: 'event', data: type +':'+ JSON.stringify(content)})
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
		this.sharedModeReach = global.config.get('communitary-mode-lists-amount')
		global.config.on('change', (keys, data) => {
			if(keys.includes('communitary-mode-lists-amount')){
				this.sharedModeReach = data['communitary-mode-lists-amount']
			}
		})
	}
	isListCached(url, cb){
		let file = global.storage.raw.resolve(LIST_DATA_KEY_MASK.format(url))
		fs.stat(file, (err, stat) => {
			cb((stat && stat.size >= 1024))
		})
	}
	loadEPG(url){
		return new Promise((resolve, reject) => {
			if(this._epg){
				if(this._epg.url != url){
					console.error('changed epg url', this._epg.url, url)
					this._epg.destroy()
					delete this._epg
				} else {
					console.error('same epg url', this._epg.url, !!this._epg.parser)
					if(this._epg.loaded){						
						resolve()
					} else if(this._epg.error) {
						reject(this._epg.error)
					} else {
						this._epg.once('load', () => {				
							console.log('loadEPG success') //, JSON.stringify(this._epg.data))
							resolve()
						})
						this._epg.once('error', reject)
					}
					return
				}
			}
			if(url){
				let resolved, retries = 2
				const load = () => {
					this._epg = new EPG(url)
					this._epg.once('load', () => {				
						console.log('loadEPG success') //, JSON.stringify(this._epg.data))
						if(!resolved){
							resolve()
							resolved = true
						}
					})
					this._epg.once('error', err => {
						if(!resolved){
							if(retries){
								this._epg.destroy()
								retries--
								load()
							} else {
								reject(err)
								resolved = true
							}
						}
					})
					this._epg.on('error', console.error) // avoid ERR_UNHANDLED_ERROR
				}
				load()
			} else {
				resolve()
			}
		})
	}
	async epg(channelsList, limit){
		if(!this._epg){
			throw 'no epg 0'
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
		return data	
	}
	async epgExpandSuggestions(categories){
		if(!this._epg){
			throw 'no epg 1'
		}
		return this._epg.expandSuggestions(categories)
	}
	async epgSuggestions(categories, until, searchTitles){
		if(!this._epg){
			throw 'no epg 2'
		}
		return this._epg.getSuggestions(categories, until, searchTitles)
	}
	async epgSearch(terms, nowLive){
		if(!this._epg){
			throw 'no epg 3'
		}
		return await this._epg.search(this.applySearchRedirects(terms), nowLive)
	}
	async epgSearchChannel(terms){
		if(!this._epg){
			throw 'no epg 4'
		}
		return this._epg.searchChannel(this.applySearchRedirects(terms))
	}
	async epgSearchChannelIcon(terms){
		if(!this._epg){
			throw 'no epg 5'
		}
		return this._epg.searchChannelIcon(this.applySearchRedirects(terms))
	}
	async epgData(){
		if(!this._epg){
			throw 'no epg 6'
		}
		return this._epg.data
	}
	async foundEPGs(){
		return this.epgs
	}
	epgChannelsListSanityScore(data){
		let count = Object.keys(data).length, idealCatCount = 8
		if(count < 3){ // too few categories
			return 0
		}
		let c = Math.abs(count - idealCatCount)
		return 100 - c
	}
	async epgFindChannel(data){
		return this._epg.findChannel(data)
	}
	epgLiveNowChannelsList(){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg 8')
			}
			let data = this._epg.liveNowChannelsList()
			if(data && data['categories'] && Object.keys(data['categories']).length){
				let currentScore = this.epgChannelsListSanityScore(data['categories'])
				async.eachOfLimit(Object.keys(this.lists), 2, (url, i, done) => {
					if(this.lists[url].index.meta['epg'] == this._epg.url){
						let categories = {}
						this.lists[url].iterate(e => {
							if(e.groupName && this._epg.findChannel(this.terms(e.name))){
								if(typeof(categories[e.groupName]) == 'undefined'){
									categories[e.groupName] = []
								}
								if(!categories[e.groupName].includes(e.name)){
									categories[e.groupName].push(e.name)
								}
							}
						}, null, () => {
							let newScore = this.epgChannelsListSanityScore(categories)
							console.warn('epgChannelsList', categories, currentScore, newScore)
							if(newScore > currentScore){
								data.categories = categories
								data.updateAfter = 24 * 3600
								currentScore = newScore
							}
							done()
						})
					} else done()
				}, () => {
					resolve(data)
				})
			} else {
				console.error('epgLiveNowChannelsList FAILED', JSON.stringify(data), JSON.stringify(this._epg.data))
				reject('failed')
			}
		})		
	}
	epgChannelsTermsList(){
		return new Promise((resolve, reject) => {
			if(!this._epg){
				return reject('no epg 9')
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
		if(this.debug) console.log('filterByAvailability', urls.join("\r\n"))
		let loadedUrls = [], cachedUrls = []
		urls = urls.filter(u => {
			if(typeof(this.lists[u]) == 'undefined'){
				return true
			}
			loadedUrls.push(u)
		})
		async.eachOfLimit(urls, 8, (url, i, done) => {
			this.isListCached(url, has => {
				if(this.debug) console.log('filterByAvailability', url, has)
				if(has){
					cachedUrls.push(url)
					if(!listsRequesting[url]){
						listsRequesting[url] = 'cached, not added'
					}
				} else {					
					listsRequesting[url] = 'not cached'
				}
				done()
			})
		}, () => {
			if(this.debug) console.log('filterByAvailability', loadedUrls.concat(cachedUrls).join("\r\n"))
			cb(loadedUrls.concat(cachedUrls))
		})
	}
	updaterFinished(isFinished){
		return new Promise((resolve, reject) => {
			this.isUpdaterFinished = isFinished
			resolve(this.isUpdaterFinished)
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
			communityLists.forEach(url => {
				if(!listsLoadTimes[url]){
					listsLoadTimes[url] = {}
				}
				listsLoadTimes[url].sync = global.time()
			})
			this.filterByAvailability(communityLists, communityLists => {
				communityLists.forEach(url => {
					if(!listsLoadTimes[url]){
						listsLoadTimes[url] = {}
					}
					listsLoadTimes[url].filtered = global.time()
				})
				this.syncListProgressData.firstRun = !communityLists.length
				this.delimitActiveLists() // helps to avoid too many lists in memory
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
	async querySyncStatus(){
		return this.syncListProgressMessage('')
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
			if(skipQueue !== true) {
				if(this.isSyncing(url, resolve, reject)){
					return
				}
				if(this.syncingActiveListsCount() >= 6){
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
			if(!listsLoadTimes[url]){
				listsLoadTimes[url] = {}
			} else {
				this.remove(url)
			}
			listsLoadTimes[url].syncing = global.time()
			global.listsRequesting[url] = 'loading'		
			this.lists[url] = new List(url, this, this.relevantKeywords)
			this.lists[url].skipValidating = true // list is already validated at driver-updater, always
			this.lists[url].contentLength = contentLength
			this.lists[url].on('destroy', () => {
				if(!global.listsRequesting[url] || (global.listsRequesting[url] == 'loading')){
					global.listsRequesting[url] = 'destroyed'
				}
				if(isMine && this.myLists.includes(url)){ // isMine yet?
					console.error('Damn! My list got destroyed!', url)
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
				listsLoadTimes[url].synced = global.time()
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
							if(this.lists[url]){
								if(Object.keys(this.lists).length >= this.sharedModeReach){
									replace = this.shouldReplace(this.lists[url])
									if(replace){
										const pr = this.lists[replace].relevance.total
										if(this.debug){
											console.log('List', url, this.lists[url].relevance.total, 'will replace', replace, pr)
										}
										this.remove(replace)
										global.listsRequesting[replace] = 'replaced by '+ url +', '+ pr +' < '+ this.lists[url].relevance.total
									}
								}
								if(this.debug){
									console.log('Added community list...', url, this.lists[url].index.length)
								}
								global.listsRequesting[url] = 'added'
							} else if(!global.listsRequesting[url] || global.listsRequesting[url] == 'loading') {
								global.listsRequesting[url] = 'adding error, instance not found'
							}
							if(!resolved){
								if(!replace){
									this.delimitActiveLists()
								}
								resolved = true
								resolve(true)
								this.searchMapCacheInvalidate()
							}
						}
					})
				}
			}).catch(err => {
				//console.warn('LOAD LIST FAIL', url, this.lists[url])
				listsLoadTimes[url].synced = global.time()
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
		this.getListMeta(url, updateMeta => {
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
			if(!weaker || (this.lists[k].relevance.total > -1 && this.lists[k].relevance.total < this.lists[weaker].relevance.total)){
				weaker = k
			}
		})
		if(weaker && this.lists[weaker] && this.lists[weaker].relevance.total < list.relevance.total){
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
    async getLists(){
        return this.getListsRaw()
    }
    async getListsInfo(lists){
        const info = {}, current = (lists && typeof(lists) == 'object') ? lists : global.config.get('lists')
		Object.keys(this.lists).forEach(url => {
			info[url] = this.lists[url].index.meta
			current.forEach(c => {
				if(c[1] == url){
					info[url].name = c[0]
					if(c.length > 2) {
						Object.keys(c).forEach(k => {
							info[k] = c[k]
						})
					}
				}
			})
		})
		return info
    }
	delimitActiveLists(){
		if(Object.keys(this.lists).length > (this.myLists.length + this.sharedModeReach)){
			let results = {}
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), this.sharedModeReach)
			}
			Object.keys(this.lists).forEach(url => {
				if(!this.myLists.includes(url)){
					results[url] = this.lists[url].relevance.total
				}
			})
			let sorted = Object.keys(results).sort((a,b) => results[b] - results[a])
			sorted.slice(this.sharedModeReach).forEach(u => {
				if(this.lists[u]){
					global.listsRequesting[u] = 'destroyed on delimiting (relevance: '+ this.lists[u].relevance.total +'), '+ JSON.stringify(global.traceback()).replace(new RegExp('[^A-Za-z0-9 /:]+', 'g'), ' ')
					this.remove(u)
				}
			})
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), this.sharedModeReach, results, sorted)
			}
		}
	}
	remove(u){
		this.searchMapCacheInvalidate(u)
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
			console.log('DIRECTLISTRENDERER', v, this.isLocal(v.url), this.lists[v.url] && this.lists[v.url].isReady)
			if(typeof(this.lists[v.url]) != 'undefined' && this.lists[v.url].isReady){ // if not loaded yet, fetch directly
				this.lists[v.url].fetchAll(entries => {
					console.log('DIRECTLISTRENDERER', entries)
					this.directListRendererPrepare(entries, v.url).then(ret => {
						console.log('DIRECTLISTRENDERER', entries)
						resolve(ret)
					}).catch(reject)
				})
			} else {
				let fetcher = new this.Fetcher()
				fetcher.fetch(v.url).then(entries => {
					this.directListRendererPrepare(entries, v.url).then(resolve).catch(reject)
				}).catch(reject)
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
			if(typeof(this.directListRendererPrepareCache) == 'undefined'){
				this.directListRendererPrepareCache = {}
			}
			const cachettl = 3600, now = global.time(), olen = list.length
			const next = es => {
				if(!es){
					es = []
				}
				if(olen >= this.opts.offloadThreshold){
					this.directListRendererPrepareCache[url] = {list: es, time: now, size: olen}
				}
				resolve(es)
			}
			if(typeof(this.directListRendererPrepareCache[url]) != 'undefined' && this.directListRendererPrepareCache[url].size == olen && this.directListRendererPrepareCache[url].time > (now - cachettl)){
				return resolve(this.directListRendererPrepareCache[url].list)
			}
            if(list.length){
                list = this.parentalControl.filter(list, true)
                list = this.tools.dedup(list)
                list = this.prepareEntries(list)
				list = this.tools.deepify(list)
				this.tools.offload(list, url, next)
            } else {
                next()
            }
        })
    }
	isLocal(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	setNetworkConnectionState(state){
        return new Promise((resolve, reject) => {
			global.Download.setNetworkConnectionState(state)
			resolve(true)
		})
	}
}

module.exports = Lists
