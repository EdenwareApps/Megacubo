import { EventEmitter } from 'node:events'
import { EPGErrorHandler } from '../epg-worker/EPGErrorHandler.js'
import { AIRecommendationEngine } from './AIRecommendationEngine.mjs'
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
        this.aiEngine = new AIRecommendationEngine(aiClient)
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
        this.performanceMetrics = {
            requestCount: 0,
            averageResponseTime: 0,
            cacheHitRate: 0,
            semanticScoreTime: [],
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
            return await this.getFallbackRecommendations(userContext)
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

            // 2. Get EPG data with semantic filtering
            const epgData = await this.getSemanticEPGData(expandedTags, userContext)

            // 3. Calculate semantic scores for all programmes
            const scoredRecommendations = await this.calculateSemanticScores(
                epgData,
                expandedTags,
                userContext
            )

            // 4. Apply diversity and quality filters
            const filteredRecommendations = this.applyAdvancedFilters(
                scoredRecommendations,
                userContext
            )

            // Semantic discovery removed - not needed with term-based matching
            const diverseRecommendations = filteredRecommendations

            // 6. Final ranking and selection
            const finalRecommendations = this.finalRanking(
                diverseRecommendations,
                options
            )

            return finalRecommendations

        } catch (error) {
            EPGErrorHandler.warn('Recommendation generation failed:', error.message)
            throw error
        }
    }

    /**
     * Calculate semantic scores for programmes
     * @param {Array} epgData - EPG programme data
     * @param {Object} expandedTags - Expanded user tags
     * @param {Object} userContext - User context
     * @returns {Promise<Array>} Scored recommendations
     */
    async calculateSemanticScores(epgData, expandedTags, userContext) {
        const scoredProgrammes = []

        for (const programme of epgData) {
            try {
                const semanticStart = Date.now()

                // Calculate semantic score using AI
                const semanticScore = await this.aiEngine.calculateSemanticScore(
                    programme,
                    expandedTags,
                    userContext
                )

                this.performanceMetrics.semanticScoreTime.push(Date.now() - semanticStart)

                // Score already combines semantic + traditional internally
                const finalScore = semanticScore

                scoredProgrammes.push({
                    ...programme,
                    semanticScore,
                    finalScore,
                    confidence: semanticScore // Confidence = score itself
                })

            } catch (error) {
                EPGErrorHandler.warn(`Semantic scoring failed for programme: ${programme.t}`, error.message)
                // Fallback to neutral score
                scoredProgrammes.push({
                    ...programme,
                    semanticScore: 0.5,
                    finalScore: 0.5,
                    confidence: 0.3
                })
            }
        }

        return scoredProgrammes
    }

    // addSemanticDiscovery() removed - SemanticContentDiscovery not used

    /**
     * Combine semantic and traditional scores
     * @param {number} semanticScore - Semantic score
     * @param {number} traditionalScore - Traditional score
     * @param {Object} weights - Personalized weights
     * @returns {number} Combined score
     */
    combineScores(semanticScore, traditionalScore, weights) {
        const semanticWeight = weights.semanticRelevance || this.config.semanticWeight
        const traditionalWeight = weights.userPreference || this.config.traditionalWeight

        return (semanticScore * semanticWeight) + (traditionalScore * traditionalWeight)
    }

    /**
     * Calculate confidence score
     * @param {number} semanticScore - Semantic score
     * @param {number} traditionalScore - Traditional score
     * @returns {number} Confidence score
     */
    calculateConfidence(semanticScore, traditionalScore) {
        // High confidence when both scores agree
        const scoreDifference = Math.abs(semanticScore - traditionalScore)
        const averageScore = (semanticScore + traditionalScore) / 2

        if (scoreDifference < 0.2 && averageScore > 0.6) {
            return 0.9 // High confidence
        } else if (scoreDifference < 0.4 && averageScore > 0.4) {
            return 0.7 // Medium confidence
        } else {
            return 0.5 // Low confidence
        }
    }

    /**
     * Calculate traditional score based on category matching
     * @param {Object} programme - Programme data
     * @param {Object} userTags - User tags
     * @returns {number} Traditional score
     */
    calculateTraditionalScore(programme, userTags) {
        if (!programme.c || !Array.isArray(programme.c)) return 0

        let totalScore = 0
        let matches = 0

        programme.c.forEach(category => {
            const normalizedCategory = category.toLowerCase()
            if (userTags[normalizedCategory]) {
                totalScore += userTags[normalizedCategory]
                matches++
            }
        })

        return matches > 0 ? totalScore / matches : 0
    }

    /**
     * Apply advanced filters to recommendations
     * @param {Array} recommendations - Scored recommendations
     * @param {Object} userContext - User context
     * @returns {Array} Filtered recommendations
     */
    applyAdvancedFilters(recommendations, userContext) {
        // Filter by confidence threshold
        let filtered = recommendations.filter(r => r.confidence >= 0.3)

        // Apply parental control if needed
        if (userContext.applyParentalControl) {
            filtered = this.applyParentalControl(filtered, userContext.userId)
        }

        // Apply diversity filter
        filtered = this.ensureDiversity(filtered, userContext.diversityTarget || 0.7)

        // Sort by final score
        return filtered.sort((a, b) => b.finalScore - a.finalScore)
    }

    /**
     * Ensure diversity in recommendations
     * @param {Array} recommendations - Recommendations
     * @param {number} targetDiversity - Target diversity score
     * @returns {Array} Diverse recommendations
     */
    ensureDiversity(recommendations, targetDiversity = 0.7) {
        const categories = new Map()
        const channels = new Set()
        const diverseRecommendations = []

        for (const rec of recommendations) {
            const category = rec.c?.[0] || 'other'
            const channel = rec.ch

            // Check if adding this recommendation maintains diversity
            const categoryCount = categories.get(category) || 0
            const channelCount = Array.from(channels).filter(c => c === channel).length

            if (this.shouldIncludeForDiversity(categoryCount, channelCount, diverseRecommendations.length)) {
                diverseRecommendations.push(rec)
                categories.set(category, categoryCount + 1)
                channels.add(channel)
            }
        }

        return diverseRecommendations
    }

    /**
     * Check if recommendation should be included for diversity
     * @param {number} categoryCount - Current category count
     * @param {number} channelCount - Current channel count
     * @param {number} totalCount - Total recommendations
     * @returns {boolean} Should include
     */
    shouldIncludeForDiversity(categoryCount, channelCount, totalCount) {
        // Allow more variety in early recommendations
        if (totalCount < 5) return true

        // Limit same category to 2 items
        if (categoryCount >= 2) return false

        // Limit same channel to 3 items
        if (channelCount >= 3) return false

        return true
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
     * Final ranking and selection
     * @param {Array} recommendations - Recommendations
     * @param {Object} options - Options
     * @returns {Array} Final recommendations
     */
    finalRanking(recommendations, options) {
        const limit = options.limit || this.config.defaultLimit

        // Sort by final score and confidence
        const ranked = recommendations.sort((a, b) => {
            const scoreDiff = b.finalScore - a.finalScore
            if (Math.abs(scoreDiff) < 0.1) {
                return b.confidence - a.confidence
            }
            return scoreDiff
        })

        return ranked.slice(0, limit)
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
            if (!epgManager) {
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
                256,  // limit - get more results for better selection
                null  // chList - opcional, sem filtragem de canais para debug
            )

            // Transform EPG recommendations to our format
            const programmes = epgRecommendations.map(programme => ({
                ...programme,
                channel: programme.ch, // Use ch field as channel name
                start: programme.start
            }))

            EPGErrorHandler.debug(`Found ${programmes.length} programmes from EPG system using ${Object.keys(categories).length} categories`)
            return programmes

        } catch (error) {
            EPGErrorHandler.warn('Failed to get semantic EPG data: '+ String(error))
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
                channel: programme.ch, // Use ch field as channel name
                start: programme.start
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
                25,   // limit
                Object.values(global.channels.channelList.channelsIndex)
            )

            // Transform to our format
            const programmes = epgRecommendations.map(programme => ({
                ...programme,
                channel: programme.ch, // Use ch field as channel name
                start: programme.start,
                traditionalScore: 0.8, // High score for fallback
                semanticScore: 0.5,    // Medium semantic score
                finalScore: 0.7,       // Combined score
                confidence: 0.6,       // Medium confidence
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
     * Record user feedback for learning
     * @param {string} userId - User ID
     * @param {Object} recommendation - Recommendation
     * @param {string} action - User action
     * @param {Object} context - Context
     */
    async recordUserFeedback(userId, recommendation, action, context) {
        await this.learning.recordUserFeedback(userId, recommendation, action, context)

        // Invalidate user-specific cache
        this.cache.invalidateByUser(userId)

        this.emit('feedbackRecorded', { userId, action, recommendation })
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
        const tagsKey = Object.keys(userContext.tags).sort().join(',')
        const optionsKey = JSON.stringify(options)
        return `rec:${userContext.userId}:${tagsKey}:${optionsKey}`
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
            cacheStats: this.cache.getStats(),
            learningStats: this.learning.getLearningStats()
        }
    }

    /**
     * Get system health status
     * @returns {Object} Health status
     */
    getHealthStatus() {
        return {
            readyState: this.readyState,
            cacheHealthy: this.cache.getStats().validEntries > 0,
            learningActive: this.learning.getLearningStats().totalFeedback > 0
        }
    }

    /**
     * Generate cache key for user tags
     * @param {Object} userTags - User tags
     * @returns {string} Cache key
     */
    generateTagCacheKey(userTags) {
        const sortedTags = Object.keys(userTags).sort().join(',')
        return `tags:${sortedTags}`
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
