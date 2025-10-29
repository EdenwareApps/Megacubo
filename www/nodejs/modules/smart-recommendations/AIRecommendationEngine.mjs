/**
 * AI-Powered Recommendation Engine
 * Replaces Trias-based TriasRecommendationEngine with AI Client
 */

import { EventEmitter } from 'node:events';
import { EPGErrorHandler } from '../epg-worker/EPGErrorHandler.js';

export class AIRecommendationEngine extends EventEmitter {
    constructor(aiClient) {
        super();
        this.aiClient = aiClient;
        this.semanticCache = new Map();
        this.similarityThreshold = 0.7;
        this.cacheTTL = 300000; // 5 minutes
        this.maxCacheSize = 1000;
    }

    /**
     * Calculate semantic score using programme terms and expanded user tags
     * OPTIMIZED: Uses programme.terms (includes title + channel + categories!)
     * @param {Object} programme - Programme data (must have programme.terms)
     * @param {Object} expandedUserTags - Expanded user interest tags with scores (0-1)
     * @param {Object} context - User context
     * @returns {Promise<number>} Semantic score (0-1)
     */
    async calculateSemanticScore(programme, expandedUserTags, context) {
        try {
            // Get programme terms from EPG (includes title + channel + categories!)
            const programmeTerms = programme.terms || programme.c || [];
            
            if (programmeTerms.length === 0) {
                // No terms/categories, use traditional scoring
                return 0.5; // Neutral score
            }
            
            // Calculate weighted overlap between programme terms and expanded user tags
            const score = this.calculateWeightedOverlap(
                programmeTerms,
                expandedUserTags
            );
            
            return score;
            
        } catch (error) {
            EPGErrorHandler.warn('Semantic scoring failed:', error.message);
            return 0.5; // Neutral fallback
        }
    }

    /**
     * Calculate weighted overlap between programme terms and user tags
     * Uses scores from expanded tags for intelligent ranking
     * @param {Array} programmeTerms - Terms from EPG (title + channel + categories)
     * @param {Object} expandedUserTags - Expanded user tags with scores (0-1)
     * @returns {number} Weighted overlap score (0-1)
     */
    calculateWeightedOverlap(programmeTerms, expandedUserTags) {
        if (!programmeTerms || programmeTerms.length === 0) return 0;
        if (!expandedUserTags || Object.keys(expandedUserTags).length === 0) return 0;
        
        let totalScore = 0;
        let matchCount = 0;
        
        // Normalize programme terms to lowercase
        const normTerms = programmeTerms.map(t => t.toLowerCase());
        
        // For each programme term, check if it matches user tags
        for (const term of normTerms) {
            // Find best matching user tag
            let bestScore = 0;
            
            for (const [userTag, score] of Object.entries(expandedUserTags)) {
                const userTagLower = userTag.toLowerCase();
                
                // Exact match (best!)
                if (term === userTagLower) {
                    bestScore = Math.max(bestScore, score);
                }
                // Partial match (good)
                else if (term.includes(userTagLower) || userTagLower.includes(term)) {
                    bestScore = Math.max(bestScore, score * 0.7);
                }
            }
            
            if (bestScore > 0) {
                totalScore += bestScore;
                matchCount++;
            }
        }
        
        // Return average score of matches (0-1 range)
        // If no matches, return 0
        return matchCount > 0 ? totalScore / matchCount : 0;
    }

    // calculateTraditionalScore() removed - not needed!
    // Using only weighted overlap with programme.terms

    /**
     * Clean semantic cache to prevent memory issues
     */
    cleanCache() {
        if (this.semanticCache.size > this.maxCacheSize) {
            const now = Date.now();
            const entries = Array.from(this.semanticCache.entries());
            
            // Remove oldest entries
            entries
                .sort((a, b) => a[1].timestamp - b[1].timestamp)
                .slice(0, Math.floor(this.maxCacheSize * 0.2))
                .forEach(([key]) => this.semanticCache.delete(key));
        }
    }

    /**
     * Get cache statistics for monitoring
     * @returns {Object} Cache statistics
     */
    getCacheStats() {
        const now = Date.now();
        const entries = Array.from(this.semanticCache.values());
        const validEntries = entries.filter(e => now - e.timestamp < this.cacheTTL);
        
        return {
            totalEntries: this.semanticCache.size,
            validEntries: validEntries.length,
            hitRate: validEntries.length / this.semanticCache.size || 0,
            aiClient: this.aiClient.getStats()
        };
    }
}

