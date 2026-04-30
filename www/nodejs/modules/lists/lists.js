import fs from "fs";
import storage from '../storage/storage.js'
import Index from "./index.js";
import pLimit from "p-limit";
import PQueue from "p-queue";
import Loader from "./loader.js";
import Manager from "./manager.js";
import List from "./list.js";
import Discovery from "../discovery/discovery.js";
import config from "../config/config.js"
import { getEPGInstance } from '../epg/index.js';
import lang from '../lang/lang.js';
import { resolveListDatabaseFile } from "./tools.js";
import { getListMeta, resolveListMetaPath } from "./list-meta.js";
import { ready } from '../bridge/bridge.js'
import { inWorker } from '../paths/paths.js'
import { forwardSlashes, parseCommaDelimitedURIs, trackPromise } from "../utils/utils.js";
import { Fetcher } from './common.js';

class ListsEPGTools extends Index {
    constructor(opts) {
        super(opts)
        this.Fetcher = Fetcher;

        const { worker: epgWorker, epg } = getEPGInstance()
        this.epgWorker = epgWorker
        this.epg = epg
        
        this.epg.loaded = null
        this.epg.state = {
            totalEPGs: 0,
            loadedEPGs: 0,
            errorEPGs: 0,
            totalProgrammes: 0,
            pastProgrammes: 0,
            currentProgrammes: 0,
            futureProgrammes: 0,
            overallProgress: 0,
            epgs: [],
            summary: {
                activeEPGs: 0,
                errorEPGs: 0,
                inactiveEPGs: 0,
                programmesDistribution: {
                    past: 0,
                    current: 0,
                    future: 0,
                    total: 0
                }
            }
        }
        this.epg.on('state', state => {
            const loaded = state.epgs.filter(epg => epg.readyState === 'loaded').map(epg => epg.url)
            this.epg.state = state
            this.epg.loaded = loaded.length ? loaded : null
            this.epg.loaded && this.emit('epg-update')
            const listeners = this.epgReadyListeners
            this.epgReadyListeners.length = 0
            listeners.forEach(resolve => resolve(true))
        })
        this.epgReadyListeners = []
        // Protection against infinite loops when loading additional EPGs
        this.loadingAdditionalEPGs = false
        this.additionalEPGsAttempts = 0
        this.lastAdditionalEPGsAttempt = 0
        this.maxAdditionalEPGsAttempts = 3 // Maximum attempts to load additional EPGs
        this.additionalEPGsCooldown = 30000 // 30 seconds cooldown between attempts
        this.initializeEPG().catch(err => console.error('❌ Error initializing EPG:', err))
    }
    
