import { EventEmitter } from 'node:events'
import { EPGErrorHandler } from '../epg/worker/EPGErrorHandler.js'
import { AITagExpansion } from './AITagExpansion.mjs'
import { SmartCache } from './SmartCache.mjs'

/**
 * Enhanced Recommendations System
 * Intelligent recommendations using AI Client
 */
export class EnhancedRecommendations extends EventEmitter {
    constructor(aiClient) {
        super()
        this.aiClient = aiClient
        this.aiTagExpansion = new AITagExpansion(aiClient)
        // SemanticContentDiscovery removed - not used
        // TriasLearningSystem removed - learning not needed with AI
        this.cache = new SmartCache({
            maxSize: 2000,
            defaultTTL: 300000, // 5 minutes
            cleanupInterval: 60000 // 1 minute
        })
        this.config = {
            defaultLimit: 25,
            maxRetries: 3,
            timeout: 10000,
            semanticWeight: 0.6,
            traditionalWeight: 0.4
        }
        this.readyState = 0
        this.normalizedScoreWeight = 3
        this.performanceMetrics = {
            requestCount: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            expansionTime: []
        }
    }

    /**
     * Get intelligent recommendations
     * @param {Object} userContext - User context and preferences
     * @param {Object} options - Recommendation options
     * @returns {Promise<Array>} Enhanced recommendations
     */
    async getRecommendations(userContext, options = {}) {
        const startTime = Date.now()
        this.performanceMetrics.requestCount++

        try {
            // Validate user context
            this.validateUserContext(userContext)

            // Generate cache key
            const cacheKey = this.generateCacheKey(userContext, options)

            // Check cache first
            let recommendations = this.cache.get(cacheKey)
            if (recommendations) {
                this.performanceMetrics.cacheHitRate =
                    (this.performanceMetrics.cacheHitRate + 1) / 2
                return recommendations
            }

            // Generate new recommendations
            recommendations = await this.generateRecommendations(userContext, options)

            // Cache the results ONLY if not empty
            // Empty results may be due to errors/timeouts and shouldn't be cached
            if (recommendations && recommendations.length > 0) {
                this.cache.set(cacheKey, recommendations,
                    [`user:${userContext.userId}`, 'recommendations'], 2)
                EPGErrorHandler.debug(`Cached ${recommendations.length} recommendations for limit ${options.limit}`)
            } else {
                EPGErrorHandler.warn(`Not caching empty recommendations for limit ${JSON.stringify(options.limit)}`)
            }

            // Update performance metrics
            const responseTime = Date.now() - startTime
            this.updatePerformanceMetrics(responseTime)

            return recommendations

        } catch (error) {
            EPGErrorHandler.error('Enhanced recommendations failed:', error)
            const fallback = await this.getFallbackRecommendations(userContext)
            return this.applyAdvancedFilters(fallback, userContext, this.config.defaultLimit)
        }
    }

    /**
     * Generate new recommendations using semantic analysis
     * @param {Object} userContext - User context
     * @param {Object} options - Options
     * @returns {Promise<Array>} Generated recommendations
     */
    async generateRecommendations(userContext, options) {
        try {
            // 1. Expand user tags using AI semantic analysis with fallback
            const expansionStart = Date.now()
            let expandedTags = userContext.tags // Start with original tags
            
            // Try to get expanded tags from cache first
            const cacheKey = this.generateTagCacheKey(userContext.tags)
            const cachedExpansion = this.cache.get(cacheKey)
            
            if (cachedExpansion) {
                // Use cached expanded tags
                expandedTags = cachedExpansion
                // Using cached expanded tags
                
                // Schedule background refresh for cache update
                this.scheduleBackgroundTagRefresh(userContext.tags)
            } else {
                // No cache available - use original tags and update cache in background
                // Cache miss - using original tags, updating cache in background
                expandedTags = userContext.tags
                this.scheduleBackgroundTagRefresh(userContext.tags)
            }
            
            this.performanceMetrics.expansionTime.push(Date.now() - expansionStart)

            // 2. Get data with semantic filtering (EPG for live, multiSearch for VOD)
            let epgData
            if (options.type === 'video' || options.type === 'vod') {
                // Use multiSearch for VOD content
                epgData = await this.getSemanticVODData(expandedTags, userContext, {...options, group: false, typeStrict: true})
            } else {
                // Use EPG for live content
                epgData = await this.getSemanticEPGData(expandedTags, userContext)
            }

            // 3. Base scoring using the raw values provided by JexiDB/list sources
            const scoredRecommendations = (Array.isArray(epgData) ? epgData : []).map(programme => ({
                ...programme,
                score: typeof programme.score === 'number' ? programme.score : 0
            }))

            // 4. Apply filters and scoring adjustments
            const targetAmount = options.limit || options.amount || this.config.defaultLimit;
            const filteredRecommendations = this.applyAdvancedFilters(
                scoredRecommendations,
                userContext,
                targetAmount
            )

            return filteredRecommendations

        } catch (error) {
            EPGErrorHandler.warn('Recommendation generation failed:', error.message)
            throw error
        }
    }

