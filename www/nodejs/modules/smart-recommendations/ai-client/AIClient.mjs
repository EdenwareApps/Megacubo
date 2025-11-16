/**
 * AI Client
 * HTTP client for AI recommendations server with caching and fallback
 */

import { EPGErrorHandler } from '../../epg/worker/EPGErrorHandler.js';
import { AICache } from './AICache.mjs';
import { AIBatchProcessor } from './AIBatchProcessor.mjs';
import { AIFallback } from './AIFallback.mjs';
import lang from '../../lang/lang.js';

export class AIClient {
    constructor(config = {}) {
        this.serverUrl = config.serverUrl || 'https://ai.megacubo.tv';
        this.enabled = config.enabled !== false;
        this.timeout = config.timeout || 10000;
        this.retries = config.retries || 2;
        
        // Initialize components
        this.cache = new AICache({
            maxMemoryItems: config.maxMemoryItems || 500,
            maxMemorySize: config.maxMemorySize || 10 * 1024 * 1024
        });
        
        this.batchProcessor = new AIBatchProcessor(this, {
            batchSize: config.batchSize || 50,
            batchDelay: config.batchDelay || 100
        });
        
        this.fallback = new AIFallback();
        this.disabledUntil = 0;
        
        // Statistics
        this.stats = {
            requests: 0,
            successes: 0,
            failures: 0,
            cacheHits: 0,
            cacheMisses: 0,
            fallbacks: 0
        };
        
        this.initialized = false;
    }

    /**
     * Initialize client
     */
    async initialize() {
        if (this.initialized) return;
        
        EPGErrorHandler.info('🤖 Initializing AI Client...');
        
        // Test connection
        const now = Date.now();
        if (this.disabledUntil && now < this.disabledUntil) {
            const remaining = Math.ceil((this.disabledUntil - now) / 1000);
            EPGErrorHandler.warn(`⚠️ AI Server temporarily disabled. Retrying in ${remaining}s.`);
            this.initialized = true;
            return;
        }

        try {
            await this.request('/api/recommendations/health', {}, { timeout: 5000, retries: 1, method: 'GET' });
            EPGErrorHandler.info('✅ AI Server connection established');
            this.enabled = true;
            this.disabledUntil = 0;
        } catch (error) {
            EPGErrorHandler.warn('⚠️ AI Server not available, using fallback mode:', error.message);
            this.enabled = false;
            this.disabledUntil = Date.now() + 60000;
        }
        
        this.initialized = true;
    }

    /**
     * Related tags (replaces trias.related)
     * Main method for tag expansion
     */
    async related(tags, options = {}) {
        const response = await this.expandTags(tags, {
            ...options,
            locale: options.locale || lang.locale || 'pt'
        });
        
        const expandedTags = response.expandedTags || {};
        
        // Return in format expected by Trias API
        if (options.as === 'array') {
            return Object.keys(expandedTags);
        }
        return expandedTags;
    }

    // predict() and analyzeProgramme() removed - not needed!
    // EPG programmes already have categories (programme.categories)

