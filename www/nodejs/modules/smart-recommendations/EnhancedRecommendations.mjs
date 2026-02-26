import { EventEmitter } from 'node:events'
import { ErrorHandler } from './ErrorHandler.mjs'
import { AITagExpansion } from './AITagExpansion.mjs'
import { SmartCache } from './SmartCache.mjs'

/**
 * Enhanced Recommendations System
 * Intelligent recommendations using AI Client
 */
export class EnhancedRecommendations extends EventEmitter {
    constructor(aiClient) {
        super()
        this.debug = false
        this.aiClient = aiClient
        this.aiTagExpansion = new AITagExpansion(aiClient)
        // SemanticContentDiscovery removed - not used
        // TriasLearningSystem removed - learning not needed with AI
        this.cache = new SmartCache({
            maxSize: 2000,
            defaultTTL: 300000, // 5 minutes
            cleanupInterval: 60000 // 1 minute
        })
        
        // Track ongoing background refreshes to avoid duplicates
        this.ongoingRefreshes = new Set();
        
        // Minimum time between refreshes for same tags (5 minutes)
        this.refreshCooldown = new Map();
        this.minRefreshInterval = 5 * 60 * 1000; // 5 minutes
        
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
                if (this.debug) {
                    console.log('getRecommendations: cache hit, returning', recommendations.length, 'cached recommendations');
                }
                this.performanceMetrics.cacheHitRate =
                    (this.performanceMetrics.cacheHitRate + 1) / 2
                return recommendations
            }

            if (this.debug) {
                console.log('getRecommendations: cache miss, generating new recommendations');
            }

            // Generate new recommendations
            recommendations = await this.generateRecommendations(userContext, options)

            // Cache the results ONLY if not empty
            // Empty results may be due to errors/timeouts and shouldn't be cached
            if (recommendations && recommendations.length > 0) {
                this.cache.set(cacheKey, recommendations,
                    [`user:${userContext.userId}`, 'recommendations'], 2)
                if (this.debug) {
                    console.log(`Cached ${recommendations.length} recommendations for limit ${options.limit}`);
                }
            } else {
                if (this.debug) {
                    console.log(`Not caching empty recommendations for limit ${JSON.stringify(options.limit)}`);
                }
            }

            // Update performance metrics
            const responseTime = Date.now() - startTime
            this.updatePerformanceMetrics(responseTime)

