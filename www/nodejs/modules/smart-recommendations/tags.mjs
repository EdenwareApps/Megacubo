import { EventEmitter } from 'node:events'
import PQueue from 'p-queue'
import fs from 'fs'
import path from 'path'
import { terms } from '../lists/tools.js'
// Remove direct import to avoid circular dependency
// import smartRecommendations from './index.mjs'

export class Tags extends EventEmitter{
    constructor() {
        super()
        this.caching = {programmes: {}, trending: {}}
        this.defaultTagsCount = 256
        this.queue = new PQueue({concurrency: 1})
        
        // Smart cache for expanded tags
        this.expandedTagsCache = new Map()
        this.cacheTTL = 24 * 60 * 60 * 1000 // 24 hours
        this.cacheFile = path.join(process.cwd(), 'db', 'expanded-tags-cache.json')
        
        // Background expansion queue
        this.backgroundQueue = new PQueue({concurrency: 1})
        
        // Load cache on startup
        this.loadCache()
        
        global.channels.history.epg.on('change', () => this.historyUpdated(true))
        global.channels.trending.on('update', () => this.trendingUpdated(true))
        global.channels.on('loaded', () => this.reset())
    }
    async reset() {
        if(this.queue.size) {
            return this.queue.onIdle()
        }
        return this.queue.add(async () => {
            await this.historyUpdated(false)
            await this.trendingUpdated(true)
        })
    }
    // Helper method to check if a tag is valid
    isValidTag(tag) {
        // Skip URLs
        if (tag.includes('://') || tag.includes('www.')) {
            return false
        }
        
        // Skip very short terms
        if (tag.length < 2) {
            return false
        }
        
        // Skip terms that are too long
        if (tag.length > 50) {
            return false
        }
        
        // Skip terms with too many words
        if (tag.split(' ').length > 3) {
            return false
        }
        
        // Skip terms that look like file extensions or technical terms
        if (tag.match(/\.(com|org|net)$/i)) {
            return false
        }
        
        return true
    }

    prepare(data, limit) {
        const maxWords = 3
        
        // Filter out invalid tags that don't match EPG categories AND invalid values
        const filteredData = Object.fromEntries(
            Object.entries(data)
                .filter(([key, value]) => 
                    this.isValidTag(key) && 
                    value != null && 
                    !isNaN(value) && 
                    typeof value === 'number'
                )
        )
        
        return Object.fromEntries(
            Object.entries(filteredData)
                .sort(([, valueA], [, valueB]) => valueB - valueA) 
                .slice(0, limit)
        )
    }    
    async historyUpdated(emit) {
        let data0 = {}, data = {}
        const historyData = global.channels.history.epg.data.slice(-6);

        historyData.forEach(row => {
            const name = row.originalName || row.name;
            const category = global.channels.getChannelCategory(name);
            if (category) {
                const lcCategory = category.toLowerCase();
                data[lcCategory] = (data[lcCategory] || 0) + row.watched.time;
            }

            const cs = row.watched?.categories || [];
            if (category && !cs.includes(category)) {
                cs.push(category);
            }
            if (row.groupName && !cs.includes(row.groupName)) {
                cs.push(row.groupName);
            }            
            if(row?.watched?.name) {
                const tms = terms(row.watched.name, true, false)
                // Filter out invalid terms before adding to categories
                const validTerms = tms.filter(t => this.isValidTag(t))
                cs.push(...validTerms)
            }
            cs.forEach(cat => {
                if (cat) {
                    const lc = cat.toLowerCase();
                    data0[lc] = (data0[lc] || 0) + (row.watched ? row.watched.time : 180);
                }
            });
        });

        data = this.equalize(data)
        data0 = this.equalize(data0)        
        for (const k in data) {
            data0[k] = Math.max(data0[k] || 0, data[k]);
        }

        this.caching.programmes = await this.expand(data0);
        emit && this.emit('updated');
    }
    async trendingUpdated(emit) {
        let trendingPromise = true;
        if (!global.channels.trending.currentRawEntries) {
            trendingPromise = global.channels.trending.getRawEntries();
        }
        let searchPromise = this.searchSuggestionEntries || global.channels.search.searchSuggestionEntries().then(data => this.searchSuggestionEntries = data);
        await Promise.allSettled([trendingPromise, searchPromise]).catch(err => console.error(err));

        const map = {};
        const addToMap = (tms, value) => {
            tms.forEach(t => {
                // Skip terms that start with dash (already filtered)
                if (t.startsWith('-')) return;
                
                // Use the reusable validation method
                if (this.isValidTag(t)) {
                    map[t] = (map[t] || 0) + value;
                }
            });
        };

        if (Array.isArray(global.channels.trending.currentRawEntries)) {
            global.channels.trending.currentRawEntries.forEach(e => addToMap(global.channels.entryTerms(e), e.users));
        }

        if (Array.isArray(this.searchSuggestionEntries)) {
            this.searchSuggestionEntries.forEach(e => addToMap([e.search_term], e.cnt));
        }

        this.caching.trending = await this.expand(this.equalize(map));
        emit && this.emit('updated');
    }
    equalize(tags) {
        // Filter out invalid values (null, undefined, NaN) before calculating max
        const validValues = Object.values(tags).filter(v => v != null && !isNaN(v) && typeof v === 'number')
        
        if (validValues.length === 0) {
            // If no valid values, return empty object
            return {}
        }
        
        const max = Math.max(...validValues)
        
        return Object.fromEntries(
            Object.entries(tags)
                .filter(([, value]) => value != null && !isNaN(value) && typeof value === 'number')
                .sort(([, valueA], [, valueB]) => valueB - valueA)
                .map(([key, value]) => [key, value / max])
        )
    }
    async expand(tags, options = {}) {
        let additionalTags = {}            
        const limit = options.amount || this.defaultTagsCount
        const additionalLimit = limit - Object.keys(tags).length
        
        if (additionalLimit > 0) {
            // Try to get expanded tags from cache first
            const cacheKey = this.generateCacheKey(tags, options)
            const cachedExpansion = this.getExpandedTagsFromCache(cacheKey)
            
            if (cachedExpansion) {
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
            
            // No cache available - return original tags immediately and update cache in background
            console.log('📚 Cache miss - using original tags, updating cache in background')
            this.scheduleBackgroundExpansion(tags, options)
        }
        return tags
    }
    async get(limit) {
        if(typeof(limit) != 'number') {
            limit = this.defaultTagsCount
        }
        const programmeTags = this.prepare(this.caching.programmes, limit)
        if (Object.keys(programmeTags).length < limit) {
            Object.assign(programmeTags, this.caching.trending)
        }
        return this.prepare(programmeTags, limit)
    }

    /**
     * Load expanded tags cache from disk
     */
    loadCache() {
        try {
            if (fs.existsSync(this.cacheFile)) {
                const cacheData = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))
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
            console.warn('Failed to load expanded tags cache:', error.message)
        }
    }

