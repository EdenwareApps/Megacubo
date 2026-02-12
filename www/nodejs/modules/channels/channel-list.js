import osd from '../osd/osd.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import { EventEmitter } from 'node:events'
import { getChannels, generate } from '@edenware/tv-channels-by-country'
import Limiter from '../limiter/limiter.js'
import renderer from '../bridge/bridge.js'
import ready from '../ready/ready.js'
import { translateCategoryName } from '../utils/utils.js'

export class ChannelsList extends EventEmitter {
    constructor(countries, options = {}) {
        super();
        const { onlyFree = false, includeAdult = false } = options
        this.countries = countries
        this.onlyFree = onlyFree
        this.includeAdult = includeAdult
        this.isChannelCache = {}
        this.generatedCache = new Map();
        this.channelsIndex = {}        
        this.categories = {}
        this.userMods = { additions: {}, removals: {}, renames: {}, termChanges: {} }
        this.baseCache = null
        this.limiter = new Limiter(async () => {
            await this.load().catch(err => console.error(err))
        }, 3000)
        this.setupListeners()
        this.ready = ready()
    }
    get key() {
        return 'categories-' + this.countries.join('-') + (this.onlyFree ? '-free' : '') + (this.includeAdult ? '-adult' : '')
    }
    get userModsKey() {
        return this.key + '-mods'
    }
    setupListeners() {
        renderer.ready(() => {
            this.limiter.call()
        })
    }
    async load(refresh) {
        let changed = false
        let err
        const base = await this.get().catch(e => err = e)
        if (err) {
            console.error('channel.load error: ' + err)
            this.scheduleRetry(15)
            this.categories = {}
        } else {
            const mods = await storage.get(this.userModsKey).catch(err => console.error(err)) || { additions: {}, removals: {}, renames: {}, termChanges: {} }
            this.categories = this.applyMods(base, mods)
            // Sort categories and channels like in save()
            let ordering = {};
            Object.keys(this.categories).sort().forEach(k => {
                if (!Array.isArray(this.categories[k])) return;
                ordering[k] = this.categories[k].map(String).sort((a, b) => {
                    let aa = a.indexOf(',');
                    let bb = b.indexOf(',');
                    aa = aa == -1 ? a : a.substr(0, aa);
                    bb = bb == -1 ? b : b.substr(0, bb);
                    return aa > bb ? 1 : -1;
                });
            });
            this.categories = ordering;
            this.baseCache = base
            this.channelsIndex = null
            this.isChannelCache = {}
            if (refresh) {
                changed = true
            }
        }
        this.updateChannelsIndex(false)
        if (!this.categories || typeof (this.categories) != 'object') {
            this.categories = {}
        }
        this.loaded = true
        this.emit('loaded', changed)
        this.ready.done()
    }
    scheduleRetry(secs) {
        this.retryTimer && clearTimeout(this.retryTimer)
        this.retryTimer = setTimeout(() => {
            this.load(true).catch(err => console.error(err))
        }, (secs || 15) * 1000)
    }
    async reset() {
        delete this.categories
        await storage.delete(this.key).catch(err => console.error(err))
        await storage.delete(this.userModsKey).catch(err => console.error(err))
        await this.load(true)
    }
    /** Convert package format (category -> [{ name }]) to category -> [name strings] */
    channelsByCategoryToNames(data) {
        if (!data || typeof data !== 'object') return {}
        return Object.fromEntries(
            Object.entries(data).map(([cat, channels]) => [
                cat,
                Array.isArray(channels) ? channels.map(ch => (ch && ch.name) || ch).filter(Boolean) : []
            ])
        )
    }
    async getKeywords(size = 64) {
        const list = await this.generate()
        const keywords = []
        for (const ch of list) {
            const ts = ch.keywords.split(' ')
            const terms = ts.filter(t => t && typeof t === 'string' && t.length > 2 && !t.startsWith('-'))
            const excludes = ts.filter(t => t && typeof t === 'string' && t.startsWith('-')).map(t => t.substr(1).toLowerCase())
            keywords.push({terms, excludes})
            if (keywords.length >= size) break
        }
        return keywords
    }
    async generate(additionalOpts = {}) {
        // Merge default options with additional ones
        const opts = {
            countries: this.countries,
            mainCountryFull: true,
            freeOnly: this.onlyFree === true,
            retransmits: 'parents',
            limit: 1024,
            minPerCategory: 24,
            ...additionalOpts
        };

        // Create a deterministic cache key from sorted options
        const cacheKey = this.createCacheKey(opts);

        // Return cached result if available
        if (this.generatedCache.has(cacheKey)) {
            return this.generatedCache.get(cacheKey);
        }

        // Generate channels with error optas handling
        let generated;
        try {
            generated = await generate(opts);
            if (!Array.isArray(generated)) {
                console.warn('generate() did not return an array:', generated);
                generated = [];
            }
        } catch (err) {
            console.error('Error generating channels:', err);
            generated = [];
        }

        if (this.includeAdult) {
            try {
                const data = await getChannels('adult')
                const adultCategories = this.channelsByCategoryToNames(data);
                const adultChannels = Object.values(adultCategories).flat();
                const existingNames = new Set(generated.map(ch => ch.name));
                for (const chName of adultChannels) {
                    if (!existingNames.has(chName)) {
                        generated.push({ name: chName, category: 'Adult', keywords: chName.toLowerCase() });
                    }
                }
            } catch (err) {
                console.error('Error including adult channels:', err);
            }
        }

        const categoryNameTranslationCache = new Map();
        for (const ch of generated) {
            if (ch.category) {
                if (!categoryNameTranslationCache.has(ch.category)) {
                    categoryNameTranslationCache.set(ch.category, translateCategoryName(ch.category));
                }
                ch.category = categoryNameTranslationCache.get(ch.category);
            }
        }

        // Cache the result
        this.generatedCache.set(cacheKey, generated);

        // Limit cache size to prevent memory leaks (keep last 10 entries)
        if (this.generatedCache.size > 10) {
            const firstKey = this.generatedCache.keys().next().value;
            this.generatedCache.delete(firstKey);
        }

        return generated;
    }