    async initializeEPG() {

        // Wait for both lang and EPG worker to be ready before starting        
        await lang.ready()
        await global.channels.ready()
        await global.lists.ready()
        
        // Set channel terms index when EPG starts
        const channelTerms = global.channels?.channelList?.channelsIndex
        if (channelTerms) await this.epg.setChannelTermsIndex(channelTerms)

        // Wait for EPG worker to be fully loaded before calling start()
        await new Promise(resolve => {
            // Check if worker is already ready, otherwise wait for event
            if (this.epgWorker.workerReady) {
                // Worker already ready, start after a small delay to ensure driver loads
                resolve()
            } else {
                // Wait for worker-ready event
                this.epgWorker.once('worker-ready', () => {
                    resolve()
                })
            }
        })
        
        const key = 'epg-'+ lang.locale
        const epgConfig = config.get(key)
        console.log('🔍 EPG Config loaded:', epgConfig)
        console.log('🚀 Starting EPG...')
        this.epg.start(epgConfig).catch(err => {
            console.error('❌ EPG start error:', err)
            console.error('❌ EPG config was:', epgConfig)
        })

        // Add listener to reload suggestions when needed
        this.epg.on('reload-suggestions', async () => {
            console.log('🔄 Reloading EPG suggestions...')
            const activeEPG = config.get('epg-' + lang.locale)
            if (activeEPG === 'disabled' || config.get('epg-suggestions') === false) {
                console.log('EPG suggestions disabled, skipping reload')
                return
            }
            
            const urls = await this.searchEPGs()
            console.log('EPGS urls - EPG (reload)', urls)
            if (urls.length > 0) {
                await this.epg.suggest(urls)
            }
        })

        // Add listener to load more EPGs when needed to reach minimum
        this.epg.on('needMoreEPGs', async ({ needed, current }) => {
            console.log(`🔔 needMoreEPGs event: need ${needed} more EPG(s), currently have ${current}`)
            
            // Protection against infinite loops
            const now = Date.now()
            
            // Check if already loading additional EPGs
            if (this.loadingAdditionalEPGs) {
                console.log('🔔 Already loading additional EPGs, skipping duplicate request')
                return
            }
            
            // Check cooldown period
            if (now - this.lastAdditionalEPGsAttempt < this.additionalEPGsCooldown) {
                console.log(`🔔 Cooldown active (${Math.round((this.additionalEPGsCooldown - (now - this.lastAdditionalEPGsAttempt)) / 1000)}s remaining), skipping`)
                return
            }
            
            // Check maximum attempts limit
            if (this.additionalEPGsAttempts >= this.maxAdditionalEPGsAttempts) {
                console.log(`🔔 Maximum attempts (${this.maxAdditionalEPGsAttempts}) reached, stopping additional EPG loading`)
                return
            }
            
            const activeEPG = config.get('epg-' + lang.locale)
            if (activeEPG === 'disabled' || config.get('epg-suggestions') === false) {
                console.log('EPG suggestions disabled, skipping additional EPG load')
                return
            }
            
            // Set flag to prevent concurrent requests
            this.loadingAdditionalEPGs = true
            this.additionalEPGsAttempts++
            this.lastAdditionalEPGsAttempt = now
            
            try {
                console.log(`🔔 Attempting to load additional EPGs (attempt ${this.additionalEPGsAttempts}/${this.maxAdditionalEPGsAttempts})...`)
                const urls = await this.searchEPGs()
                console.log('🔔 EPGS urls for additional load:', urls)
                if (urls.length > 0) {
                    const loadedCount = await this.epg.suggest(urls)
                    console.log(`🔔 suggest() returned: loaded ${loadedCount} EPG(s)`)
                    
                    // If successfully loaded at least one EPG, reset attempts counter after a delay
                    if (loadedCount > 0) {
                        // Reset attempts after cooldown to allow future retries if needed
                        setTimeout(() => {
                            this.additionalEPGsAttempts = 0
                            console.log('🔔 Reset additional EPGs attempts counter after successful load')
                        }, this.additionalEPGsCooldown)
                    }
                } else {
                    console.log('🔔 No EPG URLs available to load')
                }
            } catch (err) {
                console.error('🔔 Error loading additional EPGs:', err)
            } finally {
                // Always clear the loading flag
                this.loadingAdditionalEPGs = false
            }
        })
        
        config.on('change', keys => {
            const key = 'epg-'+ lang.locale
            if(keys.includes(key) || keys.includes('locale')) {
                this.epg.sync(config.get(key) || []).catch(err => console.error(err))
                // Reapply channel terms index on EPG config/locale change
                const idx = global.channels?.channelList?.channelsIndex
                if (idx) {
                    this.epg.setChannelTermsIndex(idx)
                }
            }
            
            // Detect changes in epg-suggestions configuration
            if (keys.includes('epg-suggestions')) {
                const suggestionsEnabled = config.get('epg-suggestions') !== false
                console.log('🔄 EPG suggestions setting changed, updating EPGs...')
                this.epg.toggleSuggestedEPGs(suggestionsEnabled).catch(err => {
                    console.error('❌ Error toggling suggested EPGs:', err)
                })
                // Reapply channel terms index when suggestions setting changes
                const idx = global.channels?.channelList?.channelsIndex
                if (idx) {
                    this.epg.setChannelTermsIndex(idx)
                }
                if (suggestionsEnabled) {
                    this.epgSuggest().catch(err => console.error('❌ Error suggesting EPGs:', err))
                }
            }
        })

        // Reapply terms whenever channels finish loading (covers auto grid switching public/community)
        global.channels.on('loaded', changed => {
            if (changed) {
                const idx = global.channels?.channelList?.channelsIndex
                if (idx) {
                    this.epg.setChannelTermsIndex(idx)
                }
            }
        })

        return await this.epgSuggest()
    }
    async epgSuggest() {
        const activeEPG = config.get('epg-' + lang.locale)
        if (activeEPG === 'disabled' || config.get('epg-suggestions') === false) return
        const suggest = !activeEPG || activeEPG === 'auto' || (Array.isArray(activeEPG) && activeEPG.length > 0)
        console.log('shouldSuggest', suggest, activeEPG)
        if (!suggest) return
        const urls = await this.searchEPGs()
        console.log('EPGS urls - EPG', urls)
        urls.length && await this.epg.suggest(urls)
    }
    epgReady() {
        return new Promise(resolve => {
            if (this.epg.loaded) {
                resolve(true)
            } else {
                this.epgReadyListeners.push(resolve)
            }
        })
    }
    epgChannelsListSanityScore(data) {
        let count = Object.keys(data).length, idealCatCount = 8;
        if (count < 3) { // too few categories
            return 0;
        }
        let c = Math.abs(count - idealCatCount);
        return 100 - c;
    }
    async epgChannelsList(channelsList, limit) {
        let data, ret = this.epg.state
        if (!this.epg.loaded?.length) {
            // 'loading' state response format
            data = [ret.summary.activeEPGs > 0 ? 'loaded' : 'loading']
            if (ret.errorEPGs > 0) {
                data.push(`Failed EPGs: ${ret.errorEPGs}/${ret.totalEPGs}`)
            } else {
                data.push(ret.overallProgress)
            }
        } else {
            if (Array.isArray(channelsList)) {
                channelsList = channelsList.map(c => this.tools.applySearchRedirectsOnObject(c))
                data = await trackPromise(
                    this.epg.getMulti(channelsList, limit),
                    `epgChannelsList.getMulti(${channelsList.length} channels)`,
                    15000
                ).catch(err => {
                    console.warn('EPG getMulti timeout/error:', err.message || err);
                    return [];
                })
            } else {
                channelsList = this.tools.applySearchRedirectsOnObject(channelsList)
                data = await trackPromise(
                    this.epg.get(channelsList, limit),
                    `epgChannelsList.get(${channelsList.name})`,
                    12000
                ).catch(err => {
                    console.warn('EPG get timeout/error:', err.message || err);
                    return [];
                })
            }
        }
        return data
    }
    async getLiveNowAndNext(channelOrList, opts = {}) {
        const limit = Math.max(1, Number(opts.limit) || 2)
        const now = opts.now

        const prepareDescriptor = (input, index) => {
            if (input == null) {
                return {
                    name: `channel-${index}`,
                    searchName: '-',
                    terms: []
                }
            }

            if (typeof input === 'string') {
                return this.tools.applySearchRedirectsOnObject({
                    name: input,
                    searchName: input,
                    terms: this.tools.terms(input)
                })
            }

            const descriptor = { ...input }
            if (!descriptor.name && descriptor.searchName) {
                descriptor.name = descriptor.searchName
            } else if (!descriptor.searchName && descriptor.name) {
                descriptor.searchName = descriptor.name
            }

            if (!Array.isArray(descriptor.terms) || descriptor.terms.length === 0) {
                const base = descriptor.searchName || descriptor.name || ''
                descriptor.terms = this.tools.terms(base)
            }

            return this.tools.applySearchRedirectsOnObject(descriptor)
        }

        if (!this.epg.loaded?.length) {
            return Array.isArray(channelOrList) ? {} : null
        }

        if (Array.isArray(channelOrList)) {
            const preparedList = channelOrList.map((item, index) => prepareDescriptor(item, index))
            return await trackPromise(
                this.epg.getLiveNowAndNext(preparedList, { limit, now }),
                `getLiveNowAndNext(bulk ${preparedList.length} channels)`,
                15000
            ).catch(err => {
                console.warn('EPG getLiveNowAndNext (bulk) timeout/error:', err.message || err);
                return {};
            })
        }

        const prepared = prepareDescriptor(channelOrList, 0)
        if (!prepared || prepared.searchName === '-') {
            return null
        }

        return await trackPromise(
            this.epg.getLiveNowAndNext(prepared, { limit, now }),
            `getLiveNowAndNext(${prepared.name})`,
            10000
        ).catch(err => {
            console.warn('EPG getLiveNowAndNext timeout/error:', err.message || err);
            return null;
        })
    }
    async epgSearch(terms, nowLive) {
        if (!this.epg.loaded) return []
        return await trackPromise(
            this.epg.search(this.tools.applySearchRedirects(terms), nowLive),
            `epgSearch(${terms.join(' ')})`,
            12000
        ).catch(err => {
            console.warn('EPG search timeout/error:', err.message || err);
            return [];
        })
    }
    async epgSearchChannel(terms, limit) {
        if (!this.epg.loaded) return {}
        return await trackPromise(
            this.epg.searchChannel(this.tools.applySearchRedirects(terms), limit),
            `epgSearchChannel(${terms.join(' ')})`,
            10000
        ).catch(err => {
            console.warn('EPG searchChannel timeout/error:', err.message || err);
            return {};
        })
    }
    async epgLiveNowChannelsList() {
        
        const cacheKey = 'epg-live-now-channels-list'
        const cacheKeyFallback = 'epg-live-now-channels-list-fallback'
        const anyCache = () => storage.get(cacheKeyFallback, {throwIfMissing: true})
        const validCache = () => storage.get(cacheKey, {throwIfMissing: true})
        
        if (!this.epg.loaded) {
            return anyCache().catch(() => {
                return {categories: {}}
            })
        }

        const cached = await validCache().catch(() => null) // not expired cache
        let data = cached || await trackPromise(
            this.epg.liveNowChannelsList(),
            'epgLiveNowChannelsList()',
            20000
        ).catch(err => {
            console.warn('EPG liveNowChannelsList timeout/error:', err.message || err);
            return { categories: {} };
        })
        if (data?.categories && Object.keys(data['categories']).length) {
            try {
                let names = Object.keys(data['categories']).filter(c => c.length > 1).filter(c => this.parentalControl.allow(c))
                const clusters = await global.recommendations.reduceTags(names, {amount: 43})
                if (clusters && Object.keys(clusters).length) {
                    const categories = {}
                    for(const name in clusters) {
                        categories[name] = []
                        for(const category of clusters[name]) {
                            categories[name].push(...data['categories'][category])
                        }
                    }
                    for(const name of Object.keys(categories).sort()) {
                        categories[name] = [...new Set(categories[name])].sort().filter(c => c.length > 1).filter(c => this.parentalControl.allow(c))
                    }
                    if(Object.keys(categories).length) {
                        data.categories = categories
                        if(!data.updateAfter || data.updateAfter > 600) {
                            data.updateAfter = 600;
                        }
                    }
                }
            } catch(e) {
                console.error(e)
            }

            if(Object.keys(data.categories).length) {
                await Promise.allSettled([
                    storage.set(cacheKey, data, {ttl: 120}).catch(err => console.error(err)),
                    storage.set(cacheKeyFallback, data, {expiration: true}).catch(err => console.error(err))
                ])
                return data
            }
        }
        return anyCache().catch(() => {
            return {categories: {}}
        })
    }
    epgScore(url) {
        if(this.epgScoreCache[url] !== undefined) {
            return this.epgScoreCache[url]
        }
        let score = 0
        if (this.epgs[url]) {
            const origins = new Set()
            for(const u of this.epgs[url]) {
                this.lists[u] && origins.add(this.lists[u].origin)
            }
            if (origins.has('own')) score += 10
            else if (origins.has('community')) score += 0.5
            else if (origins.has('public')) score += 0.2
        }
        if (url.match(this.regexSameCountry)) score += 7
        else if (this.activeCountries && this.activeCountries.length && url.match(this.regexCountries)) score += 3
        this.epgScoreCache[url] = score
        return score
    }
    async resetEPGScoreCache() {
        this.epgScoreCache = {}
        const activeCountries = await lang.getActiveCountries().catch(err => console.error(err))
        if(!activeCountries || !activeCountries.length || (this.activeCountries && (activeCountries.join('') == this.activeCountries.join('')))) {
            return
        }
        this.activeCountries = activeCountries
        const any = '[^a-zA-Z0-9]'
        this.regexSameCountry = new RegExp('(' + any + '|^)' + lang.countryCode + '(' + any + '|$)', 'i')
        this.regexCountries = new RegExp('(' + any + '|^)(' + this.activeCountries.join('|') + ')(' + any + '|$)', 'i')
        if(!this.watchingActiveCountries) {
            this.watchingActiveCountries = true
            this.on('list-loaded', async () => {
                this.activeCountries = undefined
            })
            this.epg.on('update', async () => {
                this.activeCountries = undefined
            })
            config.on('change', async keys => {
                if(keys.includes('countries')) {
                    this.activeCountries = undefined // force cache reset
                }
            })
        }
    }
    async searchEPGs(limit = 24, mandatories) {
        if(!Array.isArray(this.activeCountries)) {
            await this.resetEPGScoreCache()
        }

        const activeCountries = this.activeCountries || await lang.getActiveCountries()
        let epgs = Object.keys(this.epgs)
        if (this.epg.loaded) {
            epgs.push(...this.epg.loaded.filter(u => !epgs.includes(u)))
        }

        const c = config.get('epg-'+ lang.locale)
        if (Array.isArray(c) && c.length) {
            epgs.push(...c.filter(e => e.active && !epgs.includes(e.url)).map(e => e.url))
        }

        const o = await cloud.get('configure', {shadow: false}).catch(() => null)
        if(o?.epg) {
            for(const code of activeCountries) {
                if (o.epg[code] && !epgs.includes(o.epg[code])) {
                    epgs.push(o.epg[code])
                }
            }
        }
        if (o?.epgs) {
            for(const code of activeCountries) {
                if (o.epgs[code]) {
                    epgs.push(...o.epgs[code].filter(u => !epgs.includes(u)))
                }
            }
        }
        
        if(Array.isArray(global?.channels?.trending.currentRawEntries)) {
            global.channels.trending.currentRawEntries.forEach(e => {
                if(e.epg) {
                    epgs.push(...parseCommaDelimitedURIs(e.epg).filter(u => !epgs.includes(u)))
                }
            })
        }

        if (!epgs.length) return epgs
    
        // Precompute scores to avoid multiple scorify calls
        const epgScores = epgs.map(e => ({epg: e, score: this.epgScore(e)}))
        epgScores.sort((a, b) => b.score - a.score || a.epg.localeCompare(b.epg))
    
        let mandatoriesFound = mandatories instanceof Set ? epgs.filter(e => mandatories.has(e)).length : 0
        let freeQuota = limit - mandatoriesFound
    
        const result = []
        for (const { epg } of epgScores) {
            if (mandatoriesFound && mandatories.has(epg)) {
                mandatoriesFound--
                result.push(epg)
            } else if (freeQuota) {
                freeQuota--
                result.push(epg)
            }
            if (!freeQuota && !mandatoriesFound) break
        }    
        return result
    } 
}
class Lists extends ListsEPGTools {
    constructor(opts) {
        super(opts)
        if(inWorker) throw new Error('Lists cannot be used in a worker')
        this.setMaxListeners(256)
        this.debug = false
        this.lists = {}
        this.activeLists = {
            my: [],
            community: [],
            length: 0
        };
        this.epgs = {}
        this.myLists = [];
        this.processedLists = new Map();
        this.requesting = {};
        this.satisfied = false;
        this.communityListsAmount = config.get('community-mode-lists-amount');
        this.isFirstRun = !this.communityListsAmount && !config.get('lists').length;
        this.queue = new PQueue({concurrency: 4});
        config.on('change', (keys, data) => {
            if (keys.includes('lists')) {
                this.handleListsChange();
            }
            if (keys.includes('community-mode-lists-amount')) {
                this.handleCommunityListsAmountChange(data);
            }
        })
        ready(async () => {
            global.channels.on('loaded', changed => {
                if (changed) {
                    this._relevantKeywords = null
                    const idx = global.channels?.channelList?.channelsIndex
                    if (idx) this.epg.setChannelTermsIndex(idx)
                }
            })
        });
        this.on('satisfied', () => {
            if (this.activeLists.length) {
                this.setQueueConcurrency(1)
            }
        });
        this.on('unsatisfied', () => {
            this.setQueueConcurrency(4)
            clearInterval(this.stateInterval)
            this.stateInterval = setInterval(() => this.updateState(), 1000)
        });
        this.state = {}
        this.discovery = new Discovery(this)
        this.loader = new Loader(this)
        this.manager = new Manager(this)
        this.communityRetryDismissed = false
        this.loader.on('community-idle', info => {
            if (this.manager && typeof this.manager.onCommunityIdle === 'function') {
                this.manager.onCommunityIdle(info)
            }
        })
        this.loader.on('public-idle', info => {
            if (this.manager && typeof this.manager.onPublicIdle === 'function') {
                this.manager.onPublicIdle(info)
            }
        })
        
        // Set to track lists that are being updated
        this.updatingLists = new Set()
        
        process.nextTick(() => {
            this.handleListsChange()     
            this.updateState()   
            this.emit('unsatisfied')
        
            // Initial check for loaded lists with missing meta files
            setTimeout(async () => {
                try {
                    await this.checkAndFixLoadedListsWithMissingMeta();
                } catch (err) {
                    console.error('Error in initial meta file check:', err);
                }
            }, 2000);
        })
        
        // Periodic check for lists with missing meta files (every 5 minutes)
        this.metaCheckInterval = setInterval(async () => {
            try {
                // Clean up stuck states first
                this.cleanupStuckStates();
                
                // Check for loaded lists with missing meta files
                await this.checkAndFixLoadedListsWithMissingMeta();
                
                // Only check URLs that are not currently being processed
                const allUrls = Object.keys(this.lists).concat(this.myLists);
                const urlsToCheck = allUrls.filter(url => 
                    !this.processedLists.has(url) && 
                    !this.requesting[url] && 
                    !this.loader.processes.some(p => p.url === url)
                );
                
                if (urlsToCheck.length > 0) {
                    await this.scheduleUpdateForMissingMeta(urlsToCheck);
                }
            } catch (err) {
                console.error('Error in periodic meta file check:', err);
            }
        }, 5 * 60 * 1000); // 5 minutes
    }
    async ready(timeoutSecs) {
        if(!this.satisfied) {
            const promises = [
                new Promise(resolve => this.once('satisfied', resolve))
            ]
            timeoutSecs && promises.push(this.wait(timeoutSecs * 1000))
            await Promise.race(promises)
        }
        return this.satisfied
    }
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
    setQueueConcurrency(concurrency) {
        this.queue.concurrency = concurrency
        this.queue._concurrency = concurrency // try to change pqueue concurrency dinamically
    }
    getAuthURL(listUrl) {
        if (listUrl && this.lists[listUrl] && this.lists[listUrl].index && this.lists[listUrl].index.meta && this.lists[listUrl].index.meta['auth-url']) {
            return this.lists[listUrl].index.meta['auth-url'];
        }
        return listUrl;
    }
    handleListsChange() {
        const myLists = config.get('lists').map(l => l[1]);
        const newLists = myLists.filter(u => !this.myLists.includes(u));
        const rmLists = this.myLists.filter(u => !myLists.includes(u));
        this.myLists = myLists;
        rmLists.forEach(u => this.remove(u));
        
        // Load cached lists first (if they exist)
        this.loadCachedLists(newLists).catch(err => console.error(err))
        
        // Also enqueue new lists in loader to ensure they are downloaded if not cached
        // This ensures manual additions are processed even if not cached
        if (newLists.length > 0) {
            this.loader.enqueue(newLists, 1).catch(err => console.error('Error enqueueing new lists:', err));
        }
    }
    handleCommunityListsAmountChange(data, force) {
        if (force === true || this.communityListsAmount != data['community-mode-lists-amount']) {
            this.communityListsAmount = data['community-mode-lists-amount'];
            // Force trim to remove community lists if quota is now 0
            this.trim();
        }
    }
    setCommunityRetryDismissed(dismissed = true) {
        this.communityRetryDismissed = dismissed === true;
    }
    async retryCommunityLists(opts = {}) {
        const { bypassCache = false } = opts;
        if (bypassCache) {
            const communityProvider = this.discovery.getProvider('community', 'community-lists');
            communityProvider?.setForceRefresh?.(true);
            const communityOrgProvider = this.discovery.getProvider('community', 'community-lists-iptv-org');
            communityOrgProvider?.setForceRefresh?.(true);
        }
        this.loader.resetCommunityIdle();
        try {
            await this.discovery.reset();
        } catch (err) {
            console.error('lists.retryCommunityLists discovery reset failed:', err);
        }
        this.loader.reset();
    }

