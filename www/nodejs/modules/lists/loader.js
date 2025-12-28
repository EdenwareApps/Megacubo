import fs from 'fs';
import path from 'path';
import osd from '../osd/osd.js';
import lang from '../lang/lang.js';
import storage from '../storage/storage.js';
import { EventEmitter } from 'node:events';
import PQueue from 'p-queue';
import pLimit from 'p-limit';
import workers from '../multi-worker/main.js';
import MultiWorker from '../multi-worker/multi-worker.js';
import ConnRacing from '../conn-racing/conn-racing.js';
import config from '../config/config.js';
import renderer from '../bridge/bridge.js';
import { getDirname } from 'cross-dirname';
import { randomUUID } from 'node:crypto'
import { resolveListDatabaseKey } from "./tools.js";

class ListsLoader extends EventEmitter {
    constructor(master, opts = {}) {
        super();
        this.master = master;
        this.debug = master.debug;
        this.opts = opts;
        this.concurrency = config.get('lists-loader-concurrency') || 3;
        this.queue = new PQueue({ concurrency: this.concurrency });
        this.osdID = 'lists-loader';
        this.pings = {};
        this.results = {};
        this.progresses = {};
        this.processes = [];
        this.myLists = config.get('lists').map(l => l[1]);
        this.publicListsActive = config.get('public-lists');
        this.communityListsAmount = master.communityListsAmount;
        this.notifiedCommunityIdle = false;
        this.setupListeners();
        this.enqueue(this.myLists, 1);
        this.process().catch(err => console.error('Error processing lists', err));
        this.setupRecommendationsListeners();
    }

    setupListeners() {
        renderer.ready(() => {
            this.master.discovery.on('found', () => this.process());
            global.streamer.on('commit', () => this.pause());
            global.streamer.on('stop', () => setTimeout(() => global.streamer.active || this.resume(), 2000));
            this.process().catch(err => console.error('Error processing lists', err));
        });
        config.on('change', (keys, data) => {
            if (keys.includes('lists')) this.handleListsChange(data);
            if (keys.includes('communitary-mode-lists-amount') || keys.includes('public-lists')) this.handleConfigChange(data);
        });
        this.master.on('satisfied', () => this.adjustConcurrency(1));
        this.master.on('unsatisfied', () => this.adjustConcurrency(this.concurrency));
    }

    setupRecommendationsListeners() {
        const tags = global?.recommendations?.tags;
        if (!tags || typeof tags.on !== 'function') {
            return;
        }

        const updateKeywords = async () => {
            if (!this.updater || 
                !this.updaterWorkerInstance || 
                this.updaterWorkerInstance.finished || 
                (this.updater && this.updater.finished)) {
                return;
            }

            if (typeof this.master?.relevantKeywords !== 'function') {
                console.error('[listsLoader] relevantKeywords is not a function');
                return;
            }

            try {
                const channelsIndex = await this.master.relevantKeywords();
                if (channelsIndex && typeof this.updater?.setRelevantKeywords === 'function') {
                    this.updater.setRelevantKeywords(channelsIndex).catch(console.error);
                }
            } catch (err) {
                this.debug && console.error('[listsLoader] Failed to refresh relevant keywords:', err);
            }
        };

        tags.on('updated', updateKeywords);
        this.on('destroy', () => {
            if (typeof tags.off === 'function') {
                tags.off('updated', updateKeywords);
            } else if (typeof tags.removeListener === 'function') {
                tags.removeListener('updated', updateKeywords);
            }
        });
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
        this.resetCommunityIdle();
        this.master.processedLists.clear();
        this.process();
    }

