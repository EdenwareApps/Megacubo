import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'
import { terms } from '../lists/tools.js'
import storage from '../storage/storage.js'
import config from '../config/config.js'
// Remove direct import to avoid circular dependency
// import smartRecommendations from './index.mjs'

export class Tags extends EventEmitter{
    constructor() {
        super()
        this.caching = {programmes: {}, trending: {}}
        this.defaultTagsCount = 128
        this.queue = new PQueue({concurrency: 1})
        this.manualTagsKey = 'interests'
        this.manualTags = {}
        
        // Smart cache for expanded tags
        this.expandedTagsCache = new Map()
        this.cacheTTL = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
        this.cacheTTLSeconds = 24 * 60 * 60 // 24 hours in seconds (for storage TTL)
        this.cacheKey = 'expanded-tags-cache'
        
        // Background expansion queue
        this.backgroundQueue = new PQueue({concurrency: 1})
        // Track pending/active background expansions to avoid duplicates
        this.pendingExpansions = new Set()
        
        // Load cache on startup
        this.loadCache()
        this.loadManualTags()
        
        global.channels.history.epg.on('change', () => this.historyUpdated(true))
        global.channels.trending.on('update', () => this.trendingUpdated(true))
        global.channels.on('loaded', () => this.reset())
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

        this.caching.programmes = await this.expand(data0);
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
        } else if (global.channels?.search?.searchSuggestionEntries) {
            try {
                searchPromise = global.channels.search.searchSuggestionEntries().then(data => this.searchSuggestionEntries = data).catch(err => {
                    console.error('Error getting search suggestions:', err.message)
                    return []
                })
            } catch (err) {
                console.error('Error calling searchSuggestionEntries:', err.message)
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

        if (Array.isArray(global.channels?.trending?.currentRawEntries)) {
            global.channels.trending.currentRawEntries.forEach(e => {
                if (!e) return
                try {
                    const entryTerms = global.channels.entryTerms?.(e)
                    if (Array.isArray(entryTerms)) {
                        addToMap(entryTerms, e.users || 1)
                    }
                } catch (err) {
                    // Ignore errors in entryTerms extraction
                }
            })
        }

        if (Array.isArray(this.searchSuggestionEntries)) {
            this.searchSuggestionEntries.forEach(e => {
                if (e && e.search_term && typeof e.search_term === 'string') {
                    addToMap([e.search_term], e.cnt || 1)
                }
            })
        }

        this.caching.trending = await this.expand(this.equalize(map));
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
    async expand(oTags, options = {}) {
        let additionalTags = {}, tags = Object.assign({}, oTags);            
        const limit = options.amount || this.defaultTagsCount
        const additionalLimit = limit - Object.keys(tags).length
        
        if (additionalLimit > 0) {
            // Try to get expanded tags from cache first
            const cacheKey = this.generateCacheKey(tags, options)
            const cachedExpansion = this.getExpandedTagsFromCache(cacheKey)
            
            if (cachedExpansion) {
                if (!this.hasMeaningfulExpansion(tags, cachedExpansion)) {
                    this.expandedTagsCache.delete(cacheKey)
                    this.saveCache().catch(err => console.warn('Failed to persist cache cleanup:', err?.message || err))
                } else {
                    // Use cached expanded tags immediately
                    Object.keys(cachedExpansion).forEach(category => {
                        const lowerCategory = category.toLowerCase()
                        if (!tags[lowerCategory]) {
                            additionalTags[lowerCategory] = cachedExpansion[category] / 2
                        }
                    })
                    additionalTags = this.prepare(additionalTags, additionalLimit)
                    Object.assign(tags, additionalTags)
                    
                    // Schedule background refresh for cache update
                    this.scheduleBackgroundExpansion(tags, options)
                    return tags
                }
            }
            
            // Attempt immediate expansion via AI client when cache is empty
            const immediateExpansion = await this.tryImmediateAiExpansion(tags, options, cacheKey, additionalLimit)
            if (immediateExpansion) {
                return immediateExpansion
            }

            // No cache available - return original tags immediately and update cache in background
            console.log('📚 Cache miss - using original tags, updating cache in background')
            this.scheduleBackgroundExpansion(tags, options)
        }
        return tags
    }
    async get(limit, ignoreExternalTrends = false) {
        if (typeof limit !== 'number') {
            limit = this.defaultTagsCount
        }
        // Ensure caching objects exist before using them
        let manualTags = {}
        const initialTags = this.equalize(this.manualTags || {}, 1)
        if (Object.keys(initialTags).length) {
            let expandedTags = await this.expand(initialTags, { amount: limit }).catch(err => console.warn('Failed to expand manual tags:', err?.message || err))
            if (expandedTags && typeof expandedTags === 'object' && !Array.isArray(expandedTags)) {
                expandedTags = this.equalize(expandedTags, 0.75)
                for (const [key, value] of Object.entries(expandedTags)) {
                    manualTags[key] = Math.max(manualTags[key] || 0, value)
                }
            }
        }
        for (const [key, value] of Object.entries(initialTags)) {
            manualTags[key] = Math.max(manualTags[key] || 0, value)
        }
        manualTags = this.equalize(manualTags, 1)

        const shouldIncludeAdditionalSources = !ignoreExternalTrends && Object.keys(manualTags).length < limit

        if (shouldIncludeAdditionalSources) {
            const channelsTags = this.equalize(this.caching.channels || {}, 0.1)
            const trendingTags = this.equalize(this.caching.trending || {}, 0.2)
            const programmeTags = this.equalize(this.caching.programmes || {}, 1)
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

    async tryImmediateAiExpansion(tags, options, cacheKey, additionalLimit) {
        try {
            const { default: smartRecommendations } = await import('./index.mjs')
            const aiClient = smartRecommendations?.aiClient
            if (!aiClient) {
                return null
            }

            if (!aiClient.initialized) {
                await aiClient.initialize().catch(err => console.warn('AI client init failed:', err?.message || err))
            }

            if (!aiClient.enabled) {
                return null
            }

            const locale = options.locale || global?.lang?.locale || 'pt'

            const response = await aiClient.expandTags(tags, {
                limit: options.amount || this.defaultTagsCount,
                threshold: options.threshold || 0.6,
                locale,
                diversityBoost: options.diversityBoost !== false
            })

            if (!response || response.fallback || !response.expandedTags || !Object.keys(response.expandedTags).length) {
                return null
            }

            const { mergedTags, hasNewInformation } = this.applyExpandedTags(tags, response.expandedTags, additionalLimit)

            if (!hasNewInformation) {
                return null
            }

            this.cacheExpandedTags(cacheKey, response.expandedTags)
            await this.saveCache()

            console.log('✨ Immediate AI tag expansion completed')
            return mergedTags
        } catch (error) {
            console.warn('Immediate tag expansion failed:', error.message)
            return null
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
     * Schedule background expansion for future use
     */
    scheduleBackgroundExpansion(tags, options) {
        const cacheKey = this.generateCacheKey(tags, options)
        
        // Skip if already pending or in progress for the same cache key
        if (this.pendingExpansions.has(cacheKey)) {
            return // Already scheduled or in progress
        }
        
        // Skip if already cached (unless it's old)
        const existingCache = this.getExpandedTagsFromCache(cacheKey)
        if (existingCache && this.hasMeaningfulExpansion(tags, existingCache)) {
            return // Already cached and valid
        }
        
        // Mark as pending
        this.pendingExpansions.add(cacheKey)
        
        // Schedule background expansion
        this.backgroundQueue.add(async () => {
            try {
                // Double-check cache after queue wait (might have been cached by another request)
                const existingCacheAfterWait = this.getExpandedTagsFromCache(cacheKey)
                if (existingCacheAfterWait && this.hasMeaningfulExpansion(tags, existingCacheAfterWait)) {
                    this.pendingExpansions.delete(cacheKey)
                    return
                }

                if (existingCacheAfterWait) {
                    this.expandedTagsCache.delete(cacheKey)
                }

                console.log('🔄 Starting background tag expansion...')
                
                // Use dynamic import to avoid circular dependency
                const { default: smartRecommendations } = await import('./index.mjs')
                const mergedTags = await smartRecommendations.expandUserTags(tags, {
                    maxExpansions: options.amount || this.defaultTagsCount,
                    similarityThreshold: options.threshold || 0.6,
                    diversityBoost: options.diversityBoost !== false
                })
                
                // Validate merged tags structure
                if (!mergedTags || typeof mergedTags !== 'object' || Array.isArray(mergedTags)) {
                    console.log('ℹ️ Background expansion returned invalid data structure')
                    return
                }
                
                // Check if expansion actually produced new meaningful tags
                // expandUserTags returns merged tags (original + expanded), so we check if it's meaningful
                const isMeaningful = this.hasMeaningfulExpansion(tags, mergedTags)
                
                if (!isMeaningful) {
                    // No meaningful expansion - likely returned original tags only or no new tags
                    console.log('ℹ️ Background expansion returned no meaningful new tags')
                    return
                }
                
                // Extract only the new expanded tags (not in original tags) for caching
                // This ensures we only cache the new tags, not the merged result
                const expandedTags = {}
                const baseTagsLower = new Map()
                
                // Build normalized base tags map
                Object.entries(tags || {}).forEach(([key, value]) => {
                    if (key && typeof key === 'string') {
                        const lower = key.trim().toLowerCase()
                        if (lower) {
                            const numValue = Number(value)
                            if (Number.isFinite(numValue) && numValue > 0) {
                                baseTagsLower.set(lower, numValue)
                            }
                        }
                    }
                })
                
                // Extract new tags from merged result
                Object.entries(mergedTags).forEach(([key, value]) => {
                    if (!key || typeof key !== 'string') return
                    
                    const lower = key.trim().toLowerCase()
                    if (!lower) return
                    
                    const numValue = Number(value)
                    if (!Number.isFinite(numValue) || numValue <= 0) return
                    
                    const baseValue = baseTagsLower.get(lower)
                    
                    // Include if it's a new tag (not in base) or has a significantly higher value
                    // Use a small threshold to account for floating point precision
                    if (typeof baseValue !== 'number') {
                        // New tag - include it
                        expandedTags[key] = numValue
                    } else if (numValue > baseValue * 1.01) {
                        // Value is at least 1% higher - include it
                        expandedTags[key] = numValue
                    }
                })
                
                // Validate extracted tags
                if (Object.keys(expandedTags).length === 0) {
                    console.log('ℹ️ Background expansion produced no extractable new tags')
                    return
                }
                
                // Cache the extracted new tags
                this.cacheExpandedTags(cacheKey, expandedTags)
                await this.saveCache()
                console.log(`✅ Background tag expansion completed and cached (${Object.keys(expandedTags).length} new tags)`)
                
                // Schedule update after successful expansion
                this.scheduleUpdate()
            } catch (error) {
                console.warn('Background tag expansion failed:', error.message)
            } finally {
                // Always remove from pending set when done (success or failure)
                this.pendingExpansions.delete(cacheKey)
            }
        })
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