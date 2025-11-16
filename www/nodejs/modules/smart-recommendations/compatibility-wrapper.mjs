import { EventEmitter } from 'node:events'
import smartRecommendations from './index.mjs'
import { EPGErrorHandler } from '../epg/worker/EPGErrorHandler.js'
import storage from '../storage/storage.js'
import lang from '../lang/lang.js'
import { Tags } from './tags.mjs'
import { ready } from '../bridge/bridge.js'
import PQueue from 'p-queue'
import { terms, match } from '../lists/tools.js'
import { AIClient } from './ai-client/AIClient.mjs'
import Limiter from '../limiter/limiter.js'

/**
 * Compatibility Wrapper for Smart Recommendations
 * Provides the same API as the original recommendations system
 */
class SmartRecommendationsCompatibility extends EventEmitter {
    constructor() {
        super()
        this.readyState = 0
        this.smartRecommendations = null
        this.aiClient = null
        this.initialized = false
        this.updateIntervalSecs = 300
        this.epgLoaded = false
        this.someListLoaded = false
        this.listsLoaded = false
        this.initializationTime = Date.now() / 1000

        // Storage-based cache system
        this.cacheKey = 'smart-recommendations-cache'
        this.cacheMaxAge = 300000  // 5 minutos em ms

        // Update queue system using p-queue (prevents simultaneous updates)
        this.updateQueue = new PQueue({
            concurrency: 1,        // Only one update at a time
            interval: 500,         // 100ms interval between updates
            intervalCap: 1         // Maximum 1 update per interval
        })
        this.updateUIQueue = new PQueue({
            concurrency: 1,
            interval: 500,
            intervalCap: 1
        })

        // Periodic update limiter (ensures at least one update every 5 minutes, max once per 3 seconds)
        this.updateLimiter = new Limiter(
            () => this.scheduleUpdate(),
            3000,  // Minimum 3 seconds between updates (prevents too frequent calls)
            true    // async
        )
        
        // Periodic interval to ensure updates at least every 5 minutes
        this.periodicUpdateInterval = null

        // UI update system
        this.latestEntries = []
        this.ensuredInitialUIUpdate = false
        this.initialUIUpdateTimeout = null
        this.hookId = 'recommendations'

        // Initialize tags system
        this.tags = new Tags()
        this.manualInterestRange = { start: 0.1, end: 2, step: 0.1 }
        this.ignoreExternalTrendsKey = 'smart-recommendations-ignore-external-trends'
        this.tags.on('manualTagsChanged', () => {
            try {
                this.invalidateRecommendationCaches('manual-tags-changed')
                this.scheduleUpdate()
                this.refreshRecommendationsForManualTags().catch(err => {
                    EPGErrorHandler.warn('Failed to refresh recommendations after manual tags change:', err?.message || err)
                })
            } catch (err) {
                EPGErrorHandler.warn('Manual tags change handler failed:', err?.message || err)
            }
        })
        ready(() => {
            this.ensureInitialUIUpdate()
        })
    }

    /**
     * Initialize the smart recommendations system
     */
    async initialize() {
        try {
            EPGErrorHandler.info('🚀 Initializing Smart Recommendations Compatibility Wrapper...')

            // Initialize AI Client for smart recommendations
            await this.initializeAIClient()

            // Initialize smart recommendations with AI Client
            await smartRecommendations.initialize(this.aiClient, {
                semanticWeight: 0.6,
                traditionalWeight: 0.4,
                maxRecommendations: 50,
                cacheSize: 2000,
                learningEnabled: false // No learning with AI (already trained)
            })

            this.smartRecommendations = smartRecommendations
            this.initialized = true
            this.readyState = 1

            await new Promise(resolve => {
                ready(() => {
                    // Set up event listeners
                    try {
                        this.setupEventListeners().catch(err => EPGErrorHandler.warn('Failed to setup event listeners:', err.message))
                    } catch (error) {
                        EPGErrorHandler.warn('⚠️ Failed to setup event listeners:', error.message)
                    }
                    resolve()
                })
            })

            // Start periodic update interval (guarantees update at least every 5 minutes)
            this.startPeriodicUpdates()

            EPGErrorHandler.info('✅ Smart Recommendations Compatibility Wrapper initialized')
            return true

        } catch (error) {
            EPGErrorHandler.error('❌ Failed to initialize Smart Recommendations:', error)
            this.readyState = -1
            return false
        }
    }

    /**
     * Initialize AI Client for smart recommendations
     */
    async initializeAIClient() {
        try {
            EPGErrorHandler.info('🤖 Initializing AI Client for Smart Recommendations...')

            this.aiClient = new AIClient({
                serverUrl: 'https://ai.megacubo.tv',
                enabled: true,
                timeout: 10000,
                retries: 2,
                maxMemoryItems: 500,
                maxMemorySize: 10 * 1024 * 1024, // 10MB
                batchSize: 50,
                batchDelay: 100
            })

            // Initialize client (test connection)
            await this.aiClient.initialize()

            EPGErrorHandler.info('✅ AI Client initialized successfully for Smart Recommendations')
            EPGErrorHandler.info(`📊 AI Client stats:`, this.aiClient.getStats())

        } catch (error) {
            EPGErrorHandler.error('❌ Failed to initialize AI Client:', error)
            // Non-fatal: AI Client will use fallback mode
        }
    }

    /**
     * Set up event listeners
     */
    async setupEventListeners() {
        // Listen for EPG updates - check if global.lists has EventEmitter methods
        global.lists.on('list-loaded', () => {
            if (!this.someListLoaded && this.readyState < 4) {
                this.someListLoaded = true
                this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
            }
        })

        global.lists.on('epg-update', () => {
            if(this.epgLoaded) {
                this.clearCache()
            } else {
                this.epgLoaded = true
            }
            this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
        })

        await global.lists.ready()
        await global.lang.ready()
        this.listsLoaded = true

        await this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
        await global.lists.epgReady()
                
        if(this.epgLoaded) {
            this.clearCache()
        } else {
            this.epgLoaded = true
        }
        this.scheduleUpdate()

        await global.channels.ready()
        EPGErrorHandler.info('📺 Channels loaded, scheduling smart recommendations update')
        await this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
    }

    epgEnabled() {
        return global.lists?.epg?.loaded || config.get('epg-' + lang.locale)
    }
    isEPGEnabled() {
        let activeEPG = config.get('epg-' + lang.locale)
        if(activeEPG && activeEPG !== 'disabled') {
            return Array.isArray(activeEPG) ? activeEPG.filter(r => r.active).length : activeEPG.length
        }
        return config.get('epg-suggestions')
    }
    async maybeUpdateCache() {
        const cacheData = await storage.get(this.cacheKey)
        const shouldBeRich = this.isEPGEnabled() && this.epgLoaded && this.listsLoaded
        const shouldUpdateCache = !(shouldBeRich ? this.isCacheRich(cacheData) : this.isCacheValid(cacheData))
        if (shouldUpdateCache) {
            this.scheduleUpdate()
        }
    }

    /**
     * Get recommendations - main API method
     * @param {Object} tags - User tags
     * @param {number} amount - Number of recommendations
     * @param {Object} options - Options for recommendations
     * @returns {Promise<Array>} Recommendations
     */
    async get(tags, amount = 25, options = {}) {
        if (!this.initialized || !this.smartRecommendations) {
            EPGErrorHandler.warn('Smart recommendations not initialized, returning empty array')
            return []
        }

        // Handle case where only amount is provided: get(amount)
        if (typeof tags === 'number' && amount === 25 && Object.keys(options).length === 0) {
            // Called as get(amount) - need to get user tags
            amount = tags
            tags = null
            options = {}
        }

        const { type = 'live', includeSemantic = true, includeTraditional = true, group = false, typeStrict = false } = options

        // Check if EPG is loaded (loaded can be an array of URLs or boolean)
        // Allow fallback entries even if EPG is not fully loaded - don't return empty here
        // The caller (getEntriesWithSpecials) will handle fallback entries
        const epgLoaded = global.lists?.epg?.loaded
        if (!Array.isArray(epgLoaded) || epgLoaded.length === 0) {
            // Return empty to trigger fallback in getEntriesWithSpecials, but log for debugging
            EPGErrorHandler.debug('EPG not loaded, will use fallback entries')
            return []
        }

        try {
            // If no tags provided, get them from the tags system
            if (!tags) {
                tags = await this.getUserTags()
            }

            const userContext = {
                userId: this.getCurrentUserId(),
                tags: tags || {},
                applyParentalControl: !global.lists?.parentalControl?.lazyAuth?.()
            }

            const recommendationOptions = {
                limit: amount,
                includeSemantic,
                includeTraditional
            }

            // Add VOD-specific options
            if (type === 'vod') {
                recommendationOptions.type = 'video'
                recommendationOptions.group = group
                recommendationOptions.typeStrict = typeStrict
            }

            const recommendations = await this.smartRecommendations.getRecommendations(userContext, recommendationOptions)

            if (!recommendations || recommendations.length === 0) {
                EPGErrorHandler.warn('getRecommendations returned empty results')
                return []
            }

            // Transform to expected format
            const transformed = this.transformRecommendations(recommendations)

            if (options.sort === 'score') {
                return transformed.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
            }

            return transformed.sort((a, b) => {
                if (!a.programme || !b.programme) {
                    return 0
                }
                return a.programme.start - b.programme.start
            })

        } catch (error) {
            EPGErrorHandler.warn('Smart recommendations failed:', error.message)
            return []
        }
    }

