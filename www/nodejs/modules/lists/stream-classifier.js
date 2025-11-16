/**
 * StreamClassifier - Centralized stream type detection and filtering utility
 * 
 * Classifies URLs and entries as VOD or live streams with confidence levels:
 * - 'vod': Clearly VOD (high confidence)
 * - 'live': Clearly live (high confidence)
 * - 'seems-vod': Likely VOD (medium confidence)
 * - 'seems-live': Likely live (medium confidence)
 * - null: Unknown/undetermined
 */

class StreamClassifier {
    constructor() {
        // Series detection regex (from list-index-utils.js)
        this.seriesRegex = new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i');
        
        // Clearly VOD indicators (high confidence)
        this.VIDEO_FORMATS = new Set(['mp4', 'mkv', 'mpeg', 'mov', 'm4v', 'webm', 'ogv', 'hevc', 'divx', 'm4s', 'asf', 'avi', 'flv', 'wmv'])
        this.clearlyVODPatterns = [
            /\/movie\//i,            // /movie/ in path
            /\/episode\//i,          // /episode/ in path
            /\/series\//i,            // /series/ in path
            /\/vod\//i,              // /vod/ in path
            /\.vod\./i,              // .vod. in domain (e.g., xyz.vod.domain.com)
            /vod\./i,                // vod. in domain or path
            /\/play\.m3u8/i,         // /play.m3u8 (common VOD pattern)
            // Only allow adultiptv.net/redtraffic.xyz if they have .vod. subdomain
            /^https?:\/\/[^/]+\.vod\.(adultiptv\.net|redtraffic\.xyz)/i,
        ];
        
        // Clearly Live indicators (high confidence)
        this.clearlyLivePatterns = [
            /\/channel\//i,           // channel in path
            /\/stitch\//i,            // stitch (Pluto TV)
            /\/live\.m3u8/i,          // live.m3u8
            /channel\s*[=:]/i,        // channel parameter
            /wurl_channel/i,          // wurl channel parameter
            /deviceType/i,            // device type parameter (common in live)
            /deviceMake/i,            // device make parameter (common in live)
            /deviceModel/i,           // device model parameter (common in live)
            /\.ts(?:\?|$|&)/i,        // .ts extension (usually live)
            /\/index\.m3u8/i,         // index.m3u8 (usually live)
            /\/master\.m3u8/i,        // master.m3u8 (usually live)
            /\/hls\/live/i,           // /hls/live
            /transmit\.live/i,        // transmit.live domain
            /\.transmit\./i,          // .transmit. domain
            /playouts\.now\./i,        // playouts.now. domain (Amagi)
            /\/live\//i,              // /live/ in path
            /\/stream\.m3u8/i,        // /stream.m3u8
            /livechannel/i,           // livechannel pattern
            // Additional live indicators in domain
            /^https?:\/\/live\./i,    // live. subdomain (e.g., live.ipstream.it)
            /-live\./i,                // -live. in domain (e.g., muzzik-live.morescreens.com)
            /-hls-live\./i,            // -hls-live. in domain (e.g., -hls-live.5centscdn.com)
            /hls-live/i,               // hls-live anywhere in domain
            /mediatailor/i,            // AWS MediaTailor (usually live for playlist.m3u8)
            /\.stream\//i,             // .stream/ in path (live stream indicator)
            // Patterns that don't guarantee VOD - exclude when typeStrict
            /24h/i,                    // 24h prefix (often indicates 24h TV channel, not VOD)
        ];
    }
    
    /**
     * Extract URL from entry (supports string URLs or entry objects)
     * @param {string|Object} entry - URL string or entry object with url property
     * @returns {string|null} - URL or null if invalid
     */
    _getUrl(entry) {
        if (!entry) return null;
        if (typeof entry === 'string') return entry;
        if (typeof entry === 'object' && entry.url) return entry.url;
        return null;
    }

    _getExtension(url) {
        return url.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    }
    