    async checkListFiles(url) {
        const file = resolveListDatabaseFile(url)
        const metaFile = file.replace(/\.jdb$/i, '.meta.jdb')
        const listMetaFile = resolveListMetaPath(url)

        let mainStat = null
        let metaStat = null
        let listMetaStat = null

        try {
            mainStat = await fs.promises.stat(file)
        } catch (err) {
            return {
                hasMain: false,
                hasMeta: false,
                isCached: false,
                hasMissingMeta: false,
                mainSize: 0,
                metaSize: 0
            }
        }

        try {
            metaStat = await fs.promises.stat(metaFile)
        } catch (err) {
            metaStat = null
        }

        try {
            listMetaStat = await fs.promises.stat(listMetaFile)
        } catch (err) {
            listMetaStat = null
        }

        const hasMain = mainStat && mainStat.size >= 1024
        let hasMeta = false
        let metaSize = 0

        if (metaStat && metaStat.size > 0) {
            hasMeta = true
            metaSize += metaStat.size
        }

        if (!hasMeta && listMetaStat && listMetaStat.size > 0) {
            try {
                const metaData = await getListMeta(url)
                const hasValidMeta = metaData && typeof metaData === 'object' && (
                    Object.keys(metaData.meta || {}).length > 0 ||
                    Object.keys(metaData.gids || {}).length > 0 ||
                    Array.isArray(metaData.groupsTypes?.live) ||
                    Array.isArray(metaData.groupsTypes?.vod) ||
                    Array.isArray(metaData.groupsTypes?.series) ||
                    typeof metaData.length === 'number'
                )
                if (hasValidMeta) {
                    hasMeta = true
                    metaSize += listMetaStat.size
                } else {
                    if (this.debug) {
                        console.log('checkListFiles: list-meta.jdb exists but metadata is invalid for', url)
                    }
                }
            } catch (err) {
                if (this.debug) {
                    console.log('checkListFiles: failed to read list-meta.jdb for', url, err)
                }
            }
        }

        return {
            hasMain,
            hasMeta,
            isCached: hasMain && hasMeta,
            hasMissingMeta: hasMain && !hasMeta,
            mainSize: mainStat?.size || 0,
            metaSize
        }
    }
    
