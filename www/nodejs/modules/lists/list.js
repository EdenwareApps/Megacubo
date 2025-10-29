import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import ready from '../ready/ready.js'
import ListIndex from "./list-index.js";
import ConnRacing from "../conn-racing/conn-racing.js";
import { resolveListDatabaseKey, resolveListDatabaseFile } from "./tools.js";

class List extends EventEmitter {
    constructor(url, master) {
        super();
        this.debug = false;
        if (url.startsWith('//')) {
            url = 'http:' + url;
        }
        this.master = master;
        this.url = url
        this.relevance = {}
        this.dataKey = resolveListDatabaseKey(url)
        this.file = resolveListDatabaseFile(url)
        this.constants = { BREAK: -1 }
        this._log = [this.url]
        
        // Create holds for both main file and metadata file
        this.hold = storage.hold(this.dataKey)
        
        // Also hold the metadata file to prevent cleanup from deleting it
        // The metadata key should match what storage.unresolve() returns
        // We need to find the actual metadata file name
        const filename = this.file.split('/').pop().split('\\').pop(); // Get filename from path
        const metaFilename = filename.replace('.jdb', '.meta.jdb');
        const metaKey = storage.unresolve(metaFilename);
        this.metaHold = storage.hold(metaKey)
        
        // Additional protection: also hold the meta file using its full path
        // This ensures the meta file is protected even if the key resolution changes
        const metaFileKey = storage.unresolve(metaFilename);
        this.metaFileHold = storage.hold(metaFileKey)
        
        // Note: idx files share the same keys as main files, so they are already protected
        // test-playlist.idx.jdb -> test-playlist (same as main file)
        // test-playlist.meta.idx.jdb -> test-playlist.meta (same as metadata file)
        
        this.ready = ready(this.url)
        this.ready.starter(() => this.init(), true)
    }
    log(...args) {
        if (this.destroyed)
            return;
        args.unshift(Date.now() / 1000);
        this._log.push(args);
    }
    async init() {
        this.indexer = new ListIndex(this.file, this.url)
        try {
            await this.indexer.ready()
            this.ready.done()
        } catch (err) {
            this.ready.done(err)
            throw err
        }
    }
    reload() {
        this.indexer && this.indexer.destroy();
        return this.init();
    }
    async isConnectable() {
        const ttl = 120, cacheKey = 'list-quality-' + this.url;
        const cached = await storage.get(cacheKey);
        const atts = {
            ttl,
            raw: true,
            permanent: true // will be set to false on list destroying, create as permanent to avoid cache eviction on loaded lists
        };
        if (cached) {
            if (cached.err)
                throw cached.err;
            return cached.result;
        }
        if (this.destroyed) throw new Error('destroyed')
        // Add null check for indexer to prevent TypeError
        if (!this.indexer) {
            const err = 'indexer not available'
            storage.set(cacheKey, { err }, atts).catch(err => console.error(err))
            throw new Error(err)
        }
        let len = this.indexer.length
        if (!len) {
            const err = 'insufficient streams ' + len
            storage.set(cacheKey, { err }, atts).catch(err => console.error(err))
            throw err
        }
        let tests = Math.min(len, 20), mtp = Math.floor((len - 1) / (tests - 1))
        let ids = []
        for (let i = 0; i < len; i += mtp)
            ids.push(i)
        let entries = await this.indexer.entries(ids)
        const urls = entries.map(e => e.url)
        if (this.debug) {
            console.log('validating list quality', this.url, tests, mtp, urls)
        }
        const racing = new ConnRacing(urls, { retries: 1, timeout: 8 })
        for (let i = 0; i < urls.length; i++) {
            const res = await racing.next().catch(err => console.error(err))
            if (res && res.valid) {
                const result = 100 / (i + 1);
                storage.set(cacheKey, { result }, atts).catch(err => console.error(err))
                racing.destroy()
                return result
            }
        }
        racing.destroy()
        const err = 'no valid links';
        storage.set(cacheKey, { err }, atts).catch(err => console.error(err))
        throw err
    }
    async verify() {
        await this.ready();
        
        // Wait for indexer to be available and ready
        await this.indexer.ready()
        
        // NEW: Validate that groups in metadata match groups in loaded list
        try {
            const metaGroups = this.index?.groups || {}
            const metaGroupsKeys = Object.keys(metaGroups)
            
            const listGroups = this.index?.groups || {}
            const listGroupsKeys = Object.keys(listGroups)
            
            if (this.master?.debug) {
                console.log('verify: checking groups match', {
                    url: this.url,
                    metaGroupsCount: metaGroupsKeys.length,
                    listGroupsCount: listGroupsKeys.length,
                    metaGroups: metaGroupsKeys,
                    listGroups: listGroupsKeys
                });
            }
            
            // Check if groups match (order doesn't matter)
            const metaGroupsSet = new Set(metaGroupsKeys)
            const listGroupsSet = new Set(listGroupsKeys)
            
            if (metaGroupsSet.size !== listGroupsSet.size) {
                if (this.master?.debug) {
                    console.log('verify: groups count mismatch', {
                        metaCount: metaGroupsSet.size,
                        listCount: listGroupsSet.size
                    });
                }
                throw new Error('groups count mismatch between metadata and list')
            }
            
            // Check if all groups from metadata exist in list
            for (const group of metaGroupsKeys) {
                if (!listGroupsSet.has(group)) {
                    if (this.master?.debug) {
                        console.log('verify: group missing in list', group);
                    }
                    throw new Error(`group '${group}' missing in list`)
                }
            }
            
            if (this.master?.debug) {
                console.log('verify: groups validation passed', this.url);
            }
        } catch (groupsErr) {
            if (this.master?.debug) {
                console.log('verify: groups validation failed', this.url, groupsErr.message);
            }
            throw new Error(`groups validation failed: ${groupsErr.message}`);
        }
        
        const index = this.index, values = {
            hits: 0
        };
        const factors = {
            relevantKeywords: 1,
            mtime: 0.25
        };
        // relevantKeywords (check user channels presence in these lists and list size by consequence)
        let rksWithScores = null;
        
        if (this.master && this.master.relevantKeywords) {
            try {
                // Get keywords with scores
                rksWithScores = await this.master.relevantKeywords(true);
            } catch (err) {
                console.warn('Failed to get keywords with scores:', err.message);
                rksWithScores = null;
            }
        }
        
        // Extract array of terms from scores object
        const rks = rksWithScores ? Object.keys(rksWithScores) : [];
        
        if (!rks || !rks.length) {
            console.error('no parent keywords', rks);
            values.relevantKeywords = 0;
        } else {
            let presence = 0;
            const termCounts = {};
            const termScores = rksWithScores || {};
            
            try {
                for (const term of rks) {
                    // Add null check for indexer and db to prevent TypeError
                    if (!this.indexer || !this.indexer.db) {
                        console.error('indexer or db not available for term counting');
                        break;
                    }
                    const count = await this.indexer.db.count({ nameTerms: term });
                    termCounts[term] = count;
                }
            } catch (err) {
                console.error('error counting terms', err);
            }
            
            const hits = Object.values(termCounts).filter(c => c > 0).length;
            
            // Use weighted presence calculation with scores
            if (rksWithScores && Object.keys(rksWithScores).length > 0) {
                let weightedPresence = 0;
                let totalWeight = 0;
                
                for (const [term, count] of Object.entries(termCounts)) {
                    const weight = termScores[term] || 1;
                    weightedPresence += count * weight;
                    totalWeight += weight;
                }
                
                presence = totalWeight > 0 ? weightedPresence / totalWeight : 0;
            } else {
                // Fallback to simple average if no scores available
                presence = rks.length > 0 ? Object.values(termCounts).reduce((acc, count) => acc + count, 0) / rks.length : 0;
            }
            
            // Avoid division by zero if this.length is 0 or negative
            const listLength = Math.max(this.length || 1, 1);
            presence /= Math.min(listLength, 1024); // to avoid too small lists
            if (presence > 1)
                presence = 1;
            // presence factor aims to decrease relevance of too big lists for the contents that we want
            // Avoid division by zero if rks.length is 0
            const relevanceFactor = rks.length > 0 ? (hits / (rks.length / 100)) : 0;
            values.relevantKeywords = presence * relevanceFactor;
        }
        const rangeSize = 30 * (24 * 3600), now = (Date.now() / 1000), deadline = now - rangeSize;
        if (!index.lastmtime || index.lastmtime < deadline) {
            values.mtime = 0;
        } else {
            values.mtime = (index.lastmtime - deadline) / (rangeSize / 100);
        }
        let log = '', total = 0, maxtotal = 0;
        Object.values(factors).map(n => maxtotal += n);
        Object.keys(factors).forEach(k => {
            if (typeof(values[k]) == 'number' && typeof(factors[k]) == 'number') {
                log += k + '-' + typeof(values[k]) + '-' + typeof(factors[k]) + '-((' + values[k] + ' / 100) * ' + factors[k] + ')';
                total += ((values[k] / 100) * factors[k]);
            }
        });
        values.total = total / maxtotal;
        values.debug = { values, factors, total, maxtotal, log };
        //console.warn('LIST RELEVANCE', this.url, index.lastmtime, Object.keys(values).map(k => k +': '+ values[k]).join(', '))
        this.relevance = values;
        this.verified = true
        return values;
    }
    async fetchAll() {
        await this.ready();
        if (!this.indexer)
            return [];
        return this.indexer.entries();
    }
    async getMap(map) {
        await this.ready();
        if (!this.indexer)
            return [];
        return this.indexer.getMap(map);
    }
    async getEntries(map) {
        // Add null check for indexer to prevent TypeError
        if (!this.indexer) {
            return [];
        }
        return this.indexer.entries(map);
    }
    destroy() {
        if (!this.destroyed) {
            storage.touch(this.dataKey, { ttl: 24 * 3600 })
            
            // Release storage holds immediately to prevent memory leaks
            if (this.hold) {
                this.hold.release();
                this.hold = null;
            }
            if (this.metaHold) {
                this.metaHold.release();
                this.metaHold = null;
            }
            if (this.metaFileHold) {
                this.metaFileHold.release();
                this.metaFileHold = null;
            }
            
            this.destroyed = true
            
            // Destroy indexer and clear references
            if (this.indexer) {
                this.indexer.destroy();
                this.indexer = null;
            }
            
            this.emit('destroy');
            this.removeAllListeners();
            
            // Clear all references to help garbage collection
            this.master = null;
            this._log = [];
            this.url = null;
            this.dataKey = null;
            this.file = null;
            this.relevance = null;
            this.constants = null;
            
            // Force garbage collection if available
        }
    }
    get walk() {
        return (this.indexer && this.indexer.db.walk) ? this.indexer.db.walk.bind(this.indexer.db) : () => {}
    }
    get index() {
        return this.indexer ? this.indexer.index : {}
    }
    get length() {
        return this.indexer ? this.indexer.length : 0
    }
}
export default List;