    /**
     * Get channel recommendations with diversity filtering
     * @param {number} amount - Number of channels
     * @param {Array} excludes - Channels to exclude
     * @returns {Promise<Array>} Channel recommendations
     */
    async getChannels(amount = 5, excludes = []) {
        if (!this.initialized) {
            return []
        }

        try {
            // getChannels should work without EPG available using channels.channelList as guaranteed fallback
            if (!global.channels?.channelList?.categories) {
                await global.channels.ready()
            }

            // Flatten all channels from all categories
            const allChannels = []
            for (const categoryName in global.channels.channelList.categories) {
                const categoryChannels = global.channels.channelList.categories[categoryName]
                if (Array.isArray(categoryChannels)) {
                    allChannels.push(...categoryChannels)
                }
            }

            if (allChannels.length === 0) {
                EPGErrorHandler.warn('No channels found in channelList.categories')
                return []
            }

            const excludeSet = new Set(excludes.map(name => name.toLowerCase()))

            // Filter out excluded channels
            const availableChannels = allChannels.filter(channel => {
                // Extract channel name (handle format like "Channel Name, terms")
                const channelName = (channel.split(',')[0] || channel).trim().toLowerCase()
                return !excludeSet.has(channelName)
            })

            // Get user tags for relevance scoring
            const userTags = await this.getUserTags()

            // Score channels based on user tags relevance
            const scoredChannels = availableChannels.map(channel => {
                const channelName = (channel.split(',')[0] || channel).trim()

                // Get pre-parsed terms from channelsIndex (much more efficient)
                let channelTerms = []
                if (global.channels?.channelList?.channelsIndex?.[channelName]) {
                    channelTerms = global.channels.channelList.channelsIndex[channelName]
                } else {
                    // Fallback: try to parse from channel string format
                    const termsString = channel.split(',')[1]?.trim() || ''
                    channelTerms = terms(termsString)
                }

                // Calculate relevance score based on user tags
                let relevanceScore = this.calculateChannelRelevance(userTags, channelTerms, channelName)

                return {
                    name: channelName,
                    terms: channelTerms,
                    score: relevanceScore,
                    channel // Keep original channel string for compatibility
                }
            })

            // Sort by relevance score (highest first)
            const sortedChannels = scoredChannels.sort((a, b) => b.score - a.score)

            // Apply diversity filter based on term similarity
            const diverseChannels = this.applyDiversityFilter(sortedChannels, amount, 0.6)


            // Check if toMetaEntry is available once (performance optimization)
            if (!global.channels?.toMetaEntry) {
                return []
            }

            // Transform to recommendation format using channels.toMetaEntry
            const transformedChannels = diverseChannels.map(channel => {
                const channelName = channel.name
                const channelTerms = channel.terms

                // Prepare channel object for toMetaEntry
                const channelObj = {
                    name: channelName,
                    url: global.mega?.build(channelName, {
                        mediaType: 'live',
                        terms: channelTerms
                    }) || `mega://${encodeURIComponent(channelName)}`,
                    terms: channelTerms // Ensure terms are preserved
                }

                // Use channels.toMetaEntry (already checked above)
                const entry = global.channels.toMetaEntry(channelObj)

                // Ensure terms are preserved in the final entry
                if (channelTerms && channelTerms.length > 0) {
                    entry.terms = channelTerms
                }

                return entry
            })

            return transformedChannels

        } catch (error) {
            EPGErrorHandler.warn('Channel recommendations failed:', error.message)
            return []
        }
    }

    /**
     * Get entries with special entries (improve, watched) - replaces old entries() method
     * @param {Object} tags - User tags
     * @param {number} amount - Number of entries
     * @param {Object} options - Options for recommendations
     * @returns {Promise<Array>} Entries with special entries
     */
    async getEntriesWithSpecials(tags, amount = 25, options = {}) {
        const { type = 'live' } = options

        try {
            let entries = await this.get(tags, amount, options)

            // Add fallback entries if needed
            if (!Array.isArray(entries) || entries.length === 0) {
                entries = await this.getFallbackEntries(type === 'vod', amount)
            }

            // Add special entries
            if (entries.length <= 5) {
                entries.unshift(this.getImproveEntry())
            }

            const interestsGroup = await this.buildManualInterestsGroupEntry()
            if (type !== 'vod' && entries.length) {
                if (interestsGroup) {
                    entries.push(interestsGroup)
                }
                entries.push(this.getWatchedEntry())
            } else if (interestsGroup) {
                entries.push(interestsGroup)
            }

            return entries

        } catch (error) {
            EPGErrorHandler.warn('Smart entries with specials failed:', error.message)
            return this.getFallbackEntries(type === 'vod', amount)
        }
    }

    /**
     * Update recommendations (queued using p-queue to prevent simultaneous updates)
     * Uses limiter to prevent too frequent updates (max 1 every 3 seconds)
     */
    async update() {
        try {
            // Use limiter to respect minimum interval between updates (3 seconds)
            await this.updateLimiter.call()
        } catch (error) {
            EPGErrorHandler.warn('Smart recommendations update failed:', error.message)
            throw error
        }
    }

    /**
     * Perform actual update (internal method)
     */
    async performUpdate() {
        if (!this.initialized) {
            return
        }

        const amount = 48
        let entries = []

        // Always generate new recommendations in update()
        let userContext
        try {
            userContext = {
                userId: this.getCurrentUserId(),
                tags: await this.getUserTags(),
                applyParentalControl: !global.lists?.parentalControl?.lazyAuth?.()
            }
        } catch (error) {
            EPGErrorHandler.warn('Failed to create user context:', error.message)
            userContext = {
                userId: 'anonymous',
                tags: { default: true },
                applyParentalControl: true
            }
        }

        let recommendations = []
        try {
            recommendations = await this.smartRecommendations.getRecommendations(userContext, {
                limit: 3 * amount,
                includeSemantic: true,
                includeTraditional: true
            })
        } catch (error) {
            EPGErrorHandler.warn('Smart recommendations getRecommendations failed:', error.message)
            recommendations = []
        }

        if (Array.isArray(recommendations) && recommendations.length) {
            entries = this.transformRecommendations(recommendations)
        } else { // let path open for next update
            this.epgLoaded = false;
            this.someListLoaded = false;         
        }

        // Fill with channels if needed
        if (entries.length < amount) {
            try {
                const excludes = entries.map(e => {
                    if (e && typeof e === 'object') {
                        return e.originalName || e.name || ''
                    }
                    return ''
                }).filter(name => name) // Remove empty names

                const channels = await this.getChannels(amount - entries.length, excludes)
                entries.push(...channels)
            } catch (error) {
                EPGErrorHandler.warn('Failed to get channel fallback:', error.message)
                // Continue without channel fallback
            }
        }

        // Filter available channels BEFORE caching (non-intrusive test here)
        if (entries.length > 0) {
            const channelsToTest = {}
            for (const entry of entries) {
                const name = entry?.programme?.channel || entry?.name
                const channel = global.channels.isChannel(name)
                if (channel && typeof(channelsToTest[channel.name]) === 'undefined') {
                    channelsToTest[channel.name] = channel
                }
            }

            // Test availability for channels (limit to 32 to avoid blocking)
            const availableChannels = await global.lists.has(Object.values(channelsToTest).slice(0, 32))
            
            // Separate available and non-available entries
            const availableResults = []
            const nonAvailableResults = []
            
            for (const entry of entries) {
                const name = entry?.programme?.channel || entry?.name
                const channel = global.channels.isChannel(name)
                if (channel) {
                    const isAvailable = availableChannels[channel.name]
                    if (isAvailable) {
                        availableResults.push(entry)
                        continue
                    }
                }
                nonAvailableResults.push(entry)
            }
            
            // Cache with available entries first, then non-available as fallback
            entries = [...availableResults, ...nonAvailableResults]
        }

        // Cache the results (already filtered by availability)
        entries.length && (await this.setCache(entries))
        this.readyState = ((this.epgLoaded || !this.isEPGEnabled()) && this.listsLoaded) ? 4 : 3

    }

