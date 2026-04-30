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
        // Track lists with temporary issues to skip until recovered
        this.listErrorCounts = new Map();
        this.listBadUntil = new Map();
    }
    optimizeSearchOpts(opts) {
        let nopts = {};
        Object.keys(this.defaultsSearchOpts).forEach(k => {
            nopts[k] = opts[k] ? opts[k] : undefined;
        });
        return nopts;
    }

    normalizeTerms(terms) {
        if (!Array.isArray(terms)) return [];
        return [...terms].slice().sort();
    }

    normalizeOptions(options) {
        const normalizeValue = value => {
            if (Array.isArray(value)) {
                return [...value].map(normalizeValue).sort((a, b) => {
                    const sa = JSON.stringify(a);
                    const sb = JSON.stringify(b);
                    if (sa < sb) return -1;
                    if (sa > sb) return 1;
                    return 0;
                });
            }
            if (value && typeof value === 'object') {
                const normalized = {};
                Object.keys(value).sort().forEach(k => {
                    normalized[k] = normalizeValue(value[k]);
                });
                return normalized;
            }
            return value;
        };

        const normalized = {};
        Object.keys(options).sort().forEach(k => {
            normalized[k] = normalizeValue(options[k]);
        });
        return normalized;
    }

    makeHasCacheKey(criteriaArray) {
        return criteriaArray
            .map(c => {
                const options = c.options ? Object.assign({}, c.options) : {};
                return JSON.stringify({
                    id: c.id,
                    field: c.field,
                    terms: this.normalizeTerms(c.terms),
                    options: this.normalizeOptions(options)
                });
            })
            .sort()
            .join('|');
    }

    makeHasTermKey(term, opts) {
        const options = Object.assign({}, opts, term.options || {});
        return JSON.stringify({
            name: term.name,
            field: term.field || 'nameTerms',
            terms: this.normalizeTerms(term.terms),
            options: this.normalizeOptions(options)
        });
    }

    makeHasQueryKey(terms, opts) {
        const normalized = terms.map(term => {
            const options = Object.assign({}, opts, term.options || {});
            return {
                name: term.name,
                terms: this.normalizeTerms(Array.isArray(term.terms) ? term.terms : this.tools.terms(term.terms)),
                options: this.normalizeOptions(options)
            };
        }).sort((a, b) => a.name.localeCompare(b.name));
        return JSON.stringify(normalized);
    }

    getPerListCache(url, termKey) {
        if (!this.hasCachePerList.has(url)) return undefined;
        const listCache = this.hasCachePerList.get(url);
        return listCache.get(termKey);
    }

    setPerListCache(url, termKey, result) {
        let listCache = this.hasCachePerList.get(url);
        if (!listCache) {
            listCache = new Map();
            this.hasCachePerList.set(url, listCache);
        }
        listCache.set(termKey, result);
    }

    async has(terms, opts) {
        if (!terms.length) return {};
        if (!opts) opts = {};

        const queryKey = this.makeHasQueryKey(terms, opts);
        const cached = this.hasCache.get(queryKey);
        if (cached && (Date.now() - cached.timestamp) <= this.hasCacheTTL) {
            return Object.assign({}, cached.value);
        }

        const results = {};
        const listUrls = Object.keys(this.lists).sort((a, b) => {
            return this.lists[b].length - this.lists[a].length;
        });
        let remainingNames = new Set(terms.map(t => t.name));
        for (const url of listUrls) {
            if (remainingNames.size === 0) break; // early exit global
            const list = this.lists[url];
            if (!list || !list.indexer || !list.indexer.db) continue;
            if (this.isListUpdating && this.isListUpdating(url)) continue;
            if (this._isBadList && this._isBadList(url)) continue;
            // Só consulta termos ainda não encontrados
            const criteriaArray = terms.filter(term => remainingNames.has(term.name)).map(term => {
                const arrTerms = Array.isArray(term.terms) ? term.terms : this.tools.terms(term.terms);
                const excludes = arrTerms.filter(t => t.startsWith('-')).map(t => t.substr(1));
                const filteredTerms = arrTerms.filter(t => !t.startsWith('-'));
                const options = Object.assign({}, opts, term.options || {});
                if (excludes.length > 0) options.excludes = excludes;
                if (!opts.partial) options.$all = true;
                return {
                    id: term.name,
                    field: 'nameTerms',
                    terms: filteredTerms,
                    options
                };
            });
            if (criteriaArray.length === 0) continue;
            try {
                const db = list.indexer.db;
                if (!db.multiExists) continue;

                const uncached = [];
                for (const criterion of criteriaArray) {
                    const termKey = this.makeHasTermKey(criterion, opts);
                    const cachedValue = this.getPerListCache(url, termKey);
                    if (typeof cachedValue !== 'undefined') {
                        if (cachedValue) {
                            results[criterion.id] = true;
                            remainingNames.delete(criterion.id);
                        } else if (!(criterion.id in results)) {
                            results[criterion.id] = false;
                        }
                    } else {
                        uncached.push({ criterion, termKey });
                    }
                }

                let res = {};
                if (uncached.length > 0) {
                    const queryArray = uncached.map(item => item.criterion);
                    res = await db.multiExists(queryArray);
                    for (const item of uncached) {
                        const value = !!res[item.criterion.id];
                        this.setPerListCache(url, item.termKey, value);
                    }
                }

                for (const [k, v] of Object.entries(res)) {
                    if (v) {
                        results[k] = true;
                        remainingNames.delete(k);
                    } else if (!(k in results)) {
                        results[k] = false;
                    }
                }
            } catch (e) {
                // erro na lista, ignora
            }
        }
        this.hasCache.set(queryKey, { timestamp: Date.now(), value: Object.assign({}, results) });
        this.cleanupCache && this.cleanupCache();
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
        this.hasCache && this.hasCache.clear();
        this.listErrorCounts && this.listErrorCounts.delete(url);
        this.listBadUntil && this.listBadUntil.delete(url);
    }

    _isBadList(url) {
        if (!this.listBadUntil) return false;
        const until = this.listBadUntil.get(url);
        return !!(until && Date.now() < until);
    }

    _recordListError(url) {
        if (!url) return;
        const count = (this.listErrorCounts.get(url) || 0) + 1;
        this.listErrorCounts.set(url, count);
        const label = url.split('/').pop().split('?')[0].substring(0, 40);
        if (count >= 3) {
            console.warn(`List ${url} failed ${count} times, unloading for reload`);
            this.listErrorCounts.delete(url);
            this.listBadUntil.delete(url);
            this.remove(url);
            if (global.osd) {
                global.osd.show('List failed: ' + label, 'fas fa-times-circle faclr-red', this._listOsdId(url), 'normal');
            }
        } else {
            const backoff = 30000 * count;
            console.warn(`List ${url} error #${count}, skipping for ${backoff / 1000}s`);
            this.listBadUntil.set(url, Date.now() + backoff);
        }
    }

    _listOsdId(url) {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            hash = ((hash << 5) - hash) + url.charCodeAt(i);
            hash |= 0;
        }
        return 'list-error-' + Math.abs(hash);
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
                    // When typeStrict=false, include seemsVOD OR null (unknown)
                    // Optimization: classify once and reuse the result
                    const classification = StreamClassifier.classify(entry);
                    return classification === 'vod' || classification === 'seems-vod' || classification === null;
                }
            } else if (opts.type === 'live') {
                if (opts.typeStrict === true) {
                    return StreamClassifier.clearlyLive(entry);
                } else {
                    // When typeStrict=false, include seemsLive OR null (unknown)
                    // Optimization: classify once and reuse the result
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
        } else {
            // Array already normalized (from search() with string input)
            // Filter stopWords from inclusion terms only (keep stopWords in exclusion terms)
            // Since nameTerms in index don't have stopWords, we filter them from search terms
            terms = this.tools.filterStopWords(terms, { removeStopWords: true, removeExcludes: false });
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
        // Remove duplicate excludes
        const uniqueExcludes = [...new Set(excludes)];
        const query = {}
        
        // Helper function to create exclude conditions
        const createExcludeConditions = (excludes, opts) => {
            const excludeConditions = [];
            const excludeRegexes = [];
            
            // Optimize: combine all excludes into single $nin conditions instead of multiple $and conditions
            // This is more efficient and avoids potential issues with multiple $and conditions
            if (excludes.length > 0) {
                // Create single condition: entry does NOT have any exclude in nameTerms AND NOT in groupTerms
                const excludeCondition = {
                    $and: [
                        // nameTerms doesn't contain any exclude
                        { nameTerms: { $nin: excludes } },
                        // groupTerms doesn't contain any exclude (only if field exists - JexiDB handles missing fields)
                        { groupTerms: { $nin: excludes } }
                    ]
                };
                
                excludeConditions.push(excludeCondition);
                
                // Create regexes for post-processing filter (name field)
                for (const exclude of excludes) {
                    const escapedExclude = exclude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const regexPattern = opts.partial ? escapedExclude : `\\b${escapedExclude}\\b`;
                    const excludeRegex = new RegExp(regexPattern, 'i');
                    excludeRegexes.push(excludeRegex);
                }
            }
            
            return { excludeConditions, excludeRegexes };
        };
        
        // Helper function to create search conditions for nameTerms and optionally groupTerms
        const createSearchConditions = (terms, useGroup = false, isPartial = false, excludes = []) => {
            let searchCondition;
            
            if (terms.length === 1) {
                const term = terms[0];
                
                if (isPartial) {
                    // Partial match - include both exact and partial
                    if (useGroup) {
                        searchCondition = {
                            $or: [
                                { nameTerms: term }, // exact
                                { nameTerms: new RegExp(term, 'i') }, // partial
                                { groupTerms: term }, // exact group
                                { groupTerms: new RegExp(term, 'i') } // partial group
                            ]
                        };
                    } else {
                        searchCondition = {
                            $or: [
                                { nameTerms: term }, // exact
                                { nameTerms: new RegExp(term, 'i') } // partial
                            ]
                        };
                    }
                } else {
                    // Exact match - use direct equality (fastest)
                    if (useGroup) {
                        searchCondition = {
                            $or: [
                                { nameTerms: term },
                                { groupTerms: term }
                            ]
                        };
                    } else {
                        searchCondition = { nameTerms: term };
                    }
                }
            } else {
                // Multiple terms - for partial search, include both exact and partial combinations
                // For exact search, use $all for AND behavior
                if (isPartial) {
                    // For partial with multiple terms, include exact $all and partial $and
                    const exactNameCondition = { nameTerms: { $all: terms } };
                    const partialNameConditions = terms.map(term => ({ nameTerms: new RegExp(term, 'i') }));
                    const partialNameCondition = { $and: partialNameConditions };
                    
                    if (useGroup) {
                        const exactGroupCondition = { groupTerms: { $all: terms } };
                        const partialGroupConditions = terms.map(term => ({ groupTerms: new RegExp(term, 'i') }));
                        const partialGroupCondition = { $and: partialGroupConditions };
                        
                        searchCondition = {
                            $or: [
                                exactNameCondition,
                                partialNameCondition,
                                exactGroupCondition,
                                partialGroupCondition
                            ]
                        };
                    } else {
                        searchCondition = {
                            $or: [
                                exactNameCondition,
                                partialNameCondition
                            ]
                        };
                    }
                } else {
                    // Exact match - use $all for AND behavior (more specific results)
                    if (useGroup) {
                        searchCondition = {
                            $or: [
                                { nameTerms: { $all: terms } },
                                { groupTerms: { $all: terms } }
                            ]
                        };
                    } else {
                        searchCondition = { nameTerms: { $all: terms } };
                    }
                }
            }
            
            // Apply excludes to this search condition if any
            if (excludes.length > 0) {
                const { excludeConditions } = createExcludeConditions(excludes, { partial: isPartial });
                // Flatten $and conditions to avoid nested $and
                if (excludeConditions.length === 1) {
                    const excludeCondition = excludeConditions[0];
                    // If excludeCondition already has $and, merge its conditions
                    if (excludeCondition.$and) {
                        return {
                            $and: [
                                searchCondition,
                                ...excludeCondition.$and
                            ]
                        };
                    } else {
                        return {
                            $and: [
                                searchCondition,
                                excludeCondition
                            ]
                        };
                    }
                } else if (excludeConditions.length > 1) {
                    return {
                        $and: [
                            searchCondition,
                            ...excludeConditions
                        ]
                    };
                }
            }
            
            return searchCondition;
        };
        
        if (groups.length > 1) {
            // Multiple groups - apply excludes within each group
            // This ensures: (group1 AND excludes) OR (group2 AND excludes)
            // Filter out empty groups to avoid invalid queries
            const validGroups = groups.filter(g => g.length > 0);
            if (validGroups.length === 0) {
                // No valid groups, return empty query
                return { _empty: true };
            }
            if (validGroups.length === 1) {
                // Only one valid group, treat as single group
                const searchCondition = createSearchConditions(validGroups[0], opts.group, opts.partial, uniqueExcludes);
                Object.assign(query, searchCondition);
                
                // Store exclude regexes for post-processing filter (name field)
                if (uniqueExcludes.length > 0) {
                    const { excludeRegexes } = createExcludeConditions(uniqueExcludes, opts);
                    query._excludeRegexes = excludeRegexes;
                }
            } else {
                // Multiple valid groups
                const orConditions = validGroups.map(g => createSearchConditions(g, opts.group, opts.partial, uniqueExcludes));
                // Ensure $or has at least 2 conditions
                if (orConditions.length >= 2) {
                    query.$or = orConditions;
                } else if (orConditions.length === 1) {
                    // Only one condition, use it directly instead of $or
                    Object.assign(query, orConditions[0]);
                }
                
                // Store exclude regexes for post-processing filter (name field)
                if (uniqueExcludes.length > 0) {
                    const { excludeRegexes } = createExcludeConditions(uniqueExcludes, opts);
                    query._excludeRegexes = excludeRegexes;
                }
            }
        } else if (groups.length === 1) {
            // Single group - apply excludes to the group
            const searchCondition = createSearchConditions(groups[0], opts.group, opts.partial, uniqueExcludes);
            Object.assign(query, searchCondition);
            
            // Store exclude regexes for post-processing filter (name field)
            if (uniqueExcludes.length > 0) {
                const { excludeRegexes } = createExcludeConditions(uniqueExcludes, opts);
                query._excludeRegexes = excludeRegexes;
            }
        }
        
        // Add mediaType filtering for better performance when searching for live streams
        if (opts.type === 'live') {
            // Filter out VOD entries to improve search performance for live streams
            if (query.$and) {
                query.$and.push({ mediaType: { '!=': 'video' } });
            } else if (query.$or) {
                // When there's $or, we need to apply mediaType filter to each OR condition
                // This ensures: (group1 AND mediaType) OR (group2 AND mediaType)
                query.$or = query.$or.map(condition => {
                    if (condition.$and) {
                        condition.$and.push({ mediaType: { '!=': 'video' } });
                        return condition;
                    } else {
                        return {
                            $and: [condition, { mediaType: { '!=': 'video' } }]
                        };
                    }
                });
            } else if (query.nameTerms || Object.keys(query).length > 0) {
                // If query has other conditions, wrap everything in $and
                const originalQuery = { ...query };
                query.$and = [originalQuery, { mediaType: { '!=': 'video' } }];
                // Clean up the original conditions since they're now in $and
                if (originalQuery.nameTerms) delete query.nameTerms;
                // Only delete $not if it's at top level and not part of exclude conditions
                if (originalQuery.$not && !excludes.length) delete query.$not;
            } else {
                // If query is empty, just use mediaType condition
                query.mediaType = { '!=': 'video' };
            }
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
                // Only delete $not if it's at top level and not part of exclude conditions
                if (originalQuery.$not && !excludes.length) delete query.$not;
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
            console.warn('lists.search() map searching', ((Date.now() / 1000) - start) + 's (pre time)', JSON.stringify(query, null, 2));
        }
        
        // Check if query is empty (no valid groups)
        if (query._empty) {
            return [];
        }
        
        // Extract exclude regexes for post-processing filter (if any)
        const excludeRegexes = query._excludeRegexes || [];
        delete query._excludeRegexes; // Remove from query before database search
        
        // WORKAROUND: If query has $or with multiple conditions, execute each condition separately
        // This is needed because JexiDB may not handle $or correctly when one condition returns no results
        const queriesToExecute = [];
        if (query.$or && Array.isArray(query.$or) && query.$or.length > 1) {
            // Execute each $or condition separately and combine results
            for (const orCondition of query.$or) {
                const singleQuery = { ...query };
                delete singleQuery.$or;
                Object.assign(singleQuery, orCondition);
                queriesToExecute.push(singleQuery);
            }
        } else {
            // Single query, execute normally
            queriesToExecute.push(query);
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
            
            // Execute each query separately
            for (const queryToExecute of queriesToExecute) {
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
                        if (this._isBadList(url)) {
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
                        
                        const ret = await this.lists[url].indexer.db.find(queryToExecute, queryOpts)
                    
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
                    if (this.debug || error.message.includes('timeout')) {
                        console.warn(`Search error in ${url}:`, error.message);
                    }
                    if (error.message.includes('no such file') || error.message.includes('destroyed') || error.message.includes('closed')) {
                        this.remove(url);
                    } else if (error.message.includes('timeout')) {
                        this._recordListError(url);
                    }
                }
                }));
            }
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
        
        // CRITICAL: Post-process filtering for name field exclusions
        // Since $not with RegExp doesn't work reliably in JexiDB queries,
        // we filter results here based on excludeRegexes stored in query
        if (excludeRegexes.length > 0) {
            const filteredResults = results.filter(entry => {
                // Check if entry.name matches any exclude regex
                if (!entry.name) return true; // Keep entries without name
                for (const regex of excludeRegexes) {
                    if (regex.test(entry.name)) {
                        return false; // Exclude this entry
                    }
                }
                return true; // Keep this entry
            });
            
            return this.adjustSearchResults(filteredResults, opts, limit);
        }
        
        return this.adjustSearchResults(results, opts, limit)
    }
    adjustSearchResults(entries, opts, limit, sort = false) {
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
        const distributeDomains = config.get('commumnity-mode-lists-amount') > 0;
        if (distributeDomains) {
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
        } else {
            nentries = entries;
        }
        if (sort === true) {
            return this.tools.sort(nentries);
        }
        return nentries;
    }
    ext(file) {
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    }
    async groups(types, myListsOnly) {
        let groups = [], map = {};
        if (myListsOnly) {
            myListsOnly = config.get('lists').map(l => l[1]);
        }
        // Normalize types: accept array or single string; 'video' is alias for vod + series (index only has live/vod/series)
        const typeList = Array.isArray(types) ? types : (typeof types === 'string' ? [types] : []);
        const resolvedTypes = [];
        typeList.forEach(t => {
            if (t === 'video') {
                if (!resolvedTypes.includes('vod')) resolvedTypes.push('vod');
                if (!resolvedTypes.includes('series')) resolvedTypes.push('series');
            } else if (t && !resolvedTypes.includes(t)) {
                resolvedTypes.push(t);
            }
        });
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
            resolvedTypes.forEach(type => {
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
