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
import ConnRacing from '@edenware/conn-racing';
import config from '../config/config.js';
import renderer from '../bridge/bridge.js';
import { getDirname } from 'cross-dirname';
import { randomUUID } from 'node:crypto'
import { resolveListDatabaseKey } from "./tools.js";
import { touchListMetaFile } from "./list-meta.js";

class ListsLoader extends EventEmitter {
    constructor(master, opts = {}) {
        super();
        this.master = master;
        this.debug = master.debug;
        this.opts = opts;
        // Parse concurrency: 2 allows faster list loading; worker has 2560MB heap
        this.concurrency = 2;
        
        // Download (8) and parse (2) - parse was bottleneck with 1
        this.downloadQueue = new PQueue({ concurrency: 8 });
        this.parseQueue = new PQueue({ concurrency: 2 });
        
        // Track downloaded files waiting for parsing
        this.downloadedFiles = new Map(); // url -> { tempFilePath, updater }
        
        this.osdID = 'lists-loader';
        this.pings = {};
        this.results = {};
        this.progresses = {};
        this.processes = [];
        this.myLists = config.get('lists').map(l => l[1]);
        this.publicListsActive = config.get('public-lists');
        this.communityListsAmount = master.communityListsAmount;
        this.notifiedCommunityIdle = false;
        // Cache for relevantKeywords to avoid recalculating repeatedly
        this.cachedKeywords = null;
        this.keywordsCacheExpiry = 0;
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
            if (keys.includes('community-mode-lists-amount') || keys.includes('public-lists')) this.handleConfigChange(data);
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
        if (concurrency === this.concurrency) return;
        this.concurrency = concurrency;
        this.parseQueue.concurrency = concurrency;
        this.process();
    }