    /**
     * Apply advanced filters to recommendations
     * @param {Array} recommendations - Scored recommendations
     * @param {Object} userContext - User context
     * @param {number} targetAmount - Target amount to return (priority)
     * @returns {Array} Filtered recommendations
     */
    applyAdvancedFilters(recommendations, userContext, targetAmount = null) {
        let filtered = Array.isArray(recommendations) ? recommendations.slice() : []

        if (userContext.applyParentalControl) {
            filtered = this.applyParentalControl(filtered, userContext.userId)
        }

        filtered = filtered.filter(rec => typeof rec.score === 'number' && !Number.isNaN(rec.score))

        if (!filtered.length) {
            return filtered
        }

        const now = Date.now() / 1000
        const scores = filtered.map(rec => rec.score ?? 0)
        const minScore = Math.min(...scores)
        const maxScore = Math.max(...scores)

        const timingDiffs = filtered
            .map(rec => {
                const start = typeof rec.start === 'number'
                    ? rec.start
                    : (typeof rec.programme?.start === 'number' ? rec.programme.start : null)
                if (start === null) return null
                return Math.abs(start - now)
            })
            .filter(diff => diff !== null)

        const minDiff = timingDiffs.length ? Math.min(...timingDiffs) : null
        const maxDiff = timingDiffs.length ? Math.max(...timingDiffs) : null

        filtered = filtered.map(rec => {
            const rawScore = rec.score ?? 0
            const normalizedScore = maxScore > minScore
                ? (rawScore - minScore) / (maxScore - minScore)
                : 1

            const start = typeof rec.start === 'number'
                ? rec.start
                : (typeof rec.programme?.start === 'number' ? rec.programme.start : null)

            let timingScore = 0
            if (start !== null && minDiff !== null && maxDiff !== null) {
                const diff = Math.abs(start - now)
                timingScore = maxDiff > minDiff
                    ? 1 - ((diff - minDiff) / (maxDiff - minDiff))
                    : 1
            }

            const finalScore = ((normalizedScore * this.normalizedScoreWeight) + timingScore) / (this.normalizedScoreWeight + 1)

            return {
                ...rec,
                normalizedScore,
                timingScore,
                finalScore
            }
        })

        filtered.sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0))

        if (targetAmount && filtered.length > targetAmount) {
            filtered = filtered.slice(0, targetAmount)
        }

        return filtered
    }

    /**
     * Apply parental control filtering
     * @param {Array} recommendations - Recommendations
     * @param {string} userId - User ID
     * @returns {Array} Filtered recommendations
     */
    applyParentalControl(recommendations, userId) {
        // This would integrate with the existing parental control system
        // For now, return as-is
        return recommendations
    }

    /**
     * Get semantic EPG data
     * @param {Object} expandedTags - Expanded tags
     * @param {Object} userContext - User context
     * @returns {Promise<Array>} EPG data
     */
    async getSemanticEPGData(expandedTags, userContext) {
        try {
            // Check if EPG is available and has data
            const epgManager = global.lists?.epg
            if (!epgManager || !epgManager.loaded?.length) {
                EPGErrorHandler.warn('EPG Manager not available, cannot get semantic data')
                return []
            }

            // Use hybrid tag selection strategy
            const categories = {}

            // 1. Add user's original tags with full weight
            if (userContext.tags) {
                Object.entries(userContext.tags).forEach(([tag, weight]) => {
                    categories[tag] = weight
                })
            }

            // 2. Add expanded tags with reduced weight to broaden search
            if (expandedTags) {
                Object.entries(expandedTags).forEach(([tag, weight]) => {
                    // Only add if not already present or with lower weight
                    if (!categories[tag] || weight > categories[tag]) {
                        categories[tag] = weight * 0.7 // Reduce weight for expanded tags
                    }
                })
            }

            // Get recommendations from EPG system
            const channelTermsArrays = global.channels?.channelList?.channelsIndex ? Object.values(global.channels.channelList.channelsIndex) : []
            EPGErrorHandler.debug(`Calling getRecommendations with ${Object.keys(categories).length} categories and ${channelTermsArrays.length} channel term arrays`)
            
            // Pass null for chList to disable channel filtering and get all programmes
            const epgRecommendations = await global.lists.epg.getRecommendations(
                categories,
                null, // until - use default (6 hours from now)
                256  // limit - get more results for better selection
            )

            // Transform EPG recommendations to our format
            const programmes = epgRecommendations.map(programme => ({
                ...programme,
                channel: programme.channel,
                start: programme.start,
                score: typeof programme.score === 'number' ? programme.score : 0
            }))

            EPGErrorHandler.debug(`Found ${programmes.length} programmes from EPG system using ${Object.keys(categories).length} categories`)
            return this.applyAdvancedFilters(programmes, userContext, this.config.defaultLimit)

        } catch (error) {
            EPGErrorHandler.warn('Failed to get semantic EPG data: '+ String(error))
            return []
        }
    }

    /**
     * Get VOD content from lists using multiSearch
     * @param {Object} expandedTags - Expanded tags
     * @param {Object} userContext - User context
     * @param {Object} options - Options
     * @returns {Promise<Array>} VOD entries in EPG-compatible format
     */
    async getSemanticVODData(expandedTags, userContext, options = {}) {
        try {
            // Check if lists are available
            if (!global.lists || typeof global.lists.multiSearch !== 'function') {
                EPGErrorHandler.warn('Lists multiSearch not available, cannot get VOD data')
                return []
            }

            // Build score map from tags (same format as multiSearch expects)
            const scoreMap = {}

            // 1. Add user's original tags with full weight
            if (userContext.tags) {
                Object.entries(userContext.tags).forEach(([tag, weight]) => {
                    scoreMap[tag] = weight
                })
            }

            // 2. Add expanded tags with reduced weight to broaden search
            if (expandedTags) {
                Object.entries(expandedTags).forEach(([tag, weight]) => {
                    // Accumulate scores if tag appears multiple times
                    const currentWeight = weight * 0.7 // Reduce weight for expanded tags
                    scoreMap[tag] = (scoreMap[tag] || 0) + currentWeight
                })
            }

            if (Object.keys(scoreMap).length === 0) {
                EPGErrorHandler.warn('No tags provided for VOD search')
                return []
            }

            // Use multiSearch to get VOD entries from lists
            const searchOpts = {
                limit: options.limit || 256,
                type: 'vod', // VOD content
                group: options.group === true, // Search in groups if group is true
                typeStrict: options.typeStrict !== false // Search strictly if typeStrict is not false
            }

            EPGErrorHandler.debug(`Calling multiSearch for VOD with ${Object.keys(scoreMap).length} tags, limit: ${searchOpts.limit}`)
            console.log('multiSearch', scoreMap, searchOpts);
            const vodEntries = await global.lists.multiSearch(scoreMap, searchOpts)

            EPGErrorHandler.debug(`Found ${vodEntries.length} VOD entries from lists using ${Object.keys(scoreMap).length} tags`)
            
            // Transform to EPG-compatible format (similar to EPG programmes format)
            const programmes = vodEntries.map(entry => ({
                title: entry.name || '',
                desc: entry.description || '',
                channel: entry.group || '',
                categories: entry.group ? [entry.group] : [],
                icon: entry.icon || '',
                url: entry.url || '',
                source: entry.source || '',
                score: typeof entry.score === 'number' ? entry.score : 0,
                // Add fields for compatibility with EPG format
                start: 0, // VOD doesn't have start time
                end: 0,   // VOD doesn't have end time
                type: 'vod',
                // Preserve original entry data
                entry: entry
            }))

            return programmes

        } catch (error) {
            EPGErrorHandler.warn('Failed to get semantic VOD data: '+ String(error))
            return []
        }
    }

    /**
     * Get all available programmes based on user interests
     * @param {Object} expandedTags - User's expanded interests
     * @param {Object} userContext - User context
     * @returns {Promise<Array>} Available programmes relevant to user
     */
    async getAllAvailableProgrammes(expandedTags, userContext) {
        try {
            // Check if EPG is loaded (loaded can be an array of URLs or boolean)
            const epgLoaded = global.lists?.epg?.loaded
            if (!epgLoaded || (Array.isArray(epgLoaded) && epgLoaded.length === 0)) {
                EPGErrorHandler.warn('EPG not loaded, cannot get programmes')
                return []
            }

            // Get current and future programmes based on user interests
            const now = Date.now() / 1000
            const until = now + (24 * 3600) // Next 24 hours

            // Use user's expanded interests instead of predefined categories
            const categories = {}

            // Add user's original interests with higher weight
            if (userContext.tags) {
                Object.entries(userContext.tags).forEach(([tag, weight]) => {
                    categories[tag] = weight
                })
            }

            // Add expanded tags with lower weight to broaden search
            if (expandedTags) {
                Object.entries(expandedTags).forEach(([tag, weight]) => {
                    // Only add if not already present or with lower weight
                    if (!categories[tag] || weight > categories[tag]) {
                        categories[tag] = weight * 0.5 // Reduce weight for expanded tags
                    }
                })
            }

            // If no user interests, use a minimal set of common categories
            if (Object.keys(categories).length === 0) {
                categories['entertainment'] = 0.5
                categories['news'] = 0.3
                categories['sports'] = 0.3
            }

            const epgRecommendations = await global.lists.epg.getRecommendations(
                categories,
                until,
                200, // Get fewer programmes but more relevant ones
                Object.values(global.channels.channelList.channelsIndex)
            )

            // Transform EPG recommendations to our format
            const programmes = epgRecommendations.map(programme => ({
                ...programme,
                channel: programme.channel,
                start: programme.start,
                score: typeof programme.score === 'number' ? programme.score : 0
            }))

            EPGErrorHandler.debug(`Found ${programmes.length} relevant programmes for user interests`)
            return programmes

        } catch (error) {
            EPGErrorHandler.warn('Failed to get programmes:', error.message)
            return []
        }
    }

    /**
     * Get fallback recommendations when main system fails
     * @param {Object} userContext - User context
     * @returns {Array} Fallback recommendations
     */
    async getFallbackRecommendations(userContext) {
        try {
            // Check if EPG is loaded (loaded can be an array of URLs or boolean)
            const epgLoaded = global.lists?.epg?.loaded
            if (!epgLoaded || (Array.isArray(epgLoaded) && epgLoaded.length === 0)) {
                return []
            }

            // Use traditional EPG recommendations as fallback
            const categories = userContext.tags || {}
            const epgRecommendations = await global.lists.epg.getRecommendations(
                categories,
                null, // until - use default
                25   // limit
            )

            // Transform to our format
            const programmes = epgRecommendations.map(programme => ({
                ...programme,
                channel: programme.channel,
                start: programme.start,
                score: typeof programme.score === 'number' ? programme.score : 0,
                fallback: true
            }))

            EPGErrorHandler.debug(`Fallback recommendations: ${programmes.length} programmes`)
            return programmes

        } catch (error) {
            EPGErrorHandler.warn('Fallback recommendations failed:', error.message)
            return []
        }
    }

    /**
     * Validate user context
     * @param {Object} userContext - User context
     */
    validateUserContext(userContext) {
        if (!userContext || !userContext.userId) {
            throw new Error('Invalid user context: userId is required')
        }

        if (!userContext.tags || typeof userContext.tags !== 'object') {
            throw new Error('Invalid user context: tags are required')
        }
    }

    /**
     * Generate cache key for recommendations
     * @param {Object} userContext - User context
     * @param {Object} options - Options
     * @returns {string} Cache key
     */
    generateCacheKey(userContext, options) {
        const entries = Object.entries(userContext.tags || {})
        const serializedTags = entries.length
            ? entries
                .map(([key, value]) => {
                    let formatted = '1.0000'
                    if (typeof value === 'number' && Number.isFinite(value)) {
                        formatted = Number(value).toFixed(4)
                    } else if (typeof value === 'boolean') {
                        formatted = value ? 'true' : 'false'
                    } else if (value != null) {
                        formatted = String(value)
                    } else {
                        formatted = 'null'
                    }
                    return `${key}:${formatted}`
                })
                .sort()
                .join('|')
            : '__no_tags__'
        const optionsKey = JSON.stringify(options || {})
        return `rec:${userContext.userId}:${serializedTags}:${optionsKey}`
    }

    /**
     * Update performance metrics
     * @param {number} responseTime - Response time
     */
    updatePerformanceMetrics(responseTime) {
        const current = this.performanceMetrics.averageResponseTime
        const count = this.performanceMetrics.requestCount
        this.performanceMetrics.averageResponseTime =
            (current * (count - 1) + responseTime) / count
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            cacheStats: this.cache.getStats()
        }
    }

    /**
     * Get system health status
     * @returns {Object} Health status
     */
    getHealthStatus() {
        return {
            readyState: this.readyState,
            cacheHealthy: this.cache.getStats().validEntries > 0
        }
    }

    /**
     * Generate cache key for user tags
     * @param {Object} userTags - User tags
     * @returns {string} Cache key
     */
    generateTagCacheKey(userTags) {
        const entries = Object.entries(userTags || {})
        const serialized = entries.length
            ? entries
                .map(([key, value]) => {
                    let formatted = '1.0000'
                    if (typeof value === 'number' && Number.isFinite(value)) {
                        formatted = Number(value).toFixed(4)
                    } else if (typeof value === 'boolean') {
                        formatted = value ? 'true' : 'false'
                    } else if (value != null) {
                        formatted = String(value)
                    } else {
                        formatted = 'null'
                    }
                    return `${key}:${formatted}`
                })
                .sort()
                .join('|')
            : '__no_tags__'
        return `tags:${serialized}`
    }

    /**
     * Schedule background tag refresh for future recommendations
     * @param {Object} userTags - User tags to refresh
     */
    scheduleBackgroundTagRefresh(userTags) {
        // Use setTimeout to avoid blocking the main thread
        setTimeout(async () => {
            try {
                // Starting background tag refresh...
                
                const expandedTags = await this.aiTagExpansion.expandUserTags(
                    userTags,
                    {
                        maxExpansions: 50, // More expansions in background
                        similarityThreshold: 0.6,
                        diversityBoost: true
                    }
                )
                
                // Cache the expanded tags
                const cacheKey = this.generateTagCacheKey(userTags)
                this.cache.set(cacheKey, expandedTags, ['tags', 'expansion'], 3, 24 * 60 * 60 * 1000) // 24h TTL
                
                // Background tag refresh completed and cached
                
                // Emit event to notify that recommendations can be refreshed
                this.emit('tagsExpanded', { userTags, expandedTags })
                
            } catch (error) {
                console.warn('Background tag refresh failed:', error.message)
            }
        }, 1000) // Start after 1 second
    }
}
