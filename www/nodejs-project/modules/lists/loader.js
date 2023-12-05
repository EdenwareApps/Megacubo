const path = require('path'), Events = require('events')
const { default: PQueue } = require('p-queue'), ConnRacing = require('../conn-racing')

class ListsLoader extends Events {
    constructor(master, opts) {
        super()
        const concurrency = global.config.get('lists-loader-concurrency') || 3 // avoid too many concurrency on mobiles
        this.debug = master.debug
        this.master = master
        this.opts = opts || {}
        this.progresses = {}
        this.queue = new PQueue({ concurrency })
        this.osdID = 'lists-loader'
        this.tried = 0
        this.pings = {}
        this.results = {}
        this.processes = []
        this.myCurrentLists = global.config.get('lists').map(l => l[1])
        this.communityListsAmount = global.config.get('communitary-mode-lists-amount')
        this.enqueue(this.myCurrentLists, 1)
        global.uiReady(async () => {
            global.discovery.on('found', () => this.resetLowPriorityUpdates())
            global.streamer.on('commit', () => this.pause())
            global.streamer.on('stop', () => {
                setTimeout(() => {
                    global.streamer.active || this.resume()
                }, 2000) // wait 2 seconds, maybe user was just switching channels
            })
            this.resetLowPriorityUpdates()
        })
        global.config.on('change', (keys, data) => {
            if(keys.includes('lists')){
                const newMyLists = data.lists.map(l => l[1])
                const added = newMyLists.filter(l => !this.myCurrentLists.includes(l))
                const removed = this.myCurrentLists.filter(l => !newMyLists.includes(l))
                removed.forEach(u => this.master.remove(u))
                newMyLists.forEach(u => {
                    this.master.processedLists.has(u) && this.master.processedLists.delete(u)
                })
                this.myCurrentLists = newMyLists
                this.enqueue(added, 1)
            }
            if(keys.includes('communitary-mode-lists-amount')){
                if(this.communityListsAmount != data['communitary-mode-lists-amount']){
                    this.communityListsAmount = data['communitary-mode-lists-amount']
                    this.master.processedLists.clear()
                    this.resetLowPriorityUpdates()
                    if(!data['communitary-mode-lists-amount']) { // unload community lists
                        const myLists = data.lists.map(l => l[1])
                        const loadedLists = Object.keys(this.master.lists)
                        this.master.processes.forEach(p => {
                            if(!myLists.includes(p.url)) p.cancel()
                        })
                        this.master.delimitActiveLists()
                    }
                }
            }
        })
        this.master.on('satisfied', () => {
            if(this.master.activeLists.length){
                this.queue._concurrency = 1 // try to change pqueue concurrency dinamically
                this.resetLowPriorityUpdates()
            }
        })
        this.master.on('unsatisfied', () => {
            this.queue._concurrency = concurrency // try to change pqueue concurrency dinamically
            this.resetLowPriorityUpdates()
        })
        this.resetLowPriorityUpdates()
    }
    async resetLowPriorityUpdates(){ // load community lists
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates()', this.communityListsAmount)
        this.processes = this.processes.filter(p => {
            /* Cancel pending processes to reorder it */
            if(p.priority > 1 && !p.started() && !p.done()) {
                p.cancel()
                return false
            }
            return true
        })

        if(!this.communityListsAmount) return

        const maxListsToTry = Math.max(72, this.communityListsAmount)
        const minListsToTry = Math.max(32, 3 * this.communityListsAmount)
        if(minListsToTry < this.master.processedLists.size) return

        const taskId = Math.random()
        this.currentTaskId = taskId
        this.master.updaterFinished(false)

        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(1)')
        const lists = await global.discovery.get(maxListsToTry)
        const communityLists = []
        lists.some(({ url }) => {
            if( !this.myCurrentLists.includes(url) && 
                !this.processes.some(p => p.url == url) && 
                !this.master.processedLists.has(url)) {
                    communityLists.push(url)
                    return communityLists.length == maxListsToTry
                }
        })
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(2)')
        const communityListsCached = await this.master.filterCachedUrls(communityLists)
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(3)')
        this.enqueue(communityLists.filter(u => !communityListsCached.includes(u)).concat(communityListsCached)) // update uncached lists first
        this.master.loadCachedLists(communityListsCached)
        this.queue.onIdle().catch(console.error).finally(() => {
            setTimeout(() => {
                if(this.currentTaskId == taskId && !this.queue._pendingCount) {
                    this.master.updaterFinished(true)
                }
                this.master.status()
            }, 2000)
        })
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(4)')
    }
    async prepareUpdater(){
        if(!this.updater || this.updater.finished === true) {
            this.debug && console.error('[listsLoader] Creating updater worker')
            const MultiWorker = require('../multi-worker')
            this.worker = new MultiWorker()
            const updater = this.updater = this.worker.load(path.join(__dirname, 'updater-worker'))
            this.once('destroy', () => updater.terminate())
            this.updaterClients = 1
            this.updater.on('progress', p => {
                if(!p || !p.url) return
                this.progresses[p.url] = p.progress
                this.emit('progresses', this.progresses)
            })            
            updater.close = () => {
                if(this.updaterClients > 0){
                    this.updaterClients--
                }
                if(!this.updaterClients && !this.updater.terminating){
                    this.updater.terminating = setTimeout(() => {
                        console.error('[listsLoader] Terminating updater worker')
                        updater.terminate()
                        this.updater = null
                    }, 5000)
                }
            }
            const keywords = await this.master.relevantKeywords()
            updater.setRelevantKeywords(keywords).catch(console.error)
            this.debug && console.error('[listsLoader] Updater worker created, relevant keywords: '+ keywords.join(', '))
        } else {
            this.updaterClients++
            if(this.updater.terminating) {
                clearTimeout(this.updater.terminating)
                this.updater.terminating = null
            }
        }
    }
    async enqueue(urls, priority=9){
        if(priority == 1){ // priority=1 should be reprocessed, as it is in our private lists            
            urls = urls.filter(url => this.myCurrentLists.includes(url)) // list still added
        } else {
            urls = urls.filter(url => {
                return !this.processes.some(p => p.url == url) // already processing/processed
            })
        }
        if(!urls.length) return
        for(const url of urls) {
            this.schedule(url, priority)
        }
    }
    async enqueue(urls, priority=9){
        if(priority == 1){ // priority=1 should be reprocessed, as it is in our lists            
            urls = urls.filter(url => this.myCurrentLists.includes(url)) // list still added
        } else {
            urls = urls.filter(url => {
                return !this.processes.some(p => p.url == url) // already processing/processed
            })
        }
        this.debug && console.error('[listsLoader] enqueue: '+ urls.join("\n"))
        if(!urls.length) return
        if(priority == 1) { // my lists should be always added regardless if it's connectable
            for(const url of urls) {
                this.schedule(url, priority)
            }
            return
        }
        let already = []
        urls = urls.filter(url => {
            if(typeof(this.pings[url]) == 'undefined'){
                return true
            }
            if(this.pings[url] > 0) { // if zero, is loading yet
                already.push({url, time: this.pings[url]})
            }
        })
        urls.forEach(u => this.pings[u] = 0)
        already.sortByProp('time').map(u => u.url).forEach(url => this.schedule(url, priority))
        const start = global.time()
        const racing = new ConnRacing(urls, {retries: 1, timeout: 5})
        this.debug && console.error('[listsLoader] enqueue conn racing: '+ urls.join("\n"))
		for(let i=0; i<urls.length; i++) {
            const res = await racing.next().catch(console.error)
            if(res && res.valid) {
                const url = res.url
                const time = global.time() - start
                if(!this.pings[url] || this.pings[url] < time) {
                    this.pings[url] = global.time() - start
                }
                this.schedule(url, priority)
            }            
        }
        urls.filter(u => this.pings[u] == 0).forEach(u => delete this.pings[u])
    }
    async addListNow(url, progress) { // reserved for manual list adding
        const uid = parseInt(Math.random() * 1000000)
        const progressListener = p => {
            if(p.progressId == uid) progress(p.progress)
        }
        await global.Download.waitNetworkConnection()
        await this.prepareUpdater()
        progress && this.updater.on('progress', progressListener)
        await this.updater.update(url, {uid}).catch(console.error)
        progress && this.updater.removeListener('progress', progressListener)
        this.updater && this.updater.close && this.updater.close()  
        this.master.addList(url, 1)
    }
    schedule(url, priority){
        let cancel, started, done
        this.debug && console.error('[listsLoader] schedule: '+ url)
        this.processes.some(p => p.url == url) || this.processes.push({
            promise: this.queue.add(async () => {
                this.debug && console.error('[listsLoader] schedule processing 0: '+ url +' | '+ this.paused)
                started = true
                this.paused && await this.wait()
                this.debug && console.error('[listsLoader] schedule processing 1: '+ url)
                await global.Download.waitNetworkConnection()
                this.debug && console.error('[listsLoader] schedule processing 2: '+ url +' | '+ cancel)
                if(cancel) return
                await this.prepareUpdater()
                this.debug && console.error('[listsLoader] schedule processing 3: '+ url)
                this.results[url] = 'awaiting'
                this.results[url] = await this.updater.update(url).catch(console.error)
                this.debug && console.error('[listsLoader] schedule processing 4: '+ url +' | '+ this.results[url])
                this.updater && this.updater.close && this.updater.close()
                done = true
                const add = this.results[url] == 'updated' || 
                    (this.myCurrentLists.includes(url) && !this.master.lists[url]) ||
                    (this.results[url] == 'already updated' && !this.master.processedLists.has(url))
                add && this.master.addList(url, priority)
            }, { priority }),
            started: () => {
                return started
            },
            cancel: () => cancel = true,
			done: () => done || cancel,
            priority,
            url
        })
    }
    pause() {
        this.paused = true
    }
    resume() {
        this.paused = false
        this.emit('resume')
    }
    wait() {
        return new Promise(resolve => {
            if(!this.paused) return resolve()
            this.once('resume', resolve)
        })
    }
    async reload(url){
        let updateErr
        const file = global.storage.raw.resolve(global.LIST_DATA_KEY_MASK.format(url))
        const progressId = 'reloading-'+ parseInt(Math.random() * 1000000)
        const progressListener = p => {
            if(p.progressId == progressId) {
                global.osd.show(global.lang.RECEIVING_LIST +' '+ p.progress +'%', 'fas fa-circle-notch fa-spin', 'progress-'+ progressId, 'persistent')
            }
        }
        await require('fs').promises.unlink(file).catch(() => {})
        progressListener({progressId, progress: 0})
        await this.prepareUpdater()
        this.updater.on('progress', progressListener)
        this.results[url] = 'reloading'       
        this.results[url] = await this.updater.updateList(url, {
            force: true,
            uid: progressId
        }).catch(err => updateErr = err)
        this.updater && this.updater.close && this.updater.close()
        this.updater.removeListener('progress', progressListener)
        global.osd.hide('progress-'+ progressId)
        if(updateErr) throw updateErr
        await this.master.loadList(url).catch(err => updateErr = err)
        if(updateErr) throw updateErr
        return true
    }
}

module.exports = ListsLoader
