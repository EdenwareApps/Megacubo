import { Common } from "../lists/common.js";
import pLimit from "p-limit";
import config from "../config/config.js"
import { getDomain } from "../utils/utils.js";
import StreamClassifier from "./stream-classifier.js";

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
        // Cache per list+term for permanent caching while list is loaded (immutable)
        this.hasCachePerList = new Map(); // Map<listUrl, Map<termKey, result>>
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
        const limiter = pLimit(8);
        const listUrls = Object.keys(this.lists);
        const tasks = [];
        
        for (const term of terms) {
            const cacheKey = `${term.name}:${JSON.stringify(term.terms)}`;
            const cached = this.hasCache.get(cacheKey);
            
            // Check global cache first (for backward compatibility)
            if (cached && (Date.now() - cached.timestamp) < this.hasCacheTTL) {
                results[term.name] = cached.result;
                continue;
            }
            
            const arrTerms = Array.isArray(term.terms) ? term.terms : this.tools.terms(term.terms);
            // Extract excludes (terms starting with '-') and filter them from arrTerms
            const excludes = [];
            const filteredTerms = [];
            for (const t of arrTerms) {
                if (t.startsWith('-')) {
                    excludes.push(t.substr(1)); // Remove '-' prefix
                } else {
                    filteredTerms.push(t);
                }
            }
            // Use exists() for faster index-only check (no disk I/O)
            const useAll = !opts.partial; // $all when partial is false
            let found = false;
            const termTasks = []; // Tasks for this specific term
            const abortController = new AbortController(); // For early exit
            
            // Check per-list cache first (for loaded/immutable lists)
            let foundInCache = false;
            for (const url of listUrls) {
                const list = this.lists[url];
                if (!list || !list.indexer || !list.indexer.db) continue;
                
                // Check if list is loaded and immutable (not updating)
                // List is considered loaded if it has indexer, db, and length > 0
                const isListLoaded = list.indexer && list.indexer.db && list.length > 0 && !(this.isListUpdating && this.isListUpdating(url));
                if (isListLoaded) {
                    const listCache = this.hasCachePerList.get(url) || new Map();
                    const termKey = `${term.name}:${JSON.stringify(term.terms)}`;
                    const cachedResult = listCache.get(termKey);
                    
                    if (cachedResult !== undefined) {
                        if (cachedResult === true) {
                            found = true;
                            foundInCache = true;
                            results[term.name] = true;
                            break; // Found in cache, no need to check other lists
                        }
                        // If cached as false, continue checking other lists
                    }
                }
            }
            
            if (foundInCache) {
                // Update global cache for backward compatibility
                this.hasCache.set(cacheKey, {
                    result: true,
                    timestamp: Date.now()
                });
                continue;
            }

            // If not found in cache, search in lists
            for (const url of listUrls) {
                const task = limiter(async () => {
                    // Early exit: if already found or aborted, skip
                    if (found || abortController.signal.aborted) {
                        return;
                    }
                    
                    try {
                        if (this.isListUpdating && this.isListUpdating(url)) {
                            return;
                        }
                        const list = this.lists[url];
                        if (!list || !list.indexer || !list.indexer.db) {
                            return;
                        }
                        
                        // Use exists() for ultra-fast index-only check (no disk I/O)
                        // Prefer indexManager.exists() directly (synchronous, faster) if available
                        // Build options object with excludes if any
                        const existsOptions = { $all: useAll };
                        if (excludes.length > 0) {
                            existsOptions.excludes = excludes;
                        }
                        let ret = false;
                        if (list.indexer.db.indexManager && typeof list.indexer.db.indexManager.exists === 'function') {
                            // Direct synchronous call (fastest)
                            ret = list.indexer.db.indexManager.exists('nameTerms', filteredTerms, existsOptions);
                        } else {
                            // Async wrapper (still fast, index-only)
                            ret = await list.indexer.db.exists('nameTerms', filteredTerms, existsOptions);
                        }
                        
                        if (ret) {
                            found = true;
                            abortController.abort(); // Cancel other tasks for this term
                            
                            // Cache result permanently for this list (since it's immutable)
                            const isListLoaded = list.indexer && list.indexer.db && list.length > 0 && !(this.isListUpdating && this.isListUpdating(url));
                            if (isListLoaded) {
                                if (!this.hasCachePerList.has(url)) {
                                    this.hasCachePerList.set(url, new Map());
                                }
                                const listCache = this.hasCachePerList.get(url);
                                const termKey = `${term.name}:${JSON.stringify(term.terms)}`;
                                listCache.set(termKey, true);
                            }
                        }
                    } catch (error) {
                        if (this.debug) {
                            console.warn(`Has error in ${url}:`, error.message);
                        }
                    }
                });
                termTasks.push(task);
                tasks.push(task);
            }

            // Task to process results after all search tasks for this term complete
            const resultTask = limiter(async () => {
                await Promise.all(termTasks); // Wait only for this term's search tasks
                if (found) {
                    results[term.name] = true;
                    this.hasCache.set(cacheKey, {
                        result: true,
                        timestamp: Date.now()
                    });
                } else {
                    results[term.name] = false;
                    this.hasCache.set(cacheKey, {
                        result: false,
                        timestamp: Date.now()
                    });
                    
                    // Cache negative results per list too (for loaded lists)
                    for (const url of listUrls) {
                        const list = this.lists[url];
                        if (!list || !list.indexer || !list.indexer.db) continue;
                        
                        const isListLoaded = list.ready && !(this.isListUpdating && this.isListUpdating(url));
                        if (isListLoaded) {
                            if (!this.hasCachePerList.has(url)) {
                                this.hasCachePerList.set(url, new Map());
                            }
                            const listCache = this.hasCachePerList.get(url);
                            const termKey = `${term.name}:${JSON.stringify(term.terms)}`;
                            listCache.set(termKey, false);
                        }
                    }
                }
            });
            tasks.push(resultTask);
        }
        
        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
        
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
    
    /**
     * Clear per-list cache when list is removed/updated
     * @param {string} url - List URL to clear cache for
     */
    clearListCache(url) {
        if (this.hasCachePerList && this.hasCachePerList.has(url)) {
            this.hasCachePerList.delete(url);
        }
    }
    async multiSearch(terms, opts = {}) {        
        if (!terms || !Object.keys(terms).length) {
            return [];
        }

        const limit = opts.limit || 256;
        const limitPerList = opts.limitPerList || limit * 5;
        const limiter = pLimit(3);
        const tasks = [];
        const allResults = [];
        const seenUrls = new Set(); // Track unique URLs across all lists
        
        // Pre-filter function for VOD and parental control
        const shouldIncludeEntry = (entry) => {
            // Pre-filter: discard entries blocked by parental control
            if (!this.parentalControl.allow(entry)) {
                return false;
            }
            
            // Pre-filter: discard non-VOD entries if searching for VOD with typeStrict
            if (opts.type === 'vod') {
                if (opts.typeStrict === true) {
                    return StreamClassifier.clearlyVOD(entry);
                } else {
                    // Quando typeStrict=false, incluir seemsVOD OU null (unknown)
                    // Otimização: classificar uma vez e reutilizar o resultado
                    const classification = StreamClassifier.classify(entry);
                    return classification === 'vod' || classification === 'seems-vod' || classification === null;
                }
            } else if (opts.type === 'live') {
                if (opts.typeStrict === true) {
                    return StreamClassifier.clearlyLive(entry);
                } else {
                    // Quando typeStrict=false, incluir seemsLive OU null (unknown)
                    // Otimização: classificar uma vez e reutilizar o resultado
                    const classification = StreamClassifier.classify(entry);
                    return classification === 'live' || classification === 'seems-live' || classification === null;
                }
            }
            
            return true;
        };
        
        // OPTIMIZATION: Use db.score() for efficient multi-term scoring
        // Convert terms to a format suitable for score() method
        // Score expects: { 'term1': score1, 'term2': score2, ... }
        const scoreMap = {};
        for (const [termName, score] of Object.entries(terms)) {
            // Parse term to get individual search terms
            const termArray = Array.isArray(termName) ? termName : this.tools.terms(termName);
            // Add score for each individual term
            for (const term of termArray) {
                if (term && term !== '|' && !term.startsWith('-')) {
                    // Accumulate scores if term appears multiple times
                    scoreMap[term] = (scoreMap[term] || 0) + score;
                }
            }
        }
        
        // Search in all lists using score() method
        for (const url of Object.keys(this.lists)) {
            tasks.push(limiter(async () => {
                try {
                    // Skip lists that are being updated
                    if (this.isListUpdating && this.isListUpdating(url)) {
                        return;
                    }
                    // Add null check for list and indexer to prevent TypeError
                    if (!this.lists[url] || !this.lists[url].indexer || !this.lists[url].indexer.db) {
                        return;
                    }
                    
                    // OPTIMIZATION: Use score() method for faster multi-term search
                    const scoredResults = await this.lists[url].indexer.db.score('nameTerms', scoreMap, {
                        limit: limitPerList,
                        sort: 'desc',
                        includeScore: true
                    });
                    
                    // Also check groupTerms if group search is enabled
                    if (opts.group) {
                        const groupScoredResults = await this.lists[url].indexer.db.score('groupTerms', scoreMap, {
                            limit: limitPerList,
                            sort: 'desc',
                            includeScore: true
                        });
                        
                        // Merge results, keeping highest score per entry
                        const mergedResults = new Map();
                        for (const entry of [...scoredResults, ...groupScoredResults]) {
                            const key = entry.url + '|' + entry._;
                            const existing = mergedResults.get(key);
                            if (!existing || (entry.score || 0) > (existing.score || 0)) {
                                mergedResults.set(key, entry);
                            }
                        }
                        
                        for (const entry of mergedResults.values()) {
                            if (seenUrls.has(entry.url)) {
                                continue;
                            }
                            
                            seenUrls.add(entry.url); // Mark as seen to prevent re-processing
                            
                            // Pre-filter: discard non-VOD entries if searching for VOD with typeStrict
                            if (!shouldIncludeEntry(entry)) {
                                continue;
                            }
                            
                            entry.source = url;
                            entry.score = entry.score || 0;
                            allResults.push(entry);
                        }
                    } else {
                        for (const entry of scoredResults) {
                            if (seenUrls.has(entry.url)) {
                                continue;
                            }
                            
                            seenUrls.add(entry.url); // Mark as seen to prevent re-processing
                            
                            // Pre-filter: discard non-VOD entries if searching for VOD with typeStrict
                            if (!shouldIncludeEntry(entry)) {
                                continue;
                            }
                            
                            entry.source = url;
                            entry.score = entry.score || 0;
                            allResults.push(entry);
                        }
                    }
                } catch (err) {
                    console.error(`Error searching in list ${url}:`, err);
                }
            }));
        }
        
        await Promise.allSettled(tasks);
        
        // Sort by score and get top results
        const results = allResults
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .slice(0, limit);
        
        // Apply same type filtering as search() does in adjustSearchResults
        return this.adjustSearchResults(results, opts, limit);
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
                    // Skip lists that are being updated
                    if (this.isListUpdating && this.isListUpdating(url)) {
                        return;
                    }
                    // Add null check for list and indexer to prevent TypeError
                    if (!this.lists[url] || !this.lists[url].indexer || !this.lists[url].indexer.db) {
                        return;
                    }
                    // ULTRA-OPTIMIZATION: Skip count() - go directly to find() with limit
                    const queryOpts = {
                        limit: Math.min(maxWorkingSetLimit - results.length, 50), // Smaller limit per database for faster results
                        streaming: false // Disable streaming for faster small queries
                    };
                    
                    // Allow non-indexed fields when withIconOnly is used (icon field is not indexed)
                    if (opts.withIconOnly) {
                        queryOpts.allowNonIndexed = true;
                    }
                    
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
            entries = StreamClassifier.filter(entries, 'live', opts.typeStrict === true);
            // livefmt is about format preference (HLS vs MPEG-TS), not stream type
            const livefmt = config.get('live-stream-fmt');
            switch (livefmt) {
                case 'hls':
                    entries = StreamClassifier.prioritizeExtensions(entries, ['m3u8'], []);
                    break;
                case 'mpegts':
                    entries = StreamClassifier.prioritizeExtensions(entries, ['ts', 'mts'], []);
                    break;
            }
        } else if (opts.type == 'vod') {
            // Filter for VOD entries using StreamClassifier
            // typeStrict determines if only clearly VOD or includes seems-vod
            entries = StreamClassifier.filter(entries, 'vod', opts.typeStrict === true);
            entries = StreamClassifier.prioritizeExtensions(entries, StreamClassifier.VIDEO_FORMATS, []);
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
    async groups(types, myListsOnly) {
        let groups = [], map = {};
        if (myListsOnly) {
            myListsOnly = config.get('lists').map(l => l[1]);
        }
        Object.keys(this.lists).forEach(url => {
            if (myListsOnly && !myListsOnly.includes(url))
                return;
            // Skip lists that are being updated
            if (this.isListUpdating && this.isListUpdating(url)) {
                return;
            }
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
        // Skip if list is being updated
        if (this.isListUpdating && this.isListUpdating(group.url)) {
            throw 'List is being updated';
        }
        const list = this.lists[group.url]
        if (!list) {
            throw 'List not loaded';
        }
        if (!list.index) {
            throw 'List index not available';
        }
        // Ensure indexer is ready before accessing the database
        if (list.indexer && typeof list.indexer.ready === 'function') {
            await list.indexer.ready()
        }

        if (!list.indexer || !list.indexer.db || list.indexer.db.destroyed) {
            throw 'List database not available';
        }

        const fetchEntries = async key => {
            const trimmedKey = (key || '').trim()

            const directMatches = await list.indexer.db.find({ group: trimmedKey })
            if (Array.isArray(directMatches) && directMatches.length) {
                return directMatches
            }

            return list.indexer.db.find({ groups: trimmedKey })
        }

        const desiredGroup = (group.group || '').trim()

        let entries = await fetchEntries(desiredGroup)
        if (!entries.length) {
            return []
        }

        entries = this.parentalControl.filter(entries, true);
        return this.tools.sort(entries);
    }
}

export default Index;
