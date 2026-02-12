/**
 * AI-Powered Tag Expansion
 * Replaces Trias-based SmartTagExpansion with AI Client
 */

import { EventEmitter } from 'node:events';
import { ErrorHandler } from './ErrorHandler.mjs';
import storage from '../storage/storage.js';

/**
 * Local Tags Cache
 * Cache expanded tags locally, invalidated only on history additions (not updates)
 */
export class TagsCache {
    constructor() {
        this.cache = new Map();
        this.cacheKey = 'ai-tags-cache';
        this.maxCacheSize = 100;
        this.lastHistoryLength = 0;

        // Load cached data
        this.loadFromStorage();

        // Monitor history changes - only invalidate on new additions, not updates
        if (global?.channels?.history) {
            global.channels.history.on('change', (data) => {
                this.checkHistoryChanges(data);
            });
        }
    }

    /**
     * Load cache from persistent storage
     */
    loadFromStorage() {
        try {
            const stored = storage.get(this.cacheKey);
            if (stored && typeof stored === 'object') {
                // Restore cache entries with timestamps
                Object.entries(stored).forEach(([key, entry]) => {
                    if (entry && entry.timestamp && entry.data) {
                        this.cache.set(key, entry);
                    }
                });
                ErrorHandler.info(`TagsCache: Loaded ${this.cache.size} cached entries`);
            }
        } catch (err) {
            ErrorHandler.warn('TagsCache: Failed to load from storage:', err.message);
        }
    }

    /**
     * Save cache to persistent storage
     */
    saveToStorage() {
        try {
            const data = {};
            for (const [key, entry] of this.cache.entries()) {
                data[key] = entry;
            }
            storage.set(this.cacheKey, data);
        } catch (err) {
            ErrorHandler.warn('TagsCache: Failed to save to storage:', err.message);
        }
    }

    /**
     * Check if history changed by new additions (not updates)
     * @param {Array} currentHistoryData - Current history data
     */
    checkHistoryChanges(currentHistoryData) {
        if (!Array.isArray(currentHistoryData)) return;

        const currentLength = currentHistoryData.length;

        // Only invalidate if history grew (new additions)
        if (currentLength > this.lastHistoryLength) {
            ErrorHandler.info(`TagsCache: History grew from ${this.lastHistoryLength} to ${currentLength} entries, clearing cache`);
            this.clear();
            this.lastHistoryLength = currentLength;
        } else if (currentLength < this.lastHistoryLength) {
            // History was reset/cleared
            this.lastHistoryLength = currentLength;
        }
        // Ignore if length stayed the same (only updates, not additions)
    }

    /**
     * Generate cache key from user tags
     * @param {Object} userTags - User tags object
     * @param {string} locale - Locale
     * @returns {string} Cache key
     */
    generateKey(userTags, locale = 'pt') {
        // Sort tags by key for consistent hashing
        const sortedTags = Object.keys(userTags).sort().join(',');
        return `${locale}:${sortedTags}`;
    }

    /**
     * Get cached entry if valid
     * @param {string} key - Cache key
     * @returns {Object|null} Cached data or null
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if entry is still valid (not expired)
        const now = Date.now();
        if (now - entry.timestamp > 24 * 60 * 60 * 1000) { // 24 hours TTL
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Set cache entry
     * @param {string} key - Cache key
     * @param {Object} data - Data to cache
     */
    set(key, data) {
        // Clean old entries if cache is full
        if (this.cache.size >= this.maxCacheSize) {
            const oldestKey = this.cache.keys().next().value;
            this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });

        // Save to storage periodically (every 10 operations)
        if (Math.random() < 0.1) {
            this.saveToStorage();
        }
    }

    /**
     * Clear all cached data
     */
    clear() {
        this.cache.clear();
        storage.set(this.cacheKey, {});
        ErrorHandler.info('TagsCache: Cache cleared');
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            size: this.cache.size,
            maxSize: this.maxCacheSize,
            lastHistoryLength: this.lastHistoryLength
        };
    }
}

export class AITagExpansion extends EventEmitter {
    constructor(aiClient) {
        super();
        this.aiClient = aiClient;
        this.expansionCache = new Map();
        this.cacheTTL = 300000; // 5 minutes
        this.maxCacheSize = 500;

        // Local tags cache that survives AI client cache invalidation
        this.tagsCache = new TagsCache();
    }

    /**
     * Expand user tags using AI semantic analysis
     * @param {Object} userTags - User tags with scores
     * @param {Object} options - Expansion options
     * @returns {Promise<Object>} Expanded tags
     */
    async expandUserTags(userTags, options = {}) {
        const {
            maxExpansions = 20,
            similarityThreshold = 0.6,
            diversityBoost = true,
            locale = 'pt'
        } = options;

        // First check local tags cache (persistent, invalidated only on history additions)
        const tagsCacheKey = this.tagsCache.generateKey(userTags, locale);
        const cachedTags = this.tagsCache.get(tagsCacheKey);

        if (cachedTags) {
            ErrorHandler.debug('TagsCache: Using cached expanded tags');
            return cachedTags;
        }

        // Fallback to expansion cache (short-term memory cache)
        const cacheKey = this.generateCacheKey(userTags, options);
        const cached = this.expansionCache.get(cacheKey);

        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
            return cached.expandedTags;
        }

