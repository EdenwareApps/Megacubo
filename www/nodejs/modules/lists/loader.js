import { LIST_DATA_KEY_MASK } from '../utils/utils.js';
import Download from '../download/download.js'
import osd from '../osd/osd.js'
import lang from '../lang/lang.js';
import storage from '../storage/storage.js'
import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import workers from '../multi-worker/main.js';
import ConnRacing from '../conn-racing/conn-racing.js';
import fs from 'fs';
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
//import UpdaterWorker from './updater-worker.js'

class ListsLoader extends EventEmitter {
    constructor(master, opts) {
        super();
        const concurrency = config.get('lists-loader-concurrency') // avoid too many concurrency on mobiles
        this.debug = master.debug;
        this.master = master;
        this.opts = opts || {};
        this.progresses = {};
        this.queue = new PQueue({ concurrency });
        this.osdID = 'lists-loader';
        this.tried = 0;
        this.pings = {};
        this.results = {};
        this.processes = [];
        this.myCurrentLists = config.get('lists').map(l => l[1]);
        this.publicListsActive = config.get('public-lists');
        this.communityListsAmount = config.get('communitary-mode-lists-amount');
        this.enqueue(this.myCurrentLists, 1);
        renderer.ready(async () => {
            this.master.discovery.on('found', () => this.resetLowPriorityUpdates())
            global.streamer.on('commit', () => this.pause());
            global.streamer.on('stop', () => {
                setTimeout(() => {
                    global.streamer.active || this.resume();
                }, 2000); // wait 2 seconds, maybe user was just switching channels
            });
            this.resetLowPriorityUpdates();
        });
        config.on('change', (keys, data) => {
            if (keys.includes('lists')) {
                const newMyLists = data.lists.map(l => l[1])
                const added = newMyLists.filter(l => !this.myCurrentLists.includes(l))
                const removed = this.myCurrentLists.filter(l => !newMyLists.includes(l))
                removed.forEach(u => this.master.remove(u))
                newMyLists.forEach(u => {
                    this.master.processedLists.has(u) && this.master.processedLists.delete(u) // allow reprocessing it
                })
                this.myCurrentLists = newMyLists
                this.enqueue(added, 1)
            }
            if (keys.includes('communitary-mode-lists-amount')) {
                if (this.communityListsAmount != data['communitary-mode-lists-amount']) {
                    this.communityListsAmount = data['communitary-mode-lists-amount'];
                    this.master.processedLists.clear();
                    this.resetLowPriorityUpdates();
                    if (!data['communitary-mode-lists-amount']) { // unload community lists
                        this.cancelProcessesByType('community')
                    }
                }
            }
            if (keys.includes('public-lists')) {
                if (this.publicListsActive != data['public-lists']) {
                    this.publicListsActive = data['public-lists'];
                    this.master.processedLists.clear();
                    this.resetLowPriorityUpdates();
                    if (!data['public-lists']) { // unload public lists
                        this.cancelProcessesByType('public')
                    }
                }
            }
        });
        this.master.on('satisfied', () => {
            if (this.master.activeLists.length) {
                this.queue._concurrency = 1; // try to change pqueue concurrency dinamically
                this.resetLowPriorityUpdates()
            }
        });
        this.master.on('unsatisfied', () => {
            this.queue._concurrency = concurrency; // try to change pqueue concurrency dinamically
            this.resetLowPriorityUpdates()
        });
        this.resetLowPriorityUpdates()
    }
    async cancelProcessesByType(type) {
        for(const p of this.master.processes) {
            const t = this.master.discovery.details(p.url, type)
            if (t == type) {
                p.cancel()
                this.master.processedLists.has(p.url) && this.master.processedLists.delete(p.url)
            }
        }
        this.master.delimitActiveLists()
    }
    async resetLowPriorityUpdates() {
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates()', this.communityListsAmount);
        this.processes = this.processes.filter(p => {
            /* Cancel pending processes to reorder it */
            if (p.priority > 1 && !p.started() && !p.done()) {
                p.cancel();
                return false;
            }
            return true;
        });
        if (!this.publicListsActive && !this.communityListsAmount)
            return;
        const minListsToTry = Math.max(32, 3 * this.communityListsAmount);
        const maxListsToTry = Math.max(72, this.communityListsAmount);
        if (minListsToTry < this.master.processedLists.size)
            return;
        const taskId = Math.random();
        this.currentTaskId = taskId;
        this.master.updaterFinished(false);
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(1)')
        const lists = await this.master.discovery.get(maxListsToTry)
        const loadingLists = []
        lists.some(({ url, type }) => {
            if (!this.myCurrentLists.includes(url) &&
                !this.processes.some(p => p.url == url) &&
                !this.master.processedLists.has(url)) {
                loadingLists.push(url);
                return loadingLists.length == maxListsToTry;
            }
        });
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(2)');
        const loadingListsCached = await this.master.filterCachedUrls(loadingLists);
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(3)');
        this.master.loadCachedLists(loadingListsCached).catch(console.error)
        this.enqueue([...loadingLists.filter(u => !loadingListsCached.includes(u)), ...loadingListsCached]); // update uncached lists first
        this.queue.onIdle().catch(console.error).finally(() => {
            setTimeout(() => {
                if (this.currentTaskId == taskId && !this.queue.size) {
                    this.master.updaterFinished(true);
                }
                this.master.status();
            }, 2000);
        });
        this.debug && console.error('[listsLoader] resetLowPriorityUpdates(4)');
    }
    async prepareUpdater() {
        if (!this.updater || this.updater.finished === true) {
            if(!this.uid) this.uid = parseInt(Math.random() * 1000000)
            console.error('[listsLoader] Creating updater worker')
            console.error('[listsLoader] ', this.updater, this.uid)
            const updater = this.updater = workers.load(paths.cwd + '/modules/lists/updater-worker.js')
            console.error('[listsLoader] ', this.updater)
            this.once('destroy', () => updater.terminate())
            this.updaterClients = 1
            this.updater.on('progress', p => {
                if (!p || !p.url)
                    return;
                this.progresses[p.url] = p.progress;
                this.emit('progresses', this.progresses);
            });
            updater.close = () => {
                if (this.updaterClients > 0) {
                    this.updaterClients--;
                }
                if (!this.updaterClients && !this.updater.terminating) {
                    this.updater.terminating = setTimeout(() => {
                        console.error('[listsLoader] Terminating updater worker');
                        updater.terminate();
                        this.updater = null;
                    }, 5000);
                }
            };
            const keywords = await this.master.relevantKeywords();
            updater.setRelevantKeywords(keywords).catch(console.error);
            this.debug && console.error('[listsLoader] Updater worker created, relevant keywords: ' + keywords.join(', '));
        } else {
            this.updaterClients++;
            if (this.updater.terminating) {
                clearTimeout(this.updater.terminating);
                this.updater.terminating = null;
            }
        }
    }
    async enqueue(urls, priority = 9) {
        if (priority == 1) { // priority=1 should be reprocessed, as it is in our lists            
            urls = urls.filter(url => this.myCurrentLists.includes(url)); // list still added
        } else {
            urls = urls.filter(url => {
                return !this.processes.some(p => p.url == url); // already processing/processed
            });
        }
        this.debug && console.error('[listsLoader] enqueue: ' + urls.join("\n"));
        if (!urls.length)
            return;
        if (priority == 1) { // my lists should be always added regardless if it's connectable
            for (const url of urls) {
                this.schedule(url, priority);
            }
            return;
        }
        let already = [];
        urls = urls.filter(url => {
            if (typeof (this.pings[url]) == 'undefined') {
                return true;
            }
            if (this.pings[url] > 0) { // if zero, is loading yet
                already.push({ url, time: this.pings[url] });
            }
        });
        urls.forEach(u => this.pings[u] = 0);
        already.sortByProp('time').map(u => u.url).forEach(url => this.schedule(url, priority));
        const start = (Date.now() / 1000);
        const racing = new ConnRacing(urls, { retries: 1, timeout: 8 });
        this.debug && console.error('[listsLoader] enqueue conn racing: ' + urls.join("\n"));
        for (let i = 0; i < urls.length; i++) {
            const res = await racing.next().catch(console.error);
            if (res && res.valid) {
                const url = res.url;
                const time = (Date.now() / 1000) - start;
                if (!this.pings[url] || this.pings[url] < time) {
                    this.pings[url] = (Date.now() / 1000) - start;
                }
                this.schedule(url, priority);
            }
        }
        urls.filter(u => this.pings[u] == 0).forEach(u => delete this.pings[u]);
    }
    async addListNow(url, atts = {}) {
        console.error('addListNow() 1')
        const uid = parseInt(Math.random() * 1000000)
        const progressListener = p => {
            if (p.progressId == uid)
                atts.progress(p.progress)
        };
        console.error('addListNow() 2')
        await Download.waitNetworkConnection()
        console.error('addListNow() 3')
        await this.prepareUpdater()
        console.error('addListNow() 4')
        atts.progress && this.updater.on('progress', progressListener)
        console.error('addListNow ' + JSON.stringify(atts))
        await this.updater.update(url, {
            uid,
            timeout: atts.timeout
        }).catch(console.error)
        console.error('addListNow OK')
        atts.progress && this.updater.removeListener('progress', progressListener)
        this.updater && this.updater.close && this.updater.close()
        this.master.addList(url, 1)
    }
    schedule(url, priority) {
        let cancel, started, done
        this.debug && console.error('[listsLoader] schedule: ' + url)
        this.processes.some(p => p.url == url) || this.processes.push({
            promise: this.queue.add(async () => {
                this.debug && console.error('[listsLoader] schedule processing 0: ' + url + ' | ' + this.paused);
                started = true;
                this.paused && await this.wait();
                this.debug && console.error('[listsLoader] schedule processing 1: ' + url);
                if (cancel)
                    return;
                await this.prepareUpdater();
                this.debug && console.error('[listsLoader] schedule processing 3: ' + url);
                this.results[url] = 'awaiting';
                this.results[url] = await this.updater.update(url).catch(console.error);
                this.debug && console.error('[listsLoader] schedule processing 4: ' + url + ' | ' + this.results[url]);
                this.updater && this.updater.close && this.updater.close();
                done = true;
                const add = this.results[url] == 'updated' ||
                    (this.myCurrentLists.includes(url) && !this.master.lists[url]) ||
                    (this.results[url] == 'already updated' && !this.master.processedLists.has(url));
                add && this.master.addList(url, priority)
            }, { priority }),
            started: () => {
                return started;
            },
            cancel: () => cancel = true,
            done: () => done || cancel,
            priority,
            url
        });
    }
    pause() {
        this.paused = true;
    }
    resume() {
        this.paused = false;
        this.emit('resume');
    }
    wait() {
        return new Promise(resolve => {
            if (!this.paused)
                return resolve()
            this.once('resume', resolve)
        })
    }
    async reload(url) {
        let updateErr;
        const file = storage.resolve(LIST_DATA_KEY_MASK.format(url));
        const progressId = 'reloading-' + parseInt(Math.random() * 1000000);
        const progressListener = p => {
            if (p.progressId == progressId) {
                osd.show(lang.RECEIVING_LIST + ' ' + p.progress + '%', 'fas fa-circle-notch fa-spin', 'progress-' + progressId, 'persistent');
            }
        };
        await fs.promises.unlink(file).catch(() => {});
        progressListener({ progressId, progress: 0 });
        await this.prepareUpdater();
        this.updater.on('progress', progressListener);
        this.results[url] = 'reloading';
        this.results[url] = await this.updater.updateList(url, {
            force: true,
            uid: progressId
        }).catch(err => updateErr = err);
        this.updater && this.updater.close && this.updater.close();
        this.updater.removeListener('progress', progressListener);
        osd.hide('progress-' + progressId);
        if (updateErr)
            throw updateErr;
        await this.master.loadList(url).catch(err => updateErr = err);
        if (updateErr)
            throw updateErr;
        return true;
    }
}
export default ListsLoader;