    /**
     * Expand tags
     */
    async expandTags(tags, options = {}) {
        const { forceRefresh = false } = options;
        const locale = options.locale || lang.locale || 'pt';
        const cacheKey = this.cache.generateKey('expand', { tags, locale });
        
        if (forceRefresh) {
            await this.cache.delete(cacheKey).catch(err => EPGErrorHandler.warn('Cache delete failed:', err.message));
        } else {
        // Check cache (only use if has expanded tags)
        const cached = await this.cache.get(cacheKey);
        if (cached && cached.expandedTags && Object.keys(cached.expandedTags).length > 0) {
            this.stats.cacheHits++;
            return { ...cached, cached: true, source: 'cache' };
            }
        }
        
        this.stats.cacheMisses++;
        
        // Handle cooldown state
        const now = Date.now();
        if (!this.enabled && this.disabledUntil && now >= this.disabledUntil) {
            this.enabled = true;
        }

        // Use fallback if still disabled (cooldown active)
        if (!this.enabled && this.disabledUntil && now < this.disabledUntil) {
            this.stats.fallbacks++;
            const result = this.applyResponseNormalization(this.fallback.expandTags(tags, { locale, ...options }));
            if (result.expandedTags && !result.fallback && Object.keys(result.expandedTags).length > 0) {
                await this.cache.set(cacheKey, result);
            }
            return { ...result, source: 'fallback' };
        }
        
        // Try server request
        try {
            this.stats.requests++;
            
            // Normalize tags to object format if array
            let normalizedTags = tags;
            if (Array.isArray(tags)) {
                normalizedTags = {};
                tags.forEach(tag => {
                    if (typeof tag === 'string') {
                        normalizedTags[tag] = 1.0;
                    }
                });
            }
            
            // Normalize locale to string if array
            let normalizedLocale = locale;
            if (Array.isArray(locale)) {
                normalizedLocale = locale[0] || 'pt';
            }
            
            
            const sanitizedTags = this.sanitizeTagsForRequest(normalizedTags);
            const response = this.applyResponseNormalization(await this.request('/api/recommendations/expand-tags', {
                tags: sanitizedTags,
                locale: normalizedLocale,
                limit: options.limit || 20,
                threshold: options.threshold || 0.6
            }));
            
            this.stats.successes++;
            
            // Cache result
            if (!response.fallback && response.expandedTags && Object.keys(response.expandedTags).length > 0) {
                await this.cache.set(cacheKey, response);
            }
            
            return { ...response, cached: false, source: 'server' };
            
        } catch (error) {
            this.stats.failures++;
            EPGErrorHandler.warn('AI expand tags failed, using fallback:', error.message);
            
            // Use fallback
            this.stats.fallbacks++;
            const result = this.applyResponseNormalization(this.fallback.expandTags(tags, { locale, ...options }));
            if (!result.fallback && result.expandedTags && Object.keys(result.expandedTags).length > 0) {
                await this.cache.set(cacheKey, result);
            }
            return { ...result, source: 'fallback' };
        }
    }

    /**
     * Cluster/reduce tags
     */
    async clusterTags(tags, options = {}) {
        const locale = options.locale || lang.locale || 'pt';
        const cacheKey = this.cache.generateKey('cluster', { tags, locale });
        
        // Check cache
        const cached = await this.cache.get(cacheKey);
        if (cached) {
            this.stats.cacheHits++;
            return { ...cached, cached: true, source: 'cache' };
        }
        
        this.stats.cacheMisses++;
        
        // Handle cooldown state
        const now = Date.now();
        if (!this.enabled && this.disabledUntil && now >= this.disabledUntil) {
            this.enabled = true;
        }

        if (!this.enabled && this.disabledUntil && now < this.disabledUntil) {
            this.stats.fallbacks++;
            const result = this.fallback.clusterTags(tags, { locale, ...options });
            await this.cache.set(cacheKey, result);
            return { ...result, source: 'fallback' };
        }
        
        // Try server request
        try {
            this.stats.requests++;
            const response = await this.request('/api/recommendations/cluster-tags', {
                tags,
                locale,
                clusters: options.clusters || 20
            });
            
            this.stats.successes++;
            
            // Cache result
            await this.cache.set(cacheKey, response);
            
            return { ...response, cached: false, source: 'server' };
            
        } catch (error) {
            this.stats.failures++;
            EPGErrorHandler.warn('AI cluster tags failed, using fallback:', error.message);
            
            // Use fallback
            this.stats.fallbacks++;
            const result = this.fallback.clusterTags(tags, { locale, ...options });
            await this.cache.set(cacheKey, result);
            return { ...result, source: 'fallback' };
        }
    }

    // analyzeBatch() removed - not needed

    /**
     * HTTP request with retry
     */
    async request(endpoint, body = {}, options = {}) {
        const timeout = options.timeout || this.timeout;
        const retries = typeof options.retries !== 'undefined' ? options.retries : this.retries;
        const method = options.method || 'POST';
        
        const url = `${this.serverUrl}${endpoint}`;
        const cooldownActive = () => this.disabledUntil && Date.now() < this.disabledUntil;
        if (cooldownActive()) {
            throw new Error('AI client cooling down after previous failures');
        }
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                
                const headers = {
                    'X-Megacubo-Client': 'megacubo-app',
                    'X-Megacubo-Version': global.version || '1.0.0'
                };

                let payload;
                if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
                    headers['Content-Type'] = 'application/json';
                    payload = JSON.stringify(body);
                }