    async process(recursion = 0) {
        if (recursion > 2 || (!this.publicListsActive && !this.communityListsAmount)) return;
        
        // Prevent infinite recursion by checking if we're already processing
        if (this.isProcessing) {
            return;
        }
        this.isProcessing = true;
        
        try {
            this.processes = this.processes.filter(p => p.started() && !p.done());
            const minLists = Math.max(8, 2 * this.communityListsAmount);

            // Count only successfully loaded lists (ready), not just processed attempts
            const loadedListsCount = Object
                .values(this.master.lists || {})
                .filter(l => l && l.ready && typeof l.ready.is === 'function' && l.ready.is())
                .length;

            // Community lists exploration:
            // - We want to keep loading community lists until we at least fill the quota
            //   (communityListsAmount - myLists.length), and also allow a small exploration margin.
            // - trim() will always enforce the real quota based on relevance, removing the worst ones.
            const communityListsQuota = Math.max(this.communityListsAmount - this.myLists.length, 0);
            let loadedCommunityCount = 0;
            if (typeof this.master.loadedListsCount === 'function') {
                loadedCommunityCount = this.master.loadedListsCount('community');
            } else {
                loadedCommunityCount = Object
                    .values(this.master.lists || {})
                    .filter(l =>
                        l &&
                        l.origin === 'community' &&
                        l.ready &&
                        typeof l.ready.is === 'function' &&
                        l.ready.is()
                    ).length;
            }

            // Allow a small number of "exploration" slots above the strict quota,
            // so we can load and compare new community lists over time.
            const explorationSlots = communityListsQuota > 0 ? 3 : 0;
            const effectiveCommunityTarget = communityListsQuota + explorationSlots;

            // Only stop processing when:
            //  - we already have enough total lists (minLists), AND
            //  - we also have at least the community quota plus exploration slots loaded.
            if (minLists <= loadedListsCount && loadedCommunityCount >= effectiveCommunityTarget) return;

            const taskId = randomUUID();
            this.currentTaskId = taskId;
            this.master.updaterFinished(false);
            const lists = await this.master.discovery.get(Math.max(16, 3 * this.communityListsAmount));
            if (this.currentTaskId !== taskId) return;

            const urls = lists.filter(l => !this.myLists.includes(l.url) && !this.processes.some(p => p.url === l.url) && !this.master.processedLists.has(l.url) && !this.master.lists[l.url]).map(l => l.url);
            const cached = await this.master.filterCachedUrls(urls);
            if (this.currentTaskId !== taskId) return;

            // Check for URLs with main files but missing meta files
            const urlsWithMissingMeta = [];
            const checkMetaLimit = pLimit(8);
            const checkMetaTasks = urls.filter(u => !cached.includes(u)).map(url => {
                return async () => {
                    const result = await this.master.checkListFiles(url);
                    if (result.hasMissingMeta) {
                        urlsWithMissingMeta.push(url);
                    }
                };
            }).map(checkMetaLimit);
            
            await Promise.allSettled(checkMetaTasks).catch(err => console.error(err));

            this.master.loadCachedLists(cached).catch(console.error);
            this.enqueue([...urls.filter(u => !cached.includes(u) && !urlsWithMissingMeta.includes(u)), ...cached, ...urlsWithMissingMeta]);
            await this.queue.onIdle().catch(console.error);
            if (this.currentTaskId !== taskId || this.queue.size) return;

            this.maybeEmitCommunityIdle({
                urls,
                cached,
                urlsWithMissingMeta,
                listsCount: lists.length
            });

            await new Promise(resolve => setTimeout(resolve, 1000));
            if (this.currentTaskId !== taskId) return;

            this.master.satisfied ? this.master.updaterFinished(true) : this.process(recursion + 1);
            this.master.updateState();
        } finally {
            this.isProcessing = false;
        }
    }