    /**
     * Get featured entries (non-intrusive - only uses cached data)
     * @param {number} amount - Number of entries
     * @returns {Promise<Array>} Featured entries
     */
    async featuredEntries(amount = 5) {
        // Non-intrusive: only use cached data, don't generate or test
        const results = await this.getCache()

        // If no cache exists or results is null/empty, try fallback from latestEntries
        if ((!results || !Array.isArray(results) || results.length === 0) &&
            Array.isArray(this.latestEntries) && this.latestEntries.length > 0 &&
            this.initialized && this.epgLoaded && this.listsLoaded) {

            const fromLatest = [...this.latestEntries]
            return fromLatest.sort((a, b) => {
                if (!a.programme || !b.programme) {
                    return 0
                }
                return a.programme.start - b.programme.start
            }).slice(0, amount)
        }

        // If still no cache, show placeholders during initialization; otherwise keep non-intrusive and return empty
        if (!results || !Array.isArray(results) || results.length === 0) {
            if (!this.initialized || !this.epgLoaded || !this.listsLoaded || ((Date.now() / 1000) - this.initializationTime) < 30) {
                // Show busy placeholders when no cache is available
                const emptyEntries = Array(amount).fill(null)
                return emptyEntries.map((_, i) => ({
                    name: ' &nbsp;',
                    fa: 'fa-mega',
                    type: 'action',
                    class: 'entry-icon-no-fallback entry-busy-x',
                    id: 'recommendations-busy-'+ i,
                    action: () => { }
                }))
            }
            // If initialized but no cache and no latestEntries fallback, return empty array
            return []
        }

        // Return requested amount from cached results (already filtered by availability)
        return results.sort((a, b) => {
            if (!a.programme || !b.programme) {
                return 0
            }
            return a.programme.start - b.programme.start
        }).slice(0, amount)
    }

    /**
     * Generate featured entries (internal method)
     * @param {number} amount - Number of entries
     * @returns {Promise<Array>} Generated featured entries
     */
    async generateFeaturedEntries(amount = 5) {
        const results = []

        if (this.initialized && this.smartRecommendations) {
            try {
                // Get user tags just like in get() method
                const userTags = await this.getUserTags()

                // Create user context with actual user tags
                const userContext = {
                    userId: this.getCurrentUserId(),
                    tags: userTags || {},
                    preferences: {},
                    history: [],
                    demographics: {}
                }

                const freshRecommendations = await this.smartRecommendations.getRecommendations(userContext, {
                    limit: amount,
                    includeSemantic: true,
                    includeTraditional: true
                })

                if (freshRecommendations && freshRecommendations.length > 0) {
                    // Transform EPG data to menu format using transformRecommendations
                    const transformed = this.transformRecommendations(freshRecommendations)
                    results.push(...transformed)
                }
            } catch (error) {
                EPGErrorHandler.warn('Failed to generate featured recommendations:', error.message)
            }
        }

        // Fallback to channel recommendations if no smart recommendations
        if (results.length === 0) {
            const channels = await this.getChannels(amount, [])
            results.push(...channels)
        }

        // Placeholders are now handled in featuredEntries() when no cache is available
        // Only return actual results or empty array
        return results
    }

    /**
     * Hook for menu integration
     * @param {Array} entries - Menu entries
     * @param {string} path - Current path
     * @returns {Array} Modified entries
     */
    async hook(entries, path) {
        const hookId = this.hookId
        if (path === global.lang.LIVE) {
            const entry = {
                name: global.lang.RECOMMENDED_FOR_YOU,
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: global.lang.LIVE,
                hookId,
                renderer: this.getEntriesWithSpecials.bind(this, null, 25, { type: 'live' })
            }

            if (entries.some(e => e.hookId === entry.hookId)) {
                entries = entries.filter(e => e.hookId !== entry.hookId)
            }
            entries.unshift(entry)
        } else if (path === global.lang.CATEGORY_MOVIES_SERIES) {
            const entry = {
                name: global.lang.RECOMMENDED_FOR_YOU,
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: global.lang.CATEGORY_MOVIES_SERIES,
                hookId,
                renderer: this.getEntriesWithSpecials.bind(this, null, 25, { type: 'vod' })
            }

            if (entries.some(e => e.hookId === entry.hookId)) {
                entries = entries.filter(e => e.hookId !== entry.hookId)
            }
            entries.unshift(entry)
        } else if (!path) {
            // Home page integration
            const viewSizeX = global.config?.get('view-size')?.landscape?.x || 4
            const viewSizeY = global.config?.get('view-size')?.landscape?.y || 3
            const pageCount = global.config?.get('home-recommendations') || 0

            entries = entries.filter(e => (e && e.hookId !== hookId))

            if (pageCount) {
                let metaEntriesCount = entries.filter(e => e.side === true && e.name !== (global.lang.RECOMMENDED_FOR_YOU || 'Recommended for You')).length
                let amount = pageCount === 1 ?
                    ((viewSizeX * Math.max(1, viewSizeY - 1)) + (Math.ceil(metaEntriesCount / viewSizeX) * viewSizeX)) :
                    (pageCount * (viewSizeX * viewSizeY))
                amount -= 2 // -1 due to 'entry-2x' size entry, -1 due to 'More' entry

                let recommendations = []
                if (amount > 0) {
                    recommendations = await this.featuredEntries(amount - metaEntriesCount)
                }

                if (recommendations.length) {
                    recommendations.push({
                        name: global.lang.MORE,
                        details: global.lang.RECOMMENDED_FOR_YOU,
                        fa: 'fas fa-plus',
                        type: 'group',
                        renderer: this.getEntriesWithSpecials.bind(this, null, 25, { type: 'live' })
                    })
                    recommendations = recommendations.map(e => {
                        e.hookId = hookId
                        return e
                    })
                    entries = [...recommendations, ...entries]
                }
            }
        }

        return entries
    }

    /**
     * Calculate relevance score for a channel based on user tags
     * @param {Object} userTags - User tags object
     * @param {Array} channelTerms - Channel terms array
     * @param {string} channelName - Channel name
     * @returns {number} Relevance score
     */
    calculateChannelRelevance(userTags, channelTerms, channelName) {
        let relevanceScore = 0

        // Use match() for efficient and consistent matching
        for (const [tagCategory, tagValue] of Object.entries(userTags)) {
            if (typeof tagValue === 'number' && tagValue > 0) {
                // Get normalized terms for the tag category
                const categoryTerms = terms(tagCategory) || [tagCategory.toLowerCase()]

                // Use match() to get match quality (0-3 scale)
                const matchQuality = match(categoryTerms, channelTerms, true) || 0

                // Apply the tag value as a multiplier to the match quality
                if (matchQuality > 0) {
                    relevanceScore += tagValue * matchQuality
                }

                // Also check direct channel name matches using terms
                const channelNameTerms = terms(channelName) || [channelName.toLowerCase()]
                const nameMatchQuality = match(categoryTerms, channelNameTerms, true) || 0

                if (nameMatchQuality > 0) {
                    // Boost for direct name matches
                    relevanceScore += tagValue * nameMatchQuality * 1.5
                }

            } else if (Array.isArray(tagValue)) {
                // Handle arrays by treating each element as a separate tag
                for (const value of tagValue) {
                    if (typeof value === 'string') {
                        const valueTerms = terms(value) || [value.toLowerCase()]
                        const arrayMatchQuality = match(valueTerms, channelTerms, true) || 0

                        if (arrayMatchQuality > 0) {
                            relevanceScore += arrayMatchQuality * 0.5 // Reduced weight for array items
                        }
                    }
                }
            } else if (typeof tagValue === 'string') {
                // Handle string tags
                const valueTerms = terms(tagValue) || [tagValue.toLowerCase()]
                const stringMatchQuality = match(valueTerms, channelTerms, true) || 0

                if (stringMatchQuality > 0) {
                    relevanceScore += stringMatchQuality
                }
            }
        }

        return relevanceScore
    }

