import { LIST_DATA_KEY_MASK } from "../utils/utils.js";
import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import ListIndex from "./list-index.js";
import ConnRacing from "../conn-racing/conn-racing.js";

class List extends EventEmitter {
    constructor(url, masterOrKeywords) {
        super();
        this.debug = false;
        if (url.startsWith('//')) {
            url = 'http:' + url;
        }
        if (Array.isArray(masterOrKeywords)) {
            this.relevantKeywords = masterOrKeywords;
        } else {
            this.master = masterOrKeywords;
        }
        this.url = url
        this.relevance = {}
        this.dataKey = LIST_DATA_KEY_MASK.format(url)
        this.file = storage.resolve(this.dataKey)
        this.constants = { BREAK: -1 }
        this._log = [this.url]
        if (storage.has(this.dataKey)) {
            storage.touch(this.dataKey, { permanent: true }) // avoid cache eviction for loaded up lists
        }
    }
    log(...args) {
        if (this.destroyed)
            return;
        args.unshift(Date.now() / 1000);
        this._log.push(args);
    }
    ready() {
        return new Promise((resolve, reject) => {
            if (this.isReady) {
                resolve();
            } else {
                this.once('ready', resolve);
            }
        });
    }
    async start() {
        if (this.started) return true
        this.indexer = new ListIndex(this.file, this.url)
        await this.indexer.start()
        if (!this.isReady) this.isReady = true
    }
    reload() {
        this.indexer && this.indexer.destroy();
        this.started = false;
        return this.start();
    }
    progress() {
        let p = 0;
        if (this.validator) {
            p = this.validator.progress();
        } else if (this.isReady || this.destroyed) {
            p = 100;
        }
        return p;
    }
    async verify() {
        let quality = 0, relevance = 0;
        const qualityPromise = this.verifyListQuality().then(q => quality = q).catch(console.error);
        const relevancePromise = this.verifyListRelevance(this.index).then(r => relevance = r).catch(console.error);
        await qualityPromise;
        if (quality) {
            await relevancePromise;
            this.quality = quality;
            this.relevance = relevance;
        } else {
            this.quality = quality;
            this.relevance = { total: 0, err: 'list streams seems offline' };
        }
        this.verified = true
    }
    async verifyListQuality() {
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
        let len = this.indexer.length;
        if (!len) {
            const err = 'insufficient streams ' + len;
            storage.set(cacheKey, { err }, atts).catch(console.error);
            throw err;
        }
        let tests = Math.min(len, 10), mtp = Math.floor((len - 1) / (tests - 1));
        let ids = [];
        for (let i = 0; i < len; i += mtp)
            ids.push(i);
        let entries = await this.indexer.entries(ids);
        const urls = entries.map(e => e.url);
        if (this.debug) {
            console.log('validating list quality', this.url, tests, mtp, urls);
        }
        const racing = new ConnRacing(urls, { retries: 1, timeout: 8 });
        for (let i = 0; i < urls.length; i++) {
            const res = await racing.next().catch(console.error);
            if (res && res.valid) {
                const result = 100 / (i + 1);
                storage.set(cacheKey, { result }, atts).catch(console.error);
                return result;
            }
        }
        const err = 'no valid links';
        storage.set(cacheKey, { err }, atts).catch(console.error);
        throw err;
    }
    async verifyListRelevance(index) {
        const values = {
            hits: 0
        };
        const factors = {
            relevantKeywords: 1,
            mtime: 0.25
        };
        // relevantKeywords (check user channels presence in these lists and list size by consequence)
        let rks = this.master ? await this.master.relevantKeywords() : this.relevantKeywords;
        if (!rks || !rks.length) {
            console.error('no parent keywords', rks);
            values.relevantKeywords = 50;
        } else {
            let hits = 0, presence = 0;
            if(index.terms) {
                rks.forEach(term => {
                    if (typeof(index.terms[term]) != 'undefined') {
                        hits++;
                        presence += index.terms[term].n.length;
                    }
                })
            }
            presence /= Math.min(this.length, 1024); // to avoid too small lists
            if (presence > 1)
                presence = 1;
            // presence factor aims to decrease relevance of too big lists for the contents that we want
            values.relevantKeywords = presence * (hits / (rks.length / 100));
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
        return values;
    }
    async fetchAll() {
        await this.ready();
        if (!this.indexer)
            return [];
        return await this.indexer.entries();
    }
    async getMap(map) {
        await this.ready();
        if (!this.indexer)
            return [];
        return await this.indexer.getMap(map);
    }
    async getEntries(map) {
        return await this.indexer.entries(map);
    }
    destroy() {
        if (!this.destroyed) {
            if (storage.has(this.dataKey)) {
                storage.touch(this.dataKey, { permanent: false }); // freeup for cache eviction
            }
            this.destroyed = true
            if (this.indexer) {
                this.indexer.destroy();
                this.indexer = null;
            }
            if (this.validator) {
                this.validator.destroy();
                this.validator = null;
            }
            this.emit('destroy');
            this.removeAllListeners();
            this.master = null;
            this._log = [];
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
