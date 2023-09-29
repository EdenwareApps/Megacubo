const path = require('path'), Events = require('events')
const { default: PQueue } = require('p-queue'), ConnRacing = require('../conn-racing')

class ListsLoader extends Events {
    constructor(master, opts) {
        super()
        const concurrency = 4 // avoid too many concurrency on mobiles
        this.master = master
        this.opts = opts || {}
        this.queue = new PQueue({ concurrency })
        this.osdID = 'lists-loader'
        this.tried = 0
        this.results = {}
        this.processes = []
        this.myCurrentLists = global.config.get('lists').map(l => l[1])
        this.communityListsAmount = global.config.get('communitary-mode-lists-amount')
        this.enqueue(this.myCurrentLists, 1)
        global.uiReady(async () => {
            global.discovery.on('found', () => this.resetLowPriorityUpdates())
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
        this.processes = this.processes.filter(p => {
            /* Cancel pending processes to reorder it */
            if(p.priority > 1 && !p.started() && !p.done()) {
                p.cancel()
                return false
            }
            return true
        })

        if(!this.communityListsAmount) return

        const maxListsToTry = 72
        const minListsToTry = Math.max(32, 3 * this.communityListsAmount)
        if(minListsToTry < this.master.processedLists.size) return

        const taskId = Math.random()
        this.currentTaskId = taskId
        this.master.updaterFinished(false)

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
        const communityListsCached = await this.master.filterCachedUrls(communityLists)
        this.enqueue(communityLists.filter(u => !communityListsCached.includes(u)).concat(communityListsCached)) // update uncached lists first
        this.master.loadCachedLists(communityListsCached)
        this.queue.onIdle().catch(console.error).finally(() => {
            if(this.currentTaskId == taskId) this.master.updaterFinished(true)
        })
    }
    async prepareUpdater(){
        if(!this.updater || this.updater.finished === true) {
            const MultiWorker = require('../multi-worker')
            this.worker = new MultiWorker()
            const updater = this.updater = this.worker.load(path.join(__dirname, 'updater-worker'))
            this.once('destroy', () => updater.terminate())
            this.updaterClients = 1
            updater.close = () => {
                if(this.updaterClients > 0){
                    this.updaterClients--
                }
                if(!this.updaterClients && !this.updater.terminating){
                    this.updater.terminating = setTimeout(() => {
                        console.error('Terminating updater worker')
                        updater.terminate()
                        this.updater = null
                    }, 5000)
                }
            }
            const keywords = await this.master.relevantKeywords()
            updater.setRelevantKeywords(keywords).catch(console.error)
        } else {
            this.updaterClients++
            if(this.updater.terminating) {
                clearTimeout(this.updater.terminating)
                this.updater.terminating = null
            }
        }
    }
    async enqueue(urls, priority=9){
        if(priority == 1){ // priority=1 should be reprocessed, as it is in our lists            
            urls = urls.filter(url => {
                return this.myCurrentLists.includes(url) // list still added
            })
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
    async addListNow(url, progress) {
        const uid = parseInt(Math.random() * 1000000)
        const progressListener = p => {
            if(p.progressId == uid) progress(p.progress)
        }
        await global.Download.waitNetworkConnection()
        await this.prepareUpdater()
        progress && this.updater.on('progress', progressListener)
        await this.updater.update(url, false, uid).catch(console.error)
        progress && this.updater.removeListener('progress', progressListener)
        this.updater && this.updater.close && this.updater.close()  
        this.master.addList(url, 1)
    }
    schedule(url, priority){
        let cancel, started, done
        this.processes.some(p => p.url == url) || this.processes.push({
            promise: this.queue.add(async () => {
                await global.Download.waitNetworkConnection()
                if(cancel) return
                started = true
                await this.prepareUpdater()
                this.results[url] = 'awaiting'
                this.results[url] = await this.updater.update(url, false).catch(console.error)
                this.updater && this.updater.close && this.updater.close()
                done = true
                const add = this.results[url] == 'updated' || (this.results[url] == 'already updated' && !this.master.processedLists.has(url))
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
    async reload(url){
        let updateErr
        const progressId = 'reloading-'+ parseInt(Math.random() * 1000000)
        const progressListener = p => {
            if(p.progressId == progressId) {
                global.osd.show(global.lang.RECEIVING_LIST +' '+ p.progress +'%', 'fas fa-circle-notch fa-spin', 'progress-'+ progressId, 'persistent')
            }
        }
        progressListener({progressId, progress: 0})
        await this.prepareUpdater()
        this.updater.on('progress', progressListener)
        this.results[url] = 'reloading'       
        this.results[url] = await this.updater.updateList(url, true, progressId).catch(err => updateErr = err)
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
