import Download from '../download/download.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import fs from 'fs/promises'
import config from '../config/config.js'
import paths from '../paths/paths.js'
import { EventEmitter } from 'node:events'

class CloudConfiguration extends EventEmitter {
    constructor(opts = {}) {
        super()
        this.expires = {
            configure: 3600,
            promos: 300,
            searches: 21600,
            channels: 21600,
            sources: 21600,
            trending: 300
        }
        this.debug = opts.debug || false
        this.defaultTTL = 300
        this.defaultServer = 'https://app.megacubo.net/stats'
        this.server = config.get('config-server') || this.defaultServer
        this.activeFetches = new Map() // Track active fetches by key
        this.failed404Cache = new Map() // Track URLs that returned 404 errors
        this.failed404TTL = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
        
        // Start periodic cleanup of stale fetches
        this._cleanupInterval = setInterval(() => {
            this._cleanupStaleFetches()
        }, 60000) // Run every minute
        
        Object.assign(this, opts)
    }

    get cachePrefix() {
        return `cloud-${lang.locale}-`
    }

    /**
     * Check if a URL has failed with 404 error in the last 24 hours
     * @param {string} url - The URL to check
     * @returns {boolean} - True if URL should be skipped due to recent 404
     */
    isUrlRecentlyFailed(url) {
        const failureInfo = this.failed404Cache.get(url)
        if (!failureInfo) return false
        
        const now = Date.now()
        const timeSinceFailure = now - failureInfo.timestamp
        
        // If more than 24 hours have passed, remove from cache
        if (timeSinceFailure > this.failed404TTL) {
            this.failed404Cache.delete(url)
            this.debug && console.log(`🟢 404 Cache: Expired entry removed for ${url}`)
            return false
        }
        
        this.debug && console.log(`🔴 404 Cache: URL blocked due to recent 404: ${url}`)
        return true
    }

    /**
     * Mark a URL as failed with 404 error
     * @param {string} url - The URL that failed
     */
    markUrlAsFailed(url) {
        this.failed404Cache.set(url, {
            timestamp: Date.now(),
            error: '404 Not Found'
        })
        // Only log in debug mode to avoid cluttering logs
        this.debug && console.log(`🔴 404 Cache: Added ${url} to failed cache for 24 hours`)
    }

    /**
     * Clear expired entries from the 404 cache
     */
    cleanupFailed404Cache() {
        const now = Date.now()
        for (const [url, failureInfo] of this.failed404Cache.entries()) {
            const timeSinceFailure = now - failureInfo.timestamp
            if (timeSinceFailure > this.failed404TTL) {
                this.failed404Cache.delete(url)
            }
        }
    }

    /**
     * Clear all entries from the 404 cache
     */
    clearFailed404Cache() {
        this.failed404Cache.clear()
        this.debug && console.log('🧹 404 Cache: Cleared all entries')
    }


    /**
     * Build a short description about the payload size
     * @param {*} payload - The payload to be described
     * @returns {string} - Human readable payload size
     */
    describePayloadSize(payload) {
        if (Array.isArray(payload)) {
            return `${payload.length} entries`
        }
        if (payload && typeof payload === 'object') {
            return `${Object.keys(payload).length} keys`
        }
        if (typeof payload === 'string') {
            return `${payload.length} characters`
        }
        if (payload === null || typeof payload === 'undefined') {
            return '0'
        }
        return '1'
    }

    /**
     * Log successful fetches for debugging purposes
     * @param {string} key - Cache key
     * @param {*} payload - Data fetched
     * @param {string} origin - Source of the payload
     */
    logSuccessfulFetch(key, payload, origin) {
        if (!key.startsWith('sources/')) {
            return
        }
        const sizeDescription = this.describePayloadSize(payload)
        console.info(`[cloud] sources "${key}" loaded (${sizeDescription}) via ${origin}`)
    }

    /**
     * Get statistics about the 404 cache
     * @returns {Object} - Cache statistics
     */
    getFailed404CacheStats() {
        const now = Date.now()
        let expiredCount = 0
        let activeCount = 0
        
        for (const [url, failureInfo] of this.failed404Cache.entries()) {
            const timeSinceFailure = now - failureInfo.timestamp
            if (timeSinceFailure > this.failed404TTL) {
                expiredCount++
            } else {
                activeCount++
            }
        }
        
        return {
            totalEntries: this.failed404Cache.size,
            activeEntries: activeCount,
            expiredEntries: expiredCount,
            ttlHours: this.failed404TTL / (60 * 60 * 1000)
        }
    }

    async getCountry(ip) {
        const postData = `ip=${encodeURIComponent(ip)}`
        const ret = await Download.post({
            url: `${this.server}/get_country_low`,
            post: postData,
            responseType: 'json',
            timeout: 10000,
            retry: 2,
            debug: this.debug,
        })
        if (!ret.country_code) throw new Error('Invalid response')
        return ret.country_code
    }

    async testConfigServer(baseUrl) {
        let data = await Download.get({ 
            url: baseUrl + '/data/configure.json', 
            responseType: 'json',
            timeout: 10000,
            retry: 2,
            debug: this.debug
        })
        if (data && data.version)
            return true
        throw new Error('Bad config server URL')
    }