    createCacheKey(opts) {
        // Create a stable string key from options
        return Object.keys(opts)
            .sort()
            .map(key => `${key}:${JSON.stringify(opts[key])}`)
            .join('|');
    }
    async get(onlyFree = false) {
        const list = await this.generate({
            freeOnly: onlyFree === true || this.onlyFree === true
        }).catch(e => console.error(e)) || []
        const ret = {}
        for (const ch of list) {
            if (!ch?.category || !ch?.name) continue
            if (!ret[ch.category]) ret[ch.category] = []
            ret[ch.category].push(ch.name)
        }
        return ret
    }
    updateChannelsIndex(refresh) {
        if (refresh === true || !this.channelsIndex || !Object.keys(this.channelsIndex).length) {
            let index = {};
            this.getCategories().forEach(cat => {
                cat.entries.forEach(e => {
                    index[e.name] = e.terms;
                });
            });
            let keys = Object.keys(index);
            keys.sort((a, b) => { return index[a].length > index[b].length ? -1 : (index[a].length < index[b].length) ? 1 : 0; });
            this.generatedCache.clear();
            this.channelsIndex = {};
            keys.forEach(k => this.channelsIndex[k] = index[k]);
        }
    }
    mapSize(n) {
        return Object.values(n).map(k => Array.isArray(k) ? k.length : 0).reduce((s, v) => s + v, 0);
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
        if (!name || typeof name !== 'string') {
            return { name: '', terms: [] };
        }
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
        return { name, terms };
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
    computeMods(base, current) {
        const mods = { additions: {}, removals: {}, renames: {}, termChanges: {} }
        // For each category in base and current
        const allCats = new Set([...Object.keys(base), ...Object.keys(current)])
        for (const cat of allCats) {
            const baseChannels = new Set(base[cat] || [])
            const currentChannels = new Set(current[cat] || [])
            // Additions: in current but not in base
            const additions = [...currentChannels].filter(ch => !baseChannels.has(ch))
            if (additions.length) {
                mods.additions[cat] = additions
            }
            // Removals: in base but not in current
            const removals = [...baseChannels].filter(ch => !currentChannels.has(ch))
            if (removals.length) {
                mods.removals[cat] = removals
            }
        }
        // For renames and term changes, compare expanded names
        for (const cat of allCats) {
            const baseChannels = (base[cat] || []).map(ch => this.expandName(ch))
            const currentChannels = (current[cat] || []).map(ch => this.expandName(ch))
            // Create maps for quick lookup
            const baseMap = new Map(baseChannels.map(({ name, terms }) => [name, terms.join(' ')]))
            const currentMap = new Map(currentChannels.map(({ name, terms }) => [name, terms.join(' ')]))
            // Renames: same terms but different name? Wait, renames are when name changes
            // Actually, since we're comparing full strings, renames would be if the compact string changed but name is same? No.
            // Renames are explicit user actions, but in computeMods, we need to detect if a channel was renamed.
            // But since names are keys, if name changed, it's a new addition and removal.
            // For simplicity, assume no renames detected here; renames are handled separately in editing.
            // For term changes: if name same but terms different
            for (const [name, currentTerms] of currentMap) {
                const baseTerms = baseMap.get(name)
                if (baseTerms !== undefined && baseTerms !== currentTerms) {
                    if (!mods.termChanges[cat]) mods.termChanges[cat] = {}
                    mods.termChanges[cat][name] = currentTerms
                }
            }
        }
        return mods
    }
    applyMods(base, mods) {
        const result = JSON.parse(JSON.stringify(base)) // deep copy
        // Apply removals
        for (const [cat, channels] of Object.entries(mods.removals || {})) {
            if (result[cat]) {
                result[cat] = result[cat].filter(ch => !channels.includes(ch))
            }
        }
        // Apply additions
        for (const [cat, channels] of Object.entries(mods.additions || {})) {
            if (!result[cat]) result[cat] = []
            for (const ch of channels) {
                if (!result[cat].includes(ch)) {
                    result[cat].push(ch)
                }
            }
        }
        // Apply renames (if any, but currently not used in computeMods)
        for (const [cat, renames] of Object.entries(mods.renames || {})) {
            if (result[cat]) {
                result[cat] = result[cat].map(ch => {
                    const expanded = this.expandName(ch)
                    const newName = renames[expanded.name]
                    if (newName) {
                        return this.compactName(newName, expanded.terms.join(' '))
                    }
                    return ch
                })
            }
        }
        // Apply term changes
        for (const [cat, changes] of Object.entries(mods.termChanges || {})) {
            if (result[cat]) {
                result[cat] = result[cat].map(ch => {
                    const expanded = this.expandName(ch)
                    const newTerms = changes[expanded.name]
                    if (newTerms !== undefined) {
                        return this.compactName(expanded.name, newTerms)
                    }
                    return ch
                })
            }
        }
        return result
    }    
    async save() {
        if (!this.baseCache) {
            // Fallback: fetch base if not cached
            this.baseCache = await this.get().catch(err => {
                console.error('Failed to fetch base for save:', err)
                return {}
            })
        }
        const mods = this.computeMods(this.baseCache, this.categories)
        this.userMods = mods
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
        await storage.set(this.userModsKey, mods, {
            permanent: true,
            expiration: true
        });
    }
    destroy() {
        this.destroyed = true
        this.loaded = true
        this.retryTimer && clearTimeout(this.retryTimer)
        this.emit('loaded')
        this.ready.done()
    }
}