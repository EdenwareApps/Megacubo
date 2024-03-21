const Index = require('./index')

class ListsEPGTools extends Index {
    constructor(opts){
		super(opts)
		this._epg = false
	}
	epgChannelsListSanityScore(data){
		let count = Object.keys(data).length, idealCatCount = 8
		if(count < 3){ // too few categories
			return 0
		}
		let c = Math.abs(count - idealCatCount)
		return 100 - c
	}
	async loadEPG(url){
		if(this._epg){
			if(this._epg.url == url){
				console.error('same epg url', this._epg.url)
				return await this._epg.ready()
			}
			console.error('changed epg url', this._epg.url, url)
			try {
				await this._epg.terminate()
			} catch(e) { }
			try {
				await this._epgWorker.terminate()
			} catch(e) { }
			delete this._epg
			delete this._epgWorker
		}
		console.error('will load epg '+ JSON.stringify(url))
		if(url) {
			// give EPG his own worker, otherwise it may slow down app navigation
			const path = require('path')
			const MultiWorker = require('../multi-worker')
			this._epgWorker = new MultiWorker()
			this._epg = this._epgWorker.load(path.join(__dirname, 'epg-worker'))
			this._epg.setURL(url)
			this._epg.on('updated', () => {
				console.error('EPG UPDATED! FINE '+ (new Date()).getUTCMinutes())
				this.emit('epg-update')
			})
			await this._epg.ready()
			return true
		}
	}
	async epg(channelsList, limit){
		if(!this._epg) return ['error', 'no epg']
		let data, err, ret, retries = 2
		while(retries >= 0) {
			retries--
			ret = await this._epg.getState().catch(e => err = e)
			if(!err || String(err).indexOf('worker manually exited') == -1) {
				break
			}
		}
		if(err) return ['error', String(err)]
		const { progress, state, error } = ret
		if(error) {
			data = [state]
			if(state == 'error'){
				data.push(error)
			} else {
				data.push(progress)
			}
		} else if(!this._epg) { // unset in the meantime
			data = []
		} else {	
			if(Array.isArray(channelsList)){
				channelsList = channelsList.map(c => this.applySearchRedirectsOnObject(c))
				data = await this._epg.getMulti(channelsList, limit)
			} else {
				channelsList = this.applySearchRedirectsOnObject(channelsList)
				data = await this._epg.get(channelsList, limit)
			}
		}
		return data	
	}
	async epgExpandRecommendations(categories){
		if(!this._epg) throw 'no epg 1'
		return await this._epg.expandRecommendations(categories)
	}
	async epgRecommendations(categories, until, limit, searchTitles){
		if(!this._epg) throw 'no epg 2'
		return await this._epg.getRecommendations(categories, until, limit, searchTitles)
	}
	async epgSearch(terms, nowLive){
		if(!this._epg) throw 'no epg 3'
		return await this._epg.search(this.applySearchRedirects(terms), nowLive)
	}
	async epgSearchChannel(terms, limit){
		if(!this._epg) throw 'no epg 4'
		return await this._epg.searchChannel(this.applySearchRedirects(terms), limit)
	}
	async epgSearchChannelIcon(terms){
		if(!this._epg) throw 'no epg 5'
		return await this._epg.searchChannelIcon(this.applySearchRedirects(terms))
	}
	async epgFindChannel(data){
		return await this._epg.findChannel(data)
	}
	async epgLiveNowChannelsList(){
		if(!this._epg){
			throw 'no epg 8'
		}
		let data = await this._epg.liveNowChannelsList()
		if(data && data['categories'] && Object.keys(data['categories']).length){
			let currentScore = this.epgChannelsListSanityScore(data['categories'])
			const pLimit = require('p-limit')
			const limit = pLimit(3)
			const tasks = Object.keys(this.lists).filter(url => {
				return this.lists[url].index.meta['epg'] && this.lists[url].index.meta['epg'].indexOf(this._epg.url) != -1 // use indexOf as it can be a comma delimited list
			}).map(url => {
				return async () => {
					let categories = {}
					await this.lists[url].iterate(async e => {
						if(!e.groupName) return
						const c = await this._epg.findChannel(this.terms(e.name))
						if(typeof(categories[e.groupName]) == 'undefined'){
							categories[e.groupName] = []
						}
						if(!categories[e.groupName].includes(e.name)){
							categories[e.groupName].push(e.name)
						}
					}, null)
					let newScore = this.epgChannelsListSanityScore(categories)
					console.warn('epgChannelsList', categories, currentScore, newScore)
					if(newScore > currentScore){
						data.categories = categories
						data.updateAfter = 24 * 3600
						currentScore = newScore
					}
				}
			}).map(limit)
			await Promise.allSettled(tasks)
			return data
		} else {
			console.error('epgLiveNowChannelsList FAILED', JSON.stringify(data))
			throw 'failed'
		}
	}
	async epgChannelsTermsList(){
		if(!this._epg){
			throw 'no epg'
		}
		let data = await this._epg.getTerms()
		if(data && Object.keys(data).length){
			return data
		} else {
			throw 'failed'
		}
	}
}

