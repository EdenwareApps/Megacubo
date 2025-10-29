import Download from '../download/download.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import mega from "../mega/mega.js";
import Xtr from "./xtr.js";
import downloads from "../downloads/downloads.js";
import Mag from "./mag.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import options from './options.json' with { type: 'json' };
import Limiter from '../limiter/limiter.js'
import { randomUUID } from 'node:crypto'
import { EventEmitter } from "events";
import { promises as fsp } from "fs";
import { basename, clone, forwardSlashes, getDomain, isLocal, insertEntry, kfmt, listNameFromURL, parseCommaDelimitedURIs, validateURL, ucWords, formatThousands } from "../utils/utils.js";
import { resolveListDatabaseFile } from "./tools.js";
import { Fetcher } from './common.js';

class ManagerEPG extends EventEmitter {
    constructor() {
        super()
        renderer.ready(() => {
            let currentHash
            const updater = async () => {
                const es = await this.epgOptionsEntries()
                const entries = es.map(e => {
                    if (e.name == lang.SYNC_EPG_CHANNELS) {
                        e.value = e.checked()
                    }
                    return e
                })
                if (Array.isArray(entries) && entries.length) {
                    if(!this.inEPGSelectionPath(menu.path)) return
                    const hash = entries.map(e => e.name + e.details + e.value).join('')
                    if (hash !== currentHash) {
                        currentHash = hash
                        menu.render(entries, this.epgSelectionPath(), {
                            icon: global.channels ? global.channels.epgIcon : '',
                            filter: true
                        })
                    }
                }
            }
            menu.setLiveSection(lang.MY_LISTS + '/' + lang.EPG + '/' + lang.SELECT, 1000, updater)
            menu.setLiveSection(lang.EPG + '/' + lang.SELECT, 1000, updater)
        })
    }
    epgSelectionPath() {
        if(menu.path.startsWith(lang.MY_LISTS)) {
            return lang.MY_LISTS + '/' + lang.EPG + '/' + lang.SELECT
        }
        return lang.EPG + '/' + lang.SELECT
    }
    inEPGSelectionPath(path) {
        if (path.startsWith(lang.EPG) || path.startsWith(lang.MY_LISTS)) {
            return path.includes(lang.EPG + '/' + lang.SELECT)
        }
    }
    EPGs(activeOnly=false, urlsOnly=false) {
        let ret = [], activeEPG = config.get('epg-'+ lang.locale)
        if(activeEPG && activeEPG !== 'disabled') {
            if(Array.isArray(activeEPG)) {
                ret = activeEPG
            } else {
                ret = parseCommaDelimitedURIs(activeEPG).map(url => {
                    return {url, active: true}
                })
            }
        }
        if(activeOnly) {
            ret = ret.filter(r => r.active)
        }
        if(urlsOnly) {
            ret = ret.map(r => r.url)
        }
        return ret
    }
    async epgOptionsEntries() {
        const key = 'epg-'+ lang.locale
        const states = this.master.epg.state
        const actives = new Set(states.epgs.map(epg => epg.url)) // usar epgs em vez de info
        const knownEPGs = await this.master.searchEPGs(22, actives)
        const allEPGs = [...new Set([...actives, ...knownEPGs])].slice(0, 22)
        const options = allEPGs.map(url => {
            let icon, details = getDomain(url)
            const isActive = actives.has(url), name = listNameFromURL(url)
            const state = states.epgs.find(epg => epg.url == url)
            if (isActive) {
                icon = 'fa-mega busy-x'
                if (state?.readyState == 'error') {
                    details = lang[state.error] || state.error || lang.NOT_FOUND
                    icon = 'fas fa-times-circle faclr-red'
                } else if (state && state.progress > 99) {
                    const state = states?.epgs?.find(e => e.url == url)
                    details = state ? lang.X_PROGRAMMES.format(formatThousands(state.databaseSize)) : lang.EPG_LOAD_SUCCESS
                    icon = 'fas fa-check-circle faclr-green'
                } else {
                    details = lang.PROCESSING + ' ' + (state?.progress || 0) + '%'
                }
            } else {
                if (state?.readyState == 'error') {
                    details = lang[state.error] || state.error || lang.NOT_FOUND
                    icon = 'fas fa-times-circle faclr-red'
                }
            }
            const checked = () => {
                const data = this.EPGs()
                return data.some(r => r.url == url)
            }
            return {
                name,
                type: 'check',
                action: (e, isChecked) => {
                    const data = this.EPGs()
                    const has = data.findIndex(r => r.url == url)
                    if(isChecked) {
                        if(has === -1) {
                            data.push({url, active: true})
                            this.epgShowLoading(url).catch(err => console.error(err))
                        }
                    } else {
                        if(has !== -1) {
                            data.splice(has, 1)
                        }
                    }
                    config.set(key, data)
                    menu.refreshNow() // epg options path
                },
                checked,
                prepend: isActive ? '<i class="'+ icon +'" aria-hidden="true"></i> ' : undefined,
                details
            };
        });
        options.unshift({
            name: lang.EPG_SUGGESTED,
            type: 'check',
            action: async (_, isChecked) => {
                config.set('epg-suggestions', isChecked)
                menu.refreshNow()
            },
            checked: () => {
                return config.get('epg-suggestions') !== false
            }
        })
        options.unshift(this.addEPGEntry())
        return options
    }
    addEPGEntry() {
        return {
            name: lang.ADD, fa: 'fas fa-plus-square',
            type: 'action', action: async () => {
                const url = await menu.prompt({
                    question: lang.EPG,
                    placeholder: 'http://.../epg.xml',
                    defaultValue: this.lastEPGURLInput || '',
                    fa: global.channels ? global.channels.epgIcon : ''
                })
                if (url && url.length > 6) {
                    this.lastEPGURLInput = url
                    const key = 'epg-' + lang.locale
                    let data = this.EPGs()
                    const has = data.some(r => r.url == url)
                    if (!has) {
                        data.push({url, active: true})
                        config.set(key, data)
                        menu.refreshNow() // epg options path
                        this.epgShowLoading(url).catch(err => console.error(err))
                    }
                }
            }
        }
    }
    async epgShowLoading(url) {
        let lastProgress = -1, lastState = ''
        const uid = 'epg-add-'+ randomUUID()
        osd.show(lang.EPG_AVAILABLE_SOON, 'fa-mega busy-x', uid, 'persistent')
        await new Promise(resolve => setTimeout(resolve, 3000))
        
        // CRITICAL: Add timeout protection and instance validation
        const maxWaitTime = 180000 // 3 minutes maximum wait
        const startTime = Date.now()
        
        while(true) {
            // Check if we've exceeded maximum wait time
            if (Date.now() - startTime > maxWaitTime) {
                console.warn(`EPG loading timeout for ${url} after ${maxWaitTime}ms`)
                osd.show(lang.EPG_LOAD_FAILURE + ': Timeout', 'fas fa-times-circle', uid, 'normal')
                break
            }
            
            try {
                const states = this.master.epg.state
                const state = states.epgs.find(epg => epg.url == url)
                await new Promise(resolve => setTimeout(resolve, 500))
                
                if (state) {
                    if (state.progress == lastProgress && state.readyState == lastState) continue
                    menu.refresh()
                    if (state.readyState == 'error') {
                        osd.show(lang.EPG_LOAD_FAILURE + ': ' + state.error, 'fas fa-times-circle', uid, 'normal')
                        break
                    } else if (state.progress > 99) {
                        osd.show(lang.EPG_LOAD_SUCCESS, 'fas fa-check-circle', uid, 'normal')
                        break
                    } else {
                        osd.show(lang.PROCESSING + ' ' + (state.progress || 0) + '%', 'fa-mega busy-x', uid, 'persistent')
                    }
                } else {
                    // CRITICAL: Check if EPG instance still exists before showing failure
                    const epgInstance = this.master.epg.epgs?.[url]
                    if (!epgInstance || epgInstance.destroyed) {
                        console.warn(`EPG instance destroyed or not found for ${url}`)
                        osd.show(lang.EPG_LOAD_FAILURE + ': Instance destroyed', 'fas fa-times-circle', uid, 'normal')
                        break
                    }
                    osd.show(lang.EPG_LOAD_FAILURE, 'fas fa-times-circle', uid, 'normal')
                    break
                }
            } catch (error) {
                console.error(`Error in epgShowLoading for ${url}:`, error.message)
                osd.show(lang.EPG_LOAD_FAILURE + ': ' + error.message, 'fas fa-times-circle', uid, 'normal')
                break
            }
        }
    }
    epgEntry(side=false) {
        return {
            name: lang.EPG, side,
            fa: global.channels ? global.channels.epgIcon : '',
            type: 'group', details: 'EPG',
            renderer: async () => {
                await renderer.ready(true)
                const entries = [
                    {
                        name: lang.SELECT,
                        details: lang.CONFIGURE,
                        type: 'group',
                        fa: 'fas fa-cog',
                        renderer: this.epgOptionsEntries.bind(this)
                    }
                ]
                const states = this.master.epg.state
                if (states.epgs.length) {
                    const cl = global.channels.channelList
                    let categories
                    try {
                        categories = await cl.getCategories()
                    } catch(e) {
                        categories = []
                        console.error(e)
                    }
                    entries.push(...[
                        global.channels.epgSearchEntry(),
                        global.channels.chooseChannelGridOption(true),
                        ...categories.map(category => {
                            const rawname = lang.CATEGORY_KIDS == category.name ? '[fun]' + category.name + '[|fun]' : category.name;
                            return {
                                name: category.name,
                                rawname,
                                type: 'group',
                                renderer: () => this.epgCategoryEntries(category)
                            }
                        })
                    ])
                    if (!categories.length) {
                        entries.push({
                            name: lang.EPG_AVAILABLE_SOON,
                            type: 'group',
                            fa: 'fa-mega busy-x',
                            renderer: () => []
                        })
                    }
                } else {
                    entries[0].details = '<i class="fas fa-times-circle faclr-red"></i> '+ (states.state === 'error' ? lang.EPG_LOAD_FAILURE : lang.EPG_DISABLED)
                }
                return entries;
            }
        };
    }
    async epgCategoryEntries(category) {
        await renderer.ready(true)
        let terms = {}, chs = category.entries.map(e => {
            const data = global.channels.isChannel(e.name)
            if (data) {
                e.nameTerms = terms[e.name] = data.terms
                return e
            }
        }).filter(e => e)
        chs = chs.map(c => {
            return {
                name: c.name,
                type: 'group',
                fa: 'fas fa-play',
                terms: c.terms, // allow EPG info inclusion
                renderer: async () => {
                    return global.channels.epgChannelEntries(c)
                }
            };
        })
        return global.channels.epgChannelsAddLiveNow(chs, false)
    }
}
class ManagerFetch extends ManagerEPG {
    constructor(master) {
        super()
        this.fetchCache = {}
    }
    async renderList(data, opts={}) {
        let v = Object.assign({}, data);
        opts.silent || osd.show(lang.OPENING_LIST, 'fa-mega busy-x', 'list-open', 'persistent');
        const urls = Array.isArray(v.url) ? v.url : [v.url];
        const tasks = urls.map(url => this.fetch(url, {
            fetch: opts.fetch,
            expand: opts.expand,
            flat: opts.flat,
            progress: p => {
                opts.silent || osd.show(lang.OPENING_LIST + ' ' + parseInt(p) + '%', 'fa-mega busy-x', 'list-open', 'persistent');
            }
        }));
        let err;
        const ret = await Promise.allSettled(tasks);
        let list = ret.map(r => {
            if(r.status == 'fulfilled') {
                return r.value;
            } else {
                err = r.reason || err;
            }
        }).filter(r => r).flat();
        if(err) {
            const s = String(err.message || err)
            if(!s.includes('file not found or empty')) {
                menu.displayErr(err)
            }
        }
        if (!list.length) {
            list.push({ name: lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty' });
        }
        if (!opts.raw) {
            list = this.prependAddListAction(list, v.url);
        }
        opts.silent || osd.hide('list-open');
        return list;
    }
    async fetch(v, opts = {}) {

        const master = this.master
        const lists = master.lists
        const url = typeof(v) === 'string' ? v : v.url
        const cachettl = 3600, now = (Date.now() / 1000)

        if(!url) {
            throw 'Invalid list address';
        }

        if (typeof(this.fetchCache[url]) != 'undefined' && this.fetchCache[url].size && this.fetchCache[url].time > (now - cachettl)) {
            return this.fetchCache[url].entries.slice(0) // clone it to avoid modifying the cache
        }

        let source, entries
        if (lists[url] && lists[url].fetchAll && (!opts.fetch || lists[url].length)) { // if not loaded yet, fetch directly
            const exists = await fsp.stat(lists[url].file).then(s => s.size > 0).catch(() => false)
            if (exists) {
                source = lists[url]
            }
        }
        
        if (!source) {
            if (opts.fetch) {
                source = new Fetcher(url, {
                    progress: opts.progress
                }, this.master)            
            } else {
                throw new Error('List not loaded');
            }
        }

        await source.ready()
        if(typeof(source.fetchAll) != 'function') {
            console.error({source}, typeof(source.fetchAll))
            throw new Error('List fetcher not ready');
        }

        if (opts.expand) {
            entries = await source.fetchAll()
        } else {
            entries = await source.getMap()
        }

        if (entries.length) {
            const size = entries.length
            entries = master.parentalControl.filter(entries, true);
            entries = master.prepareEntries(entries);
            if (!opts.flat) {
                entries = await master.tools.deepify(entries, { source: url });
                if (size >= options.offloadThreshold) {
                    // clone it to avoid modifying the cache
                    this.fetchCache[url] = {
                        entries: entries.slice(0),
                        time: now,
                        size
                    }
                }
            }
        }
        return entries 
    }
}

class Manager extends ManagerFetch {
    constructor(master) {
        super();
        this.master = master;
        this.addingLists = new Set();
        this.listFaIcon = 'fas fa-satellite-dish';
        this.key = 'lists';
        this.inputMemory = {}

        this.updateProgressLimiter = new Limiter(this.updateProgress.bind(this), 1000)
        this.master.on('state', info => this.updateProgressLimiter.call(info))
        this.master.on('satisfied', () => this.updateProgress(this.master.state))

        renderer.ready(async () => {
            renderer.ui.on('menu-back', () => osd.hide('list-open'))
            global.streamer.on('hard-failure', es => this.checkListExpiral(es).catch(err => console.error(err)))
            menu.prependFilter(async (es, path) => {
                es = await this.expandEntries(es, path)
                return this.labelify(es)
            })
            await this.master.ready()

            // Adicionar listener para recarregar sugestões quando necessário
            this.master.epg.on('reload-suggestions', async () => {
                console.log('🔄 Reloading EPG suggestions...')
                const activeEPG = config.get('epg-' + lang.locale)
                if (activeEPG === 'disabled' || config.get('epg-suggestions') === false) {
                    console.log('EPG suggestions disabled, skipping reload')
                    return
                }
                
                const urls = await this.master.searchEPGs()
                console.log('EPGS urls - MANAGER (reload)', urls)
                if (urls.length > 0) {
                    await this.master.epg.suggest(urls)
                }
            })

            const activeEPG = config.get('epg-' + lang.locale)
            if (activeEPG === 'disabled' || config.get('epg-suggestions') === false) return
            const suggest = !activeEPG || activeEPG === 'auto' || (Array.isArray(activeEPG) && activeEPG.length > 0)
            console.log('shouldSuggest', suggest, activeEPG)

            if (!suggest) return
            const urls = await this.master.searchEPGs()
            console.log('EPGS urls - MANAGER', urls)
            urls.length && await this.master.epg.suggest(urls)
        })
    }
    async expandEntries(entries, path) {
        let shouldExpand = entries.some(e => typeof(e._) == 'number' && !e.url);
        if (shouldExpand) {
            let source;
            entries.some(e => {
                if (e.source) {
                    source = e.source;
                    return true;
                }
            })
            if (source) {
                let list = this.master.lists[source]
                if (!list) {
                    const fetch = new Fetcher(source, {}, this.master)
                    await fetch.ready();
                    list = fetch.list;
                }
                entries = await list.indexer.expandMap(entries)
            }
        }
        return entries;
    }
    labelify(list) {
        for (let i = 0; i < list.length; i++) {
            if (list[i] && (typeof(list[i].type) == 'undefined' || list[i].type == 'stream')) {
                list[i].details = list[i].groupName || basename(list[i].path || list[i].group || '');
            }
        }
        return list;
    }
    inChannelPage() {
        return menu.currentEntries.some(e => lang.SHARE == e.name);
    }
    maybeRefreshChannelPage() {
        if (global.streamer && global.streamer.tuning && !global.streamer.tuning.destroyed)
            return;
        let isMega, streamsCount = 0;
        menu.currentEntries.some(e => {
            if (e.url && mega.isMega(e.url)) {
                isMega = mega.parse(e.url);
                return true;
            }
        });
        menu.currentEntries.some(e => {
            if (e.name.includes(lang.STREAMS)) {
                let match = e.name.match(new RegExp('\\(([0-9]+)\\)'));
                if (match) {
                    streamsCount = parseInt(match[1]);
                }
                return true;
            }
        });
        console.log('maybeRefreshChannelPage', streamsCount, isMega);
        if (isMega && isMega.terms) {
            this.master.search(isMega.terms, {
                safe: !this.master.parentalControl.lazyAuth(),
                type: isMega.mediaType,
                group: isMega.mediaType != 'live'
            }).then(es => {
                if (es.length > streamsCount) {
                    menu.refresh();
                }
            }).catch(err => console.error(err));
        }
    }
    get() {
        let r = false, lists = config.get(this.key) || [];
        for (let i = 0; i < lists.length; i++) {
            if (!Array.isArray(lists[i])) {
                delete lists[i];
                r = true;
            }
        }
        if (r) {
            lists = lists.filter(s => Array.isArray(s)).slice(0);
        }
        return lists.map(l => {
            l[1] = forwardSlashes(l[1]);
            return l;
        });
    }
    async getURLs() {
        return this.get().map(l => l[1]);
    }
    async add(url, name, uid) {
        url = String(url).trim();
        if (url.startsWith('//')) {
            url = 'http:' + url;
        }
        const isURL = validateURL(url), isFile = isLocal(url);
        if (!isFile && !isURL) {
            throw lang.INVALID_URL_MSG + ' Not a file or URL';
        }
        let lists = this.get();
        for (let i in lists) {
            if (lists[i][1] == url) {
                // throw lang.LIST_ALREADY_ADDED;
                return true;
            }
        }
        menu.path.endsWith(lang.MY_LISTS) && menu.refreshNow()
        const cacheFile = resolveListDatabaseFile(url)
        const stat = await fsp.stat(cacheFile).catch(() => {});
        if (stat && stat.size && stat.size < 16384) {
            await fsp.unlink(cacheFile).catch(err => console.error(err)); // invalidate possibly bad caches
        }
        this.addingLists.add(url)
        const fetch = new Fetcher(url, {
            progress: p => {
                if(p > 0) {
                    osd.show(lang.RECEIVING_LIST + ' ' + p + '%', 'fa-mega busy-x', 'add-list-progress-' + uid, 'persistent');
                }
            },
            timeout: Math.max(90, config.get('read-timeout')) // some servers take too long to respond with the list
        }, this.master)
        let err, entries = await fetch.getMap().catch(e => err = e)
        this.addingLists.delete(url)
        menu.path.endsWith(lang.MY_LISTS) && menu.refreshNow()
        this.master.updateState() // update status
        if (Array.isArray(entries) && entries.length) {
            if (!name) {
                let meta = await fetch.meta();
                if (meta.name) {
                    name = meta.name;
                } else {
                    await this.name(url).then(n => name = n).catch(() => {});
                }
            }
            let lists = this.get();
            lists.push([name, url]);
            config.set(this.key, lists);
            return true;
        } else {
            console.log({err, ferr: fetch.error, entries})
            if(!err) {
                err = fetch.error || 'No M3U entries were found';
            }
            const s = String(err.message || err)
            if(s.includes('file not found or empty')) {
                throw lang.INVALID_URL_MSG
            }
            throw lang.INVALID_URL_MSG + ' - ' + s
        }
    }
    async addList(listUrl, name, fromCommunity) {
        let err;
        const uid = parseInt(Math.random() * 100000);
        osd.show(lang.RECEIVING_LIST, 'fa-mega busy-x', 'add-list-progress-' + uid, 'persistent');
        renderer.ui.emit('background-mode-lock', 'add-list');
        listUrl = forwardSlashes(listUrl);
        await this.add(listUrl, name, uid).catch(e => err = e);
        osd.hide('add-list-progress-' + uid);
        renderer.ui.emit('background-mode-unlock', 'add-list');
        if (typeof(err) != 'undefined') {
            throw err;
        } else {
            if (!paths.ALLOW_ADDING_LISTS) {                
                paths.ALLOW_ADDING_LISTS = true;
                await fsp.writeFile(paths.cwd + '/ALLOW_ADDING_LISTS.md', 'ok').catch(err => console.error(err));
                menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT);
            }
            osd.show(lang.LIST_ADDED, 'fas fa-check-circle', 'add-list', 'normal');
            const isURL = validateURL(listUrl);
            const sensible = listUrl.match(new RegExp('(pwd?|pass|password)=', 'i')) || listUrl.match(new RegExp('#(xtream|mag)')) || listUrl.includes('@') || listUrl.includes('supratv') // protect sensible lists
            let makePrivate;
            if (fromCommunity) {
                makePrivate = false;
            } else if (!isURL || sensible) {
                makePrivate = true;
                config.set('communitary-mode-lists-amount', 0); // disable community lists to focus on user list
            } else if (paths.ALLOW_COMMUNITY_LISTS) {
                const chosen = await menu.dialog([
                    { template: 'question', text: lang.COMMUNITY_LISTS, fa: 'fas fa-users' },
                    { template: 'message', text: lang.WANT_SHARE_COMMUNITY },
                    { template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-lock' },
                    { template: 'option', text: lang.SHARE, id: 'yes', fa: 'fas fa-users' }
                ], 'no'); // set local files as private
                if (chosen == 'yes') {
                    makePrivate = false;
                    osd.show(lang.COMMUNITY_THANKS_YOU, 'fas fa-heart faclr-purple', 'communitary-lists-thanks', 'normal');
                } else {
                    makePrivate = true;
                    config.set('communitary-mode-lists-amount', 0); // disable community lists to focus on user lists
                }
            }
            this.setMeta(listUrl, 'private', makePrivate);
            await this.askAddEPG(listUrl);
            menu.refreshNow(); // epg options path
            return true;
        }
    }
    async askAddEPG(listUrl) {
        let info, i = 20;
        while (i > 0 && (!info || !info[listUrl])) {
            i--;
            await this.master.wait(500);
            info = await this.master.info();
        }
        if (info && info[listUrl] && info[listUrl].epg) {
            const currentEPGs = this.EPGs(true, true)
            const isMAG = listUrl.endsWith('#mag')
            const listEpgs = parseCommaDelimitedURIs(info[listUrl].epg).filter(validateURL).filter(u => !currentEPGs.includes(u))
            let valid = isMAG || listEpgs.length
            if (valid && listEpgs.length) {
                const url = listEpgs.shift()
                if (!isMAG) {
                    const sample = await Download.get({url, range: '0-512', responseType: 'text' })
                    if (typeof(sample) != 'string' || !sample.toLowerCase().includes('<tv'))
                        return
                }
                let chosen = await menu.dialog([
                    { template: 'question', text: ucWords(paths.manifest.name), fa: 'fas fa-star' },
                    { template: 'message', text: lang.ADDED_LIST_EPG },
                    { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                    { template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle' }
                ], 'yes')
                if (chosen == 'yes') {
                    config.set('epg-' + lang.locale, [{url, active: true}])
                    console.error('XEPG', chosen)
                }
            }
        }
    }
    remove(url) {
        let lists = config.get(this.key);
        if (typeof(lists) != 'object') {
            lists = [];
        }
        for (let i in lists) {
            if (!Array.isArray(lists[i]) || lists[i][1] == url) {
                delete lists[i];
            }
        }
        lists = lists.filter(item => {
            return item !== undefined;
        });
        config.set(this.key, lists);
        return lists;
    }
    urls() {
        let urls = [], lists = this.get();
        for (let i = 0; i < lists.length; i++) {
            urls.push(lists[i][1]);
        }
        return urls;
    }
    has(url) {
        return this.get().some(l => {
            return url == l[1];
        });
    }
    nameFromContent(content) {
        if (content) {
            let match = content.match(new RegExp('(iptv|pltv)-name *= *[\'"]([^\'"]+)'));
            if (match) {
                return match[2];
            }
        }
    }
    async name(url, content = '') {
        let name = this.getMeta(url, 'name');
        if (!name) {
            if (content) {
                name = this.nameFromContent(content);
            }
            if (typeof(name) != 'string' || !name) {
                name = listNameFromURL(url);
            }
        }
        return name;
    }
    validate(content) {
        // technically, a m3u8 may contain one stream only, so it can be really small
        return typeof(content) == 'string' && content.length >= 32 && content.toLowerCase().includes('#ext');
    }
    rename(url, name) {
        this.setMeta(url, 'name', name);
    }
    merge(entries, ns) {
        let es = entries.slice(0);
        ns.forEach(n => {
            let ok = false;
            es.forEach(e => {
                if (!ok && e.url == n.url) {
                    ok = true;
                }
            });
            if (!ok) {
                es.push(n);
            }
        });
        return es;
    }
    setMeta(url, key, val) {
        let lists = clone(this.get()); // clone it
        for (let i in lists) {
            if (lists[i][1] == url) {
                if (key == 'name') {
                    lists[i][0] = val;
                } else {
                    let obj = lists[i][2] || {};
                    obj[key] = val;
                    lists[i][2] = obj;
                }
                config.set('lists', lists);
            }
        }
    }
    getMeta(url, key) {
        let lists = this.get();
        for (let i in lists) {
            if (lists[i][1] == url) {
                let obj = lists[i][2] || {};
                return key ? (obj[key] ? obj[key] : null) : obj;
            }
        }
    }
    getUniqueLists(urls) {
        let already = [];
        return urls.filter(u => {
            let i = u.indexOf('//');
            u = i == -1 ? u : u.substr(i + 2);
            if (!already.includes(u)) {
                already.push(u);
                return true;
            }
        });
    }
    updateProgress(info) {
        const communityListsAmount = this.master.communityListsAmount
        const progress = info.length ? info.progress : 0
        let m, fa = 'fa-mega busy-x', duration = 'persistent';
        if (this.master.satisfied) {
            if (info.length || !communityListsAmount) {
                m = lang.LISTS_UPDATED;
                fa = 'fas fa-check-circle';
                duration = 'normal';
                this.master.isFirstRun = false;
            } else if(this.master.loader.queue.size) {
                m = communityListsAmount ? lang.SEARCH_COMMUNITY_LISTS : lang.STARTING_LISTS
            } else {
                this.hideUpdateProgress()
                m = -1; // do not show 'lists updated' message yet
            }
        } else {
            if(progress) {
                m = info.firstRun ? lang.STARTING_LISTS_FIRST_TIME_WAIT : lang.UPDATING_LISTS
                m += ' ' + progress + '%'
            } else {
                m = communityListsAmount ? lang.SEARCH_COMMUNITY_LISTS : lang.STARTING_LISTS
            }
        }
        if (m != this.lastProgressMessage) { // if == -1 it's not complete yet, no lists
            this.lastProgressMessage = m
            m == -1 || this.showUpdateProgress(m, fa, duration)
            if (menu?.currentEntries) {
                const updateBaseNames = [lang.TRENDING, lang.COMMUNITY_LISTS];
                const updateEntryNames = [lang.PROCESSING, lang.UPDATING_LISTS, lang.STARTING_LISTS];
                if (basename(menu.path) == lang.RECEIVED_LISTS) {
                    menu.refresh()
                } else if (updateBaseNames.includes(basename(menu.path)) ||
                    menu.currentEntries.some(e => updateEntryNames.includes(e.name))) {
                    if (m == -1) {
                        menu.refreshNow()
                    } else {
                        menu.refresh()
                    }
                } else if (this.inChannelPage()) {
                    this.maybeRefreshChannelPage()
                }
            }
        }
    }
    showUpdateProgress(m, fa, duration) {
        this.updateProgressVisible = true
        clearTimeout(this.updateProgressTimeout || 0)
        if (duration == 'normal') {
            this.updateProgressTimeout = setTimeout(() => {
                this.updateProgressVisible = false
            }, 5000)
        }
        osd.show(m, fa, 'update-progress', duration)
    }
    hideUpdateProgress() {
        this.updateProgressVisible = false
        osd.hide('update-progress')
    }
    noListsEntry() {
        if (config.get('communitary-mode-lists-amount') > 0) {
            return this.noListsRetryEntry();
        } else {
            if (this.addingLists.size) {
                return this.updatingListsEntry();
            } else {
                return {
                    name: lang.NO_LISTS_ADDED,
                    fa: 'fas fa-plus-square',
                    type: 'action',
                    action: () => {
                        menu.open(lang.MY_LISTS).catch(err => console.error(err));
                    }
                };
            }
        }
    }
    noListsRetryEntry() {
        return {
            name: lang.LOAD_COMMUNITY_LISTS,
            fa: 'fas fa-plus-square',
            type: 'action',
            action: async () => {
                await this.master.loader.reset()
                menu.refresh()
            }
        };
    }
    updatingListsEntry(name) {
        return {
            name: name || lang[this.master.isFirstRun ? 'STARTING_LISTS' : 'UPDATING_LISTS'],
            fa: 'fa-mega busy-x',
            type: 'action',
            action: () => {
                menu.refresh();
            }
        };
    }
    addListEntry(atts={}) {
        return Object.assign({
            name: lang.ADD_LIST,
            fa: 'fas fa-plus-square',
            type: 'action',
            action: () => {
                const offerCommunityMode = paths.ALLOW_COMMUNITY_LISTS && !config.get('communitary-mode-lists-amount');
                this.addListDialog(offerCommunityMode, atts).catch(e => menu.displayErr(e));
            }
        }, atts)
    }
    async addListDialog(offerCommunityMode, atts={}) {
        let extraOpts = [], openM3UText = paths.ALLOW_ADDING_LISTS ? lang.OPEN_M3U_FILE : lang.OPEN_FILE;
        extraOpts.push({ template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' });
        extraOpts.push({ template: 'option', text: openM3UText, id: 'file', fa: 'fas fa-folder-open' });
        extraOpts.push({ template: 'option', text: lang.ADD_USER_PASS, id: 'code', fa: 'fas fa-key' });
        if (offerCommunityMode) {
            extraOpts.push({ template: 'option', text: lang.COMMUNITY_LISTS, fa: 'fas fa-users', id: 'sh' });
        }
        extraOpts.push({ template: 'option', text: lang.ADD_MAC_ADDRESS, fa: 'fas fa-hdd', id: 'mac' });
        let id = await menu.prompt({
            question: lang[paths.ALLOW_ADDING_LISTS ? 'ASK_IPTV_LIST' : 'OPEN_URL'],
            placeholder: 'http://',
            fa: atts.fa || 'fas fa-plus-square',
            defaultValue: this.inputMemory['url'] || '',
            extraOpts
        });
        if (!id) {
            throw 'No input';
        } else if (id == 'file') {
            return this.addListDialogFile()
        } else if (id == 'code') {
            return this.addListCredentialsDialog()
        } else if (id == 'sh') {
            let active = await this.communityModeDialog()
            if (active) {
                return true;
            } else {
                return this.addListDialog(offerCommunityMode)
            }
        } else if (id == 'mac') {
            return this.addListMacDialog()
        } else {
            this.inputMemory['url'] = id
            return this.addList(id)
        }
    }
    async addListDialogFile() {
        const file = await menu.chooseFile('audio/x-mpegurl')
        return this.addList(file)
    }
    async communityModeDialog() {
        let choose = await menu.dialog([
            { template: 'question', text: lang.COMMUNITY_LISTS, fa: 'fas fa-users' },
            { template: 'message', text: lang.SUGGEST_COMMUNITY_LIST +"\r\n\r\n"+ lang.ASK_COMMUNITY_LIST },
            { template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: lang.I_AGREE },
            { template: 'option', id: 'fta', fa: 'fas fa-times-circle', text: lang.ONLY_FTA },
            { template: 'option', id: 'back', fa: 'fas fa-chevron-circle-left', text: lang.BACK }
        ], 'agree');
        if (choose == 'agree') {
            renderer.ui.localEmit('lists-manager', 'agree');
            return true;
        } else if (choose == 'fta') {
            return true;
        }
    }
    async addListCredentialsDialog() {
        const url = await this.askListCredentials();
        return this.addList(url);
    }
    async askListCredentials() {
        let server = await menu.prompt({
            question: lang.PASTE_SERVER_ADDRESS,
            placeholder: 'http://host:port',
            defaultValue: this.inputMemory['server'] || '',
            fa: 'fas fa-globe'
        });
        if (!server)
            throw 'no server provided';
        if (server.charAt(server.length - 1) == '/') {
            server = server.substr(0, server.length - 1);
        }
        if (server.startsWith('/')) {
            server = 'http:' + server;
        }
        if (server.includes('username=')) {
            return server;
        }
        this.inputMemory['server'] = server
        const user = await menu.prompt({
            question: lang.USERNAME,
            placeholder: lang.USERNAME,
            defaultValue: this.inputMemory['user'] || '',
            fa: 'fas fa-user'
        });
        if (!user) throw 'no user provided'
        this.inputMemory['user'] = user
        const pass = await menu.prompt({
            question: lang.PASSWORD,
            placeholder: lang.PASSWORD,
            defaultValue: this.inputMemory['pass'] || '',
            fa: 'fas fa-key',
            isPassword: true
        });
        if (!pass) throw 'no pass provided'
        this.inputMemory['pass'] = pass
        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'add-list-pre', 'persistent');
        let url = await this.getM3UFromCredentials(server, user, pass).catch(err => console.error(err));
        if (typeof(url) != 'string') {
            url = server.replace('//', '//' + user + ':' + pass + '@') + '#xtream';
            let chosen = await menu.dialog([
                { template: 'question', text: lang.ADD_USER_PASS, fa: 'fas fa-key' },
                { template: 'message', text: lang.INCLUDE_SERIES_CATALOG },
                { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
            ], 'yes').catch(err => console.error(err));
            if (chosen == 'no')
                url += '-all';
        }
        osd.hide('add-list-pre');
        return url;
    }
    async debugCredentials() {
        let err;
        const data = { version: paths.manifest.version };
        const { temp } = paths;
        const output = temp + '/xtr-' + parseInt(Math.random() * 10000000) + '.log.txt';
        const url = await this.askListCredentials().catch(e => err = e);
        if (err) {
            data.askListCredentials = String(err);
        } else {
            data.askListCredentials = url;
            if (url.includes('#xtream')) {
                const xtr = new Xtr(url, true);
                await xtr.run().catch(e => err = e);
                data.calls = xtr.debugInfo;
                if (err)
                    data.run = String(err);
                xtr.destroy();
            }
        }
        await fsp.writeFile(output, stringify(data));
        await downloads.serve(output, true);
    }
    async getM3UFromCredentials(server, user, pass) {
        if (server.endsWith('/')) {
            server = server.substr(0, server.length - 1);
        }
        const masks = [
            '{0}/get.php?username={1}&password={2}&output=mpegts&type=m3u_plus',
            '{0}/get.php?username={1}&password={2}&output=ts&type=m3u_plus',
            '{0}/get.php?username={1}&password={2}&output=hls&type=m3u_plus',
            '{0}/get.php?username={1}&password={2}&type=m3u_plus'
        ];
        if (server.includes('username=')) {
            masks.push(server);
        }
        for (const mask of masks) {
            const url = mask.format(server, user, pass);
            const ret = await Download.head({ url }).catch(() => {});
            if (ret && ret.statusCode == 200)
                return url;
        }
        throw 'Invalid credentials.';
    }
    async addListMacDialog() {
        const macAddress = this.formatMacAddress(await menu.prompt({
            question: lang.MAC_ADDRESS,
            placeholder: '00:00:00:00:00:00',
            fa: 'fas fa-hdd',
            defaultValue: this.inputMemory['mac'] || ''
        }));
        if (!macAddress || macAddress.length != 17)
            throw 'Invalid MAC address';
        this.inputMemory['mac'] = macAddress
        let server = await menu.prompt({
            question: lang.PASTE_SERVER_ADDRESS,
            placeholder: 'http://host:port',
            fa: 'fas fa-globe',
            defaultValue: this.inputMemory['server'] || ''
        });
        if (!server)
            throw 'Invalid server provided';
        if (server.charAt(server.length - 1) == '/') {
            server = server.substr(0, server.length - 1);
        }
        this.inputMemory['server'] = server
        let err;
        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'add-list-mac', 'persistent');
        const url = await this.getM3UPlaylistForMac(macAddress, server).catch(e => err = e);
        osd.hide('add-list-mac');
        if (err)
            throw err;
        return this.addList(url);
    }
    formatMacAddress(str) {
        if (!str)
            return '';
        const mask = [];
        const filteredStr = str.replace(new RegExp('[^0-9a-fA-F]', 'g'), '').toUpperCase();
        for (let i = 0; i < 12; i += 2) {
            mask.push(filteredStr.substr(i, 2));
        }
        return mask.join(':').substr(0, 17);
    }
    async getM3UPlaylistForMac(mac, server) {
        if (server.endsWith('/')) {
            server = server.substr(0, server.length - 1);
        }
        const mag = new Mag(server.replace('://', '://' + mac + '@'));
        await mag.prepare();
        const data = await mag.execute({
            action: 'get_ordered_list',
            type: 'vod', p: 1,
            JsHttpRequest: '1-xml'
        });
        const cmd = data.data[0].cmd;
        const ret = await mag.execute({ action: 'create_link', type: 'vod', cmd, JsHttpRequest: '1-xml' });
        const res = ret.cmd.split('/');
        if (res.length >= 6) {
            const user = res[4], pass = res[5];
            const list = await this.getM3UFromCredentials(server, user, pass).catch(() => {});
            if (typeof(list) == 'string' && list) {
                return list;
            }
        }
        return server.replace('://', '://' + mac + '@') + '#mag';
    }
    listsEntry(manageOnly) {
        return {
            name: manageOnly ? lang.IPTV_LISTS : lang.MY_LISTS,
            details: manageOnly ? lang.CONFIGURE : lang.IPTV_LISTS,
            type: 'group',
            fa: 'fas fa-list',
            renderer: async () => {
                let lists = this.get();
                const extInfo = await this.master.info(true);
                const doNotShareHint = !config.get('communitary-mode-lists-amount');
                let ls = [];
                for (const row of lists) {
                    let url = row[1];
                    if (!extInfo[url])
                        extInfo[url] = {};
                    let name = extInfo[url].name || row[0] || listNameFromURL(url);
                    let details = [extInfo[url].author || '', '<i class="fas fa-play-circle"></i> ' + kfmt(extInfo[url].length || 0)].filter(n => n).join(' &nbsp;&middot;&nbsp; ');
                    let icon = extInfo[url].icon || undefined;
                    let priv = (row.length > 2 && typeof(row[2]['private']) != 'undefined') ? row[2]['private'] : doNotShareHint;
                    let expired = await this.master.isListExpired(url, false);
                    let flag = expired ? 'fas fa-exclamation-triangle faclr-red' : (priv ? 'fas fa-lock' : 'fas fa-users');
                    ls.push({
                        prepend: '<i class="' + flag + '"></i>&nbsp;',
                        name, url, icon, details,
                        fa: 'fas fa-satellite-dish',
                        type: 'group',
                        class: 'skip-testing',
                        renderer: async () => {
                            let es = [];
                            let contactUrl, contactFa;
                            const meta = this.master.lists[url]?.index?.meta ?? {};
                            if (meta.site) {
                                contactUrl = meta.site;
                                contactFa = 'fas fa-globe';
                            } else if (meta.email) {
                                contactUrl = 'mailto:' + meta.email;
                                contactFa = 'fas fa-envelope';
                            } else if (meta.phone) {
                                contactUrl = 'tel:+' + meta.phone.replace(new RegExp('[^0-9]+'), '');
                                contactFa = 'fas fa-phone';
                            }
                            const options = [
                                {
                                    name: lang.RENAME,
                                    fa: 'fas fa-edit',
                                    type: 'input',
                                    class: 'skip-testing',
                                    action: (e, v) => {
                                        if (v !== false) {
                                            let path = menu.path, parentPath = menu.dirname(path);
                                            if (path.includes(name)) {
                                                path = path.replace('/' + name, '/' + v);
                                            } else {
                                                path = false;
                                            }
                                            name = v;
                                            this.rename(url, v);
                                            if (path) {
                                                if (parentPath)
                                                    delete menu.pages[parentPath];
                                                menu.open(path).catch(e => menu.displayErr(e));
                                            } else {
                                                menu.back(null, true);
                                            }
                                        }
                                    },
                                    value: () => {
                                        return name;
                                    },
                                    safe: true
                                },
                                {
                                    name: lang.RELOAD,
                                    fa: 'fas fa-sync',
                                    type: 'action', url,
                                    class: 'skip-testing',
                                    action: this.refreshList.bind(this)
                                },
                                {
                                    name: lang.REMOVE_LIST,
                                    fa: 'fas fa-trash',
                                    type: 'action', url,
                                    class: 'skip-testing',
                                    action: this.removeList.bind(this)
                                }
                            ];
                            if (contactUrl) {
                                options.splice(2, 0, {
                                    name: lang.CONTACT_PROVIDER,
                                    type: 'action',
                                    fa: contactFa,
                                    action: () => {
                                        renderer.ui.emit('open-external-url', contactUrl);
                                    }
                                });
                            }
                            if (manageOnly)
                                return options;
                            es = await this.renderList({ url }, {
                                raw: true,
                                fetch: false,
                                flat: false
                            }).catch(err => menu.displayErr(err));
                            if (!Array.isArray(es)) {
                                es = []
                            }
                            es.unshift({
                                name: lang.OPTIONS,
                                fa: 'fas fa-bars',
                                type: 'select',
                                entries: options
                            });
                            return es;
                        }
                    });
                }
                if (this.addingLists.size) {
                    ls.push({
                        name: lang.RECEIVING_LIST,
                        fa: 'fa-mega busy-x',
                        type: 'action',
                        action: () => menu.refresh()
                    });
                }
                ls.push(this.addListEntry());
                manageOnly || ls.push(this.epgEntry(false));
                return ls;
            }
        }
    }
    async refreshList(data) {
        let updateErr
        await this.master.loader.reload(data.url).catch(e => updateErr = e)
        if (updateErr) {
            if (updateErr == 'empty list' || updateErr == 'empty index') {
                let haserr, msg = updateErr;
                const ret = await Download.head({ url: data.url }).catch(err => haserr = err);
                if (ret && typeof(ret.statusCode) == 'number') {
                    switch (String(ret.statusCode)) {
                        case '200':
                        case '210':
                        case '400':
                        case '401':
                        case '403':
                            msg = 'List expired.';
                            break;
                        case '-1':
                        case '404':
                        case '410':
                            msg = 'List expired or deleted from the server.';
                            break;
                        case '0':
                        case '421':
                        case '453':
                        case '500':
                        case '502':
                        case '503':
                        case '504':
                            msg = 'Server temporary error: ' + ret.statusCode;
                            break;
                    }
                } else {
                    msg = haserr || 'Server offline error';
                }
                updateErr = msg;
            }
            menu.refreshNow();
            menu.displayErr(updateErr);
        } else {            
            await this.master.loadList(data.url).catch(err => updateErr = err);
            menu.refreshNow();
            if (updateErr) {
                menu.displayErr(updateErr);
            } else {
                osd.show('OK', 'fas fa-check-circle faclr-green', 'refresh-list', 'normal');
                return true; // return here, so osd will not hide
            }
        }
        osd.hide('refresh-list');
    }
    async removeList(data) {
        const info = await this.master.info(true), key = 'epg-' + lang.locale;
        if (info[data.url] && info[data.url].epg) {
            const urls = new Set(parseCommaDelimitedURIs(info[data.url].epg))
            let data = this.EPGs()
            data = data.filter(e => !urls.has(e.url))
            config.set(key, data)
        }
        menu.suspendRendering();
        try { // Ensure that we'll resume rendering
            this.remove(data.url);
        } catch (e) {}
        osd.show(lang.LIST_REMOVED, 'fas fa-info-circle', 'list-open', 'normal');
        menu.resumeRendering();
        menu.back(null, true);
    }
    prependAddListAction(list, url) {
        const actionIcons = ['fas fa-minus-square', 'fas fa-plus-square'];
        if (!list.some(e => actionIcons.includes(e.fa))) {
            if (this.has(url)) {
                list.unshift({
                    type: 'action',
                    name: lang.LIST_ALREADY_ADDED,
                    details: lang.REMOVE_LIST,
                    fa: 'fas fa-minus-square',
                    action: () => {
                        this.remove(url);
                        osd.show(lang.LIST_REMOVED, 'fas fa-info-circle', 'list-open', 'normal');
                        menu.refreshNow(); // epg options path
                    }
                });
            } else {
                list.unshift({
                    type: 'action',
                    fa: 'fas fa-plus-square',
                    name: lang.ADD_TO.format(lang.MY_LISTS),
                    action: () => {
                        this.addList(url, '', true).catch(err => console.error(err)).finally(() => {
                            setTimeout(() => menu.refreshNow(), 100);
                        });
                    }
                });
            }
        }
        return list;
    }
    async checkListExpiral(es) {
        if (!this.master.activeLists.my.length)
            return;
        if (!this.checkListExpiralTimes)
            this.checkListExpiralTimes = {};
        if (!es || !es.length)
            es = this.master.myLists.map(source => ({ source }));
        const now = (Date.now() / 1000);
        const checkListExpiralInterval = this.master.activeLists.community.length ? 600 : 30;
        const myBadSources = es.map(e => e.source).filter(e => e).unique().filter(u => this.master.activeLists.my.includes(u));
        for (const source of myBadSources) {
            if (this.checkListExpiralTimes[source] && (now < (this.checkListExpiralTimes[source] + checkListExpiralInterval))) {
                continue;
            }
            this.checkListExpiralTimes[source] = now;
            let expired;
            await this.master.isListExpired(source, true).then(e => expired = e).catch(err => {
                console.error(err);
                expired = true; // 'no valid links' error
            });
            if (expired) {
                const meta = this.master.lists[source]?.index?.meta ?? {};
                const name = meta.name || meta.author || paths.manifest.name;
                const opts = [
                    { template: 'question', text: name, fa: 'fas fa-exclamation-triangle faclr-red' },
                    { template: 'message', text: lang.IPTV_LIST_EXPIRED + "\r\n\r\n" + source },
                    { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' }
                ];
                let contactUrl, contactFa;
                if (meta.site) {
                    contactUrl = meta.site;
                    contactFa = 'fas fa-globe';
                } else if (meta.email) {
                    contactUrl = 'mailto:' + meta.email;
                    contactFa = 'fas fa-envelope';
                } else if (meta.phone) {
                    contactUrl = 'tel:+' + meta.phone.replace(new RegExp('[^0-9]+'), '');
                    contactFa = 'fas fa-phone';
                }
                let offer;
                if (contactUrl) {
                    opts.push({
                        template: 'option',
                        text: lang.CONTACT_PROVIDER,
                        id: 'contact',
                        fa: contactFa
                    });
                } else {
                    offer = await global.promo.offer('dialog', ['communitary']).catch(err => console.error(err));
                    if (offer && offer.type == 'dialog') {
                        opts.push({
                            template: 'option',
                            text: offer.title,
                            id: 'offer',
                            fa: offer.fa
                        });
                    }
                }
                const ret = await menu.dialog(opts);
                if (ret == 'contact') {
                    renderer.ui.emit('open-external-url', contactUrl);
                } else if (ret == 'offer') {
                    await global.promo.dialogOffer(offer)
                }
            }
        }
    }
    async hook(entries, path) {
        if (!path) {
            if (paths.ALLOW_ADDING_LISTS) {
                const entry = this.listsEntry(false)
                entry.side = true
                insertEntry(entry, entries, [
                    lang.TOOLS, lang.OPTIONS
                ], [
                    lang.BOOKMARKS,
                    lang.KEEP_WATCHING,
                    lang.RECOMMENDED_FOR_YOU,
                    lang.CATEGORY_MOVIES_SERIES
                ])
            } else {
                if (!entries.some(e => e.name == lang.OPEN_URL)) {
                    const entry = this.addListEntry({
                        side: true,
                        name: lang.OPEN_URL,
                        fa: 'fas fa-cloud-download-alt'
                    })
                    insertEntry(entry, entries, [
                        lang.TOOLS,
                        lang.OPTIONS
                    ], [
                        lang.BOOKMARKS,
                        lang.KEEP_WATCHING,
                        lang.CATEGORY_MOVIES_SERIES,
                        lang.IPTV_LISTS,
                        lang.RECORDINGS,
                        lang.TRENDING,
                        lang.SEARCH
                    ])
                }
            }
            insertEntry(this.epgEntry(true), entries, [
                lang.TOOLS, lang.OPTIONS
            ], [
                lang.BOOKMARKS,
                lang.KEEP_WATCHING,
                lang.MY_LISTS,
                lang.CATEGORY_MOVIES_SERIES
            ])
        } else if (path.endsWith(lang.MANAGE_CHANNEL_LIST)) {
            const entry = this.addEPGEntry()
            entry.name = lang.EPG
            entry.details = lang.ADD
            entries.push(entry)
        }
        return entries;
    }
}
export default Manager;
