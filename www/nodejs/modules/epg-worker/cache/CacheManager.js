import { EPG_CONFIG } from '../config.js'

export class CacheManager {
  constructor(options = {}) {
    this.maxSize = options.maxCacheSize || EPG_CONFIG.cache.maxCacheSize
    this.cleanupInterval = options.cleanupInterval || EPG_CONFIG.cache.cleanupInterval
    this.ttl = options.ttl || EPG_CONFIG.cache.ttl

    this.channelsCache = new Map() // id -> {data, timestamp}
    this.termsCache = new Map() // channel -> {terms, timestamp}
    this._allTermsLoaded = false
    this._pendingTerms = new Set() // channels pending terms upsert
    this._cacheCleanupInterval = null

    // Metrics
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      insertions: 0,
      startTime: Date.now()
    }

    this.startCleanup()
  }

  // Channel cache operations
  hasChannel(id) {
    this._ensureChannelsCache()
    const entry = this.channelsCache.get(id)
    
    if (!entry) {
      return false
    }
    
    // Check TTL
    if (this._isExpired(entry.timestamp)) {
      this.channelsCache.delete(id)
      this.metrics.evictions++
      return false
    }
    
    return true
  }

  getChannel(id) {
    this._ensureChannelsCache()
    const entry = this.channelsCache.get(id)
    
    if (!entry) {
      this.metrics.misses++
      return undefined
    }
    
    // Check TTL
    if (this._isExpired(entry.timestamp)) {
      this.channelsCache.delete(id)
      this.metrics.evictions++
      this.metrics.misses++
      return undefined
    }
    
    this.metrics.hits++
    return entry.data
  }

  setChannel(id, data) {
    this._ensureChannelsCache()
    
    // Validate input data
    if (!data || typeof data !== 'object') {
      console.warn(`Invalid channel data for ID ${id}:`, data)
      data = { name: String(id || 'unknown'), icon: '' }
    }
    
    // Ensure data has required properties
    if (!data.name) {
      data.name = String(id || 'unknown')
    }
    if (!data.icon) {
      data.icon = ''
    }
    
    // Prevent cache from growing too large
    if (this.channelsCache.size >= this.maxSize) {
      console.warn('Channels cache size limit reached, clearing cache...')
      this._evictOldestEntries(this.channelsCache, Math.floor(this.maxSize * 0.2))
    }

    this.channelsCache.set(id, {
      data,
      timestamp: Date.now()
    })
    this.metrics.insertions++
  }

  // Terms cache operations
  hasTerms(id) {
    this._ensureTermsCache()
    return this.termsCache.has(id)
  }

  getTerms(id) {
    this._ensureTermsCache()
    return this.termsCache.get(id)
  }

  setTerms(id, terms) {
    this._ensureTermsCache()
    
    // Prevent cache from growing too large
    if (this.termsCache.size >= this.maxSize) {
      console.warn('Terms cache size limit reached, clearing cache...')
      this.termsCache.clear()
    }

    this.termsCache.set(id, terms)
  }

  getAllTerms() {
    this._ensureTermsCache()
    return this.termsCache
  }

  setAllTermsLoaded(loaded = true) {
    this._allTermsLoaded = loaded
  }

  isAllTermsLoaded() {
    return this._allTermsLoaded
  }

  // Pending terms operations
  addPendingTerm(id) {
    this._ensurePendingTerms()
    this._pendingTerms.add(id)
  }

  getPendingTerms() {
    this._ensurePendingTerms()
    return Array.from(this._pendingTerms)
  }

  clearPendingTerms() {
    this._ensurePendingTerms()
    this._pendingTerms.clear()
  }

  hasPendingTerms() {
    this._ensurePendingTerms()
    return this._pendingTerms.size > 0
  }

  // Cache management
  clearChannelsCache() {
    console.debug('Clearing channels cache...')
    this._ensureChannelsCache()
    this.channelsCache.clear()
  }

  clearTermsCache() {
    console.debug('Clearing terms cache...')
    this._ensureTermsCache()
    this.termsCache.clear()
    this._allTermsLoaded = false
  }

  clearAllCaches() {
    console.log('Clearing all caches to free memory...')
    
    this.clearChannelsCache()
    this.clearTermsCache()
    this.clearPendingTerms()
  }

  getCacheStats() {
    return {
      channels: this.channelsCache.size,
      terms: this.termsCache.size,
      pendingTerms: this._pendingTerms.size,
      allTermsLoaded: this._allTermsLoaded
    }
  }

  // Memory monitoring
  getMemoryUsage() {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const memUsage = process.memoryUsage()
      const heapUsed = memUsage.heapUsed
      const maxHeap = EPG_CONFIG.memory.maxHeapSize

      console.debug(`Memory usage: ${Math.round(heapUsed / 1024 / 1024)}MB / ${Math.round(maxHeap / 1024 / 1024)}MB`)

      // If memory usage is too high, clear caches
      if (heapUsed > maxHeap * EPG_CONFIG.memory.gcThreshold) {
        console.warn('High memory usage detected, clearing caches...')
        this.clearAllCaches()
      }

      return memUsage
    }
    return null
  }

  // Cleanup management
  startCleanup() {
    if (this._cacheCleanupInterval) {
      clearInterval(this._cacheCleanupInterval)
    }

    this._cacheCleanupInterval = setInterval(() => {
      console.debug('Running periodic cache cleanup...')
      
      // Check memory usage and clear if necessary
      this.getMemoryUsage()
      
      // Optionally clear caches based on age or other criteria
      // For now, we just check memory usage
    }, this.cleanupInterval)
  }

  stopCleanup() {
    if (this._cacheCleanupInterval) {
      clearInterval(this._cacheCleanupInterval)
      this._cacheCleanupInterval = null
    }
  }

  // Utility methods to ensure caches are properly initialized
  _ensureChannelsCache() {
    if (!this.channelsCache || !(this.channelsCache instanceof Map)) {
      console.warn('Channels cache was corrupted, reinitializing...')
      this.channelsCache = new Map()
    }
  }

  _ensureTermsCache() {
    if (!this.termsCache || !(this.termsCache instanceof Map)) {
      console.warn('Terms cache was corrupted, reinitializing...')
      this.termsCache = new Map()
    }
  }

  _ensurePendingTerms() {
    if (!this._pendingTerms || !(this._pendingTerms instanceof Set)) {
      console.warn('Pending terms set was corrupted, reinitializing...')
      this._pendingTerms = new Set()
    }
  }

  // Cleanup method to properly dispose of resources
  // Utility methods
  _isExpired(timestamp) {
    return (Date.now() - timestamp) > (this.ttl * 1000)
  }

  _evictOldestEntries(cache, count) {
    const entries = Array.from(cache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      cache.delete(entries[i][0])
      this.metrics.evictions++
    }
  }

  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime
    const hitRate = this.metrics.hits / (this.metrics.hits + this.metrics.misses) || 0
    
    return {
      ...this.metrics,
      uptime,
      hitRate: Math.round(hitRate * 100),
      cacheSize: {
        channels: this.channelsCache.size,
        terms: this.termsCache.size,
        pendingTerms: this._pendingTerms.size
      }
    }
  }

  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      evictions: 0,
      insertions: 0,
      startTime: Date.now()
    }
  }

  // Enhanced cache stats
  getCacheStats() {
    const stats = {
      channels: this.channelsCache.size,
      terms: this.termsCache.size,
      pendingTerms: this._pendingTerms.size,
      allTermsLoaded: this._allTermsLoaded,
      maxSize: this.maxSize,
      ttl: this.ttl
    }

    // Calculate memory usage estimate
    let memoryUsage = 0
    this.channelsCache.forEach(entry => {
      memoryUsage += JSON.stringify(entry).length
    })
    this.termsCache.forEach(entry => {
      memoryUsage += JSON.stringify(entry).length
    })
    
    stats.estimatedMemoryKB = Math.round(memoryUsage / 1024)
    
    return stats
  }

  destroy() {
    console.log('Destroying cache manager...')
    
    // Warn if there are pending terms
    if (this._pendingTerms && this._pendingTerms.size > 0) {
      console.warn(`⚠️ Destroying cache manager with ${this._pendingTerms.size} pending terms`)
    }
    
    this.stopCleanup()
    this.clearAllCaches()
    
    this.channelsCache = null
    this.termsCache = null
    this._pendingTerms = null
  }
}