class Lists extends ListsEPGTools {
    constructor(opts){
		super(opts)
        this.debug = false
        this.lists = {}
		this.activeLists = {
			my: [],
			community: [],
			length: 0
		}
		this.epgs = []
        this.myLists = []
        this.communityLists = []
        this.processedLists = new Map()
		this.requesting = {}
		this.loadTimes = {}
		this.processes = []
		this.satisfied = false
		this.isFirstRun = !global.config.get('communitary-mode-lists-amount') && !global.config.get('lists').length

		const { default: PQueue } = require('p-queue')
		this.queue = new PQueue({ concurrency: 2 })
		global.config.on('change', keys => {
			keys.includes('lists') && this.configChanged()
		})
		global.rendererReady(() => {
			global.channels.on('channel-grid-updated', keys => {
				this._relevantKeywords = null
			})
		})	
        this.on('satisfied', () => {
            if(this.activeLists.length){
                this.queue._concurrency = 1 // try to change pqueue concurrency dinamically
            }
        })

		const Loader = require('./loader')
		const Manager = require('./manager')
        this.loader = new Loader(this)
        this.manager = new Manager(this)
		this.configChanged()
	}
	getAuthURL(listUrl) {
		if(listUrl && this.lists[listUrl] && this.lists[listUrl].index && this.lists[listUrl].index.meta && this.lists[listUrl].index.meta['auth-url']) {
			return this.lists[listUrl].index.meta['auth-url']
		}
		return listUrl
	}
	configChanged(){
		const myLists = global.config.get('lists').map(l => l[1])
		const newLists = myLists.filter(u => !this.myLists.includes(u))
		const rmLists = this.myLists.filter(u => !myLists.includes(u))
		this.myLists = myLists
		rmLists.forEach(u => this.remove(u))
		this.loadCachedLists(newLists) // load them up if cached
	}
	async isListCached(url){
		const fs = require('fs')
		let err, file = global.storage.resolve(LIST_DATA_KEY_MASK.format(url))
		const stat = await fs.promises.stat(file).catch(e => err = e)
		return (stat && stat.size >= 1024)
	}
	async filterCachedUrls(urls){
		if(this.debug) console.log('filterCachedUrls', urls.join("\r\n"))
		let loadedUrls = [], cachedUrls = []
		urls = urls.filter(u => {
			if(typeof(this.lists[u]) == 'undefined'){
				return true
			}
			loadedUrls.push(u)
		})
		if(urls.length){
			const pLimit = require('p-limit')
			const limit = pLimit(8), tasks = urls.map(url => {
				return async () => {
					let err
					const has = await this.isListCached(url).catch(e => err = e)
					if(this.debug) console.log('filterCachedUrls', url, has)
					if(has === true){
						cachedUrls.push(url)
						if(!this.requesting[url]){
							this.requesting[url] = 'cached, not added'
						}
					} else {					
						if(!this.requesting[url]){
							this.requesting[url] = err || 'not cached'
						}
					}
				}
			}).map(limit)
			await Promise.allSettled(tasks).catch(console.error)
		}
		if(this.debug) console.log('filterCachedUrls', loadedUrls.join("\r\n"), cachedUrls.join("\r\n"))
		loadedUrls.push(...cachedUrls)
		return loadedUrls
	}
	updaterFinished(isFinished){
		this.isUpdaterFinished = isFinished
		return this.isUpdaterFinished
	}
    async relevantKeywords(refresh) { // pick keywords that are relevant for the user, it will be used to choose community lists
		if(!refresh && Array.isArray(this._relevantKeywords) && this._relevantKeywords.length) return this._relevantKeywords
        const badTerms = ['m3u8', 'ts', 'mp4', 'tv', 'channel']
        const search = require('../search')
		const history = require('../history')
        let terms = [], addTerms = (tms, score) => {
            if(typeof(score) != 'number'){
                score = 1
            }
            tms.forEach(term => {
                if(badTerms.includes(term)){
                    return
                }
                const has = terms.some((r, i) => {
                    if(r.term == term){
                        terms[i].score += score
                        return true
                    }
                })
                if(!has){
                    terms.push({term, score})
                }
            })
        }
        const searchHistoryPromise = search.history.terms().then(sterms => {
			if(sterms.length){ // searching terms history
				sterms = sterms.slice(-24)
				sterms = sterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
				addTerms(sterms)
			}
		})
        const channelsPromise = global.channels.keywords().then(addTerms)
		const bookmarks = require('../bookmarks')
        let bterms = bookmarks.get()
        if(bterms.length){ // bookmarks terms
            bterms = bterms.slice(-24)
            bterms = bterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(bterms)
        }
        let hterms = history.get()
        if(hterms.length){ // user history terms
            hterms = hterms.slice(-24)
            hterms = hterms.map(e => channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(hterms)
        }
        const max = Math.max(...terms.map(t => t.score))
        let cterms = global.config.get('interests')
        if(cterms){ // user specified interests
            cterms = this.terms(cterms, true).filter(c => c[0] != '-')
            if(cterms.length){
                addTerms(cterms, max)
            }
        }
		await Promise.allSettled([searchHistoryPromise, channelsPromise])
        terms = terms.sortByProp('score', true).map(t => t.term)
        if(terms.length > 24) {
            terms = terms.slice(0, 24)
        }
		this._relevantKeywords = terms
        return terms
    }
	setCommunityLists(communityLists){
		 // communityLists for reference (we'll use it to calc lists loading progress)
		communityLists.forEach(url => {
			if(!this.communityLists.includes(url)){
				this.communityLists.push(url)
			}
		})
		return true
	}
	async loadCachedLists(lists){
        let hits = 0
        if(this.debug){
            console.log('Checking for cached lists...', lists)
        }
		if(!lists.length) return hits
		lists.forEach(url => {
            if(!this.loadTimes[url]){
                this.loadTimes[url] = {}
            }
            this.loadTimes[url].sync = global.time()
        })
        lists = await this.filterCachedUrls(lists)
        lists.forEach(url => {
            if(!this.loadTimes[url]){
                this.loadTimes[url] = {}
            }
            this.loadTimes[url].filtered = global.time()
        })
        this.delimitActiveLists() // helps to avoid too many lists in memory
        for(let url of lists) {
            if(typeof(this.lists[url]) == 'undefined') {
				hits++
                this.addList(url, this.myLists.includes(url) ? 1 : 9)
            }
        }
        if(this.debug){
            console.log('sync ended')
        }
        return hits
    }
	status(url=''){
		let progress = 0, firstRun = this.isFirstRun, satisfyAmount = this.myLists.length				
		const isUpdatingFinished = this.isUpdaterFinished && !this.queue._pendingCount
		const communityListsAmount = global.config.get('communitary-mode-lists-amount')
		const progresses = this.myLists.map(url => this.lists[url] ? this.lists[url].progress() : 0)
		if(communityListsAmount > satisfyAmount){
			satisfyAmount = communityListsAmount
		}
		if(satisfyAmount > 8){ // 8 lists are surely enough to start tuning
			satisfyAmount = 8
		}
		if(isUpdatingFinished || !satisfyAmount){
			progress = 100
		} else {
			const communityListsQuota = communityListsAmount - this.myLists.length
			if(communityListsQuota){
				let ls = Object.values(this.lists)
				if(global.config.get('public-lists') != 'only') {
					ls = ls.filter(l => l.origin != 'public')
				}
				progresses.push(
					...ls.map(l => l.progress() || 0).sort((a, b) => b - a).slice(0, communityListsQuota)
				)
				const left = communityListsQuota - progresses.length
				if(left > 0) {
					progresses.push(
						...Object.keys(this.loader.progresses).filter(u => !this.lists[u]).map(u => this.loader.progresses[u]).sort((a, b) => b - a).slice(0, left)
					)
				}
			}
			const allProgress = satisfyAmount * 100
			const sumProgress = progresses.reduce((a, b) => a + b, 0)
			progress = Math.min(100, parseInt(sumProgress / (allProgress / 100)))
		}
		if(this.debug){
			console.log('status() progresses', progress)
		}
		const ret = {
			url,
			progress,
			firstRun,
			satisfyAmount,
			communityListsAmount,
			isUpdatingFinished: this.isUpdaterFinished,
			pendingCount: this.queue._pendingCount,
			length: Object.values(this.lists).filter(l => l.isReady).length
		}
		if(progress > 99) {
			if(!this.satisfied) {
				this.satisfied = true
				this.emit('satisfied', ret)
			}
		} else {
			if(this.satisfied) {
				this.satisfied = false
				this.emit('unsatisfied', ret)
			}
		}
		this.emit('status', ret)
		return ret
	}
	loaded(isEnough){
		if(isEnough === true) {
			if(global.config.get('public-lists') != 'only' && !Object.values(this.lists).filter(l => l.origin != 'public').length) {
				return false
			}
		}
		const stat = this.status(), ret = stat.progress > 99
		return ret
	}
	addList(url, priority=9){
		let cancel, started, done
		this.processes.push({
			promise: this.queue.add(async () => {
				if(cancel) return
				let err, contentLength
				if(typeof(this.lists[url]) == 'undefined'){
					contentLength = await this.getListContentLength(url)
					if(cancel) return
					await this.loadList(url, contentLength).catch(e => err = e)
				} else {
					let contentLength = await this.shouldReloadList(url)
					if(cancel) return
					if(typeof(contentLength) == 'number'){
						console.log('List got updated, reload it. '+ this.lists[url].contentLength +' => '+ contentLength)
						await this.loadList(url, contentLength).catch(e => err = e)
					} else {
						err = 'no need to update'
					}
				}
				done = true
			}, { priority }),
			started: () => started,
			cancel: () => cancel = true,
			done: () => done || cancel,
			priority,
			url
		})
	}
	async loadList(url, contentLength){
		url = global.forwardSlashes(url)
		this.processedLists.has(url) || this.processedLists.set(url, null)
		if(typeof(contentLength) != 'number'){ // contentLength controls when the list should refresh
			let err
			const meta = await this.getListMeta(url).catch(e => err = e)
			if(err){
				console.error(err)
				contentLength = 0 // ok, give up and load list anyway
			} else {
				contentLength = meta.contentLength
				if(typeof(contentLength) != 'number'){
					contentLength = 0 // ok, give up and load list anyway
				}
			}
		}
		let err, defaultOrigin, isMine = this.myLists.includes(url)
		if(this.debug){
			console.log('loadList start', url)
		}
		if(!this.loadTimes[url]){
			this.loadTimes[url] = {}
		} else {
			if(this.lists[url]) {
				defaultOrigin = this.lists[url].origin
			}
			this.remove(url)
		}
		this.loadTimes[url].adding = global.time()
		this.requesting[url] = 'loading'
		
		const List = require('./list')
		const list = new List(url, this)
		list.skipValidating = true // list is already validated at lists/updater-worker, always
		list.contentLength = contentLength
		if(isMine) {
			list.origin = 'own'
		} else {
			const discovery = require('../discovery')
			list.origin = discovery.details(url, 'type') || defaultOrigin || ''
		}
		list.once('destroy', () => {
			if(!this.requesting[url] || (this.requesting[url] == 'loading')) {
				this.requesting[url] = 'destroyed'
			}
			if(isMine && this.myLists.includes(url)){ // isMine yet?
				console.error('Damn! My list got destroyed!', url)
			}
			this.remove(url)
		})
		this.lists[url] = list
		await list.start().catch(e => err = e)
		if(err){
			this.processedLists.delete(url)
			this.loadTimes[url].synced = global.time()
			if(!this.requesting[url] || this.requesting[url] == 'loading'){
				this.requesting[url] = String(err)
			}
			console.warn('loadList error: ', err)
			if(this.lists[url] && !this.myLists.includes(url)){
				this.remove(url)												
			}
			this.updateActiveLists()
			throw err
		} else {
			this.loadTimes[url].synced = global.time()
			if(this.debug){
				console.log('loadList started', url)
			}
			let repeated, expired
			if(!this.lists[url] || (!isMine &&
				(expired=this.seemsExpiredList(this.lists[url])) || (repeated=this.isRepeatedList(url))
				)) {
				if(!this.requesting[url] || this.requesting[url] == 'loading'){
					this.requesting[url] = repeated ? 'repeated at '+ repeated : (expired ? 'seems expired, destroyed' : 'loaded, but destroyed')
				}
				if(this.debug){
					if(repeated){
						console.log('List '+ url +' repeated, discarding.')
					} else {
						console.log('List '+ url +' already discarded.')
					}
				}
				throw 'list discarded'
			} else {	
				if(this.debug){
					console.log('loadList else', url)
				}
				this.setListMeta(url, list.index.meta).catch(console.error)
				if(list.index.meta['epg'] && !this.epgs.includes(list.index.meta['epg'])){
					this.epgs.push(list.index.meta['epg'])
				}
				if(this.debug){
					console.log('loadList else', url)
				}			
				const contentAlreadyLoaded = await this.isSameContentLoaded(list)
				if(this.debug){
					console.log('loadList contentAlreadyLoaded', contentAlreadyLoaded)
				}			
				if(contentAlreadyLoaded){
					this.requesting[url] = 'content already loaded'
					if(this.debug){
						console.log('Content already loaded', url)
					}
					if(this.debug){
						console.log('loadList end: already loaded')
					}
					throw 'content already loaded'
				} else {
					let replace
					this.requesting[url] = 'added'
					if(!isMine && this.loadedListsCount('community') > (this.myLists.length + global.config.get('communitary-mode-lists-amount'))){
						replace = this.shouldReplace(list)
						if(replace){
							const pr = this.lists[replace].relevance.total
							if(this.debug){
								console.log('List', url, list.relevance.total, 'will replace', replace, pr)
							}
							this.remove(replace)
							this.requesting[replace] = 'replaced by '+ url +', '+ pr +' < '+ list.relevance.total
							this.requesting[url] = 'added in place of '+ replace +', '+ pr +' < '+ list.relevance.total
						}
					}
					if(this.debug){
						console.log('Added community list...', url, list.index.length)
					}
					if(!replace){
						this.delimitActiveLists()
					}
					this.searchMapCacheInvalidate()
				}
			}
		}
		this.delimitActiveLists()
		this.updateActiveLists()
		this.status(url)
		return true
	}
	async getListContentLength(url){
		const updateMeta = await this.getListMeta(url)
        return updateMeta.contentLength
	}
	async shouldReloadList(url){
		let loadedContentLength = this.lists[url].contentLength
		const updatedContentLength = await this.getListContentLength(url)
		if(updatedContentLength > 0 && updatedContentLength == loadedContentLength){
			return false
		} else {
			return updatedContentLength
		}
	}
	shouldReplace(list){
		if(!list){
			console.error('shouldReplace error: no list given', list)
			return
		}
		let weaker
		Object.keys(this.lists).forEach(k => {
			if(this.myLists.includes(k) || !this.lists[k].isReady) return
			if(!weaker || (this.lists[k].relevance.total > -1 && this.lists[k].relevance.total < this.lists[weaker].relevance.total)){
				weaker = k
			}
		})
		if(weaker && this.lists[weaker] && this.lists[weaker].relevance.total < list.relevance.total){
			return weaker
		}
	}
	isRepeatedList(url){
		if(!url || !this.lists[url] || !this.lists[url].index || this.myLists.includes(url)){
			return
		}
		let dup
		Object.keys(this.lists).some(k => {
			if(k == url || !this.lists[k].index){
				return
			}
			if(this.lists[k].index.length == this.lists[url].index.length){
				if(JSON.stringify(this.lists[k].index.length) == JSON.stringify(this.lists[url].index.length)) {
					dup = k
					return true
				}
			}
		})
		return dup
	}
	seemsExpiredList(list){ // check if links are all pointing to some few URLs
		if(!list || !list.index){
			return
		}
		if(list.isReady && !list.index.length) return true // loaded with no content
		if(this.loader.results[list.url]){
            const ret = String(this.loader.results[list.url] || '')
            if(ret.startsWith('failed') && ['401', '403', '404', '410'].includes(ret.substr(-3))) {
				return true
			}
        }
        const quota = list.index.length  * 0.7
		if(list.index.uniqueStreamsLength && list.index.uniqueStreamsLength < quota) {
			return true
		}
	} 
    async isListExpired(url, test){
        if(!this.lists[url]) return false
		if(this.seemsExpiredList(this.lists[url])) return true
        if(!test) return false
        let err
        this.lists[url].skipValidating = false
		const connectable = await this.lists[url].verifyListQuality().catch(e => err = e)
        return err || !connectable
    }
	async isSameContentLoaded(list){
		let err, alreadyLoaded, listDataFile = list.file, listIndexLength = list.index.length
		const fs = require('fs')
		const stat = await fs.promises.stat(listDataFile).catch(e => err = e)
		if(err || stat.size == 0){
			return true // force this list discarding
		} else {
			const size = stat.size
			const pLimit = require('p-limit')
			const limit = pLimit(3)
			const tasks = Object.keys(this.lists).map(url => {
				return async () => {
					if(!alreadyLoaded && url != list.url && this.lists[url] && this.lists[url].index.length == listIndexLength){
						let err
						const f = this.lists[url].file
						const a = await fs.promises.stat(f).catch(e => err = e)
						if(!err && !alreadyLoaded){
							if(this.debug){
								console.log('already loaded', list.url, url, f, listDataFile, size, s.size)
							}
							if(size == s.size){
								alreadyLoaded = true
							}
						}
					}
				}
			}).map(limit)
			await Promise.allSettled(tasks)
			return alreadyLoaded
		}
	}
	loadedListsCount(origin){
		const loadedLists = Object.values(this.lists).filter(l => l.isReady).filter(l => {
			return !origin || (origin == l.origin)
		}).map(l => l.url)
		return loadedLists.length
	}
    updateActiveLists(){
		let communityUrls = Object.keys(this.lists).filter(u => !this.myLists.includes(u))
		this.activeLists = {
			my: this.myLists,
			community: communityUrls,
			length: this.myLists.length + communityUrls.length
		}
    }
	getMyLists(){
		const hint = global.config.get('communitary-mode-lists-amount')
        return global.config.get('lists').map(c => {
			const url = c[1]
			const e = {
				name: c[0],
				owned: true,
				url
			}
			if(this.lists[url] && this.lists[url].relevance){
				e.score = this.lists[url].relevance.total
				if(this.lists[url].index.meta){
					e.name = this.lists[url].index.meta.name
					e.icon = this.lists[url].index.meta.icon
					e.epg = this.lists[url].index.meta.epg
				}
				e.length = this.lists[url].index.length
			}
			if(c.length > 2){
				Object.keys(c[2]).forEach(k => {
					e[k] = c[2][k]
				})
			}
			if(typeof(e['private']) == 'undefined'){
				e['private'] = !hint
			}
			return e
		})
	}
    info(includeNotReady){
        const info = {}
		Object.keys(this.lists).forEach(url => {
			if(info[url] || (!includeNotReady && !this.lists[url].isReady)) return
			info[url] = {url, owned: false}
			info[url].score = this.lists[url].relevance.total
			info[url].length = this.lists[url].index.length
			if(this.lists[url].index.meta){
				info[url].name = this.lists[url].index.meta.name
				info[url].icon = this.lists[url].index.meta.icon
				info[url].epg = this.lists[url].index.meta.epg
			}
			info[url].private = false // communitary list
		})
		this.getMyLists().forEach(l => { // include my own lists, even when not loaded yet
			if(!info[l.url]) info[l.url] = l
			info[l.url].owned = true
			info[l.url].private = l.private
		})
		return info
    }
	isPrivateList(url){
		let ret
		this.getMyLists().some(l => {
			if(l.url == url){
				ret = l.private
				return true
			}
		})
		return ret
	}
	delimitActiveLists(){
        const publicListsActive = global.config.get('public-lists')
        const communityListsAmount = global.config.get('communitary-mode-lists-amount')
		const communityListsQuota = Math.max(communityListsAmount - this.myLists.length, 0)
		if(this.loadedListsCount('community') > communityListsQuota){
			let results = {}
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), communityListsQuota)
			}
			Object.keys(this.lists).forEach(url => {
				if(!this.myLists.includes(url) && this.lists[url].origin == 'community'){
					results[url] = this.lists[url].relevance.total
				}
			})
			let sorted = Object.keys(results).sort((a, b) => results[b] - results[a])
			sorted.slice(communityListsQuota).forEach(u => {
				if(this.lists[u]){
					this.requesting[u] = 'destroyed on delimiting (relevance: '+ this.lists[u].relevance.total +'), '+ JSON.stringify(global.traceback()).replace(new RegExp('[^A-Za-z0-9 /:]+', 'g'), ' ')
					this.remove(u)
				}
			})
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), communityListsQuota, results, sorted)
			}
		}
		if(!publicListsActive) {
			let results = {}
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), publicListsActive)
			}
			Object.keys(this.lists).forEach(url => {
				if(!this.myLists.includes(url) && this.lists[url].origin == 'public'){
					this.requesting[url] = 'destroyed on delimiting (public lists disabled), '+ JSON.stringify(global.traceback()).replace(new RegExp('[^A-Za-z0-9 /:]+', 'g'), ' ')
					this.remove(url)
				}
			})
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), publicListsActive)
			}
		}
	}
	remove(u){
		this.processes = this.processes.filter(p => {
			const found = p.url == u
			found && p.cancel()
			return !found
		})
		if(typeof(this.lists[u]) != 'undefined'){
			this.searchMapCacheInvalidate(u)
			this.lists[u].destroy()
			delete this.lists[u]
			if(this.debug){
				console.log('Removed list', u)
			}
			this.updateActiveLists()
		}
	}
    async directListRenderer(v, opts={}){
        if(typeof(this.lists[v.url]) != 'undefined' && (!opts.fetch || (this.lists[v.url].isReady && !this.lists[v.url].indexer.hasFailed))){ // if not loaded yet, fetch directly
            let entries
			if(opts.expand) {
				entries = await this.lists[v.url].fetchAll()
			} else {
				entries = await this.lists[v.url].getMap()
			}
            return this.directListRendererPrepare(entries, v.url)
        } else if(opts.fetch) {
            let entries, fetcher = new this.Fetcher(v.url, {
				progress: opts.progress
			}, this)
			if(opts.expand) {
				entries = await fetcher.fetch()
			} else {
				entries = await fetcher.getMap()
			}
            return await this.directListRendererPrepare(entries, v.url)
        } else {
			throw 'List not loaded'
		}
    }
    async directListRendererPrepare(list, url){
		if(typeof(this.directListRendererPrepareCache) == 'undefined'){
			this.directListRendererPrepareCache = {}
		}
		const cachettl = 3600, now = global.time(), olen = list.length
		if(typeof(this.directListRendererPrepareCache[url]) != 'undefined' && this.directListRendererPrepareCache[url].size == olen && this.directListRendererPrepareCache[url].time > (now - cachettl)){
			return this.directListRendererPrepareCache[url].list.slice(0) // clone it
		}
		if(list.length){
			list = this.parentalControl.filter(list, true)
			list = this.prepareEntries(list)
			list = await this.tools.deepify(list,  {source: url})
		}
		if(olen >= this.opts.offloadThreshold){
			this.directListRendererPrepareCache[url] = {list, time: now, size: olen}
		}
		return list.slice(0) // clone it to not alter cache
    }
	isLocal(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	async setNetworkConnectionState(state){
        global.Download.setNetworkConnectionState(state)
		return true
	}
}

module.exports = new Lists()
