import { EventEmitter } from "events";
import { Database } from "jexidb"
import ready from '../ready/ready.js'
import { getListMeta } from "./list-meta.js";
import { inferTypeFromGroupName } from "./stream-classifier.js";
import dbConfig from "./db-config.js";
import fs from 'fs';

export default class ListIndex extends EventEmitter {
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

        // No map provided: return every entry walking the database sequentially
        if (!Array.isArray(map)) {
            return this.db.find({})
        }

        let smap = new Set(map);
        let results = [];
        let currentIndex = 0;
        for await (const entry of this.db.walk({})) {
            currentIndex++
            if (smap.has(currentIndex)) {
                results.push(entry)
            }
        }

        return results.filter(e => typeof e !== 'undefined')
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
    /**
     * Wait for file update to complete if in progress
     * Prevents race conditions when reading while UpdateListIndex is writing the final file
     * 
     * MULTIPLATFORM COMPATIBILITY:
     * - Windows: rename() may fail if target file is open, so we wait for .updating to disappear
     * - Linux/macOS: rename() is atomic and works even if file is open, but we wait for consistency
     * 
     * NOTE: This only affects opening the final .jdb file, NOT parsing from temp files during download.
     * Parsing can read temp files while they're being written (streaming) without any blocking.
     */
    async waitForUpdateComplete(maxWaitMs = 3000) {
        const updatingFile = this.file.replace(/\.jdb$/i, '.updating.jdb')
        const updatingIndexFile = this.file.replace(/\.jdb$/i, '.idx.updating.jdb')
        
        const checkUpdating = async () => {
            try {
                await fs.promises.access(updatingFile, fs.constants.F_OK)
                return true
            } catch {
                try {
                    await fs.promises.access(updatingIndexFile, fs.constants.F_OK)
                    return true
                } catch {
                    return false
                }
            }
        }
        
        // Quick check first - if no update in progress, return immediately (no blocking)
        if (!(await checkUpdating())) {
            return // No update in progress, proceed immediately
        }
        
        // Update detected - wait with short delays (non-blocking for parsing)
        // This protects against Windows file locking issues during rename
        const startTime = Date.now()
        let attempt = 0
        const maxAttempts = 6 // Reduced retries for faster response
        const baseDelay = 50 // Start with 50ms delay (very short for responsiveness)
        
        while (await checkUpdating()) {
            if (this.destroyed) {
                throw new Error('destroyed')
            }
            
            const elapsed = Date.now() - startTime
            if (elapsed >= maxWaitMs) {
                // Timeout reached - proceed anyway
                // On Linux/macOS rename is atomic, on Windows we'll retry on error
                break
            }
            
            // Exponential backoff with short delays: 50ms, 100ms, 200ms, 400ms, 800ms (max 800ms)
            const delay = Math.min(baseDelay * Math.pow(2, attempt), 800)
            await new Promise(resolve => setTimeout(resolve, delay))
            attempt++
            
            if (attempt >= maxAttempts) {
                break
            }
        }
    }
    
    async init() {
        let err
        try {
            // Quick check: wait only if update is actually in progress
            // This doesn't block parsing from temp files - only protects opening final .jdb
            // On Windows, this prevents rename() failures when file is open
            // On Linux/macOS, rename() is atomic but we wait for consistency
            await this.waitForUpdateComplete().catch(waitErr => {
                // Don't fail - proceed with opening file
                // If rename failed on Windows, Database.init() will handle the error
            })
            
            // Check if database file exists before trying to open it
            // This prevents confusing errors when list hasn't been downloaded yet
            try {
                await fs.promises.access(this.file, fs.constants.F_OK)
            } catch (accessErr) {
                // File doesn't exist - this is expected for lists that haven't been downloaded yet
                this.db = null
                throw new Error('Database file does not exist (list not downloaded yet)')
            }

            // Open database file - on Windows, if file is locked, this will fail gracefully
            // and we'll retry or handle the error appropriately
            this.db = new Database(this.file, {...dbConfig, create: false});
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
    /**
     * Build minimal groupsTypes from DB when .list-meta.jdb has empty groupsTypes (e.g. list indexed before meta write fix).
     * Walks entries and collects unique group names (up to maxGroups), then sets this._index.groupsTypes.
     */
    async buildGroupsTypesFromDb(maxGroups = 500) {
        if (!this.db || this.db.destroyed) return
        const seen = new Set()
        const live = []
        const vod = []
        const series = []
        let count = 0
        try {
            for await (const entry of this.db.walk({})) {
                if (seen.size >= maxGroups) break
                const g = entry && entry.group && String(entry.group).trim()
                if (g && !seen.has(g)) {
                    seen.add(g)
                    const item = { name: g }
                    const inferred = inferTypeFromGroupName(g)
                    if (inferred === 'vod') vod.push(item)
                    else if (inferred === 'series') series.push(item)
                    else live.push(item)
                }
                count++
                if (count > 50000) break
                // Safety limit: stop after 50k entries even if we haven't hit maxGroups
            }
        } catch (e) {
            return
        }
        // Always set shape so index.groupsTypes has live/vod/series arrays (even if all empty)
        this._index.groupsTypes = { live, vod, series }
    }

    async loadMeta() {
        const meta = await getListMeta(this.url)
        const dbLength = this.length

        const gt = meta.groupsTypes || {}
        // Ensure groupsTypes always has live/vod/series arrays (defensive for old or malformed meta)
        if (!Array.isArray(gt.live)) gt.live = []
        if (!Array.isArray(gt.vod)) gt.vod = []
        if (!Array.isArray(gt.series)) gt.series = []

        this._index = {
            meta: meta.meta || {},
            gids: meta.gids || {},
            groupsTypes: gt,
            length: typeof meta.length === 'number' ? meta.length : 0
        }

        if (dbLength > 0) {
            this.indexError = null
            if (this._index.length !== dbLength) {
                this._index.length = dbLength
            }
            // Fallback: if meta file had empty groupsTypes (e.g. list indexed before meta write fix), build from DB
            const gt = this._index.groupsTypes
            const hasGroups = gt && (gt.live?.length > 0 || gt.vod?.length > 0 || gt.series?.length > 0)
            if (!hasGroups) {
                await this.buildGroupsTypesFromDb(500).catch(() => {})
            }
        } else if (this._index.length > 0) {
            this.indexError = null
        } else {
            this.indexError = new Error('meta file exists but contains no valid data')
        }
    }
    destroy() {
        if (!this.destroyed) {
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
                    } else {
                        this.db = null;
                    }
                } catch (err) {
                    console.error(`❌ Error calling database destroy for ${this.url}:`, err);
                    this.db = null;
                }
            } else {
                this.db = null;
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
        // Never return {} so lists.groups(types) and index.groupsTypes always have live/vod/series arrays
        if (this._index) return this._index
        return { meta: {}, gids: {}, groupsTypes: { live: [], vod: [], series: [] }, length: 0 }
    }
    get length() {
        return (this.db && !this.db.destroyed) ? this.db.length : 0
    }
}
