import fs from 'fs';
import path from 'path';
import { LIST_DATA_KEY_MASK } from '../utils/utils.js';
import Download from '../download/download.js';
import osd from '../osd/osd.js';
import lang from '../lang/lang.js';
import storage from '../storage/storage.js';
import { EventEmitter } from 'node:events';
import PQueue from 'p-queue';
import workers from '../multi-worker/main.js';
import ConnRacing from '../conn-racing/conn-racing.js';
import config from '../config/config.js';
import renderer from '../bridge/bridge.js';
import paths from '../paths/paths.js';
import { getDirname } from 'cross-dirname';
import { randomUUID } from 'node:crypto'

class ListsLoader extends EventEmitter {
    constructor(master, opts = {}) {
        super();
        this.master = master;
        this.debug = master.debug;
        this.opts = opts;
        this.concurrency = config.get('lists-loader-concurrency') || 6;
        this.queue = new PQueue({ concurrency: this.concurrency });
        this.osdID = 'lists-loader';
        this.pings = {};
        this.results = {};
        this.progresses = {};
        this.processes = [];
        this.myLists = config.get('lists').map(l => l[1]);
        this.publicListsActive = config.get('public-lists');
        this.communityListsAmount = master.communityListsAmount;
        this.setupListeners();
        this.enqueue(this.myLists, 1);
        this.process();
    }

    setupListeners() {
        renderer.ready(() => {
            this.master.discovery.on('found', () => this.process());
            global.streamer.on('commit', () => this.pause());
            global.streamer.on('stop', () => setTimeout(() => global.streamer.active || this.resume(), 2000));
            this.process();
        });
        config.on('change', (keys, data) => {
            if (keys.includes('lists')) this.handleListsChange(data);
            if (keys.includes('communitary-mode-lists-amount') || keys.includes('public-lists')) this.handleConfigChange(data);
        });
        this.master.on('satisfied', () => this.adjustConcurrency(1));
        this.master.on('unsatisfied', () => this.adjustConcurrency(this.concurrency));
    }

    adjustConcurrency(concurrency) {
        const configConcurrency = config.get('lists-loader-concurrency');
        if (configConcurrency && typeof configConcurrency === 'number') {
            concurrency = configConcurrency;
        }
        this.queue.concurrency = concurrency;
        this.process();
    }

    handleListsChange(data) {
        const newLists = data.lists.map(l => l[1]);
        const added = newLists.filter(l => !this.myLists.includes(l));
        this.myLists.filter(l => !newLists.includes(l)).forEach(u => this.master.remove(u));
        newLists.forEach(u => this.master.processedLists.delete(u));
        this.myLists = newLists;
        this.enqueue(added, 1);
    }

    handleConfigChange(data) {
        const newCommunityAmount = data['communitary-mode-lists-amount'];
        const newPublicLists = data['public-lists'];
        if (this.communityListsAmount !== newCommunityAmount || this.publicListsActive !== newPublicLists) {
            this.master.processedLists.clear();
            this.communityListsAmount = newCommunityAmount;
            this.publicListsActive = newPublicLists;
            this.reset();
            if (!newCommunityAmount) this.cancelProcesses('community');
            if (!newPublicLists) this.cancelProcesses('public');
        }
    }

    cancelProcesses(type) {
        this.processes = this.processes.filter(p => {
            if (this.master.discovery.details(p.url, type) === type) {
                p.cancel();
                this.master.processedLists.delete(p.url);
                return false;
            }
            return true;
        });
        this.master.trim();
    }

    reset() {
        this.master.processedLists.clear();
        this.process();
    }

    async process(recursion = 0) {
        if (recursion > 2 || (!this.publicListsActive && !this.communityListsAmount)) return;
        this.processes = this.processes.filter(p => p.started() && !p.done());
        const minLists = Math.max(8, 2 * this.communityListsAmount);
        if (minLists <= this.master.processedLists.size) return;

        const taskId = randomUUID();
        this.currentTaskId = taskId;
        this.master.updaterFinished(false);
        const lists = await this.master.discovery.get(Math.max(16, 3 * this.communityListsAmount));
        if (this.currentTaskId !== taskId) return;

        const urls = lists.filter(l => !this.myLists.includes(l.url) && !this.processes.some(p => p.url === l.url) && !this.master.processedLists.has(l.url) && !this.master.lists[l.url]).map(l => l.url);
        const cached = await this.master.filterCachedUrls(urls);
        if (this.currentTaskId !== taskId) return;

        this.master.loadCachedLists(cached).catch(console.error);
        this.enqueue([...urls.filter(u => !cached.includes(u)), ...cached]);
        await this.queue.onIdle().catch(console.error);
        if (this.currentTaskId !== taskId || this.queue.size) return;

        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.currentTaskId !== taskId) return;