    async isListCached(url) {
        const result = await this.checkListFiles(url)
        return result.isCached
    }
    
    async hasMissingMetaFile(url) {
        const result = await this.checkListFiles(url)
        return result.hasMissingMeta
    }
    
    async scheduleUpdateForMissingMeta(urls) {
        if (!Array.isArray(urls)) {
            urls = [urls];
        }
        
        // Prevent recursion by filtering out URLs that are already being processed
        const filteredUrls = urls.filter(url => 
            !this.processedLists.has(url) && 
            !this.requesting[url] && 
            !this.loader.processes.some(p => p.url === url)
        );
        
        if (!filteredUrls.length) {
            return [];
        }
        
        const urlsWithMissingMeta = [];
        const limit = pLimit(8);
        const checkTasks = filteredUrls.map(url => {
            return async () => {
                const result = await this.checkListFiles(url);
                if (result.hasMissingMeta) {
                    urlsWithMissingMeta.push(url);
                }
            };
        }).map(limit);
        
        await Promise.allSettled(checkTasks).catch(err => console.error(err));
        
        if (urlsWithMissingMeta.length > 0) {
            if (this.debug) {
                console.log('Scheduling updates for lists with missing meta files:', urlsWithMissingMeta);
            }
            
            // Mark these URLs as being processed to prevent recursion
            // Use a more atomic approach to prevent race conditions
            const urlsToSchedule = [];
            for (const url of urlsWithMissingMeta) {
                this.processedLists.delete(url);
                this.remove(url);
                this.requesting[url] = 'scheduled for meta update';
                urlsToSchedule.push(url);
            }
            
            if (urlsToSchedule.length > 0) {
                this.loader.enqueue(urlsToSchedule, 9); // High priority
            }
        }
        
        return urlsWithMissingMeta;
    }
    async filterCachedUrls(urls) {
        if (this.debug)
            console.log('filterCachedUrls', urls.join("\r\n"));
        let loadedUrls = [], cachedUrls = [], urlsWithMissingMeta = [];
        urls = urls.filter(u => {
            if (typeof(this.lists[u]) == 'undefined') {
                return true;
            }
            loadedUrls.push(u);
        });
        if (urls.length) {
            const limit = pLimit(8), tasks = urls.map(url => {
                return async () => {
                    let err;
                    const fileInfo = await this.checkListFiles(url).catch(e => err = e);
                    if (this.debug)
                        console.log('filterCachedUrls', url, fileInfo);
                    if (fileInfo && fileInfo.isCached === true) {
                        cachedUrls.push(url);
                        if (!this.requesting[url]) {
                            this.requesting[url] = 'cached, not added';
                        }
                    } else if (fileInfo && fileInfo.hasMissingMeta === true) {
                        urlsWithMissingMeta.push(url);
                        if (!this.requesting[url]) {
                            this.requesting[url] = 'missing meta';
                        }
                    } else {
                        if (!this.requesting[url]) {
                            this.requesting[url] = err || 'not cached';
                        }
                    }
                };
            }).map(limit);
            await Promise.allSettled(tasks).catch(err => console.error(err));
        }
        if (this.debug)
            console.log('filterCachedUrls', loadedUrls.join("\r\n"), cachedUrls.join("\r\n"), urlsWithMissingMeta.join("\r\n"));
        loadedUrls.push(...cachedUrls);
        // Return object with both cachedUrls and urlsWithMissingMeta to avoid duplicate checkListFiles calls
        return {
            cachedUrls: loadedUrls,
            urlsWithMissingMeta: urlsWithMissingMeta
        };
    }
    updaterFinished(isFinished) {
        if(this.isUpdaterFinished != isFinished) {
            this.isUpdaterFinished = isFinished;
            process.nextTick(() => this.updateState()) // force state update
        }
        return this.isUpdaterFinished;
    }
    async relevantKeywords() {
        return global.channels?.channelList?.getKeywords?.() || [];
    }
    async loadCachedLists(lists, alreadyFiltered = false) {
        let hits = 0;
        if (this.debug) {
            console.log('Checking for cached lists...', lists);
        }
        if (!lists.length) return hits
        
        // filterCachedUrls already checks for complete files (main + meta)
        // Skip filtering if already filtered to avoid duplicate I/O operations
        if (!alreadyFiltered) {
            const filterResult = await this.filterCachedUrls(lists);
            // Handle both old format (array) and new format (object)
            lists = Array.isArray(filterResult) ? filterResult : (filterResult.cachedUrls || []);
        } else {
            // If already filtered, ensure we have an array
            lists = Array.isArray(lists) ? lists : (lists.cachedUrls || []);
        }

        const publicListsActive = config.get('public-lists');
        const communityListsQuota = Math.max(this.communityListsAmount - this.myLists.length, 0);
        const loadedCommunityCount = this.loadedListsCount('community');
        const remainingCommunitySlots = Math.max(communityListsQuota - loadedCommunityCount, 0);
        await this.computeCachedRelevances(lists);
        const relevances = await this.getCachedRelevances(lists);
        const listInfo = lists.map(url => {
            const origin = this.myLists.includes(url)
                ? 'own'
                : (this.discovery.details(url, 'type') || 'community');
            return { url, origin, relevance: relevances[url]?.total || 0 };
        });

        const owned = listInfo.filter(item => item.origin === 'own');
        const community = listInfo.filter(item => item.origin === 'community');
        const publicLists = listInfo.filter(item => item.origin === 'public');

        const byRelevance = (a, b) => b.relevance - a.relevance || a.url.localeCompare(b.url);
        community.sort(byRelevance);
        publicLists.sort(byRelevance);

        const selectedCommunity = remainingCommunitySlots > 0
            ? community.slice(0, remainingCommunitySlots)
            : [];
        const selectedPublic = publicListsActive ? publicLists : [];
        lists = [...owned, ...selectedCommunity, ...selectedPublic].map(item => item.url);
        
        this.trim(); // helps to avoid too many lists in memory
        
        // Load lists that passed the filter (they have both main and meta files)
        const loadLimit = pLimit(1);
        const loadTasks = lists.map(url => {
            return async () => {
                if (typeof(this.lists[url]) != 'undefined') {
                    return; // Already loaded
                }
                
                // Check if not being updated before loading (avoids race conditions)
                if (this.isListUpdating(url)) {
                    if (this.debug) {
                        console.log(`Skipping ${url} - update in progress`)
                    }
                    return
                }
                
                try {
                    await this.loadList(url);
                    hits++;
                } catch (err) {
                    if(!String(err).match(/destroyed|list discarded|file not found/i)) {
                        console.error(err);
                    }
                }
                if (this.satisfied) {
                    this.trim();
                }
            };
        }).map(loadLimit);
        
        const settled = await Promise.allSettled(loadTasks).catch(err => {
            console.error('loadCachedLists: Promise.allSettled failed', err);
            return [];
        });
        console.log('loadCachedLists: settled results', JSON.stringify(settled, null, 2));
        
        // Final trim after all lists are loaded to enforce limits
        this.trim();
        
        if (this.debug) {
            console.log('Cached lists loaded:', hits);
        }
        return hits;
    }
    
