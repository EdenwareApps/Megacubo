import { EventEmitter } from 'node:events'
import smartRecommendations from './index.mjs'
import { ErrorHandler } from './ErrorHandler.mjs'
import storage from '../storage/storage.js'
import lang from '../lang/lang.js'
import config from '../config/config.js'
import { Tags } from './tags.mjs'
import { ready } from '../bridge/bridge.js'
import PQueue from 'p-queue'
import { terms, match } from '../lists/tools.js'
import Limiter from '../limiter/limiter.js'
import StreamClassifier from "../lists/stream-classifier.js";
import mega from "../mega/mega.js";
import { stripFalseFriends } from '../profiles/content-profile.js'

/**
 * How much a live channel weighs against a VOD title when the home row mixes
 * both. Live is what the app is opened for, so it keeps ~1.25x the relevance of
 * a title and VOD gets `share / LIVE_RELEVANCE_WEIGHT` of the row.
 */
const LIVE_RELEVANCE_WEIGHT = 1.25

/**
 * Scores a channel by its name against the interest tags (profile seeds +
 * learned taste). Before the EPG is parsed the channel name is the only signal
 * available, so every word of the name is matched - matching the whole name or
 * exact terms alone leaves every channel at score 0, which turned the fallback
 * into "first channels of the list" regardless of the content profile.
 * @param {string} name - Channel name
 * @param {Object} tags - term => weight map
 * @returns {number} Relevance score
 */
function scoreChannelByTags(name, tags) {
    const text = stripFalseFriends(name)
    if (!text.trim()) return 0
    const tokens = new Set(terms(text))
    let score = 0
    for (const [tag, weight] of Object.entries(tags)) {
        if (!weight || tag === 'default' || tag.length < 3) continue
        let hit = 0
        if (tokens.has(tag)) { // 'playboy' in 'Playboy TV'
            hit = 1
        } else if (tag.includes(' ') && text.includes(tag)) { // 'globo news'
            hit = 1
        } else { // plural/derived forms: tag 'filme' vs token 'filmes'
            for (const token of tokens) {
                if (token.length < 4 || tag.length < 4) continue
                if (token.startsWith(tag) || tag.startsWith(token)) {
                    hit = 0.5
                    break
                }
            }
        }
        if (hit) score += weight * hit
    }
    return score
}

/**
 * Compatibility Wrapper for Smart Recommendations
 * Provides the same API as the original recommendations system
 */
class SmartRecommendationsCompatibility extends EventEmitter {
    constructor() {
        super()
        this.readyState = 0
        this.smartRecommendations = null
        this.initialized = false
        this.updateIntervalSecs = 300
        this.epgLoaded = false
        this.someListLoaded = false
        this.listsLoaded = false
        this.initializationTime = Date.now() / 1000
        // Profile content tracking (see getProfileChannels/scheduleProfileRefresh)
        this._profilePicksMissing = false
        this._profilePicksAdded = false
        this._profileRefreshTries = 0
        this._profileRefreshTimer = null
        this._forceProfileRefresh = false

        // Storage-based cache system (single TTL for validity and storage expiration)
        this.cacheKey = 'smart-recommendations-cache'
        this.lastChannelsCacheKey = 'smart-recommendations-last-channels'  // separate key so it survives main cache overwrites
        this.vodCacheKey = 'smart-recommendations-vod-cache'  // Movies & Series "Recommended for you"
        this.vodWarmPromise = null
        this.cacheTTLSeconds = 7 * 24 * 60 * 60  // 7 days
        this.cacheMaxAge = this.cacheTTLSeconds * 1000  // same in ms for isCacheValid
        // Bump whenever the scoring changes: a cache written by an older scoring
        // would otherwise be served for up to 7 days.
        this.cacheVersion = 8

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

        // Limiter for VOD cache updates (10 seconds between updates)
        this.vodUpdateLimiter = new Limiter(async () => {
            await this.updateVODCache()
        }, { intervalMs: 10000, async: true, initialDelay: 2000 }) // Start with a delay to allow initial loading

        // Periodic update limiter (ensures at least one update every 5 minutes, max once per 3 seconds)
        this.updateLimiter = new Limiter(
            () => this.scheduleUpdate(),
            { intervalMs: 1500, async: true, initialDelay: 2000 }  // Minimum 1.5 seconds between updates (prevents too frequent calls)
        )
        
        // Periodic interval to ensure updates at least every 5 minutes
        this.periodicUpdateInterval = null

        // UI update system
        this.latestEntries = []
        this.ensuredInitialUIUpdate = false
        this.initialUIUpdateTimeout = null
        this.hookId = 'recommendations'
        
        // Update timing control
        this.lastUpdateTime = 0
        this.lastCacheTime = 0

        // Channel names from last cached recommendations (used to guide getChannels when cache is stale)
        this.lastCachedChannelNames = []

        // Initialize tags system
        this.tags = new Tags(this)
        this.manualInterestRange = { start: 0.1, end: 2, step: 0.1 }
        this.ignoreExternalTrendsKey = 'smart-recommendations-ignore-external-trends'
        this.tags.on('manualTagsChanged', () => {
            try {
                this.invalidateRecommendationCaches('manual-tags-changed')
                this.scheduleUpdate()
                this.refreshRecommendationsForManualTags().catch(err => {
                    ErrorHandler.warn('Failed to refresh recommendations after manual tags change:', err?.message || err)
                })
            } catch (err) {
                ErrorHandler.warn('Manual tags change handler failed:', err?.message || err)
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
            ErrorHandler.info('🚀 Initializing Smart Recommendations Compatibility Wrapper...')

            // Initialize smart recommendations
            await smartRecommendations.initialize({
                semanticWeight: 0.6,
                traditionalWeight: 0.4,
                maxRecommendations: 50,
                cacheSize: 2000
            })

            this.smartRecommendations = smartRecommendations
            this.initialized = true
            this.readyState = 1

            // Load lastCachedChannelNames from dedicated key (survives main cache overwrites/restart)
            try {
                const stored = await storage.get(this.lastChannelsCacheKey)
                if (Array.isArray(stored) && stored.length > 0) {
                    this.lastCachedChannelNames = stored
                } else {
                    const cacheData = await storage.get(this.cacheKey)
                    if (cacheData?.featured?.length > 0) {
                        this.lastCachedChannelNames = this.extractChannelNamesFromEntries(cacheData.featured)
                    }
                }
            } catch (_) {}

            await new Promise(resolve => {
                ready(() => {
                    // Set up event listeners
                    try {
                        this.setupEventListeners().catch(err => ErrorHandler.warn('Failed to setup event listeners:', err.message))
                    } catch (error) {
                        ErrorHandler.warn('⚠️ Failed to setup event listeners:', error.message)
                    }
                    resolve()
                })
            })

            // Start periodic update interval (guarantees update at least every 5 minutes)
            this.startPeriodicUpdates()

            ErrorHandler.info('✅ Smart Recommendations Compatibility Wrapper initialized')
            // Force home to re-render so first paint uses cache/lastChannels (main may emit main-ready after this)
            if (!global.menu?.path) {
                global.menu?.updateHomeFilters().catch(() => {})
            }
            return true

        } catch (error) {
            ErrorHandler.error('❌ Failed to initialize Smart Recommendations:', error)
            this.readyState = -1
            return false
        }
    }

    /**
     * Get the configured recommendation type from user settings
     * @returns {string} 'live', 'vod', or 'auto'
     */
    getConfiguredRecommendationType() {
        const configured = config.get('recommendations-type');
        return configured || 'auto';
    }

    /**
     * Get the effective recommendation type, resolving 'auto' based on user history
     * @returns {string} 'live' or 'vod'
     */
    getEffectiveRecommendationType() {
        const configured = this.getConfiguredRecommendationType();
        
        if (configured === 'auto') {
            return this.getRecommendationTypeFromHistory();
        }
        
        return configured;
    }

    /**
     * Determine recommendation type based on user's viewing history
     * @returns {string} 'live' or 'vod' based on most watched type
     */
    getRecommendationTypeFromHistory() {
        try {
            // Get recent history entries (last 50 to avoid performance issues)
            const history = global.channels?.history?.get?.() || [];
            const recentHistory = history.slice(-50);
            
            if (recentHistory.length === 0) {
                return 'live'; // Default fallback
            }
            
            let liveCount = 0;
            let vodCount = 0;
            
            for (const entry of recentHistory) {
                if (!entry || typeof entry !== 'object') continue;
                
                const classification = StreamClassifier.classify(entry);
                
                switch (classification) {
                    case 'vod':
                    case 'seems-vod':
                        vodCount++;
                        break;
                    case 'live':
                    case 'seems-live':
                        liveCount++;
                        break;
                    default:
                        // For unknown classifications (StreamClassifier found no clear indicators)
                        // Default to live for truly ambiguous cases
                        liveCount++;
                        break;
                }
            }
            
            // Return the type with more views, defaulting to live if equal
            return vodCount > liveCount ? 'vod' : 'live';
            
        } catch (error) {
            ErrorHandler.warn('Failed to determine recommendation type from history:', error.message);
            return 'live'; // Safe fallback
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
                this.maybeUpdateCache().catch(err => ErrorHandler.warn('Failed to maybe update cache:', err.message))
            }
            // Update VOD cache when lists are loaded
            this.vodUpdateLimiter.call().catch(err => ErrorHandler.warn('Failed to update VOD cache:', err.message))
        })

        global.lists.on('epg-update', () => {
            // Do NOT clear the persisted cache here: 'epg-update' is emitted many
            // times while the EPG loads, and clearing it threw away the rich
            // recommendations (and lastCachedChannelNames) saved by the previous
            // session, making every boot replay the same sequence from scratch.
            this.epgLoaded = true
            this.maybeUpdateCache().catch(err => ErrorHandler.warn('Failed to maybe update cache:', err.message))
        })

        // Content profile / parental age changes alter how lists are filtered and
        // which tags lead the recommendations, so anything built for the previous
        // profile (persisted cache, in-memory caches, cached channel names) is stale.
        global.lists.on('content-profile-changed', (state) => {
            this.handleContentProfileChange(state).catch(err => {
                ErrorHandler.warn('Content profile change handler failed:', err?.message || err)
            })
        })

        await global.lists.ready()
        await global.lang.ready()
        this.listsLoaded = true

        await this.maybeUpdateCache().catch(err => ErrorHandler.warn('Failed to maybe update cache:', err.message))

        // Register channel listeners and wait for channels BEFORE epgReady so we can trigger update with getChannels() early
        let channelsLoaded, channelsUpdate = () => {
            if (channelsLoaded) {
                this.scheduleUpdate()
            } else {
                channelsLoaded = true
                this.updateLimiter.skip()
            }
        }
        global.channels.on('loaded', changed => {
            if (changed) {
                channelsUpdate()
            }
        })

        await global.channels.ready()
        ErrorHandler.info('📺 Channels ready, scheduling smart recommendations update')
        await this.maybeUpdateCache().catch(err => ErrorHandler.warn('Failed to maybe update cache:', err.message))
        // Trigger update with channels immediately so UI shows recommendations before EPG loads
        this.scheduleUpdate()

            await global.lists.epgReady()
        this.epgLoaded = true
        this.scheduleUpdate()
    }

