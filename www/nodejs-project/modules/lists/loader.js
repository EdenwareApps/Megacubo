const path = require('path'), Events = require('events'), { default: PQueue } = require('p-queue')

class ListsLoader extends Events {
    constructor(master, opts) {
        super()
        this.master = master
        this.opts = opts || {}
        this.queue = new PQueue({ concurrency: 3 })
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
                this.myCurrentLists = newMyLists
                this.enqueue(added, 1)
            }
            if(keys.includes('communitary-mode-lists-amount')){
                if(this.communityListsAmount != data['communitary-mode-lists-amount']){
                    this.communityListsAmount = data['communitary-mode-lists-amount']
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
        this.resetLowPriorityUpdates()
    }
    async resetLowPriorityUpdates(){ // load community lists
        const maxToTry = (this.communityListsAmount * 2) - this.master.processedLists.length
        if(maxToTry <= 0) return

        const taskId = Math.random()
        this.currentTaskId = taskId
        this.master.updaterFinished(false)
        this.processes = this.processes.filter(p => {
            /* Cancel pending processes to reorder it */
            if(p.priority > 1 && !p.started() && !this.myCurrentLists.includes(p.url)) {
                p.cancel()
                return false
            }
            return true
        })

        const lists = await global.discovery.get(maxToTry * 2) // query a bit more to filter it
        const communityLists = []
        lists.some(({ url }) => {
            if( !this.myCurrentLists.includes(url) && 
                !this.processes.some(p => p.url == url) && 
                !this.master.processedLists.includes(url)) {
                    communityLists.push(url)
                    return communityLists.length == maxToTry
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
        if(!this.updater || this.updater.finished === true){
            const updater = this.updater = global.workers.load(path.join(__dirname, 'updater-worker'))
            this.updaterClients = 1
            updater.close = () => {
                this.updaterClients--
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
    enqueue(urls, priority=9){
        if(priority == 1){ // priority=1 should be reprocessed, as it is in our lists            
            urls = urls.filter(url => {
                return this.myCurrentLists.includes(url) // list still added
            })
        } else {
            urls = urls.filter(url => {
                return !this.processes.some(p => p.url == url) // already processing/processed
            })
        }
        urls.forEach(url => {
            let cancel, started
            this.processes.push({
                promise: this.queue.add(async () => {
                    await global.Download.waitNetworkConnection()
                    if(cancel) return
                    started = true
                    await this.prepareUpdater()
                    this.results[url] = await this.updater.update(url).catch(console.error)
                    const add = this.results[url] == 'updated' || (this.results[url] == 'already updated' && !this.master.processedLists.includes(url))
                    add && this.master.addList(url)
                    this.updater.close()
                }, { priority }),
                started: () => {
                    return started
                },
                cancel: () => cancel = true,
                priority,
                url
            })
        })
    }
    async reload(url){
        let updateErr
        await this.prepareUpdater()
        this.results[url] = await this.updater.updateList(url, true).catch(err => updateErr = err)
        if(updateErr) throw updateErr
        await this.master.loadList(url).catch(err => updateErr = err)
        if(updateErr) throw updateErr
        return true
    }
}

module.exports = ListsLoader