    /**
     * Marks a list as being updated (or not)
     * @param {string} url - List URL
     * @param {boolean} isUpdating - true if being updated, false otherwise
     */
    markListUpdating(url, isUpdating) {
        if (isUpdating) {
            this.updatingLists.add(url)
            // If list is already loaded, mark as "suspended" to avoid conflicts
            if (this.lists[url]) {
                if (this.debug) {
                    console.log(`Suspending list during update: ${url}`)
                }
                // Don't remove completely, just mark as "suspended"
                if (this.lists[url]) {
                    this.lists[url]._suspendedForUpdate = true
                }
            }
        } else {
            this.updatingLists.delete(url)
            // Remove suspension marking if list exists
            if (this.lists[url]) {
                this.lists[url]._suspendedForUpdate = false
            }
        }
    }
    
    /**
     * Check if a list is being updated
     * @param {string} url - List URL
     * @returns {boolean} true if being updated
     */
    isListUpdating(url) {
        return this.updatingLists.has(url)
    }
    
    updateState() {
        let progress = 0, satisfyAmount = this.myLists.length
        const isUpdatingFinished = this.isUpdaterFinished && !this.queue.size
        const communityListsAmount = this.communityListsAmount
        const progresses = this.myLists.map(url => this.lists[url]?.ready.is() ? 100 : 0)
        const lks = Object.values(this.lists).map(l => {
            const progress = l.ready.is() ? 100 : 0
            return {
                url: l.url,
                progress,
                origin: l.origin
            }
        })
        if (communityListsAmount > satisfyAmount) {
            satisfyAmount = communityListsAmount
        }
        if (satisfyAmount > 3) { // 3 lists should be enough to start tuning
            satisfyAmount = 3
        }
        if (isUpdatingFinished || !satisfyAmount) {
            progress = 100
        } else {
            const communityListsQuota = communityListsAmount - this.myLists.length;
            if (communityListsQuota) {
                let ls;
                if (config.get('public-lists') != 'only') {
                    ls = lks.filter(l => l.origin != 'public');
                } else {
                    ls = lks;
                }
                progresses.push(...ls.map(l => l.progress).sort((a, b) => b - a).slice(0, communityListsQuota));
                const left = communityListsQuota - progresses.length;
                if (left > 0) {
                    progresses.push(...Object.keys(this.loader.progresses).filter(u => !this.lists[u]).map(u => this.loader.progresses[u]).sort((a, b) => b - a).slice(0, left));
                }
            }
            const allProgress = satisfyAmount * 100
            const sumProgress = progresses.reduce((a, b) => a + b, 0)
            progress = Math.min(parseInt(sumProgress / (allProgress / 100)), 100)
        }
        
        if(!this.state || this.state.progress != progress || this.state.length != lks.length) {
            const ret = {
                progress,
                firstRun: this.isFirstRun,
                length: lks.length
            }
            if (progress > 99) {
                if (!this.satisfied) {
                    this.satisfied = true
                    this.emit('satisfied')
                    clearInterval(this.stateInterval)
                }
            } else {
                if (this.satisfied) {
                    this.satisfied = false
                    this.emit('unsatisfied')
                }
            }
            this.state = ret
            this.emit('state', ret)
                
            let communityUrls = lks.map(u => this.myLists.includes(u) ? null : u).filter(u => u != null);
            this.activeLists = {
                my: this.myLists,
                community: communityUrls,
                length: this.myLists.length + communityUrls.length
            }
            
            // Ensure limits are enforced after state update
            this.trim();
        }
    }
    loaded(isEnough) {
        if (isEnough === true) {
            if (config.get('public-lists') != 'only' && !Object.values(this.lists).filter(l => l.origin != 'public').length) {
                return false
            }
        }
        this.updateState()
        return this.state.progress > 99
    }
    async loadList(url, contentLength, forceReload = false) {
        url = forwardSlashes(url)
        this.processedLists.has(url) || this.processedLists.set(url, 1)
        if (typeof(contentLength) != 'number') { // contentLength controls when the list should refresh
            try {
                contentLength = await this.getContentLength(url);
                if (typeof(contentLength) != 'number') {
                    contentLength = 0 // ok, give up and load list anyway
                }
            } catch (err) {
                console.error(err)
                contentLength = 0 // ok, give up and load list anyway
            }
        }
        let err, isMine = this.myLists.includes(url);
        if (this.debug) {
            console.log('loadList start', url);
        }
        if (this.lists[url]) {
            if (!forceReload && this.lists[url].contentLength == contentLength && this.lists[url].ready.is()) {
                return this.lists[url]
            }
            this.remove(url)
        }
            
        this.requesting[url] = 'loading';
        const list = new List(url, this);
        list.contentLength = contentLength
        list.isConnectableResult = 1 // 1 = unknown, 2 = yes, 0 = no
        
        // Track retry attempts for corrupted metadata to prevent infinite loops
        if (!this.metaRetryCount) {
            this.metaRetryCount = new Map();
        }
        const retryCount = this.metaRetryCount.get(url) || 0;
        if (isMine) {
            list.origin = 'own';
        } else {
            list.origin = this.discovery.details(url, 'type') || 'community';
        }
        list.once('destroy', () => {
            if (!this.requesting[url] || (this.requesting[url] == 'loading')) {
                this.requesting[url] = 'destroyed';
            }
            if (isMine && this.myLists.includes(url)) { // isMine yet?
                console.error('Damn! My list got destroyed!', url);
            }
            this.remove(url);
        });
        this.lists[url] = list;
        try {
            await list.ready()
            try {
                await list.checkRelevance()
            } catch (e) {
                console.error('List checkRelevance error:', url, e);
                throw e
            }
        } catch (e) {
            list.checkRelevanceError = e
            err = e
            
            // Check if the error is due to missing meta file
            if (String(e).includes('meta file not found or empty')) {
                if (this.debug) {
                    console.log('List has missing meta file, scheduling update:', url);
                }
                // Prevent recursion by checking if already being processed
                if (!this.processedLists.has(url) && !this.requesting[url] && !this.loader.processes.some(p => p.url === url)) {
                    this.processedLists.set(url, null);
                    this.requesting[url] = 'scheduled for meta update from loadList';
                    this.loader.enqueue([url], 1); // High priority
                }
                this.processedLists.delete(url);
                this.lists[url] && this.remove(url);
                this.updateState();
                throw new Error('meta file missing, update scheduled');
            }
            
            // Check if the error is due to indexer/database not being available
            if (String(e).includes('List indexer or database not available')) {
                if (this.debug) {
                    console.log('List indexer or database not available, scheduling update:', url);
                }
                // Prevent recursion by checking if already being processed
                if (!this.processedLists.has(url) && !this.requesting[url] && !this.loader.processes.some(p => p.url === url)) {
                    this.processedLists.set(url, null);
                    this.requesting[url] = 'scheduled for update due to missing indexer/db';
                    this.loader.enqueue([url], 1); // High priority
                }
                this.processedLists.delete(url);
                this.lists[url] && this.remove(url);
                this.updateState();
                throw new Error('indexer/database not available, update scheduled');
            }
            
            // Check if the error is due to groups validation failure
            if (String(e).includes('groups validation failed')) {
                if (this.debug) {
                    console.log('Groups validation failed, scheduling update:', url);
                }
                // Prevent recursion by checking if already being processed
                if (!this.processedLists.has(url) && !this.requesting[url] && !this.loader.processes.some(p => p.url === url)) {
                    this.processedLists.set(url, null);
                    this.requesting[url] = 'scheduled for groups update from loadList';
                    this.loader.enqueue([url], 1); // High priority
                }
                this.processedLists.delete(url);
                this.lists[url] && this.remove(url);
                this.updateState();
                throw new Error('groups validation failed, update scheduled');
            }
            
            // Check if the error is due to corrupted metadata
            if (String(e).includes('meta file exists but contains no valid data')) {
                console.error(`🚨 CORRUPTED METADATA DETECTED: ${url} - Attempt ${retryCount + 1}/3`);
                console.error(`📊 Metadata corruption details:`, {
                    url,
                    error: e.message,
                    retryCount: retryCount + 1,
                    maxRetries: 3
                });
                
                // Increment retry count
                this.metaRetryCount.set(url, retryCount + 1);
                
                // If we've exceeded max retries, give up and remove from lists
                if (retryCount >= 2) {
                    console.error(`❌ MAX RETRIES EXCEEDED: Removing corrupted list ${url} after ${retryCount + 1} attempts`);
                    this.processedLists.delete(url);
                    this.lists[url] && this.remove(url);
                    this.updateState();
                    throw new Error(`corrupted metadata - max retries exceeded (${retryCount + 1}/3)`);
                }
                
                // Schedule retry with lowest priority to avoid infinite loops
                if (!this.processedLists.has(url) && !this.requesting[url] && !this.loader.processes.some(p => p.url === url)) {
                    this.processedLists.set(url, null);
                    this.requesting[url] = `scheduled for metadata repair (attempt ${retryCount + 1}/3)`;
                    // Use lowest priority (9) and add delay to prevent rapid retries
                    setTimeout(() => {
                        this.loader.enqueue([url], 9); // Lowest priority - goes to end of queue
                    }, 2000 * (retryCount + 1)); // Exponential backoff
                }
                this.processedLists.delete(url);
                this.lists[url] && this.remove(url);
                this.updateState();
                throw new Error(`corrupted metadata - retry scheduled (${retryCount + 1}/3)`);
            }
        }
        if(list.relevance && typeof(list.relevance.total) == 'number') {
            this.discovery.reportHealth(url, list.relevance.total)
        }
        
        // Clear retry count on successful load
        if (this.metaRetryCount && this.metaRetryCount.has(url)) {
            this.metaRetryCount.delete(url);
            if (this.debug) {
                console.log(`✅ Metadata retry count cleared for successful load: ${url}`);
            }
        }
        if (err && !this.myLists.includes(url)) {
            this.processedLists.delete(url);
            if (!this.requesting[url] || this.requesting[url] == 'loading') {
                this.requesting[url] = err;
            }
            this.lists[url] && this.remove(url);
            this.updateState();
            throw err;
        } else {
            if (this.debug) {
                console.log('loadList started', url);
            }
            let repeated, expired, isAdding = this.manager.addingLists.has(url);
            if (!this.lists[url] || (!isMine && !isAdding && 
                (expired = this.seemsExpiredList(this.lists[url])) || (repeated = this.isRepeatedList(url)))) {
                if (!this.requesting[url] || this.requesting[url] == 'loading') {
                    this.requesting[url] = repeated ? 'repeated at ' + repeated : (expired ? 'seems expired, destroyed' : 'loaded, but destroyed')
                }
                if (this.debug) {
                    if (repeated) {
                        console.log('List ' + url + ' repeated, discarding.')
                    } else {
                        console.log('List ' + url + ' already discarded.')
                    }
                }
                if (this.lists[url]) {
                    this.remove(url);
                }
                this.updateState();
                throw 'list discarded';
            } else {
                if (this.debug) {
                    console.log('loadList else', url);
                }
                // Save index metadata to database
                if (list.index?.meta?.epg) {
                    const epgs = parseCommaDelimitedURIs(list.index.meta.epg)
                    for(const epg of epgs) {
                        if(!this.epgs[epg]) this.epgs[epg] = new Set()
                        this.epgs[epg].add(url)
                    }
                }
                if (this.debug) {
                    console.log('loadList else', url);
                }
                let cErr;
                const contentAlreadyLoaded = await this.isSameContentLoaded(list).catch(e => cErr = e);
                if (this.debug) {
                    console.log('loadList contentAlreadyLoaded', contentAlreadyLoaded);
                }
                if (cErr || contentAlreadyLoaded) {
                    this.requesting[url] = cErr ? String(cErr) : 'content already loaded';
                    if (this.debug) {
                        console.log('Content already loaded', url);
                    }
                    if (this.lists[url]) {
                        this.remove(url);
                    }
                    this.updateState();
                    throw cErr ? cErr : 'content already loaded';
                } else {
                    let replace
                    this.requesting[url] = 'added';
                    const communityListsQuota = Math.max(this.communityListsAmount - this.myLists.length, 0);
                    if (!isMine && this.loadedListsCount('community') >= communityListsQuota) {
                        replace = this.shouldReplace(list)
                        if (replace && replace != url) {
                            const pr = this.lists[replace].relevance?.total || 0
                            const listTotal = list.relevance?.total || 0
                            if (this.debug) {
                                console.log('List', url, listTotal, 'will replace', replace, pr);
                            }
                            this.remove(replace)
                            this.requesting[replace] = 'replaced by ' + url + ', ' + pr + ' < ' + listTotal;
                            this.requesting[url] = 'added in place of ' + replace + ', ' + pr + ' < ' + listTotal;
                        }
                    }
                    if (this.debug) {
                        console.log('Added community list...', url, list.length);
                    }
                    if (!replace) {
                        this.trim();
                    }
                    list.isConnectable().then(() => {
                        list.isConnectableResult = 2
                        // Trim again after list is fully ready
                        this.trim();
                    }).catch(err => {
                        if(!this.lists[url]) return
                        list.isConnectableResult = 0
                        if(this.requesting[url] == 'loading') {
                            this.requesting[url] = err
                        }
                        // Trim even on error to ensure limits
                        this.trim();
                    })
                    this.emit('list-loaded', url)
                }
            }
        }
        this.updateState()
        return this.lists[url]
    }
    async getListContentLength(url) {
        return await this.getContentLength(url)
    }
    async shouldReloadList(url) {
        let loadedContentLength = this.lists[url].contentLength;
        const updatedContentLength = await this.getListContentLength(url);
        if (updatedContentLength > 0 && updatedContentLength == loadedContentLength) {
            return false;
        } else {
            return updatedContentLength;
        }
    }
    shouldReplace(list) {
        if (!list) {
            console.error('shouldReplace error: no list given', list)
            return
        }        
        const communityListsAmount = this.communityListsAmount
        const communityListsQuota = Math.max(communityListsAmount - this.myLists.length, 0)
        if (this.loadedListsCount('community') >= communityListsQuota) {
            const urlsToRemove = this.sortCommunityLists()
            for(const url of urlsToRemove) {
                if (this.lists[url].isConnectableResult == 0) { // 0=not connectable
                    return url
                }
            }
            return urlsToRemove.pop()
        }
    }
    isRepeatedList(url) {
        if (!url || !this.lists[url] || !this.lists[url].index || this.myLists.includes(url)) {
            return
        }
        // Skip if list is being updated
        if (this.isListUpdating(url)) {
            return
        }
        for(const k in this.lists) {
            // Skip lists that are being updated
            if (this.isListUpdating(k)) {
                continue
            }
            if (k == url || !this.lists[k].index) {
                continue
            }
            if (this.lists[k].length == this.lists[url].length) {
                if (JSON.stringify(this.lists[k].length) == JSON.stringify(this.lists[url].length)) {
                    return k
                }
            }
        }
    }
    seemsExpiredList(list) {
        if (!list || !list.index) {
            return;
        }
        if (list.ready.is() && !list.length) {
            return true; // loaded with no content
        }
        if (this.loader.results[list.url]) {
            const ret = String(this.loader.results[list.url] || '');
            if (ret.startsWith('failed') && ['401', '403', '404', '410'].includes(ret.substr(-3))) {
                return true;
            }
        }
        const minQuota = list.length * 0.6;
        const indexLength = list.index?.length ?? 0;
        if (indexLength < 128 && indexLength < minQuota) {
            return true;
        }
    }
    async isListExpired(url, test) {
        if (!this.lists[url])
            return false;
        if (this.seemsExpiredList(this.lists[url]))
            return true;
        if (!test)
            return false;
        let err;
        const connectable = await this.lists[url].isConnectable().catch(e => err = e);
        return err || !connectable;
    }
    async isSameContentLoaded(list) {
        let err, alreadyLoaded, listDataFile = list.file, listIndexLength = list.length;
        const stat = await fs.promises.stat(listDataFile).catch(e => err = e);
        if (!err && !stat?.size) {
            err = new Error('file empty or not found');
        }
        if (err) {
            throw err; // force this list discarding
        } else {
            const size = stat.size;
            const limit = pLimit(3);
            const tasks = Object.keys(this.lists).map(url => {
                return async () => {
                    if (url === list.url) {
                        return;
                    }

                    // Skip lists that are being updated
                    if (this.isListUpdating(url)) {
                        return
                    }
                    if (!alreadyLoaded && url != list.url && this.lists[url] && this.lists[url].length == listIndexLength) {
                        const f = this.lists[url].file;
                        const s = await fs.promises.stat(f).catch(() => null);
                        if (s && !alreadyLoaded) {
                            if (this.debug) {
                                console.log('already loaded', list.url, url, f, listDataFile, size, s.size);
                            }
                            if (size == s.size) {
                                alreadyLoaded = true;
                            }
                        }
                    }
                };
            }).map(limit);
            await Promise.allSettled(tasks);
            return alreadyLoaded;
        }
    }
    loadedListsCount(origin) {
        const loadedLists = Object.values(this.lists).filter(l => l.ready.is()).filter(l => {
            return !origin || (origin == l.origin);
        }).map(l => l.url);
        return loadedLists.length;
    }
    getMyLists() {
        const hint = this.communityListsAmount;
        return config.get('lists').map(c => {
            const url = c[1];
            const e = {
                name: c[0],
                owned: true,
                url
            };
            if (this.lists[url] && this.lists[url].relevance) {
                e.score = this.lists[url].relevance.total || 0;
                if (this.lists[url].index.meta) {
                    e.name = this.lists[url].index.meta.name;
                    e.icon = this.lists[url].index.meta.icon;
                    e.epg = this.lists[url].index.meta.epg;
                }
                e.length = this.lists[url].length;
            }
            if (c.length > 2) {
                Object.keys(c[2]).forEach(k => {
                    e[k] = c[2][k];
                });
            }
            if (typeof(e['private']) == 'undefined') {
                e['private'] = !hint;
            }
            return e;
        });
    }
    info(includeNotReady) {
        const info = {}
        for(const url in this.lists) {
            if (!includeNotReady && !this.lists[url].ready.is())
                continue
            info[url] = { url, owned: false };
            info[url].score = this.lists[url].relevance?.total || 0
            info[url].length = this.lists[url].length
            info[url].origin = this.lists[url].origin
            if (this.lists[url].index.meta) {
                info[url].name = this.lists[url].index.meta.name
                info[url].icon = this.lists[url].index.meta.icon
                info[url].epg = this.lists[url].index.meta.epg
            }
            info[url].private = false // community list
        }
        this.getMyLists().forEach(l => {
            if (!info[l.url])
                info[l.url] = l
            info[l.url].owned = true
            info[l.url].private = l.private
        });
        return info;
    }
    isPrivateList(url) {
        let ret;
        this.getMyLists().some(l => {
            if (l.url == url) {
                ret = l.private;
                return true;
            }
        });
        return ret;
    }
    sortCommunityLists() { // return community lists urls by relevance not including my lists
        return Object.keys(this.lists).filter(u => {
            return this.lists[u]?.origin == 'community'
        }).sort((a, b) => {
            if(this.lists[b].isConnectableResult != this.lists[a].isConnectableResult) {
                return this.lists[b].isConnectableResult - this.lists[a].isConnectableResult
            }
            return (this.lists[b].relevance?.total || 0) - (this.lists[a].relevance?.total || 0)
        }).map(u => this.lists[u].url)
    }
    trim() {
        const publicListsActive = config.get('public-lists');
        const communityListsAmount = this.communityListsAmount;
        const communityListsQuota = Math.max(communityListsAmount - this.myLists.length, 0);
        const loadedCommunityCount = this.loadedListsCount('community');
        
        // Remove community lists if quota is exceeded
        if (loadedCommunityCount > communityListsQuota) {
            const urlsToRemove = this.sortCommunityLists().slice(communityListsQuota)
            if (this.debug) {
                console.log(`🗑️ Removing excess community lists: ${urlsToRemove.length} lists (keeping ${communityListsQuota} for myLists: ${this.myLists.length})`);
            }
            for(const url of urlsToRemove) {
                if (this.lists[url]) {
                    this.requesting[url] = 'destroyed on delimiting (relevance: '+ (this.lists[url].relevance?.total || 0) +')'
                    this.remove(url)
                }
            }
        }
        if (!publicListsActive) {
            const publicUrls = Object.keys(this.lists).filter(url => !this.myLists.includes(url) && this.lists[url].origin == 'public');
            if (this.debug && publicUrls.length > 0) {
                console.log(`🗑️ Removing public lists (disabled): ${publicUrls.length} lists`);
            }
            for(const url of publicUrls) {
                this.requesting[url] = 'destroyed on delimiting (public lists disabled)';
                this.remove(url);
            }
        }
    }
    remove(u) {
        if (typeof(this.lists[u]) != 'undefined') {
            const list = this.lists[u];
            
            if (this.debug) {
                console.log(`🗑️ Removing list: ${u}`);
                console.log(`📊 List has indexer: ${!!list.indexer}`);
                console.log(`📊 List has database: ${!!(list.indexer && list.indexer.db)}`);
                console.log(`📊 Database destroyed: ${list.indexer && list.indexer.db ? list.indexer.db.destroyed : 'N/A'}`);
            }
            
            // Clear per-list cache when list is removed
            if (this.index && typeof this.index.clearListCache === 'function') {
                this.index.clearListCache(u);
            }
            
            list.destroy();
            delete this.lists[u];
            
            // Clear retry count when removing list
            if (this.metaRetryCount && this.metaRetryCount.has(u)) {
                this.metaRetryCount.delete(u);
                if (this.debug) {
                    console.log(`🧹 Metadata retry count cleared for removed list: ${u}`);
                }
            }
            
            if (this.debug) {
                console.log('Removed list', u);
            }
            this.updateState();
        }
    }
    