    /**
     * Save expanded tags cache to disk
     */
    saveCache() {
        try {
            const cacheData = {}
            for (const [key, entry] of this.expandedTagsCache.entries()) {
                cacheData[key] = entry
            }
            
            fs.writeFileSync(this.cacheFile, JSON.stringify(cacheData, null, 2))
        } catch (error) {
            console.warn('Failed to save expanded tags cache:', error.message)
        }
    }

    /**
     * Generate cache key for tags and options
     */
    generateCacheKey(tags, options) {
        const sortedTags = Object.keys(tags)
            .sort()
            .slice(0, 10)
            .join(',')
        const optionsKey = `${options.threshold || 0.6}:${options.diversityBoost !== false}`
        return `${sortedTags}:${optionsKey}`
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
        
        // Save to disk periodically
        if (this.expandedTagsCache.size % 10 === 0) {
            this.saveCache()
        }
    }

    /**
     * Schedule background expansion for future use
     */
    scheduleBackgroundExpansion(tags, options) {
        // Always schedule background expansion, even if one is running
        // This ensures cache gets updated for future requests
        this.backgroundQueue.add(async () => {
            try {
                const cacheKey = this.generateCacheKey(tags, options)
                
                // Skip if already cached (unless it's old)
                const existingCache = this.getExpandedTagsFromCache(cacheKey)
                if (existingCache) {
                    console.log('📚 Cache already exists, skipping background expansion')
                    return
                }
                
                console.log('🔄 Starting background tag expansion...')
                
                // Use dynamic import to avoid circular dependency
                const { default: smartRecommendations } = await import('./index.mjs')
                const expandedTags = await smartRecommendations.expandUserTags(tags, {
                    maxExpansions: options.amount || this.defaultTagsCount,
                    similarityThreshold: options.threshold || 0.6,
                    diversityBoost: options.diversityBoost !== false
                })
                
                if (expandedTags && typeof expandedTags === 'object') {
                    this.cacheExpandedTags(cacheKey, expandedTags)
                    this.saveCache()
                    console.log('✅ Background tag expansion completed and cached')
                    
                    // Schedule update after successful expansion
                    this.scheduleUpdate()
                } else {
                    console.warn('⚠️ Background expansion returned invalid data')
                }
            } catch (error) {
                console.warn('Background tag expansion failed:', error.message)
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
            cacheFile: this.cacheFile
        }
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.expandedTagsCache.clear()
        if (fs.existsSync(this.cacheFile)) {
            fs.unlinkSync(this.cacheFile)
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