/**
 * AI Fallback System
 * Provides offline functionality when server is unavailable
 */

import { EPGErrorHandler } from '../../epg-worker/EPGErrorHandler.js';

export class AIFallback {
    constructor() {
        // No local fallback dictionary - rely on AI server or return original tags
    }

    // extractKeywords() and analyseProgramme() removed - not used!

    /**
     * Fallback when AI server is unavailable
     * @param {Object} tags - User tags
     * @param {Object} options - Options
     * @returns {Object} Original tags or empty
     */
    expandTags(tags, options = {}) {
        const { locale = 'pt' } = options;
        
        // Emit warning about fallback usage
        console.warn('⚠️ AI Server unavailable, using fallback mode. No tag expansion available.');
        
        // Return original tags or empty object
        return {
            expandedTags: tags, // Return original tags unchanged
            fallback: true,
            locale,
            warning: 'AI Server unavailable - no tag expansion performed'
        };
    }

    /**
     * Fallback tag clustering when AI server is unavailable
     * @param {Object|Array} tags - Tags to cluster
     * @param {Object} options - Options
     * @returns {Object} Simple clustering result
     */
    clusterTags(tags, options = {}) {
        const { locale = 'pt' } = options;
        
        // Emit warning about fallback usage
        console.warn('⚠️ AI Server unavailable, using fallback mode. No tag clustering available.');
        
        // Return simple clustering (each tag as its own cluster)
        const tagList = Array.isArray(tags) ? tags : Object.keys(tags);
        const clusterResult = {};
        
        tagList.forEach(tag => {
            clusterResult[tag] = [tag];
        });

        return {
            clusters: clusterResult,
            fallback: true,
            locale,
            warning: 'AI Server unavailable - no tag clustering performed'
        };
    }
}