    destroy() {
        if (this.metaCheckInterval) {
            clearInterval(this.metaCheckInterval);
            this.metaCheckInterval = null;
        }
        if (this.stateInterval) {
            clearInterval(this.stateInterval);
            this.stateInterval = null;
        }
        this.removeAllListeners();
    }
    
    cleanupStuckStates() {
        // Clean up any stuck states that might prevent processing
        const now = Date.now();
        const stuckThreshold = 5 * 60 * 1000; // 5 minutes
        
        // Clean up old processedLists entries
        for (const [url, timestamp] of this.processedLists.entries()) {
            if (timestamp && (now - timestamp) > stuckThreshold) {
                this.processedLists.delete(url);
                if (this.debug) {
                    console.log('Cleaned up stuck processedLists entry:', url);
                }
            }
        }
        
        // Clean up old requesting entries
        for (const [url, status] of Object.entries(this.requesting)) {
            if (status && String(status).includes('scheduled for meta update') && 
                !this.processedLists.has(url) && 
                !this.loader.processes.some(p => p.url === url)) {
                delete this.requesting[url];
                if (this.debug) {
                    console.log('Cleaned up stuck requesting entry:', url);
                }
            }
        }
    }
    
    async checkAndFixLoadedListsWithMissingMeta() {
        // Check all currently loaded lists for missing meta files
        const listsWithMissingMeta = [];
        
        for (const [url, list] of Object.entries(this.lists)) {
            if (list && list.indexer && list.indexer.indexError) {
                const errorMsg = String(list.indexer.indexError);
                if (errorMsg.includes('meta file not found or empty') || 
                    errorMsg.includes('meta file contains empty index') ||
                    errorMsg.includes('meta file exists but contains no valid data')) {
                    listsWithMissingMeta.push(url);
                    if (this.debug) {
                        console.log('Found loaded list with missing/corrupted meta file:', url, errorMsg);
                    }
                }
            } else if (list && list.indexer && list.indexer.index) {
                // Also check for empty indexes (meta file exists but is empty)
                const index = list.indexer.index;
                const indexLength = index?.length ?? 0;
                if (indexLength === 0 && list.indexer.length > 0) {
                    // Database has content but index is empty - meta file corruption
                    listsWithMissingMeta.push(url);
                    if (this.debug) {
                        console.log('Found list with corrupted meta file (empty index):', url);
                    }
                }
            }
        }
        
        if (listsWithMissingMeta.length > 0) {
            if (this.debug) {
                console.log('Found', listsWithMissingMeta.length, 'loaded lists with missing or corrupted meta files');
            }
            
            // Schedule updates for the removed lists
            await this.scheduleUpdateForMissingMeta(listsWithMissingMeta);
            
            return listsWithMissingMeta.length;
        }
        
        return 0;
    }
    
