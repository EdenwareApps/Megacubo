import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'
import { terms } from '../lists/tools.js'
import { inWorker } from '../paths/paths.js'
import storage from '../storage/storage.js'
import config from '../config/config.js'
import lang from '../lang/lang.js'
import { getDefaultTags } from './default-tags.mjs'
// Remove direct import to avoid circular dependency
// import smartRecommendations from './index.mjs'

export class Tags extends EventEmitter{
    constructor(smartRecommendations) {
        super()
        this.smartRecommendations = smartRecommendations
        this.caching = {programmes: {}, trending: {}}
        this.defaultTagsCount = 512
        this.queue = new PQueue({concurrency: 1})
        this.manualTagsKey = 'interests'
        this.manualTags = {}
        
        // Smart cache for expanded tags
        this.expandedTagsCache = new Map()
        this.cacheTTL = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
        this.cacheTTLSeconds = 24 * 60 * 60 // 24 hours in seconds (for storage TTL)
        this.cacheKey = 'expanded-tags-cache'
        
        if (inWorker) {
            console.log('ℹ️ Skipping tag expansion in worker context')
            console.trace()
            return
        }
        // Load cache on startup
        this.loadCache()
        this.loadManualTags()
        
        global.channels.history.epg.on('change', () => this.historyUpdated(true))
        global.channels.trending.on('update', () => this.trendingUpdated(true))
        global.channels.on('loaded', changed => changed && this.reset())
    }
    loadManualTags() {
        const stored = config.get(this.manualTagsKey)
        const parsed = this.parseManualTagsRaw(stored)
        this.manualTags = parsed || {}

        if (!parsed && typeof stored === 'string' && stored && stored.trim()) {
            this.saveManualTags()
        }
    }
    saveManualTags() {
        config.set(this.manualTagsKey, this.manualTags)
    }
    parseManualTagsRaw(raw) {
        if (!raw) {
            return null
        }
        if (typeof raw === 'string') {
            const rawTerms = terms(raw, true, false)
            if (!Array.isArray(rawTerms) || !rawTerms.length) {
                return null
            }
            const parsed = {}
            rawTerms.forEach(term => {
                const normalizedTerm = this.sanitizeManualTagTerm(term)
                if (normalizedTerm && !parsed[normalizedTerm]) {
                    parsed[normalizedTerm] = 1
                }
            })
            return Object.keys(parsed).length ? parsed : null
        }
        if (typeof raw === 'object' && !Array.isArray(raw)) {
            const parsed = {}
            for (const [term, weight] of Object.entries(raw)) {
                const normalizedTerm = this.sanitizeManualTagTerm(term)
                const normalizedWeight = this.normalizeManualWeight(weight)
                if (normalizedTerm && normalizedWeight) {
                    parsed[normalizedTerm] = normalizedWeight
                }
            }
            return Object.keys(parsed).length ? parsed : null
        }
        return null
    }
    async setManualTags(raw) {
        return this.queue.add(async () => {
            const parsed = this.parseManualTagsRaw(raw) || {}
            this.manualTags = parsed
            this.saveManualTags()
            await this.clearCache().catch(err => console.warn('Failed to clear expanded tags cache after setManualTags:', err?.message || err))
            this.emit('manualTagsChanged', this.getManualTags())
            this.emit('updated')
            return this.manualTags
        })
    }
    sanitizeManualTagTerm(term) {
        if (typeof term !== 'string') {
            return null
        }
        const parsedTerms = terms(term, true, false)
        if (!Array.isArray(parsedTerms) || !parsedTerms.length) {
            return null
        }
        const normalizedTerm = parsedTerms.find(t => this.isValidTag(t))
        return normalizedTerm || null
    }
    normalizeManualWeight(weight) {
        const numeric = Number(weight)
        if (!Number.isFinite(numeric)) {
            return null
        }
        const clamped = Math.min(2, Math.max(0.1, numeric))
        return Math.round(clamped * 100) / 100
    }
    getManualTags(limit) {
        const entries = Object.entries(this.manualTags)
            .map(([term, weight]) => ({ term, weight }))
            .sort((a, b) => b.weight - a.weight)
        if (typeof limit === 'number' && limit > 0) {
            return entries.slice(0, limit)
        }
        return entries
    }
    async addManualTag(rawTerm, weight = 1) {
        return this.queue.add(async () => {
            const term = this.sanitizeManualTagTerm(rawTerm)
            const normalizedWeight = this.normalizeManualWeight(weight)
            if (!term || !normalizedWeight) {
                return null
            }
            this.manualTags[term] = normalizedWeight
            this.saveManualTags()
            await this.clearCache().catch(err => console.warn('Failed to clear expanded tags cache after addManualTag:', err?.message || err))
            this.emit('manualTagsChanged', this.getManualTags())
            this.emit('updated')
            return term
        })
    }
    async updateManualTag(rawTerm, weight) {
        return this.queue.add(async () => {
            const term = this.sanitizeManualTagTerm(rawTerm)
            const normalizedWeight = this.normalizeManualWeight(weight)
            if (!term || !normalizedWeight) {
                return null
            }
            if (!this.manualTags[term]) {
                return null
            }
            this.manualTags[term] = normalizedWeight
            this.saveManualTags()
            await this.clearCache().catch(err => console.warn('Failed to clear expanded tags cache after updateManualTag:', err?.message || err))
            this.emit('manualTagsChanged', this.getManualTags())
            this.emit('updated')
            return term
        })
    }
    async removeManualTag(rawTerm) {
        return this.queue.add(async () => {
            const term = this.sanitizeManualTagTerm(rawTerm)
            if (!term || !this.manualTags[term]) {
                return false
            }
            delete this.manualTags[term]
            this.saveManualTags()
            await this.clearCache().catch(err => console.warn('Failed to clear expanded tags cache after removeManualTag:', err?.message || err))
            this.emit('manualTagsChanged', this.getManualTags())
            this.emit('updated')
            return true
        })
    }
    async reset() {
        this._channelTermsCache = null // Clear cache when channels reload
        // Clear pending expansions to allow fresh expansions after reset
        this.pendingExpansions.clear()
        if(this.queue.size) {
            return this.queue.onIdle()
        }
        return this.queue.add(async () => {
            await this.channelsUpdated(false)
            await this.historyUpdated(false)
            await this.trendingUpdated(true)
        })
    }
    // Helper method to check if a tag is valid
    // Set of quality/resolution terms that aren't meaningful as content interests
    static QUALITY_TERMS = new Set([
        'sd', 'hd', 'fhd', 'uhd', '4k', '8k',
        '360p', '480p', '576p', '720p', '1080p', '1440p', '2160p', '4320p',
        'hdr', 'sdr', 'dolby', 'atmos', 'h264', 'h265', 'hevc', 'av1', 'vp9',
        'x264', 'x265', 'bitrate', 'fps', '60fps', '30fps'
    ])

