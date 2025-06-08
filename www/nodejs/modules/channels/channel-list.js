import osd from '../osd/osd.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import { EventEmitter } from 'node:events'
import cloud from '../cloud/cloud.js'
import pLimit from 'p-limit'
import Limiter from '../limiter/limiter.js'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import ready from '../ready/ready.js'

export class ChannelsList extends EventEmitter {
    constructor(type, countries) {
        super();
        this.type = type
        this.countries = countries
        this.key = 'categories-'+ countries.join('-') +'-'+ this.type
        this.isChannelCache = {}
        this.channelsIndex = {}
        this.categories = {}
        this.epgAutoUpdateInterval = 600
        this.limiter = new Limiter(async () => {
            await this.load().catch(err => console.error(err))
        }, 3000)
        this.setupListeners()
        this.ready = ready()
    }
    setupListeners() {
        renderer.ready(() => {
            this.listsListeners = {
                list: async () => {
                    if(this.type == 'lists') {
                        await this.limiter.call()
                    }
                },
                epg: async () => {
                    if(this.type == 'epg') {
                        await this.limiter.call()
                    }
                }
            }
            global.lists.on('list-loaded', this.listsListeners.list)
            global.lists.on('epg-update', this.listsListeners.epg)
            global.lists.on('epg-loaded', this.listsListeners.epg)
            global.lists.on('satisfied', this.listsListeners.list)
            this.limiter.call()
        })
    }
    async load(refresh) {
        let fine, changed
        let data = await storage.get(this.key).catch(err => console.error(err))
        let len = data ? Object.keys(data).length : 0
        if (data && len) {
            this.categories = data
            fine = true
        }
        if (!fine || refresh || this.type == 'epg') {
            let err
            data = await this.getActiveCategories().catch(e => err = e)
            if (err) {
                len = 0
                console.error('channel.getActiveCategories error: ' + err)
            } else {
                len = Object.keys(data).length
                this.channelsIndex = null
                this.categories = data
                await this.save(this.key)
                fine = true
                changed = true
            }
            if(this.type == 'epg' && len) {
                this.schedule()
            }
        }
        if(!len) {
            this.schedule(15)
        }
        this.updateChannelsIndex(false)
        if (!this.categories || typeof(this.categories) != 'object') {
            this.categories = {}
        }
        this.loaded = true
        this.emit('loaded', changed)
        this.ready.done()
    }
    schedule(secs) {
        if(!secs) {
            secs = this.epgAutoUpdateInterval
        }
        this.epgAutoUpdateTimer && clearTimeout(this.epgAutoUpdateTimer)
        this.epgAutoUpdateTimer = setTimeout(() => {
            this.load().catch(err => console.error(err))
        }, secs * 1000)
    }
    async reset() {
        delete this.categories
        await storage.delete(this.key).catch(err => console.error(err))
        config.set('channel-grid', '')
        await this.load(true)
    }
    async getAdultCategories() {
        return cloud.get('channels/adult')
    }
    async getEPGCategories(noFallback = false) {
        try {
            const data = await global.lists.epgLiveNowChannelsList()
            if(!data || !data.categories || !Object.keys(data.categories).length) {
                throw 'no categories'
            }
            return data.categories
        } catch(e) {
            console.error('channel.getEPGCategories error: '+ e)
            if (noFallback || global.lists.epg?.loaded) {
                return {}
            }
            return this.getAppRecommendedCategories()
        }
    }
    async getPublicListsCategories() {
        await global.lists.discovery.ready()
        const ret = {}, limit = pLimit(2)
        const groups = await global.lists.discovery.getProvider('public').entries(true, true, true)
        const promises = groups.filter(g => g.renderer).map(g => {
            return limit(async () => {
                const entries = await g.renderer(g).catch(err => console.error(err))
                if (Array.isArray(entries)) {
                    ret[g.name] = [...new Set(entries.filter(e => e.name && e.type != 'action').map(e => e.name))]
                }
            })
        })
        await Promise.allSettled(promises)
        return ret
    }
    async getListsCategories() {
        const ret = {}        
        let groups = await global.lists.groups(['live'], true)
        if(!groups.length) {
            groups = await global.lists.groups(['live'], false)
        }
        for (const group of groups) {
            const entries = await global.lists.group(group).catch(err => console.error(err));
            if (Array.isArray(entries)) {
                let es = entries.map(e => {
                    return e.name.split(' ').filter(w => {
                        return w && !global.lists.tools.stopWords.has(w.toLowerCase());
                    }).join(' ')
                });
                if (es.length)
                    ret[group.name] = es;
            }
        }
        return ret;
    }
    async getAppRecommendedCategories() {
        let finished, received = 0
        const limit = pLimit(2), data = {}, ret = {}
        const maxChannelsToProcess = 1024
        const maxChannelsPerCategory = 24
        const minChannelsToCollect = maxChannelsToProcess / 3
        const processCountry = async country => {
            if (finished) return
            let err
            const priority = country == lang.countryCode
            if (!priority && received >= maxChannelsToProcess) return
            let map = await cloud.get('channels/'+ country).catch(e => err = e)
            if (err) {
                if(priority) {
                    err = null
                    map = await cloud.get('channels/'+ country, {
                        bypassCache: true // force refresh
                    }).catch(e => err = e)
                }
            }
            if (err) return
            data[country] = map
            received += this.mapSize(map)
        }
        const promises = {}, promise = processCountry(this.countries[0])
        await Promise.allSettled(this.countries.slice(1).map(country => {
            promises[country] = limit(() => processCountry(country))
            return promises[country]
        }))
        await promise
        let size = 0
        for (const country of this.countries) { // this.countries will be in the preferred order
            const size = this.mapSize(ret)
            if(promises[country] && size <= minChannelsToCollect) {
                await promises[country].catch(err => console.error(err))
            }
            if(!data[country]) continue
            await this.applyMapCategories(data[country], ret, maxChannelsPerCategory, country != lang.countryCode)
        }
        finished = true
        return ret
    }
    updateChannelsIndex(refresh) {
        if (refresh === true || !this.channelsIndex || !Object.keys(this.channelsIndex).length) {
            let index = {};
            this.getCategories().forEach(cat => {
                cat.entries.forEach(e => {
                    index[e.name] = e.terms.name;
                });
            });
            let keys = Object.keys(index);
            keys.sort((a, b) => { return index[a].length > index[b].length ? -1 : (index[a].length < index[b].length) ? 1 : 0; });
            this.isChannelCache = {};
            this.channelsIndex = {};
            keys.forEach(k => this.channelsIndex[k] = index[k]);
        }
    }
    mapSize(n) {
        return Object.values(n).map(k => Array.isArray(k) ? k.length : 0).reduce((s, v) => s + v, 0);
    }
    applyMapCategories(map, target, maxChannelsPerCategory, weighted=false) {
        const categories = Object.keys(target).concat(Object.keys(map).map(k => this.translateKey(k)).filter(k => !(k in target)))
        for (const k of Object.keys(map)) {
            const cat = this.translateKey(k)
            if(!target[cat]) target[cat] = []
            const left = maxChannelsPerCategory - target[cat].length
            if (left > 0 && Array.isArray(map[k])) {
                const slice = map[k].filter(s => !target[cat].includes(s)).slice(0, weighted ? left : undefined)
                if (slice.length) {
                    target[cat].push(...slice)
                }
            }
        }
        return target
    }
    translateKey(k) {
        let lk = 'CATEGORY_' + k.replaceAll(' & ', ' ').replace(new RegExp(' +', 'g'), '_').toUpperCase();
        let nk = lang[lk] || k;
        return nk;
    }
    async getActiveCategories() {
        let categories
        switch (this.type) {
            case 'public':
                categories = await this.getPublicListsCategories();
                break;
            case 'lists':
                categories = await this.getListsCategories();
                break;
            case 'xxx':
                categories = await this.getAdultCategories();
                break;
            case 'epg':
                categories = await this.getEPGCategories();
                break;
            default:
                categories = await this.getAppRecommendedCategories();
        }
        return this.optimizeCategories(categories)
    }
    getCategories(compact) {
        return compact ? this.categories : this.expand(this.categories);
    }
    async setCategories(data, silent) {
        this.categories = data;
        this.channelsIndex = null;
        await this.save();
        console.log('Categories file imported');
        if (silent !== true) {
            osd.show(lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal');
        }
    }
    compactName(name, terms) {
        if (terms && terms.length > 1 && terms != name) {
            name += ', ' + (typeof(terms) == 'string' ? terms : terms.join(' '));
        }
        return name;
    }
    expandName(name) {        
        let terms
        if (name.includes(',')) {
            terms = name.split(',').map(s => s = s.trim());
            name = terms.shift();
            if (!terms.length) {
                terms = name;
            } else {
                terms = terms.join(' ');
            }
        } else {
            terms = name;
        }
        terms = global.lists.tools.terms(terms)
        return { name, terms: { name: terms, group: [] } };
    }
    compact(data, withTerms) {
        if (!Array.isArray(data)) {
            return data
        }
        let ret = {};
        data.forEach(c => {
            ret[c.name] = c.entries.map(e => {
                return this.compactName(e.name, withTerms ? e.terms : false);
            });
        });
        return ret;
    }
    expand(data) {
        if (Array.isArray(data)) {
            return data
        }
        return Object.keys(data).filter(name => Array.isArray(data[name])).map(name => {
            return {
                name,
                type: 'group',
                group: name,
                entries: data[name].map(name => {
                    return Object.assign(this.expandName(name), { type: 'option' })
                })
            }
        })
    }
    optimizeCategories(data) { // remove redundant categories, whose entries are a subset of another category
        const entries = Object.entries(data);
        entries.sort((a, b) => b[1].length - a[1].length);
    
        const categoryMap = new Map();
        const redundant = new Set();
    
        for (let i = 0; i < entries.length; i++) {
            const [currentCat, currentChannels] = entries[i];
            const currentSet = new Set(currentChannels);
            categoryMap.set(currentCat, currentSet);
    
            for (let j = 0; j < i; j++) {
                const [otherCat] = entries[j];
                if (redundant.has(otherCat)) continue;
    
                const otherSet = categoryMap.get(otherCat);
                let isSubset = true;
                for (const channel of currentSet) {
                    if (!otherSet.has(channel)) {
                        isSubset = false;
                        break;
                    }
                }
                if (isSubset) {
                    redundant.add(currentCat);
                    break;
                }
            }
        }
    
        const result = {};
        for (const [category, channels] of entries) {
            if (!redundant.has(category)) {
                result[category] = channels;
            }
        }
    
        return result;
    }    
    async save() {
        let ordering = {};
        Object.keys(this.categories).sort().forEach(k => {
            if (!Array.isArray(this.categories[k]))
                return;
            ordering[k] = this.categories[k].map(String).sort((a, b) => {
                let aa = a.indexOf(',');
                let bb = b.indexOf(',');
                aa = aa == -1 ? a : a.substr(0, aa);
                bb = bb == -1 ? b : b.substr(0, bb);
                return aa > bb ? 1 : -1;
            });
        });
        this.categories = ordering;
        this.updateChannelsIndex(true);
        await storage.set(this.key, this.categories, {
            permanent: true,
            expiration: true
        });
    }
    destroy() {
        this.destroyed = true;
        this.loaded = true;
        global.lists.removeListener('list-loaded', this.listsListeners.list);
        global.lists.removeListener('epg-update', this.listsListeners.epg);
        global.lists.removeListener('epg-loaded', this.listsListeners.epg);
        global.lists.removeListener('satisfied', this.listsListeners.list);
        this.emit('loaded');
        this.ready.done()
    }
}