            return recommendations

        } catch (error) {
            ErrorHandler.error('Enhanced recommendations failed:', error)
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
            if (this.debug) {
                console.log('Generating recommendations with options:', {userContext, options}, this);
            }

            // 1. Expand user tags using AI semantic analysis with fallback
            const expansionStart = Date.now()
            let expandedTags = userContext.tags // Start with original tags
            
            // Try to get expanded tags from cache first
            const cacheKey = this.generateTagCacheKey(userContext.tags)
            const cachedExpansion = this.cache.get(cacheKey)
            
            if (cachedExpansion) {
                // Use cached expanded tags
                expandedTags = cachedExpansion
                if (this.debug) {
                    console.log('Using cached expanded tags:', expandedTags);
                }
                
                // Only schedule background refresh if cache is stale (older than 30 minutes)
                // This prevents unnecessary API calls when fresh cache is available
                const cacheAge = Date.now() - (cachedExpansion._timestamp || 0);
                if (cacheAge > 30 * 60 * 1000) { // 30 minutes
                    this.scheduleBackgroundTagRefresh(userContext.tags);
                }
            } else {
                // No cache available - use original tags and update cache in background
                // Cache miss - using original tags, updating cache in background
                expandedTags = userContext.tags
                this.scheduleBackgroundTagRefresh(userContext.tags)
            }
            
            this.performanceMetrics.expansionTime.push(Date.now() - expansionStart)

            // 2. Get data with semantic filtering (EPG for live, multiSearch for VOD)
            let epgData
            if (options.type === 'vod') {
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

            if (this.debug) {
                console.log('generateRecommendations: returning', filteredRecommendations.length, 'filtered recommendations');
            }
            return filteredRecommendations

        } catch (error) {
            if (this.debug) {
                console.error('Recommendation generation failed:', error.message, error);
            }
            throw error
        }
    }

    /**
     * Apply advanced filters to recommendations
     */
    applyAdvancedFilters(recommendations, userContext, targetAmount) {
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
        if (this.debug) {
            console.log('getSemanticEPGData called with expandedTags:', expandedTags, 'userContext.tags:', userContext.tags);
        }
        try {
            // Check if EPG is available and has data
            const epgManager = global.lists?.epg
            if (!epgManager || !epgManager.loaded?.length) {
                if (this.debug) {
                    console.log('EPG Manager not available, cannot get semantic data');
                }
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
            if (this.debug) {
                console.log(`Calling getRecommendations with ${Object.keys(categories).length} categories and ${channelTermsArrays.length} channel term arrays`);
            }
            
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

            if (this.debug) {
                console.log(`Found ${programmes.length} programmes from EPG system using ${Object.keys(categories).length} categories`);
            }
            return this.applyAdvancedFilters(programmes, userContext, this.config.defaultLimit)

        } catch (error) {
            if (this.debug) {
                console.error('Failed to get semantic EPG data:', error);
            }
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
            if (this.debug) {
                console.log('getSemanticVODData called with options:', options);
            }
            // Check if lists are available
            if (!global.lists || typeof global.lists.multiSearch !== 'function') {
                if (this.debug) {
                    console.log('Lists multiSearch not available, cannot get VOD data');
                }
                return []
            }

            // Build score map from tags (same format as multiSearch expects)
            const scoreMap = {}

            // 1. Add user's original tags with normalized weights to ensure diversity
            // For VOD, filter to only non-channel-related tags before normalizing
            if (userContext.tags) {
                let filteredTags = userContext.tags
                if (global.channels && typeof global.channels.isChannel === 'function') {
                    filteredTags = Object.fromEntries(
                        Object.entries(userContext.tags).filter(([tag]) => !global.channels.isChannel(tag))
                    )
                }
                const normalizedTags = this.normalizeTagScores(filteredTags)
                
                Object.entries(normalizedTags).forEach(([tag, weight]) => {
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
                if (this.debug) {
                    console.log('No tags provided for VOD search');
                }
                return []
            }

            // Use multiSearch to get VOD entries from lists
            const searchOpts = {
                limit: options.limit || 256,
                type: 'vod', // VOD content
                group: options.group === true, // Search in groups if group is true
                typeStrict: options.typeStrict !== false // Search strictly if typeStrict is not false
            }

            if (this.debug) {
                console.log(`Calling multiSearch for VOD with ${Object.keys(scoreMap).length} tags, limit: ${searchOpts.limit}`);
            }
            const vodEntries = await global.lists.multiSearch(scoreMap, searchOpts)

            if (this.debug) {
                console.log(`Found ${vodEntries.length} VOD entries from lists using ${Object.keys(scoreMap).length} tags`);
            }
            
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
            if (this.debug) {
                console.log('Failed to get semantic VOD data:', error);
            }
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
                if (this.debug) {
                    console.log('EPG not loaded, cannot get programmes');
                }
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

            if (this.debug) {
                console.log(`Found ${programmes.length} relevant programmes for user interests`);
            }
            return programmes

        } catch (error) {
            if (this.debug) {
                console.log('Failed to get programmes:', error.message);
            }
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

            if (this.debug) {
                console.log(`Fallback recommendations: ${programmes.length} programmes`);
            }
            return programmes

        } catch (error) {
            if (this.debug) {
                console.log('Fallback recommendations failed:', error.message);
            }
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
        const cacheKey = this.generateTagCacheKey(userTags);
        
        // Check if refresh is already ongoing for these tags
        if (this.ongoingRefreshes.has(cacheKey)) {
            return; // Already refreshing
        }
        
        // Check cooldown period
        const lastRefresh = this.refreshCooldown.get(cacheKey);
        const now = Date.now();
        if (lastRefresh && (now - lastRefresh) < this.minRefreshInterval) {
            return; // Too soon to refresh again
        }
        
        // Mark as ongoing and set cooldown
        this.ongoingRefreshes.add(cacheKey);
        this.refreshCooldown.set(cacheKey, now);
        
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
                this.cache.set(cacheKey, expandedTags, ['tags', 'expansion'], 3, 24 * 60 * 60 * 1000) // 24h TTL
                
                // Background tag refresh completed and cached
                
                // Emit event to notify that recommendations can be refreshed
                this.emit('tagsExpanded', { userTags, expandedTags })
                
            } catch (error) {
                console.warn('Background tag refresh failed:', error.message)
            } finally {
                // Clean up
                this.ongoingRefreshes.delete(cacheKey);
            }
        }, 1000) // Start after 1 second
    }

    /**
     * Normalize tag scores to ensure diversity across the user's interest spectrum
     * Prevents high-scoring tags from dominating recommendations
     * @param {Object} tags - Original user tags with scores
     * @returns {Object} Normalized tags
     */
    normalizeTagScores(tags) {
        const entries = Object.entries(tags).filter(([, score]) => typeof score === 'number' && score > 0)
        
        if (entries.length === 0) return {}
        if (entries.length === 1) return { [entries[0][0]]: 1.0 } // Single tag gets max score
        
        // Sort by score descending
        entries.sort(([, a], [, b]) => b - a)
        
        const scores = entries.map(([, score]) => score)
        const maxScore = scores[0]
        const minScore = scores[scores.length - 1]
        
        // If all scores are the same, return as-is
        if (maxScore === minScore) {
            return Object.fromEntries(entries.map(([tag]) => [tag, 1.0]))
        }
        
        const normalized = {}
        
        // Apply normalization to compress high scores and boost low scores
        entries.forEach(([tag, score]) => {
            // Min-max normalization
            let normalizedScore = (score - minScore) / (maxScore - minScore)
            
            // Apply square root compression to prevent dominance of high scores
            // This reduces the gap between high and low scores more effectively
            normalizedScore = Math.sqrt(normalizedScore)
            
            // Ensure minimum score for diversity (boost low-interest tags)
            normalizedScore = Math.max(normalizedScore, 0.3)
            
            // Scale to 0.3-1.0 range to maintain some differentiation
            normalizedScore = normalizedScore * 0.7 + 0.3
            
            normalized[tag] = normalizedScore
        })
        
        return normalized
    }
}