        this.master.satisfied ? this.master.updaterFinished(true) : this.process(recursion + 1);
        this.master.updateState();
    }

    async prepareUpdater() {
        if (!this.updater || this.updater.finished) {
            this.uid = this.uid || randomUUID();
            this.updater = workers.load(path.join(getDirname(), 'updater-worker.js'));
            if (!this.updater?.update) throw new Error('Failed to create updater worker');
            this.once('destroy', () => this.updater.terminate());
            this.updaterClients = 1;
            this.updater.on('progress', p => p?.url && this.emit('progresses', { ...this.progresses, [p.url]: p.progress }));
            this.updater.close = () => {
                if (--this.updaterClients <= 0 && !this.updater.terminating) {
                    this.updater.terminating = setTimeout(() => {
                        this.debug && console.error('[listsLoader] Terminating updater');
                        this.updater.terminate();
                        this.updater = null;
                    }, 5000);
                }
            };
            const keywords = await this.master.relevantKeywords();
            this.updater.setRelevantKeywords(keywords).catch(console.error);
        } else {
            this.updaterClients++;
            clearTimeout(this.updater.terminating);
            this.updater.terminating = null;
        }
    }

    async enqueue(urls, priority = 9) {
        urls = urls.filter(url => priority === 1 ? this.myLists.includes(url) : !this.processes.some(p => p.url === url));
        if (!urls.length) return;

        if (priority === 1) return urls.forEach(url => this.schedule(url, priority));

        const toSchedule = urls.filter(url => this.pings[url] > 0).sort((a, b) => this.pings[a] - this.pings[b]);
        urls = urls.filter(url => !this.pings[url]).map(url => (this.pings[url] = 0, url));
        toSchedule.forEach(url => this.schedule(url, priority));

        const start = Date.now() / 1000;
        const racing = new ConnRacing(urls, { retries: 2, timeout: 8 });
        for (let i = 0; i < urls.length; i++) {
            const res = await racing.next().catch(console.error);
            if (res?.valid) {
                this.pings[res.url] = (Date.now() / 1000) - start;
                this.schedule(res.url, priority);
            } else if (res?.url) delete this.pings[res.url];
        }
    }

    async addListNow(url, { progress, timeout } = {}) {
        const uid = randomUUID();
        const key = LIST_DATA_KEY_MASK.format(url);
        await this.prepareUpdater();
        progress && this.updater.on('progress', p => p.progressId === uid && progress(p.progress));
        const result = await this.updater.update(url, { uid, timeout }).catch(e => { throw e; });
        progress && this.updater.removeListener('progress', progress);
        storage.touch(key, {size: true, raw: true, expiration: true});
        console.log('addListNow result', url, result);
        this.updater?.close();
        try {
            await this.master.loadList(url);
        } catch(e) {}
    }

    schedule(url, priority) {
        if (this.processes.some(p => p.url === url)) return;
        let cancel, started, done;
        this.processes.push({
            promise: this.queue.add(async () => {
                started = true;
                await this.waitIfPaused();
                if (cancel) return;
                const key = LIST_DATA_KEY_MASK.format(url);
                await this.prepareUpdater();
                this.master.processedLists.set(url, null);
                this.results[url] = await this.updater.update(url).catch(e => e);
                this.updater?.close();
                storage.touch(key, {size: true, raw: true, expiration: true});
                done = true;
                if (this.results[url] === 'updated' || (this.myLists.includes(url) && !this.master.lists[url]) || this.results[url] === 'already updated') {
                    await this.master.loadList(url).catch(e => !String(e).match(/destroyed|list discarded|file not found/i) && console.error(e));
                }
            }, { priority }),
            started: () => started,
            cancel: () => cancel = true,
            done: () => done || cancel,
            priority,
            url
        });
    }

    pause() {
        !this.queue.isPaused && this.queue.pause();
    }

    resume() {
        this.emit('resume');
        this.queue.isPaused && this.queue.start();
    }

    waitIfPaused() {
        return this.queue.isPaused ? new Promise(resolve => this.once('resume', resolve)) : Promise.resolve();
    }

    async reload(url) {
        const key = LIST_DATA_KEY_MASK.format(url);
        const file = storage.resolve(key);
        const progressId = `reloading-${randomUUID()}`;
        const showProgress = p => p.progressId === progressId && osd.show(`${lang.RECEIVING_LIST} ${p.progress}%`, 'fa-mega busy-x', `progress-${progressId}`, 'persistent');
        
        await fs.promises.unlink(file).catch(() => {});
        showProgress({ progressId, progress: 0 });
        await this.prepareUpdater();
        this.updater.on('progress', showProgress);
        this.results[url] = await this.updater.updateList(url, { force: true, uid: progressId }).catch(e => { throw e; });
        this.updater?.close();
        storage.touch(key, {size: true, raw: true, expiration: true});        
        this.updater.removeListener('progress', showProgress);
        osd.hide(`progress-${progressId}`);
        return this.master.loadList(url);
    }
}

export default ListsLoader;