    clampInterestWeight(weight) {
        const numeric = Number(weight)
        if (!Number.isFinite(numeric)) {
            return 1
        }
        const clamped = Math.min(2, Math.max(0.1, numeric))
        return Math.round(clamped * 100) / 100
    }

    formatInterestWeight(weight) {
        return this.clampInterestWeight(weight).toFixed(2)
    }

    resolveConfig() {
        if (typeof config !== 'undefined') {
            return config
        }
        return global?.config
    }

    shouldIgnoreExternalTrends() {
        const cfg = this.resolveConfig()
        return cfg?.get?.(this.ignoreExternalTrendsKey) === true
    }

    async setIgnoreExternalTrends(enabled) {
        const cfg = this.resolveConfig()
        cfg?.set?.(this.ignoreExternalTrendsKey, !!enabled)

        await this.tags.clearCache().catch(err =>
            EPGErrorHandler.warn('Failed to clear tags cache after toggling external trends flag:', err?.message || err)
        )

        this.invalidateRecommendationCaches('ignore-external-trends-toggle')
        this.scheduleUpdate()

        if (global.menu?.refreshNow) {
            setTimeout(() => global.menu.refreshNow(), 10)
        }
    }

    buildAddInterestEntry() {
        return {
            name: global.lang.ADD || 'Add',
            fa: 'fas fa-plus',
            type: 'action',
            action: async () => {
                await this.promptAddManualInterest()
            }
        }
    }

    async buildManualInterestsGroupEntry() {
        try {
            const entries = await this.getManualInterestEntries()
            return {
                name: global.lang.INTERESTS,
                fa: 'fas fa-sliders-h',
                details: lang.CONFIGURE,
                type: 'group',
                renderer: async () => entries
            }
        } catch (error) {
            EPGErrorHandler.warn('Failed to build manual interests group:', error?.message || error)
            return null
        }
    }

    async getManualInterestEntries() {
        const manualTags = this.tags.getManualTags()
        const existingTerms = manualTags.map(({ term }) => term)
        const entries = manualTags.map(({ term, weight }) => {
            const formattedWeight = this.formatInterestWeight(weight)
            return {
                id: `manual-interest-${term}`,
                name: term,
                type: 'slider',
                fa: 'fas fa-sliders-h',
                details: `${lang.ENABLED} &middot; ${lang.RELEVANCE}: ${formattedWeight}`,
                range: this.manualInterestRange,
                value: this.clampInterestWeight(weight),
                question: `${global.lang.INTERESTS}: ${term}`,
                extraOptions: [{
                    template: 'option',
                    text: (lang.REMOVE) || 'Remove',
                    id: 'remove',
                    fa: 'fas fa-trash-alt'
                }],
                action: async (entry, value) => {
                    await this.handleManualInterestAction(entry, value, term)
                }
            }
        })

        const suggestions = await this.getInterestSuggestions(existingTerms)
        if (suggestions.length) {
            entries.push(...suggestions)
        }

        entries.push(this.buildAddInterestEntry())

        const ignoreLabel =
            global.lang.IGNORE_EXTERNAL_TRENDS ||
            global.lang.IGNORE_SOCIAL_TRENDS ||
            'Ignore external trends'

        entries.push({
            id: 'manual-interest-ignore-external-trends',
            name: ignoreLabel,
            type: 'check',
            checked: () => this.shouldIgnoreExternalTrends(),
            action: async (_, isChecked) => {
                await this.setIgnoreExternalTrends(isChecked)
            }
        })

        return entries
    }

    async getInterestSuggestions(excludeTerms = []) {
        if (!global.lists?.relevantKeywords) {
            return []
        }
        try {
            const tags = await this.tags.get(12)
            return Object.entries(tags || {}).map(([term, weight]) => ({
                id: `manual-interest-suggestion-${term}`,
                name: term,
                type: 'slider',
                fa: 'fas fa-lightbulb',
                details: lang.SUGGESTED,
                range: this.manualInterestRange,
                value: weight,
                question: `${lang.INTERESTS}: ${term}`,
                action: async (entry, value) => {
                    await this.handleSuggestedInterestAction(entry, value, term, weight)
                }
            }))
        } catch (error) {
            EPGErrorHandler.warn('Failed to get interest suggestions:', error?.message || error)
            return []
        }
    }

    async handleSuggestedInterestAction(entry, value, term, fallbackWeight) {
        try {
            if (value === 'remove') {
                if (entry) {
                    entry.value = fallbackWeight
                    entry.details = `${lang.SUGGESTED} - ${this.formatInterestWeight(fallbackWeight)}`
                }
                return
            }

            const numericValue = Number(value)
            if (!Number.isFinite(numericValue)) {
                return
            }

            const normalized = this.clampInterestWeight(numericValue)
            const added = await this.addManualInterest(term, normalized)

            if (!added && entry) {
                entry.value = fallbackWeight
                entry.details = `${lang.SUGGESTED} - ${this.formatInterestWeight(fallbackWeight)}`
            }
        } catch (error) {
            EPGErrorHandler.warn('Failed to handle suggested interest action:', error?.message || error)
            if (entry) {
                entry.value = fallbackWeight
                entry.details = `${lang.SUGGESTED} - ${this.formatInterestWeight(fallbackWeight)}`
            }
        }
    }

    async handleManualInterestAction(entry, value, term) {
        try {
            if (value === 'remove') {
                const removed = await this.removeManualInterest(term)
                if (removed && global.menu?.refreshNow) {
                    setTimeout(() => global.menu.refreshNow(), 10)
                }
                return
            }

            const numericValue = Number(value)
            if (!Number.isFinite(numericValue)) {
                return
            }

            const normalized = this.clampInterestWeight(numericValue)
            await this.updateManualInterest(term, normalized)
            if (entry) {
                entry.value = normalized
                entry.details = this.formatInterestWeight(normalized)
            }
        } catch (error) {
            EPGErrorHandler.warn('Failed to handle manual interest action:', error?.message || error)
        }
    }

    async promptAddManualInterest() {
        if (!global.menu?.prompt) {
            return
        }
        try {
            const response = await global.menu.prompt({
                question: global.lang.INTERESTS || 'Interests',
                message: global.lang.INTERESTS_HINT || '',
                placeholder: global.lang.INTERESTS_HINT || '',
                callback: 'manual-interest-add'
            })

            if (typeof response !== 'string') {
                return
            }

            const trimmed = response.trim()
            if (!trimmed) {
                return
            }

            const delimiter = ','
            const partialTerms = trimmed
                .split(delimiter)
                .map(term => term.trim())
                .filter(Boolean)

            const termsToAdd = new Set()
            const candidates = partialTerms.length ? partialTerms : [trimmed]

            for (const manualTerm of candidates) {
                const flatTerms = terms(manualTerm, true, false)
                if (Array.isArray(flatTerms) && flatTerms.length) {
                    flatTerms.forEach(token => termsToAdd.add(token))
                } else {
                    termsToAdd.add(manualTerm)
                }
            }

            const addedTerms = []
            for (const manualTerm of termsToAdd) {
                const addedTerm = await this.addManualInterest(manualTerm)
                if (addedTerm) {
                    addedTerms.push(addedTerm)
                }
            }

            if (!addedTerms.length && global.menu?.info) {
                global.menu.info(
                    global.lang.INTERESTS || 'Interests',
                    global.lang.INVALID || 'Invalid value',
                    'fas fa-exclamation-circle'
                )
            }
        } catch (error) {
            EPGErrorHandler.warn('Failed to add manual interest:', error?.message || error)
        }
    }