                console.log('🔄 Fetching:', url, 'with payload:', payload, { method, headers, body: payload, signal: controller.signal });
                const response = await fetch(url, {
                    method,
                    headers,
                    body: payload,
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    console.log({ response });
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.message || 'Server returned error');
                }
                
                this.disabledUntil = 0;
                this.enabled = true;
                return data;
                
            } catch (error) {
                if (attempt < retries) {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
                    continue;
                }
                
                this.disabledUntil = Date.now() + 60000;
                this.enabled = false;
                throw error;
            }
        }
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            enabled: this.enabled,
            successRate: this.stats.requests > 0 
                ? this.stats.successes / this.stats.requests 
                : 0,
            cache: this.cache.getStats()
        };
    }

    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }

    /**
     * Normalize expanded tags returned by AI server or fallback
     * Removes accents, trims whitespace, lowercases and keeps highest score per tag
     * @param {Object} expandedTags
     * @returns {Object}
     */
    normalizeExpandedTags(expandedTags) {
        if (!expandedTags || typeof expandedTags !== 'object') {
            return {};
        }

        const normalized = {};

        for (const [rawKey, rawValue] of Object.entries(expandedTags)) {
            if (rawValue == null) {
                continue;
            }

            const key = String(rawKey).trim().toLowerCase();
            if (!key) {
                continue;
            }

            // Remove accents and normalize spacing
            const accentless = key
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/\s+/g, ' ')
                .trim();

            if (!accentless) {
                continue;
            }

            const numericValue = Number(rawValue);
            if (!Number.isFinite(numericValue) || numericValue <= 0) {
                continue;
            }

            normalized[accentless] = Math.max(normalized[accentless] || 0, numericValue);
        }

        return normalized;
    }

    /**
     * Apply normalization to responses that contain expandedTags
     * @param {Object} response
     * @returns {Object}
     */
    applyResponseNormalization(response) {
        if (response && typeof response === 'object' && response.expandedTags) {
            response.expandedTags = this.normalizeExpandedTags(response.expandedTags);
        }
        return response;
    }

    /**
     * Enable/disable AI client
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        EPGErrorHandler.info(`AI Client ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Normalize tag weights for server compatibility (0-1 range)
     * @param {Object} sourceTags
     * @returns {Object}
     */
    sanitizeTagsForRequest(sourceTags) {
        if (!sourceTags || typeof sourceTags !== 'object' || Array.isArray(sourceTags)) {
            return {};
        }

        const sanitized = {};
        let maxWeight = 0;

        for (const [rawKey, rawValue] of Object.entries(sourceTags)) {
            if (!rawKey) {
                continue;
            }

            const key = String(rawKey).trim().toLowerCase();
            if (!key) {
                continue;
            }

            let value = rawValue;

            if (typeof value === 'boolean') {
                value = value ? 1 : 0;
            } else if (Array.isArray(value)) {
                value = value.length;
            } else if (typeof value === 'string') {
                const numericValue = Number(value);
                value = Number.isFinite(numericValue) ? numericValue : value.length;
            }

            if (typeof value !== 'number' || !Number.isFinite(value)) {
                continue;
            }

            if (value <= 0) {
                continue;
            }

            sanitized[key] = value;
            if (value > maxWeight) {
                maxWeight = value;
            }
        }

        if (!Object.keys(sanitized).length) {
            return {};
        }

        if (maxWeight > 1) {
            for (const key of Object.keys(sanitized)) {
                sanitized[key] = Number((sanitized[key] / maxWeight).toFixed(6));
            }
        } else {
            for (const key of Object.keys(sanitized)) {
                sanitized[key] = Number(Math.min(sanitized[key], 1).toFixed(6));
            }
        }

        return sanitized;
    }
}

