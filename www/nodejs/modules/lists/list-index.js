import fs from "fs";
import ListIndexUtils from "./list-index-utils.js";
import { Database } from "jexidb"
import ready from '../ready/ready.js'
import { getListMeta } from "./common.js";

export default class ListIndex extends ListIndexUtils {
    constructor(file, url) {
        super()
        this.url = url
        this.file = file
        this.ready = ready()
        this.ready.starter(() => this.init(), true)
    }
    fail(err) {
        this.error = err;
        if (this.listenerCount('error')) {
            this.emit('error', err)
        }
        this.emit('end')
    }
    async entries(map) {
        await this.ready()
        // JexiDB v2: fetch all records and select by positions when a map (array of indices) is provided
        const all = await this.db.find({})
        if (!map) return all
        return map.map(i => all[i]).filter(e => typeof e !== 'undefined')
    }
    async getMap(map) {
        await this.ready()
        const entries = []
        const rows = await this.entries(map)
        for (const e of rows) {
            if (e && e.name) {
                entries.push({
                    group: e.group,
                    name: e.name,
                    _: e._
                })
            }
        }
        if (entries.length) {
            entries[0].source = this.url
        }
        return entries
    }
    async expandMap(structure) {
        const map = [], tbl = {}, ntypes = ['string', 'number']
        
        // Find the source from the first entry that has it
        let source = null
        for (let i in structure) {
            if (structure[i] && structure[i].source) {
                source = structure[i].source
                break
            }
        }
        
        for (let i in structure) {
            const t = typeof (structure[i]._)
            if (ntypes.includes(t) && !structure[i].url) {
                if (t != 'number') {
                    structure[i]._ = parseInt(structure[i]._)
                }
                tbl[structure[i]._] = i
                map.push(structure[i]._)
            }
        }
        if (map.length) {
            map.sort()
            await this.ready()
            const xs = await this.entries(map)
            for (let x = 0; x < xs.length; x++) {
                let i = tbl[xs[x]._ || map[x]];
                if (structure[i] && xs[x]) {
                    Object.assign(structure[i], xs[x])
                    structure[i]._ = xs[x]._ = undefined
                    
                    // Propagate source to expanded entries
                    if (source && !structure[i].source) {
                        structure[i].source = source
                    }
                }
            }
        }
        return structure
    }
    async init() {
        let err
        try {
            this.db = new Database(this.file, {
                create: false, // Read-only for existing lists
                fields: {
                    url: 'string',              // Stream URL
                    name: 'string',             // Stream name
                    icon: 'string',             // Stream icon/logo
                    gid: 'string',             // TV guide ID
                    group: 'string',            // Group title
                    groups: 'array:string',     // Multiple groups
                    groupName: 'string',       // Group name
                    nameTerms: 'array:string',  // Search terms from name
                    groupTerms: 'array:string', // Search terms from group
                    lang: 'string',            // Language (tvg-language + detection)
                    country: 'string',          // Country (tvg-country + detection)
                    age: 'number',             // Age rating (0 = default, no restriction)
                    subtitle: 'string',        // Subtitle
                    userAgent: 'string',       // User agent (http-user-agent)
                    referer: 'string',         // Referer (http-referer)
                    author: 'string',          // Author (pltv-author)
                    site: 'string',            // Site (pltv-site)
                    email: 'string',           // Email (pltv-email)
                    phone: 'string',           // Phone (pltv-phone)
                    description: 'string',     // Description (pltv-description)
                    epg: 'string',             // EPG URL (url-tvg, x-tvg-url)
                    subGroup: 'string',        // Sub group (pltv-subgroup)
                    rating: 'string',          // Rating (rating, tvg-rating)
                    parental: 'string',        // Parental control (parental, censored)
                    genre: 'string',          // Genre (tvg-genre)
                    region: 'string',         // Region (region)
                    categoryId: 'string',     // Category ID (category-id)
                    ageRestriction: 'string'   // Age restriction (age-restriction)
                },
                indexes: ['nameTerms', 'groupTerms'], // Only the fields we want to index
                integrityCheck: 'none', // Skip integrity check for speed
                streamingThreshold: 0.8, // Higher threshold for lists (80% of data)
                indexedQueryMode: 'loose', // Loose mode to allow queries on non-indexed fields
                debugMode: false, // Disable debug mode for production
            })
            const ret = await this.db.init().catch(e => err = e)
            if (this.destroyed) {
                err = new Error('destroyed')
            }
            if (err) {
                // Ensure db is set to null when initialization fails
                this.db = null
                throw err
            }
            await this.loadMeta()
            return ret
        } catch (e) {
            // Ensure db is set to null when initialization fails
            this.db = null
            throw new Error('file not found or empty, ' + e)
        }
    }
    async loadMeta() {
        const meta = await getListMeta(this.url);
        
        if (meta.uniqueStreamsLength > 0) {
            this.indexError = null // No error, valid meta data
            this._index = meta
        } else if (!this?._index?.uniqueStreamsLength) {
            this.indexError = new Error('meta file exists but contains no valid data')
            this._index = {
                groups: {},
                meta: {},
                gids: {},
                groupsTypes: {},
                uniqueStreamsLength: 0
            }
        }
    }
    destroy() {
        if (!this.destroyed) {
            console.log(`🗑️ Destroying ListIndex for: ${this.url}`);
            console.log(`📊 Database exists: ${!!this.db}`);
            console.log(`📊 Database already destroyed: ${this.db ? this.db.destroyed : 'N/A'}`);
            
            this.destroyed = true
            this.emit('destroy')
            this.removeAllListeners()
            
            // Force immediate cleanup to prevent memory leaks
            if (this.db && !this.db.destroyed) {
                try {
                    const destroyResult = this.db.destroy();
                    if (destroyResult && typeof destroyResult.then === 'function') {
                        // Don't wait for async destroy, set to null immediately to prevent memory leaks
                        this.db = null;
                        destroyResult.catch(err => {
                            console.error(`❌ Error destroying database for ${this.url}:`, err);
                        });
                        console.log(`✅ Database destroy initiated for: ${this.url}`);
                    } else {
                        this.db = null;
                        console.log(`✅ Database destroyed (sync) and nullified for: ${this.url}`);
                    }
                } catch (err) {
                    console.error(`❌ Error calling database destroy for ${this.url}:`, err);
                    this.db = null;
                }
            } else {
                this.db = null;
                console.log(`⚠️ Database was already destroyed or null for: ${this.url}`);
            }
            
            // Clear all references to help garbage collection
            this._index = null;
            this._log = [];
            this.url = null;
            this.file = null;
            
            // Note: global.gc() is not available in production
        }
    }
    get index() {
        return this._index || {}
    }
    get length() {
        return (this.db && !this.db.destroyed) ? this.db.length : 0
    }
}
