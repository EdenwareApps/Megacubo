import { Common } from "../lists/common.js";
import pLimit from "p-limit";
import config from "../config/config.js"
import { getDomain } from "../utils/utils.js";

class Index extends Common {
    constructor(opts) {
        super(opts);
        this.defaultsSearchOpts = {
            group: undefined,
            type: undefined,
            typeStrict: undefined,
            partial: undefined
        };
        // Cache for has() results with TTL
        this.hasCache = new Map();
        this.hasCacheTTL = 30000; // 30 seconds
    }
    optimizeSearchOpts(opts) {
        let nopts = {};
        Object.keys(this.defaultsSearchOpts).forEach(k => {
            nopts[k] = opts[k] ? opts[k] : undefined;
        });
        return nopts;
    }
    async has(terms, opts) {
        if (!terms.length) return {};
        if (!opts) opts = {};
        
        const results = {};
        
        // ULTRA-OPTIMIZATION: Process terms in parallel for better performance
        const limiter = pLimit(4);
        const tasks = [];
        
        for (const term of terms) {
            // Simple cache key: just the term
            const cacheKey = `${term.name}:${JSON.stringify(term.terms)}`;
            const cached = this.hasCache.get(cacheKey);
            
            if (cached && (Date.now() - cached.timestamp) < this.hasCacheTTL) {
                // Reuse cache
                results[term.name] = cached.result;
            } else {
                // ULTRA-OPTIMIZATION: Process term in parallel
                tasks.push(limiter(async () => {
                    const arrTerms = Array.isArray(term.terms) ? term.terms : this.tools.terms(term.terms);
                    const query = this.parseQuery(arrTerms, opts);
                    
                    // ULTRA-OPTIMIZATION: Use find() with limit 1 instead of count() for better performance
                    for (const url of Object.keys(this.lists)) {
                        try {
                            // Add null check for indexer to prevent TypeError
                            if (!this.lists[url].indexer || !this.lists[url].indexer.db) {
                                continue;
                            }
                            const ret = await this.lists[url].indexer.db.find(query, { limit: 1 });
                            if (ret.length > 0) {
                                results[term.name] = true;
                                
                                // Cache the result
                                this.hasCache.set(cacheKey, {
                                    result: true,
                                    timestamp: Date.now()
                                });
                                return; // Early exit
                            }
                        } catch (error) {
                            if (this.debug) {
                                console.warn(`Has error in ${url}:`, error.message);
                            }
                        }
                    }
                    
                    if (results[term.name] !== true) {
                        results[term.name] = false;
                        
                        // Cache the result
                        this.hasCache.set(cacheKey, {
                            result: false,
                            timestamp: Date.now()
                        });
                    }
                }));
            }
        }
        
        // ULTRA-OPTIMIZATION: Wait for all parallel tasks to complete
        if (tasks.length > 0) {
            await Promise.allSettled(tasks);
        }
        
        // Clean old cache entries periodically
        this.cleanupCache();
        
        return results;
    }
    