        try {
            // Count total user tags
            const totalUserTags = Object.keys(userTags).length;

            // Check if we have enough tags already (32+)
            if (totalUserTags >= 32) {
                // Already have enough tags, return as-is without expansion
                // Still cache this result for future use
                this.tagsCache.set(tagsCacheKey, userTags);
                return userTags;
            }

            // Get top user interests (limit based on how many we need)
            const tagsNeeded = 32 - totalUserTags;
            const topInterests = this.getTopInterests(userTags, Math.min(10, tagsNeeded));

            if (topInterests.length === 0) {
                // No user tags available, use default tags for current locale
                const defaultTags = this.getDefaultTagsForLocale(locale);
                const result = { ...userTags, ...defaultTags };
                // Cache this result for future use
                this.tagsCache.set(tagsCacheKey, result);
                return result;
            }

            // Convert to object format for AI client
            const tagsObj = {};
            topInterests.forEach(tag => {
                tagsObj[tag] = userTags[tag] || 1.0;
            });

            // Use AI to find semantically related tags
            const response = await this.aiClient.expandTags(tagsObj, {
                limit: Math.min(maxExpansions, tagsNeeded),
                threshold: similarityThreshold,
                locale
            });

            const expandedTags = response.expandedTags || {};

            // Apply diversity boost to avoid over-concentration
            const finalTags = diversityBoost
                ? this.applyDiversityBoost(expandedTags, userTags)
                : expandedTags;

            // Merge with original tags
            const mergedTags = this.mergeTags(userTags, finalTags);

            // Cache the results in both caches
            this.expansionCache.set(cacheKey, {
                expandedTags: mergedTags,
                timestamp: Date.now()
            });

            // Also save to local tags cache (persistent)
            this.tagsCache.set(tagsCacheKey, mergedTags);

            // Clean cache if needed
            this.cleanCache();

            return mergedTags;

        } catch (error) {
            ErrorHandler.warn('Tag expansion failed:', error.message);
            return userTags; // Return original tags as fallback
        }
    }

    /**
     * Get top interests from user tags
     * @param {Object} userTags - User tags
     * @param {number} limit - Maximum tags to return
     * @returns {Array} Top interest tags
     */
    getTopInterests(userTags, limit = 5) {
        return Object.entries(userTags)
            .filter(([tag, score]) => typeof score === 'number' && score > 0.3)
            .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
            .slice(0, limit)
            .map(([tag]) => tag);
    }

    /**
     * Apply diversity boost to prevent tag concentration
     * @param {Object} expandedTags - Expanded tags
     * @param {Object} originalTags - Original user tags
     * @returns {Object} Diversified tags
     */
    applyDiversityBoost(expandedTags, originalTags) {
        const result = {};
        
        // Reduce scores for tags too similar to original
        for (const [tag, score] of Object.entries(expandedTags)) {
            if (originalTags[tag]) {
                // Already in original, boost slightly
                result[tag] = Math.min(score * 1.1, 1.0);
            } else {
                // New tag, keep as is
                result[tag] = score;
            }
        }
        
        return result;
    }

    /**
     * Merge original and expanded tags
     * @param {Object} originalTags - Original tags
     * @param {Object} expandedTags - Expanded tags
     * @returns {Object} Merged tags
     */
    mergeTags(originalTags, expandedTags) {
        const merged = { ...originalTags };
        
        for (const [tag, score] of Object.entries(expandedTags)) {
            if (!merged[tag]) {
                // New tag, add with reduced weight
                merged[tag] = score * 0.7;
            } else {
                // Existing tag, boost slightly
                merged[tag] = Math.max(merged[tag], score);
            }
        }
        
        return merged;
    }

    /**
     * Get default tags for a locale when user has no tags
     * @param {string} locale - Locale code (e.g., 'pt', 'en', 'es')
     * @returns {Object} Default tags with scores
     */
    getDefaultTagsForLocale(locale) {
        const defaultTagSets = {
            'pt': {
                'série': 1.0,
                'filme': 0.9,
                'notícias': 0.8,
                'esporte': 0.7,
                'entretenimento': 0.6,
                'documentário': 0.5,
                'infantil': 0.4,
                'comédia': 0.3,
                'drama': 0.3,
                'ação': 0.3
            },
            'en': {
                'series': 1.0,
                'movie': 0.9,
                'news': 0.8,
                'sports': 0.7,
                'entertainment': 0.6,
                'documentary': 0.5,
                'kids': 0.4,
                'comedy': 0.3,
                'drama': 0.3,
                'action': 0.3
            },
            'es': {
                'serie': 1.0,
                'película': 0.9,
                'noticias': 0.8,
                'deportes': 0.7,
                'entretenimiento': 0.6,
                'documental': 0.5,
                'infantil': 0.4,
                'comedia': 0.3,
                'drama': 0.3,
                'acción': 0.3
            }
        };

        // Return default tags for the locale, or Portuguese as fallback
        return defaultTagSets[locale] || defaultTagSets['pt'];
    }

    /**
     * Generate cache key
     * @param {Object} userTags - User tags
     * @param {Object} options - Options
     * @returns {string} Cache key
     */
    generateCacheKey(userTags, options) {
        const sortedTags = Object.keys(userTags).sort().slice(0, 10).join(',');
        return `${sortedTags}:${options.maxExpansions || 20}:${options.locale || 'pt'}`;
    }

    /**
     * Clean cache
     */
    cleanCache() {
        if (this.expansionCache.size > this.maxCacheSize) {
            const now = Date.now();
            const entries = Array.from(this.expansionCache.entries());
            
            // Remove oldest entries
            entries
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, Math.floor(this.maxCacheSize * 0.2))
                .forEach(([key]) => this.expansionCache.delete(key));
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        const now = Date.now();
        const entries = Array.from(this.expansionCache.values());
        const validEntries = entries.filter(e => now - e.timestamp < this.cacheTTL);
        
        return {
            totalEntries: this.expansionCache.size,
            validEntries: validEntries.length,
            hitRate: validEntries.length / this.expansionCache.size || 0,
            aiClient: this.aiClient.getStats()
        };
    }
}

