import Download from '../download/download.js'
import { Common } from "../lists/common.js";
import pLimit from "p-limit";
import config from "../config/config.js"
import { clone, getDomain } from "../utils/utils.js";

class IndexMapUtils extends Common {
    constructor(opts) {
        super(opts)
    }

    // calculates the size of the map, including group size if specified
    mapSize(a, group) {
        let c = 0
        for (const listUrl in a) {
            const list = a[listUrl]
            c += list.n.length
            if (group) {
                c += list.g.length
            }
        }
        return c
    }

    // finds the intersection of two maps
    intersectMap(a, b) {
        const c = {}
        for (const listUrl in b) {
            if (a[listUrl] !== undefined) {
                const gset = b[listUrl].g.length ? new Set(b[listUrl].g) : null
                const nset = b[listUrl].n.length ? new Set(b[listUrl].n) : null
                c[listUrl] = {
                    g: gset ? a[listUrl].g.filter(n => gset.has(n)) : [],
                    n: nset ? a[listUrl].n.filter(n => nset.has(n)) : []
                }
            }
        }
        return c
    }

    // combines two maps joining duplicate values
    joinMap(a, b) {
        const c = clone(a) // clones the original map to avoid modifying it
        for (const listUrl in b) {
            if (!c[listUrl]) {
                c[listUrl] = { g: [], n: [] }
            }
            for (const type in b[listUrl]) {
                const map = new Set(c[listUrl][type])
                b[listUrl][type].forEach(n => map.add(n))
                c[listUrl][type] = Array.from(map).sort((a, b) => a - b)
            }
        }
        return c
    }

    // calculates the difference between two maps
    diffMap(a, b) {
        const c = clone(a) // clones the original map to avoid modifying it
        for (const listUrl in b) {
            if (a[listUrl] !== undefined) {
                c[listUrl] = { g: [], n: [] }
                for (const type in b[listUrl]) {
                    if (a[listUrl][type] !== undefined) {
                        const diffSet = new Set(b[listUrl][type])
                        c[listUrl][type] = a[listUrl][type].filter(n => !diffSet.has(n))
                    }
                }
            }
        }
        return c
    }
}