    /** Queue stats for debugging: download/parse waiting + in-progress */
    getQueueStats() {
        return {
            download: { waiting: this.downloadQueue.size, running: this.downloadQueue.pending },
            parse: { waiting: this.parseQueue.size, running: this.parseQueue.pending },
            processes: { total: this.processes.length, done: this.processes.filter(p => p.done()).length },
        };
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
        const newCommunityAmount = data['community-mode-lists-amount'];
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
            if (this.master.discovery.details(p.url, 'type') === type) {
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
        if (recursion > 5 || (!this.publicListsActive && !this.communityListsAmount)) {
            console.log('[lists.loader] process() early exit:', { recursion, publicListsActive: this.publicListsActive, communityListsAmount: this.communityListsAmount });
            return;
        }
        if (recursion === 0 && this.isProcessing) {
            console.log('[lists.loader] process() skip: already processing');
            return;
        }
        this.isProcessing = true;
        console.log('[lists.loader] process() start:', { recursion, myLists: this.myLists.length });
        try {
            if (recursion > 0) {
                await new Promise(resolve => setTimeout(resolve, Math.min(recursion * 200, 1000)))
            }

            this.processes = this.processes.filter(p => !p.done());
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
            if (minLists <= loadedListsCount && loadedCommunityCount >= effectiveCommunityTarget) {
                console.log('[lists.loader] process() target reached:', { loadedListsCount, loadedCommunityCount, minLists, effectiveCommunityTarget });
                return;
            }

            const taskId = randomUUID();
            this.currentTaskId = taskId;
            this.master.updaterFinished(false);
            const lists = await this.master.discovery.get(Math.max(16, 3 * this.communityListsAmount) + (recursion * 8));
            console.log('[lists.loader] process() discovery.get:', { count: lists?.length, taskId });
            if (this.currentTaskId !== taskId) return;

            const urls = lists.filter(l => !this.myLists.includes(l.url) && !this.processes.some(p => p.url === l.url) && !this.master.processedLists.has(l.url) && !this.master.lists[l.url]).map(l => l.url);
            console.log('[lists.loader] process() urls to filter:', { count: urls.length, sample: urls.slice(0, 3) });
            const filterResult = await this.master.filterCachedUrls(urls);
            if (this.currentTaskId !== taskId) return;

            const cached = Array.isArray(filterResult) ? filterResult : (filterResult.cachedUrls || []);
            const urlsWithMissingMeta = filterResult.urlsWithMissingMeta || [];
            console.log('[lists.loader] process() filterResult:', { cachedCount: cached.length, urlsWithMissingMetaCount: urlsWithMissingMeta.length });
            
            // OPTIMIZATION: Load cached lists (alreadyFiltered=true to avoid duplicate filterCachedUrls call)
            // Don't await - let it run in background while we enqueue other URLs
            if (cached.length > 0) {
                this.master.loadCachedLists(cached, true).catch(err => {
                    if (this.debug) {
                        console.error('Error loading cached lists:', err);
                    }
                });
            }

            const nonCachedUrls = urls.filter(u => !cached.includes(u) && !urlsWithMissingMeta.includes(u));
            const toEnqueue = [...nonCachedUrls, ...cached, ...urlsWithMissingMeta];
            console.log('[lists.loader] process() enqueue:', { total: toEnqueue.length, nonCached: nonCachedUrls.length });
            
            // Sort by cached relevance descending to prioritize high-relevance lists
            const relevances = await this.master.getCachedRelevances(toEnqueue);
            toEnqueue.sort((a, b) => (relevances[b]?.total || 0) - (relevances[a]?.total || 0));
            
            this.enqueue(toEnqueue);
            // Wait for both queues to be idle
            await Promise.allSettled([
                this.downloadQueue.onIdle(),
                this.parseQueue.onIdle()
            ]);
            if (this.currentTaskId !== taskId || this.downloadQueue.size || this.parseQueue.size) return;

            this.maybeEmitCommunityIdle({
                urls,
                cached,
                urlsWithMissingMeta,
                listsCount: lists.length
            });

            await new Promise(resolve => setTimeout(resolve, 200));
            if (this.currentTaskId !== taskId) return;

            let promise = 0;
            if (this.master.satisfied) {
                this.master.updaterFinished(true)
            } else {
                promise = this.process(recursion + 1);
            }
            this.master.updateState();
            await promise;
        } finally {
            this.isProcessing = false;
        }
    }

    async prepareUpdater() {
        // Check if needs recreation: if doesn't exist, if worker instance is finished, or if updater is finished
        const needsRecreate = !this.updater || 
                              !this.updaterWorkerInstance || 
                              this.updaterWorkerInstance.finished || 
                              this.updater.finished;
        
        if (needsRecreate) {
            // Clear previous worker instance reference if exists
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
            // Dedicated MultiWorker for updater with higher heap (list/EPG updates can be heavy)
            const updaterWorker = new MultiWorker({
                resourceLimits: {
                    maxOldGenerationSizeMb: 2560,
                    maxYoungGenerationSizeMb: 384
                }
            });
            this.updater = updaterWorker.load(path.join(getDirname(), 'updater-worker.js'));
            if (!this.updater?.update) throw new Error('Failed to create updater worker');
            console.log('[lists.loader] prepareUpdater() created new updater worker');
            
            // Store worker reference to be able to terminate it completely
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
            
            // Listen to update start/end events
            this.updater.on('update-start', ({ url }) => {
                // Mark list as being updated in master
                this.master.markListUpdating(url, true)
            })
            
            this.updater.on('update-end', ({ url, succeeded, skipped }) => {
                // Remove update marking
                this.master.markListUpdating(url, false)
                
                if (succeeded) {
                    const list = this.master.lists[url]
                    if (list?.indexer && typeof list.indexer.loadMeta === 'function') {
                        list.indexer.loadMeta().catch(() => {})
                    }
                    if (!list) {
                        setTimeout(() => {
                            this.master.loadList(url).catch(e => {
                                if (!String(e).match(/destroyed|list discarded|file not found/i)) {
                                    console.error('Error loading list after update:', url, e)
                                }
                            })
                        }, 500)
                    }
                }
            })
            
            this.updater.on('update-error', ({ url, error }) => {
                // Handle error if necessary - can be used for logging or retry logic
                if (this.debug) {
                    console.error('Update error for list:', url, error)
                }
            })
            
            this.updater.close = () => {
                clearTimeout(this.updaterTerminatingTimeout);
                if (--this.updaterClients <= 0) {
                    this.updaterTerminatingTimeout = setTimeout(() => {
                        if (this.updaterWorkerInstance && !this.updaterWorkerInstance.finished && !this.updaterClients) {
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
                    }, 5000);
                }
            };
            // Get channelsIndex for better processing (cached for 1 minute)
            const now = Date.now();
            if (!this.cachedKeywords || this.keywordsCacheExpiry < now) {
                this.cachedKeywords = await this.master.relevantKeywords();
                this.keywordsCacheExpiry = now + 60000; // Cache for 1 minute
            }
            this.updater.setRelevantKeywords(this.cachedKeywords).catch(console.error);
        } else {
            this.updaterClients++;
            // Clear termination timeout if exists
            if (this.updaterTerminatingTimeout) {
                clearTimeout(this.updaterTerminatingTimeout);
                this.updaterTerminatingTimeout = null;
            }
        }
    }

    async enqueue(urls, priority = 9) {
        urls = urls.filter(url => priority === 1 ? this.myLists.includes(url) : !this.processes.some(p => p.url === url));
        if (!urls.length) {
            console.log('[lists.loader] enqueue() skip: no urls after filter');
            return;
        }
        console.log('[lists.loader] enqueue() start:', { urlsCount: urls.length, priority });

        if (priority === 1) return urls.forEach(url => this.schedule(url, priority));

        const toSchedule = urls.filter(url => this.pings[url] > 0).sort((a, b) => this.pings[a] - this.pings[b]);
        urls = urls.filter(url => !this.pings[url]).map(url => (this.pings[url] = 0, url));
        toSchedule.forEach(url => this.schedule(url, priority));
        const scheduledCountBefore = this.processes.length;

        const start = Date.now() / 1000;
        const racing = new ConnRacing(urls, { retries: 2, timeout: 8 });

        // Process results as they become available in parallel
        const processResults = async () => {
            const resultPromises = urls.map(() =>
                racing.next().catch(err => {
                    console.error('ConnRacing error:', err);
                    return false;
                }).then(res => {
                    if (res?.valid) {
                        this.pings[res.url] = (Date.now() / 1000) - start;
                        this.schedule(res.url, priority);
                    } else if (res?.url) {
                        delete this.pings[res.url];
                    }
                    return res;
                })
            );
            await Promise.allSettled(resultPromises);
        };

        await processResults();

        const scheduledCount = this.processes.length - scheduledCountBefore;
        console.log('[lists.loader] enqueue() ConnRacing done:', { scheduledFromRacing: scheduledCount, processesTotal: this.processes.length });

        // Fallback: if ConnRacing returned no valid URLs, schedule first few anyway to bootstrap
        if (scheduledCount === 0 && urls.length > 0) {
            const fallbackLimit = Math.min(8, urls.length);
            const fallbackUrls = urls.filter(u => /^https?:\/\//.test(u)).slice(0, fallbackLimit);
            console.warn('[lists.loader] enqueue() fallback: ConnRacing returned no valid URLs, scheduling:', fallbackUrls.length, fallbackUrls.slice(0, 2));
            fallbackUrls.forEach(url => this.schedule(url, priority));
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
        touchListMetaFile(url).catch(() => {});
        console.log('addListNow result', url, result);
        this.updater?.close();
        try {
            await this.master.loadList(url);
        } catch(e) {}
    }

    schedule(url, priority) {
        if (this.processes.some(p => p.url === url)) return;
        // console.log('[lists.loader] schedule():', url.substring(0, 60) + (url.length > 60 ? '...' : ''));
        let cancel, started = false, parsed = false, done = false;
        
        // PHASE 1: Download (concurrency 8)
        const downloadPromise = this.downloadQueue.add(async () => {
            await this.waitIfPaused();
            if (cancel) {
                done = true;
                return;
            }
            // console.log('[lists.loader] download task start:', url.substring(0, 50) + '...');
            const key = resolveListDatabaseKey(url);
            await this.prepareUpdater();
            this.master.processedLists.set(url, null);
            
            try {
                // Download only - returns tempFilePath (or null for XStream/MAG fallback)
                const tempFilePath = await this.updater.download(url).catch(e => {
                    // If download fails, try fallback to full start() for compatibility
                    console.warn('Download failed, falling back to full start():', e);
                    return null;
                });
                
                // Check if download returned null (XStream/MAG fallback) or a valid file path
                if (tempFilePath === null) {
                    // XStream/MAG or other special cases - use full start() immediately
                    started = true; // no separate download phase
                    try {
                        this.results[url] = await this.updater.update(url).catch(e => {
                            console.error('Update failed after download failure for', url, e);
                            return e;
                        });
                        this.updater?.close();
                        storage.touch(key, {size: true, raw: true, expiration: true});
                        touchListMetaFile(url).catch(() => {});
                        parsed = true;
                        done = true;
                        if (this.results[url] === 'updated' || (this.myLists.includes(url) && !this.master.lists[url]) || this.results[url] === 'already updated') {
                            await this.master.loadList(url).catch(e => !String(e).match(/destroyed|list discarded|file not found/i) && console.error(e));
                        }
                    } catch (updateErr) {
                        console.error('Update error after download failure for', url, updateErr);
                        this.results[url] = updateErr;
                        this.updater?.close();
                        done = true;
                    }
                    return; // Exit early, don't enqueue parsing
                } else if (tempFilePath) {
                    // Store downloaded file info for parsing queue
                    started = true; // download completed
                    this.downloadedFiles.set(url, { tempFilePath, url: url });
                    
                    // Enqueue parsing immediately
                    this.parseQueue.add(async () => {
                        if (cancel) {
                            // Cleanup temp file if cancelled
                            const fileInfo = this.downloadedFiles.get(url);
                            if (fileInfo && fileInfo.tempFilePath) {
                                fs.promises.unlink(fileInfo.tempFilePath).catch(() => {});
                            }
                            this.downloadedFiles.delete(url);
                            this.results[url] = new Error('Cancelled');
                            done = true;
                            return;
                        }
                        
                        const fileInfo = this.downloadedFiles.get(url);
                        if (!fileInfo || !fileInfo.tempFilePath) {
                            console.error('Downloaded file info not found for:', url);
                            this.results[url] = new Error('Downloaded file info not found');
                            done = true;
                            return;
                        }
                        
                        try {
                            // Verify file exists and has content before parsing
                            const fileStats = await fs.promises.stat(fileInfo.tempFilePath).catch(() => null);
                            if (!fileStats || fileStats.size === 0) {
                                console.error(`[Loader] Temp file is empty or missing for ${url}: ${fileInfo.tempFilePath}`);
                                this.results[url] = new Error('Downloaded file is empty');
                                fs.promises.unlink(fileInfo.tempFilePath).catch(() => {});
                                this.downloadedFiles.delete(url);
                                done = true;
                                return;
                            }
                            
                            // Parse from downloaded file using updater worker
                            if (this.debug) {
                                console.log(`[Loader] Starting parse for ${url} from file: ${fileInfo.tempFilePath} (${fileStats.size} bytes)`);
                            }
                            await this.prepareUpdater();
                            this.results[url] = await this.updater.parseFromFile(fileInfo.tempFilePath, url).catch(e => {
                                console.error(`[Loader] Parse error for ${url}:`, e);
                                return e;
                            });
                            
                            if (this.debug) {
                                console.log(`[Loader] Parse completed for ${url}. Result:`, this.results[url]);
                            }
                            
							// Temp file cleanup is now handled by parseFromFile in worker
                            parsed = true;
                            done = true;
                            
                            // CRITICAL: After successful update, invalidate cache and force reload
                            // This ensures the main process sees the updated data (not the old cache)
                            if (this.debug) {
                                console.log(`[Loader] Invalidating cache for ${url} after update, forcing fresh load`);
                            }
                            // Remove from cache and processed list to force reload
                            if (this.master.lists[url]?.indexer?.db) {
                                this.master.lists[url].indexer.db.destroy?.().catch(() => {});
                            }
                            // Delete from lists to force recre ation
                            delete this.master.lists[url];
                            this.master.processedLists.delete(url);
                            
                            if (this.results[url] === true || this.myLists.includes(url) || this.results[url] === 'already updated') {
                                await this.master.loadList(url).catch(e => !String(e).match(/destroyed|list discarded|file not found/i) && console.error(e));
                            }
                        } catch (parseErr) {
                            console.error('Parse error for', url, parseErr);
                            // Temp file cleanup is now handled by parseFromFile in worker (even on error)
                            this.downloadedFiles.delete(url);
                            done = true;
                        }
                    }, { priority });
                        } else {
                    // Fallback: use full start() for compatibility (xtream/mag, etc)
                    started = true;
                    try {
                        this.results[url] = await this.updater.update(url).catch(e => {
                            console.error('Update failed for', url, e);
                            return e;
                        });
                        this.updater?.close();
                        storage.touch(key, {size: true, raw: true, expiration: true});
                        touchListMetaFile(url).catch(() => {});
                        parsed = true;
                        done = true;
                        if (this.results[url] === 'updated' || (this.myLists.includes(url) && !this.master.lists[url]) || this.results[url] === 'already updated') {
                            await this.master.loadList(url).catch(e => !String(e).match(/destroyed|list discarded|file not found/i) && console.error(e));
                        }
                    } catch (updateErr) {
                        console.error('Update error for', url, updateErr);
                        this.results[url] = updateErr;
                        this.updater?.close();
                        done = true;
                    }
                }
            } catch (downloadErr) {
                console.error('Download error for', url, downloadErr);
                this.results[url] = downloadErr;
                done = true;
            }
        }, { priority });
        
        this.processes.push({
            promise: downloadPromise,
            // started = true when download completed (meaning "downloaded")
            started: () => started,
            // parsed = true when parsing completed
            parsed: () => parsed,
            cancel: () => cancel = true,
            done: () => done || cancel,
            priority,
            url
        });
    }

    pause() {
        if (!this.downloadQueue.isPaused) this.downloadQueue.pause();
        if (!this.parseQueue.isPaused) this.parseQueue.pause();
    }

    resume() {
        this.emit('resume');
        if (this.downloadQueue.isPaused) this.downloadQueue.start();
        if (this.parseQueue.isPaused) this.parseQueue.start();
    }

    waitIfPaused() {
        const isPaused = this.downloadQueue.isPaused || this.parseQueue.isPaused;
        return isPaused ? new Promise(resolve => this.once('resume', resolve)) : Promise.resolve();
    }

    async reload(url) {
        const key = resolveListDatabaseKey(url);
        const file = storage.resolve(key, 'jdb');
        const progressId = `reloading-${randomUUID()}`;
        const showProgress = p => p.progressId === progressId && osd.show(`${lang.RECEIVING_LIST} ${p.progress}%`, 'fa-mega busy-x', `progress-${progressId}`, 'persistent');
        
        await fs.promises.unlink(file).catch(() => {});
        showProgress({ progressId, progress: 0 });
        await this.prepareUpdater();
        this.updater.on('progress', showProgress);
        this.results[url] = await this.updater.updateList(url, { force: true, uid: progressId }).catch(e => { throw e; });
        this.updater?.close();
        storage.touch(key, {size: true, raw: true, expiration: true});
        touchListMetaFile(url).catch(() => {});
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

        if (this.downloadQueue.size || this.parseQueue.size) {
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