    epgEnabled() {
        return global.lists?.epg?.loaded || config.get('epg-' + lang.locale)
    }
    isEPGEnabled() {
        let activeEPG = config.get('epg-' + lang.locale)
        if(activeEPG && activeEPG !== 'disabled') {
            // An empty array means no manual EPG was chosen, so the cloud
            // suggestions are what provide the EPG data.
            const actives = Array.isArray(activeEPG) ? activeEPG.filter(r => r.active).length : activeEPG.length
            if (actives) return actives
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
     * Update VOD cache when lists are loaded
     */
    async updateVODCache() {
        // Check if configured type is VOD before scheduling update
        const configuredType = this.getEffectiveRecommendationType()
        if (configuredType === 'vod') {
            // Check if type changed from previous cache
            const previousType = this.lastConfiguredType || 'live'
            if (previousType !== configuredType) {
                ErrorHandler.info(`Recommendation type changed from ${previousType} to ${configuredType}, clearing cache`)
                await this.clearCache()
                this.lastConfiguredType = configuredType
            }

            // Schedule update to generate new VOD recommendations
            // The limiter (10s) prevents excessive updates during mass list loading
            await this.scheduleUpdate().catch(err => ErrorHandler.warn('Failed to schedule VOD update after list load:', err.message))
        }

        // The "Movies & Series > Recommended for you" folder always asks for VOD
        // recommendations, even when the app is configured for live ones. Building
        // them in background keeps that folder instant (and profile aligned).
        await this.warmVODCache().catch(err => ErrorHandler.warn('Failed to warm VOD recommendations cache:', err?.message || err))
    }

    /**
     * Drops the entries the StreamState already knows to be offline, so a dead
     * stream is never offered again as a recommendation. Unknown states (never
     * tested) are kept.
     * @param {Array} entries
     * @returns {Array}
     */
    filterOfflineEntries(entries) {
        if (!Array.isArray(entries) || !entries.length) return Array.isArray(entries) ? entries : []
        const state = global.streamer?.state
        if (!state || typeof state.get != 'function') return entries
        const alive = entries.filter(entry => {
            const url = entry?.url
            if (!url) return true
            let st
            try {
                st = state.get(url)
            } catch (err) {
                return true
            }
            return !(st === false || st === 'offline')
        })
        const dropped = entries.length - alive.length
        if (dropped > 0) {
            ErrorHandler.debug(`filterOfflineEntries: dropped ${dropped} offline entries`)
        }
        return alive
    }

    /**
     * Read the persisted VOD ("Movies & Series") recommendations
     * @returns {Promise<Array|null>} Cached entries or null
     */
    async getVODCache() {
        try {
            const cacheData = await storage.get(this.vodCacheKey)
            if (!cacheData || cacheData.version !== this.cacheVersion) return null
            if (!Array.isArray(cacheData.featured) || !cacheData.featured.length) return null
            // Built under another content profile / parental age: rebuild.
            const signature = this.profileSignature()
            if (signature && (cacheData.profile || '') !== signature) return null
            // A folder with a handful of items is usually a partial pass (few lists
            // loaded, narrow caller): treat it as absent so it gets rebuilt. Unless
            // the full pass already found the catalog has no VOD content at all.
            if (cacheData.featured.length < 8 && !cacheData.thin) return null
            if ((Date.now() - (cacheData.timestamp || 0)) > this.cacheMaxAge) return null
            const alive = this.filterOfflineEntries(cacheData.featured)
            return alive.length ? alive : null
        } catch (err) {
            ErrorHandler.warn('Failed to read VOD recommendations cache:', err?.message || err)
            return null
        }
    }

    /**
     * Persist VOD ("Movies & Series") recommendations
     * @param {Array} entries
     * @param {Object} [options]
     * @param {boolean} [options.thin] - The catalog has no more VOD content than this
     */
    async setVODCache(entries, options = {}) {
        if (!Array.isArray(entries)) return
        entries = this.filterOfflineEntries(entries) // offline streams never enter the folder
        if (!entries.length) return
        try {
            // A narrow caller (a folder preview asking for 2 items, an early
            // partial pass) must not shrink the folder for the whole session.
            const existing = await storage.get(this.vodCacheKey)
            if (existing && existing.version === this.cacheVersion && existing.profile === this.profileSignature() && Array.isArray(existing.featured) && existing.featured.length > entries.length) {
                return
            }
            await storage.set(this.vodCacheKey, {
                featured: entries,
                timestamp: Date.now(),
                version: this.cacheVersion,
                profile: this.profileSignature(),
                thin: !!options.thin
            }, { ttl: this.cacheTTLSeconds })
        } catch (err) {
            ErrorHandler.warn('Failed to save VOD recommendations cache:', err?.message || err)
        }
    }

    /**
     * VOD catalogs of the community lists are mostly movies and series, so a
     * narrow profile vocabulary (music, news) matches almost nothing by name and
     * the folder would be left with a single title. This fills the folder with
     * general titles, keeping the profile-aligned ones first so the profile still
     * leads it.
     * @param {Array} entries - Entries already picked for the folder
     * @param {number} amount - Desired folder size
     * @returns {Promise<Array>} the same array when no top-up is needed
     */
    async topUpVOD(entries, amount = 25) {
        const aligned = Array.isArray(entries) ? entries.slice() : []
        if (aligned.length >= 8) return entries
        let general = []
        try {
            // Without tags the engine returns general titles instead of the
            // profile vocabulary ones. Reused for a while: a thin catalog would
            // otherwise re-run the engine on every folder rebuild.
            const now = Date.now()
            if (!this._vodGeneralPass || (now - this._vodGeneralPass.at) > 300000) {
                this._vodGeneralPass = {
                    at: now,
                    entries: await this.get({}, amount * 2, { type: 'vod', group: true, typeStrict: true })
                }
            }
            general = this._vodGeneralPass.entries
        } catch (err) {
            ErrorHandler.warn('VOD top-up failed:', err?.message || err)
            return entries
        }
        if (!Array.isArray(general) || !general.length) return entries
        const profile = global.lists?.contentProfile
        const score = entry => {
            if (!profile || typeof profile.groupRelevance != 'function') return 0
            const name = entry?.originalName || entry?.name || ''
            try {
                return profile.groupRelevance({ name, group: entry?.group || '' })
            } catch (err) {
                return 0
            }
        }
        const seen = new Set()
        const unique = []
        for (const entry of aligned.concat(general)) {
            const key = String(entry?.originalName || entry?.name || entry?.programme?.channel || '').toLowerCase()
            if (!key || seen.has(key)) continue
            seen.add(key)
            unique.push(entry)
        }
        // Profile titles lead the folder, the general ones fill it up.
        const weight = entry => score(entry) > 0 ? 1 : 0
        return unique.sort((a, b) => weight(b) - weight(a))
    }

    /**
     * Generate (once per session) the VOD recommendations used by the
     * "Movies & Series > Recommended for you" folder.
     * @returns {Promise<Array>}
     */
    async warmVODCache() {
        if (this.vodWarmPromise) return this.vodWarmPromise
        this.vodWarmPromise = (async () => {
            try {
                if (!this.listsLoaded && !this.someListLoaded) return []
                const cached = await this.getVODCache()
                if (Array.isArray(cached) && cached.length) return cached
                const startedAt = Date.now()
                // Fetch more than needed so collapsing repeated episodes of the
                // same series still leaves a full folder behind.
                const fetched = await this.get(null, 40, { type: 'vod', group: true, typeStrict: true })
                let entries = this.collapseVODSeries(this.filterOfflineEntries(fetched), 2).slice(0, 25)
                const topped = await this.topUpVOD(entries, 25)
                if (topped !== entries) {
                    entries = this.collapseVODSeries(topped, 2).slice(0, 25)
                }
                if (!Array.isArray(entries) || !entries.length) return []
                // Few titles after a full pass means the catalog has no VOD
                // content for this profile: keep them instead of rebuilding the
                // folder on every pass.
                await this.setVODCache(entries, { thin: entries.length < 8 && !!this.listsLoaded })
                ErrorHandler.info(`VOD recommendations: ${entries.length} entries built in ${Date.now() - startedAt}ms`)
                return entries
            } catch (err) {
                ErrorHandler.warn('warmVODCache failed:', err?.message || err)
                return []
            } finally {
                setTimeout(() => { this.vodWarmPromise = null }, 60000)
            }
        })()
        return this.vodWarmPromise
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
            ErrorHandler.warn('Smart recommendations not initialized, returning empty array')
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
        if (type === 'live' && (!Array.isArray(epgLoaded) || epgLoaded.length === 0)) {
            // Return empty to trigger fallback in getEntriesWithSpecials, but log for debugging
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
                recommendationOptions.type = 'vod'
                recommendationOptions.group = group
                recommendationOptions.typeStrict = typeStrict
            }

            const recommendations = await this.smartRecommendations.getRecommendations(userContext, recommendationOptions)

            if (!recommendations || recommendations.length === 0) {
                ErrorHandler.warn('getRecommendations returned empty results')
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
            ErrorHandler.warn('Smart recommendations failed:', error.message)
            return []
        }
    }

    /**
     * Get channel recommendations with diversity filtering
     * @param {number} amount - Number of channels
     * @param {Array} excludes - Channels to exclude
     * @returns {Promise<Array>} Channel recommendations
     */
    async getChannels(amount = 5, excludes = [], userTags = null) {

        // getChannels can run before full init: only needs channelList (used for featuredEntries fallback when UI renders early)
        if (!global.channels?.channelList?.categories) {
            await global.channels.ready()
        }
        if (!global.channels?.channelList?.categories || !global.channels?.toMetaEntry) {
            return []
        }

        // Ensure channelsIndex is ready before processing
        global.channels.channelList.updateChannelsIndex(false)

        const channels = Object.values(
            await global.channels.channelList.get()
        ).flat()

        // Transform to recommendation format using channels.toMetaEntry
        const transformedChannels = []
        for (const channel of channels) {
            try {
                // Skip invalid channels
                if (!channel || typeof channel !== 'string' || !channel.trim()) {
                    continue
                }

                const { name: channelName, terms: channelTerms } = global.channels.channelList.expandName(channel)

                // Skip if channelName is invalid
                if (!channelName || typeof channelName !== 'string' || !channelName.trim()) {
                    continue
                }

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

                // Skip if entry is invalid
                if (!entry || typeof entry !== 'object' || !entry.name) {
                    continue
                }

                // Ensure terms are preserved in the final entry
                if (channelTerms && Array.isArray(channelTerms) && channelTerms.length > 0) {
                    entry.terms = channelTerms
                }

                // Calculate relevance score based on user tags
                if (userTags && typeof userTags === 'object') {
                    entry.score = scoreChannelByTags(channelName, userTags)
                } else {
                    entry.score = 0 // Default score if no tags provided
                }

                transformedChannels.push(entry)
            } catch (error) {
                ErrorHandler.warn('Failed to process channel in getChannels:', error.message)
                // Continue without adding the problematic entry
            }
        }

        // Sort by score descending if userTags provided, otherwise keep original order
        if (userTags && typeof userTags === 'object') {
            transformedChannels.sort((a, b) => (b.score || 0) - (a.score || 0))
        } else if (this.lastCachedChannelNames.length) {
            // Keep the order of the last recommended channels, so restarting the
            // app doesn't reset the home to the first channels of the user's list.
            const rank = new Map()
            this.lastCachedChannelNames.forEach((name, i) => {
                const key = name.toLowerCase()
                if (!rank.has(key)) rank.set(key, i)
            })
            const rankOf = entry => {
                const key = (entry.originalName || entry.name || '').toLowerCase()
                return rank.has(key) ? rank.get(key) : Infinity
            }
            transformedChannels.sort((a, b) => rankOf(a) - rankOf(b))
        }

        // Return only the requested amount
        return transformedChannels.slice(0, amount)
    }

    /**
     * Channels from the loaded lists that match the content profile in force.
     * `channels.channelList` is a curated subset of the community lists, so the
     * list a profile bundles (e.g. the adult list) would never reach the
     * recommendations without querying the lists themselves.
     * @param {number} amount - How many entries are wanted
     * @param {Array<string>} excludes - Channel names already on the row
     * @returns {Promise<Array>} Profile aligned entries
     */
    async getProfileChannels(amount, excludes = []) {
        const lists = global.lists
        const profile = lists?.contentProfile
        if (!amount || amount < 1 || !lists || !profile) {
            return []
        }
        if (typeof profile.effective != 'function' || !profile.effective() || typeof profile.seedTags != 'function') {
            return []
        }
        if (typeof lists.search != 'function') {
            return []
        }

        // The lists can still be loading when the first update runs; give them a
        // short grace period and let scheduleProfileRefresh() retry afterwards.
        for (let i = 0; i < 6 && typeof lists.loaded == 'function' && !lists.loaded(); i++) {
            await new Promise(resolve => setTimeout(resolve, 500))
        }
        if (typeof lists.loaded == 'function' && !lists.loaded()) {
            return []
        }

        const profileSources = new Set(typeof profile.listsForDiscovery == 'function' ? profile.listsForDiscovery() : [])
        // Generic words ("adult") also match general channels ("Adult Swim"), so
        // they are only used after the specific ones.
        const generic = new Set(['adult', 'adulto', 'adultos', 'sexy', 'sensual', 'playboy'])
        const terms = Object.keys(profile.seedTags() || {})
            .filter(term => /^[a-z]{3,}$/.test(term))
            .sort((a, b) => (generic.has(a) ? 1 : 0) - (generic.has(b) ? 1 : 0))

        const seen = new Set(excludes.map(name => String(name).toLowerCase()))
        const candidates = []
        for (const term of terms.slice(0, 6)) {
            if (candidates.length >= amount * 3) {
                break
            }
            // A big limit is needed to reach the community lists (the search
            // stops early once the first lists fill the working set).
            const found = await lists.search(term, { limit: 120, type: 'live' }).catch(error => {
                ErrorHandler.warn('Failed to search lists for the content profile:', error.message)
                return []
            })
            for (const item of (found || [])) {
                const name = String(item?.name || '').trim()
                if (!name || (item.mediaType && item.mediaType != 'live')) {
                    continue
                }
                const key = name.toLowerCase()
                if (seen.has(key)) {
                    continue
                }
                // Hits coming from the list the profile bundles are the best
                // ones; the rest are ranked by how much they are about it.
                let score = profile.groupRelevance({ name, group: item.group || item.groupName || '' })
                if (item.source && profileSources.has(item.source)) {
                    score += 4
                }
                if (score > 0) {
                    seen.add(key)
                    candidates.push({ item, name, score })
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score)

        const entries = []
        for (const candidate of candidates.slice(0, amount)) {
            try {
                const entry = global.channels.toMetaEntry({
                    name: candidate.name,
                    url: candidate.item.url || global.mega?.build(candidate.name, { mediaType: 'live' }),
                    terms: candidate.item.terms
                })
                if (!entry || !entry.name) {
                    continue
                }
                entry.group = candidate.item.group || candidate.item.groupName || ''
                entry.score = 0
                entries.push(entry)
            } catch (error) {
                ErrorHandler.warn('Failed to process a profile channel:', error.message)
            }
        }

        return entries
    }

    /**
     * Get entries with special entries (improve, watched) - replaces old entries() method
     * @param {Object} tags - User tags
     * @param {number} amount - Number of entries
     * @param {Object} options - Options for recommendations
     * @returns {Promise<Array>} Entries with special entries
     */
    async getEntriesWithSpecials(tags, amount = 25, options = {}) {
        const {
            type = 'live',
            specials = false,
            allowGenerate = false,
            allowFallback = true,
            cacheTimeoutMs = 200,
            fallbackTimeoutMs = 400,
            generateTimeoutMs = 1200
        } = options

        const withTimeout = async (promise, timeoutMs, fallback, label) => {
            if (!timeoutMs || timeoutMs <= 0) {
                return promise
            }
            let timeoutId
            const timeoutPromise = new Promise(resolve => {
                timeoutId = setTimeout(() => resolve(fallback), timeoutMs)
            })
            const safePromise = Promise.resolve(promise).catch(err => {
                ErrorHandler.warn(`Smart entries ${label} failed:`, err?.message || err)
                return fallback
            })
            try {
                return await Promise.race([safePromise, timeoutPromise])
            } finally {
                if (timeoutId) clearTimeout(timeoutId)
            }
        }

        try {
            let entries = []
            const configuredType = this.getEffectiveRecommendationType()
            const canUseCache = type === configuredType

            if (canUseCache && Array.isArray(this.latestEntries) && this.latestEntries.length > 0) {
                entries = this.latestEntries.slice(0, amount)
            }

            if (!entries.length && canUseCache) {
                const cached = await withTimeout(this.getCache(true), cacheTimeoutMs, null, 'getCache')
                if (Array.isArray(cached) && cached.length > 0) {
                    entries = cached.slice(0, amount)
                }
            }

            // VOD recommendations live in their own cache: they are much more
            // expensive to build and the live cache never holds them.
            if (!entries.length && type === 'vod') {
                const cachedVod = await withTimeout(this.getVODCache(), cacheTimeoutMs, null, 'getVODCache')
                if (Array.isArray(cachedVod) && cachedVod.length > 0) {
                    entries = cachedVod.slice(0, amount)
                }
            }

            if (!entries.length && allowGenerate) {
                // Searching every list for VOD entries takes far longer than the
                // lightweight live path, so give it room before falling back.
                const generateTimeout = type === 'vod' ? Math.max(generateTimeoutMs, 8000) : generateTimeoutMs
                // Reuse an in-flight background build instead of searching all lists twice
                const generation = (type === 'vod' && this.vodWarmPromise)
                    ? this.vodWarmPromise
                    : this.get(tags, amount, options)
                entries = await withTimeout(generation, generateTimeout, [], 'get')
                if (type === 'vod' && Array.isArray(entries) && entries.length) {
                    // VOD lists are episode-based: spread the series instead of
                    // letting one show fill the whole folder.
                    entries = this.filterOfflineEntries(entries)
                    entries = this.collapseVODSeries(entries, 2).slice(0, amount)
                    this.setVODCache(entries).catch(err => ErrorHandler.warn('Failed to save VOD recommendations cache:', err?.message || err))
                }
            }

            if (!entries.length) {
                this.maybeUpdateCache().catch(err => {
                    ErrorHandler.warn('Failed to schedule cache update:', err?.message || err)
                })
            }

            if (!Array.isArray(entries) || entries.length === 0) {
                if (!allowFallback) {
                    return []
                }
                entries = await withTimeout(this.getFallbackEntries(type === 'vod', amount), fallbackTimeoutMs, [], 'getFallbackEntries')
            }

            if (!Array.isArray(entries) || entries.length === 0) {
                return []
            }

            // Add special entries
            if (specials === true) {
                if (entries.length <= 5) {
                    entries.unshift(this.getImproveEntry())
                }

                // Add recommendation type configuration entry
                entries.push(this.getRecommendationTypeEntry())

                const interestsGroup = await this.buildManualInterestsGroupEntry()
                if (interestsGroup) {
                    entries.push(interestsGroup)
                }
                entries.push(this.getWatchedEntry())
            }
            return entries

        } catch (error) {
            ErrorHandler.warn('Smart entries with specials failed:', error.message)
            if (!allowFallback) {
                return []
            }
            return withTimeout(this.getFallbackEntries(type === 'vod', amount), fallbackTimeoutMs, [], 'getFallbackEntries')
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
            ErrorHandler.warn('Smart recommendations update failed:', error.message)
            throw error
        }
    }

    /**
     * Signature of the content profile the caches were built under. A cache
     * written under another profile (or another parental age) is discarded, so
     * switching the profile never keeps serving the previous profile's picks.
     * @returns {string}
     */
    profileSignature() {
        const profile = global.lists?.contentProfile
        if (!profile || typeof profile.state != 'function') {
            return ''
        }
        try {
            const state = profile.state() || {}
            return `${state.effective || ''}@${state.age ?? ''}`
        } catch (err) {
            return ''
        }
    }

    /** Whether an entry is about the content profile in force. */
    isProfileAligned(entry) {
        const profile = global.lists?.contentProfile
        if (!entry || !profile || typeof profile.groupRelevance != 'function' || !profile.effective?.()) {
            return false
        }
        // Titles from a list the profile bundles are aligned by origin: the adult
        // catalog names its groups after niches ("Brunette"), which the profile
        // vocabulary never matches.
        if (typeof profile.isProfileSource == 'function' && profile.isProfileSource(entry.source)) {
            return true
        }
        const name = entry.originalName || entry.name || entry.programme?.channel || ''
        return profile.groupRelevance({ name, group: entry.group || '' }) > 0
    }

    /**
     * Reserved share of the row for the content profile in force. The EPG-driven
     * picks are general channels, so the content a profile bundles (adult list,
     * themed list) would never reach the home without a quota.
     * @param {Array} entries - Entries already picked
     * @param {number} amount - Size of the row
     * @returns {number} how many profile-aligned entries are still missing
     */
    profileFocusDeficit(entries, amount) {
        const profile = global.lists?.contentProfile
        if (!profile || typeof profile.groupRelevance != 'function' || !profile.effective?.()) {
            return 0
        }
        const target = Math.ceil(amount * 0.25)
        const aligned = (Array.isArray(entries) ? entries : []).filter(entry => this.isProfileAligned(entry)).length
        return Math.max(0, target - aligned)
    }

    /**
     * Spreads the profile picks through the row instead of dumping them at the
     * end, where the home screen never shows them.
     */
    interleaveProfilePicks(entries, picks) {
        const out = Array.isArray(entries) ? entries.slice() : []
        if (!Array.isArray(picks) || !picks.length) {
            return out
        }
        const step = Math.max(1, Math.floor(out.length / picks.length))
        picks.forEach((pick, i) => {
            out.splice(Math.min(out.length, 1 + ((i + 1) * step)), 0, pick)
        })
        return out
    }

    /**
     * The lists are usually still being loaded - and their search index still
     * being built - when the first update runs, so the content the profile
     * bundles is missing from the row. Probe the profile search until it answers
     * and only then rebuild the row, otherwise the profile would stay invisible
     * until the next update (which can take minutes on the EPG).
     */
    scheduleProfileRefresh() {
        const lists = global.lists
        if (!lists || this._profileRefreshTimer) {
            return
        }
        if (typeof lists.contentProfile?.effective != 'function' || !lists.contentProfile.effective()) {
            return
        }
        const loaded = typeof lists.loaded != 'function' || lists.loaded()
        if (loaded && !this._profilePicksMissing) {
            return
        }
        // Two rebuilds per profile state at most: a profile whose content is
        // already in the row must not be rebuilt again.
        if (this._profileRefreshTries >= 2) {
            return
        }
        let ticks = 0
        this._profileRefreshTimer = setInterval(async () => {
            ticks++
            if (!this._profilePicksMissing) { // a regular update already fixed the row
                this.stopProfileRefresh()
                return
            }
            const ready = typeof global.lists?.loaded != 'function' || global.lists.loaded()
            if (!ready && ticks < 40) { // ~160 seconds
                return
            }
            this.stopProfileRefresh()
            if (!ready || this._profileRefreshTries >= 2) {
                return
            }
            let available = 0
            try {
                available = (await this.getProfileChannels(1, [])).length
            } catch (error) {
                ErrorHandler.warn('Profile search probe failed:', error.message)
            }
            if (!available) { // still being indexed, probe again later
                this.scheduleProfileRefresh()
                return
            }
            this._profileRefreshTries++
            // shouldUpdate() refuses to rebuild a row it just wrote, so ask for it
            // explicitly instead of relying on the regular readiness heuristics.
            this._forceProfileRefresh = true
            this.updateLimiter.skip()
            this.update().catch(error => ErrorHandler.warn('Failed to refresh the profile recommendations:', error.message))
        }, 4000)
        if (typeof this._profileRefreshTimer.unref == 'function') {
            this._profileRefreshTimer.unref()
        }
    }

    /** Stops the pending profile refresh timer, if any. */
    stopProfileRefresh() {
        if (this._profileRefreshTimer) {
            clearInterval(this._profileRefreshTimer)
        }
        this._profileRefreshTimer = null
    }

    /**
     * Perform actual update (internal method)
     */
    async performUpdate() {
        try {
            if (!this.initialized) {
                return
            }

            const amount = 48
            let entries = []
            this._profilePicksMissing = false
            this._profilePicksAdded = false

            // Always generate new recommendations in update()
            let userContext
            try {
                userContext = {
                    userId: this.getCurrentUserId(),
                    tags: await this.getUserTags(),
                    applyParentalControl: !global.lists?.parentalControl?.lazyAuth?.()
                }
            } catch (error) {
                ErrorHandler.warn('Failed to create user context:', error.message)
                userContext = {
                    userId: 'anonymous',
                    tags: { default: true },
                    applyParentalControl: true
                }
            }

            let recommendations = []
            const configuredType = this.getEffectiveRecommendationType()
            if (!configuredType) {
                ErrorHandler.warn('performUpdate: configuredType is not defined or falsy, skipping update')
                return
            }
            try {
                const recommendationOptions = {
                    limit: 3 * amount,
                    includeSemantic: true,
                    includeTraditional: true
                }

                // Add VOD-specific options if configured for VOD
                if (configuredType === 'vod') {
                    recommendationOptions.type = 'vod'  // Use 'vod' consistently
                    recommendationOptions.group = false
                    recommendationOptions.typeStrict = true
                }

                recommendations = await this.smartRecommendations.getRecommendations(userContext, recommendationOptions)
            } catch (error) {
                ErrorHandler.warn('Smart recommendations getRecommendations failed:', error.message)
                recommendations = []
            }

            if (Array.isArray(recommendations) && recommendations.length) {
                entries = this.transformRecommendations(recommendations)
            } else { // let path open for next update
                // For VOD, don't mark EPG as unloaded since VOD doesn't depend on EPG
                if (configuredType !== 'vod') {
                    this.epgLoaded = false;
                }
                this.someListLoaded = false;         
            }

            // Fill with channels if needed, reserving part of the row for the
            // content profile in force (see profileFocusDeficit).
            const focusDeficit = this.profileFocusDeficit(entries, amount)
            let profilePicks = []
            if (entries.length < amount || focusDeficit > 0) {
                try {
                    const entryName = entry => (entry && typeof entry === 'object') ? (entry.originalName || entry.name || '') : ''

                    if (focusDeficit > 0) {
                        const picks = await this.getProfileChannels(focusDeficit, entries.map(entryName).filter(name => name))
                        if (picks.length) {
                            profilePicks = picks
                            this._profilePicksMissing = false
                            this._profilePicksAdded = true
                            this._profileRefreshTries = 0
                        } else {
                            this._profilePicksMissing = true
                        }
                    }

                    if (entries.length + profilePicks.length < amount) {
                        const excludes = entries.map(entryName)
                            .concat(profilePicks.map(entryName))
                            .filter(name => name)
                        const missing = amount - entries.length - profilePicks.length
                        const channels = await this.getChannels(missing, excludes, userContext.tags)
                        entries.push(...channels.slice(0, missing))
                    }
                } catch (error) {
                    ErrorHandler.warn('Failed to get channel fallback:', error.message)
                    // Continue without channel fallback
                }
            }

            if (entries.length > amount) {
                entries = entries.slice(0, amount)
            }

            // Filter available channels BEFORE caching (non-intrusive test here)
            if (entries.length > 0) {
                try {
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

                    if (availableChannels && typeof availableChannels === 'object') {
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

                        // If no available entries but we have non-available ones, include some anyway
                        if (availableResults.length === 0 && nonAvailableResults.length > 0) {
                            entries = nonAvailableResults.slice(0, amount)
                        }
                    } else {
                        // If availableChannels is not available, use all entries
                        ErrorHandler.warn('availableChannels is not an object, using all entries')
                    }
                } catch (error) {
                    ErrorHandler.warn('Failed to filter available channels (lists.has), caching entries as-is:', error.message)
                    // Keep entries unchanged so setCache() is still called below
                }
            }

            // Different EPG sources can describe the same broadcast twice (same
            // channel, same start): keep only the first, best ranked occurrence.
            if (entries.length) {
                const seenProgrammes = new Set()
                entries = entries.filter(entry => {
                    const channel = entry?.programme?.channel
                    const start = entry?.programme?.start
                    if (!channel || typeof start !== 'number') return true
                    const key = `${channel.toLowerCase()}@${start}`
                    if (seenProgrammes.has(key)) return false
                    seenProgrammes.add(key)
                    return true
                })
            }

            // Before the EPG is parsed the engine can only tell channels apart by
            // name, and generic/kids names end up outranking the profile-aligned
            // ones. Re-rank the programme-less fallback by the profile tags so the
            // first screen still reflects the content profile the user chose.
            if (entries.length && !entries.some(e => e?.programme?.channel)) {
                const profileScores = new Map()
                const profileScoreOf = entry => {
                    const name = entry?.originalName || entry?.name || ''
                    const key = name.toLowerCase()
                    if (!profileScores.has(key)) profileScores.set(key, scoreChannelByTags(name, userContext.tags))
                    return profileScores.get(key)
                }
                entries = entries
                    .map((entry, index) => ({ entry, index, profileScore: profileScoreOf(entry) }))
                    .sort((a, b) => (b.profileScore - a.profileScore) || ((b.entry.score || 0) - (a.entry.score || 0)) || (a.index - b.index))
                    .map(item => item.entry)
            }

            // Spread the profile picks now: the re-ranking above orders by score,
            // which would otherwise push them all to the end of the row.
            if (profilePicks.length) {
                entries = this.interleaveProfilePicks(entries.slice(0, Math.max(0, amount - profilePicks.length)), profilePicks)
            }

            // Cache the results (already filtered by availability)
            if (entries.length) {
                // Don't downgrade a rich cache (recommendations with programmes) to
                // programme-less channels just because the EPG is still loading.
                // Otherwise every boot overwrote what the user had been recommended.
                if (!await this.wouldDowngradeCache(entries)) {
                    await this.setCache(entries)
                }
                // Emit updated event to trigger UI refresh
                this.emit('updated')
            }
            this.readyState = ((this.epgLoaded || !this.isEPGEnabled()) && this.listsLoaded) ? 4 : 3
            this.scheduleProfileRefresh()
        } catch (error) {
            ErrorHandler.error('performUpdate failed:', error.message, error.stack)
            throw error
        }
    }

    /**
     * Get featured entries (CRITICAL PERFORMANCE FUNCTION - only uses cached data)
     * This function is called frequently during UI rendering and MUST be fast.
     * It NEVER generates new data, only returns pre-computed cached results.
     * All data generation happens asynchronously via events (channels loaded, EPG updated, etc.)
     * @param {number} amount - Number of entries
     * @returns {Promise<Array>} Featured entries from cache only
     */
    async featuredEntries(amount = 5) {
        // CRITICAL: Only use cached data, NEVER generate or test anything here
        const results = await this.getCache()

        // Define configuredType to fix ReferenceError
        const configuredType = this.getEffectiveRecommendationType()

        // DEBUG: Log cache status and type
        ErrorHandler.debug(`featuredEntries: cache results length=${results ? results.length : 'null'}, configuredType=${configuredType}, listsLoaded=${this.listsLoaded}, epgLoaded=${this.epgLoaded}`)
        
        let currentEntryPosition = null
        let nextEntryPosition = null
        
        const topEntries = []
        const currentEntry = global.streamer.active?.data || global.streamer.lastActiveData || global.channels.history?.get(0)
        const currentEntryAtts = global.streamer.streamInfo.data?.[currentEntry.url]?.atts
        const currentEntryLive = mega.isMega(currentEntry.url) || StreamClassifier.clearlyLive(currentEntry);
        if (currentEntryAtts && currentEntryAtts.duration && currentEntryAtts.position && currentEntryAtts.position > 10 && (currentEntryAtts.position < (currentEntryAtts.duration - 30))) {
            currentEntryPosition = currentEntryAtts.position
        }

        const nextEntry = await global.streamer?.getNext(0, currentEntry)
        const nextEntryAtts = global.streamer.streamInfo.data?.[nextEntry.url]?.atts
        if (nextEntryAtts && nextEntryAtts.duration && nextEntryAtts.position && nextEntryAtts.position > 10 && (nextEntryAtts.position < (nextEntryAtts.duration - 30))) {
            nextEntryPosition = nextEntryAtts.position
        }

        const continueEntry = (nextEntry && (global.streamer.active || (!currentEntryPosition && !currentEntryLive))) ? nextEntry : currentEntry
        if (continueEntry) {
            topEntries.unshift(continueEntry)
        }

        const trendingEntries = global.channels.trending?.currentEntries?.slice(0, 2)
        if (Array.isArray(trendingEntries) && trendingEntries.length) { // Add some event channels to the top
            topEntries.unshift(...trendingEntries)
        }
        
        // If no cache exists or results is null/empty, try fallback from latestEntries
        if ((!results || !Array.isArray(results) || results.length === 0) &&
            Array.isArray(this.latestEntries) && this.latestEntries.length > 0 &&
            this.initialized && 
            (this.listsLoaded && (configuredType === 'vod' || this.epgLoaded))) {

            const fromLatest = this.orderByRelevance(this.latestEntries)
            return this.dedupeFeaturedEntries(fromLatest.slice(0, amount), topEntries)
        }

        // SPECIAL CASE: For VOD, if no cache but lists are loaded, force generation once
        if ((!results || !Array.isArray(results) || results.length === 0) && 
            configuredType === 'vod' && this.listsLoaded && this.initialized) {
            try {
                // Force generation for VOD when cache is empty but conditions are met
                const vodResults = await this.get({}, amount, { type: 'vod' })
                if (Array.isArray(vodResults) && vodResults.length > 0) {
                    // Cache the results for future calls
                    await this.setCache(vodResults)
                    return this.dedupeFeaturedEntries(vodResults.slice(0, amount - topEntries.length), topEntries)
                }
            } catch (error) {
                ErrorHandler.warn('featuredEntries: failed to force VOD generation:', error.message)
            }
        }

        // If still no cache, use getChannels() as fallback since channel processing is now fast
        if (!results || !Array.isArray(results) || results.length === 0) {
            try {
                const channelsFallback = await this.getChannels(amount, [])
                if (Array.isArray(channelsFallback) && channelsFallback.length > 0) {
                    return this.dedupeFeaturedEntries(channelsFallback, topEntries)
                }
            } catch (error) {
                ErrorHandler.warn('Failed to get channels fallback:', error.message)
            }
            
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

        // Cached entries are already ranked (profile + score): keep that order,
        // sorting by programme start here would throw the relevance away.
        let ranked = this.orderByRelevance(results)
        if (this.shouldMixVODInHome()) {
            ranked = await this.mixVODInEntries(ranked, amount - topEntries.length)
        }
        return this.dedupeFeaturedEntries(
            ranked.slice(0, amount - topEntries.length),
            topEntries
        )
    }

    /**
     * With `recommendations-type=auto` the home row follows the history, and until
     * something is played that means live TV only. Narrow profiles (movies, series,
     * kids, music...) are mostly VOD, so their home row mixes VOD in instead of
     * showing live channels exclusively. News and sports stay live-first, and the
     * general profile keeps the plain auto behaviour.
     * @returns {boolean}
     */
    shouldMixVODInHome() {
        if (this.getConfiguredRecommendationType() !== 'auto') {
            return false
        }
        if (this.getEffectiveRecommendationType() === 'vod') {
            return false // the row is already VOD
        }
        const profile = global.lists?.contentProfile
        if (!profile || typeof profile.effective != 'function') {
            return false
        }
        const code = profile.effective()
        if (!code) {
            return false
        }
        return !['news', 'sports'].includes(code)
    }

    /**
     * Interleaves some VOD titles into a live list so the profile content shows up
     * early without taking the row over. Live relevance weighs
     * LIVE_RELEVANCE_WEIGHT times a VOD title, so VOD only gets
     * `share / LIVE_RELEVANCE_WEIGHT` of the row (roughly one title every 3-4
     * slots) and they are spread evenly instead of clustered.
     * @param {Array} entries - Ranked live entries
     * @param {number} limit - How many entries the caller is going to display
     * @param {number} share - VOD share of the row before the live weight
     * @returns {Array}
     */
    async mixVODInEntries(entries, limit, share = 0.35) {
        const live = Array.isArray(entries) ? entries : []
        const vod = await this.getVODCache().catch(() => null)
        if (!Array.isArray(vod) || !vod.length) {
            return live
        }
        const key = entry => String(entry?.url || entry?.originalName || entry?.name || '').toLowerCase()
        const seen = new Set(live.map(key))
        const pool = []
        for (const entry of this.collapseVODSeries(vod)) {
            const k = key(entry)
            if (!k || seen.has(k)) continue
            seen.add(k)
            pool.push(entry)
        }
        if (!pool.length) {
            return live
        }
        const vodShare = share / LIVE_RELEVANCE_WEIGHT
        const slots = Math.min(
            pool.length,
            Math.max(1, Math.min(Math.max(1, limit - 1), Math.round(Math.max(1, limit) * vodShare)))
        )
        // Profile-aligned titles lead, so the row keeps the profile's flavour when
        // the catalog has anything aligned with it.
        const relevance = entry => {
            try {
                const profile = global.lists?.contentProfile
                if (!profile || typeof profile.groupRelevance != 'function') return 0
                return profile.groupRelevance({ name: entry?.originalName || entry?.name || '', group: entry?.group || '' }) || 0
            } catch (err) {
                return 0
            }
        }
        const rankedPool = this.orderByRelevance(pool)
            .map(entry => ({ entry, score: relevance(entry) }))
            .sort((a, b) => b.score - a.score)
            .map(item => item.entry)
        const aligned = rankedPool.filter(entry => this.isProfileAligned(entry))
        const picked = (aligned.length ? aligned : rankedPool).slice(0, aligned.length ? slots : 1)
        // Evenly spread the picked titles: one VOD every `limit / slots` slots.
        const positions = new Set()
        for (let n = 1; n <= picked.length; n++) {
            positions.add(Math.max(0, Math.round((n * Math.max(1, limit)) / picked.length) - 1))
        }
        const ret = []
        let i = 0, v = 0
        while (i < live.length || v < picked.length) {
            if (v < picked.length && (i >= live.length || positions.has(ret.length))) {
                ret.push(picked[v++])
            } else {
                ret.push(live[i++])
            }
        }
        return ret
    }

    /**
     * Keep the relevance order produced by the scorer, only pushing programmes
     * that already ended behind the ones still running/upcoming.
     * @param {Array} entries
     * @returns {Array}
     */
    orderByRelevance(entries) {
        if (!Array.isArray(entries)) return []
        const now = Date.now() / 1000
        const isExpired = e => typeof e?.programme?.end === 'number' && e.programme.end > 0 && e.programme.end < now
        return [...entries].sort((a, b) => isExpired(a) - isExpired(b))
    }

    /**
     * VOD lists describe episodes, not titles: a single series can fill the whole
     * "Recommended for you" folder with "S01 E01..E08". Keep the best few episodes
     * of each series (same group/season) and let the other titles surface.
     * @param {Array} entries - VOD entries
     * @param {number} perSeries - Episodes kept per series
     * @returns {Array}
     */
    collapseVODSeries(entries, perSeries = 2) {
        if (!Array.isArray(entries) || !entries.length) return entries || []
        const episode = /(^|[^a-z0-9])(?:s\d{1,2}[\s._-]*e\d{1,3}|t\d{1,2}[\s._-]*e\d{1,3}|ep\.?\s?\d{1,3}|cap(?:[ií]tulo)?\s*\d{1,3})(?![a-z0-9])/i
        const seasons = /(^|[^a-z0-9])(?:s\d{1,2}|t\d{1,2}|temporada|season)(?![a-z0-9])/i
        const counter = new Map()
        const kept = entries.filter(entry => {
            const name = String(entry?.name || entry?.title || entry?.programme?.title || '')
            const group = String(entry?.group || entry?.channel || entry?.programme?.channel || '')
            // Key by the title without the episode/season marker so distinct
            // series keep separate budgets and generic groups (e.g. "Movies")
            // are not collapsed together.
            let key = ''
            if (episode.test(name)) {
                // Usually the series name is in the title ("Show S01 E02"), but some
                // lists put only "S01 E02" in the name and the series in the group.
                key = name.replace(episode, ' ').replace(/[\s._-]+$/, '').trim().toLowerCase()
            }
            if (!key && (episode.test(name) || episode.test(group) || seasons.test(group))) {
                key = group.trim().toLowerCase()
            }
            if (!key) return true
            const seen = counter.get(key) || 0
            if (seen >= perSeries) return false
            counter.set(key, seen + 1)
            return true
        })
        // A list laid out as "Show S01 E01" everywhere would be collapsed to a
        // handful of titles: keep the original selection in that case.
        return kept.length >= Math.min(8, Math.ceil(entries.length * 0.4)) ? kept : entries
    }

    dedupeFeaturedEntries(entries, topEntries=null) { // originalName, name, programme.channel
        // if topEntries is an array
        // check if each entry is in the topEntries array
        // if it is, merge the entries to keep the 'programme' object and remove it from the entries array
        if (Array.isArray(topEntries) && topEntries.length > 0) {
            for (let entry of topEntries.reverse()) {
                entries.some(e => {
                    if ((e.originalName && e.originalName === entry.originalName) || (e.name && e.name === entry.name) || (e.programme?.channel && e.programme?.channel === entry.programme?.channel)) {
                        entries.splice(entries.indexOf(e), 1)
                        entry = Object.assign({}, entry, e)
                        return true
                    }
                    return false
                })
                if (entries.indexOf(entry) === -1) {
                    entries.unshift(Object.assign({}, entry))
                }
            }
        }
        return entries
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
                renderer: this.getEntriesWithSpecials.bind(this, null, 25, { type: 'vod', allowGenerate: true, specials: true })
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
                    const configuredType = this.getEffectiveRecommendationType()
                    recommendations.push({
                        name: global.lang.MORE,
                        details: global.lang.RECOMMENDED_FOR_YOU,
                        fa: 'fas fa-plus',
                        type: 'group',
                        renderer: this.getEntriesWithSpecials.bind(this, null, 25, { type: configuredType, specials: true }),
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
            ErrorHandler.warn('Failed to clear tags cache after toggling external trends flag:', err?.message || err)
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
            return {
                name: global.lang.INTERESTS,
                fa: 'fas fa-sliders-h',
                details: lang.CONFIGURE,
                type: 'group',
                renderer: async () => {
                    return this.getManualInterestEntries()
                }
            }
        } catch (error) {
            ErrorHandler.warn('Failed to build manual interests group:', error?.message || error)
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
            ErrorHandler.warn('Failed to get interest suggestions:', error?.message || error)
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
            ErrorHandler.warn('Failed to handle suggested interest action:', error?.message || error)
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
            ErrorHandler.warn('Failed to handle manual interest action:', error?.message || error)
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
            ErrorHandler.warn('Failed to add manual interest:', error?.message || error)
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
            ErrorHandler.warn('Failed to create manual interest busy lock:', error?.message || error)
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
            ErrorHandler.warn('Manual tag change update failed:', error?.message || error)
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

        // Extract base name (remove numbers and common suffixes) without regex (avoids ReDoS)
        const stripSuffix = (n) => {
            let out = n
            // Strip trailing digits
            let i = out.length
            while (i > 0) {
                const c = out.charCodeAt(i - 1)
                if (c >= 48 && c <= 57) i--
                else break
            }
            if (i < out.length) out = out.slice(0, i)
            // Strip trailing whitespace
            out = out.trimEnd()
            // Strip a trailing suffix word (tv/channel/brasil) preceded by whitespace
            const idx = out.lastIndexOf(' ')
            const last = idx === -1 ? out : out.slice(idx + 1)
            if (idx !== -1 && ['tv', 'channel', 'brasil'].includes(last)) {
                out = out.slice(0, idx).trimEnd()
            }
            return out
        }
        const baseName1 = stripSuffix(name1)
        const baseName2 = stripSuffix(name2)

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
        const entries = recommendations.map((rec, index) => {
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

        // A whole season/series must count as a single recommendation, not one
        // slot per episode (e.g. 16 One Piece episodes used to fill the home)
        return this.collapseSeriesEpisodes(entries)
    }

    /**
     * Strip a trailing season marker from a group path leaf, so sibling groups
     * ("X S01", "X S02", "X 1ª Temporada") all map back to the series name ("X").
     * @param {string} groupPath - Group path, e.g. 'Série/ONE PIECE S01'
     * @returns {string} Group path without the season marker
     */
    stripSeasonFromGroup(groupPath) {
        const parts = String(groupPath || '').split('/').map(p => p.trim()).filter(p => p)
        if (!parts.length) return ''
        const leaf = parts[parts.length - 1]
            .replace(/\b(?:s|t)\s*\d{1,3}\s*$/i, '') // ... S01 / T2
            .replace(/\b\d{1,3}\s*[ªa°]?\s*temporada\s*$/i, '') // ... 1ª Temporada
            .replace(/\btemporada\s*\d{1,3}\s*$/i, '') // ... Temporada 1
            .replace(/\bseason\s*\d{1,3}\s*$/i, '') // ... Season 1
            .replace(/[\s\-–—_:.]+$/, '')
            .trim()
        if (!leaf) {
            // The whole segment was a season marker ('.../Série/Season 1'): use the parent
            parts.pop()
            return parts.length ? parts.join('/') : String(groupPath || '').trim()
        }
        parts[parts.length - 1] = leaf
        return parts.join('/')
    }

    /**
     * Strip season/episode markers from a name ("S01 E02", "1x02", "T1E2", "EP 3",
     * including wrappers left empty like "()") so every episode of the same
     * series maps to the same base name.
     * @param {string} name
     * @returns {string} Base name, lowercased
     */
    episodeBaseName(name) {
        return String(name || '')
            .replace(/\b(?:s\s*\d{1,3}\s*[-_. ]?\s*e\s*\d{1,4}|t\s*\d{1,3}\s*[-_. ]?\s*e\s*\d{1,4}|\d{1,3}\s*x\s*\d{1,4})\b/gi, ' ')
            .replace(/[([{]\s*[)\]}]/g, ' ')
            .replace(/\b(?:s|t)\s*\d{1,3}\s*$/i, ' ') // season left over from the name
            .replace(/\s+/g, ' ')
            .replace(/^[\s\-–—_:.]+|[\s\-–—_:.]+$/g, '') // leftover separators
            .trim()
            .toLowerCase()
    }

    /**
     * Grouping key of a recommended VOD entry when it looks like an episode of
     * a series (same series name + same base name, across seasons).
     * @param {Object} entry - Menu entry
     * @returns {Object|null} { key, path, group }
     */
    seriesEpisodeInfo(entry) {
        if (!entry || typeof entry !== 'object') return null
        if (entry.__seriesFolder) return null // already collapsed
        if (entry.type && entry.type !== 'stream' && entry.type !== 'select') return null
        if (entry.mediaType && entry.mediaType !== 'video') return null // VOD only
        if (entry.programme) return null
        const group = String(entry.group || '').trim()
        if (!group) return null
        const base = this.episodeBaseName(entry.name)
        if (!base) return null
        // Seasons are usually separate sibling groups ("X S01", "X S02"), so key
        // on the series name to keep a single folder for the whole series
        const path = this.stripSeasonFromGroup(group)
        return { key: path.toLowerCase() + '|' + base, path, group, base }
    }

    /**
     * Tell a real series bucket apart from look-alikes.
     * - Same title repeated means duplicate content (mirrors), not episodes.
     * - The base name only resolves to a title when the episode marker is the
     *   last part of the name; otherwise it is a subtitle fragment
     *   ("Episódio 3 - O Começo") and unrelated entries would be merged.
     * @param {Object} bucket - { path, base, entries }
     * @returns {boolean} True when the bucket holds episodes of one series
     */
    isSeriesEpisodesBucket(bucket) {
        const names = new Set(bucket.entries.map(e => String(e.name || '').trim().toLowerCase()))
        if (names.size < 2) return false
        const base = String(bucket.base || '').trim()
        if (!base) return false
        const marker = /^(?:s\s*\d{1,3}\s*[-_. ]?\s*e\s*\d{1,4}|t\s*\d{1,3}\s*[-_. ]?\s*e\s*\d{1,4}|\d{1,3}\s*x\s*\d{1,4}|(?:ep|epi|epis[oó]dio|cap[ií]tulo|cap)\s*\.?\s*\d{1,4})\b/i
        return bucket.entries.some(entry => {
            const name = String(entry.name || '').toLowerCase().trim()
            if (!name.startsWith(base)) return false // title must lead the name
            const rest = name.slice(base.length).trim()
            return rest === '' || marker.test(rest)
        })
    }

    /**
     * Collapse recommended series episodes into a single folder entry, so a
     * series counts as one recommendation and its episodes live inside it.
     * @param {Array} entries - Menu entries
     * @returns {Array} Entries with collapsed series
     */
    collapseSeriesEpisodes(entries) {
        if (!Array.isArray(entries) || entries.length < 2) return entries
        const buckets = new Map()
        for (const entry of entries) {
            const info = this.seriesEpisodeInfo(entry)
            if (!info) continue
            if (!buckets.has(info.key)) buckets.set(info.key, { path: info.path, base: info.base, entries: [] })
            buckets.get(info.key).entries.push(entry)
        }
        const collapsible = new Map()
        buckets.forEach((bucket, key) => {
            if (bucket.entries.length < 2) return
            if (!this.isSeriesEpisodesBucket(bucket)) return
            collapsible.set(key, bucket)
        })
        if (!collapsible.size) return entries
        const emitted = new Set()
        const result = []
        for (const entry of entries) {
            const info = this.seriesEpisodeInfo(entry)
            if (!info || !collapsible.has(info.key)) {
                result.push(entry)
                continue
            }
            if (emitted.has(info.key)) continue
            emitted.add(info.key)
            result.push(this.buildSeriesFolderEntry(collapsible.get(info.key)))
        }
        return result
    }

    /**
     * Build the folder entry that represents a whole series.
     * Only serializable data is stored; the renderer is rebuilt on cache read.
     * @param {Object} bucket - { path, entries }
     * @returns {Object} Folder entry
     */
    buildSeriesFolderEntry(bucket) {
        const episodes = bucket.entries
        const first = episodes[0]
        // Groups backing this folder (one per season), used when the folder opens
        const groups = Array.from(new Set(episodes.map(e => String(e.group || '').trim()).filter(Boolean)))
        const parts = bucket.path.split('/').map(p => p.trim()).filter(p => p)
        const name = parts[parts.length - 1] || first.groupName || first.name
        const details = parts.slice(0, -1).join(' &middot; ')
        const maxOf = prop => episodes.reduce((max, e) => {
            const value = e?.[prop]
            return typeof value === 'number' && value > max ? value : max
        }, 0)
        const icon = (episodes.find(e => e.icon) || {}).icon
        return {
            name,
            details,
            type: 'group',
            url: 'javascript:;',
            icon,
            class: 'entry-cover',
            fa: 'fas fa-play-circle',
            safe: true,
            group: bucket.path,
            groups: first.groups,
            groupName: first.groupName || name,
            groupTerms: first.groupTerms,
            mediaType: 'video',
            source: first.source,
            score: maxOf('score'),
            normalizedScore: maxOf('normalizedScore'),
            timingScore: maxOf('timingScore'),
            finalScore: maxOf('finalScore'),
            // Persisted marker so the renderer can be restored from the cache
            __seriesFolder: { group: bucket.path, groups, source: first.source || '' },
            renderer: () => this.openSeriesFolder(bucket.path, groups, first.source)
        }
    }

    /**
     * Render the entries of a collapsed series folder.
     * @param {string} seriesPath - Series group path, e.g. 'Série/ONE PIECE: A Série'
     * @param {Array} groupPaths - Groups holding the episodes (one per season)
     * @param {string} source - List URL the groups belong to
     * @returns {Promise<Array>} Menu entries
     */
    async openSeriesFolder(seriesPath, groupPaths, source) {
        const notFound = () => [global.menu?.emptyEntry ? global.menu.emptyEntry(global.lang?.NOT_FOUND) : { name: global.lang?.NOT_FOUND || 'Not found', type: 'action' }]
        try {
            if (!global.lists?.loaded?.()) {
                return [global.lists.manager.updatingListsEntry()]
            }
            const groups = await this.findSeriesGroups(seriesPath, groupPaths, source)
            if (!groups.length) return notFound()
            const groupLeaf = p => String(p || '').trim().split('/').pop()
            const seriesLeaf = groupLeaf(seriesPath).toLowerCase()
            const multi = groups.length > 1
            const output = []
            for (const group of groups) {
                let entries = []
                if (typeof global.channels?.renderGroupEntries === 'function') {
                    entries = await global.channels.renderGroupEntries(group, 'block', true)
                } else {
                    entries = await global.lists.group(group)
                }
                if (!Array.isArray(entries)) entries = []
                if (!entries.length) continue
                if (multi) {
                    // Name the season/group on each episode so they are not mixed up
                    entries = entries.map(entry => {
                        const leaf = groupLeaf(entry.group)
                        if (!leaf || leaf.toLowerCase() === seriesLeaf) return entry
                        return Object.assign({}, entry, {
                            details: (entry.details ? entry.details + ' &middot; ' : '') + leaf
                        })
                    })
                }
                output.push(...entries)
            }
            return output.length ? output : notFound()
        } catch (error) {
            ErrorHandler.warn('Failed to open series folder:', error?.message || error)
            return notFound()
        }
    }

    /**
     * Resolve the lists groups behind a collapsed series folder.
     * @param {string} seriesPath - Series group path
     * @param {Array} groupPaths - Groups recorded when the folder was built
     * @param {string} source - Preferred list URL
     * @returns {Promise<Array>} Group objects ({ group, name, url, icon })
     */
    async findSeriesGroups(seriesPath, groupPaths, source) {
        const all = await global.lists.groups(['series', 'vod']).catch(() => [])
        if (!Array.isArray(all)) return []
        const key = p => String(p || '').trim().toLowerCase()
        const wanted = (Array.isArray(groupPaths) ? groupPaths : []).map(key).filter(p => p)
        const seriesKey = key(seriesPath)
        if (seriesKey && !wanted.includes(seriesKey)) wanted.push(seriesKey)
        const result = []
        const seen = new Set()
        for (const path of wanted) {
            let matches = all.filter(g => key(g.group) === path)
            if (!matches.length && path === seriesKey) {
                // The series itself has no group of its own, so collect its seasons
                const prefix = seriesKey + '/'
                matches = all.filter(g => {
                    const groupKey = key(g.group)
                    return groupKey.startsWith(prefix) && this.stripSeasonFromGroup(g.group).toLowerCase() === seriesKey
                })
            }
            for (const match of matches) {
                const matchKey = key(match.group) + '|' + String(match.url || '')
                if (seen.has(matchKey)) continue
                seen.add(matchKey)
                result.push(match)
            }
        }
        if (result.length > 1 && source) {
            const preferred = result.filter(g => String(g.url || '') === String(source))
            if (preferred.length) return preferred
        }
        return result
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
                    ErrorHandler.info('Ignore external trends enabled, but no manual tags found.')
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
            ErrorHandler.warn('Failed to get user tags:', error.message)
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
            ErrorHandler.warn('Failed to process EPG recommendations:', error.message)
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
            ErrorHandler.warn('Failed to validate channels:', error.message)
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
     * Get recommendation type configuration entry
     * @returns {Object} Recommendation type entry
     */
    getRecommendationTypeEntry() {
        return {
            name: global.lang.RECOMMENDATIONS_TYPE,
            fa: 'fas fa-cog',
            type: 'select',
            renderer: async () => {
                const key = 'recommendations-type'
                const def = global.config?.get(key) || 'auto'
                const effectiveType = this.getEffectiveRecommendationType()
                const opts = [
                    {
                        name: global.lang.AUTO + (def === 'auto' ? ` (${effectiveType === 'live' ? global.lang.LIVE : global.lang.CATEGORY_MOVIES_SERIES})` : ''), 
                        fa: 'fas fa-magic', 
                        type: 'action', 
                        selected: (def == 'auto'), 
                        action: async () => {
                            global.config?.set(key, 'auto')
                            // Invalidate recommendations cache and trigger refresh
                            this.invalidateRecommendationCaches('config-changed')
                            await this.scheduleUpdate()

                            if (global.menu?.refreshNow) {
                                global.menu.refreshNow()
                            }
                        }
                    },
                    {
                        name: global.lang.LIVE || 'Live', 
                        fa: 'fas fa-tv', 
                        type: 'action', 
                        selected: (def == 'live'), 
                        action: async () => {
                            global.config?.set(key, 'live')
                            // Invalidate recommendations cache and trigger refresh
                            this.invalidateRecommendationCaches('config-changed')
                            await this.scheduleUpdate()

                            if (global.menu?.refreshNow) {
                                global.menu.refreshNow()
                            }
                        }
                    },
                    {
                        name: global.lang.CATEGORY_MOVIES_SERIES || 'Movies/Series', 
                        fa: 'fas fa-film', 
                        type: 'action', 
                        selected: (def == 'vod'), 
                        action: async () => {
                            global.config?.set(key, 'vod')
                            // Invalidate recommendations cache and trigger refresh
                            this.invalidateRecommendationCaches('config-changed')
                            await this.scheduleUpdate()

                            if (global.menu?.refreshNow) {
                                global.menu.refreshNow()
                            }
                        }
                    }
                ];
                return opts;
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
        if (!this.updateQueue.size && !this.updateLimiter.pending && this.shouldUpdate()) {
            ErrorHandler.info('🔄 Smart Recommendations: Scheduling update due to system readiness')
            
            // Add to queue (limiter already handles minimum interval)
            return this.updateQueue.add(async () => {
                return this.performUpdate()
            }).then(() => {
                ErrorHandler.info('✅ Smart Recommendations: Auto-update completed')
            }).catch(err => {
                ErrorHandler.warn('⚠️ Smart Recommendations: Auto-update failed:', err.message)
                throw err
            })
        }
        return Promise.resolve()
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
                ErrorHandler.warn('Periodic update check failed:', err.message)
            })
        }, intervalMs)

        ErrorHandler.info(`⏰ Started periodic updates: at least once every ${this.updateIntervalSecs} seconds`)
    }

    /**
     * Stop periodic updates
     */
    stopPeriodicUpdates() {
        if (this.periodicUpdateInterval) {
            clearInterval(this.periodicUpdateInterval)
            this.periodicUpdateInterval = null
            ErrorHandler.info('⏰ Stopped periodic updates')
        }
        this.stopProfileRefresh()
        if (this.updateLimiter) {
            this.updateLimiter.destroy()
        }
    }

    /**
     * Check if we should update based on satisfyAmount conditions
     */
    shouldUpdate() {
        const now = Date.now()

        // A forced profile refresh must not be judged by the readiness heuristics
        // below: the row it needs to rebuild was written seconds ago.
        if (this._forceProfileRefresh) {
            this._forceProfileRefresh = false
            if (this.initialized) {
                this.lastUpdateTime = now
                return true
            }
        }
        
        // Minimum interval between updates (5 seconds)
        const minUpdateInterval = 5000
        if (this.lastUpdateTime && (now - this.lastUpdateTime) < minUpdateInterval) {
            return false
        }
        
        // If we already have sufficient entries and cache is recent (< 30 seconds), skip update
        const cacheAge = this.lastCacheTime ? (now - this.lastCacheTime) : Infinity
        const hasSufficientEntries = this.latestEntries?.length >= 5
        if (hasSufficientEntries && cacheAge < 30000) {
            return false
        }
        
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
            ErrorHandler.info(`🔄 Smart Recommendations: Update conditions met - Reason: ${reason}, EPG: ${epgReady}, Lists: ${listsReady}, Channels: ${channelsReady}, Initialized: ${this.initialized}`)
            this.lastUpdateTime = now
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
                // First update the home filters to get new entries
                await global.menu?.updateHomeFilters().catch(err => global.menu?.displayError(err))
                
                // If we're on home screen and replacing busy placeholders, force a full refresh
                // updateHomeFilters repaints the home only when it isn't navigating/suspended,
                // so right after a page render the placeholders need an explicit refresh.
                const isOnHome = !global.menu?.path
                if (isOnHome && isBusy && busyOut) {
                    global.menu?.refreshNow()
                }
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
        ErrorHandler.debug('⏳ Initial UI update not ensured, will update later')
    }


    /**
     * Check if cache is valid
     * @param {Object} cacheData - Cache data from storage
     * @returns {boolean} True if cache is valid
     */
    isCacheValid(cacheData) {
        return cacheData &&
            cacheData.version === this.cacheVersion &&
            cacheData.featured &&
            cacheData.timestamp &&
            (Date.now() - cacheData.timestamp) < this.cacheMaxAge
    }

    isCacheRich(cacheData) {
        if(!cacheData || !this.isCacheValid(cacheData)) return false
        const type = this.getEffectiveRecommendationType()
        if (type === 'vod') {
            return cacheData.featured.some(e => e && (e.url || e.name))
        } else {
            return cacheData.featured.some(e => !!e?.programme?.channel)
        }
    }

    /**
     * Whether caching `entries` would replace richer persisted recommendations
     * (with programmes) by programme-less channels. This is what happened on
     * every boot while the EPG hadn't loaded yet, discarding what the previous
     * session had learned/recommended.
     * @param {Array} entries - Entries about to be cached
     * @returns {Promise<boolean>} True if the write should be skipped
     */
    async wouldDowngradeCache(entries) {
        try {
            if (this.epgLoaded || !this.isEPGEnabled()) return false
            if (this.getEffectiveRecommendationType() !== 'live') return false
            if (!Array.isArray(entries) || !entries.length) return false
            if (entries.some(e => e?.programme?.channel)) return false
            // Profile picks are an upgrade even without programmes: they are the
            // content the profile bundles, which the cached row never had.
            if (this._profilePicksAdded) return false
            const cacheData = await storage.get(this.cacheKey)
            return this.isCacheRich(cacheData)
        } catch (err) {
            ErrorHandler.warn('Failed to check for cache downgrade:', err?.message || err)
            return false
        }
    }

    /**
     * Extract channel names from recommendation entries (for guiding getChannels when cache is stale)
     * @param {Array} entries - Cached featured entries
     * @returns {Array<string>} Ordered list of channel names
     */
    extractChannelNamesFromEntries(entries) {
        if (!Array.isArray(entries)) return []
        const names = []
        const seen = new Set()
        for (const e of entries) {
            const name = (e?.originalName || e?.programme?.channel || e?.name)?.trim()
            if (name && name !== '&nbsp;' && !/^\s*$/.test(name) && !seen.has(name.toLowerCase())) {
                seen.add(name.toLowerCase())
                names.push(name)
            }
        }
        return names
    }

    /**
     * Get cached featured entries from storage
     * @param {boolean} allowStale - If true, return entries even if timestamp is invalid (default: true)
     * @returns {Promise<Array|null>} Cached entries or null
     */
    async getCache(allowStale = true) {
        try {
            const cacheData = await storage.get(this.cacheKey)

            // Entries produced by an older scoring are dropped, including the stale
            // ones: they would otherwise be served for up to 7 days after an upgrade.
            if (cacheData && cacheData.version !== this.cacheVersion) {
                ErrorHandler.debug(`getCache: discarding cache from scoring v${cacheData.version ?? 1}`)
                return null
            }

            // Built under another content profile / parental age: rebuild.
            const signature = this.profileSignature()
            if (cacheData && signature && (cacheData.profile || '') !== signature) {
                ErrorHandler.debug(`getCache: discarding cache from profile ${cacheData.profile || '(default)'}`)
                return null
            }

            // Drop programmes that have already ended, otherwise a cache reused
            // from a previous session would display outdated time slots.
            if (Array.isArray(cacheData?.featured)) {
                const now = Date.now() / 1000
                cacheData.featured = cacheData.featured.filter(e => {
                    const end = e?.programme?.end
                    // end === 0 means "no end time" (e.g. VOD), so keep the entry
                    return typeof end !== 'number' || end <= 0 || end >= now
                })
            }

            // Check if cache has entries (even if timestamp is stale)
            const hasEntries = cacheData?.featured && Array.isArray(cacheData.featured) && cacheData.featured.length > 0
            const isValid = this.isCacheValid(cacheData)
            if (hasEntries && this.lastCachedChannelNames.length === 0) {
                try {
                    const stored = await storage.get(this.lastChannelsCacheKey)
                    if (Array.isArray(stored) && stored.length > 0) {
                        this.lastCachedChannelNames = stored
                    } else {
                        this.lastCachedChannelNames = this.extractChannelNamesFromEntries(cacheData.featured)
                    }
                } catch (_) {
                    this.lastCachedChannelNames = this.extractChannelNamesFromEntries(cacheData.featured)
                }
            }
            // Return entries if cache is valid OR if allowStale and entries exist
            if (isValid || (allowStale && hasEntries)) {
                // Don't invalidate cache with busy entries - allow them to be shown until real recommendations are available
                // The cache will be naturally replaced when generateFeaturedEntries creates real recommendations
                // This prevents the UI from being empty during the transition period

                cacheData.featured = cacheData.featured.map(e => {
                    try {
                        // Skip toMetaEntry for placeholder entries
                        if (e && e.name === ' &nbsp;' && e.class && e.class.includes('entry-busy-x')) {
                            return e // Return placeholder entry as-is
                        }
                        // Collapsed series folders are plain data in storage; restore
                        // their behavior (toMetaEntry would turn them into a search page)
                        if (e?.__seriesFolder?.group) {
                            e.type = 'group'
                            if (!e.url) e.url = 'javascript:;'
                            if (!e.fa) e.fa = 'fas fa-play-circle'
                            const seriesGroups = Array.isArray(e.__seriesFolder.groups) ? e.__seriesFolder.groups : []
                            e.renderer = () => this.openSeriesFolder(e.__seriesFolder.group, seriesGroups, e.__seriesFolder.source)
                            return e
                        }
                        // Preserve icon and programme.icon before calling toMetaEntry
                        // toMetaEntry may overwrite these, so we need to restore them
                        const preservedIcon = e?.icon
                        const preservedProgrammeIcon = e?.programme?.icon
                        const metaEntry = global.channels?.toMetaEntry ? global.channels.toMetaEntry(e) : e
                        // Ensure metaEntry is an object
                        if (!metaEntry || typeof metaEntry !== 'object') {
                            ErrorHandler.warn('toMetaEntry returned invalid entry:', metaEntry)
                            return e // Return original entry if toMetaEntry fails
                        }
                        // Always restore icon if it was set (toMetaEntry may have overwritten it)
                        if (preservedIcon) {
                            metaEntry.icon = preservedIcon
                        }
                        // Always restore programme.icon if it was set
                        if (preservedProgrammeIcon && metaEntry.programme) {
                            metaEntry.programme.icon = preservedProgrammeIcon
                        }
                        return metaEntry
                    } catch (error) {
                        ErrorHandler.warn('Failed to process cached entry in getCache:', error.message || error)
                        return e // Return original entry if processing fails
                    }
                })
                // Caches written before the grouping existed still hold one entry
                // per episode, so collapse them on read as well
                cacheData.featured = this.collapseSeriesEpisodes(cacheData.featured)
                return cacheData.featured
            }

            return null
        } catch (error) {
            ErrorHandler.warn('Failed to get cache from storage:', error.message)
            return null
        }
    }

    /**
     * Set cached featured entries to storage
     * @param {Array} entries - Entries to cache
     */
    async setCache(entries) {
        if (!Array.isArray(entries)) {
            ErrorHandler.warn('Invalid entries for caching:', typeof entries)
            return
        }

        try {
            const channelNames = this.extractChannelNamesFromEntries(entries)
            const cacheData = {
                featured: entries,
                timestamp: Date.now(),
                version: this.cacheVersion,
                profile: this.profileSignature()
            }

            await storage.set(this.cacheKey, cacheData, { ttl: this.cacheTTLSeconds })
            await storage.set(this.lastChannelsCacheKey, channelNames, { ttl: this.cacheTTLSeconds })
            this.lastCacheTime = Date.now() // Track when cache was last set
            this.lastCachedChannelNames = channelNames
            this.maybeUpdateUI(entries)
        } catch (error) {
            ErrorHandler.warn('Failed to save cache to storage:', error.message)
        }
    }

    invalidateRecommendationCaches(reason = 'manual') {
        const context = `Smart Recommendations cache invalidation (${reason})`

        try {
            this.clearCache().catch(err => {
                ErrorHandler.warn(`${context}: storage cache clear failed`, err?.message || err)
            })
        } catch (err) {
            ErrorHandler.warn(`${context}: storage cache clear threw`, err?.message || err)
        }

        if (!this.initialized || !this.smartRecommendations) {
            return
        }

        const userId = this.getCurrentUserId()

        try {
            this.smartRecommendations.cache?.invalidateByUser(userId)
            this.smartRecommendations.cache?.invalidateByTags?.(['recommendations'])
        } catch (err) {
            ErrorHandler.warn(`${context}: smartRecommendations cache invalidation failed`, err?.message || err)
        }

        try {
            const enhancedCache = this.smartRecommendations.enhancedRecommendations?.cache
            enhancedCache?.invalidateByUser?.(userId)
            enhancedCache?.invalidateByTags?.(['recommendations', 'tags', 'expansion'])
        } catch (err) {
            ErrorHandler.warn(`${context}: enhanced recommendations cache invalidation failed`, err?.message || err)
        }
    }

    /**
     * React to a content profile / parental age change: everything derived from the
     * previous profile is stale, so drop the caches and rebuild the recommendations.
     */
    async handleContentProfileChange(state) {
        ErrorHandler.info('🎯 Content profile changed, clearing recommendations caches', state || '')
        this._profilePicksMissing = false
        this._profilePicksAdded = false
        this._profileRefreshTries = 0
        this.stopProfileRefresh()
        // The VOD folder cache was just dropped too: forget the in-flight warm
        // promise so it is rebuilt for the new profile.
        this.vodWarmPromise = null
        this._vodGeneralPass = null
        await this.clear('content-profile-changed').catch(err => {
            ErrorHandler.warn('Content profile change: cache clear failed:', err?.message || err)
        })
        await this.scheduleUpdate().catch(err => {
            ErrorHandler.warn('Content profile change: update scheduling failed:', err?.message || err)
        })
        await this.warmVODCache().catch(err => {
            ErrorHandler.warn('Content profile change: VOD warm failed:', err?.message || err)
        })
        global.menu?.refreshNow?.()
    }

    /**
     * Clear cache from storage
     */
    async clearCache() {
        // Delete cache completely by setting to null with ttl 0
        await storage.set(this.cacheKey, null, { ttl: 0 })
        await storage.set(this.lastChannelsCacheKey, null, { ttl: 0 })
        // Profile/interest changes must not keep serving the previous VOD picks
        await storage.set(this.vodCacheKey, null, { ttl: 0 })
    }

    /**
     * Clear all recommendation caches (storage + in-memory)
     * @param {string} reason - Optional reason for logging
     */
    async clear(reason = 'manual') {
        const context = `Smart Recommendations full cache clear (${reason})`

        await this.clearCache().catch(err => {
            ErrorHandler.warn(`${context}: storage cache clear failed`, err?.message || err)
        })

        const tasks = []

        if (this.tags?.clearCache) {
            tasks.push(
                this.tags.clearCache().catch(err =>
                    ErrorHandler.warn(`${context}: tags cache clear failed`, err?.message || err)
                )
            )
        }

        try {
            this.smartRecommendations?.cache?.clear?.()
        } catch (err) {
            ErrorHandler.warn(`${context}: smartRecommendations cache clear failed`, err?.message || err)
        }

        try {
            this.smartRecommendations?.enhancedRecommendations?.cache?.clear?.()
        } catch (err) {
            ErrorHandler.warn(`${context}: enhanced recommendations cache clear failed`, err?.message || err)
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