    createManualInterestBusy(message = lang.PROCESSING) {
        if (!global?.menu?.setBusy) {
            return null
        }
        try {
            return global.menu.setBusy(`${lang.RECOMMENDED_FOR_YOU}/${lang.INTERESTS}`, {
                message,
                icon: 'fa-mega busy-x',
                osdId: 'manual-interests'
            })
        } catch (error) {
            EPGErrorHandler.warn('Failed to create manual interest busy lock:', error?.message || error)
            return null
        }
    }

    async addManualInterest(term, weight = 1) {
        const busy = this.createManualInterestBusy()
        try {
            const added = await this.tags.addManualTag(term, this.clampInterestWeight(weight))
            if (added) {
                this.scheduleUpdate()
                await this.refreshRecommendationsForManualTags()
                await this.openManualInterestSlider(added)
            }
            return added
        } finally {
            if (busy && typeof busy.release === 'function') {
                try {
                    busy.release()
                } catch (err) {
                    console.error('Failed to release manual interest busy lock:', err)
                }
            }
        }
    }

    async updateManualInterest(term, weight) {
        const busy = this.createManualInterestBusy()
        try {
            const updated = await this.tags.updateManualTag(term, this.clampInterestWeight(weight))
            if (updated) {
                this.scheduleUpdate()
                await this.refreshRecommendationsForManualTags()
            }
            return updated
        } finally {
            if (busy && typeof busy.release === 'function') {
                try {
                    busy.release()
                } catch (err) {
                    console.error('Failed to release manual interest busy lock:', err)
                }
            }
        }
    }

    async removeManualInterest(term) {
        const busy = this.createManualInterestBusy()
        try {
            const removed = await this.tags.removeManualTag(term)
            if (removed) {
                this.scheduleUpdate()
                await this.refreshRecommendationsForManualTags()
            }
            return removed
        } finally {
            if (busy && typeof busy.release === 'function') {
                try {
                    busy.release()
                } catch (err) {
                    console.error('Failed to release manual interest busy lock:', err)
                }
            }
        }
    }

    async refreshRecommendationsForManualTags() {
        try {
            await this.update()
        } catch (error) {
            EPGErrorHandler.warn('Manual tag change update failed:', error?.message || error)
        }
        if (global.menu?.refreshNow) {
            setTimeout(() => global.menu.refreshNow(), 10)
        }
    }

    async openManualInterestSlider(term) {
        if (!global?.menu || typeof global.menu.get !== 'function') {
            return
        }

        const normalizedTerm = typeof term === 'string' ? term : ''
        if (!normalizedTerm) {
            return
        }

        const path = global.menu.path
        const attemptOpen = () => {
            const matches = global.menu.get({ name: normalizedTerm, type: 'slider' })
            if (matches && matches.length) {
                const element = matches[0]
                element?.click()
                return true
            }
            return false
        }

        if (attemptOpen()) {
            return
        }

        await new Promise(resolve => {
            let timeoutId
            const cleanup = () => {
                clearTimeout(timeoutId)
                if (typeof global.menu.off === 'function') {
                    global.menu.off('render', handler)
                }
                resolve()
            }
            const handler = (renderPath) => {
                if (path && renderPath !== path) {
                    return
                }
                if (attemptOpen()) {
                    cleanup()
                }
            }
            if (typeof global.menu.on === 'function') {
                global.menu.on('render', handler)
            }
            timeoutId = setTimeout(cleanup, 1000)
        })
    }

    /**
     * Helper function to calculate term similarity between channels (Jaccard + name similarity)
     * @param {Object} channel1 - First channel object
     * @param {Object} channel2 - Second channel object
     * @returns {number} Similarity score (0-1)
     */
    calculateTermSimilarity(channel1, channel2) {
        const terms1 = new Set(channel1.terms || [])
        const terms2 = new Set(channel2.terms || [])

        // Jaccard similarity: intersection / union
        const intersection = [...terms1].filter(t => terms2.has(t)).length
        const union = new Set([...terms1, ...terms2]).size
        const jaccardSimilarity = union > 0 ? intersection / union : 0

        // Boost similarity for channels with similar names (e.g., "Premiere 1", "Premiere 2")
        const name1 = channel1.name.toLowerCase()
        const name2 = channel2.name.toLowerCase()

        // Extract base name (remove numbers and common suffixes)
        const baseName1 = name1.replace(/\s+\d+$/, '').replace(/\s+(tv|channel|brasil)$/, '')
        const baseName2 = name2.replace(/\s+\d+$/, '').replace(/\s+(tv|channel|brasil)$/, '')

        // If base names are similar, boost similarity
        if (baseName1 === baseName2 && baseName1.length > 3) {
            return Math.max(jaccardSimilarity, 0.8) // High similarity for same base name
        }

        // Check for partial name matches
        const shorter = name1.length < name2.length ? name1 : name2
        const longer = name1.length >= name2.length ? name1 : name2
        if (longer.includes(shorter) && shorter.length > 4) {
            return Math.max(jaccardSimilarity, 0.7) // Medium-high similarity for partial matches
        }

        return jaccardSimilarity
    }

    /**
     * Helper function to apply diversity filter based on term similarity
     * @param {Array} sortedChannels - Channels sorted by score
     * @param {number} amount - Number of channels to return
     * @param {number} similarityThreshold - Similarity threshold (0-1)
     * @returns {Array} Diverse channels
     */
    applyDiversityFilter(sortedChannels, amount, similarityThreshold = 0.6) {
        const result = []

        for (const channel of sortedChannels) {
            if (result.length >= amount) break

            const currentChannel = {
                name: channel.name,
                terms: channel.terms || [],
                score: channel.score
            }

            // Check if current channel is too similar to already selected ones
            const isTooSimilar = result.some(selectedChannel => {
                const similarity = this.calculateTermSimilarity(currentChannel, selectedChannel)
                if (similarity > 0) {
                }
                return similarity > similarityThreshold
            })

            if (!isTooSimilar) {
                result.push(currentChannel)
            }
        }

        return result
    }

