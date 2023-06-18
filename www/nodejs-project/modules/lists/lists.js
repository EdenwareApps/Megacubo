const fs = require('fs'), async = require('async'), path = require('path')
const pLimit = require('p-limit'), { default: PQueue } = require('p-queue')
const Parser = require('./parser'), Manager = require('./manager'), Loader = require('./loader')
const Index = require('./index'), List = require('./list'), MultiWorker = require('../multi-worker')

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
			await this._epg.terminate()
			await this._epgWorker.terminate()
			delete this._epg
			delete this._epgWorker
		}
		console.error('will load epg '+ JSON.stringify(url))
		if(url) {
			// give EPG his own worker, otherwise it may slow down app navigation
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
		if(!this._epg){
			throw 'no epg 0'
		}
		let data
		const { progress, state, error } = await this._epg.getState()
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
	async epgExpandSuggestions(categories){
		if(!this._epg){
			throw 'no epg 1'
		}
		return await this._epg.expandSuggestions(categories)
	}
	async epgSuggestions(categories, until, limit, searchTitles){
		if(!this._epg){
			throw 'no epg 2'
		}
		return await this._epg.getSuggestions(categories, until, limit, searchTitles)
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
		return await this._epg.searchChannel(this.applySearchRedirects(terms))
	}
	async epgSearchChannelIcon(terms){
		if(!this._epg){
			throw 'no epg 5'
		}
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
			const limit = pLimit(3)
			const tasks = Object.keys(this.lists).filter(url => {
				return this.lists[url].index.meta['epg'] == this._epg.url
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
        this.processedLists = []
		this.requesting = {}
		this.loadTimes = {}
		this.processes = []
		this.satisfied = false
		this.isFirstRun = !global.config.get('communitary-mode-lists-amount') && !global.config.get('lists').length
		this.queue = new PQueue({ concurrency: 2 })
		global.config.on('change', keys => {
			keys.includes('lists') && this.configChanged()
		})		
        this.on('satisfied', () => {
            if(this.activeLists.length){
                this.queue._concurrency = 1 // try to change pqueue concurrency dinamically
            }
        })
        this.loader = new Loader(this)
        this.manager = new Manager(this)
		this.configChanged()
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
		let err, file = global.storage.raw.resolve(LIST_DATA_KEY_MASK.format(url))
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
	async updaterFinished(isFinished){
		this.isUpdaterFinished = isFinished
		return this.isUpdaterFinished
	}
    async relevantKeywords(refresh) { // pick keywords that are relevant for the user, it will be used to choose community lists
		if(!refresh && this._relevantKeywords) return this._relevantKeywords
        const badTerms = ['m3u8', 'ts', 'mp4', 'tv', 'channel']
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
        const searchHistoryPromise = global.search.history.terms().then(sterms => {
			if(sterms.length){ // searching terms history
				sterms = sterms.slice(-24)
				sterms = [...new Set(sterms.map(e => global.channels.entryTerms(e)).flat())].filter(c => c[0] != '-')
				addTerms(sterms)
			}
		})
        const channelsPromise = global.channels.keywords().then(addTerms)
        let bterms = global.bookmarks.get()
        if(bterms.length){ // bookmarks terms
            bterms = bterms.slice(-24)
            bterms = [...new Set(bterms.map(e => global.channels.entryTerms(e)).flat())].filter(c => c[0] != '-')
            addTerms(bterms)
        }
        let hterms = global.histo.get()
        if(hterms.length){ // user history terms
            hterms = hterms.slice(-24)
            hterms = [...new Set(hterms.map(e => channels.entryTerms(e)).flat())].filter(c => c[0] != '-')
            addTerms(hterms)
        }
        const max = Math.max(...terms.map(t => t.score))
        let cterms = global.config.get('communitary-mode-interests')
        if(cterms){ // user specified interests
            cterms = this.terms(cterms, false).filter(c => c[0] != '-')
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
		let progress = 0, firstRun = true, satisfyAmount = this.myLists.length				
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
				progresses.push(
					...Object.values(this.lists).map(l => l.progress() || 0).sort((a, b) => b - a).slice(0, communityListsQuota)
				)
			}
			const allProgress = satisfyAmount * 100
			const sumProgress = progresses.reduce((a, b) => a + b, 0)
			progress = Math.min(100, parseInt(sumProgress / (allProgress / 100)))
		}
		if(progress > 99) {
			this.satisfied = true
			this.emit('satisfied')
		} else {
			this.satisfied = false
		}
		if(this.debug){
			console.log('status() progresses', progress)
		}
		const ret = {
			url,
			progress,
			satisfyAmount,
			satisfied: this.satisfied,
			communityListsAmount,
			isUpdatingFinished: this.isUpdaterFinished,
			pendingCount: this.queue._pendingCount,
			firstRun,
			length: Object.values(this.lists).filter(l => l.isReady).length
		}
		this.emit('status', ret)
		return ret
	}
	loaded(){
		return this.status().progress > 99
	}
	addList(url, priority=9){
		let cancelled, started
		console.log('ADDLIST '+ url +' '+ priority +' '+ global.traceback())
		this.processes.push({
			promise: this.queue.add(async () => {
				if(cancelled) return
				let err, contentLength
				if(typeof(this.lists[url]) == 'undefined'){
					contentLength = await this.getListContentLength(url)
					if(cancelled) return
					await this.loadList(url, contentLength).catch(e => err = e)
				} else {
					let contentLength = await this.shouldReloadList(url)
					if(cancelled) return
					if(typeof(contentLength) == 'number'){
						console.log('List got updated, reload it. '+ this.lists[url].contentLength +' => '+ contentLength)
						await this.loadList(url, contentLength).catch(e => err = e)
					} else {
						err = 'no need to update'
					}
				}
			}, { priority }),
			started: () => started,
			cancel: () => cancelled = true,
			priority,
			url
		})
	}
	async loadList(url, contentLength){
		url = global.forwardSlashes(url)
		this.processedLists.includes(url) || this.processedLists.push(url)
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
		let err, isMine = this.myLists.includes(url)
		if(this.debug){
			console.log('loadList start', url)
		}
		if(!this.loadTimes[url]){
			this.loadTimes[url] = {}
		} else {
			this.remove(url)
		}
		this.loadTimes[url].adding = global.time()
		this.requesting[url] = 'loading'		
		const list = new List(url, this)
		list.skipValidating = true // list is already validated at lists/updater-worker, always
		list.contentLength = contentLength
		list.once('destroy', () => {
			if(!this.requesting[url] || (this.requesting[url] == 'loading')){
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
			//console.warn('LOAD LIST FAIL', url, list)
			this.loadTimes[url].synced = global.time()
			if(!this.requesting[url] || this.requesting[url] == 'loading'){
				this.requesting[url] = String(err)
			}
			console.warn('loadList error: ', err)
			if(this.lists[url] && !this.myLists.includes(url)){
				this.remove(url)												
			}
			throw err
		} else {
			this.loadTimes[url].synced = global.time()
			if(this.debug){
				console.log('loadList started', url)
			}
			let repeated
			if(!this.lists[url] || (repeated=this.isRepeatedList(url))) {
				if(!this.requesting[url] || this.requesting[url] == 'loading'){
					this.requesting[url] = repeated ? 'repeated at '+ repeated : 'loaded, but destroyed'
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
				this.isPrivateList(list) || global.discovery.learn(list)
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
					if(!isMine && this.loadedListsCount() > (this.myLists.length + global.config.get('communitary-mode-lists-amount'))){
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
			if(this.myLists.includes(k) || !this.lists[k].isReady){
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
	async isSameContentLoaded(list){
		let err, alreadyLoaded, listDataFile = list.file, listIndexLength = list.index.length
		const stat = await fs.promises.stat(listDataFile).catch(e => err = e)
		if(err || stat.size == 0){
			return true // force this list discarding
		} else {
			const size = stat.size
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
	loadedListsCount(){
		return Object.values(this.lists).filter(l => l.isReady).length
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
        const communityListsAmount = global.config.get('communitary-mode-lists-amount')
		if(this.loadedListsCount() > (this.myLists.length + communityListsAmount)){
			let results = {}
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), communityListsAmount)
			}
			Object.keys(this.lists).forEach(url => {
				if(!this.myLists.includes(url)){
					results[url] = this.lists[url].relevance.total
				}
			})
			let sorted = Object.keys(results).sort((a, b) => results[b] - results[a])
			sorted.slice(communityListsAmount).forEach(u => {
				if(this.lists[u]){
					this.requesting[u] = 'destroyed on delimiting (relevance: '+ this.lists[u].relevance.total +'), '+ JSON.stringify(global.traceback()).replace(new RegExp('[^A-Za-z0-9 /:]+', 'g'), ' ')
					this.remove(u)
				}
			})
			if(this.debug){
				console.log('delimitActiveLists', Object.keys(this.lists), communityListsAmount, results, sorted)
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
    async directListRenderer(v, opts){
        if(typeof(this.lists[v.url]) != 'undefined' && (!opts.fetch || (this.lists[v.url].isReady && !this.lists[v.url].indexer.hasFailed))){ // if not loaded yet, fetch directly
            let entries = await this.lists[v.url].getMap()
            return this.directListRendererPrepare(entries, v.url)
        } else if(opts.fetch) {
            let fetcher = new this.Fetcher(v.url, {
				progress: opts.progress
			}, this), entries = await fetcher.getMap()
            return await this.directListRendererPrepare(entries, v.url)
        } else {
			throw 'List not loaded'
		}
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
    async directListRendererPrepare(list, url){
		if(typeof(this.directListRendererPrepareCache) == 'undefined'){
			this.directListRendererPrepareCache = {}
		}
		const cachettl = 3600, now = global.time(), olen = list.length
		if(typeof(this.directListRendererPrepareCache[url]) != 'undefined' && this.directListRendererPrepareCache[url].size == olen && this.directListRendererPrepareCache[url].time > (now - cachettl)){
			return this.directListRendererPrepareCache[url].list
		}
		if(list.length){
			list = this.tools.dedup(list) // dedup before parentalControl to improve blocking
			list = this.parentalControl.filter(list, true)
			list = this.prepareEntries(list)
			list = await this.tools.deepify(list, url)
		}
		if(olen >= this.opts.offloadThreshold){
			this.directListRendererPrepareCache[url] = {list, time: now, size: olen}
		}
		return list
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
	async setNetworkConnectionState(state){
        global.Download.setNetworkConnectionState(state)
		return true
	}
}

module.exports = Lists
