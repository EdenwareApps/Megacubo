import fs from 'fs';
import path from 'path'
import { LIST_DATA_KEY_MASK } from '../utils/utils.js';
import Download from '../download/download.js'
import osd from '../osd/osd.js'
import lang from '../lang/lang.js';
import storage from '../storage/storage.js'
import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import workers from '../multi-worker/main.js';
import ConnRacing from '../conn-racing/conn-racing.js';
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import { getDirname } from 'cross-dirname'

class ListsLoader extends EventEmitter {
    constructor(master, opts) {
        super()
        const concurrency = config.get('lists-loader-concurrency') || 6 // avoid too many concurrency on mobiles
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
        renderer.ready(() => {
            this.master.discovery.on('found', () => this.process())
            global.streamer.on('commit', () => this.pause())
            global.streamer.on('stop', () => {
                setTimeout(() => {
                    global.streamer.active || this.resume()
                }, 2000) // wait 2 seconds, maybe user is just zapping channels
            })
            this.process()
        })
        config.on('change', (keys, data) => {
            if (keys.includes('lists')) {
                this.handleListsChange(data);
            }
            if (keys.includes('communitary-mode-lists-amount')) {
                this.handleCommunityListsAmountChange(data);
            }
            if (keys.includes('public-lists')) {
                this.handlePublicListsChange(data);
            }
        })
        this.master.on('satisfied', () => {
            if (this.master.activeLists.length) {
                this.setQueueConcurrency(1)
                this.process()
            }
        });
        this.master.on('unsatisfied', () => {
            this.setQueueConcurrency(concurrency)
            this.process()
        });
        this.process()
    }
    setQueueConcurrency(concurrency) {
        this.queue.concurrency = concurrency
        this.queue._concurrency = concurrency // try to change pqueue concurrency dinamically
    }
    handleListsChange(data) {
        const newMyLists = data.lists.map(l => l[1]);
        const added = newMyLists.filter(l => !this.myCurrentLists.includes(l));
        const removed = this.myCurrentLists.filter(l => !newMyLists.includes(l));
        removed.forEach(u => this.master.remove(u));
        newMyLists.forEach(u => {
            this.master.processedLists.has(u) && this.master.processedLists.delete(u);
        });
        this.myCurrentLists = newMyLists;
        this.enqueue(added, 1);
    }
    handleCommunityListsAmountChange(data) {
        if (this.communityListsAmount != data['communitary-mode-lists-amount']) {
            this.communityListsAmount = data['communitary-mode-lists-amount'];
            this.master.processedLists.clear();
            this.process();
            if (!data['communitary-mode-lists-amount']) {
                this.cancelProcessesByType('community');
            }
        }
    }
    handlePublicListsChange(data) {
        if (this.publicListsActive != data['public-lists']) {
            this.publicListsActive = data['public-lists'];
            this.master.processedLists.clear();
            this.process();
            if (!data['public-lists']) {
                this.cancelProcessesByType('public');
            }
        }
    }
    async cancelProcessesByType(type) {
        for(const p of this.processes) {
            const t = this.master.discovery.details(p.url, type)
            if (t == type) {
                p.cancel()
                this.master.processedLists.has(p.url) && this.master.processedLists.delete(p.url)
            }
        }
        this.master.delimitActiveLists()
    }
    async process(recursion=0) {
        if (recursion > 2) return
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
        const lists = await this.master.discovery.get(maxListsToTry)
        if (this.currentTaskId != taskId) return
        const loadingLists = []
        lists.some(({ url, type }) => {
            if (!this.myCurrentLists.includes(url) &&
                !this.processes.some(p => p.url == url) &&
                !this.master.processedLists.has(url)) {
                loadingLists.push(url)
                return loadingLists.length == maxListsToTry
            }
        });
        const loadingListsCached = await this.master.filterCachedUrls(loadingLists);
        if (this.currentTaskId != taskId) return
        this.master.loadCachedLists(loadingListsCached).catch(console.error)
        this.enqueue([...loadingLists.filter(u => !loadingListsCached.includes(u)), ...loadingListsCached]) // update uncached lists first
        await this.queue.onIdle().catch(console.error)
        if (this.currentTaskId != taskId) return
        await new Promise(resolve => setTimeout(resolve, 1000))
        if (this.currentTaskId != taskId) return
        if (!this.queue.size) {
            if(this.master.satisfied) {
                this.master.updaterFinished(true)
            } else {
                recursion++
                return await this.process(recursion)
            }
        }
        this.master.status()
    }
    async prepareUpdater() {
        if (!this.updater || this.updater.finished === true) {
            if(!this.uid) this.uid = parseInt(Math.random() * 1000000)
            const updater = workers.load(path.join(getDirname(), 'updater-worker.js'))
            if (!updater || typeof(updater.update) != 'function') {
                if(!updater) updater = {}
                throw new Error('Could not create updater worker #'+ typeof(updater.update));
            }
            this.updater = updater
            this.once('destroy', () => updater.terminate())
            this.updaterClients = 1
            updater.on('progress', p => {
                if (!p || !p.url)
                    return;
                this.progresses[p.url] = p.progress;
                this.emit('progresses', this.progresses);
            });
            updater.close = () => {
                if (this.updaterClients > 0) {
                    this.updaterClients--;
                }
                if (!this.updaterClients && !updater.terminating) {
                    updater.terminating = setTimeout(() => {
                        this.debug && console.error('[listsLoader] Terminating updater worker');
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
        return true
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
            if (typeof(this.pings[url]) == 'undefined') {
                return true;
            }
            if (this.pings[url] > 0) { // if zero, is loading yet
                already.push({ url, time: this.pings[url] });
            }
        });
        urls.forEach(u => this.pings[u] = 0);
        already.sortByProp('time').map(u => u.url).forEach(url => this.schedule(url, priority));
        const start = (Date.now() / 1000);
        const racing = new ConnRacing(urls, { retries: 2, timeout: 8 });
        this.debug && console.error('[listsLoader] enqueue conn racing: ' + urls.join("\n"));
        for (let i = 0; i < urls.length; i++) {
            const res = await racing.next().catch(console.error)
            if (res && res.valid) {
                const url = res.url;
                const time = (Date.now() / 1000) - start;
                if (!this.pings[url] || this.pings[url] > time) {
                    this.pings[url] = time
                }
                this.schedule(url, priority)
            }
        }
        urls.filter(u => this.pings[u] == 0).forEach(u => delete this.pings[u]);
    }
    async addListNow(url, atts = {}) {
        const uid = parseInt(Math.random() * 1000000)
        const progressListener = p => {
            if (p.progressId == uid)
                atts.progress(p.progress)
        };
        await Download.waitNetworkConnection()
        await this.prepareUpdater()
        atts.progress && this.updater.on('progress', progressListener)
        await this.updater.update(url, {
            uid,
            timeout: atts.timeout
        }).catch(console.error)
        atts.progress && this.updater.removeListener('progress', progressListener)
        this.updater && this.updater.close && this.updater.close()
        await this.master.loadList(url)
    }
    schedule(url, priority) {
        let cancel, started, done
        this.debug && console.error('[listsLoader] schedule: ' + url)
        this.processes.some(p => p.url == url) || this.processes.push({
            promise: this.queue.add(async () => {
                started = true
                this.paused && await this.wait()
                if (cancel) return
                await this.prepareUpdater()
                const processed = this.master.processedLists.has(url)
                this.master.processedLists.set(url, null)
                this.results[url] = 'awaiting';
                this.results[url] = await this.updater.update(url).catch(console.error);
                this.updater && this.updater.close && this.updater.close();
                done = true;
                const add = this.results[url] == 'updated' ||
                    (this.myCurrentLists.includes(url) && !this.master.lists[url]) ||
                    (this.results[url] == 'already updated' && !processed);
                add && await this.master.loadList(url).catch(console.error)
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
        const file = storage.resolve(LIST_DATA_KEY_MASK.format(url))
        const progressId = 'reloading-' + parseInt(Math.random() * 1000000)
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