    async prepareUpdater() {
        // Verifica se precisa recriar: se não existe, se o worker instance está finished, ou se o updater está finished
        const needsRecreate = !this.updater || 
                              !this.updaterWorkerInstance || 
                              this.updaterWorkerInstance.finished || 
                              this.updater.finished;
        
        if (needsRecreate) {
            // Limpa a referência anterior do worker instance se existir
            if (this.updaterWorkerInstance) {
                try {
                    this.updaterWorkerInstance.terminate();
                } catch (e) {
                    // Ignore errors if already terminated
                }
                this.updaterWorkerInstance = null;
            }
            
            // Limpa timeout anterior se existir
            if (this.updaterTerminatingTimeout) {
                clearTimeout(this.updaterTerminatingTimeout);
                this.updaterTerminatingTimeout = null;
            }
            
            this.uid = this.uid || randomUUID();
            // Cria uma instância dedicada do MultiWorker apenas para o updater
            const updaterWorker = new MultiWorker();
            this.updater = updaterWorker.load(path.join(getDirname(), 'updater-worker.js'));
            if (!this.updater?.update) throw new Error('Failed to create updater worker');
            
            // Armazena a referência do worker para poder terminá-lo completamente
            this.updaterWorkerInstance = updaterWorker;
            
            this.once('destroy', () => {
                // Clear any pending timeout
                if (this.updaterTerminatingTimeout) {
                    clearTimeout(this.updaterTerminatingTimeout);
                    this.updaterTerminatingTimeout = null;
                }
                // Termina o worker instance completamente
                if (this.updaterWorkerInstance && !this.updaterWorkerInstance.finished) {
                    try {
                        this.updaterWorkerInstance.terminate();
                    } catch (e) {
                        // Ignore errors if already terminated
                    }
                    this.updaterWorkerInstance = null;
                }
                if (this.updater) {
                    try {
                        this.updater.terminate();
                    } catch (e) {
                        // Ignore errors if already terminated
                    }
                    this.updater = null;
                }
            });
            this.updaterClients = 1;
            this.updater.on('progress', p => p?.url && this.emit('progresses', { ...this.progresses, [p.url]: p.progress }));
            
            // Escutar eventos de início/fim de atualização
            this.updater.on('update-start', ({ url }) => {
                // Marcar lista como sendo atualizada no master
                this.master.markListUpdating(url, true)
            })
            
            this.updater.on('update-end', ({ url, succeeded, skipped }) => {
                // Remover marcação de atualização
                this.master.markListUpdating(url, false)
                
                // Se a atualização foi bem-sucedida e a lista ainda não está carregada, tentar carregar
                if (succeeded && !this.master.lists[url]) {
                    // Aguardar um pouco para garantir que o arquivo está completamente salvo
                    setTimeout(() => {
                        this.master.loadList(url).catch(e => {
                            if (!String(e).match(/destroyed|list discarded|file not found/i)) {
                                console.error('Error loading list after update:', url, e)
                            }
                        })
                    }, 500) // 500ms de delay para garantir que o arquivo está salvo
                }
            })
            
            this.updater.on('update-error', ({ url, error }) => {
                // Tratar erro se necessário - pode ser usado para logging ou retry logic
                if (this.debug) {
                    console.error('Update error for list:', url, error)
                }
            })
            
            this.updater.close = () => {
                if (--this.updaterClients <= 0 && !this.updaterTerminatingTimeout) {
                    this.updaterTerminatingTimeout = setTimeout(() => {
                        if (this.updaterWorkerInstance && !this.updaterWorkerInstance.finished) {
                            this.debug && console.error('[listsLoader] Terminating updater');
                            // Termina o worker instance completamente
                            try {
                                this.updaterWorkerInstance.terminate();
                            } catch (e) {
                                // Ignore errors if already terminated
                            }
                            this.updaterWorkerInstance = null;
                            
                            if (this.updater) {
                                try {
                                    this.updater.terminate();
                                } catch (e) {
                                    // Ignore errors if already terminated
                                }
                                this.updater = null;
                            }
                        }
                        this.updaterTerminatingTimeout = null;
                    }, 5000);
                }
            };
            // Get channelsIndex for better processing
            const channelsIndex = await this.master.relevantKeywords();
            this.updater.setRelevantKeywords(channelsIndex).catch(console.error);
        } else {
            this.updaterClients++;
            // Limpa timeout de terminação se existir
            if (this.updaterTerminatingTimeout) {
                clearTimeout(this.updaterTerminatingTimeout);
                this.updaterTerminatingTimeout = null;
            }
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
        const key = resolveListDatabaseKey(url);
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
                const key = resolveListDatabaseKey(url);
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
        const key = resolveListDatabaseKey(url);
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

    resetCommunityIdle() {
        this.notifiedCommunityIdle = false;
    }

    maybeEmitCommunityIdle(context = {}) {
        if (this.notifiedCommunityIdle) {
            return;
        }

        const requiresCommunity = Math.max(this.communityListsAmount - this.myLists.length, 0) > 0;
        if (!requiresCommunity) {
            return;
        }

        if (this.master.loadedListsCount('community') > 0) {
            return;
        }

        if (this.processes.some(p => !p.done())) {
            return;
        }

        if (this.queue.size) {
            return;
        }

        this.notifiedCommunityIdle = true;
        this.emit('community-idle', {
            urls: context.urls || [],
            cached: context.cached || [],
            missingMeta: Array.isArray(context.urlsWithMissingMeta) ? context.urlsWithMissingMeta.length : 0,
            listsCount: context.listsCount || 0,
            timestamp: Date.now()
        });
    }
}

export default ListsLoader;