    /**
     * Transform recommendations to expected format
     * @param {Array} recommendations - Smart recommendations
     * @returns {Array} Transformed recommendations
     */
    transformRecommendations(recommendations) {
        return recommendations.map((rec, index) => {
            // VOD entries: return directly without toMetaEntry transformation
            if (rec.type === 'vod' && rec.entry) {
                // Return the original entry directly, just add metadata
                const entry = { ...rec.entry };
                
                // Add recommendation metadata
                entry.source = rec.source || entry.source || 'smart-recommendations';
                entry.score = (typeof rec.finalScore === 'number'
                    ? rec.finalScore
                    : (typeof rec.score === 'number' ? rec.score : entry.score)) || 0;
                entry.normalizedScore = typeof rec.normalizedScore === 'number'
                    ? rec.normalizedScore
                    : entry.normalizedScore;
                entry.timingScore = typeof rec.timingScore === 'number'
                    ? rec.timingScore
                    : entry.timingScore;
                entry.finalScore = typeof rec.finalScore === 'number'
                    ? rec.finalScore
                    : entry.finalScore;
                
                // Remove type if it's 'vod' (type has special meaning for Streamer and Menu)
                if (entry.type === 'vod') {
                    delete entry.type;
                } else if (!entry.type) {
                    entry.type = 'stream';
                }
                
                // Preserve title/name
                if (rec.title && entry.name !== rec.title) {
                    entry.name = rec.title;
                }
                
                // Preserve icon
                if (rec.icon && !entry.icon) {
                    entry.icon = rec.icon;
                }
                
                // Preserve group/category
                if (rec.channel && !entry.group) {
                    entry.group = rec.channel;
                }
                
                return entry;
            }
            
            // Live entries: use toMetaEntry transformation
            // Check if toMetaEntry is available
            if (!global.channels?.toMetaEntry) {
                return null;
            }

            // Handle different channel data formats
            let channelName, channelObj
            if (typeof rec.channel === 'string') {
                channelName = rec.channel
                channelObj = global.channels?.isChannel?.(rec.channel) || { name: rec.channel }
            } else if (rec.channel?.name) {
                channelName = rec.channel.name
                channelObj = rec.channel
            } else {
                channelName = 'Unknown Channel'
                channelObj = { name: channelName }
            }

            // Create entry using global.channels.toMetaEntry
            const entry = global.channels.toMetaEntry(channelObj)

            // Add programme information
            if (rec.programme) {
                entry.programme = rec.programme
                // Use programme title (title) if available, otherwise fall back to channel name
                entry.name = rec.programme.title || rec.title || entry.name
            } else if (rec.title) {
                // If no programme object but we have title directly (EPG data structure)
                entry.name = rec.title
                entry.programme = rec // Store the full programme data
            }

            // Set channel information
            entry.originalName = channelName
            if (entry.rawname) {
                entry.rawname = channelName
            }

            // Set icon
            if (rec.programme?.icon || rec.icon) {
                entry.icon = rec.programme?.icon || rec.icon
            }

            if (typeof entry.details !== 'string') {
                entry.details = ''
            }

            // Set timing and details
            const startTime = rec.start || rec.programme?.start
            if (startTime && startTime < Date.now() / 1000) {
                // Live programmes: keep type='select' for direct playback
                entry.details += '<i class="fas fa-play-circle"></i> ' + (global.lang.LIVE || 'Live')
            } else if (startTime) {
                // Future programmes: use type='action' for scheduling
                entry.details += '<i class="fas fa-clock"></i> ' + this.ts2clock(startTime)
                entry.type = 'action'

                // Capture values for the action function to avoid closure issues
                const programmeData = rec.programme || rec || {}
                const tms = channelObj?.terms

                entry.action = () => {
                    global.channels?.epgProgramAction?.(startTime, channelName, programmeData, tms)
                }
            }

            // Add channel name to details
            entry.och = rec.och
            entry.details = (entry.details ? entry.details + ' &middot; ' : '') + channelName
            entry.source = 'smart-recommendations'
            const finalScore = typeof rec.finalScore === 'number'
                ? rec.finalScore
                : (typeof rec.score === 'number'
                    ? rec.score
                    : (typeof rec.programme?.score === 'number' ? rec.programme.score : 0))
            entry.score = finalScore
            entry.finalScore = finalScore
            entry.normalizedScore = typeof rec.normalizedScore === 'number'
                ? rec.normalizedScore
                : entry.normalizedScore
            entry.timingScore = typeof rec.timingScore === 'number'
                ? rec.timingScore
                : entry.timingScore

            if (entry.programme) {
                entry.programme.score = finalScore
                entry.programme.finalScore = finalScore
                if (typeof entry.normalizedScore === 'number') {
                    entry.programme.normalizedScore = entry.normalizedScore
                }
                if (typeof entry.timingScore === 'number') {
                    entry.programme.timingScore = entry.timingScore
                }
            }

            return entry
        }).filter(entry => entry !== null) // Remove any null entries (when toMetaEntry not available)
    }

    /**
     * Transform channel recommendations
     * @param {Array} recommendations - Smart recommendations
     * @returns {Array} Transformed channel recommendations
     */
    transformChannelRecommendations(recommendations) {
        return recommendations.map(rec => {
            return global.channels.toMetaEntry({
                name: rec.name,
                url: global.mega?.build(rec.name, { mediaType: 'live', terms: rec.terms })
            })
        })
    }

    /**
     * Get current user ID
     * @returns {string} User ID
     */
    getCurrentUserId() {
        // Try to get user ID from various sources
        return global.user?.id || global.config?.get('user-id') || 'anonymous'
    }

    /**
     * Get user tags
     * @returns {Promise<Object>} User tags
     */
    async getUserTags() {
        try {
            if (this.tags) {
                const ignoreExternal = this.shouldIgnoreExternalTrends()
                const tags = await this.tags.get(undefined, ignoreExternal)
                if (ignoreExternal && (!tags || !Object.keys(tags).length)) {
                    EPGErrorHandler.info('Ignore external trends enabled, but no manual tags found.')
                }
                if (tags && typeof tags === 'object') {
                    // Keep numeric tags as-is for precise scoring
                    const numericTags = {}
                    for (const [key, value] of Object.entries(tags)) {
                        if (typeof value === 'number' && value > 0) {
                            // Keep numeric values for precise scoring
                            numericTags[key] = value
                        } else if (typeof value === 'boolean' && value) {
                            // Convert boolean true to numeric 1.0
                            numericTags[key] = 1.0
                        } else if (Array.isArray(value)) {
                            // Convert arrays to numeric based on length
                            numericTags[key] = Math.min(value.length * 0.5, 2.0)
                        } else if (typeof value === 'string') {
                            // Convert strings to numeric based on length
                            numericTags[key] = Math.min(value.length * 0.1, 1.0)
                        }
                        // Skip zero or negative values
                    }

                    return numericTags
                }
                return { default: 1.0 }
            }
            return { default: true }
        } catch (error) {
            EPGErrorHandler.warn('Failed to get user tags:', error.message)
            return { default: true }
        }
    }

    /**
     * Process EPG recommendations data
     * @param {Object} data - EPG data
     * @returns {Promise<Array>} Processed recommendations
     */
    async processEPGRecommendations(data) {
        try {
            data = await this.validateChannels(data)
            const results = [], already = new Set()

            for (const ch in data) {
                let channel = global.channels?.isChannel(ch)
                if (channel) {
                    let t
                    for (const programme of data[ch]) {
                        if (!t) {
                            t = programme.title
                            if (already.has(t)) return // prevent same program on diff channels
                            already.add(t)
                        }
                        results.push({
                            channel,
                            labels: programme.categories,
                            programme,
                            start: parseInt(programme.start),
                            och: ch
                        })
                    }
                }
            }
            return results
        } catch (error) {
            EPGErrorHandler.warn('Failed to process EPG recommendations:', error.message)
            return []
        }
    }

    /**
     * Validate channels for recommendations
     * @param {Object} data - Channel data
     * @returns {Promise<Object>} Validated channels
     */
    async validateChannels(data) {
        try {
            const chs = {}, now = Date.now() / 1000
            for (const ch in data) {
                let channel = global.channels?.isChannel(ch)
                if (channel) {
                    if (typeof (chs[channel.name]) === 'undefined') {
                        chs[channel.name] = global.channels?.epgPrepareSearch(channel)
                        chs[channel.name].candidates = []
                    }
                    for (const p in data[ch]) {
                        if (parseInt(p) <= now && data[ch][p].end < now) {
                            chs[channel.name].candidates.push({
                                title: data[ch][p].title,
                                channel: ch
                            })
                            break
                        }
                    }
                }
            }
            const ret = {}, alloweds = await global.lists?.epg?.validateChannels(chs)
            for (const ch in alloweds) {
                ret[ch] = data[ch]
            }
            return ret
        } catch (error) {
            EPGErrorHandler.warn('Failed to validate channels:', error.message)
            return data
        }
    }

    /**
     * Get fallback entries when smart system fails
     * @param {boolean} vod - Whether VOD
     * @param {number} limit - Limit
     * @returns {Array} Fallback entries
     */
    async getFallbackEntries(vod, limit) {
        const entries = []

        // Check if EPG is loaded (loaded can be an array of URLs or boolean)
        const epgLoaded = global.lists?.epg?.loaded
        if (epgLoaded && (!Array.isArray(epgLoaded) || epgLoaded.length > 0)) {
            if (vod) {
                entries.push({
                    name: global.lang.NO_RECOMMENDATIONS_YET || 'No Recommendations Yet',
                    type: 'action',
                    fa: 'fas fa-info-circle',
                    class: 'entry-empty',
                    action: async () => {
                        // Show dialog
                    }
                })
            } else {
                const featured = await this.featuredEntries(limit)
                if (Array.isArray(featured)) {
                    entries.push(...featured)
                }
                entries.unshift(entries.length ? this.getImproveEntry() : this.getNoRecommendationsEntry())
            }
        } else {
            entries.push({
                name: global.lang.EPG_DISABLED || 'EPG Disabled',
                type: 'action',
                fa: 'fas fa-times-circle',
                class: 'entry-empty',
                action: async () => {
                    await global.menu?.open(global.lang.EPG || 'EPG')
                }
            })
        }

        return entries
    }

    /**
     * Get improve entry
     * @returns {Object} Improve entry
     */
    getImproveEntry() {
        return {
            name: global.lang.IMPROVE_YOUR_RECOMMENDATIONS || 'Improve Your Recommendations',
            type: 'action',
            fa: 'fas fa-info-circle',
            class: 'entry-empty',
            action: async () => {
                // Show dialog
            }
        }
    }