    // Lazy cache for channel terms set (built from channelsIndex)
    _getChannelTerms() {
        if (!this._channelTermsCache) {
            this._channelTermsCache = new Set()
            const ci = global.channels?.channelList?.channelsIndex
            if (ci) {
                for (const terms of Object.values(ci)) {
                    if (Array.isArray(terms)) {
                        for (const term of terms) {
                            if (term && term.length > 1) {
                                this._channelTermsCache.add(term)
                            }
                        }
                    }
                }
            }
        }
        return this._channelTermsCache
    }

    isValidTag(tag) {
        // Skip URLs
        if (tag.includes('://') || tag.includes('www.') || tag.includes(' ')) {
            return false
        }
        
        // Skip very short terms
        if (tag.length < 2) {
            return false
        }
        
        // Skip terms that are too long
        if (tag.length > 30) {
            return false
        }
        
        // Skip terms that look like file extensions or technical terms
        if (tag.match(/\.(com|org|net)$/i)) {
            return false
        }
        
        // Skip quality/resolution terms (not meaningful as content interests)
        if (Tags.QUALITY_TERMS.has(tag)) {
            return false
        }
        
        // Skip channel terms — TV channel names aren't content interests
        if (this._getChannelTerms().has(tag)) {
            return false
        }
        
        return true
    }

