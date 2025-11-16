import { EventEmitter } from "events";
import { Database } from "jexidb"
import ready from '../ready/ready.js'
import { getListMeta } from "./list-meta.js";
import dbConfig from "./db-config.js";

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
    async init() {
        let err
        try {
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
    async loadMeta() {
        const meta = await getListMeta(this.url)
        const dbLength = this.length

        this._index = {
            meta: meta.meta || {},
            gids: meta.gids || {},
            groupsTypes: meta.groupsTypes || {},
            length: typeof meta.length === 'number' ? meta.length : 0
        }

        if (dbLength > 0) {
            this.indexError = null
            if (this._index.length !== dbLength) {
                this._index.length = dbLength
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
        return this._index || {}
    }
    get length() {
        return (this.db && !this.db.destroyed) ? this.db.length : 0
    }
}
