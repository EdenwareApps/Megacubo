/**
 * AI-Powered Tag Expansion
 * Replaces Trias-based SmartTagExpansion with AI Client
 */

import { EventEmitter } from 'node:events';
import { EPGErrorHandler } from '../epg-worker/EPGErrorHandler.js';

export class AITagExpansion extends EventEmitter {
    constructor(aiClient) {
        super();
        this.aiClient = aiClient;
        this.expansionCache = new Map();
        this.cacheTTL = 300000; // 5 minutes
        this.maxCacheSize = 500;
    }

    /**
     * Expand user tags using AI semantic analysis
     * @param {Object} userTags - User tags with scores
     * @param {Object} options - Expansion options
     * @returns {Promise<Object>} Expanded tags
     */
    async expandUserTags(userTags, options = {}) {
        const {
            maxExpansions = 20,
            similarityThreshold = 0.6,
            diversityBoost = true,
            locale = 'pt'
        } = options;

        const cacheKey = this.generateCacheKey(userTags, options);
        const cached = this.expansionCache.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
            return cached.expandedTags;
        }

        try {
            // Get top user interests
            const topInterests = this.getTopInterests(userTags, 10);
            
            if (topInterests.length === 0) {
                return userTags;
            }

            // Convert to object format for AI client
            const tagsObj = {};
            topInterests.forEach(tag => {
                tagsObj[tag] = userTags[tag] || 1.0;
            });

            // Use AI to find semantically related tags
            const response = await this.aiClient.expandTags(tagsObj, {
                limit: maxExpansions,
                threshold: similarityThreshold,
                locale
            });

            const expandedTags = response.expandedTags || {};

            // Apply diversity boost to avoid over-concentration
            const finalTags = diversityBoost 
                ? this.applyDiversityBoost(expandedTags, userTags)
                : expandedTags;

            // Merge with original tags
            const mergedTags = this.mergeTags(userTags, finalTags);

            // Cache the results
            this.expansionCache.set(cacheKey, {
                expandedTags: mergedTags,
                timestamp: Date.now()
            });

            // Clean cache if needed
            this.cleanCache();

            return mergedTags;

        } catch (error) {
            EPGErrorHandler.warn('Tag expansion failed:', error.message);
            return userTags; // Return original tags as fallback
        }
    }

    /**
     * Get top interests from user tags
     * @param {Object} userTags - User tags
     * @param {number} limit - Maximum tags to return
     * @returns {Array} Top interest tags
     */
    getTopInterests(userTags, limit = 5) {
        return Object.entries(userTags)
            .filter(([tag, score]) => typeof score === 'number' && score > 0.3)
            .sort(([, scoreA], [, scoreB]) => scoreB - scoreA)
            .slice(0, limit)
            .map(([tag]) => tag);
    }

    /**
     * Apply diversity boost to prevent tag concentration
     * @param {Object} expandedTags - Expanded tags
     * @param {Object} originalTags - Original user tags
     * @returns {Object} Diversified tags
     */
    applyDiversityBoost(expandedTags, originalTags) {
        const result = {};
        
        // Reduce scores for tags too similar to original
        for (const [tag, score] of Object.entries(expandedTags)) {
            if (originalTags[tag]) {
                // Already in original, boost slightly
                result[tag] = Math.min(score * 1.1, 1.0);
            } else {
                // New tag, keep as is
                result[tag] = score;
            }
        }
        
        return result;
    }

    /**
     * Merge original and expanded tags
     * @param {Object} originalTags - Original tags
     * @param {Object} expandedTags - Expanded tags
     * @returns {Object} Merged tags
     */
    mergeTags(originalTags, expandedTags) {
        const merged = { ...originalTags };
        
        for (const [tag, score] of Object.entries(expandedTags)) {
            if (!merged[tag]) {
                // New tag, add with reduced weight
                merged[tag] = score * 0.7;
            } else {
                // Existing tag, boost slightly
                merged[tag] = Math.max(merged[tag], score);
            }
        }
        
        return merged;
    }

    /**
     * Generate cache key
     * @param {Object} userTags - User tags
     * @param {Object} options - Options
     * @returns {string} Cache key
     */
    generateCacheKey(userTags, options) {
        const sortedTags = Object.keys(userTags).sort().slice(0, 10).join(',');
        return `${sortedTags}:${options.maxExpansions || 20}:${options.locale || 'pt'}`;
    }

    /**
     * Clean cache
     */
    cleanCache() {
        if (this.expansionCache.size > this.maxCacheSize) {
            const now = Date.now();
            const entries = Array.from(this.expansionCache.entries());
            
            // Remove oldest entries
            entries
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, Math.floor(this.maxCacheSize * 0.2))
                .forEach(([key]) => this.expansionCache.delete(key));
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        const now = Date.now();
        const entries = Array.from(this.expansionCache.values());
        const validEntries = entries.filter(e => now - e.timestamp < this.cacheTTL);
        
        return {
            totalEntries: this.expansionCache.size,
            validEntries: validEntries.length,
            hitRate: validEntries.length / this.expansionCache.size || 0,
            aiClient: this.aiClient.getStats()
        };
    }
}

