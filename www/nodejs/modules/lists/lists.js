import fs from "fs";
import path from 'path'
import storage from '../storage/storage.js'
import Index from "./index.js";
import pLimit from "p-limit";
import PQueue from "p-queue";
import Loader from "./loader.js";
import Manager from "./manager.js";
import List from "./list.js";
import Discovery from "../discovery/discovery.js";
import config from "../config/config.js"
import { ready } from '../bridge/bridge.js'
import { inWorker } from '../paths/paths.js'
import { forwardSlashes, parseCommaDelimitedURIs, LIST_DATA_KEY_MASK } from "../utils/utils.js";
import { getDirname } from 'cross-dirname'           
import MultiWorker from '../multi-worker/multi-worker.js';

class ListsEPGTools extends Index {
    constructor(opts) {
        super(opts)
        this.epgWorker = new MultiWorker()
        this.epg = this.epgWorker.load(path.join(getDirname(), 'epg-worker.js'))
        this.epg.loaded = null
        this.epg.on('update', async () => {
            const states = await this.epg.getState()
            const loaded = states.info.filter(r => r.progress > 99).map(r => r.url)
            this.epg.loaded = loaded.length ? loaded : null
            this.emit('epg-update', states)
        })
        ready(() => {
            config.on('change', keys => {
                const key = 'epg-'+ lang.locale
                if(keys.includes(key) || keys.includes('locale')) {
                    this.epg.sync(config.get(key)).catch(console.error)
                }
            })
            const key = 'epg-'+ lang.locale
            this.epg.start(config.get(key)).catch(console.error)
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
        let data, err
        let ret = await this.epg.getState().catch(e => err = e)
        if (err) return ['error', String(err)]
        const { progress, state, error } = ret
        if (error || !this.epg.loaded) {
            data = [state];
            if (state == 'error') {
                data.push(error)
            } else {
                data.push(progress)
            }
        } else {
            if (Array.isArray(channelsList)) {
                channelsList = channelsList.map(c => this.tools.applySearchRedirectsOnObject(c))
                data = await this.epg.getMulti(channelsList, limit)
            } else {
                channelsList = this.tools.applySearchRedirectsOnObject(channelsList)
                data = await this.epg.get(channelsList, limit)
            }
        }
        return data
    }
    async epgSearch(terms, nowLive) {
        if (!this.epg.loaded) return []
        return await this.epg.search(this.tools.applySearchRedirects(terms), nowLive)
    }
    async epgSearchChannel(terms, limit) {
        if (!this.epg.loaded) return {}
        return await this.epg.searchChannel(this.tools.applySearchRedirects(terms), limit);
    }
    async epgSearchChannelIcon(terms) {
        if (!this.epg.loaded) return []
        return await this.epg.searchChannelIcon(this.tools.applySearchRedirects(terms));
    }
    async epgLiveNowChannelsList() {
        if (!this.epg.loaded) return {categories: {}}
        let data = await this.epg.liveNowChannelsList()
        if (data && data['categories'] && Object.keys(data['categories']).length) {
            let currentScore = this.epgChannelsListSanityScore(data['categories']);
            const _ = global.config.get('epg')
            const limit = pLimit(3)
            const activeEPGs =  Array.isArray(_) ? _.filter(e => e.active).map(e => e.key) : [];
            const tasks = Object.keys(this.lists).filter(url => {
                return this.lists[url].index.meta['epg'] && activeEPGs.some(k => this.lists[url].index.meta['epg'].includes(k)); // use indexOf as it can be a comma delimited list
            }).map(url => {
                return async () => {
                    let categories = {};
                    for await (const e of this.lists[url].walk()) {
                        if (!e.groupName)
                            continue
                        const c = await this.epg.findChannel(this.tools.terms(e.name))
                        if (typeof(categories[e.groupName]) == 'undefined') {
                            categories[e.groupName] = []
                        }
                        if (!categories[e.groupName].includes(e.name)) {
                            categories[e.groupName].push(e.name)
                        }
                    }
                    let newScore = this.epgChannelsListSanityScore(categories);
                    console.warn('epgChannelsList', categories, currentScore, newScore);
                    if (newScore > currentScore) {
                        data.categories = categories;
                        data.updateAfter = 24 * 3600;
                        currentScore = newScore;
                    }
                };
            }).map(limit);
            await Promise.allSettled(tasks);
            return data;
        } else {
            console.error('epgLiveNowChannelsList FAILED', JSON.stringify(data));
            throw 'failed';
        }
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
        else if (this.activeCountries.length && url.match(this.regexCountries)) score += 3
        this.epgScoreCache[url] = score
        return score
    }
    async resetEPGScoreCache() {
        this.epgScoreCache = {}
        const activeCountries = await lang.getActiveCountries()
        if(this.activeCountries && activeCountries.join('') == this.activeCountries.join('')) return
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
        if(this.activeCountries === undefined) {
            await this.resetEPGScoreCache()
        }

        let epgs = Object.keys(this.epgs)
        if (this.epg.loaded) {
            epgs.push(...this.epg.loaded.filter(u => !epgs.includes(u)))
        }

        const c = config.get('epg-'+ lang.locale)
        if (Array.isArray(c) && c.length) {
            epgs.push(...c.filter(e => e.active && !epgs.includes(e.url)).map(e => e.url))
        }

        const o = await cloud.get('configure', {shadow: false})
        if (o?.epgs) {
            for(const code of this.activeCountries) {
                if (o.epgs[code]) {
                    epgs.push(...o.epgs[code].filter(u => !epgs.includes(u)))
                }
            }
        } else if(o?.epg) {
            for(const code of this.activeCountries) {
                if (o.epg[code] && !epgs.includes(o.epg[code])) {
                    epgs.push(o.epg[code])
                }
            }
        }

        if(global?.channels?.trending.currentRawEntries) {
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
        this.communityLists = [];
        this.processedLists = new Map();
        this.requesting = {};
        this.loadTimes = {};
        this.processes = [];
        this.satisfied = false;
        this.isFirstRun = !config.get('communitary-mode-lists-amount') && !config.get('lists').length;
        this.queue = new PQueue({concurrency: 4});
        config.on('change', keys => {
            keys.includes('lists') && this.configChanged();
        });
        ready(async () => {
            global.channels.on('channel-grid-updated', keys => {
                this._relevantKeywords = null
            })
        });
        this.on('satisfied', () => {
            if (this.activeLists.length) {
                this.setQueueConcurrency(1)
            }
        });
        this.on('unsatisfied', () => {
            this.setQueueConcurrency(4)
        });
        this.discovery = new Discovery(this)
        this.loader = new Loader(this)
        this.manager = new Manager(this)
        this.configChanged()
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
    configChanged() {
        const myLists = config.get('lists').map(l => l[1]);
        const newLists = myLists.filter(u => !this.myLists.includes(u));
        const rmLists = this.myLists.filter(u => !myLists.includes(u));
        this.myLists = myLists;
        rmLists.forEach(u => this.remove(u));
        this.loadCachedLists(newLists).catch(console.error) // load them up if cached
    }
    async isListCached(url) {
        let err
        const file = storage.resolve(LIST_DATA_KEY_MASK.format(url))
        const stat = await fs.promises.stat(file).catch(e => err = e)
        return (stat && stat.size >= 1024)
    }
    async filterCachedUrls(urls) {
        if (this.debug)
            console.log('filterCachedUrls', urls.join("\r\n"));
        let loadedUrls = [], cachedUrls = [];
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
                    const has = await this.isListCached(url).catch(e => err = e);
                    if (this.debug)
                        console.log('filterCachedUrls', url, has);
                    if (has === true) {
                        cachedUrls.push(url);
                        if (!this.requesting[url]) {
                            this.requesting[url] = 'cached, not added';
                        }
                    } else {
                        if (!this.requesting[url]) {
                            this.requesting[url] = err || 'not cached';
                        }
                    }
                };
            }).map(limit);
            await Promise.allSettled(tasks).catch(console.error);
        }
        if (this.debug)
            console.log('filterCachedUrls', loadedUrls.join("\r\n"), cachedUrls.join("\r\n"));
        loadedUrls.push(...cachedUrls);
        return loadedUrls;
    }
    updaterFinished(isFinished) {
        this.isUpdaterFinished = isFinished;
        return this.isUpdaterFinished;
    }
    async relevantKeywords(refresh) {
        if (!refresh && Array.isArray(this._relevantKeywords) && this._relevantKeywords.length)
            return this._relevantKeywords
        const badTerms = ['m3u8', 'ts', 'mp4', 'tv', 'channel']
        let terms = [], addTerms = (tms, score) => {
            if (typeof(score) != 'number') {
                score = 1
            }
            tms.forEach(term => {
                if (badTerms.includes(term)) {
                    return
                }
                const has = terms.some((r, i) => {
                    if (r.term == term) {
                        terms[i].score += score
                        return true
                    }
                })
                if (!has) {
                    terms.push({ term, score })
                }
            })
        }
        await ready(true)
        const searchHistoryPromise = global.channels.search.history.terms().then(sterms => {
            if (sterms.length) { // searching terms history
                sterms = sterms.slice(-24)
                sterms = sterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
                addTerms(sterms)
            }
        })
        const channelsPromise = global.channels.keywords().then(addTerms)
        let bterms = global.channels.bookmarks.get()
        if (bterms.length) { // bookmarks terms
            bterms = bterms.slice(-24)
            bterms = bterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(bterms)
        }
        let hterms = global.channels.history.get()
        if (hterms.length) { // user history terms
            hterms = hterms.slice(-24)
            hterms = hterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-')
            addTerms(hterms)
        }
        const max = Math.max(...terms.map(t => t.score))
        let cterms = config.get('interests')
        if (cterms) { // user specified interests
            cterms = this.tools.terms(cterms, true).filter(c => c[0] != '-')
            cterms.length && addTerms(cterms, max)
        }
        await Promise.allSettled([searchHistoryPromise, channelsPromise])
        terms = terms.sortByProp('score', true).map(t => t.term)
        if (terms.length > 24) {
            terms = terms.slice(0, 24)
        }
        this._relevantKeywords = terms
        return terms
    }
    setCommunityLists(communityLists) {
        // communityLists for reference (we'll use it to calc lists loading progress)
        communityLists.forEach(url => {
            if (!this.communityLists.includes(url)) {
                this.communityLists.push(url);
            }
        });
        return true;
    }
    async loadCachedLists(lists) {
        let hits = 0;
        if (this.debug) {
            console.log('Checking for cached lists...', lists);
        }
        if (!lists.length)
            return hits;
        lists.forEach(url => {
            if (!this.loadTimes[url]) {
                this.loadTimes[url] = {};
            }
            this.loadTimes[url].sync = (Date.now() / 1000);
        });
        lists = await this.filterCachedUrls(lists);
        lists.forEach(url => {
            if (!this.loadTimes[url]) {
                this.loadTimes[url] = {};
            }
            this.loadTimes[url].filtered = (Date.now() / 1000);
        });
        this.delimitActiveLists(); // helps to avoid too many lists in memory
        for (let url of lists) {
            if (typeof(this.lists[url]) == 'undefined') {
                hits++;
                this.addList(url, this.myLists.includes(url) ? 1 : 9);
            }
        }
        if (this.debug) {
            console.log('sync ended');
        }
        return hits;
    }
    status(url = '') {
        let progress = 0, firstRun = this.isFirstRun, satisfyAmount = this.myLists.length
        const isUpdatingFinished = this.isUpdaterFinished && !this.queue.size
        const communityListsAmount = config.get('communitary-mode-lists-amount')
        const progresses = this.myLists.map(url => this.lists[url] ? this.lists[url].progress() : 0)
        const lks = Object.values(this.lists)
        if (communityListsAmount > satisfyAmount) {
            satisfyAmount = communityListsAmount
        }
        if (satisfyAmount > 3) { // 3 lists are enough to start tuning
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
                    ls = lks.slice(0);
                }
                progresses.push(...ls.map(l => l.progress() || 0).sort((a, b) => b - a).slice(0, communityListsQuota));
                const left = communityListsQuota - progresses.length;
                if (left > 0) {
                    progresses.push(...Object.keys(this.loader.progresses).filter(u => !this.lists[u]).map(u => this.loader.progresses[u]).sort((a, b) => b - a).slice(0, left));
                }
            }
            const allProgress = satisfyAmount * 100
            const sumProgress = progresses.reduce((a, b) => a + b, 0)
            progress = parseInt(sumProgress / (allProgress / 100))
        }
        if (this.debug) {
            console.log('status() progresses', progress)
        }
        const ret = {
            url,
            progress,
            firstRun,
            satisfyAmount,
            communityListsAmount,
            isUpdatingFinished: this.isUpdaterFinished,
            pendingCount: this.queue.size,
            length: lks.filter(l => l.isReady).length
        }
        if (progress > 99) {
            if (!this.satisfied) {
                this.satisfied = true
                this.emit('satisfied', ret)
            }
        } else {
            if (this.satisfied) {
                this.satisfied = false
                this.emit('unsatisfied', ret)
            }
        }
        this.emit('status', ret)
        return ret
    }
    loaded(isEnough) {
        if (isEnough === true) {
            if (config.get('public-lists') != 'only' && !Object.values(this.lists).filter(l => l.origin != 'public').length) {
                return false
            }
        }
        const stat = this.status(), ret = stat.progress > 99
        return ret
    }
    addList(url, priority = 9) {
        let cancel, started, done;
        this.processes.push({
            promise: this.queue.add(async () => {
                if (cancel)
                    return;
                let err
                if (typeof(this.lists[url]) == 'undefined') {
                    await this.loadList(url).catch(e => err = e);
                } else {
                    let contentLength = await this.shouldReloadList(url)
                    if (cancel)
                        return;
                    if (typeof(contentLength) == 'number') {
                        console.log('List got updated, reload it. ' + this.lists[url].contentLength + ' => ' + contentLength);
                        await this.loadList(url, contentLength).catch(e => err = e)
                    } else {
                        err = 'no need to update';
                    }
                }
                done = true;
            }, { priority }),
            started: () => started,
            cancel: () => cancel = true,
            done: () => done || cancel,
            priority,
            url
        })
    }
    async loadList(url, contentLength) {
        url = forwardSlashes(url)
        this.processedLists.has(url) || this.processedLists.set(url, null)
        if (typeof(contentLength) != 'number') { // contentLength controls when the list should refresh
            let err, meta = await this.getListMeta(url).catch(e => err = e)
            if (err) {
                console.error(err)
                contentLength = 0 // ok, give up and load list anyway
            } else {
                contentLength = meta.contentLength;
                if (typeof(contentLength) != 'number') {
                    contentLength = 0 // ok, give up and load list anyway
                }
            }
        }
        let err, defaultOrigin, isMine = this.myLists.includes(url);
        if (this.debug) {
            console.log('loadList start', url);
        }
        if (!this.loadTimes[url]) {
            this.loadTimes[url] = {};
        } else {
            if (this.lists[url]) {
                if (this.lists[url].contentLength == contentLength) {
                    throw 'list already loaded';
                }
                defaultOrigin = this.lists[url].origin
            }
            this.remove(url);
        }
        this.loadTimes[url].adding = (Date.now() / 1000);
        this.requesting[url] = 'loading';
        const list = new List(url, this);
        list.contentLength = contentLength;
        if (isMine) {
            list.origin = 'own';
        } else {
            list.origin = this.discovery.details(url, 'type') || defaultOrigin || '';
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
        await list.start().catch(e => err = e);
        if (!err) {
            await list.verify().catch(e => err = e);
        }
        if (err) {
            this.processedLists.delete(url);
            this.loadTimes[url].synced = (Date.now() / 1000);
            if (!this.requesting[url] || this.requesting[url] == 'loading') {
                this.requesting[url] = err;
            }
            console.warn('loadList error: ', err);
            if (this.lists[url] && !this.myLists.includes(url)) {
                this.remove(url);
            }
            this.updateActiveLists();
            throw err;
        } else {
            this.loadTimes[url].synced = (Date.now() / 1000);
            if (this.debug) {
                console.log('loadList started', url);
            }
            let repeated, expired;
            if (!this.lists[url] || (!isMine &&
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
                throw 'list discarded';
            } else {
                if (this.debug) {
                    console.log('loadList else', url);
                }
                this.setListMeta(url, list.index.meta).catch(console.error)
                if (list.index.meta['epg']) {
                    const epgs = parseCommaDelimitedURIs(list.index.meta['epg'])
                    for(const epg of epgs) {
                        if(!this.epgs[epg]) this.epgs[epg] = new Set()
                        this.epgs[epg].add(url)
                    }
                }
                if (this.debug) {
                    console.log('loadList else', url);
                }
                const contentAlreadyLoaded = await this.isSameContentLoaded(list);
                if (this.debug) {
                    console.log('loadList contentAlreadyLoaded', contentAlreadyLoaded);
                }
                if (contentAlreadyLoaded) {
                    this.requesting[url] = 'content already loaded';
                    if (this.debug) {
                        console.log('Content already loaded', url);
                    }
                    if (this.debug) {
                        console.log('loadList end: already loaded');
                    }
                    throw 'content already loaded';
                } else {
                    let replace;
                    this.requesting[url] = 'added';
                    if (!isMine && this.loadedListsCount('community') > (this.myLists.length + config.get('communitary-mode-lists-amount'))) {
                        replace = this.shouldReplace(list);
                        if (replace) {
                            const pr = this.lists[replace].relevance.total;
                            if (this.debug) {
                                console.log('List', url, list.relevance.total, 'will replace', replace, pr);
                            }
                            this.remove(replace);
                            this.requesting[replace] = 'replaced by ' + url + ', ' + pr + ' < ' + list.relevance.total;
                            this.requesting[url] = 'added in place of ' + replace + ', ' + pr + ' < ' + list.relevance.total;
                        }
                    }
                    if (this.debug) {
                        console.log('Added community list...', url, list.length);
                    }
                    if (!replace) {
                        this.delimitActiveLists();
                    }
                    this.searchMapCacheInvalidate()
                    list.isConnectable().catch(err => {
                        if(this.requesting[url] == 'loading') {
                            this.requesting[url] = err
                        }
                        this.remove(url)
                    });
                    this.emit('list-loaded', url)
                }
            }
        }
        this.updateActiveLists()
        this.status(url)
        return true
    }
    async getListContentLength(url) {
        const updateMeta = await this.getListMeta(url)
        return updateMeta.contentLength
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
            console.error('shouldReplace error: no list given', list);
            return;
        }
        let weaker
        for(const k in this.lists) {
            if (!this.lists[k].verified) {
                continue
            }
            if (this.myLists.includes(k) || !this.lists[k].isReady || this.lists[k].origin != 'community')
                continue
            if (!weaker || (this.lists[k].relevance.total > -1 && this.lists[k].relevance.total < this.lists[weaker].relevance.total)) {
                weaker = k
            }
        }
        if (weaker && this.lists[weaker] && this.lists[weaker].relevance.total < list.relevance.total) {
            return weaker;
        }
    }
    isRepeatedList(url) {
        if (!url || !this.lists[url] || !this.lists[url].index || this.myLists.includes(url)) {
            return
        }
        for(const k in this.lists) {
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
        if (list.isReady && !list.length)
            return true; // loaded with no content
        if (this.loader.results[list.url]) {
            const ret = String(this.loader.results[list.url] || '');
            if (ret.startsWith('failed') && ['401', '403', '404', '410'].includes(ret.substr(-3))) {
                return true;
            }
        }
        const quota = list.length * 0.7;
        if (list.index.uniqueStreamsLength && list.index.uniqueStreamsLength < quota) {
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
        if (err || stat.size == 0) {
            return true; // force this list discarding
        } else {
            const size = stat.size;
            const limit = pLimit(3);
            const tasks = Object.keys(this.lists).map(url => {
                return async () => {
                    if (!alreadyLoaded && url != list.url && this.lists[url] && this.lists[url].length == listIndexLength) {
                        let err;
                        const f = this.lists[url].file;
                        const a = await fs.promises.stat(f).catch(e => err = e);
                        if (!err && !alreadyLoaded) {
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
        const loadedLists = Object.values(this.lists).filter(l => l.isReady).filter(l => {
            return !origin || (origin == l.origin);
        }).map(l => l.url);
        return loadedLists.length;
    }
    updateActiveLists() {
        let communityUrls = Object.keys(this.lists).filter(u => !this.myLists.includes(u));
        this.activeLists = {
            my: this.myLists,
            community: communityUrls,
            length: this.myLists.length + communityUrls.length
        };
    }
    getMyLists() {
        const hint = config.get('communitary-mode-lists-amount');
        return config.get('lists').map(c => {
            const url = c[1];
            const e = {
                name: c[0],
                owned: true,
                url
            };
            if (this.lists[url] && this.lists[url].relevance) {
                e.score = this.lists[url].relevance.total;
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
        const info = {};
        Object.keys(this.lists).forEach(url => {
            if (info[url] || (!includeNotReady && !this.lists[url].isReady))
                return;
            info[url] = { url, owned: false };
            info[url].score = this.lists[url].relevance.total
            info[url].length = this.lists[url].length
            info[url].origin = this.lists[url].origin
            if (this.lists[url].index.meta) {
                info[url].name = this.lists[url].index.meta.name
                info[url].icon = this.lists[url].index.meta.icon
                info[url].epg = this.lists[url].index.meta.epg
            }
            info[url].private = false // communitary list
        });
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
    delimitActiveLists() {
        const publicListsActive = config.get('public-lists');
        const communityListsAmount = config.get('communitary-mode-lists-amount');
        const communityListsQuota = Math.max(communityListsAmount - this.myLists.length, 0);
        if (this.loadedListsCount('community') > communityListsQuota) {
            let results = {}
            if (this.debug) {
                console.log('delimitActiveLists', Object.keys(this.lists), communityListsQuota)
            }
            for(const url in this.lists) {
                if (!this.myLists.includes(url) && this.lists[url].origin == 'community' && this.lists[url].verified) {
                    results[url] = this.lists[url].relevance.total
                }
            }
            let sorted = Object.keys(results).sort((a, b) => results[b] - results[a])
            sorted.slice(communityListsQuota).forEach(u => {
                if (this.lists[u]) {
                    this.requesting[u] = 'destroyed on delimiting (relevance: '+ this.lists[u].relevance.total +')'
                    this.remove(u)
                }
            })
            if (this.debug) {
                console.log('delimitActiveLists', Object.keys(this.lists), communityListsQuota, results, sorted);
            }
        }
        if (!publicListsActive) {
            if (this.debug) {
                console.log('delimitActiveLists', Object.keys(this.lists), publicListsActive);
            }
            Object.keys(this.lists).forEach(url => {
                if (!this.myLists.includes(url) && this.lists[url].origin == 'public') {
                    this.requesting[url] = 'destroyed on delimiting (public lists disabled)';
                    this.remove(url);
                }
            });
            if (this.debug) {
                console.log('delimitActiveLists', Object.keys(this.lists), publicListsActive);
            }
        }
    }
    remove(u) {
        this.processes = this.processes.filter(p => {
            const found = p.url == u;
            found && p.cancel();
            return !found;
        });
        if (typeof(this.lists[u]) != 'undefined') {
            this.searchMapCacheInvalidate(u);
            this.lists[u].destroy();
            delete this.lists[u];
            if (this.debug) {
                console.log('Removed list', u);
            }
            this.updateActiveLists();
        }
    }
    async directListRenderer(v, opts = {}) {
        if (typeof(this.lists[v.url]) != 'undefined' && (!opts.fetch || (this.lists[v.url].isReady && !this.lists[v.url].indexer.hasFailed))) { // if not loaded yet, fetch directly
            let entries;
            if (opts.expand) {
                entries = await this.lists[v.url].fetchAll();
            } else {
                entries = await this.lists[v.url].getMap();
            }
            return this.directListRendererPrepare(entries, v.url);
        } else if (opts.fetch) {
            let entries, fetcher = new this.Fetcher(v.url, {
                progress: opts.progress
            }, this);
            if (opts.expand) {
                entries = await fetcher.fetch();
            } else {
                entries = await fetcher.getMap();
            }
            return await this.directListRendererPrepare(entries, v.url);
        } else {
            throw 'List not loaded';
        }
    }
    async directListRendererPrepare(list, url) {
        if (typeof(this.directListRendererPrepareCache) == 'undefined') {
            this.directListRendererPrepareCache = {};
        }
        const cachettl = 3600, now = (Date.now() / 1000), olen = list.length;
        if (typeof(this.directListRendererPrepareCache[url]) != 'undefined' && this.directListRendererPrepareCache[url].size == olen && this.directListRendererPrepareCache[url].time > (now - cachettl)) {
            return this.directListRendererPrepareCache[url].list.slice(0); // clone it
        }
        if (list.length) {
            list = this.parentalControl.filter(list, true);
            list = this.prepareEntries(list);
            list = await this.tools.deepify(list, { source: url });
        }
        if (olen >= this.opts.offloadThreshold) {
            this.directListRendererPrepareCache[url] = { list, time: now, size: olen };
        }
        return list.slice(0); // clone it to not alter cache
    }
}
if(inWorker) {
    console.error('!!!!!!! LISTS ON WORKER '+ global.file)
    console.error(JSON.stringify(inWorker))
}
export default new Lists();