    /**
     * Extract name from entry (for series detection)
     * @param {string|Object} entry - URL string or entry object
     * @returns {string|null}
     */
    _getName(entry) {
        if (!entry || typeof entry !== 'object') return null;
        return entry.name || null;
    }
    
    /**
     * Main classification method
     * @param {string|Object} entry - URL string or entry object {url, name?, group?}
     * @returns {'vod' | 'live' | 'seems-vod' | 'seems-live' | null}
     */
    classify(entry) {
        const url = this._getUrl(entry);
        if (!url) return null;
        
        const urlLower = url.toLowerCase();
        
        // Step 1: Check for clearly VOD file extensions (highest priority)
        if (this.VIDEO_FORMATS.has(this._getExtension(url))) {
            return 'vod';
        }
        
        // Step 2: Check for clearly live patterns (second priority - live overrides ambiguous cases)
        let hasLiveIndicator = false;
        for (const pattern of this.clearlyLivePatterns) {
            if (urlLower.match(pattern)) {
                hasLiveIndicator = true;
                break;
            }
        }
        if (hasLiveIndicator) {
            return 'live';
        }
        
        // Step 3: Check for clearly VOD patterns (excluding file extensions already checked)
        let hasVODIndicator = false;
        for (const pattern of this.clearlyVODPatterns) {
            if (urlLower.match(pattern)) {
                hasVODIndicator = true;
                break;
            }
        }
        if (hasVODIndicator) {
            // Has VOD indicator and no live indicators - clearly VOD
            return 'vod';
        }
        
        // Step 4: For .m3u8 URLs without clear indicators
        if (urlLower.includes('.m3u8')) {
            // Since no live indicators found and no clear VOD indicators,
            // default to seems-live (most .m3u8 are live streams)
            return 'seems-live';
        }
        
        // Step 5: For .ts URLs, they're almost always live
        if (urlLower.includes('.ts')) {
            return 'live';
        }
        
        // Step 6: Unknown - no clear indicators
        return null;
    }
    
    /**
     * Check if entry is clearly VOD
     * @param {string|Object} entry
     * @returns {boolean}
     */
    clearlyVOD(entry) {
        return this.classify(entry) === 'vod';
    }
    
    /**
     * Check if entry is clearly live
     * @param {string|Object} entry
     * @returns {boolean}
     */
    clearlyLive(entry) {
        return this.classify(entry) === 'live';
    }
    
    /**
     * Check if entry is VOD or seems VOD
     * @param {string|Object} entry
     * @returns {boolean}
     */
    seemsVOD(entry) {
        const classification = this.classify(entry);
        return classification === 'vod' || classification === 'seems-vod';
    }
    
    /**
     * Check if entry is live or seems live
     * @param {string|Object} entry
     * @returns {boolean}
     */
    seemsLive(entry) {
        const classification = this.classify(entry);
        return classification === 'live' || classification === 'seems-live';
    }
    
    /**
     * Check if entry classification is unknown
     * @param {string|Object} entry
     * @returns {boolean}
     */
    isUnknown(entry) {
        return this.classify(entry) === null;
    }
    
    /**
     * Filter entries by type
     * @param {Array} entries - Array of entry objects or URL strings
     * @param {'vod' | 'live'} type - Type to filter for
     * @param {boolean} strict - If true, only clearly matches (excludes 'seems-*')
     * @returns {Array} - New array of filtered entries
     */
    filter(entries, type, strict = false) {
        if (!Array.isArray(entries)) return [];
        if (type !== 'vod' && type !== 'live') return entries;
        
        return entries.filter(entry => {
            const classification = this.classify(entry);
            
            if (strict) {
                // Only clearly matches
                if (type === 'vod') {
                    return classification === 'vod';
                } else { // type === 'live'
                    return classification === 'live';
                }
            } else {
                // Includes seems matches AND null (unknown) when typeStrict=false
                if (type === 'vod') {
                    // Quando typeStrict=false, incluir também null (unknown) como possível VOD válida
                    return classification === 'vod' || classification === 'seems-vod' || classification === null;
                } else { // type === 'live'
                    // Quando typeStrict=false, incluir também null (unknown) como possível live válida
                    return classification === 'live' || classification === 'seems-live' || classification === null;
                }
            }
        });
    }
        