    async fetch(key, opts = {}) {
        const url = `${this.server}/data/${key}.json`
        this.debug && console.log(`Fetching URL: ${url}`)
        
        // Check if this URL recently failed with 404
        if (this.isUrlRecentlyFailed(url)) {
            this.debug && console.log(`Skipping URL due to recent 404 error: ${url}`)
            throw new Error(`URL recently failed with 404 error: ${url}`)
        }
        
        // Cleanup expired entries from 404 cache
        this.cleanupFailed404Cache()
        
        try {
            this.debug && console.log(`Starting fetch for ${key}`)
            const response = await Download.get({
                url,
                retry: 2,
                timeout: 30,
                responseType: 'json',
                cacheTTL: this.expires[opts.expiralKey] || this.defaultTTL,
                bypassCache: opts.bypassCache,
                debug: this.debug
            })
            this.debug && console.log(`Fetch completed for ${key}`, response)
            if (opts.validator && !opts.validator(response)) {
                throw new Error('Validation failed')
            }
            await this.saveToCache(key, response, opts)
            this.logSuccessfulFetch(key, response, 'network')
            return response
        } catch (error) {
            this.debug && console.log(`Fetch failed for ${key}`, error)
            
            // Check if the error is a 404 and mark URL as failed
            if (error.status === 404 || 
                error.statusCode === 404 ||
                (error.message && (
                    error.message.includes('404') || 
                    error.message.includes('Not Found') ||
                    error.message.includes('not found')
                )) ||
                (typeof error === 'string' && (
                    error.includes('HTTP error 404') ||
                    error.includes('404') ||
                    error.includes('Not Found')
                ))) {
                this.markUrlAsFailed(url)
            }
            
            throw error
        }
    }

    async get(key, opts = {}) {
        const cacheKey = `${this.cachePrefix}${key}`
        const url = `${this.server}/data/${key}.json`
        const isShadowMode = opts.shadow === true
        this.debug && console.log(`Reading cache for ${key}${isShadowMode ? ' (shadow mode)' : ''}`)

        // Check if this URL recently failed with 404
        if (this.isUrlRecentlyFailed(url)) {
            this.debug && console.log(`Skipping URL due to recent 404 error: ${url}`)
            // Try fallback first before throwing error
            try {
                return await this.readFallback(key)
            } catch (fallbackError) {
                throw new Error(`Unable to retrieve data for ${key}`)
            }
        }

        // Check cache with timeout
        let data = await Promise.race([
            storage.get(cacheKey),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Storage timeout')), 5000))
        ]).catch(err => {
            this.debug && console.log(`Storage error for ${key}`, err)
            return null
        })

        if (data) {
            this.debug && console.log(`Cache hit for ${key}`)
            return data
        }

        // Check if there is an ongoing fetch for this key
        if (this.activeFetches.has(key)) {
            this.debug && console.log(`Waiting for ongoing fetch for ${key}`)
            return this.activeFetches.get(key) // Return the shared fetch promise
        }

        // Create a new Promise for the fetch
        const fetchPromise = (async () => {
            try {
                const result = await Promise.race([
                    this.fetch(key, opts),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch timeout')), 10000))
                ])
                await this.saveToCache(key, result, opts)
                return result
            } catch (fetchError) {
                this.debug && console.log(`Fetch failed, trying fallback for ${key}`, fetchError)
                try {
                    return await this.readFallback(key)
                } catch (fallbackError) {
                    this.debug && console.log(`Fallback failed for ${key}`, fallbackError)
                    throw new Error(`Unable to retrieve data for ${key}`)
                }
            } finally {
                this.activeFetches.delete(key) // Always clear activeFetches
            }
        })()

        // Add global error handler to prevent unhandled rejections
        fetchPromise.catch(err => {
            this.debug && console.log(`Fetch promise error for ${key}:`, err.message)
        })

        this.activeFetches.set(key, fetchPromise)

        // Shadow mode: return immediately without waiting for fetch
        if (isShadowMode) {
            this.debug && console.log(`Shadow mode: returning immediately for ${key}, fetch running in background`)
            return null // Return null when no cache available in shadow mode
        }

        try {
            // Wait for the fetch or timeout
            data = await fetchPromise
            return data
        } catch (error) {
            this.debug && console.log(`Error retrieving data for ${key}`, error)
            throw error
        }
    }

    async register(endpoint, params) {
        const url = `${this.server}/${endpoint}`
        const response = await Download.post({ 
            url, 
            post: params,
            timeout: 10000,
            retry: 2,
            debug: this.debug
        })
        return response
    }

    async readFallback(key) {
        const filePath = paths.cwd + `/dist/defaults/${key}.json`
        try {
            const content = await fs.readFile(filePath, 'utf8')
            const parsed = JSON.parse(content)
            this.logSuccessfulFetch(key, parsed, 'fallback')
            return parsed
        } catch (error) {
            if (key === 'configure') {
                console.error(`[cloud] No fallback found for ${key}`, error)
            }
            throw error
        }
    }

    async saveToCache(key, data, opts) {
        const cacheKey = `${this.cachePrefix}${key}`
        const ttl = this.expires[opts.expiralKey] || this.defaultTTL
        this.debug && console.log(`Saving ${key} to cache`, { cacheKey, ttl })
        await storage.set(cacheKey, data, { ttl, permanent: opts.permanent })
    }

    // Cleanup method for stale fetches
    _cleanupStaleFetches() {
        const now = Date.now()
        const staleThreshold = 30000 // 30 seconds
        
        for (const [key, promise] of this.activeFetches.entries()) {
            // Check if promise has been pending too long
            if (promise._startTime && (now - promise._startTime) > staleThreshold) {
                this.debug && console.log(`Cleaning up stale fetch for ${key}`)
                this.activeFetches.delete(key)
            }
        }
    }

    // Destroy method to clean up resources
    destroy() {
        // Clear cleanup interval
        if (this._cleanupInterval) {
            clearInterval(this._cleanupInterval)
            this._cleanupInterval = null
        }
        
        // Clear all active fetches
        this.activeFetches.clear()
        
        // Remove all event listeners
        this.removeAllListeners()
        
        this.debug && console.log('CloudConfiguration destroyed')
    }
}

export { CloudConfiguration }
export default new CloudConfiguration()