    /**
     * Get no recommendations entry
     * @returns {Object} No recommendations entry
     */
    getNoRecommendationsEntry() {
        return {
            name: global.lang.NO_RECOMMENDATIONS_YET || 'No Recommendations Yet',
            type: 'action',
            fa: 'fas fa-info-circle',
            class: 'entry-empty',
            action: async () => {
                // Show dialog
            }
        }
    }

    /**
     * Get watched entry
     * @returns {Object} Watched entry
     */
    getWatchedEntry() {
        return {
            name: global.lang.WATCHED || 'Watched',
            fa: 'fas fa-history',
            type: 'group',
            renderer: global.channels?.history?.epg?.historyEntries?.bind(global.channels.history.epg)
        }
    }

    /**
     * Schedule update
     */
    scheduleUpdate() {
        // Check if we should update based on satisfyAmount conditions
        if (this.shouldUpdate()) {
            EPGErrorHandler.info('🔄 Smart Recommendations: Scheduling update due to system readiness')
            
            // Add to queue (limiter already handles minimum interval)
            return this.updateQueue.add(async () => {
                return this.performUpdate()
            }).then(() => {
                EPGErrorHandler.info('✅ Smart Recommendations: Auto-update completed')
            }).catch(err => {
                EPGErrorHandler.warn('⚠️ Smart Recommendations: Auto-update failed:', err.message)
                throw err
            })
        }
    }

    /**
     * Start periodic updates using setInterval (guarantees at least one update every 5 minutes)
     */
    startPeriodicUpdates() {
        // Clear any existing interval
        if (this.periodicUpdateInterval) {
            clearInterval(this.periodicUpdateInterval)
        }

        // Set interval to trigger update check at least every 5 minutes
        const intervalMs = this.updateIntervalSecs * 1000 // 300000 ms = 5 minutes
        this.periodicUpdateInterval = setInterval(() => {
            // Use limiter to prevent too frequent updates (respects 3 seconds minimum)
            this.updateLimiter.call().catch(err => {
                EPGErrorHandler.warn('Periodic update check failed:', err.message)
            })
        }, intervalMs)

        EPGErrorHandler.info(`⏰ Started periodic updates: at least once every ${this.updateIntervalSecs} seconds`)
    }

    /**
     * Stop periodic updates
     */
    stopPeriodicUpdates() {
        if (this.periodicUpdateInterval) {
            clearInterval(this.periodicUpdateInterval)
            this.periodicUpdateInterval = null
            EPGErrorHandler.info('⏰ Stopped periodic updates')
        }
        if (this.updateLimiter) {
            this.updateLimiter.destroy()
        }
    }

    /**
     * Check if we should update based on satisfyAmount conditions
     */
    shouldUpdate() {
        const epgReady = this.epgLoaded || (global.lists?.epg?.loadedEPGs > 0) || !this.isEPGEnabled()
        const listsReady = this.listsLoaded || this.someListLoaded
        const channelsReady = global.channels?.channelList?.categories &&
            Object.keys(global.channels.channelList.categories).length > 0

        // Can update if system is initialized and either:
        // 1. EPG + Lists are ready (full recommendations)
        // 2. Channels are ready (channel-based recommendations)
        const canUpdate = this.initialized && (
            (epgReady && listsReady) || // Full recommendations with EPG
            channelsReady // Channel-only recommendations
        )

        if (canUpdate) {
            const reason = (epgReady && listsReady) ? 'EPG+Lists' : 'Channels'
            EPGErrorHandler.info(`🔄 Smart Recommendations: Update conditions met - Reason: ${reason}, EPG: ${epgReady}, Lists: ${listsReady}, Channels: ${channelsReady}, Initialized: ${this.initialized}`)
            return true
        }

        return false
    }

    maybeUpdateUI(es) {
        if (Array.isArray(es)) {
            this.latestEntries = es
        }
        if (this.updateUIQueue.size) return
        this.updateUIQueue.add(async () => {
            if (!this.latestEntries?.length) return
            const entries = this.latestEntries || []
            const currentEntries = global.menu?.currentEntries?.filter(e => e.hookId === this.hookId) || []
            const isBusy = currentEntries.some(e => e.hookId === this.hookId && e.id?.startsWith(this.hookId + '-busy-'))
            const busyOut = entries.some(e => !e?.id?.startsWith(this.hookId + '-busy-'))
            let shouldUpdate = !currentEntries.length || (isBusy && busyOut)
            if (!shouldUpdate) {
                const sameNames = currentEntries.slice(0, entries.length).every((e, i) => e.name === entries[i]?.name)
                shouldUpdate = !sameNames
            }
            if (shouldUpdate) {
                await new Promise(ready)
                await global.menu?.updateHomeFilters().catch(err => global.menu?.displayError(err))
            }
        })
    }

    ensureInitialUIUpdate() {
        if (this.ensuredInitialUIUpdate) return

        const currentEntries = global.menu?.currentEntries?.filter(e => e.hookId === this.hookId) || []
        const isBusy = currentEntries.some(e => e.hookId === this.hookId && e.id?.startsWith(this.hookId + '-busy-'))

        if (currentEntries.length && !isBusy) {
            this.ensuredInitialUIUpdate = true
            this.initialUIUpdateTimeout && clearTimeout(this.initialUIUpdateTimeout)
            return
        } else {
            this.maybeUpdateUI()
        }

        this.initialUIUpdateTimeout && clearTimeout(this.initialUIUpdateTimeout)
        this.initialUIUpdateTimeout = setTimeout(() => {
            this.ensureInitialUIUpdate()
        }, 1000)
        EPGErrorHandler.debug('⏳ Initial UI update not ensured, will update later')
    }


    /**
     * Check if cache is valid
     * @param {Object} cacheData - Cache data from storage
     * @returns {boolean} True if cache is valid
     */
    isCacheValid(cacheData) {
        return cacheData &&
            cacheData.featured &&
            cacheData.timestamp &&
            (Date.now() - cacheData.timestamp) < this.cacheMaxAge
    }

    isCacheRich(cacheData) {
        return cacheData && this.isCacheValid(cacheData) && cacheData.featured.some(e => !!e?.programme?.channel)
    }

    /**
     * Get cached featured entries from storage
     * @returns {Promise<Array|null>} Cached entries or null
     */
    async getCache() {
        try {
            const cacheData = await storage.get(this.cacheKey)

            if (this.isCacheValid(cacheData)) {
                // Don't invalidate cache with busy entries - allow them to be shown until real recommendations are available
                // The cache will be naturally replaced when generateFeaturedEntries creates real recommendations
                // This prevents the UI from being empty during the transition period

                cacheData.featured = cacheData.featured.map(e => {
                    // Skip toMetaEntry for placeholder entries
                    if (e && e.name === ' &nbsp;' && e.class && e.class.includes('entry-busy-x')) {
                        return e // Return placeholder entry as-is
                    }
                    // Preserve icon and programme.icon before calling toMetaEntry
                    // toMetaEntry may overwrite these, so we need to restore them
                    const preservedIcon = e?.icon
                    const preservedProgrammeIcon = e?.programme?.icon
                    const metaEntry = global.channels?.toMetaEntry(e) || e
                    // Always restore icon if it was set (toMetaEntry may have overwritten it)
                    if (preservedIcon) {
                        metaEntry.icon = preservedIcon
                    }
                    // Always restore programme.icon if it was set
                    if (preservedProgrammeIcon && metaEntry.programme) {
                        metaEntry.programme.icon = preservedProgrammeIcon
                    }
                    return metaEntry
                })
                return cacheData.featured
            }

            return null
        } catch (error) {
            EPGErrorHandler.warn('Failed to get cache from storage:', error.message)
            return null
        }
    }

    /**
     * Set cached featured entries to storage
     * @param {Array} entries - Entries to cache
     */
    async setCache(entries) {
        if (!Array.isArray(entries)) {
            EPGErrorHandler.warn('Invalid entries for caching:', typeof entries)
            return
        }

        try {
            const cacheData = {
                featured: entries,
                timestamp: Date.now()
            }

            await storage.set(this.cacheKey, cacheData, { ttl: 300 }) // 5 minutes TTL
            this.maybeUpdateUI(entries)
        } catch (error) {
            EPGErrorHandler.warn('Failed to save cache to storage:', error.message)
        }
    }