    cleanupCache() {
        // Cleanup every 10 calls to avoid overhead
        if (!this.cleanupCounter) this.cleanupCounter = 0;
        this.cleanupCounter++;
        
        if (this.cleanupCounter % 10 === 0) {
            const now = Date.now();
            for (const [key, value] of this.hasCache.entries()) {
                if ((now - value.timestamp) > this.hasCacheTTL) {
                    this.hasCache.delete(key);
                }
            }
        }
    }
    async multiSearch(terms, opts = {}) {
        const limit = opts.limit || 256;
        
        if (!terms || !Object.keys(terms).length) {
            return [];
        }
        
        const limiter = pLimit(3);
        const tasks = [];
        const scores = {};
        const references = new Set(); // Store unique references: listUrl + url + _
        
        // Process each term with its score
        for (const [termName, score] of Object.entries(terms)) {
            const query = this.parseQuery(termName, opts);
            
            // Search in all lists
            for (const url of Object.keys(this.lists)) {
                tasks.push(limiter(async () => {
                    try {
                        // Add null check for indexer to prevent TypeError
                        if (!this.lists[url].indexer || !this.lists[url].indexer.db) {
                            return;
                        }
                        const ret = await this.lists[url].indexer.db.find(query, { 
                            limit: 10000 // Higher limit for scoring phase
                        });
                        
                        for (const entry of ret) {
                            // Create unique identifier including listUrl, URL and line number
                            const uid = url + '|' + entry.url + '|' + entry._;
                            
                            // Initialize score if not exists (based on URL only)
                            if (!scores[entry.url]) {
                                scores[entry.url] = 0;
                            }
                            
                            // Add score for this term (URL-based scoring)
                            scores[entry.url] += score;
                            
                            // Store reference for later fetching
                            references.add(uid);
                        }
                    } catch (err) {
                        console.error(`Error searching in list ${url}:`, err);
                    }
                }));
            }
        }
        
        await Promise.allSettled(tasks);
        
        // Sort URLs by score and get top results
        const topUrls = Object.entries(scores)
            .map(([url, score]) => ({ url, score }))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
        
        // Now fetch the complete entries for top URLs
        const results = [];
        const fetchTasks = [];
        
        for (const { url, score } of topUrls) {
            // Find all references for this URL
            const urlReferences = Array.from(references)
                .filter(uid => uid.includes('|' + url + '|'))
                .slice(0, 1); // Take only the first occurrence per URL
            
            for (const uid of urlReferences) {
                const [listUrl, entryUrl, lineNumber] = uid.split('|');
                const lineNum = parseInt(lineNumber);
                
                fetchTasks.push(limiter(async () => {
                    try {
                        // Add null check for indexer to prevent TypeError
                        if (!this.lists[listUrl].indexer || !this.lists[listUrl].indexer.db) {
                            return;
                        }
                        const entry = await this.lists[listUrl].indexer.db.find({ url: entryUrl, _: lineNum }, { limit: 1 });
                        if (entry.length > 0) {
                            entry[0].source = listUrl;
                            entry[0].score = score;
                            results.push(entry[0]);
                        }
                    } catch (err) {
                        console.error(`Error fetching entry for ${entryUrl} from ${listUrl}:`, err);
                    }
                }));
            }
        }
        
        await Promise.allSettled(fetchTasks);
        
        // Sort by score and return
        return results
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, limit);
    }
    parseQuery(terms, opts) {
        if (!Array.isArray(terms)) {
            terms = this.tools.terms(terms);
        }
        const excludes = [];
        let i = 0, groups = [[]]
        for (const term of terms) {
            if (term == '|') {
                i++
                groups.push([])
            } else if (term.startsWith('-')) {
                excludes.push(term.substr(1));
            } else {
                groups[i].push(term);
            }
        }
        groups = groups.filter(g => g.length)
        const query = {}
        
        // Helper function to create search conditions for nameTerms and optionally groupTerms
        const createSearchConditions = (terms, useGroup = false, isPartial = false) => {
            if (terms.length === 1) {
                const term = terms[0];
                
                if (isPartial) {
                    // Partial match - use regex for substring matching
                    if (useGroup) {
                        return {
                            $or: [
                                { nameTerms: new RegExp(term, 'i') },
                                { groupTerms: new RegExp(term, 'i') }
                            ]
                        };
                    } else {
                        return { nameTerms: new RegExp(term, 'i') };
                    }
                } else {
                    // Exact match - use direct equality (fastest)
                    if (useGroup) {
                        return {
                            $or: [
                                { nameTerms: term },
                                { groupTerms: term }
                            ]
                        };
                    } else {
                        return { nameTerms: term };
                    }
                }
            } else {
                // Multiple terms - for partial search, each term should match partially
                // For exact search, use $all for AND behavior
                if (isPartial) {
                    // For partial with multiple terms, each term should match partially
                    const nameConditions = terms.map(term => ({ nameTerms: new RegExp(term, 'i') }));
                    const groupConditions = terms.map(term => ({ groupTerms: new RegExp(term, 'i') }));
                    
                    if (useGroup) {
                        return {
                            $or: [
                                { $and: nameConditions },
                                { $and: groupConditions }
                            ]
                        };
                    } else {
                        return { $and: nameConditions };
                    }
                } else {
                    // Exact match - use $all for AND behavior (more specific results)
                    if (useGroup) {
                        return {
                            $or: [
                                { nameTerms: { $all: terms } },
                                { groupTerms: { $all: terms } }
                            ]
                        };
                    } else {
                        return { nameTerms: { $all: terms } };
                    }
                }
            }
        };
        
        if (groups.length > 1) {
            // Multiple groups - use $or for better performance
            query.$or = groups.map(g => createSearchConditions(g, opts.group, opts.partial));
        } else if (groups.length === 1) {
            // Single group - use helper function
            Object.assign(query, createSearchConditions(groups[0], opts.group, opts.partial));
        }
        
        // Add excludes if any
        if (excludes.length > 0) {
            // Create exclude conditions based on partial mode
            let excludeConditions;
            if (opts.partial) {
                // For partial mode, use regex for excludes too
                const nameExcludes = excludes.map(exclude => ({ nameTerms: new RegExp(exclude, 'i') }));
                const groupExcludes = excludes.map(exclude => ({ groupTerms: new RegExp(exclude, 'i') }));
                excludeConditions = { $or: [...nameExcludes, ...groupExcludes] };
            } else {
                // For exact mode, use $in for excludes
                excludeConditions = { $or: [
                    { nameTerms: { $in: excludes } },
                    { groupTerms: { $in: excludes } }
                ] };
            }
            
            // Add exclusion conditions to the query
            query.$not = excludeConditions;
        }
        
        // Add icon filtering if withIconOnly is enabled
        if (opts.withIconOnly) {
            const iconConditions = [
                { icon: { $exists: true } },
                { icon: { $ne: '' } },
                { icon: { $ne: null } }
            ];
            
            // If query already has $and, add icon conditions to it
            if (query.$and) {
                query.$and.push(...iconConditions);
            } else if (query.$or || query.nameTerms || Object.keys(query).length > 0) {
                // If query has other conditions, wrap everything in $and
                const originalQuery = { ...query };
                query.$and = [originalQuery, ...iconConditions];
                // Clean up the original conditions since they're now in $and
                if (originalQuery.$or) delete query.$or;
                if (originalQuery.nameTerms) delete query.nameTerms;
                if (originalQuery.$not) delete query.$not;
            } else {
                // If query is empty, just use icon conditions
                query.$and = iconConditions;
            }
        }
        
        return query;
    }
    async search(terms, opts = {}) {
        if (typeof (terms) == 'string') {
            terms = this.tools.terms(terms, false, true);
        }
        let start = (Date.now() / 1000)
        const limit = opts.limit || 256, maxWorkingSetLimit = parseInt(limit * 1.5);
        if (!terms) {
            return [];
        }
        if (this.debug) {
            console.warn('lists.search() parsing query', ((Date.now() / 1000) - start) + 's (pre time)');
        }
        const query = this.parseQuery(terms, opts)
        if (this.debug) {
            console.warn('lists.search() map searching', ((Date.now() / 1000) - start) + 's (pre time)', query);
        }
        const already = new Set();
        const results = []
        
        // OPTIMIZATION: Increase concurrency limit for better parallelization
        const limiter = pLimit(4) // Increased from 2 to 4
        
        // OPTIMIZATION: Use all available lists (no EPG lists in this module)
        const sortedUrls = Object.keys(this.lists);
        
        const tasks = []
        
        // ULTRA-OPTIMIZATION: More aggressive early termination
        let shouldStop = false;
        
        for (const url of sortedUrls) {
            if (shouldStop) break;
            
            tasks.push(limiter(async () => {
                if (shouldStop || results.length >= maxWorkingSetLimit) {
                    return;
                }
                
                try {
                    // Add null check for indexer to prevent TypeError
                    if (!this.lists[url].indexer || !this.lists[url].indexer.db) {
                        return;
                    }
                    // ULTRA-OPTIMIZATION: Skip count() - go directly to find() with limit
                    const queryOpts = {
                        limit: Math.min(maxWorkingSetLimit - results.length, 50), // Smaller limit per database for faster results
                        streaming: false // Disable streaming for faster small queries
                    };
                    
                    const ret = await this.lists[url].indexer.db.find(query, queryOpts)
                    
                    // ULTRA-OPTIMIZATION: Process results more efficiently with early termination
                    for (const r of ret) {
                        if (shouldStop || results.length >= maxWorkingSetLimit) {
                            shouldStop = true;
                            break;
                        }
                        
                        
                        r.source = url
                        if (already.has(r.url)) {
                            continue;
                        }
                        
                        already.add(r.url);
                        results.push(r);
                        
                        // ULTRA-OPTIMIZATION: Immediate termination when we have enough results
                        if (results.length >= maxWorkingSetLimit) {
                            shouldStop = true;
                            break;
                        }
                    }
                } catch (error) {
                    // ULTRA-OPTIMIZATION: Graceful error handling without blocking other searches
                    if (this.debug) {
                        console.warn(`Search error in ${url}:`, error.message);
                    }
                }
            }))
        }
        
        // ULTRA-OPTIMIZATION: Use Promise.allSettled with shorter timeout and early termination
        const timeoutPromise = new Promise(resolve => setTimeout(resolve, 10000)); // Reduced from 30s to 10s
        await Promise.race([
            Promise.allSettled(tasks),
            timeoutPromise
        ]);
        
        if (this.debug) {
            console.warn('lists.search() RESULTS*', ((Date.now() / 1000) - start) + 's (total time)', terms);
        }
        
        return this.adjustSearchResults(results, opts, limit)
    }
    adjustSearchResults(entries, opts, limit) {
        let map = {}, nentries = [];
        
        
        if (opts.type == 'live') {
            const livefmt = config.get('live-stream-fmt');
            switch (livefmt) {
                case 'hls':
                    entries = this.isolateHLS(entries, true);
                    break;
                case 'mpegts':
                    entries = this.isolateHLS(entries, false);
                    break;
            }
        }
        entries.forEach(e => {
            // Skip entries without valid URL
            if (!e || !e.url || typeof e.url !== 'string') {
                return;
            }
            
            let domain = getDomain(e.url);
            if (typeof (map[domain]) == 'undefined') {
                map[domain] = [];
            }
            map[domain].push(e);
        });
        let domains = Object.keys(map);
        for (let i = 0; nentries.length < limit; i++) {
            let keep;
            domains.forEach(domain => {
                if (!map[domain] || nentries.length >= limit)
                    return;
                if (map[domain].length > i) {
                    keep = true;
                    nentries.push(map[domain][i]);
                } else {
                    delete map[domain];
                }
            });
            if (!keep)
                break;
        }
        return this.tools.sort(nentries);
    }
    ext(file) {
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    }
    isolateHLS(entries, elevate) {
        let notHLS = [];
        entries = entries.filter(a => {
            if (this.ext(a.url) == 'm3u8') {
                return true;
            }
            notHLS.push(a);
        });
        if (elevate) {
            entries.push(...notHLS);
        } else {
            entries = notHLS.push(...entries);
        }
        return entries;
    }
    async groups(types, myListsOnly) {
        let groups = [], map = {};
        if (myListsOnly) {
            myListsOnly = config.get('lists').map(l => l[1]);
        }
        Object.keys(this.lists).forEach(url => {
            if (myListsOnly && !myListsOnly.includes(url))
                return;
            if (!this.lists[url] || !this.lists[url].index) {
                return;
            }
            let entries = this.lists[url].index.groupsTypes;
            types.forEach(type => {
                if (!entries || !entries[type])
                    return;
                entries[type].forEach(group => {
                    const parts = group.name.split('/');
                    if (parts.length > 1) {
                        parts.forEach((part, i) => {
                            const path = parts.slice(0, i + 1).join('/');
                            if (typeof (map[path]) == 'undefined')
                                map[path] = [];
                            if (i < (parts.length - 1))
                                map[path].push(parts[i + 1]);
                        });
                    }
                    groups.push({
                        group: group.name,
                        name: group.name.split('/').pop(),
                        url,
                        icon: group.icon
                    });
                });
            });
        });
        groups = this.tools.sort(groups);
        
        // FIXED: Simplified logic to prevent recursive concatenation and duplicates
        const seenGroups = new Set();
        const result = [];
        
        groups.forEach(group => {
            // Use a unique key to prevent duplicates based on URL and group name
            const groupKey = `${group.url}:${group.group}`;
            
            if (!seenGroups.has(groupKey)) {
                seenGroups.add(groupKey);
                result.push(group);
            }
        });
        
        return result;
    }
    async group(group) {
        const list = this.lists[group.url]
        if (!list) {
            throw 'List not loaded';
        }
        if (!list.index) {
            throw 'List index not available';
        }
        /*
                let mmap, map = list.index.groups[group.group].slice(0)
                if(!map) map = []
                Object.keys(list.index.groups).forEach(s => {
                    if(s != group.group && s.includes('/') && s.startsWith(group.group)){
                        if(!mmap) { // jit
                            mmap = new Map(map.map(m => [m, null]))
                            map = [] // freeup mem
                        }
                        list.index.groups[s].forEach(n => mmap.has(n) || mmap.set(n, null))
                    }
                })
        
                if(mmap) {
                    map = Array.from(mmap, ([key]) => key)
                }
        */
        let groupKey = group.group || ''
        if (!list.index.groups[groupKey]) {
            groupKey = Object.keys(list.index.groups).filter(g => g.endsWith(group.group)).shift()
        }
        if (!groupKey) {
            return [];
        }
        let entries = [], map = list.index.groups[groupKey] || [];
        if (map.length) {
            entries = await list.getEntries(map);
            return entries;
        }
        entries = this.parentalControl.filter(entries, true);
        entries = this.tools.sort(entries);
        return entries;
    }
}

export default Index;
