import Download from '../download/download.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import mega from "../mega/mega.js";
import fs from "fs";
import Xtr from "./xtr.js";
import crashlog from "../crashlog/crashlog.js";
import downloads from "../downloads/downloads.js";
import Mag from "./mag.js";
import { EventEmitter } from "events";
import { promises as fsp } from "fs";
import { basename, deepClone, forwardSlashes, insertEntry, kfmt, LIST_DATA_KEY_MASK, listNameFromURL, validateURL } from "../utils/utils.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'

class ManagerEPG extends EventEmitter {
    constructor() {
        super();
        this.lastActiveEPGDetails = '';
        renderer.ready(() => {
            menu.on('open', path => {
                if (this.addingEPG || (path == this.epgSelectionPath())) {
                    if (!this.epgStatusTimer) {
                        this.epgStatusTimer = setInterval(() => this.updateEPGStatus().catch(console.error), 1000);
                    }
                } else {
                    if (this.epgStatusTimer) {
                        clearInterval(this.epgStatusTimer);
                        this.epgStatusTimer = 0;
                    }
                }
            });
        });
    }
    epgSelectionPath() {
        return lang.MY_LISTS + '/' + lang.EPG + '/' + lang.SELECT;
    }
    epgLoadingStatus(epgStatus) {
        let details = '';
        if (Array.isArray(epgStatus)) {
            switch (epgStatus[0]) {
                case 'uninitialized':
                    details = '<i class="fas fa-clock"></i>';
                    break;
                case 'loading':
                    details = lang.LOADING;
                    break;
                case 'connecting':
                    details = lang.CONNECTING;
                    break;
                case 'connected':
                    details = lang.PROCESSING + ' ' + epgStatus[1] + '%';
                    break;
                case 'loaded':
                    details = lang.ENABLED;
                    break;
                case 'error':
                    if (epgStatus[1].indexOf('worker manually terminated') == -1) { // in EPG change worker transition
                        details = 'Error: ' + epgStatus[1];
                    }
                    break;
            }
        }
        this.lastActiveEPGDetails = details;
        return details;
    }
    async updateEPGStatus() {
        let err;
        const epgData = await this.master.epg([], 2).catch(e => err = e);
        err || this.epgLoadingStatus(epgData);
        if (this.addingEPG && this.lastActiveEPGDetails && !this.lastActiveEPGDetails.startsWith('Error:')) {
            osd.show(this.lastActiveEPGDetails, 'fas fa-circle-notch fa-spin', 'epg-add', 'persistent');
        }
        if (this.epgSelectionPath() == menu.path) {
            if (this.lastDetailedEPGDetails !== this.lastActiveEPGDetails) {
                this.lastDetailedEPGDetails = this.lastActiveEPGDetails;
                let es = await this.epgOptionsEntries();
                if (this.epgStatusTimer) {
                    es = es.map(e => {
                        if (e.name == lang.SYNC_EPG_CHANNELS) {
                            e.value = e.checked();
                        }
                        return e;
                    });
                    menu.render(es, this.epgSelectionPath(), global.channels ? global.channels.epgIcon : '');
                }
            }
        } else {
            this.lastDetailedEPGDetails = undefined;
        }
    }
    activeEPG() {
        let activeEPG = config.get('epg-' + lang.locale) || global.activeEPG;
        if (!activeEPG || activeEPG == 'disabled') {
            activeEPG = '';
        }
        if (activeEPG) {
            activeEPG = this.master.parseEPGs(activeEPG, false);
        }
        return activeEPG;
    }
    async epgOptionsEntries() {
        let options = [], epgs = [];
        await this.searchEPGs().then(urls => epgs.push(...urls)).catch(console.error);
        let activeEPG = this.activeEPG();
        if (activeEPG) {
            epgs.includes(activeEPG) || epgs.push(activeEPG);
        }
        options = epgs.unique().sort().map(url => {
            let details = '', name = listNameFromURL(url);
            if (url == activeEPG) {
                if (this.lastActiveEPGDetails) {
                    details = this.lastActiveEPGDetails;
                } else {
                    if (global.channels && global.channels.loadedEPG == url) {
                        details = lang.EPG_LOAD_SUCCESS;
                    } else {
                        details = lang.PROCESSING;
                    }
                }
            }
            return {
                name,
                type: 'action',
                fa: 'fas fa-th-large',
                url,
                prepend: (url == activeEPG) ? '<i class="fas fa-check-circle faclr-green"></i> ' : '',
                details,
                action: () => {
                    if (url == config.get('epg-' + lang.locale)) {
                        config.set('epg-' + lang.locale, 'disabled');
                        global.channels && global.channels.load();
                        this.setEPG('', true);
                    } else {
                        config.set('epg-' + lang.locale, url);
                        this.setEPG(url, true);
                    }
                    menu.refreshNow(); // epg options path
                }
            };
        });
        options.unshift(this.addEPGEntry());
        return options;
    }
    addEPGEntry() {
        return {
            name: lang.ADD, fa: 'fas fa-plus-square',
            type: 'action', action: async () => {
                const url = await menu.prompt({
                    question: lang.EPG,
                    placeholder: 'http://.../epg.xml',
                    defaultValue: this.lastEPGURLInput || global.activeEPG || '',
                    fa: global.channels ? global.channels.epgIcon : ''
                });
                if (url && url.length > 6) {
                    this.lastEPGURLInput = url
                    console.log('SET-EPG', url, global.activeEPG);
                    const { manager } = lists;
                    config.set('epg-' + lang.locale, url || 'disabled');
                    manager.setEPG(url, true).catch(console.error);
                    menu.refresh();
                }
            }
        };
    }
    async setEPG(url, ui) {
        await renderer.ready(true)
        if (typeof (url) == 'string') {
            if (url) {
                url = this.master.parseEPGs(url, false);
            }
            if (url == global.activeEPG)
                return;
            if (!url || validateURL(url)) {
                global.activeEPG = url;
                global.channels.loadedEPG = '';
                await this.loadEPG(url, ui);
                let refresh = () => {
                    if (menu.path.indexOf(lang.EPG) != -1 || menu.path.indexOf(lang.LIVE) != -1) {
                        menu.refreshNow();
                    }
                };
                if (!url) {
                    global.channels.load();
                    ui && osd.show(lang.EPG_DISABLED, 'fas fa-times-circle', 'epg', 'normal');
                }
                refresh();
            } else {
                if (ui) {
                    osd.show(lang.INVALID_URL, 'fas fa-exclamation-triangle faclr-red', 'epg', 'normal');
                }
                throw lang.INVALID_URL;
            }
        }
    }
    async loadEPG(url, ui) {
        await renderer.ready(true)
        global.channels.loadedEPG = '';
        if (!url && config.get('epg-' + lang.locale) != 'disabled') {
            url = config.get('epg-' + lang.locale);
        }
        if (!url && ui) {
            ui = false;
        }
        this.lastActiveEPGDetails = lang.EPG_AVAILABLE_SOON;
        if (ui) {
            this.addingEPG = true;
            console.error('ASSIGN EPG')
            osd.show(lang.EPG_AVAILABLE_SOON, 'fas fa-circle-notch fa-spin', 'epg-add', 'persistent');
        }
        let err;
        await this.master.loadEPG(url).catch(e => err = e);
        this.addingEPG = false;
        if (err) {
            console.error(err);
            osd.show(lang.EPG_LOAD_FAILURE + ': ' + String(err), 'fas fa-times-circle', 'epg-add', 'normal');
            throw err;
        }
        global.channels.loadedEPG = url;
        global.channels.emit('epg-loaded', url)
        if (ui) {
            osd.show(lang.EPG_LOAD_SUCCESS, 'fas fa-check-circle', 'epg-add', 'normal');
        }
        if (menu.path == lang.TRENDING || (menu.path.startsWith(lang.LIVE) && menu.path.split('/').length == 2)) {
            menu.refresh()
        }
        return true
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
                        type: 'group',
                        fa: 'fas fa-cog',
                        renderer: async () => {
                            const epgData = await this.master.epg([], 2);
                            this.epgLoadingStatus(epgData);
                            return await this.epgOptionsEntries();
                        }
                    }
                ];
                if (global.channels.loadedEPG) {
                    entries.push(...[
                        global.channels.epgSearchEntry(),
                        global.channels.chooseChannelGridOption(true),
                        ...global.channels.channelList.getCategories().map(category => {
                            const rawname = lang.CATEGORY_KIDS == category.name ? '[fun]' + category.name + '[|fun]' : category.name;
                            return {
                                name: category.name,
                                rawname,
                                type: 'group',
                                renderer: () => this.epgCategoryEntries(category)
                            };
                        })
                    ]);
                } else {
                    entries.push({
                        name: global.channels.loadedEPG ? lang.EMPTY : lang.EPG_DISABLED,
                        details: this.lastActiveEPGDetails,
                        fa: 'fas fa-info-circle',
                        type: 'action',
                        class: 'entry-empty',
                        action: () => {
                            menu.open(this.epgSelectionPath()).catch(console.error);
                        }
                    });
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
                e.terms.name = terms[e.name] = data.terms
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
                    return await global.channels.epgChannelEntries(c)
                }
            };
        })
        return await global.channels.epgChannelsAddLiveNow(chs, false)
    }
}
class Manager extends ManagerEPG {
    constructor(master) {
        super();
        this.master = master;
        this.listFaIcon = 'fas fa-satellite-dish';
        this.key = 'lists';
        this.lastProgress = 0;
        this.openingList = false;
        this.inputMemory = {}
        renderer.ready(async () => {
            global.streamer.on('hard-failure', es => this.checkListExpiral(es).catch(console.error));
            menu.prependFilter(async (es, path) => {
                es = await this.expandEntries(es, path);
                return this.labelify(es);
            });
            this.master.on('unsatisfied', () => this.update());
        });
        renderer.get().on('menu-back', () => {
            if (this.openingList) {
                osd.hide('list-open');
            }
        });
    }
    async expandEntries(entries, path) {
        let shouldExpand = entries.some(e => typeof (e._) == 'number' && !e.url);
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
                    const fetch = new this.master.Fetcher(source, {}, this.master)
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
            if (list[i] && (typeof (list[i].type) == 'undefined' || list[i].type == 'stream')) {
                list[i].details = list[i].groupName || basename(list[i].path || list[i].group || '');
            }
        }
        return list;
    }
    waitListsReady(timeoutSecs) {
        return new Promise(resolve => {
            const listener = info => {
                if (this.master.satisfied && info.length) {
                    this.hideUpdateProgress()
                    setTimeout(() => this.master.removeListener('satisfied', listener), 0)
                    resolve(true)
                }
            };
            this.master.on('satisfied', listener);
            typeof (timeoutSecs) == 'number' && setTimeout(() => resolve(false), timeoutSecs * 1000);
            listener(this.master.status())
        });
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
            if (e.name.indexOf(lang.STREAMS) != -1) {
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
            }).catch(console.error);
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
        const isURL = validateURL(url), isFile = this.isLocal(url);
        if (!isFile && !isURL) {
            throw lang.INVALID_URL_MSG + ' Not a file or URL';
        }
        let lists = this.get();
        for (let i in lists) {
            if (lists[i][1] == url) {
                throw lang.LIST_ALREADY_ADDED;
            }
        }
        this.addingList = true;
        menu.path.endsWith(lang.MY_LISTS) && menu.refreshNow();
        const cacheFile = storage.resolve(LIST_DATA_KEY_MASK.format(url));
        const stat = await fs.promises.stat(cacheFile).catch(console.error);
        if (stat && stat.size && stat.size < 16384) {
            await fs.promises.unlink(cacheFile).catch(console.error); // invalidate possibly bad caches
        }
        const fetch = new this.master.Fetcher(url, {
            progress: p => {
                osd.show(lang.RECEIVING_LIST + ' ' + p + '%', 'fa-mega spin-x-alt', 'add-list-progress-' + uid, 'persistent');
            },
            timeout: Math.max(90, config.get('read-timeout')) // some servers take too long to respond with the list
        }, this.master);
        let err, entries = await fetch.getMap().catch(e => err = e);
        this.addingList = false;
        menu.path.endsWith(lang.MY_LISTS) && menu.refreshNow();
        this.master.status();
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
            throw lang.INVALID_URL_MSG + ' - ' + (err || fetch.error || 'No M3U entries were found');
        }
    }
    async addList(listUrl, name, fromCommunity) {
        let err;
        const uid = parseInt(Math.random() * 100000);
        osd.show(lang.RECEIVING_LIST, 'fa-mega spin-x-alt', 'add-list-progress-' + uid, 'persistent');
        renderer.get().emit('background-mode-lock', 'add-list');
        listUrl = forwardSlashes(listUrl);
        await this.add(listUrl, name, uid).catch(e => err = e);
        osd.hide('add-list-progress-' + uid);
        renderer.get().emit('background-mode-unlock', 'add-list');
        if (typeof (err) != 'undefined') {
            throw err;
        } else {
            if (!paths.ALLOW_ADDING_LISTS) {                
                paths.ALLOW_ADDING_LISTS = true;
                await fs.promises.writeFile(paths.cwd + '/ALLOW_ADDING_LISTS.md', 'ok').catch(console.error);
                menu.info(lang.LEGAL_NOTICE, lang.TOS_CONTENT);
            }
            osd.show(lang.LIST_ADDED, 'fas fa-check-circle', 'add-list', 'normal');
            const isURL = validateURL(listUrl);
            const sensible = listUrl.match(new RegExp('(pwd?|pass|password)=', 'i')) || listUrl.match(new RegExp('#(xtream|mag)')) || listUrl.indexOf('@') != -1 || listUrl.indexOf('supratv') != -1; // protect sensible lists
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
            await this.wait(500);
            info = await this.master.info();
        }
        if (info && info[listUrl] && info[listUrl].epg) {
            const currentEPG = config.get('epg-' + lang.locale);
            const isMAG = listUrl.endsWith('#mag');
            info[listUrl].epg = this.master.parseEPGs(info[listUrl].epg, false);
            let valid = isMAG || validateURL(info[listUrl].epg);
            if (valid && info[listUrl].epg != currentEPG) {
                if (!isMAG) {
                    const sample = await Download.get({ url: info[listUrl].epg, range: '0-512', responseType: 'text' });
                    if (typeof (sample) != 'string' || sample.toLowerCase().indexOf('<tv') == -1)
                        return;
                }
                let chosen = await menu.dialog([
                    { template: 'question', text: ucWords(paths.manifest.name), fa: 'fas fa-star' },
                    { template: 'message', text: lang.ADDED_LIST_EPG },
                    { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                    { template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle' }
                ], 'yes');
                if (chosen == 'yes') {
                    config.set('epg-' + lang.locale, info[listUrl].epg);
                    await this.setEPG(info[listUrl].epg, true);
                    console.error('XEPG', chosen);
                }
            }
        }
    }
    remove(url) {
        let lists = config.get(this.key);
        if (typeof (lists) != 'object') {
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
            let match = content.match(new RegExp('(iptv|pltv)\\-name *= *[\'"]([^\'"]+)'));
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
            if (typeof (name) != 'string' || !name) {
                name = listNameFromURL(url);
            }
        }
        return name;
    }
    isLocal(file) {
        if (typeof (file) != 'string') {
            return;
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true;
        } else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true;
            }
        }
    }
    validate(content) {
        // technically, a m3u8 may contain one stream only, so it can be really small
        return typeof (content) == 'string' && content.length >= 32 && content.toLowerCase().indexOf('#ext') != -1;
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
        let lists = deepClone(this.get()); // clone it
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
    wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
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
    update() {
        let p = this.master.status();
        const c = config.get('communitary-mode-lists-amount');
        const m = p.progress ? (lang[p.firstRun ? 'STARTING_LISTS_FIRST_TIME_WAIT' : 'UPDATING_LISTS'] + ' ' + p.progress + '%') : (c ? lang.SEARCH_COMMUNITY_LISTS : lang.STARTING_LISTS);
        if (!this.receivedCommunityListsListener) {
            this.receivedCommunityListsListener = () => {
                if (menu.path && basename(menu.path) == lang.RECEIVED_LISTS) {
                    menu.refresh();
                }
            };
            this.master.on('status', this.receivedCommunityListsListener);
        }
        if (this.master.satisfied || this.isUpdating || (!p.length && !c))
            return;
        let lastProgressMessage, lastProgress = -1;
        const listener = info => {
            if(info) p = info
            this.master.satisfied && p && p.length && this.hideUpdateProgress()
        }
        const processStatus = () => {
            this.master.satisfied && p && p.length && this.hideUpdateProgress()
            this.master.on('satisfied', listener);
            if (lastProgress >= p.progress) return;
            lastProgress = p.length ? p.progress : 0;
            let m, fa = 'fa-mega spin-x-alt', duration = 'persistent';
            if (this.master.satisfied) {
                clearInterval(this.isUpdating);
                delete this.isUpdating;
                if (p.length) {
                    this.master.off('status', listener);
                    this.master.off('satisfied', listener);
                    this.master.off('unsatisfied', listener);
                    m = lang.LISTS_UPDATED;
                    this.master.isFirstRun = false;
                } else {
                    m = -1; // do not show 'lists updated' message yet
                }
                fa = 'fas fa-check-circle';
                duration = 'normal';
                this.master.removeListener('status', listener);
            } else {
                m = lang[p.firstRun ? 'STARTING_LISTS_FIRST_TIME_WAIT' : 'UPDATING_LISTS'] + ' ' + p.progress + '%';
            }
            if (m != -1 && m != lastProgressMessage) { // if == -1 it's not complete yet, no lists
                lastProgressMessage = m
                this.showUpdateProgress(m, fa, duration)
            }
            if (menu && menu.currentEntries) {
                const updateEntryNames = [lang.PROCESSING, lang.UPDATING_LISTS, lang.STARTING_LISTS];
                const updateBaseNames = [lang.TRENDING, lang.COMMUNITY_LISTS];
                if (updateBaseNames.includes(basename(menu.path)) ||
                    menu.currentEntries.some(e => updateEntryNames.includes(e.name))) {
                    if (m == -1) {
                        menu.refreshNow();
                    } else {
                        menu.refresh();
                    }
                } else if (this.inChannelPage()) {
                    this.maybeRefreshChannelPage();
                }
            }
        }
        this.showUpdateProgress(m, 'fa-mega spin-x-alt', 'persistent')
        this.master.on('status', listener);
        this.master.on('satisfied', listener);
        this.master.on('unsatisfied', listener);
        this.master.loader.on('progresses', () => {            
            listener(this.master.status());
        });
        this.isUpdating = setInterval(processStatus, 2000)
    }
    showUpdateProgress(m, fa, duration) {
        this.updateProgressVisible = true
        osd.show(m, fa, duration)
    }
    hideUpdateProgress() {
        if(!this.updateProgressVisible) return
        this.updateProgressVisible = false
        osd.hide('update-progress')
    }
    noListsEntry() {
        if (config.get('communitary-mode-lists-amount') > 0) {
            return this.noListsRetryEntry();
        } else {
            if (this.addingList) {
                return this.updatingListsEntry();
            } else {
                return {
                    name: lang.NO_LISTS_ADDED,
                    fa: 'fas fa-plus-square',
                    type: 'action',
                    action: () => {
                        menu.open(lang.MY_LISTS).catch(console.error);
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
            action: () => this.update()
        };
    }
    updatingListsEntry(name) {
        return {
            name: name || lang[this.master.isFirstRun ? 'STARTING_LISTS' : 'UPDATING_LISTS'],
            fa: 'fa-mega spin-x-alt',
            type: 'action',
            action: () => {
                menu.refresh();
            }
        };
    }
    addListEntry() {
        return {
            name: lang.ADD_LIST,
            fa: 'fas fa-plus-square',
            type: 'action',
            action: () => {
                const offerCommunityMode = paths.ALLOW_COMMUNITY_LISTS && !config.get('communitary-mode-lists-amount');
                this.addListDialog(offerCommunityMode).catch(e => menu.displayErr(e));
            }
        };
    }
    async addListDialog(offerCommunityMode) {
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
            fa: 'fas fa-plus-square',
            defaultValue: this.inputMemory['url'] || '',
            extraOpts
        });
        console.log('lists.manager ' + id);
        if (!id) {
            throw 'No input';
        } else if (id == 'file') {
            return await this.addListDialogFile()
        } else if (id == 'code') {
            return await this.addListCredentialsDialog()
        } else if (id == 'sh') {
            let active = await this.communityModeDialog()
            if (active) {
                return true;
            } else {
                return await this.addListDialog(offerCommunityMode)
            }
        } else if (id == 'mac') {
            return await this.addListMacDialog()
        } else {
            console.log('lists.manager.addList(' + id + ')')
            this.inputMemory['url'] = id
            return await this.addList(id)
        }
    }
    async addListDialogFile() {
        const file = await menu.chooseFile('audio/x-mpegurl')
        return await this.addList(file)
    }
    async communityModeDialog() {
        let choose = await menu.dialog([
            { template: 'question', text: lang.COMMUNITY_LISTS, fa: 'fas fa-users' },
            { template: 'message', text: lang.SUGGEST_COMMUNITY_LIST + "\r\n" + lang.ASK_COMMUNITY_LIST },
            { template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: lang.I_AGREE },
            { template: 'option', id: 'back', fa: 'fas fa-chevron-circle-left', text: lang.BACK }
        ], 'agree');
        if (choose == 'agree') {
            renderer.get().localEmit('lists-manager', 'agree');
            return true;
        }
    }
    async addListCredentialsDialog() {
        const url = await this.askListCredentials();
        return await this.addList(url);
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
        if (server.indexOf('username=') != -1) {
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
        osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'add-list-pre', 'persistent');
        let url = await this.getM3UFromCredentials(server, user, pass).catch(console.error);
        if (typeof (url) != 'string') {
            url = server.replace('//', '//' + user + ':' + pass + '@') + '#xtream';
            let chosen = await menu.dialog([
                { template: 'question', text: lang.ADD_USER_PASS, fa: 'fas fa-key' },
                { template: 'message', text: lang.INCLUDE_SERIES_CATALOG },
                { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
            ], 'yes').catch(console.error);
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
            if (url.indexOf('#xtream') != -1) {
                const xtr = new Xtr(url, true);
                await xtr.run().catch(e => err = e);
                data.calls = xtr.debugInfo;
                if (err)
                    data.run = String(err);
                xtr.destroy();
            }
        }
        await fsp.writeFile(output, crashlog.stringify(data));
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
        if (server.indexOf('username=') != -1) {
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
        osd.show(lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'add-list-mac', 'persistent');
        const url = await this.getM3UPlaylistForMac(macAddress, server).catch(e => err = e);
        osd.hide('add-list-mac');
        if (err)
            throw err;
        return await this.addList(url);
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
            if (typeof (list) == 'string' && list) {
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
                    let priv = (row.length > 2 && typeof (row[2]['private']) != 'undefined') ? row[2]['private'] : doNotShareHint;
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
                            const meta = this.master.lists[url] ? this.master.lists[url].index.meta : {};
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
                                            if (path.indexOf(name) != -1) {
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
                                        renderer.get().emit('open-external-url', contactUrl);
                                    }
                                });
                            }
                            if (manageOnly)
                                return options;
                            es = await this.directListRenderer({ url }, {
                                raw: true,
                                fetch: false
                            }).catch(err => menu.displayErr(err));
                            if (!Array.isArray(es)) {
                                es = [];
                            } else if (es.length) {
                                es = this.master.parentalControl.filter(es);
                                es = await this.master.tools.deepify(es, { source: url });
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
                if (this.addingList) {
                    ls.push({
                        name: lang.RECEIVING_LIST,
                        fa: 'fa-mega spin-x-alt',
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
                if (ret && typeof (ret.statusCode) == 'number') {
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
    async searchEPGs() {
        let epgs = [];
        let urls = this.master.epgs;
        if (Array.isArray(urls)) {
            epgs.push(...urls)
        }
        let c = await cloud.get('configure').catch(console.error);
        if (c && c.epg) {
            let cs = await lang.getActiveCountries();
            if (!cs.includes(lang.countryCode)) {
                cs.push(lang.countryCode);
            }
            cs.forEach(code => {
                if (c.epg[code] && !epgs.includes(c.epg[code])) {
                    epgs.push(c.epg[code]);
                }
            });
        }
        global.channels && epgs.push(...global.channels.watching.currentRawEntries.map(e => e.epg))
        epgs = epgs.filter(e => !!e).map(u => this.master.parseEPGs(u, true)).flat().sort().unique()
        return epgs
    }
    async removeList(data) {
        const info = await this.master.info(true), key = 'epg-' + lang.locale;
        if (info[data.url] && info[data.url].epg && this.master.parseEPGs(info[data.url].epg) == config.get(key)) {
            config.set(key, '');
        }
        menu.suspendRendering();
        try { // Ensure that we'll resume rendering
            this.remove(data.url);
        } catch (e) {}
        osd.show(lang.LIST_REMOVED, 'fas fa-info-circle', 'list-open', 'normal');
        menu.resumeRendering();
        menu.back(null, true);
    }
    async directListRenderer(data, opts = {}) {
        let v = Object.assign({}, data);
        opts.silent || osd.show(lang.OPENING_LIST, 'fa-mega spin-x-alt', 'list-open', 'persistent');
        let list = await this.master.directListRenderer(v, {
            fetch: opts.fetch,
            expand: opts.expand,
            progress: p => {
                opts.silent || osd.show(lang.OPENING_LIST + ' ' + parseInt(p) + '%', 'fa-mega spin-x-alt', 'list-open', 'persistent');
            }
        }).catch(e => console.error(e));
        if (!Array.isArray(list)) {
            list = [];
        }
        if (!list.length) {
            list.push({ name: lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty' });
        }
        if (!opts.raw) {
            list = this.prependBookmarkingAction(list, v.url);
        }
        this.openingList = false;
        opts.silent || osd.hide('list-open');
        return list;
    }
    prependBookmarkingAction(list, url) {
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
                        this.addList(url, '', true).catch(console.error).finally(() => {
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
        const checkListExpiralInterval = this.master.activeLists.community.length ? 120 : 10;
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
                const meta = this.master.lists[source].index.meta;
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
                    offer = await global.promo.offer('dialog', ['communitary']).catch(console.error);
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
                    renderer.get().emit('open-external-url', contactUrl);
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
                    const entry = this.addListEntry()
                    entry.side = true
                    entry.name = lang.OPEN_URL
                    entry.fa = 'fas fa-plus'
                    entry.side = true
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
