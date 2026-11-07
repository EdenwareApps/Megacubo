import { EventEmitter } from 'node:events'
import { ErrorHandler } from './ErrorHandler.mjs'
import { SmartCache } from './SmartCache.mjs'
import { terms } from '../lists/tools.js'
import { stripFalseFriends } from '../profiles/content-profile.js'
import StreamClassifier from '../lists/stream-classifier.js'

/**
 * Enhanced Recommendations System
 * Intelligent recommendations using AI Client
 */
export class EnhancedRecommendations extends EventEmitter {
    constructor() {
        super()
        this.debug = false
        // AITagExpansion disabled - server no longer provides valid expansions
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
            cacheHitRate: 0
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

            // 1. Use user tags directly (AITagExpansion permanently disabled)
            const expandedTags = userContext.tags

            // 2. Get data with filtering (EPG for live, multiSearch for VOD)
            let epgData
            if (options.type === 'vod') {
                // Use multiSearch for VOD content. Group search must stay on: VOD
                // titles never contain the profile vocabulary ("filme", "infantil",
                // "adultos"), it only appears in the group names of the lists.
                epgData = await this.getSemanticVODData(expandedTags, userContext, {...options, group: true, typeStrict: true})
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
     * Rescore EPG programmes by where the tags were found.
     *
     * The programme index scores every metadata field with the same weight, so a
     * profile word inside a channel name ("Adult Swim") or a genre label
     * ("Young Adult") promotes content that means something else entirely. Here the
     * title and categories keep their full weight and the channel name — which
     * describes the broadcaster, not the programme — counts for less.
     * @param {Array} programmes - EPG programmes with raw metadata
     * @param {Object} categories - Tag -> weight map used for the query
     * @param {number} channelWeight - Weight applied to channel-name matches
     * @returns {Array} Programmes with the refined score
     */
    rescoreEPGProgrammes(programmes, categories, channelWeight = 0.6) {
        const weights = {}
        for (const [tag, weight] of Object.entries(categories || {})) {
            for (const term of terms(stripFalseFriends(tag))) {
                if (!(term in weights) || weight > weights[term]) {
                    weights[term] = weight
                }
            }
        }

        const scoreCache = new Map()
        const scoreOf = (text) => {
            if (!text) {
                return 0
            }
            if (scoreCache.has(text)) {
                return scoreCache.get(text)
            }
            let score = 0
            const seen = new Set()
            for (const term of terms(stripFalseFriends(text))) {
                if (seen.has(term)) {
                    continue
                }
                seen.add(term)
                if (weights[term]) {
                    score += weights[term]
                }
            }
            scoreCache.set(text, score)
            return score
        }

        return programmes.map(programme => {
            const programmeCategories = Array.isArray(programme.categories) ? programme.categories : []
            const textScore = scoreOf([programme.title || '', ...programmeCategories].join(' '))
            const channelScore = scoreOf(programme.channel || '')
            return { ...programme, score: textScore + (channelScore * channelWeight) }
        })
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
                400  // limit - the scoring inside uses limit * 10 candidates, we rescore them below
            )

            // The EPG index scores every metadata field alike, so rescore by where the
            // tags were actually found before ranking (see rescoreEPGProgrammes).
            const programmes = this.rescoreEPGProgrammes(epgRecommendations.map(programme => ({
                ...programme,
                channel: programme.channel,
                start: programme.start
            })), categories)

            if (this.debug) {
                console.log(`Found ${programmes.length} programmes from EPG system using ${Object.keys(categories).length} categories`);
            }

            // Keep only programmes that actually matched a tag; filling the row with
            // arbitrary programmes is what made unrelated content (e.g. kids shows for
            // an adult profile) reach the top positions.
            const matched = programmes.filter(programme => programme.score > 0)
            const pool = matched.length >= this.config.defaultLimit ? matched : programmes

            return this.applyAdvancedFilters(pool, userContext, this.config.defaultLimit)

        } catch (error) {
            if (this.debug) {
                console.error('Failed to get semantic EPG data:', error);
            }
            return []
        }
    }

