/**
 * AI Client Cache
 * Local cache for AI responses with storage persistence
 */

import storage from '../../storage/storage.js';
import { EPGErrorHandler } from '../../epg/worker/EPGErrorHandler.js';

export class AICache {
    constructor(options = {}) {
        this.storagePrefix = 'ai-cache';
        this.memoryCache = new Map();
        this.maxMemoryItems = options.maxMemoryItems || 500;
        this.maxMemorySize = options.maxMemorySize || 10 * 1024 * 1024; // 10MB
        this.currentMemorySize = 0;
        
        // TTL by cache type
        this.ttlByType = {
            'analyze': 24 * 60 * 60 * 1000, // 24h
            'expand': 60 * 60 * 1000, // 1h
            'cluster': 12 * 60 * 60 * 1000, // 12h
            'embedding': Infinity // Permanent
        };
        
        this.stats = {
            hits: 0,
            misses: 0,
            storageReads: 0,
            storageWrites: 0
        };
    }

    /**
     * Generate cache key
     */
    generateKey(type, data) {
        const normalized = this.normalizeData(data);
        const str = JSON.stringify(normalized);
        const hash = this.simpleHash(str);
        return `${this.storagePrefix}:${type}:${hash}`;
    }

    /**
     * Normalize data for consistent hashing
     */
    normalizeData(data) {
        if (typeof data === 'string') {
            return data.toLowerCase().trim();
        }
        if (Array.isArray(data)) {
            return data.map(d => this.normalizeData(d)).sort();
        }
        if (typeof data === 'object' && data !== null) {
            const sorted = {};
            Object.keys(data).sort().forEach(key => {
                sorted[key] = this.normalizeData(data[key]);
            });
            return sorted;
        }
        return data;
    }

    /**
     * Simple hash function
     */
    simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Get from cache
     */
    async get(key) {
        // Check memory cache first
        const memCached = this.memoryCache.get(key);
        if (memCached && this.isValid(memCached)) {
            this.stats.hits++;
            return memCached.value;
        }

        // Check storage cache
        try {
            const storageCached = await storage.get(key);
            if (storageCached && this.isValid(storageCached)) {
                this.stats.hits++;
                this.stats.storageReads++;
                
                // Promote to memory if small enough
                if (this.shouldCacheInMemory(storageCached)) {
                    this.addToMemory(key, storageCached);
                }
                
                return storageCached.value;
            }
        } catch (error) {
            EPGErrorHandler.warn('Cache storage read error:', error.message);
        }

        this.stats.misses++;
        return null;
    }

    /**
     * Set to cache
     */
    async set(key, value, options = {}) {
        const [, type] = key.split(':');
        const ttl = options.ttl || this.ttlByType[type] || this.ttlByType['expand'];
        
        const entry = {
            value,
            timestamp: Date.now(),
            ttl,
            size: this.estimateSize(value)
        };

        // Always save to storage
        try {
            await storage.set(key, entry, { ttl: Math.floor(ttl / 1000) });
            this.stats.storageWrites++;
        } catch (error) {
            EPGErrorHandler.warn('Cache storage write error:', error.message);
        }

        // Add to memory if appropriate
        if (this.shouldCacheInMemory(entry)) {
            this.addToMemory(key, entry);
        }
    }

    /**
     * Check if entry is valid
     */
    isValid(entry) {
        if (!entry || !entry.timestamp) return false;
        if (entry.ttl === Infinity) return true;
        return (Date.now() - entry.timestamp) < entry.ttl;
    }

    /**
     * Delete cache entry
     */
    async delete(key) {
        const entry = this.memoryCache.get(key)
        if (entry) {
            this.memoryCache.delete(key)
            this.currentMemorySize = Math.max(0, this.currentMemorySize - entry.size)
        }
        try {
            await storage.delete(key)
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                EPGErrorHandler.warn('Cache delete error:', error.message)
            }
        }
    }

    /**
     * Add to memory cache
     */
    addToMemory(key, entry) {
        // Evict if necessary
        while (this.shouldEvict(entry.size)) {
            this.evictLRU();
        }

        this.memoryCache.set(key, entry);
        this.currentMemorySize += entry.size;
    }

    /**
     * Should evict?
     */
    shouldEvict(newItemSize) {
        return this.memoryCache.size >= this.maxMemoryItems ||
               (this.currentMemorySize + newItemSize) > this.maxMemorySize;
    }

    /**
     * Evict LRU item
     */
    evictLRU() {
        let lruKey = null;
        let lruTimestamp = Infinity;

        for (const [key, entry] of this.memoryCache.entries()) {
            if (entry.timestamp < lruTimestamp) {
                lruTimestamp = entry.timestamp;
                lruKey = key;
            }
        }

        if (lruKey) {
            const entry = this.memoryCache.get(lruKey);
            this.memoryCache.delete(lruKey);
            this.currentMemorySize -= entry.size;
        }
    }

    /**
     * Should cache in memory?
     */
    shouldCacheInMemory(entry) {
        return entry.size < 50 * 1024; // Cache items < 50KB in memory
    }

    /**
     * Estimate size
     */
    estimateSize(value) {
        try {
            return JSON.stringify(value).length * 2;
        } catch (error) {
            return 1024;
        }
    }

    /**
     * Get stats
     */
    getStats() {
        return {
            ...this.stats,
            memoryItems: this.memoryCache.size,
            memorySizeMB: (this.currentMemorySize / 1024 / 1024).toFixed(2),
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }

    /**
     * Clear memory cache
     */
    clear() {
        this.memoryCache.clear();
        this.currentMemorySize = 0;
    }
}

