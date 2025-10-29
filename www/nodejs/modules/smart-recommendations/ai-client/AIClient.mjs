/**
 * AI Client
 * HTTP client for AI recommendations server with caching and fallback
 */

import { EPGErrorHandler } from '../../epg-worker/EPGErrorHandler.js';
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
        try {
            await this.request('/api/recommendations/health', {}, { timeout: 5000, retries: 1 });
            EPGErrorHandler.info('✅ AI Server connection established');
            this.enabled = true;
        } catch (error) {
            EPGErrorHandler.warn('⚠️ AI Server not available, using fallback mode:', error.message);
            this.enabled = false;
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
    // EPG programmes already have categories (programme.c)

    /**
     * Expand tags
     */
    async expandTags(tags, options = {}) {
        const locale = options.locale || lang.locale || 'pt';
        const cacheKey = this.cache.generateKey('expand', { tags, locale });
        
        // Check cache (only use if has expanded tags)
        const cached = await this.cache.get(cacheKey);
        if (cached && cached.expandedTags && Object.keys(cached.expandedTags).length > 0) {
            this.stats.cacheHits++;
            return { ...cached, cached: true, source: 'cache' };
        }
        
        this.stats.cacheMisses++;
        
        // Use fallback if disabled
        if (!this.enabled) {
            this.stats.fallbacks++;
            const result = this.fallback.expandTags(tags, { locale, ...options });
            // Only cache if has results
            if (result.expandedTags && Object.keys(result.expandedTags).length > 0) {
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
            
            
            const response = await this.request('/api/recommendations/expand-tags', {
                tags: normalizedTags,
                locale: normalizedLocale,
                limit: options.limit || 20,
                threshold: options.threshold || 0.6
            });
            
            this.stats.successes++;
            
            // Cache result
            await this.cache.set(cacheKey, response);
            
            return { ...response, cached: false, source: 'server' };
            
        } catch (error) {
            this.stats.failures++;
            EPGErrorHandler.warn('AI expand tags failed, using fallback:', error.message);
            
            // Use fallback
            this.stats.fallbacks++;
            const result = this.fallback.expandTags(tags, { locale, ...options });
            await this.cache.set(cacheKey, result);
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
        
        // Use fallback if disabled
        if (!this.enabled) {
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
        
        const url = `${this.serverUrl}${endpoint}`;
        
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeout);
                
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Megacubo-Client': 'megacubo-app',
                        'X-Megacubo-Version': global.version || '1.0.0'
                    },
                    body: JSON.stringify(body),
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                const data = await response.json();
                
                if (!data.success) {
                    throw new Error(data.message || 'Server returned error');
                }
                
                return data;
                
            } catch (error) {
                if (attempt < retries) {
                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
                    continue;
                }
                
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
     * Enable/disable AI client
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        EPGErrorHandler.info(`AI Client ${enabled ? 'enabled' : 'disabled'}`);
    }
}