    /**
     * VOD titles taken from the lists the content profile bundles (e.g. the adult
     * list). The vocabulary filter cannot find them: their groups are named after
     * niches ("Brunette", "MILF") and their titles are proper names, so a tag
     * search over name/group only ever matched the few groups carrying a profile
     * word. Here one or two titles of *every* group of those lists are taken.
     * @param {Object} options - `limit` (how many titles) and unused `groupWeight`
     * @returns {Promise<Array>} list entries with `source` and `group` set
     */
    async getProfileSourceVOD(options = {}) {
        const lists = global.lists
        const profile = lists?.contentProfile
        if (!lists || !profile || typeof profile.listsForDiscovery != 'function' || !profile.effective?.()) {
            return []
        }
        if (typeof lists.groups != 'function' || typeof lists.group != 'function') {
            return []
        }
        const sources = profile.listsForDiscovery()
        if (!Array.isArray(sources) || !sources.length) {
            return []
        }
        let groups = []
        try {
            groups = await lists.groups(['vod', 'series'])
        } catch (err) {
            return []
        }
        const own = (Array.isArray(groups) ? groups : []).filter(item => item && sources.includes(item.url))
        if (!own.length) {
            return []
        }
        const limit = Math.max(1, parseInt(options.limit, 10) || this.config.defaultLimit)
        // Two titles per group already covers the folder; sampling groups with a
        // stride avoids rebuilding the whole catalog and keeps the folders that
        // come first alphabetically from taking the folder over.
        const perGroup = 2
        const maxGroups = Math.min(own.length, 24, Math.max(4, Math.ceil(limit / perGroup)))
        const stride = Math.max(1, Math.floor(own.length / maxGroups))
        const sample = own.filter((item, i) => i % stride === 0).slice(0, maxGroups)
        const entries = []
        for (const item of sample) {
            let found = []
            try {
                found = await lists.group({ url: item.url, group: item.group })
            } catch (err) {
                continue // list being updated / group gone
            }
            if (!Array.isArray(found) || !found.length) continue
            // The groups come from the VOD/series index, so their entries are VOD by
            // origin: only drop what the URL clearly marks as a live channel. A
            // VOD filter would discard them, since HLS titles classify as "seems-live".
            const vod = found.filter(entry => entry && entry.url && !StreamClassifier.clearlyLive(entry))
            // Picking the first two entries of a group usually means two episodes of
            // the same series, so the picks are spread over the whole group instead.
            for (let n = 0; n < Math.min(perGroup, vod.length); n++) {
                const index = vod.length > perGroup ? Math.floor((n * vod.length) / perGroup) : n
                const entry = vod[index]
                if (!entry || !entry.url) continue
                entries.push({ ...entry, source: item.url, group: entry.group || item.group })
            }
        }
        if (this.debug) {
            console.log(`Profile source VOD: ${entries.length} entries from ${own.length} groups`)
        }
        return entries
    }

    /**
     * Put the profile's own catalog first and drop duplicates of the tag hits.
     * Those titles are relevant by origin, so they get the score of the best tag
     * hit - otherwise normalizing would rank them last and the folder would cut
     * them off.
     * @param {Array} ownEntries - Entries from the profile's own lists
     * @param {Array} vodEntries - Entries found by tag search
     * @returns {Array}
     */
    mergeVODSources(ownEntries, vodEntries) {
        const hits = Array.isArray(vodEntries) ? vodEntries : []
        const own = Array.isArray(ownEntries) ? ownEntries : []
        if (!own.length) {
            return hits
        }
        const top = hits.reduce((max, entry) => Math.max(max, typeof entry?.score == 'number' ? entry.score : 0), 0)
        const score = top > 0 ? top : 1
        const seen = new Set()
        const merged = []
        const push = (entry, withScore) => {
            const key = entry?.url || entry?.name
            if (!key || seen.has(key)) return
            seen.add(key)
            merged.push(withScore ? { ...entry, score } : entry)
        }
        own.forEach(entry => push(entry, true))
        hits.forEach(entry => push(entry, false))
        return merged
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
                // Search the group names too: for VOD they are the only place where
                // the profile vocabulary (genre/audience) shows up, since titles are
                // proper names ("Moana 2") and never match tags like "infantil".
                group: options.group !== false,
                // A group hit is a weaker signal than a name hit, so it scores lower
                groupWeight: options.groupWeight ?? 0.85,
                typeStrict: options.typeStrict !== false // Search strictly if typeStrict is not false
            }

            if (this.debug) {
                console.log(`Calling multiSearch for VOD with ${Object.keys(scoreMap).length} tags, limit: ${searchOpts.limit}`);
            }
            const vodEntries = await global.lists.multiSearch(scoreMap, searchOpts)

            if (this.debug) {
                console.log(`Found ${vodEntries.length} VOD entries from lists using ${Object.keys(scoreMap).length} tags`);
            }

            // Titles of the lists the profile bundles are relevant by origin, even
            // when neither their name nor their group carries the profile
            // vocabulary. One title per group is taken so the whole profile shows
            // up instead of the two or three groups whose names happen to match.
            const ownEntries = await this.getProfileSourceVOD({ limit: searchOpts.limit, groupWeight: searchOpts.groupWeight })
            const merged = this.mergeVODSources(ownEntries, vodEntries)

            // Transform to EPG-compatible format (similar to EPG programmes format)
            const programmes = merged.map(entry => ({
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
