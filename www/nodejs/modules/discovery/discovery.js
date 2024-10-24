import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import { EventEmitter } from 'events';
import Limiter from "../limiter/limiter.js";
import PublicListsProvider from "./providers/public-lists.js";
import CommunityListsProvider from "./providers/community-lists.js";
import CommunityListsIPTVOrgProvider from "./providers/community-lists-iptv-org.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'

class ListsDiscovery extends EventEmitter {
    constructor(lists) {
        super()
        this.lists = lists
        this.factor = 0.1;
        this.key = 'lists-discovery';
        this.opts = {
            limit: 256
        }
        this.providers = [];
        this.knownLists = [];
        this.allowedAtts = ['url', 'name', 'image', 'length', 'health', 'type', 'perceivedHealth', 'perceivedHealthTestCount', 'lastModified'];
        this.on('registered', () => {
            process.nextTick(() => {
                if (this.providers.length > 1 && this.providers.every(p => p[0]._isLoaded)) {
                    this.isReady = true;
                    this.emit('ready');
                    this.save().catch(console.error);
                } else {
                    this.isReady = false;
                }
            });
        });
        this.on('found', () => this.save().catch(console.error));
        this.saver = new Limiter(() => {
            storage.set(this.key, this.knownLists, {
                permanent: true,
                expiration: true
            });
        }, 10000);
        this.restore().catch(console.error);
        renderer.ready(async () => {
            [
                [new PublicListsProvider(this), 'public'],
                [new CommunityListsProvider(this), 'community'],
                [new CommunityListsIPTVOrgProvider(this), 'community']
            ].forEach(row => this.register(...row));
            global.menu.addFilter(this.hook.bind(this))
        })
    }
    getProvider(type, id) {
        if(id) {
            const e = this.providers.find(p => p[0].type == type && p[0].id == id)
            if(e) return e[0]
        }
        const e = this.providers.find(p => p[0].type == type)
        if(e) return e[0]
    }
    async restore() {
        const data = await storage.get(this.key).catch(console.error);
        Array.isArray(data) && this.add(data);
    }
    async reset() {
        this.knownLists = [];
        await this.save();
        await this.update();
        await this.save();
    }
    async save() {
        this.saver.call();
    }
    register(provider, type) {
        provider._isLoaded = false
        this.providers.push([provider, type])
        provider.discovery(lists => this.add(lists)).catch(console.error).finally(() => {
            provider._isLoaded = true
            this.emit('registered')
        })
    }
    async update(provider, type) {
        for (const provider of this.providers) {
            provider[0]._isLoaded = false
            await provider[0].discovery(lists => this.add(lists)).catch(console.error).finally(() => {
                provider[0]._isLoaded = true
                this.emit('registered')
            })
        }
    }
    ready() {
        return new Promise(resolve => {
            if (this.isReady) {
                return resolve();
            }
            this.once('ready', resolve);
        });
    }
    async get(amount = 20) {
        await this.ready();
        this.sort();
        const active = {
            public: config.get('public-lists'),
            community: config.get('communitary-mode-lists-amount') > 0
        };
        return this.domainCap(this.knownLists.filter(list => active[list.type]), amount)
    }
    getDomain(u) {
        if (u && u.includes('//')) {
            var domain = u.split('//')[1].split('/')[0];
            if (domain == 'localhost' || domain.includes('.')) {
                return domain;
            }
        }
        return '';
    }
    domainCap(lists, limit) {
        let currentLists = lists.slice(0);
        const ret = [], domains = {} // limit each domain up to 20% of selected links, except if there are no other domains enough
        while (currentLists.length && ret.length < limit) {
            currentLists = currentLists.filter(l => {
                let pick = l.type != 'community' // public and own lists are always picked as trusted sources
                if(!pick) {
                    const dn = this.getDomain(l.url)
                    if (!domains[dn]) {
                        domains[dn] = true
                        pick = true
                    }
                }
                pick && ret.push(l)
                return !pick            
            })
            Object.keys(domains).forEach(dn => domains[dn] = false) // reset counts and go again until fill limit
        }
        return ret.slice(0, limit)
    }
    details(url, key) {
        const list = this.knownLists.find(l => l.url === url);
        if (list) {
            if (key) {
                return list[key];
            }
            return list;
        }
    }
    add(lists) {
        const now = new Date().getTime() / 1000;
        const aYear = 365 * (30 * 24); // aprox
        const oneYearAgo = now - aYear, newOnes = [];
        Array.isArray(lists) && lists.forEach(list => {
            if (!list || !list.url)
                return;
            const existingListIndex = this.knownLists.findIndex(l => l.url === list.url);
            if (existingListIndex === -1) {
                this.knownLists.push(Object.assign({
                    health: -1,
                    perceivedHealth: 0,
                    perceivedHealthTestCount: 0
                }, {
                    ...this.cleanAtts(list),
                    lastModified: Math.max(oneYearAgo, list.lastModified || 0)
                }));
                newOnes.push(list.url);
            } else {
                this.assimilate(existingListIndex, this.cleanAtts(list));
            }
        });
        if (newOnes.length) {
            this.alignKnownLists();
            this.emit('found', newOnes);
        }
    }
    cleanAtts(list) {
        Object.keys(list).forEach(k => {
            if (!this.allowedAtts.includes(k)) {
                delete list[k];
            }
        });
        return list;
    }
    assimilate(existingListIndex, list) {
        const existingList = this.knownLists[existingListIndex];
        const health = this.averageHealth({
            health: existingList.health,
            perceivedHealth: list.health
        }); // average health from both
        if (list.type == 'community' && this.knownLists[existingListIndex].type == 'public') {
            list.type = 'public'; // prefer it as public list
        }
        this.knownLists[existingListIndex] = {
            ...list,
            health,
            name: existingList.name || list.name,
            image: existingList.image || list.image,
            countries: this.mergeCountries(existingList, list),
            perceivedHealth: existingList.perceivedHealth,
            perceivedHealthTestCount: existingList.perceivedHealthTestCount,
            lastModified: list.lastModified
        };
    }
    mergeCountries(a, b) {
        const c = a.countries || [];
        return c.concat((b.countries || []).filter(g => !c.includes(g)));
    }
    reportHealth(sourceListUrl, success) {
        return this.knownLists.some((list, i) => {
            if (list.url === sourceListUrl) {
                const value = success ? 1 : 0;
                if (typeof(list.perceivedHealthTestCount) != 'number') {
                    list.perceivedHealthTestCount = 0;
                }
                if (list.perceivedHealthTestCount < (1 / this.factor)) {
                    list.perceivedHealthTestCount++;
                }
                if (typeof(list.perceivedHealth) == 'number' && list.perceivedHealthTestCount > 1) {
                    this.knownLists[i].perceivedHealth = ((list.perceivedHealth * (list.perceivedHealthTestCount - 1)) + value) / list.perceivedHealthTestCount;
                } else {
                    this.knownLists[i].perceivedHealth = value;
                }
                this.save().catch(console.error);
                return true;
            }
        });
    }
    averageHealth(list) {
        let health = 0, values = [list.health, list.perceivedHealth].filter(n => {
            return typeof(n) == 'number' && n >= 0 && n <= 1;
        });
        if (values.length) {
            values.forEach(v => health += v);
            health /= values.length;
        }
        return health;
    }
    sort() {
        this.knownLists = this.knownLists.map(a => {
            a.averageHealth = this.averageHealth(a);
            return a;
        });
        this.knownLists.sort((a, b) => b.averageHealth - a.averageHealth);
    }
    alignKnownLists() {
        if (this.knownLists.length > this.opts.limit) {
            this.sort();
            this.knownLists.splice(this.opts.limit);
        }
    }
    async hook(entries, path) {
        if (path.split('/').pop() == lang.MY_LISTS) {
            entries.push({
                name: lang.INTERESTS,
                details: lang.SEPARATE_WITH_COMMAS,
                type: 'input',
                fa: 'fas fa-edit',
                action: (e, v) => {
                    if (v !== false && v != config.get('interests')) {
                        config.set('interests', v);
                        renderer.ui.emit('ask-restart');
                    }
                },
                value: () => {
                    return config.get('interests');
                },
                placeholder: lang.INTERESTS_HINT,
                multiline: true,
                safe: true
            });
        }
        return entries;
    }
    async interests() {
        const badTerms = ['m3u8', 'ts', 'mp4', 'tv', 'channel'];
        let terms = [], addTerms = (tms, score) => {
            if (typeof(score) != 'number') {
                score = 1;
            }
            tms.forEach(term => {
                if (badTerms.includes(term)) {
                    return;
                }
                const has = terms.some((r, i) => {
                    if (r.term == term) {
                        terms[i].score += score;
                        return true;
                    }
                });
                if (!has) {
                    terms.push({ term, score });
                }
            });
        };
        let bterms = global.channels.bookmarks.get();
        if (bterms.length) { // bookmarks terms
            bterms = bterms.slice(-24);
            bterms = bterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-');
            addTerms(bterms);
        }
        let sterms = await channels.search.history.terms();
        if (sterms.length) { // searching terms history
            sterms = sterms.slice(-24);
            sterms = sterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-');
            addTerms(sterms);
        }
        let hterms = global.channels.history.get();
        if (hterms.length) { // user history terms
            hterms = hterms.slice(-24);
            hterms = hterms.map(e => global.channels.entryTerms(e)).flat().unique().filter(c => c[0] != '-');
            addTerms(hterms);
        }
        addTerms(await global.channels.keywords());
        const max = Math.max(...terms.map(t => t.score));
        let cterms = config.get('interests');
        if (cterms) { // user specified interests
            cterms = this.lists.tools.terms(cterms, true).filter(c => c[0] != '-');
            if (cterms.length) {
                addTerms(cterms, max);
            }
        }
        terms = terms.sortByProp('score', true).map(t => t.term);
        if (terms.length > 24) {
            terms = terms.slice(0, 24);
        }
        return terms;
    }
}
export default ListsDiscovery;
