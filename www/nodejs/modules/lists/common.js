import { EventEmitter } from "events";
import List from "./list.js";
import tools from "./tools.js";
import MediaURLInfo from "../streamer/utils/media-url-info.js";
import ParentalControl from "./parental-control.js";
import options from "./options.json" with { type: 'json' }
import ready from '../ready/ready.js'
import { Database } from 'jexidb'
import fs from 'fs'
import { resolveListDatabaseFile } from './tools.js'
import path from 'path'
import storage from '../storage/storage.js'

// Helper functions for JSON-based metadata
function getMetaJsonPath(url) {
    const file = resolveListDatabaseFile(url);
    return file.replace(/\.jdb$/i, '.meta.json');
}

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
        if (!meta.groups) meta.groups = {};
        if (!meta.meta) meta.meta = {};
        if (!meta.gids) meta.gids = {};
        if (!meta.groupsTypes) meta.groupsTypes = {};
        if (meta.uniqueStreamsLength === undefined) meta.uniqueStreamsLength = 0;
        
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
            uniqueStreamsLength: 0
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
        
        // Filter out undefined values but preserve uniqueStreamsLength even if 0
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
            
            // Special handling for uniqueStreamsLength
            if (key === 'uniqueStreamsLength') {
                // console.log(`🔍 [UNIQUE_STREAMS_TRACE] Comparing uniqueStreamsLength: current=${currentValue}, new=${newValue}`);
                return currentValue !== newValue;
            }
            
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

// FIXED: Cache for metadata to minimize I/O and prevent unnecessary updates
const metaCache = new Map();

// Function to clear cache (for debugging)
export function clearMetaCache() {
    metaCache.clear();
    // console.log('🧹 [CACHE_CLEAR] Metadata cache cleared');
}

// Helper function to filter undefined values
function filterUndefinedValues(obj) {
    const filtered = {};
    for (const [key, value] of Object.entries(obj)) {
        // FIXED: Preserve uniqueStreamsLength even if it's 0
        if (value !== undefined || key === 'uniqueStreamsLength') {
            filtered[key] = value;
        }
    }
    return filtered;
}

export class Fetcher extends EventEmitter {
    constructor(url, atts, master) {
        super();
        this.progress = 0;
        this.atts = atts;
        this.url = url;
        this.playlists = [];
        this.master = master;
        this.ready = ready()
        process.nextTick(() => {
            this.start().catch(err => {
                if(!this.error) this.error = err
                console.error('Fetcher initialization error:', err)
            }).finally(() => {
                this.ready.done()
            })
        })
    }
    async start() {
        if(this.list) {
            return this.ready()
        }
        if(!this.master) {
            const error = new Error('Fetcher master not set - initialization failed')
            this.error = error
            throw error
        }
        if(!this.master.loader) {
            const error = new Error('Fetcher loader not set - master not properly initialized')
            this.error = error
            throw error
        }
        
        this.list = new List(this.url, this.master)
        try {
            await this.list.ready()
            if (!this.list.length) {
                const error = new Error('List is empty - no content available')
                this.error = error
                throw error
            }
        } catch (err) {
            console.error('Fetcher error', this.url, err)
            try {
                await this.master.loader.addListNow(this.url, this.atts)
                try {
                    this.list = new List(this.url, this.master)
                    return this.list.ready()
                } catch(e) { // will trigger outer catch
                    console.error('Fetcher error 2', this.url, e)
                    this.error = err
                    throw err
                }
            } catch(err) {
                console.error('Fetcher error 3', this.url, err)
                this.error = err
                if (this.list) {
                    this.list.destroy()
                }
                throw err
            }
        }
    }
    validateCache(content) {
        return typeof(content) == 'string' && content.length >= this.minDataLength;
    }
    async fetchAll() {
        await this.ready();
        if (this.error) {
            throw this.error
        }
        return this.list.fetchAll();
    }
    async getMap(map) {
        await this.ready();
        return this.list.getMap(map);
    }
    async meta() {
        await this.ready();
        return this.list.indexer.index?.meta || {};
    }
    destroy() {
        this.list && this.list.destroy();
        this.updater && this.list.destroy();
    }
    
}

export class Common extends EventEmitter {
    constructor(opts) {
        super()
        this.opts = options;
        if (opts) {
            Object.keys(opts).forEach(k => {
                this[k] = opts[k];
            });
        }
        this.tools = tools;
        this.mi = new MediaURLInfo()
        this.parentalControl = new ParentalControl()
    }
    validateType(e, type, strict) {
        if (typeof(type) == 'string' && type) {
            switch (type) {
                case 'live':
                    if (strict) {
                        return this.mi.isLive(e.url);
                    } else {
                        let ext = this.mi.ext(e.url);
                        return !(this.mi.isVideo(e.url, ext) || this.mi.isAudio(e.url, ext));
                    }
                    break;
                case 'video':
                    if (strict) {
                        return this.mi.isVideo(e.url);
                    } else {
                        let ext = this.mi.ext(e.url);
                        return !(this.mi.isLive(e.url, ext) || this.mi.isAudio(e.url, ext));
                    }
                    break;
                case 'audio':
                    if (strict) {
                        return this.mi.isAudio(e.url);
                    } else {
                        let ext = this.mi.ext(e.url);
                        return this.mi.isAudio(e.url, ext) || !(this.mi.isLive(e.url, ext) || this.mi.isVideo(e.url, ext));
                    }
                    break;
            }
        }
        return true;
    }
    prepareEntry(e) {
        if (typeof(e.nameTerms) == 'undefined' || !Array.isArray(e.nameTerms) || e.nameTerms.length === 0) {
            e.nameTerms = this.tools.terms(e.name)
        }
        if (typeof(e.groupTerms) == 'undefined' || !Array.isArray(e.groupTerms) || e.groupTerms.length === 0) {
            if (typeof(e.group) !== 'string') {
                e.group = ''
            }
            e.groupTerms = this.tools.terms(e.group)
        }
        return e
    }
    prepareEntries(es) {
        return es.map(this.prepareEntry.bind(this))
    }
    
    async getUpdateAfter(url) {
        const meta = await getListMeta(url);
        return meta?.updateAfter;
    }
    
    async getContentLength(url) {
        const meta = await getListMeta(url);
        return meta?.contentLength;
    }
    
}

// Re-export resolveListDatabaseFile from tools.js
export { resolveListDatabaseFile } from './tools.js';
