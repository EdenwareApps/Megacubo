import storage from '../storage/storage.js'
import { resolveListDatabaseFile } from './tools.js'

// Sanitize URL to create safe storage key
function sanitizeStorageKey(url) {
    try {
        // Remove protocol and replace special characters with safe alternatives
        let key = url.replace(/^https?:\/\//, '')
                     .replace(/[^a-zA-Z0-9.-]/g, '_')
                     .replace(/_{2,}/g, '_')
                     .substring(0, 50); // More aggressive length limit
        
        // If still too long, hash it
        if (key.length > 50) {
            // Create a simple hash from the URL
            let hash = 0;
            for (let i = 0; i < url.length; i++) {
                const char = url.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32bit integer
            }
            key = `url_${Math.abs(hash)}`;
        }
        
        return `list-meta-${key}`;
    } catch (error) {
        // Fallback to a simple hash if sanitization fails
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `list-meta-fallback_${Math.abs(hash)}`;
    }
}

async function readMetaJson(url) {
    try {
        const key = sanitizeStorageKey(url);
        const data = await storage.get(key);
        return data || {};
    } catch (error) {
        console.error(`Error reading meta from storage for ${url}:`, error.message);
        return {};
    }
}

async function writeMetaJson(url, data) {
    try {
        const key = sanitizeStorageKey(url);
        // Store with 24 hour expiration to prevent stale data
        const expiration = Date.now() + (24 * 60 * 60 * 1000);
        await storage.set(key, data, { expiration });
        
        // console.log(`💾 [STORAGE_META] Saved metadata to storage for ${url}`);
    } catch (error) {
        console.error(`Error writing meta to storage for ${url}:`, error.message);
        throw error;
    }
}

// FIXED: Cache for metadata to minimize I/O and prevent unnecessary updates
const metaCache = new Map();

// Helper function to filter undefined values
function filterUndefinedValues(obj) {
    const filtered = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
            filtered[key] = value;
        }
    }
    return filtered;
}

// NEW: JSON-based metadata functions
export async function getListMeta(url) {
    // FIXED: Check cache first to minimize I/O
    if (0 && metaCache.has(url)) {
        const cached = metaCache.get(url);
        // console.log(`📋 [CACHE_HIT] Using cached metadata for ${url}`);
        return cached;
    }
    
    try {
        // console.log(`📋 [JSON_META] Loading metadata for ${url}`);
        const meta = await readMetaJson(url);
        
        // Ensure required fields exist
        if (!meta.meta) meta.meta = {};
        if (!meta.gids) meta.gids = {};
        if (!meta.groupsTypes) meta.groupsTypes = {};
        if (meta.length === undefined) meta.length = 0;
        
        // Cache the result
        metaCache.set(url, meta);
        
        return meta;
    } catch (error) {
        console.error(`❌ [JSON_META_ERROR] Error loading metadata for ${url}:`, error.message);
        const fallbackMeta = {
            groups: {},
            meta: {},
            gids: {},
            groupsTypes: {},
            length: 0
        };
        metaCache.set(url, fallbackMeta);
        return fallbackMeta;
    }
}

export async function setListMeta(url, newMeta) {
    if (!newMeta || typeof(newMeta) !== 'object') {
        // console.log(`⚠️ [JSON_META] Invalid meta data for ${url}:`, newMeta);
        return false;
    }

    try {
        // console.log(`💾 [JSON_META] Setting metadata for ${url}`);
        
        // Get current metadata
        const currentMeta = await getListMeta(url);
        
        // Filter out undefined values
        const filteredMeta = filterUndefinedValues(newMeta);
        
        // Merge with existing metadata
        const mergedMeta = {
            ...currentMeta,
            ...filteredMeta
        };
        
        // Check if there are actual changes
        const keysToUpdate = Object.keys(filteredMeta).filter(key => {
            const currentValue = currentMeta[key];
            const newValue = filteredMeta[key];
            return JSON.stringify(currentValue) !== JSON.stringify(newValue);
        });
        
        if (keysToUpdate.length === 0) {
            // console.log(`📋 [JSON_META] No changes detected for ${url}, skipping update`);
            return true;
        }
        
        // console.log(`📋 [JSON_META] Updating ${keysToUpdate.length} keys for ${url}:`, keysToUpdate);
        
        // Write to JSON file
        await writeMetaJson(url, mergedMeta);
        
        // Invalidate cache to force fresh read next time
        metaCache.delete(url);
        // console.log(`🧹 [JSON_CACHE_INVALIDATE] Invalidated cache for ${url} to force fresh read`);
    
        return true;
    } catch (error) {
        console.error(`❌ [JSON_META_ERROR] Error setting metadata for ${url}:`, error.message);
        return false;
    }
}

// Function to clear cache (for debugging)
export function clearMetaCache() {
    metaCache.clear();
    // console.log('🧹 [CACHE_CLEAR] Metadata cache cleared');
}

// Re-export resolveListDatabaseFile from tools.js
export { resolveListDatabaseFile } from './tools.js';

// Setup global.listMeta for backward compatibility
global.listMeta = {
    get: getListMeta,
    set: setListMeta,
    read: readMetaJson,
    write: writeMetaJson,
    sanitize: sanitizeStorageKey,
    resolve: resolveListDatabaseFile
}


