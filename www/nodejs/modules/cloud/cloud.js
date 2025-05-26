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
        Object.assign(this, opts)
    }

    get cachePrefix() {
        return `cloud-${lang.locale}-`
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
            return response
        } catch (error) {
            this.debug && console.log(`Fetch failed for ${key}`, error)
            throw error
        }
    }

    async get(key, opts = {}) {
        const cacheKey = `${this.cachePrefix}${key}`
        this.debug && console.log(`Reading cache for ${key}`)

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

        this.activeFetches.set(key, fetchPromise)

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
            return JSON.parse(content)
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
}

export default new CloudConfiguration()