    // Public method to force check and fix missing meta files
    async forceCheckAndFixMissingMeta() {
        console.log('Forcing check and fix for missing meta files...');
        
        try {
            // Check loaded lists first
            const loadedListsFixed = await this.checkAndFixLoadedListsWithMissingMeta();
            
            // Check all URLs (including cached ones)
            const allUrls = Object.keys(this.lists).concat(this.myLists);
            const cachedFixed = await this.scheduleUpdateForMissingMeta(allUrls);
            
            const totalFixed = loadedListsFixed + cachedFixed.length;
            
            if (totalFixed > 0) {
                console.log(`Fixed ${totalFixed} lists with missing meta files`);
            } else {
                console.log('No lists with missing meta files found');
            }
            
            return totalFixed;
        } catch (err) {
            console.error('Error in force check and fix:', err);
            return 0;
        }
    }
    
    // Public method to force re-indexing of lists with empty indexes
    async forceReindexEmptyLists() {
        console.log('🔍 Checking for lists with empty indexes...');
        
        const emptyLists = [];
        for (const url in this.lists) {
            const list = this.lists[url];
            const index = await list.index;
            
            if ((index.length ?? 0) === 0) {
                console.log(`❌ Empty list found: ${url}`);
                console.log(`   Index: ${JSON.stringify(index)}`);
                emptyLists.push(url);
            } else {
                console.log(`✅ List OK: ${url} (${index.length ?? 0} streams)`);
            }
        }
        
        console.log(`📊 Found ${emptyLists.length} lists with empty indexes`);
        
        if (emptyLists.length > 0) {
            console.log('\n🔧 Fixing empty lists by forcing re-indexing...');
            
            for (const url of emptyLists) {
                try {
                    console.log(`\n🔄 Re-indexing: ${url}`);
                    
                    // Remove the list from memory
                    this.remove(url);
                    
                    // Force re-indexing by calling the loader
                    await this.loader.addListNow(url, {
                        progress: (progress) => {
                            console.log(`   Progress: ${progress}%`);
                        },
                        timeout: 60000 // 60 seconds timeout
                    });
                    
                    console.log(`✅ Successfully re-indexed: ${url}`);
                    
                    // Check the new index
                    const newList = this.lists[url];
                    if (newList) {
                        const newIndex = await newList.index;
                        console.log(`   New index: ${JSON.stringify(newIndex)}`);
                    }
                    
                } catch (error) {
                    console.error(`❌ Failed to re-index ${url}:`, error.message);
                }
            }
            
            console.log('\n✅ Re-indexing completed!');
            
            // Final check
            console.log('\n🔍 Final verification:');
            for (const url of emptyLists) {
                const list = this.lists[url];
                if (list) {
                    const index = await list.index;
                    console.log(`${url}: ${index.length ?? 0} streams`);
                }
            }
            
            return emptyLists.length;
        } else {
            console.log('✅ All lists have proper indexes!');
            return 0;
        }
    }
    