    invalidateRecommendationCaches(reason = 'manual') {
        const context = `Smart Recommendations cache invalidation (${reason})`

        try {
            this.clearCache().catch(err => {
                EPGErrorHandler.warn(`${context}: storage cache clear failed`, err?.message || err)
            })
        } catch (err) {
            EPGErrorHandler.warn(`${context}: storage cache clear threw`, err?.message || err)
        }

        if (!this.initialized || !this.smartRecommendations) {
            return
        }

        const userId = this.getCurrentUserId()

        try {
            this.smartRecommendations.cache?.invalidateByUser(userId)
            this.smartRecommendations.cache?.invalidateByTags?.(['recommendations'])
        } catch (err) {
            EPGErrorHandler.warn(`${context}: smartRecommendations cache invalidation failed`, err?.message || err)
        }

        try {
            const enhancedCache = this.smartRecommendations.enhancedRecommendations?.cache
            enhancedCache?.invalidateByUser?.(userId)
            enhancedCache?.invalidateByTags?.(['recommendations', 'tags', 'expansion'])
        } catch (err) {
            EPGErrorHandler.warn(`${context}: enhanced recommendations cache invalidation failed`, err?.message || err)
        }
    }

    /**
     * Clear cache from storage
     */
    async clearCache() {
        try {
            // Instead of dropping cached entries completely, preserve them but mark as expired.
            // This allows featuredEntries() to still use in-memory fallbacks and avoids
            // the home screen going empty after EPG/list updates.
            const cacheData = await storage.get(this.cacheKey)
            if (cacheData && Array.isArray(cacheData.featured) && cacheData.featured.length) {
                cacheData.timestamp = 0
                await storage.set(this.cacheKey, cacheData, { ttl: 300 })
                EPGErrorHandler.info('🗑️ Smart recommendations cache timestamp invalidated (entries preserved)')
            } else {
                await storage.set(this.cacheKey, null, { ttl: 0 })
                EPGErrorHandler.info('🗑️ Smart recommendations cache cleared from storage (no entries to preserve)')
            }
        } catch (error) {
            EPGErrorHandler.warn('Failed to clear cache from storage:', error.message)
        }
    }

    /**
     * Clear all recommendation caches (storage + in-memory)
     * @param {string} reason - Optional reason for logging
     */
    async clear(reason = 'manual') {
        const context = `Smart Recommendations full cache clear (${reason})`

        await this.clearCache().catch(err => {
            EPGErrorHandler.warn(`${context}: storage cache clear failed`, err?.message || err)
        })

        const tasks = []

        if (this.tags?.clearCache) {
            tasks.push(
                this.tags.clearCache().catch(err =>
                    EPGErrorHandler.warn(`${context}: tags cache clear failed`, err?.message || err)
                )
            )
        }

        try {
            this.smartRecommendations?.cache?.clear?.()
        } catch (err) {
            EPGErrorHandler.warn(`${context}: smartRecommendations cache clear failed`, err?.message || err)
        }

        try {
            this.smartRecommendations?.enhancedRecommendations?.cache?.clear?.()
        } catch (err) {
            EPGErrorHandler.warn(`${context}: enhanced recommendations cache clear failed`, err?.message || err)
        }

        if (tasks.length) {
            await Promise.allSettled(tasks)
        }

        this.latestEntries = []
    }


    /**
     * Convert timestamp to clock format
     * @param {number} timestamp - Timestamp
     * @returns {string} Clock format
     */
    ts2clock(timestamp) {
        const date = new Date(timestamp * 1000)
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }

    /**
     * Expand tags using AI Client (delegates to internal smartRecommendations)
     * @param {Object} tags - Tags to expand
     * @param {Object} options - Options {as: 'objects'|'default', amount: number}
     * @returns {Promise<Array|Object>} Related tags
     */
    async expandTags(tags, options = {}) {
        if (!this.initialized || !this.aiClient) {
            return options.as === 'objects' ? [] : {}
        }

        try {
            const response = await this.aiClient.expandTags(tags, {
                limit: options.amount || 20,
                threshold: options.threshold || 0.6,
                locale: lang.locale || 'pt'
            })

            const expandedTags = response.expandedTags || {}

            // Format based on requested output type
            if (options.as === 'objects') {
                return Object.entries(expandedTags).map(([category, score]) => ({
                    category: category.toLowerCase(),
                    score
                }))
            }

            // Return as object
            return expandedTags

        } catch (error) {
            EPGErrorHandler.warn('expandTags failed:', error.message)
            return options.as === 'objects' ? [] : {}
        }
    }

    /**
     * Expand user tags (delegates to internal smartRecommendations)
     * @param {Object} userTags - User tags
     * @param {Object} options - Expansion options
     * @returns {Promise<Object>} Expanded tags
     */
    async expandUserTags(userTags, options = {}) {
        if (!this.initialized || !this.smartRecommendations) {
            return userTags
        }
        return this.smartRecommendations.expandUserTags(userTags, options)
    }

    /**
     * Reduce/cluster tags using AI semantic similarity
     * Groups similar tags together and returns a reduced set
     * @param {Array} tags - Array of tag names to cluster
     * @param {Object} options - Options {amount: number}
     * @returns {Promise<Object>} Clustered tags object where keys are cluster representatives and values are arrays of similar tags
     */
    async reduceTags(tags, options = {}) {
        const { amount = 20 } = options

        if (!this.initialized || !this.aiClient || !Array.isArray(tags) || tags.length === 0) {
            EPGErrorHandler.warn('Cannot reduce tags: system not initialized or invalid input')
            return {}
        }

        // If we already have fewer tags than requested, return them as-is
        if (tags.length <= amount) {
            const result = {}
            tags.forEach(tag => {
                result[tag] = [tag]
            })
            return result
        }

        try {
            EPGErrorHandler.info(`🔄 Reducing ${tags.length} tags to ~${amount} clusters...`)

            // Use AI Client to cluster tags
            const response = await this.aiClient.clusterTags(tags, {
                clusters: amount,
                locale: lang.locale || 'pt'
            })

            const clusters = response.clusters || {}

            // If AI clustering failed, use fallback
            if (Object.keys(clusters).length === 0) {
                EPGErrorHandler.warn('AI clustering returned empty, using fallback')
                const fallback = {}
                tags.slice(0, amount).forEach(tag => {
                    fallback[tag] = [tag]
                })
                return fallback
            }

            EPGErrorHandler.info(`✅ Reduced tags: ${tags.length} tags → ${Object.keys(clusters).length} clusters`)

            return clusters

        } catch (error) {
            EPGErrorHandler.error('Failed to reduce tags:', error)
            // Fallback: return each tag as its own cluster
            const fallback = {}
            tags.slice(0, amount).forEach(tag => {
                fallback[tag] = [tag]
            })
            return fallback
        }
    }

    /**
     * Calculate simple string similarity (Levenshtein-like)
     * @param {string} str1 - First string
     * @param {string} str2 - Second string
     * @returns {number} Similarity score (0-1)
     */
    calculateStringSimilarity(str1, str2) {
        const longer = str1.length > str2.length ? str1 : str2
        const shorter = str1.length > str2.length ? str2 : str1
        
        if (longer.length === 0) {
            return 1.0
        }
        
        // Check if one string contains the other
        if (longer.includes(shorter)) {
            return shorter.length / longer.length
        }
        
        // Simple character overlap
        const chars1 = new Set(str1.split(''))
        const chars2 = new Set(str2.split(''))
        const intersection = [...chars1].filter(c => chars2.has(c)).length
        const union = new Set([...chars1, ...chars2]).size
        
        return union > 0 ? intersection / union : 0
    }

    /**
     * Destroy the compatibility wrapper instance
     */
    destroy() {
        // Stop periodic updates
        this.stopPeriodicUpdates()
        
        // Clear any pending updates in the queue
        this.updateQueue.clear()
        this.updateUIQueue.clear()
    }
}

// Create and export singleton instance
const smartRecommendationsCompatibility = new SmartRecommendationsCompatibility()

export default smartRecommendationsCompatibility