    prepare(data, limit) {
        // Validate input - return empty object if data is null, undefined, or not an object
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return {}
        }

        const filteredData = {}
        for (const [key, value] of Object.entries(data)) {
            if (value != null && !isNaN(value) && typeof value === 'number') {
                const normalizedKey = typeof key === 'string' ? key.trim().toLowerCase() : ''
                if (!normalizedKey) {
                    continue
                }

                if (this.isValidTag(normalizedKey)) {
                    filteredData[normalizedKey] = Math.max(filteredData[normalizedKey] || 0, value)
                }

                const keyParts = normalizedKey.split(/\s+/).filter(Boolean)
                if (keyParts.length > 1) {
                    const distributedValue = value / keyParts.length
                    keyParts.forEach(part => {
                        if (this.isValidTag(part)) {
                            filteredData[part] = Math.max(filteredData[part] || 0, distributedValue)
                        }
                    })
                }
            }
        }
        
        return Object.fromEntries(
            Object.entries(filteredData)
                .sort(([, valueA], [, valueB]) => valueB - valueA) 
                .slice(0, limit)
        )
    }
    async channelsUpdated(emit) {
        const channelsTags = {}
        const badTerms = new Set(['m3u8', 'ts', 'mp4', 'tv', 'sd', 'hd', 'am', 'fm', 'channel'])
        
        // Validate that channelsIndex exists and is iterable
        if (global.channels?.channelList?.channelsIndex) {
            const values = Object.values(global.channels.channelList.channelsIndex)
            for (const terms of values) {
                if (Array.isArray(terms)) {
                    for (const term of terms) {
                        if (term && typeof term === 'string') {
                            if (term.startsWith('-') || badTerms.has(term)) {
                                continue
                            }
                            channelsTags[term] = Math.max(channelsTags[term] || 0, 1)
                        }
                    }
                }
            }
        }
        
        this.caching.channels = this.equalize(channelsTags)
        emit && this.emit('updated')
    }
    async historyUpdated(emit) {
        let data0 = {}, data = {}
        
        // Validate that history.epg.data exists and is an array
        if (!global.channels?.history?.epg?.data || !Array.isArray(global.channels.history.epg.data)) {
            this.caching.programmes = {}
            emit && this.emit('updated')
            return
        }
        
        const historyData = global.channels.history.epg.data.slice(-6);

        historyData.forEach(row => {
            if (!row) return // Skip null/undefined rows
            
            const name = row.originalName || row.name;
            if (!name) return // Skip rows without name
            
            const category = global.channels.getChannelCategory?.(name);
            if (category) {
                const lcCategory = category.toLowerCase();
                const watchedTime = row.watched?.time || 180
                data[lcCategory] = (data[lcCategory] || 0) + watchedTime;
            }

            const cs = row.watched?.categories || [];
            if (category && !cs.includes(category)) {
                cs.push(category);
            }
            if (row.groupName && !cs.includes(row.groupName)) {
                cs.push(row.groupName);
            }            
            if(row?.watched?.name) {
                try {
                    const tms = terms(row.watched.name, true, false)
                    // Filter out invalid terms before adding to categories
                    const validTerms = tms.filter(t => this.isValidTag(t))
                    cs.push(...validTerms)
                } catch (err) {
                    // Ignore errors in term extraction
                }
            }
            cs.forEach(cat => {
                if (cat && typeof cat === 'string') {
                    const lc = cat.toLowerCase();
                    const watchedTime = row.watched ? (row.watched.time || 180) : 180
                    data0[lc] = (data0[lc] || 0) + watchedTime;
                }
            });
        });

        data = this.equalize(data)
        data0 = this.equalize(data0)        
        for (const k in data) {
            data0[k] = (data0[k] || 0) + data[k]
        }

        this.caching.programmes = { ...data0 };
        emit && this.emit('updated');
    }
    async trendingUpdated(emit) {
        let trendingPromise = true;
        if (global.channels?.trending && !global.channels.trending.currentRawEntries) {
            try {
                trendingPromise = global.channels.trending.getRawEntries?.();
            } catch (err) {
                console.error('Error getting trending entries:', err.message)
                trendingPromise = Promise.resolve()
            }
        }
        
        let searchPromise = Promise.resolve()
        if (this.searchSuggestionEntries) {
            searchPromise = Promise.resolve()
        } else if (global.channels?.search?.getPopularSearchTerms) {
            try {
                searchPromise = global.channels.search.getPopularSearchTerms().then(data => this.searchSuggestionEntries = data).catch(err => {
                    console.error('Error getting search suggestions:', err.message)
                    return []
                })
            } catch (err) {
                console.error('Error calling getPopularSearchTerms:', err.message)
            }
        }
        
        await Promise.allSettled([trendingPromise, searchPromise]).catch(err => console.error(err));

        const map = {};
        const addToMap = (tms, value) => {
            if (!Array.isArray(tms)) return
            tms.forEach(t => {
                if (!t || typeof t !== 'string') return
                
                // Skip terms that start with dash (already filtered)
                if (t.startsWith('-')) return;
                
                // Use the reusable validation method
                if (this.isValidTag(t)) {
                    map[t] = (map[t] || 0) + (value || 1);
                }
            });
        };

        if (Array.isArray(global.channels?.trending?.currentEntries)) {
            const channelEntries = [] // entries identified as channels (for EPG lookup)
            const nonChannelEntries = [] // entries that ARE the content itself
            
            // First pass: separate channels from non-channels, add terms proportionally to audience
            global.channels.trending.currentEntries.forEach(e => {
                if (!e || !e.name) return
                try {
                    const users = e.users || 1
                    const ch = global.channels.isChannel(e)
                    if (ch) {
                        // It's a channel - add channel name terms, will try EPG for programme
                        channelEntries.push({ name: ch.name, users, terms: terms(ch.name) })
                        const entryTerms = global.channels.entryTerms?.(e)
                        if (Array.isArray(entryTerms)) {
                            addToMap(entryTerms, users * 0.3) // Channel terms with reduced weight
                        }
                    } else {
                        // It's content (stream/title) - use its own name as tag
                        nonChannelEntries.push(e)
                        const nameTerms = terms(e.name)
                        if (Array.isArray(nameTerms)) {
                            addToMap(nameTerms, users * 0.5) // Content terms have higher weight
                        }
                    }
                } catch (err) {
                    // Ignore errors
                }
            })
            
            // Second pass: batch-fetch EPG programmes for all channel entries
            if (global.lists?.epg?.loaded && typeof global.lists.getLiveNowAndNext === 'function' && channelEntries.length > 0) {
                try {
                    const descriptors = channelEntries.map(c => ({ name: c.name, terms: c.terms }))
                    const epgResults = await global.lists.getLiveNowAndNext(descriptors, { limit: 1 })
                    
                    if (epgResults && typeof epgResults === 'object') {
                        for (let i = 0; i < channelEntries.length; i++) {
                            const channelName = channelEntries[i].name
                            const users = channelEntries[i].users
                            const data = epgResults[channelName]
                            if (data && Array.isArray(data.programmes) && data.programmes.length > 0) {
                                const programme = data.programmes[0]
                                if (programme && programme.title) {
                                    const programmeTerms = terms(programme.title)
                                    if (Array.isArray(programmeTerms)) {
                                        addToMap(programmeTerms, users * 0.5) // Programme weight proportional to audience
                                    }
                                }
                            }
                        }
                    }
                } catch (err) {
                    console.warn('Failed to batch-fetch EPG programmes for trending:', err.message)
                }
            }
        }

        if (Array.isArray(this.searchSuggestionEntries)) {
            this.searchSuggestionEntries.forEach(e => {
                if (e && e.search_term && typeof e.search_term === 'string') {
                    addToMap([e.search_term], e.cnt || 1)
                }
            })
        }

        this.caching.trending = { ...this.equalize(map) };
        emit && this.emit('updated');
    }
    equalize(tags, factor=1) {
        // Validate input - return empty object if tags is null, undefined, or not an object
        if (!tags || typeof tags !== 'object' || Array.isArray(tags)) {
            return {}
        }
        
        // Filter out invalid values (null, undefined, NaN) before calculating max
        const validValues = Object.values(tags).filter(v => v != null && !isNaN(v) && typeof v === 'number')
        
        if (validValues.length === 0) {
            // If no valid values, return empty object
            return {}
        }
        
        const maxValue = Math.max(...validValues)
        
        return Object.fromEntries(
            Object.entries(tags)
                .filter(([, value]) => value != null && !isNaN(value) && typeof value === 'number')
                .sort(([, valueA], [, valueB]) => valueB - valueA)
                .map(([key, value]) => [key, (value / maxValue) * factor])
        )
    }
    async get(limit, ignoreExternalTrends = false) {
        if (typeof limit !== 'number') {
            limit = this.defaultTagsCount
        }
        // Ensure caching objects exist before using them
        let manualTags = {}
        const initialTags = this.equalize(this.manualTags || {}, 1)
        if (Object.keys(initialTags).length) {
            for (const [key, value] of Object.entries(initialTags)) {
                manualTags[key] = Math.max(manualTags[key] || 0, value)
            }
        }
        for (const [key, value] of Object.entries(initialTags)) {
            manualTags[key] = Math.max(manualTags[key] || 0, value)
        }
        manualTags = this.equalize(manualTags, 1)

        // Seed tags from the content profile first: while nothing is known about the
        // viewer they must lead the recommendations, and they give way as the engine
        // learns the real taste (1.0 with no tags -> 0 with 8 or more).
        const profileTags = global.lists?.contentProfile?.seedTags?.() || {}
        const learned = Object.keys(this.manualTags || {}).length
        const profileWeight = learned >= 8 ? 0 : 1 - (learned / 8)
        if (profileWeight > 0) {
            for (const [tag, score] of Object.entries(profileTags)) {
                const weight = score * profileWeight
                if (weight > (manualTags[tag] || 0)) {
                    manualTags[tag] = weight
                }
            }
        }

        // Inject default tags with low score to ensure diversity even with few/zero
        // tags. They are deliberately absolute and small, and never replace a tag the
        // user or the profile already provided, so they can't drown the profile.
        // Tags from another profile's vocabulary are dropped though: they would drag
        // the recommendations away from the profile the user chose.
        const defaultTags = global.lists?.contentProfile?.filterDefaultTags?.(getDefaultTags(lang?.locale, limit)) || getDefaultTags(lang?.locale, limit)
        for (const [tag, score] of Object.entries(defaultTags)) {
            if (!(tag in manualTags)) {
                manualTags[tag] = score * 0.05
            }
        }

        const shouldIncludeAdditionalSources = !ignoreExternalTrends && Object.keys(manualTags).length < limit

        if (shouldIncludeAdditionalSources) {
            // External vocabulary comes straight from whatever the lists carry, so it
            // has to obey the same profile filter as the defaults: otherwise tags like
            // "espn", "filmes" or "doramas" drag the recommendations away from the
            // content profile the user chose.
            const filterTags = tags => global.lists?.contentProfile?.filterDefaultTags?.(tags) ?? tags
            const channelsTags = this.equalize(filterTags(this.caching.channels || {}), 0.1)
            const trendingTags = this.equalize(filterTags(this.caching.trending || {}), 0.2)
            const programmeTags = this.equalize(filterTags(this.caching.programmes || {}), 1)
            const allTags = this.equalize(this.mergeTags(channelsTags, this.mergeTags(programmeTags, trendingTags, 'sum'), 'sum'), 0.25)
            return this.equalize(this.prepare(this.mergeTags(manualTags, allTags, 'max'), limit))
        }
        return this.prepare(manualTags, limit)
    }
    mergeTags(tags1, tags2, mode = 'max') {
        const tags3 = {}
        
        // Validate inputs - use empty objects if null/undefined
        const validTags1 = (tags1 && typeof tags1 === 'object' && !Array.isArray(tags1)) ? tags1 : {}
        const validTags2 = (tags2 && typeof tags2 === 'object' && !Array.isArray(tags2)) ? tags2 : {}
        
        for (const [key, value] of Object.entries(validTags1)) {
            tags3[key] = value
        }
        for (const [key, value] of Object.entries(validTags2)) {
            if (mode === 'sum') {
                tags3[key] = (tags3[key] || 0) + value
            } else { // max mode
                tags3[key] = Math.max(tags3[key] || 0, value)
            }
        }
        return tags3
    }

    /**
     * Load expanded tags cache from storage
     */
    async loadCache() {
        try {
            const cacheData = await storage.get(this.cacheKey)
            if (cacheData && typeof cacheData === 'object') {
                const now = Date.now()
                
                // Load valid cache entries
                for (const [key, entry] of Object.entries(cacheData)) {
                    if (now - entry.timestamp < this.cacheTTL) {
                        this.expandedTagsCache.set(key, entry)
                    }
                }
                
                console.log(`📚 Loaded ${this.expandedTagsCache.size} cached expanded tags`)
            }
        } catch (error) {
            // Cache doesn't exist or is invalid - this is normal on first run
            if (error.message && !error.message.includes('not found')) {
                console.warn('Failed to load expanded tags cache:', error.message)
            }
        }
    }

    /**
     * Save expanded tags cache to storage
     */
    async saveCache() {
        try {
            const cacheData = {}
            for (const [key, entry] of this.expandedTagsCache.entries()) {
                cacheData[key] = entry
            }
            
            await storage.set(this.cacheKey, cacheData, { ttl: this.cacheTTLSeconds })
        } catch (error) {
            console.warn('Failed to save expanded tags cache:', error.message)
        }
    }

    /**
     * Generate cache key for tags and options
     */
    generateCacheKey(tags, options) {
        const entries = Object.entries(tags || {})
        const sortedTags = entries.length
            ? entries
                .map(([key, value]) => {
                    let formatted = '1.0000'
                    if (typeof value === 'number' && Number.isFinite(value)) {
                        formatted = Number(value).toFixed(4)
                    } else if (typeof value === 'boolean') {
                        formatted = value ? 'true' : 'false'
                    } else if (value != null) {
                        formatted = String(value)
                    } else {
                        formatted = 'null'
                    }
                    return `${key}:${formatted}`
                })
                .sort()
                .slice(0, 10)
                .join('|')
            : '__no_tags__'
        const optionsKey = `${options.threshold || 0.6}:${options.diversityBoost !== false}`
        return `${sortedTags}:${optionsKey}`
    }

    hasMeaningfulExpansion(baseTags, expandedTags) {
        if (!expandedTags || typeof expandedTags !== 'object') {
            return false
        }

        const baseMap = new Map()

        Object.entries(baseTags || {}).forEach(([key, value]) => {
            if (!key) {
                return
            }
            const lower = key.trim().toLowerCase()
            if (!lower) {
                return
            }

            let numeric = Number(value)
            if (!Number.isFinite(numeric)) {
                if (typeof value === 'boolean') {
                    numeric = value ? 1 : 0
                } else {
                    return
                }
            }

            if (numeric > 0) {
                baseMap.set(lower, numeric)
            }
        })

        for (const [key, value] of Object.entries(expandedTags)) {
            if (!key) {
                continue
            }

            const lower = key.trim().toLowerCase()
            if (!lower) {
                continue
            }

            const numeric = Number(value)
            if (!Number.isFinite(numeric) || numeric <= 0) {
                continue
            }

            const current = baseMap.get(lower)
            if (typeof current !== 'number' || numeric > current) {
                return true
            }
        }

        return false
    }

    /**
     * Get expanded tags from cache
     */
    getExpandedTagsFromCache(cacheKey) {
        const entry = this.expandedTagsCache.get(cacheKey)
        if (!entry) return null
        
        const now = Date.now()
        if (now - entry.timestamp > this.cacheTTL) {
            this.expandedTagsCache.delete(cacheKey)
            return null
        }
        
        return entry.expandedTags
    }

    /**
     * Cache expanded tags
     */
    cacheExpandedTags(cacheKey, expandedTags) {
        this.expandedTagsCache.set(cacheKey, {
            expandedTags,
            timestamp: Date.now()
        })
        
        // Save to storage periodically
        if (this.expandedTagsCache.size % 10 === 0) {
            this.saveCache().catch(err => console.warn('Failed to save cache:', err.message))
        }
    }


    applyExpandedTags(baseTags, expandedTags, additionalLimit) {
        const normalizedBase = {}
        let hasDifference = false

        const originalMap = new Map()

        Object.entries(baseTags).forEach(([key, value]) => {
            if (!key) return
            const lower = key.trim().toLowerCase()
            if (!lower) {
                return
            }
            let numeric = Number(value)
            if (!Number.isFinite(numeric)) {
                if (typeof value === 'boolean') {
                    numeric = value ? 1 : 0
                } else {
                    return
                }
            }
            normalizedBase[lower] = numeric
            originalMap.set(lower, numeric)
        })

        const additional = {}

        Object.entries(expandedTags).forEach(([key, value]) => {
            if (!key) return
            const lower = key.trim().toLowerCase()
            if (!lower) return
            const numeric = Number(value)
            if (!Number.isFinite(numeric)) return

            if (typeof normalizedBase[lower] === 'number') {
                if (numeric > normalizedBase[lower]) {
                    normalizedBase[lower] = numeric
                    hasDifference = true
                }
            } else if (additionalLimit > 0) {
                additional[lower] = numeric / 2
                hasDifference = true
            }
        })

        if (additionalLimit > 0 && Object.keys(additional).length) {
            const preparedAdditional = this.prepare(additional, additionalLimit)
            Object.assign(normalizedBase, preparedAdditional)
            if (Object.keys(preparedAdditional).length) {
                hasDifference = true
            }
        }

        Object.keys(baseTags).forEach(key => delete baseTags[key])
        Object.entries(normalizedBase).forEach(([key, value]) => {
            baseTags[key] = value
        })

        if (!hasDifference) {
            const normalizedKeys = Object.keys(normalizedBase)
            if (normalizedKeys.length !== originalMap.size) {
                hasDifference = true
            } else {
                hasDifference = normalizedKeys.some(key => !originalMap.has(key) || normalizedBase[key] !== originalMap.get(key))
            }
        }

        return { mergedTags: baseTags, hasNewInformation: hasDifference }
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        const now = Date.now()
        const validEntries = Array.from(this.expandedTagsCache.values())
            .filter(entry => now - entry.timestamp < this.cacheTTL)
        
        return {
            totalEntries: this.expandedTagsCache.size,
            validEntries: validEntries.length,
            cacheKey: this.cacheKey
        }
    }

    /**
     * Clear cache
     */
    async clearCache() {
        this.expandedTagsCache.clear()
        try {
            await storage.delete(this.cacheKey)
        } catch (error) {
            // Ignore errors if cache doesn't exist
        }
        console.log('🗑️ Expanded tags cache cleared')
    }

    /**
     * Schedule update after background expansion
     */
    scheduleUpdate() {
        // Emit event to notify that tags have been updated
        this.emit('tagsExpanded')
        
        // Also trigger a general update event
        setTimeout(() => {
            this.emit('updated')
            console.log('🔄 Tags updated - recommendations may be refreshed')
        }, 100) // Small delay to ensure cache is fully written
    }
}