    async getCachedRelevance(url) {
        const cacheKey = 'list-relevance-' + url;
        return await storage.get(cacheKey);
    }
    
    async getCachedRelevances(urls) {
        const relevances = {};
        for (const url of urls) {
            relevances[url] = await this.getCachedRelevance(url);
        }
        return relevances;
    }

    async computeCachedRelevances(urls) {
        const relevances = await this.getCachedRelevances(urls);
        const missing = urls.filter(url => relevances[url] == null);
        if (!missing.length) {
            return;
        }
        if (this.debug) {
            console.log('Computing missing relevance for cached lists:', missing);
        }
        const limit = pLimit(2);
        const tasks = missing.map(url => limit(async () => {
            let list;
            try {
                list = new List(url, this);
                await list.ready();
                await list.checkRelevance();
            } catch (err) {
                if (this.debug) {
                    console.error('Failed to compute cached relevance for', url, err);
                }
            } finally {
                if (list) {
                    try {
                        list.destroy();
                    } catch (_err) {
                        // ignore
                    }
                }
            }
        }));
        await Promise.allSettled(tasks);
    }
}
if(inWorker) {
    console.error('!!!!!!! LISTS ON WORKER '+ global.file)
    console.error(JSON.stringify(inWorker))
}

export default new Lists()
