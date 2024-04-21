import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import EntriesGroup from "../entries-group/entries-group.js";
import cloud from "../cloud/cloud.js";
import lists from "../lists/lists.js";
import pLimit from "p-limit";
import mega from "../mega/mega.js";
import config from "../config/config.js"
import { deepClone, ucWords } from "../utils/utils.js";

class Watching extends EntriesGroup {
    constructor(channels) {
        super('watching', channels)
        const { expires } = cloud;
        this.timer = 0;
        this.currentEntries = null;
        this.currentRawEntries = null;
        this.updateIntervalSecs = expires['watching-country'] || 300;
        config.on('change', (keys, data) => {
            if (keys.includes('only-known-channels-in-trending') || keys.includes('popular-searches-in-trending') || keys.includes('parental-control') || keys.includes('parental-control-terms')) {
                this.updating || this.update().catch(console.error);
            }
        });
        storage.get('watching-current').then(data => {
            this.channels.ready(() => {
                if (!this.currentRawEntries || !this.currentRawEntries.length) {
                    this.currentRawEntries = data;
                    this.updating || this.update(data).catch(console.error);
                }
                else if (Array.isArray(data)) {
                    this.currentEntries && this.currentEntries.forEach((c, i) => {
                        data.forEach(e => {
                            if (typeof (c.trend) == 'undefined' && typeof (e.trend) != 'undefined') {
                                this.currentEntries[i].trend = e.trend;
                                return true;
                            }
                        });
                    });
                }
                this.channels.on('loaded', () => {
                    this.updating || this.update().catch(console.error);
                }); // on each "loaded"
            });
        }).catch(err => {
            console.error(err);
        });
    }
    title() {
        return lang.TRENDING;
    }
    ready() {
        return new Promise((resolve, reject) => {
            if (this.currentRawEntries !== null) {
                resolve();
            } else {
                this.once('update', resolve);
                this.updating || this.update().catch(reject);
            }
        });
    }
    showChannelOnHome() {
        const { manager } = lists;
        return manager.get().length || config.get('communitary-mode-lists-amount');
    }
    async update(rawEntries = null) {
        this.updating = true;
        clearTimeout(this.timer);
        let prv = this.entry();
        await this.process(rawEntries).catch(err => {
            if (!this.currentRawEntries) {
                this.currentEntries = []
                this.currentRawEntries = []
                console.error(err)
            }
        });
        this.updating = false;
        this.emit('update');
        clearTimeout(this.timer); // clear again to be sure
        this.timer = setTimeout(() => this.update().catch(console.error), this.updateIntervalSecs * 1000);
        let nxt = this.entry();
        if (this.showChannelOnHome() && menu.path == '' && (prv.details != nxt.details || prv.name != nxt.name)) {
            menu.updateHomeFilters();
        }
        else {
            this.updateView();
        }
    }
    updateView() {
        if (menu.path == this.title()) {
            menu.refresh();
        }
    }
    async hook(entries, path) {
        if (path == '') {
            let pos = 0, entry = this.entry();
            if (!entry.originalName) {
                entries.some((e, i) => {
                    if (e.name == lang.TOOLS) {
                        pos = i + 1;
                        return true;
                    }
                });
            }
            entries = entries.filter(e => e.hookId != this.key);
            entries.splice(pos, 0, entry);
        }
        return entries;
    }
    extractUsersCount(e) {
        if (e.users) {
            return e.users;
        }
        let n = String(e.label || e.details).match(new RegExp('([0-9]+)($|[^&])'));
        return n && n.length ? parseInt(n[1]) : 0;
    }
    async entries() {        
        if (!lists.loaded()) {
            return [lists.manager.updatingListsEntry()];
        }
        await this.ready();
        let list = this.currentEntries ? deepClone(this.currentEntries, true) : [];
        list = list.map((e, i) => {
            e.position = (i + 1);
            return e;
        });
        if (!list.length) {
            list = [{ name: lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty' }];
        }
        else {
            const acpolicy = config.get('parental-control');
            if (['remove', 'block'].includes(acpolicy)) {
                list = lists.parentalControl.filter(list);
            }
            else if (acpolicy == 'only') {
                list = lists.parentalControl.only(list);
            }
        }
        this.currentTopProgrammeEntry = false;
        list = this.prepare(list);
        const es = await this.channels.epgChannelsAddLiveNow(list, false);
        if (es.length) {
            es.some(e => {
                if (e.programme && e.programme.i) {
                    this.currentTopProgrammeEntry = e;
                    return true;
                }
            });
        }
        if (paths.ALLOW_ADDING_LISTS && !lists.loaded(true)) {
            es.unshift(lists.manager.noListsEntry());
        }
        return es;
    }
    applyUsersPercentages(entries) {
        let totalUsersCount = 0;
        entries.forEach(e => totalUsersCount += e.users);
        let pp = totalUsersCount / 100;
        entries.forEach((e, i) => {
            entries[i].usersPercentage = e.users / pp;
        });
        return entries;
    }
    async getRawEntries() {
        let data = []
        const countries = await lang.getActiveCountries()
        const validator = a => Array.isArray(a) && a.length
        const limit = pLimit(3)        
        const tasks = countries.map(country => {
            return async () => {
                let es = await cloud.get('watching-country.' + country, false, validator).catch(console.error);
                Array.isArray(es) && data.push(...es);
            };
        }).map(limit);
        await Promise.allSettled(tasks);
        data.forEach((e, i) => {
            if (e.logo && !e.icon) {
                data[i].icon = e.logo;
                delete data[i].logo;
            }
        });
        return data;
    }
    async process(rawEntries) {
        let data = Array.isArray(rawEntries) ? rawEntries : (await this.getRawEntries());
        let recoverNameFromMegaURL = true;
        if (!Array.isArray(data) || !data.length)
            return [];
        
        data = lists.prepareEntries(data);
        data = data.filter(e => (e && typeof (e) == 'object' && typeof (e.name) == 'string')).map(e => {
            const isMega = mega.isMega(e.url);
            if (isMega && recoverNameFromMegaURL) {
                let n = mega.parse(e.url);
                if (n && n.name) {
                    e.name = ucWords(n.name);
                }
            }
            e.name = lists.tools.sanitizeName(e.name);
            e.users = this.extractUsersCount(e);
            e.details = '';
            if (!isMega) {
                e.url = mega.build(e.name);
            }
            return e;
        });
        data = lists.parentalControl.filter(data);
        this.currentRawEntries = data.slice(0);
        let searchTerms = [], groups = {}, gcount = {}, gsearches = [], gentries = [];
        const adultContentOnly = config.get('parental-control') == 'only';
        const onlyKnownChannels = !adultContentOnly && config.get('only-known-channels-in-trending');
        const popularSearches = config.get('popular-searches-in-trending');
        if (popularSearches) {
            const sdata = {}, sentries = await this.channels.search.searchSuggestionEntries()
            sentries.map(s => s.search_term).filter(s => s.length >= 3).filter(s => !this.channels.isChannel(s)).filter(s => lists.parentalControl.allow(s)).forEach(name => {
                sdata[name] = { name, terms: lists.tools.terms(name) };
            });
            const filtered = await lists.has(Object.values(sdata));
            Object.keys(filtered).forEach(name => {
                if (!filtered[name])
                    return;
                searchTerms.push(sdata[name].terms);
            });
        }
        data.forEach((entry, i) => {
            let ch = this.channels.isChannel(entry.terms.name);
            if (popularSearches && !ch) {
                searchTerms.some(terms => {
                    if (lists.tools.match(terms, entry.terms.name)) {
                        const name = terms.join(' ');
                        gsearches.includes(name) || gsearches.push(name);
                        ch = { name };
                        return true;
                    }
                });
            }
            if (ch) {
                let term = ch.name;
                if (typeof (groups[term]) == 'undefined') {
                    groups[term] = [];
                    gcount[term] = 0;
                }
                if (typeof (entry.users) != 'undefined') {
                    entry.users = this.extractUsersCount(entry);
                }
                gcount[term] += entry.users;
                delete data[i];
            }
            else {
                if (onlyKnownChannels) {
                    delete data[i];
                }
                else {
                    if (!mega.isMega(entry.url)) {
                        const mediaType = lists.mi.mediaType(entry);
                        entry.url = mega.build(entry.name, { mediaType });
                    }
                    data[i] = this.channels.toMetaEntry(entry);
                }
            }
        });
        Object.keys(groups).forEach(n => {
            const name = ucWords(n);
            gentries.push(this.channels.toMetaEntry({
                name,
                type: 'group',
                fa: 'fas fa-play-circle',
                users: gcount[n],
                url: mega.build(name, { terms: n.split(' '), mediaType: gsearches.includes(n) ? 'all' : 'live' })
            }));
        });
        data = data.filter(e => {
            return !!e;
        });
        data.push(...gentries);
        data = data.sortByProp('users', true);
        data = this.addTrendAttr(data);
        data = this.applyUsersPercentages(data);
        this.currentEntries = data;
        storage.set('watching-current', this.currentRawEntries, {
            permanent: true,
            expiration: true
        }).catch(console.error); // do not await
        global.updateUserTasks().catch(console.error); // do not await
        return data;
    }
    addTrendAttr(entries) {
        if (this.currentEntries) {
            const k = entries.some(e => e.usersPercentage) ? 'usersPercentage' : 'users';
            entries.map(e => {
                this.currentEntries.some(c => {
                    if (c.url == e.url) {
                        if (e[k] > c[k]) {
                            e.trend = 1;
                        }
                        else if (e[k] < c[k]) {
                            e.trend = -1;
                        }
                        else if (typeof (c.trend) == 'number') {
                            e.trend = c.trend;
                        }
                        return true;
                    }
                });
                return e;
            });
        }
        return entries;
    }
    async order(entries) {
        if (this.currentRawEntries) {
            let up = [], es = entries.slice(0);
            this.currentRawEntries.forEach(r => {
                es.some((e, i) => {
                    if (r.url == e.url) {
                        e.users = r.users;
                        up.push(e);
                        delete es[i];
                        return true;
                    }
                });
            });
            up.push(...es.filter(e => { return !!e; }));
            return up;
        }
        return entries;
    }
    entry() {
        const entry = { name: this.title(), details: lang.BEEN_WATCHED, fa: 'fas fa-chart-bar', hookId: this.key, type: 'group', renderer: this.entries.bind(this) };
        if (this.currentEntries && this.showChannelOnHome()) {
            let top = this.currentTopProgrammeEntry;
            if (top) {
                let s = top.users == 1 ? 'user' : 'users';
                entry.name = this.title();
                entry.class = 'entry-icon';
                entry.originalName = top.name;
                if (entry.rawname)
                    entry.rawname = top.name;
                entry.prepend = '<i class="fas fa-chart-bar"></i> ';
                entry.details = top.programme.t + ' &middot; <i class="fas fa-' + s + '"></i> ' + lang.X_WATCHING.format(top.users);
                entry.programme = top.programme;
            }
        }
        return entry;
    }
}
export default Watching
