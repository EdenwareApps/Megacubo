import { ucWords } from '../utils/utils.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import lists from "../lists/lists.js";
import mega from "../mega/mega.js";
import pLimit from "p-limit";
import cloud from "../cloud/cloud.js";
import ytsr from 'ytsr'
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'

class SearchTermsHistory {
    constructor() {
        this.key = 'search-terms-history';
        this.maxlength = 12;
    }
    async get() {
        let ret = await storage.get(this.key);
        if (!Array.isArray(ret)) {
            ret = [];
        }
        return ret;
    }
    add(terms) {
        if (!Array.isArray(terms)) {
            terms = lists.tools.terms(terms);
        }
        this.get().then(vs => {
            let tms = terms.join('');
            vs = vs.filter(v => v.join('') != tms).slice((this.maxlength - 1) * -1);
            vs.push(terms);
            storage.set(this.key, vs, { expiration: true });
        });
    }
    async terms() {
        let ret = await this.get();
        return ret.flat().unique();
    }
}
class Search extends EventEmitter {
    constructor(channels) {
        super();
        this.channels = channels
        this.history = new SearchTermsHistory();
        this.searchMediaType = 'all';
        this.searchInaccurate = true;
        this.searchStrict = false;
        this.searchSuggestions = [];
        this.currentSearchType = null;
        this.currentSearch = null;
        this.currentEntries = null;
        this.currentResults = [];
    }
    entriesLive() {
        if (this.currentSearchType != 'live') {
            this.currentSearchType = 'live';
            this.searchMediaType = 'live';
            this.currentEntries = null;
        }
        return new Promise((resolve, reject) => {
            if (this.currentEntries) {
                return resolve(this.currentEntries);
            }
            this.searchSuggestionEntries().then(es => {
                const { parentalControl } = lists;
                es = es.map(e => {
                    return {
                        name: ucWords(e.search_term),
                        fa: 'fas fa-search'
                    };
                });
                es = es.map(e => this.channels.toMetaEntry(e, false));
                es = parentalControl.filter(es, true);
                es = this.addFixedEntries(this.currentSearchType, es);
                resolve(es);
            }).catch(e => menu.displayErr(e));
        });
    }
    entries() {
        if (this.currentSearchType != 'all') {
            this.currentSearchType = 'all';
            this.searchMediaType = 'all';
            this.currentEntries = null;
        }
        return new Promise((resolve, reject) => {
            if (this.currentEntries) {
                return resolve(this.currentEntries);
            }
            resolve(this.addFixedEntries(this.currentSearchType, []));
        });
    }
    async go(value, mediaType) {
        if (!value)
            return false;
        if (!mediaType) {
            mediaType = 'all';
        }
        console.log('search-start', value);
        renderer.get().emit('set-loading', { name: lang.SEARCH }, true, lang.SEARCHING);
        osd.show(lang.SEARCHING, 'fas fa-search spin-x-alt', 'search', 'persistent');
        this.searchMediaType = mediaType;
        let err;
        const rs = await this[mediaType == 'live' ? 'channelsResults' : 'results'](value).catch(e => err = e);
        osd.hide('search');
        if (Array.isArray(rs)) {
            console.log('results', rs.length);
            if (!rs.length && mediaType == 'live') {
                return this.go(value, 'all');
            }
            this.emit('search', { query: value });
            if (!menu.path) {
                menu.path = lang.SEARCH;
            }
            const resultsCount = rs.length;
            menu.render(this.addFixedEntries(mediaType, rs), menu.path, 'fas fa-search', '/');
            osd.show(lang.X_RESULTS.format(resultsCount), 'fas fa-check-circle', 'search', 'normal');
        } else {
            menu.displayErr(err);
        }
        renderer.get().emit('set-loading', { name: lang.SEARCH }, false);
        this.history.add(value);
    }
    refresh() {
        if (this.currentSearch) {
            this.go(this.currentSearch.name, this.currentSearchType);
        }
    }
    mediaTypeName() {
        let type = String(this.searchMediaType).toUpperCase();
        if (typeof (lang[type]) == 'string') {
            type = lang[type];
        }
        return type;
    }
    addFixedEntries(mediaType, es) {
        es.unshift({
            name: lang.NEW_SEARCH,
            details: this.mediaTypeName(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);
                this.go(value, mediaType);
            },
            value: () => {
                return this.defaultTerms();
            },
            placeholder: lang.SEARCH_PLACEHOLDER
        });
        if (this.currentSearch) {
            if (mediaType == 'live') {
                es.push({
                    name: lang.MORE_RESULTS,
                    details: lang.SEARCH_MORE,
                    type: 'action',
                    fa: 'fas fa-search-plus',
                    action: async () => {
                        const opts = [
                            { template: 'question', text: lang.SEARCH_MORE, fa: 'fas fa-search-plus' },
                            { template: 'option', text: lang.EPG, details: lang.LIVE, fa: 'fas fa-th', id: 'epg' },
                            { template: 'option', text: lang.IPTV_LISTS, details: lang.CATEGORY_MOVIES_SERIES, fa: 'fas fa-list', id: 'lists' }
                        ], def = 'epg';
                        let ret = await menu.dialog(opts, def);
                        if (ret == 'epg') {
                            this.channels.epgSearch(this.currentSearch.name).then(entries => {
                                entries.unshift(this.channels.epgSearchEntry());
                                let path = menu.path.split('/').filter(s => s != lang.SEARCH).join('/');
                                menu.render(entries, path + '/' + lang.SEARCH, 'fas fa-search', path);
                                this.history.add(this.currentSearch.name);
                            }).catch(e => menu.displayErr(e));
                        } else {
                            this.go(this.currentSearch.name, 'all');
                        }
                    }
                });
            }
        }
        return es;
    }
    async searchGroups(terms) {
        const map = {}, entries = [];
        
        const es = await this.search(terms, { groupsOnly: true });
        es.forEach(e => {
            if (typeof (map[e.source]) == 'undefined')
                map[e.source] = {};
            if (typeof (map[e.source][e.groupName]) == 'undefined')
                map[e.source][e.groupName] = {};
        });
        Object.keys(map).forEach(url => {
            Object.keys(map[url]).forEach(name => {
                entries.push({ name, type: 'group', renderer: () => lists.group({ group: name, url }) });
            });
        });
        return lists.tools.sort(entries);
    }
    async search(terms, atts = {}) {
        
        const policy = config.get('parental-control');
        const parentalControlActive = ['remove', 'block'].includes(policy);
        const isAdultQueryBlocked = policy == 'remove' && !lists.parentalControl.allow(terms);
        const opts = {
            partial: this.searchInaccurate,
            type: this.searchMediaType,
            typeStrict: this.searchStrict,
            group: this.searchMediaType != 'live',
            parentalControl: policy == 'remove' ? false : undefined // allow us to count blocked results
        };
        Object.assign(opts, atts);
        console.log('will search', terms, opts);
        let es = await lists.search(terms, opts);
        es = (es.results && es.results.length) ? es.results : ((es.maybe && es.maybe.length) ? es.maybe : []);
        console.log('has searched', terms, es.length, parentalControlActive, isAdultQueryBlocked);
        if (isAdultQueryBlocked) {
            es = [
                {
                    prepend: '<i class="fas fa-info-circle"></i> ',
                    name: lang.X_BLOCKED_RESULTS.format(es.length),
                    details: lang.ADULT_CONTENT_BLOCKED,
                    fa: 'fas fa-lock',
                    type: 'action',
                    action: () => {
                        menu.info(lang.ADULT_CONTENT_BLOCKED, lang.ADULT_CONTENT_BLOCKED_INFO.format(lang.OPTIONS, lang.ADULT_CONTENT));
                    }
                }
            ];
        } else {
            this.currentResults = es.slice(0);
            let minResultsWanted = (config.get('view-size-x') * config.get('view-size-y')) - 3;
            if (config.get('search-youtube') && es.length < minResultsWanted) {
                let ys = await this.ytResults(lists.tools.terms).catch(console.error);
                if (Array.isArray(ys)) {
                    es.push(...ys);
                }
            }
            if (es.length) {
                es = lists.parentalControl.filter(es);
            }
        }
        return es;
    }
    async results(terms) {
        let u = ucWords(terms);
        this.currentSearch = {
            name: u,
            url: mega.build(u, { terms, mediaType: this.searchMediaType })
        };
        
        const es = await this.search(terms);
        renderer.get().emit('current-search', terms, this.searchMediaType);
        if (!lists.loaded(true)) {
            if (paths.ALLOW_ADDING_LISTS) {
                return [lists.manager.noListsEntry()];
            }
            return [];
        }
        return es;
    }
    fixYTTitles(name) {
        return name.replaceAll('/', '|');
    }
    async ytResults(tms) {
        let terms = tms;
        if (Array.isArray(terms)) {
            terms = terms.join(' ');
        }
        const filters = await ytsr.getFilters(terms);
        const filter = filters.get('Type').get('Video');
        const options = {
            pages: 2,
            gl: lang.countryCode.toUpperCase(),
            hl: lang.locale,
            requestOptions: {
                rejectUnauthorized: false,
                transform: (parsed) => {
                    return Object.assign(parsed, {
                        rejectUnauthorized: false
                    });
                }
            }
        };
        const results = await ytsr(filter.url, options);
        return results.items.filter(t => t && !t.isLive).map(t => {
            let icon = t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined;
            return {
                name: this.fixYTTitles(t.title),
                icon,
                type: 'stream',
                url: t.url
            };
        });
    }
    async ytLiveResults(tms) {
        
        if (!Array.isArray(tms)) {
            tms = lists.tools.terms(tms);
        }
        let terms = tms.join(' ');
        terms += ' (' + lang.LIVE + ' OR 24h)';
        console.warn('YTSEARCH', terms);
        const filters = await ytsr.getFilters(terms);
        const filter = filters.get('Type').get('Video');
        const filters2 = await ytsr.getFilters(filter.url);
        const filter2 = filters2.get('Features').get('Live');
        const options = {
            pages: 1,
            gl: lang.countryCode.toUpperCase(),
            hl: lang.locale,
            requestOptions: {
                rejectUnauthorized: false,
                transform: (parsed) => {
                    return Object.assign(parsed, {
                        rejectUnauthorized: false
                    });
                }
            }
        };
        const results = await ytsr(filter2.url, options);
        results.items = results.items.filter(t => {
            let ytms = lists.tools.terms(t.title);
            console.warn('YTSEARCH', tms, ytms);
            return lists.tools.match(tms, ytms, true);
        });
        return results.items.map(t => {
            let icon = t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined;
            return {
                name: this.fixYTTitles(t.title),
                icon,
                type: 'stream',
                url: t.url
            };
        });
    }
    async channelsResults(terms) {
        
        let u = ucWords(terms);
        this.currentSearch = {
            name: u,
            url: mega.build(u, { terms, mediaType: this.searchMediaType })
        };
        
        if (!lists.loaded()) {
            return [lists.manager.updatingListsEntry()];
        }
        let es = await this.channels.searchChannels(terms, this.searchInaccurate);
        es = es.map(e => this.channels.toMetaEntry(e));
        const gs = await this.searchGroups(terms);
        es.push(...gs.map(e => e));
        let minResultsWanted = (config.get('view-size-x') * config.get('view-size-y')) - 3;
        if (config.get('search-youtube') && es.length < minResultsWanted) {
            let ys = await this.ytLiveResults(terms).catch(console.error);
            if (Array.isArray(ys)) {
                es.push(...ys.slice(0, minResultsWanted - es.length));
            }
        }
        if (paths.ALLOW_ADDING_LISTS && !lists.loaded(true)) {
            es.unshift(lists.manager.noListsEntry());
        }
        return es;
    }
    isSearching() {
        return menu.currentEntries.some(e => {
            return e.name == lang.SEARCH || e.name == lang.NEW_SEARCH;
        });
    }
    matchTerms(nlc, precision, es) {
        let term = false;
        if (es.length) {
            es.forEach(t => {
                if (nlc.indexOf(t.search_term) != -1) {
                    if (!term || (precision ? term.length < t.search_term.length : term.length > t.search_term.length)) {
                        term = t.search_term;
                    }
                }
            });
        }
        return term;
    }
    termsFromEntry(entry, precision, searchSugEntries) {
        return new Promise((resolve, reject) => {
            let nlc = (entry.originalName || entry.name).toLowerCase();
            if (Array.isArray(searchSugEntries)) {
                resolve(this.matchTerms(nlc, precision, searchSugEntries));
            } else {
                this.searchSuggestionEntries().then(es => {
                    resolve(this.matchTerms(nlc, precision, es));
                }).catch(e => {
                    console.error(e);
                    resolve(false);
                });
            }
        });
    }
    async searchSuggestionEntries(removeAliases, countryOnly) {
        const limit = pLimit(3);
        const ignoreKeywords = ['tv', 'hd', 'sd'];
        let ret = {}, locs = await lang.getActiveCountries();
        if (countryOnly && locs.includes(lang.countryCode)) {
            locs = [lang.countryCode];
        }
        const tasks = locs.map(loc => {
            return async () => {
                const data = await cloud.get('searching.' + loc);
                data.forEach(row => {
                    if (ignoreKeywords.includes(row.search_term))
                        return;
                    let count = parseInt(row.cnt);
                    if (typeof (ret[row.search_term]) != 'undefined')
                        count += ret[row.search_term];
                    ret[row.search_term] = count;
                });
            };
        }).map(limit);
        await Promise.allSettled(tasks);
        ret = Object.keys(ret).map(search_term => {
            return { search_term, cnt: ret[search_term] };
        });
        if (countryOnly && !ret.length) {
            return this.searchSuggestionEntries(removeAliases, false);
        }
        if (removeAliases === true) {
            ret = this.removeSearchSuggestionsTermsAliasesObject(ret).sortByProp('cnt', true);
        }
        return ret;
    }
    removeSearchSuggestionsCheckNames(a, b) {
        return (a != b && (a.substr(b.length * -1) == b || (a.indexOf(b) != -1 && a.length <= (b.length + 3))));
    }
    removeSearchSuggestionsGetAliases(o) {
        let aliases = {};
        if (o.length) {
            let s = o.slice(0);
            if (typeof (s[0]) == 'object') {
                s = s.map(t => {
                    return t.search_term;
                });
            }
            s.forEach((k, i) => {
                s.forEach(t => {
                    if (this.removeSearchSuggestionsCheckNames(t, k)) {
                        if (typeof (aliases[k]) == 'undefined') {
                            aliases[k] = [];
                        }
                        aliases[k].push(t);
                    }
                });
            });
        }
        return aliases;
    }
    removeSearchSuggestionsTermsAliases(s) {
        if (s.length) {
            let aliases = this.removeSearchSuggestionsGetAliases(s);
            s = s.filter(v => {
                let keep = true;
                Object.keys(aliases).some(k => {
                    if (aliases[k].indexOf(v) != -1) {
                        keep = false;
                        return true;
                    }
                });
                return keep;
            });
        }
        return s;
    }
    removeSearchSuggestionsTermsAliasesObject(s) {
        if (s.length) {
            let aliases = this.removeSearchSuggestionsGetAliases(s), cnts = {};
            s = s.filter((o, i) => {
                let keep = true;
                if (typeof (o.cnt) != 'number') {
                    o.cnt = parseInt(o.cnt);
                }
                Object.keys(aliases).some(k => {
                    if (aliases[k].indexOf(o.search_term) != -1) {
                        let rem = s.some((t, j) => {
                            if (t.search_term == k) {
                                s[j].cnt = parseInt(s[j].cnt) + o.cnt;
                                return true;
                            }
                        });
                        if (rem) {
                            keep = false;
                        }
                    }
                });
                return keep;
            });
        }
        return s;
    }
    defaultTerms() {
        let def = '';
        if (this.currentSearch) {
            def = this.currentSearch.name;
        }
        return def;
    }
    entry(mediaType = 'live') {
        this.searchMediaType = mediaType;
        return {
            name: lang.SEARCH,
            details: this.mediaTypeName(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);
                this.go(value, mediaType);
            },
            value: () => {
                return this.defaultTerms();
            },
            placeholder: lang.SEARCH_PLACEHOLDER
        };
    }
    async hook(entries, path) {
        if (lists.loaded() && lists.activeLists.length) {
            if (path == lang.LIVE) {
                entries.unshift(this.entry('live'));
            } else if (lang.CATEGORY_MOVIES_SERIES == path) {
                entries.unshift(this.entry('all'));
            }
        }
        return entries
    }
}
export default Search;