    /**
     * Prioritize entries by type (reorder putting type first)
     * @param {Array} entries - Array of entry objects or URL strings
     * @param {'vod' | 'live'} type - Type to prioritize
     * @param {boolean} strict - If true, only clearly matches prioritized first
     * @param {boolean} inPlace - If true, modifies array in-place; if false, returns new array
     * @returns {Array} - Reordered array (new or modified in-place)
     */
    prioritize(entries, type, strict = false, inPlace = false) {
        if (!Array.isArray(entries)) return inPlace ? entries : [];
        if (type !== 'vod' && type !== 'live') return inPlace ? entries : [...entries];
        
        const clearlyMatching = [];
        const seemsMatching = [];
        const notMatching = [];
        
        entries.forEach(entry => {
            const classification = this.classify(entry);
            const isVOD = classification === 'vod' || classification === 'seems-vod';
            const isLive = classification === 'live' || classification === 'seems-live';
            
            let matches = false;
            let isClearly = false;
            
            if (type === 'vod') {
                matches = isVOD;
                isClearly = classification === 'vod';
            } else { // type === 'live'
                matches = isLive;
                isClearly = classification === 'live';
            }
            
            if (matches) {
                if (isClearly) {
                    clearlyMatching.push(entry);
                } else {
                    seemsMatching.push(entry);
                }
            } else {
                notMatching.push(entry);
            }
        });
        
        const result = strict 
            ? [...clearlyMatching, ...notMatching]
            : [...clearlyMatching, ...seemsMatching, ...notMatching];
        
        if (inPlace) {
            entries.length = 0;
            entries.push(...result);
            return entries;
        }
        
        return result;
    }

    prioritizeExtensions(entries, ceilExtensions = [], floorExtensions = []) {
        if (!Array.isArray(entries)) return [];
        if (ceilExtensions.length === 0 && floorExtensions.length === 0) return entries;        

        if (Array.isArray(ceilExtensions)) {
            ceilExtensions = new Set(ceilExtensions);
        }
        if (Array.isArray(floorExtensions)) {
            floorExtensions = new Set(floorExtensions);
        }

        const ceilFiltered = []
        const floorFiltered = []
        const otherFiltered = []
        
        for(const entry of entries) {
            const extension = this._getExtension(this._getUrl(entry));
            if (ceilExtensions.has(extension)) {
                ceilFiltered.push(entry);
            } else if (floorExtensions.has(extension)) {
                floorFiltered.push(entry);
            } else {
                otherFiltered.push(entry);
            }
        }
        return [...ceilFiltered, ...otherFiltered, ...floorFiltered];
    }
}

// Export singleton instance
const classifier = new StreamClassifier();
export const constants = {
    seriesRegex: new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i'),
    vodRegex: new RegExp('[\\.=](mp4|mkv|mpeg|mov|m4v|webm|ogv|hevc|divx)($|\\?|&)', 'i'),
    liveRegex: new RegExp('([0-9]+/[0-9]+|[\\.=](m3u8|ts))($|\\?|&)', 'i'),
};
export default classifier;
export const sniffStreamType = (e) => {
    // Check for series first (not handled by StreamClassifier)
    if (e.name && e.name.match(constants.seriesRegex)) {
        return 'series';
    }
    
    // Use StreamClassifier for VOD/live detection
    const classification = classifier.classify(e);
    
    // Map StreamClassifier results to legacy return values
    // Legacy returns: 'series' | 'vod' | 'live' | undefined
    if (classification === 'vod' || classification === 'seems-vod') {
        return 'vod';
    } else if (classification === 'live' || classification === 'seems-live') {
        return 'live';
    }
    
    // Return undefined for unknown (backward compatible)
    return undefined;
}
