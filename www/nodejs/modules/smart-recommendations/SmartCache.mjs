import { EventEmitter } from 'node:events'
import { EPGErrorHandler } from '../epg-worker/EPGErrorHandler.js'

/**
 * Smart Cache System
 * Intelligent caching with LRU, priority, and TTL support
 */
export class SmartCache extends EventEmitter {
    constructor(options = {}) {
        super()
        this.cache = new Map()
        this.metadata = new Map()
        this.maxSize = options.maxSize || 1000
        this.defaultTTL = options.defaultTTL || 300000 // 5 minutes
        this.cleanupInterval = options.cleanupInterval || 60000 // 1 minute
        this.cleanupTimer = null
        this.startCleanupTimer()
    }

    /**
     * Set cache entry with metadata
     * @param {string} key - Cache key
     * @param {*} value - Cache value
     * @param {Array} tags - Cache tags for invalidation
     * @param {number} priority - Priority (1-5, higher is more important)
     * @param {number} ttl - Time to live in milliseconds
     */
    set(key, value, tags = [], priority = 1, ttl = null) {
        // Implement LRU with priority
        if (this.cache.size >= this.maxSize) {
            this.evictLeastImportant()
        }
        
        this.cache.set(key, value)
        this.metadata.set(key, {
            timestamp: Date.now(),
            tags: new Set(tags),
            priority,
            ttl: ttl || this.defaultTTL,
            accessCount: 0,
            lastAccessed: Date.now()
        })

        this.emit('cacheSet', { key, tags, priority })
    }

    /**
     * Get cache entry
     * @param {string} key - Cache key
     * @returns {*} Cached value or null
     */
    get(key) {
        const metadata = this.metadata.get(key)
        if (!metadata) return null
        
        // Check TTL
        if (Date.now() - metadata.timestamp > metadata.ttl) {
            this.delete(key)
            return null
        }
        
        // Update access statistics
        metadata.accessCount++
        metadata.lastAccessed = Date.now()
        
        return this.cache.get(key)
    }

    /**
     * Check if key exists in cache
     * @param {string} key - Cache key
     * @returns {boolean} Key exists
     */
    has(key) {
        const metadata = this.metadata.get(key)
        if (!metadata) return false
        
        // Check TTL
        if (Date.now() - metadata.timestamp > metadata.ttl) {
            this.delete(key)
            return false
        }
        
        return true
    }

    /**
     * Delete cache entry
     * @param {string} key - Cache key
     * @returns {boolean} Success
     */
    delete(key) {
        const deleted = this.cache.delete(key)
        this.metadata.delete(key)
        
        if (deleted) {
            this.emit('cacheDeleted', { key })
        }
        
        return deleted
    }

    /**
     * Clear all cache entries
     */
    clear() {
        this.cache.clear()
        this.metadata.clear()
        this.emit('cacheCleared')
    }

    /**
     * Invalidate cache entries by tags
     * @param {Array} tags - Tags to invalidate
     * @returns {number} Number of entries invalidated
     */
    invalidateByTags(tags) {
        let invalidated = 0
        
        for (const [key, metadata] of this.metadata.entries()) {
            const hasMatchingTag = tags.some(tag => metadata.tags.has(tag))
            if (hasMatchingTag) {
                this.delete(key)
                invalidated++
            }
        }
        
        this.emit('cacheInvalidated', { tags, count: invalidated })
        return invalidated
    }

    /**
     * Invalidate cache entries by user
     * @param {string} userId - User identifier
     * @returns {number} Number of entries invalidated
     */
    invalidateByUser(userId) {
        return this.invalidateByTags([`user:${userId}`])
    }

    /**
     * Evict least important entries
     */
    evictLeastImportant() {
        let leastImportant = null
        let lowestScore = Infinity
        
        for (const [key, meta] of this.metadata.entries()) {
            const score = this.calculateImportanceScore(meta)
            if (score < lowestScore) {
                lowestScore = score
                leastImportant = key
            }
        }
        
        if (leastImportant) {
            this.delete(leastImportant)
        }
    }

    /**
     * Calculate importance score for cache entry
     * @param {Object} metadata - Entry metadata
     * @returns {number} Importance score
     */
    calculateImportanceScore(metadata) {
        const now = Date.now()
        const age = now - metadata.timestamp
        const recency = Math.max(0, 1 - (age / metadata.ttl))
        const frequency = Math.log(1 + metadata.accessCount)
        const priority = metadata.priority / 5 // Normalize to 0-1
        
        return (recency * 0.4) + (frequency * 0.4) + (priority * 0.2)
    }

    /**
     * Start cleanup timer for expired entries
     */
    startCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
        }
        
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpired()
        }, this.cleanupInterval)
    }

    /**
     * Stop cleanup timer
     */
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer)
            this.cleanupTimer = null
        }
    }

    /**
     * Clean up expired entries
     * @returns {number} Number of entries cleaned
     */
    cleanupExpired() {
        const now = Date.now()
        let cleaned = 0
        
        for (const [key, metadata] of this.metadata.entries()) {
            if (now - metadata.timestamp > metadata.ttl) {
                this.delete(key)
                cleaned++
            }
        }
        
        if (cleaned > 0) {
            this.emit('cacheCleaned', { count: cleaned })
        }
        
        return cleaned
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getStats() {
        const now = Date.now()
        const entries = Array.from(this.metadata.values())
        const validEntries = entries.filter(e => now - e.timestamp < e.ttl)
        
        const totalAccesses = entries.reduce((sum, e) => sum + e.accessCount, 0)
        const averageAccesses = entries.length > 0 ? totalAccesses / entries.length : 0
        
        return {
            totalEntries: this.cache.size,
            validEntries: validEntries.length,
            hitRate: validEntries.length / this.cache.size || 0,
            totalAccesses,
            averageAccesses,
            memoryUsage: this.estimateMemoryUsage()
        }
    }

    /**
     * Estimate memory usage of cache
     * @returns {number} Estimated memory usage in bytes
     */
    estimateMemoryUsage() {
        let totalSize = 0
        
        for (const [key, value] of this.cache.entries()) {
            totalSize += this.estimateSize(key)
            totalSize += this.estimateSize(value)
        }
        
        for (const [key, metadata] of this.metadata.entries()) {
            totalSize += this.estimateSize(key)
            totalSize += this.estimateSize(metadata)
        }
        
        return totalSize
    }

    /**
     * Estimate size of an object in bytes
     * @param {*} obj - Object to estimate
     * @returns {number} Estimated size in bytes
     */
    estimateSize(obj) {
        if (obj === null || obj === undefined) return 0
        
        if (typeof obj === 'string') return obj.length * 2
        if (typeof obj === 'number') return 8
        if (typeof obj === 'boolean') return 4
        
        if (Array.isArray(obj)) {
            return obj.reduce((sum, item) => sum + this.estimateSize(item), 0)
        }
        
        if (typeof obj === 'object') {
            return Object.keys(obj).reduce((sum, key) => {
                return sum + this.estimateSize(key) + this.estimateSize(obj[key])
            }, 0)
        }
        
        return 0
    }

    /**
     * Get cache entries by pattern
     * @param {string} pattern - Key pattern (supports wildcards)
     * @returns {Array} Matching entries
     */
    getByPattern(pattern) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'))
        const matches = []
        
        for (const [key, value] of this.cache.entries()) {
            if (regex.test(key)) {
                matches.push({ key, value, metadata: this.metadata.get(key) })
            }
        }
        
        return matches
    }

    /**
     * Destroy cache and cleanup
     */
    destroy() {
        this.stopCleanupTimer()
        this.clear()
        this.removeAllListeners()
    }
}
