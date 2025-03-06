import Download from '../download/download.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import fs from 'fs/promises'
import config from '../config/config.js'
import paths from '../paths/paths.js'
import { EventEmitter } from 'events'
import { getDomain } from '../utils/utils.js'
import { parse } from '../serialize/serialize.js'

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

    logDebug(message, data = null) {
        if (this.debug) {
            console.log(`CloudConfiguration: ${message}`, data || '')
        }
    }

    async getCountry(ip) {
        const postData = `ip=${ip}`
        const options = {
            port: 80,
            method: 'POST',
            path: '/stats/get_country_low',
            hostname: getDomain(this.server),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Cache-Control': 'no-cache',
            },
        }

        return new Promise((resolve, reject) => {
            const req = require('http').request(options, res => {
                let data = ''
                res.setEncoding('utf8')
                res.on('data', chunk => data += chunk)
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data)
                        if (!parsed.country_code) throw new Error('Invalid response')
                        resolve(parsed.country_code)
                    } catch (error) {
                        reject(error)
                    }
                })
            }).on('error', reject)

            req.write(postData)
            req.end()
        })
    }

    async testConfigServer(baseUrl) {
        let data = await Download.get({ url: baseUrl + '/data/configure.json', responseType: 'json' })
        if (data && data.version)
            return true
        throw 'Bad config server URL'
    }

    async fetch(key, opts = {}) {
        const url = `${this.server}/data/${key}.json`
        this.logDebug(`Fetching URL: ${url}`)
        try {
            const response = await Download.get({
                url,
                retry: 2,
                timeout: 30,
                responseType: 'json',
                cacheTTL: this.expires[opts.expiralKey] || this.defaultTTL,
                bypassCache: opts.bypassCache,
            })
            this.logDebug(`Fetched data for ${key}`, response)
            if (opts.validator && !opts.validator(response)) {
                throw new Error('Validation failed')
            }
            await this.saveToCache(key, response, opts)
            return response
        } catch (error) {
            this.logDebug(`Fetch failed for ${key}`, error)
            throw error
        }
    }

    async get(key, opts = {}) {
        const cacheKey = `${this.cachePrefix}${key}`
        this.logDebug(`Reading cache for ${key}`)
        let data = await storage.get(cacheKey).catch(() => null)

        if (data) {
            this.logDebug(`Cache hit for ${key}`)
            return data
        }

        // Check if there is an ongoing fetch for this key
        if (this.activeFetches.has(key)) {
            this.logDebug(`Waiting for ongoing fetch for ${key}`)
            return this.activeFetches.get(key) // Return the shared fetch promise
        }

        // Create a fetch promise and store it
        const fetchPromise = (async () => {
            try {
                const result = await this.fetch(key, opts)
                await this.saveToCache(key, result, opts)
                return result
            } catch (fetchError) {
                this.logDebug(`Fetch failed, trying fallback for ${key}`)
                try {
                    return await this.readFallback(key)
                } catch (fallbackError) {
                    this.logDebug(`Fallback failed for ${key}`, fallbackError)
                    throw new Error(`Unable to retrieve data for ${key}`)
                }
            } finally {
                this.activeFetches.delete(key) // Clean up when done
            }
        })()

        this.activeFetches.set(key, fetchPromise)

        try {
            // Wait for fetch or timeout
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Fetch timeout')), 5000)
            )
            data = await Promise.race([fetchPromise, timeoutPromise])

            if (data) {
                return data // If fetch succeeds within timeout, return data
            }
        } catch (timeoutError) {
            this.logDebug(`Fetch timed out for ${key}, using fallback`)
        }

        // Fetch didn't resolve in time or failed, use fallback
        try {
            return await this.readFallback(key)
        } catch (fallbackError) {
            this.logDebug(`Fallback failed for ${key}`, fallbackError)
        }

        return fetchPromise
    }

    async readFallback(key) {
        const filePath = paths.cwd + `/dist/defaults/${key}.json`
        try {
            const content = await fs.readFile(filePath, 'utf8')
            return parse(content)
        } catch (error) {
            this.logDebug(`Fallback failed for ${key}`, error)
            throw error
        }
    }

    async saveToCache(key, data, opts) {
        const cacheKey = `${this.cachePrefix}${key}`
        const ttl = this.expires[opts.expiralKey] || this.defaultTTL
        this.logDebug(`Saving ${key} to cache`, { cacheKey, ttl })
        await storage.set(cacheKey, data, { ttl, permanent: opts.permanent })
    }
}

export default new CloudConfiguration()
