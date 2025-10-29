import { EventEmitter } from 'node:events'
import smartRecommendations from './index.mjs'
import { EPGErrorHandler } from '../epg-worker/EPGErrorHandler.js'
import storage from '../storage/storage.js'
import lang from '../lang/lang.js'
import { Tags } from './tags.mjs'
import { ready } from '../bridge/bridge.js'
import PQueue from 'p-queue'
import { terms, match } from '../lists/tools.js'
import { AIClient } from './ai-client/AIClient.mjs'

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

        // UI update system
        this.latestEntries = []
        this.ensuredInitialUIUpdate = false
        this.initialUIUpdateTimeout = null
        this.hookId = 'recommendations'

        // Initialize tags system
        this.tags = new Tags()
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
                        this.setupEventListeners()
                    } catch (error) {
                        EPGErrorHandler.warn('⚠️ Failed to setup event listeners:', error.message)
                    }
                    resolve()
                })
            })

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
    setupEventListeners() {
        // Listen for EPG updates - check if global.lists has EventEmitter methods
        global.lists.on('list-loaded', () => {
            if (!this.someListLoaded && this.readyState < 4) {
                this.someListLoaded = true
                this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
            }
        })

        global.lists.on('epg-update', () => {
            this.epgLoaded || this.clearCache()
            this.epgLoaded = true
            this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
        })

        global.lists.ready().then(async () => {
            this.listsLoaded = true
            this.maybeUpdateCache().catch(err => EPGErrorHandler.warn('Failed to maybe update cache:', err.message))
        }).catch(err => EPGErrorHandler.warn('Failed to wait for lists ready:', err.message))

        // Listen for language ready
        global.lang.ready().catch(err => EPGErrorHandler.warn('Failed to wait for lang ready:', err.message)).finally(() => {
            global.lists.epgReady().then(() => {
                this.epgLoaded || this.clearCache()
                this.epgLoaded = true
                this.scheduleUpdate()
            }).catch(err => console.error(err))
        })

        // Listen for channels ready
        global.channels.ready().then(() => {
            EPGErrorHandler.info('📺 Channels loaded, scheduling smart recommendations update')
            this.maybeUpdateCache()
        }).catch(err => EPGErrorHandler.warn('Failed to wait for channels ready:', err.message))
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
        const epgLoaded = global.lists?.epg?.loaded
        if (!epgLoaded || (Array.isArray(epgLoaded) && epgLoaded.length === 0)) {
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

            return transformed

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

            if (type !== 'vod' && entries.length) {
                entries.push(this.getWatchedEntry())
            }

            return entries

        } catch (error) {
            EPGErrorHandler.warn('Smart entries with specials failed:', error.message)
            return this.getFallbackEntries(type === 'vod', amount)
        }
    }

    /**
     * Update recommendations (queued using p-queue to prevent simultaneous updates)
     * If there's already an item waiting in queue, skip and return immediately
     */
    async update() {
        // Check if there's already an item waiting in queue (size > 0 means items waiting)
        if (this.updateQueue.size > 0) {
            // Return a resolved promise instead of undefined
            return Promise.resolve()
        }

        try {
            return await this.updateQueue.add(async () => {
                return this.performUpdate()
            })
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

        // Cache the results
        await this.setCache(entries)
        this.readyState = ((this.epgLoaded || !this.isEPGEnabled()) && this.listsLoaded) ? 4 : 3

    }

    /**
     * Get featured entries
     * @param {number} amount - Number of entries
     * @returns {Promise<Array>} Featured entries
     */
    async featuredEntries(amount = 5) {
        // Try to get from cache first (without availability filter)
        let results = await this.getCache()

        // If no cache, generate more entries than needed to account for filtering
        if (!results) {
            // Generate 3x more entries to ensure we have enough after filtering
            const bufferAmount = Math.max(amount * 3, 256)
            results = await this.generateFeaturedEntries(bufferAmount)
            await this.setCache(results)
        }

        // Filter only available channels (test availability each time)
        const channelsToTest = {}
        for (const entry of results) {
            const name = entry?.programme?.ch || entry?.name
            const channel = global.channels.isChannel(name)
            if (channel && typeof(channelsToTest[channel.name]) === 'undefined') {
                channelsToTest[channel.name] = channel
            }
        }

        const availableResults = [], nonAvailableResults = []
        const availableChannels = await global.lists.has(Object.values(channelsToTest))
        for (const entry of results) {
            const name = entry?.programme?.ch || entry?.name
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

        // Return requested amount of available entries
        const result = [...availableResults.slice(0, amount)]
        if (result.length < amount) {
            result.push(...nonAvailableResults.slice(0, amount - result.length))
        }
        return result
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

        // Only show placeholders if system is not initialized AND no channels available
        if (results.length === 0 && !this.initialized) {
            const emptyEntries = Array(amount).fill(null)
            results.push(...emptyEntries.map((_, i) => ({
                name: ' &nbsp;',
                fa: 'fa-mega',
                type: 'action',
                class: 'entry-icon-no-fallback entry-busy-x',
                id: 'recommendations-busy-' + i,
                action: () => { }
            })))
        }

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
                name: global.lang.RECOMMENDED_FOR_YOU || 'Recommended for You',
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: global.lang.LIVE || 'Live',
                hookId,
                renderer: this.getEntriesWithSpecials.bind(this, null, 25, { type: 'live' })
            }

            if (entries.some(e => e.hookId === entry.hookId)) {
                entries = entries.filter(e => e.hookId !== entry.hookId)
            }
            entries.unshift(entry)
        } else if (path === global.lang.CATEGORY_MOVIES_SERIES) {
            const entry = {
                name: global.lang.RECOMMENDED_FOR_YOU || 'Recommended for You',
                fa: 'fas fa-solid fa-thumbs-up',
                type: 'group',
                details: global.lang.CATEGORY_MOVIES_SERIES || 'Movies & Series',
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
        // Check if toMetaEntry is available once (performance optimization)
        if (!global.channels?.toMetaEntry) {
            return []
        }

        return recommendations.map((rec, index) => {

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

            // Create entry using global.channels.toMetaEntry (already checked above)
            const entry = global.channels.toMetaEntry(channelObj)

            // Add programme information
            if (rec.programme) {
                entry.programme = rec.programme
                // Use programme title (t) if available, otherwise fall back to channel name
                entry.name = rec.programme.t || rec.t || entry.name
            } else if (rec.t) {
                // If no programme object but we have title directly (EPG data structure)
                entry.name = rec.t
                entry.programme = rec // Store the full programme data
            }

            // Set channel information
            entry.originalName = channelName
            if (entry.rawname) {
                entry.rawname = channelName
            }

            // Set icon
            if (rec.programme?.i || rec.i) {
                entry.icon = rec.programme?.i || rec.i
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
            entry.confidence = rec.confidence || 0.5

            return entry
        })
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
                const tags = await this.tags.get()
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
                            t = programme.t
                            if (already.has(t)) return // prevent same program on diff channels
                            already.add(t)
                        }
                        results.push({
                            channel,
                            labels: programme.c,
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
                        if (parseInt(p) <= now && data[ch][p].e < now) {
                            chs[channel.name].candidates.push({
                                t: data[ch][p].t,
                                ch
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
            this.update()
                .then(() => {
                    EPGErrorHandler.info('✅ Smart Recommendations: Auto-update completed')
                })
                .catch(err => {
                    EPGErrorHandler.warn('⚠️ Smart Recommendations: Auto-update failed:', err.message)
                })
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
        return cacheData && this.isCacheValid(cacheData) && cacheData.featured.some(e => !!e?.programme?.ch)
    }

    /**
     * Get cached featured entries from storage
     * @returns {Promise<Array|null>} Cached entries or null
     */
    async getCache() {
        try {
            const cacheData = await storage.get(this.cacheKey)

            if (this.isCacheValid(cacheData)) {

                // Check if cache contains only busy entries
                const hasBusyEntries = cacheData.featured?.some(e => e?.id?.startsWith('recommendations-busy-'))
                const hasRealEntries = cacheData.featured?.some(e => !e?.id?.startsWith('recommendations-busy-'))

                // If system is initialized and lists are loaded, invalidate cache if it only has busy entries
                if (this.initialized && this.listsLoaded && hasBusyEntries && !hasRealEntries) {
                    EPGErrorHandler.debug('getCache: Invalidating cache with only busy entries (system ready, should have real channels)')
                    return null
                }

                cacheData.featured = cacheData.featured.map(e => {
                    // Skip toMetaEntry for placeholder entries
                    if (e && e.name === ' &nbsp;' && e.class && e.class.includes('entry-busy-x')) {
                        return e // Return placeholder entry as-is
                    }
                    return global.channels?.toMetaEntry(e) || e
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

    /**
     * Clear cache from storage
     */
    async clearCache() {
        try {
            await storage.set(this.cacheKey, null, { ttl: 0 })
            EPGErrorHandler.info('🗑️ Smart recommendations cache cleared from storage')
        } catch (error) {
            EPGErrorHandler.warn('Failed to clear cache from storage:', error.message)
        }
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
}

// Create and export singleton instance
const smartRecommendationsCompatibility = new SmartRecommendationsCompatibility()

export default smartRecommendationsCompatibility