class Index extends IndexMapUtils {
    constructor(opts) {
        super(opts);
        this.searchMapCache = {};
        this.defaultsSearchOpts = {
            group: undefined,
            type: undefined,
            typeStrict: undefined,
            partial: undefined
        };
    }
    optimizeSearchOpts(opts) {
        let nopts = {};
        Object.keys(this.defaultsSearchOpts).forEach(k => {
            nopts[k] = opts[k] ? opts[k] : undefined;
        });
        return nopts;
    }
    has(terms, opts) {
        return new Promise((resolve, reject) => {
            let ret = {}, results = {};
            if (!terms.length) {
                return resolve({});
            }
            terms.forEach(t => {
                ret[t.name] = Array.isArray(t.terms) ? t.terms : this.tools.terms(t.terms);
                results[t.name] = false;
            });
            if (!opts) {
                opts = {};
            }
            for(const k in ret) {
                const query = this.parseQuery(ret[k], opts);
                let smap = this.searchMap(query, opts);
                results[k] = this.mapSize(smap, opts.group) > 0;
            }
            resolve(results)
        })
    }
    async multiSearch(terms, opts={}) {
        let results = {}
        const rmap = {}, scores = {}, sep = "\n", limit = opts.limit || 256
        const maps = Object.keys(terms).map(k => {
            const query = this.parseQuery(k, opts)
            return [this.searchMap(query, opts), terms[k]]
        })
        for(const result of maps) {
            const score = result[1]
            for(const url in result[0]) {
                for(const type in result[0][url]) {
                    for(const id of result[0][url][type]) {
                        const uid = url + sep + type + sep + id
                        if(!scores[uid]) {
                            scores[uid] = 0
                        }
                        scores[uid] += score
                    }
                }
            }
        }
        Object.keys(scores).map(uid => {
            return {uid, score: scores[uid]}
        }).sortByProp('score', true).slice(0, limit).map(row => {
            let parts = row.uid.split(sep)
            if(!rmap[parts[0]]) rmap[parts[0]] = {n:[], g:[]}
            rmap[parts[0]][parts[1]].push(parseInt(parts[2]))
        });
        results = await this.fetchMap(rmap, {group: opts.group}, limit)
        for(let i=0; i<results.length; i++){
            results[i].score = scores[results[i].source + sep +'n'+ sep + results[i]._] || scores[results[i].source + sep +'g'+ sep + results[i]._] || -1
        }
        return results.sortByProp('score', true)
    }
    searchMapCacheInvalidate(url) {
        if (!url) {
            this.searchMapCache = {};
        } else {
            Object.keys(this.searchMapCache).forEach(k => {
                if (typeof(this.searchMapCache[k][url]) != 'undefined') {
                    delete this.searchMapCache[k][url];
                }
            });
        }
    }
    parseQuery(terms, opts) {
        if (!Array.isArray(terms)) {
            terms = this.tools.terms(terms);
        }
        if (terms.includes('|')) {
            let excludes = [], aterms = [];
            terms.forEach(term => {
                if (term.startsWith('-')) {
                    excludes.push(term.substr(1));
                } else {
                    aterms.push(term);
                }
            });
            const needles = aterms.join(' ').split(' | ').map(s => s.replaceAll('|', '').split(' '));
            return {
                excludes,
                queries: needles.map(nterms => {
                    return this.parseQuery(nterms, opts).queries.shift();
                })
            };
        } else {
            let aliases = {}, excludes = [];
            terms = terms.filter(term => {
                if (term.startsWith('-')) {
                    excludes.push(term.substr(1));
                    return false;
                }
                return true;
            });
            terms = this.tools.applySearchRedirects(terms);
            if (opts.partial) {
                let filter;
                if (config.get('search-mode') == 1) {
                    filter = (term, t) => {
                        if (term.includes(t) && t != term) {
                            return true;
                        }
                    };
                } else {
                    filter = (term, t) => {
                        if (term.startsWith(t) && t != term) {
                            return true;
                        }
                    };
                }
                const maxAliases = 6, aliasingTerms = {};
                terms.forEach(t => aliasingTerms[t] = 0);
                Object.keys(this.lists).forEach(listUrl => {
                    Object.keys(this.lists[listUrl].index.terms).forEach(term => {
                        let from;
                        terms.some(t => {
                            if (aliasingTerms[t] < maxAliases && filter(term, t)) {
                                from = t;
                                return true;
                            }
                        });
                        if (from) {
                            if (typeof(aliases[from]) == 'undefined') {
                                aliases[from] = [];
                            }
                            if (!aliases[from].includes(term)) {
                                aliases[from].push(term);
                                aliasingTerms[from]++;
                            }
                        }
                    });
                });
            }
            terms = terms.filter(t => !excludes.includes(t));
            const queries = [terms];
            Object.keys(aliases).forEach(from => {
                const i = terms.indexOf(from);
                if (i == -1)
                    return;
                queries.push(...aliases[from].map(alias => {
                    const nterms = terms.slice(0);
                    nterms[i] = alias;
                    return nterms;
                }));
            });
            return { queries, excludes };
        }
    }
    searchMap(query, opts) {
        let fullMap
        this.debug && console.log('searchMap', query)
        opts = this.optimizeSearchOpts(opts)
        query.queries.forEach(q => {
            let map = this.querySearchMap(q, query.excludes, opts)
            fullMap = fullMap ? this.joinMap(fullMap, map) : map
        });
        this.debug && console.log('searchMap', opts)
        return clone(fullMap)
    }
    queryTermMap(terms) {
        let key = 'qtm-' + terms.join(',')
        if (typeof(this.searchMapCache[key]) != 'undefined') {
            return clone(this.searchMapCache[key]);
        }
        let tmap;
        terms.forEach(term => {
            let map = {};
            if (this.debug) {
                console.log('querying term map ' + term);
            }
            Object.keys(this.lists).forEach(listUrl => {
                if (this.lists[listUrl].index.terms && typeof(this.lists[listUrl].index.terms[term]) != 'undefined') {
                    map[listUrl] = this.lists[listUrl].index.terms[term];
                }
            });
            if (tmap) {
                if (this.debug) {
                    console.log('joining map ' + term);
                }
                tmap = this.intersectMap(tmap, map);
            } else {
                tmap = clone(map);
            }
        });
        if (this.debug) {
            console.log('querying term map done');
        }
        this.searchMapCache[key] = clone(tmap);
        return tmap;
    }
    querySearchMap(terms, excludes = [], opts = {}) {
        let smap;
        let key = 'qsm-' + opts.group + '-' + terms.join(',') + '_' + excludes.join(',') + JSON.stringify(opts); // use _ to diff excludes from terms in key
        if (typeof(this.searchMapCache[key]) != 'undefined') {
            return clone(this.searchMapCache[key]);
        }
        if (typeof(opts.type) != 'string') {
            opts.type = false;
        }
        terms.some(term => {
            let tms = [term];
            if (this.debug) {
                console.log('querying term map', tms);
            }
            let tmap = this.queryTermMap(tms);
            //console.warn('TMAPSIZE', term, tmap ? this.mapSize(tmap) : 0)
            //console.warn('SMAPSIZE', term, smap ? this.mapSize(smap) : 0)
            if (tmap) {
                if (smap) {
                    if (this.debug) {
                        console.log('intersecting term map');
                    }
                    smap = this.intersectMap(smap, tmap);
                } else {
                    smap = tmap;
                }
            } else {
                smap = false;
                return true;
            }
        });
        if (smap && this.mapSize(smap, opts.group)) {
            if (excludes.length) {
                if (this.debug) {
                    console.log('processing search excludes');
                }
                excludes.some(xterm => {
                    this.debug && console.error('before exclude ' + xterm + ': ' + this.mapSize(smap, opts.group));
                    let xmap = this.queryTermMap([xterm]);
                    smap = this.diffMap(smap, xmap);
                    const ms = this.mapSize(smap, opts.group);
                    this.debug && console.error('after exclude ' + xterm + ': ' + ms);
                    return !this.mapSize(smap, opts.group);
                });
            }
            if (this.debug) {
                console.log('done');
            }
            this.searchMapCache[key] = clone(smap);
            return smap;
        }
        this.searchMapCache[key] = {};
        return {};
    }
    async search(terms, opts = {}) {
        if (typeof(terms) == 'string') {
            terms = this.tools.terms(terms, false, true);
        }
        let start = (Date.now() / 1000), results = []
        const limit = opts.limit || 256, maxWorkingSetLimit = limit * 2;
        if (!terms) {
            return [];
        }
        if (this.debug) {
            console.warn('lists.search() parsing query', ((Date.now() / 1000) - start) + 's (pre time)');
        }
        const query = this.parseQuery(terms, opts)
        if (this.debug) {
            console.warn('lists.search() map searching', ((Date.now() / 1000) - start) + 's (pre time)', query);
        }
        let smap = this.searchMap(query, opts)
        if (this.debug) {
            console.warn('lists.search() parsing results', terms, opts, ((Date.now() / 1000) - start) + 's (pre time)');
        }
        if (Object.keys(smap).length) {
            if (this.debug) {
                console.warn('lists.search() iterating lists', terms, opts, ((Date.now() / 1000) - start) + 's (pre time)');
            }
            const results = await this.fetchMap(smap, opts, maxWorkingSetLimit)
            if (this.debug) {
                console.warn('lists.search() RESULTS*', ((Date.now() / 1000) - start) + 's (total time)', terms);
            }
            return this.adjustSearchResults(results, opts, limit)
        } else {
            return []
        }
    }
    async fetchMap(smap, opts={}, limit=512) {
        let results = []
        const limiter = pLimit(4)
        const already = new Set(), checkType = opts.type && opts.type != 'all'
        for(const listUrl in smap) {
            if(Array.isArray(smap[listUrl])) continue
            let ls
            if (opts.groupsOnly) {
                ls = smap[listUrl]['g']
            } else {
                ls = smap[listUrl]['n']
                if (opts.group) {
                    ls.push(...smap[listUrl]['g'])
                }
            }
            smap[listUrl] = ls
        }
        const tasks = Object.keys(smap).map(listUrl => {
            return async () => {
                this.debug && console.warn('lists.search() ITERATE LIST ' + listUrl, smap[listUrl]);
                if (typeof(this.lists[listUrl]) == 'undefined' || !smap[listUrl].length) return
                this.debug && console.warn('lists.search() WILL WALK ' + listUrl);
                for await (const e of this.lists[listUrl].walk(smap[listUrl])) {
                    this.debug && console.warn('lists.search() WALK ', e)
                    if (already.has(e.url)) continue
                    already.add(e.url)
                    if (checkType) {
                        if (this.validateType(e, opts.type, opts.typeStrict === true)) {
                            e.source = listUrl;
                            results.push(e);
                            if (results.length == limit) break
                        }
                    } else {
                        e.source = listUrl;
                        results.push(e);
                        if (results.length == limit) break
                    }
                }
            }
        }).map(limiter)
        await Promise.allSettled(tasks)
        if (this.debug) {
            console.warn('lists.search() ITERATED ' + results.length)
        }
        results = this.prepareEntries(results);
        if (opts.parentalControl !== false) {
            results = this.parentalControl.filter(results, true)
        }
        return results
    }
    adjustSearchResults(entries, opts, limit) {
        let map = {}, nentries = [];
        if (opts.type == 'live') {
            const livefmt = config.get('live-stream-fmt');
            switch (livefmt) {
                case 'hls':
                    entries = this.isolateHLS(entries, true);
                    break;
                case 'mpegts':
                    entries = this.isolateHLS(entries, false);
                    break;
            }
        }
        entries.forEach(e => {
            let domain = getDomain(e.url);
            if (typeof(map[domain]) == 'undefined') {
                map[domain] = [];
            }
            map[domain].push(e);
        });
        let domains = Object.keys(map);
        for (let i = 0; nentries.length < limit; i++) {
            let keep;
            domains.forEach(domain => {
                if (!map[domain] || nentries.length >= limit)
                    return;
                if (map[domain].length > i) {
                    keep = true;
                    nentries.push(map[domain][i]);
                } else {
                    delete map[domain];
                }
            });
            if (!keep)
                break;
        }
        return this.tools.sort(nentries);
    }
    ext(file) {
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    }
    isolateHLS(entries, elevate) {
        let notHLS = [];
        entries = entries.filter(a => {
            if (this.ext(a.url) == 'm3u8') {
                return true;
            }
            notHLS.push(a);
        });
        if (elevate) {
            entries.push(...notHLS);
        } else {
            entries = notHLS.push(...entries);
        }
        return entries;
    }
    async groups(types, myListsOnly) {
        let groups = [], map = {};
        if (myListsOnly) {
            myListsOnly = config.get('lists').map(l => l[1]);
        }
        Object.keys(this.lists).forEach(url => {
            if (myListsOnly && !myListsOnly.includes(url))
                return;
            let entries = this.lists[url].index.groupsTypes;
            types.forEach(type => {
                if (!entries || !entries[type])
                    return;
                entries[type].forEach(group => {
                    const parts = group.name.split('/');
                    if (parts.length > 1) {
                        parts.forEach((part, i) => {
                            const path = parts.slice(0, i + 1).join('/');
                            if (typeof(map[path]) == 'undefined')
                                map[path] = [];
                            if (i < (parts.length - 1))
                                map[path].push(parts[i + 1]);
                        });
                    }
                    groups.push({
                        group: group.name,
                        name: group.name.split('/').pop(),
                        url,
                        icon: group.icon
                    });
                });
            });
        });
        groups = this.tools.sort(groups);
        const routerVar = {};
        let ret = groups.filter((group, i) => {
            return Object.keys(map).every(parentPath => {
                let gname = parentPath.split('/').pop();
                return map[parentPath].every(name => {
                    const path = parentPath + '/' + name;
                    if (group.group == path) {
                        let ret = false;
                        if (typeof(routerVar[parentPath]) == 'undefined') {
                            routerVar[parentPath] = i;
                            const ngroup = Object.assign({}, groups[i]);
                            groups[i].name = gname;
                            groups[i].group = parentPath;
                            groups[i].entries = [ngroup];
                            ret = true;
                        } else {
                            groups[routerVar[parentPath]].entries.push(group);
                        }
                        return ret;
                    }
                    return true;
                });
            });
        });
        return ret;
    }
    async group(group) {
        if (!this.lists[group.url]) {
            menu.displayErr('GROUP=' + JSON.stringify(group));
            throw 'List not loaded';
        }
        /*
                let mmap, map = this.lists[group.url].index.groups[group.group].slice(0)
                if(!map) map = []
                Object.keys(this.lists[group.url].index.groups).forEach(s => {
                    if(s != group.group && s.includes('/') && s.startsWith(group.group)){
                        if(!mmap) { // jit
                            mmap = new Map(map.map(m => [m, null]))
                            map = [] // freeup mem
                        }
                        this.lists[group.url].index.groups[s].forEach(n => mmap.has(n) || mmap.set(n, null))
                    }
                })
        
                if(mmap) {
                    map = Array.from(mmap, ([key]) => key)
                }
        */
        let entries = [], map = this.lists[group.url].index.groups[group.group] || [];
        if (map.length) {
            entries = await this.lists[group.url].getEntries(map);
            return entries;
        }
        entries = this.parentalControl.filter(entries, true);
        entries = this.tools.sort(entries);
        return entries;
    }
}
export default Index;
