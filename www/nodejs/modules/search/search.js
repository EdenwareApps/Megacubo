import { ucWords } from '../utils/utils.js'
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import lists from "../lists/lists.js";
import mega from "../mega/mega.js";
import pLimit from "p-limit";
import cloud from "../cloud/cloud.js";
import ytsr from 'ytsr'
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import { match, terms, sort, findSuggestions } from '../lists/tools.js';

class SearchTermsHistory {
    constructor() {
        this.key = 'search-terms-history';
        this.maxlength = 12;
    }
    async get() {
        let ret = await storage.get(this.key);
        if (!Array.isArray(ret)) {
            ret = [];
        }
        return ret;
    }
    add(tms) {
        if (Array.isArray(tms)) {
            tms = tms.join(' ');
        }
        this.get().then(vs => {
            vs = vs.filter(v => v != tms).slice((this.maxlength - 1) * -1);
            vs.push(tms);
            storage.set(this.key, vs, { expiration: true, personal: true });
        });
    }
    async terms() {
        let ret = await this.get();
        return ret.flat().unique();
    }
}
class Search extends EventEmitter {
    constructor(channels) {
        super();
        this.channels = channels
        this.history = new SearchTermsHistory();
        this.searchMediaType = 'all';
        this.searchInaccurate = true;
        this.searchStrict = false;
        this.searchSuggestions = [];
        this.currentSearchType = null;
        this.currentSearch = null;
        this.currentEntries = null;
        this.currentResults = [];
        this.resultsAmountLimit = 256;
        
        // Phase 2: Cache and settings for suggestions
        this.suggestionCache = new Map();
        this.validTermsCache = new Map();
        this.suggestionConfig = {
            maxSuggestions: 3,
            minSimilarityScore: 0.7,
            maxDistance: 2,
            enableSubstringSearch: true,
            cacheSize: 1000
        };
    }
    getMenuEntriesForLive() {
        if (this.currentSearchType != 'live') {
            this.currentSearchType = 'live';
            this.searchMediaType = 'live';
            this.currentEntries = null;
        }
        return new Promise((resolve, reject) => {
            if (this.currentEntries) {
                return resolve(this.currentEntries);
            }
            this.getPopularSearchTerms().then(es => {
                const { parentalControl } = lists;
                es = es.map(e => {
                    return {
                        name: ucWords(e.search_term),
                        fa: 'fas fa-search'
                    };
                });
                es = es.map(e => this.channels.toMetaEntry(e, false));
                es = parentalControl.filter(es, true);
                es = this.withSearchActions(this.currentSearchType, es);
                resolve(es);
            }).catch(err => {
                console.error(err);
                resolve(es || []);
            });
        });
    }
    getMenuEntriesForAll() {
        if (this.currentSearchType != 'all') {
            this.currentSearchType = 'all';
            this.searchMediaType = 'all';
            this.currentEntries = null;
        }
        return new Promise((resolve, reject) => {
            if (this.currentEntries) {
                return resolve(this.currentEntries);
            }
            resolve(this.withSearchActions(this.currentSearchType, []));
        });
    }

    /**
     * Merges a layer's results into allResults: deduplicates by url/name, limits to remaining slots,
     * mutates allResults and searchSources. Used by fetchSearchResults.
     */
    mergeLayerResults(allResults, searchSources, newItems, sourceLabel, { excludeUrls } = {}) {
        if (!newItems || newItems.length === 0) return 0;
        const unique = newItems.filter(
            item => !allResults.some(ex => ex.url === item.url || ex.name === item.name) &&
                (!excludeUrls || !excludeUrls.has(item.url))
        );
        const remaining = this.resultsAmountLimit - allResults.length;
        const toAdd = unique.slice(0, remaining);
        if (toAdd.length > 0) {
            allResults.push(...toAdd);
            searchSources.push(`${sourceLabel}: ${toAdd.length}`);
        }
        return toAdd.length;
    }

    /**
     * Fetches search results from all layers (live, EPG, lists+YouTube, suggestions).
     * Returns { results, searchSources }. No UI side effects.
     */

    async fetchSearchResults(value, mediaType, excludeUrls) {
        const allResults = [];
        const searchSources = [];

        if (mediaType === 'live') {
            console.log('🔍 Layer 1: Searching live channels...');
            const live = await this.fetchLiveResults(value).catch(e => {
                console.warn('Live search failed:', e);
                return [];
            });
            this.mergeLayerResults(allResults, searchSources, live, 'Live', { excludeUrls });
        }

        if (allResults.length < this.resultsAmountLimit && mediaType === 'live') {
            console.log('🔍 Layer 2: Searching EPG...');
            const epg = await this.channels.epgSearch(value).catch(e => {
                console.warn('EPG search failed:', e);
                return [];
            });
            this.mergeLayerResults(allResults, searchSources, epg, 'EPG', { excludeUrls });
        }

        if (allResults.length < this.resultsAmountLimit) {
            console.log('🔍 Layer 3: Searching all content...');
            const allContent = await this.searchListsAndUpdateState(value, { type: mediaType, group: mediaType === 'all' }, excludeUrls).catch(e => {
                console.warn('All search failed:', e);
                return [];
            });
            this.mergeLayerResults(allResults, searchSources, allContent, 'All', { excludeUrls });
        }

        if (allResults.length < this.resultsAmountLimit && allResults.length < 20) {
            console.log('🔍 Layer 4: Adding suggestions...');
            const suggestions = await this.getResultsWithQuerySuggestions(value, { mediaType }).catch(e => {
                console.warn('Suggestions failed:', e);
                return [];
            });
            this.mergeLayerResults(allResults, searchSources, suggestions, 'Suggestions', {});
        }

        console.log(`🎯 Final results: ${allResults.length}/${this.resultsAmountLimit} (sources: ${searchSources.join(', ')})`);
        if (!allResults.length) {
            allResults.push({
                name: lang.NO_RESULTS_FOUND,
                details: lang.TRY_DIFFERENT_TERMS,
                type: 'info',
                fa: 'fas fa-info-circle',
                prepend: '<i class="fas fa-info-circle"></i> '
            });
        }
        return { results: allResults, searchSources };
    }

    async runSearch(value, mediaType, excludeUrls) {
        if (!value) return false;
        if (!mediaType) mediaType = 'all';

        osd.show(lang.SEARCHING, 'fas fa-search busy-x', 'search', 'persistent');

        try {
            const { results, searchSources } = await this.fetchSearchResults(value, mediaType, excludeUrls);

            osd.hide('search');
            this.emit('search', { query: value });
            if (!menu.path) menu.path = lang.SEARCH;

            menu.render(this.withSearchActions(mediaType, results, excludeUrls), menu.path, {
                icon: 'fas fa-search',
                backTo: '/'
            });

            if (results.length > 0) {
                osd.show(lang.X_RESULTS.format(results.length), 'fas fa-check-circle', 'search', 'short');
            } else {
                osd.show(lang.NO_RESULTS_FOUND, 'fas fa-info-circle', 'search', 'normal');
            }

            this.history.add(value);
            return true;
        } catch (err) {
            console.error('Search error:', err);
            osd.hide('search');
            menu.displayErr(err);
            return false;
        }
    }

    rerunSearch() {
        if (this.currentSearch) {
            this.runSearch(this.currentSearch.name, this.currentSearchType);
        }
    }
    getMediaTypeLabel() {
        let type = String(this.searchMediaType).toUpperCase();
        if (typeof(lang[type]) == 'string') {
            type = lang[type];
        }
        return type;
    }
    withSearchActions(mediaType, es) {
        es.unshift({
            name: lang.NEW_SEARCH,
            details: this.getMediaTypeLabel(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);
                this.runSearch(value, mediaType);
            },
            value: () => {
                return this.getCurrentQuery();
            },
            placeholder: lang.SEARCH_PLACEHOLDER
        });
        if (this.currentSearch && es.length >= this.resultsAmountLimit) {
            if (mediaType == 'live') {
                es.push({
                    name: lang.MORE_RESULTS,
                    details: lang.SEARCH_MORE,
                    type: 'action',
                    fa: 'fas fa-search-plus',
                    action: async () => {
                        this.runSearch(this.currentSearch.name, 'all', new Set(es.map(e => e.url)))
                    }
                });
            }
        }
        return es;
    }
    
    // Phase 2: Methods for cache and suggestions
    async getIndexedTermsForList(listUrl) {
        if (this.validTermsCache.has(listUrl)) {
            return this.validTermsCache.get(listUrl);
        }
        
        try {
            const list = lists.lists[listUrl];
            if (list && list.indexer && list.indexer.db) {
                const nameTerms = list.indexer.db.indexManager.readColumnIndex('nameTerms');
                const groupTerms = list.indexer.db.indexManager.readColumnIndex('groupTerms');
                
                // Combine unique terms
                const allTerms = new Set([...nameTerms, ...groupTerms]);
                this.validTermsCache.set(listUrl, allTerms);
                
                // Limit cache if necessary
                if (this.validTermsCache.size > this.suggestionConfig.cacheSize) {
                    const firstKey = this.validTermsCache.keys().next().value;
                    this.validTermsCache.delete(firstKey);
                }
                
                return allTerms;
            }
        } catch (err) {
            console.warn('Error getting valid terms for list:', err);
        }
        
        return new Set();
    }
    
    async getIndexedTermsFromAllLists() {
        const allTerms = new Set();
        
        for (const [url, list] of Object.entries(lists.lists || {})) {
            try {
                const terms = await this.getIndexedTermsForList(url);
                terms.forEach(term => allTerms.add(term));
            } catch (err) {
                console.warn('Error getting terms from list:', url, err);
            }
        }
        
        return allTerms;
    }
    
    getSuggestionsFromCache(searchTerm) {
        return this.suggestionCache.get(searchTerm.toLowerCase());
    }

    setSuggestionsCache(searchTerm, suggestions) {
        // Limitar tamanho do cache
        if (this.suggestionCache.size >= this.suggestionConfig.cacheSize) {
            const firstKey = this.suggestionCache.keys().next().value;
            this.suggestionCache.delete(firstKey);
        }
        
        this.suggestionCache.set(searchTerm.toLowerCase(), suggestions);
    }
    
    async getQuerySuggestions(searchTerm) {
        const cached = this.getSuggestionsFromCache(searchTerm);
        if (cached) return cached;

        try {
            const validTerms = await this.getIndexedTermsFromAllLists();
            let suggestions = findSuggestions(searchTerm, validTerms, this.suggestionConfig);
            if (suggestions.length === 0 && searchTerm.includes(' ')) {
                suggestions = await this.getWordCorrectionSuggestions(searchTerm, validTerms);
            }
            this.setSuggestionsCache(searchTerm, suggestions);
            return suggestions;
        } catch (err) {
            console.warn('Error finding suggestions:', err);
            return [];
        }
    }
    
    async getWordCorrectionSuggestions(searchTerm, validTerms) {
        const words = searchTerm.split(' ');
        const suggestions = [];
        
        // For each word in the search, try to find corrections
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            
            // Search suggestions for this specific word
            const wordSuggestions = findSuggestions(word, validTerms, {
                ...this.suggestionConfig,
                maxSuggestions: 3
            });
            
            // For each word suggestion, create a complete phrase suggestion
            for (const wordSuggestion of wordSuggestions) {
                const correctedWords = [...words];
                correctedWords[i] = wordSuggestion.term;
                const correctedPhrase = correctedWords.join(' ');
                
                // Verify corrected phrase is not identical to original
                if (correctedPhrase.toLowerCase() !== searchTerm.toLowerCase()) {
                    suggestions.push({
                        score: wordSuggestion.score * 0.8, // Slightly penalize for being partial correction
                        term: correctedPhrase,
                        distance: wordSuggestion.distance,
                        originalWord: word,
                        correctedWord: wordSuggestion.term
                    });
                }
            }
        }
        
        // Sort by score and remove duplicates
        const uniqueSuggestions = [];
        const seenTerms = new Set();
        
        suggestions
            .sort((a, b) => b.score - a.score)
            .forEach(suggestion => {
                if (!seenTerms.has(suggestion.term.toLowerCase())) {
                    seenTerms.add(suggestion.term.toLowerCase());
                    uniqueSuggestions.push(suggestion);
                }
            });
        
        return uniqueSuggestions.slice(0, this.suggestionConfig.maxSuggestions);
    }
    
    async getResultsWithQuerySuggestions(terms, options = {}) {
        // 1. Try normal search first
        let results = await this.searchLists(terms, options);
        
        // 2. If no results found, search for suggestions
        if (results.length === 0) {
            const suggestions = await this.getQuerySuggestions(terms);
            
            if (suggestions.length > 0) {
                // 3. Add main suggestion entry
                const mainSuggestion = suggestions[0];
                const suggestionEntry = {
                    name: lang.DID_YOU_MEAN.format(mainSuggestion.term),
                    details: mainSuggestion.originalWord ? 
                        `"${mainSuggestion.originalWord}" → "${mainSuggestion.correctedWord}"` : 
                        `Score: ${(mainSuggestion.score * 100).toFixed(1)}%`,
                    type: 'action',
                    action: () => this.runSearch(mainSuggestion.term, options.mediaType || this.searchMediaType),
                    fa: 'fas fa-lightbulb',
                    prepend: '<i class="fas fa-lightbulb"></i> '
                };
                
                results.unshift(suggestionEntry);
                
                // 4. Add other suggestions if they exist
                for (let i = 1; i < Math.min(suggestions.length, this.suggestionConfig.maxSuggestions); i++) {
                    const suggestion = suggestions[i];
                    results.push({
                        name: lang.OR_MAYBE.format(suggestion.term),
                        details: suggestion.originalWord ? 
                            `"${suggestion.originalWord}" → "${suggestion.correctedWord}"` : 
                            `Score: ${(suggestion.score * 100).toFixed(1)}%`,
                        type: 'action',
                        action: () => this.runSearch(suggestion.term, options.mediaType || this.searchMediaType),
                        fa: 'fas fa-lightbulb',
                        prepend: '<i class="fas fa-lightbulb"></i> '
                    });
                }
            }
        }
        
        return results;
    }
    
    async findMatchingGroups(tms) {
        if (!Array.isArray(tms)) {
            tms = terms(tms)
        }
        const map = {}, entries = []        
        const es = await this.searchLists(tms, {groupsOnly: true})
        for (const e of es) {
            if (!Array.isArray(e.groupTerms) || !e.groupTerms.length || !match(tms, e.groupTerms)) {
                continue;
            }
            if (typeof(map[e.source]) == 'undefined') {
                map[e.source] = {};
            }
            if (typeof(map[e.source][e.groupName]) == 'undefined') {
                map[e.source][e.groupName] = {};
            }
        }
        for (const url of Object.keys(map)) {
            for (const name of Object.keys(map[url])) {
                entries.push({ name, type: 'group', renderer: () => lists.group({group: name, url}) });
            }
        }
        return sort(entries)
    }
    async searchLists(tms, atts = {}, excludeUrls) {        
        // Normalize terms to array for consistency
        if (typeof tms === 'string') {
            tms = terms(tms);
        }
        
        // Parental control is always active (block behavior)
        const parentalControlActive = true;
        const isAdultQueryBlocked = !lists.parentalControl.allow(tms);
        const opts = {
            partial: this.searchInaccurate,
            type: this.searchMediaType,
            typeStrict: this.searchStrict,
            group: this.searchMediaType != 'live',
            parentalControl: false // Always filter blocked results
        };
        Object.assign(opts, atts);
        if (typeof(opts.limit) != 'number') {
            opts.limit = 256
        }
        if (excludeUrls) {
            opts.limit += excludeUrls.size
        }
        console.log('will search', tms, opts);
        let es = await lists.search(tms, opts);
        console.log('has searched', es.length, {terms: tms, parentalControlActive, isAdultQueryBlocked, excludeUrls});
        if (excludeUrls) {
            es = es.filter(e => !excludeUrls.has(e.url));
        }
        if (isAdultQueryBlocked) {
            es = [
                {
                    prepend: '<i class="fas fa-info-circle"></i> ',
                    name: lang.X_BLOCKED_RESULTS.format(es.length || 'X'),
                    details: lang.ADULT_CONTENT_BLOCKED,
                    fa: 'fas fa-lock',
                    type: 'action',
                    action: () => {
                        menu.info(lang.ADULT_CONTENT_BLOCKED, lang.ADULT_CONTENT_BLOCKED_INFO.format(lang.OPTIONS, lang.ADULT_CONTENT));
                    }
                }
            ];
        } else {
            this.currentResults = es.slice(0)
            const minResultsWanted = 256
            let ys = [];
            if (config.get('search-youtube') && es.length < minResultsWanted) {
                // Parallelize YouTube search with lists search (though lists.search is already done, but for future optimization)
                ys = await this[this.searchMediaType == 'live' ? 'fetchYouTubeLive' : 'fetchYouTubeVideos'](terms).catch(err => console.error(err));
            }
            Array.isArray(ys) && es.push(...ys)
            // Conditionally apply parental filter only if opts.parentalControl is true
            if (opts.parentalControl && es.length) {
                es = lists.parentalControl.filter(es);
            }
        }
        console.log('search: results finished', es);
        return es;
    }
    async searchListsAndUpdateState(terms, opts = {}, excludeUrls) {
        let u = ucWords(terms);
        this.currentSearch = {
            name: u,
            url: mega.build(u, { terms, mediaType: this.searchMediaType })
        };
        
        const es = await this.searchLists(terms, opts, excludeUrls);
        renderer.ui.emit('current-search', terms, this.searchMediaType);
        if (!lists.loaded(true)) {
            if (paths.ALLOW_ADDING_LISTS) {
                return [lists.manager.noListsEntry()];
            }
            return [];
        }
        return es;
    }
    sanitizeYouTubeTitle(name) {
        return name.replaceAll('/', '|');
    }
    async fetchYouTubeVideos(tms) {
        if (!tms) return [];
        if (typeof tms === 'string') tms = [tms];
        if (!Array.isArray(tms) || !tms.length) return [];
        let terms = tms.join(' ').trim();
        if (!terms) return [];
        try {
            const filters = await ytsr.getFilters(terms);
            const filter = filters.get('Type')?.get('Videos'); // Changed 'Video' to 'Videos'
            if (!filter || !filter.url) return [];
            const options = {
                pages: 2,
                gl: lang.countryCode.toUpperCase(),
                hl: lang.locale,
                requestOptions: {
                    rejectUnauthorized: false,
                    transform: (parsed) => {
                        return Object.assign(parsed, {
                            rejectUnauthorized: false
                        });
                    }
                }
            };
            const results = await ytsr(filter.url, options);
            return results.items.filter(t => t && !t.isLive && t.url).map(t => {
                let icon = t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined;
                return {
                    name: this.sanitizeYouTubeTitle(t.title),
                    icon,
                    type: 'stream',
                    url: t.url
                };
            });
        } catch (err) {
            console.error('YouTube videos search error:', err);
            return [];
        }
    }
    async fetchYouTubeLive($tms) {        
        if (!$tms) return [];
        if (typeof $tms === 'string') $tms = [$tms];
        if (!Array.isArray($tms) || !$tms.length) return [];
        let tms = $tms.join(' ').trim();
        if (!tms) return [];
        tms += ' (' + lang.LIVE + ' OR 24h)'
        console.warn('YTSEARCH', tms);
        try {
            const filters = await ytsr.getFilters(tms);
            const filter = filters.get('Type')?.get('Videos'); // Changed 'Video' to 'Videos'
            if (!filter || !filter.url) return [];
            const filters2 = await ytsr.getFilters(filter.url);
            const features = filters2.get('Features');
            if (!features) return [];
            const filter2 = features.get('Live');
            if (!filter2 || !filter2.url) return [];
            const options = {
                pages: 1,
                gl: lang.countryCode.toUpperCase(),
                hl: lang.locale,
                requestOptions: {
                    rejectUnauthorized: false,
                    transform: (parsed) => {
                        return Object.assign(parsed, {
                            rejectUnauthorized: false
                        });
                    }
                }
            };
            const results = await ytsr(filter2.url, options);
            return results.items.map(t => this.channels.toMetaEntry({
                name: this.sanitizeYouTubeTitle(t.title),
                icon: t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined,
                type: 'stream',
                url: t.url
            }));
        } catch (err) {
            console.error('YouTube live search error:', err);
            return [];
        }
    }
    async fetchLiveResults($terms) {        
        if (!Array.isArray($terms)) {
            $terms = terms($terms)
        }
        let u = ucWords($terms.join(' '))
        this.currentSearch = {
            name: u,
            url: mega.build(u, { terms: $terms, mediaType: this.searchMediaType })
        }        
        if (!lists.loaded()) {
            return [
                lists.manager.updatingListsEntry()
            ]
        }

        let es = await this.channels.searchChannels($terms, this.searchInaccurate)
        es = es.map(e => this.channels.toMetaEntry(e))

        const gs = await this.findMatchingGroups($terms)
        es.push(...gs)

        const minResultsWanted = 256
        if (config.get('search-youtube') && es.length < minResultsWanted) {
            let ys = await this.fetchYouTubeLive($terms).catch(err => console.error(err));
            if (Array.isArray(ys)) {
                es.push(...ys.slice(0, minResultsWanted - es.length));
            }
        }
        if (paths.ALLOW_ADDING_LISTS && !lists.loaded(true)) {
            es.unshift(lists.manager.noListsEntry());
        }
        return es;
    }
    isSearching() {
        return menu.currentEntries.some(e => {
            return e.name == lang.SEARCH || e.name == lang.NEW_SEARCH;
        });
    }
    findMatchingTermInSuggestions(nlc, precision, es) {
        let term = false;
        if (es.length) {
            es.forEach(t => {
                if (nlc.includes(t.search_term)) {
                    if (!term || (precision ? term.length < t.search_term.length : term.length > t.search_term.length)) {
                        term = t.search_term;
                    }
                }
            });
        }
        return term;
    }
    getQueryFromEntry(entry, precision, searchSugEntries) {
        return new Promise((resolve, reject) => {
            let name = entry.originalName || entry.name;
            if (typeof name !== 'string') {
                return resolve(false);
            }
            let nlc = name.toLowerCase();
            if (Array.isArray(searchSugEntries)) {
                resolve(this.findMatchingTermInSuggestions(nlc, precision, searchSugEntries));
            } else {
                this.getPopularSearchTerms().then(es => {
                    resolve(this.findMatchingTermInSuggestions(nlc, precision, es));
                }).catch(e => {
                    console.error(e);
                    resolve(false);
                });
            }
        });
    }
    async getPopularSearchTerms(removeAliases, countryOnly) {
        const limit = pLimit(3);
        const ignoreKeywords = new Set(['tv', 'hd', 'sd'])
        let ret = {}, locs = await lang.getActiveCountries()
        if (countryOnly && locs.includes(lang.countryCode)) {
            locs = [lang.countryCode];
        }
        const tasks = locs.map(loc => {
            return async () => {
                const data = await cloud.get('searches/' + loc)
                data.forEach(row => {
                    if (ignoreKeywords.has(row.search_term))
                        return;
                    let count = parseInt(row.cnt);
                    if (typeof(ret[row.search_term]) != 'undefined')
                        count += ret[row.search_term];
                    ret[row.search_term] = count;
                });
            };
        }).map(limit);
        await Promise.allSettled(tasks);
        ret = Object.keys(ret).filter(search_term => {
            return global.lists.parentalControl.allow(search_term)
        }).map(search_term => {
            return {
                search_term,
                cnt: ret[search_term]
            }
        });
        if (countryOnly && !ret.length) {
            return this.getPopularSearchTerms(removeAliases, false);
        }
        if (removeAliases === true) {
            ret = this.mergeSuggestionAliasesByCount(ret).sortByProp('cnt', true);
        }
        return ret;
    }
    isSuggestionTermAlias(a, b) {
        return (a != b && (a.substr(b.length * -1) == b || (a.includes(b) && a.length <= (b.length + 3))));
    }
    getSuggestionAliasesMap(o) {
        let aliases = {};
        if (o.length) {
            let s = o.slice(0);
            if (typeof(s[0]) == 'object') {
                s = s.map(t => {
                    return t.search_term;
                });
            }
            s.forEach((k, i) => {
                s.forEach(t => {
                    if (this.isSuggestionTermAlias(t, k)) {
                        if (typeof(aliases[k]) == 'undefined') {
                            aliases[k] = [];
                        }
                        aliases[k].push(t);
                    }
                });
            });
        }
        return aliases;
    }
    filterSuggestionAliases(s) {
        if (s.length) {
            let aliases = this.getSuggestionAliasesMap(s);
            s = s.filter(v => {
                let keep = true;
                Object.keys(aliases).some(k => {
                    if (aliases[k].includes(v)) {
                        keep = false;
                        return true;
                    }
                });
                return keep;
            });
        }
        return s;
    }
    mergeSuggestionAliasesByCount(s) {
        if (s.length) {
            let aliases = this.getSuggestionAliasesMap(s), cnts = {};
            s = s.filter((o, i) => {
                let keep = true;
                if (typeof(o.cnt) != 'number') {
                    o.cnt = parseInt(o.cnt);
                }
                Object.keys(aliases).some(k => {
                    if (aliases[k].includes(o.search_term)) {
                        let rem = s.some((t, j) => {
                            if (t.search_term == k) {
                                s[j].cnt = parseInt(s[j].cnt) + o.cnt;
                                return true;
                            }
                        });
                        if (rem) {
                            keep = false;
                        }
                    }
                });
                return keep;
            });
        }
        return s;
    }
    getCurrentQuery() {
        let def = '';
        if (this.currentSearch) {
            def = this.currentSearch.name;
        }
        return def;
    }
    getSearchEntry(mediaType = 'live') {
        this.searchMediaType = mediaType;
        /*
        return {
            name: lang.SEARCH,
            details: this.getMediaTypeLabel(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);
                this.runSearch(value, mediaType);
            },
            value: () => {
                return this.getCurrentQuery();
            },
            placeholder: lang.SEARCH_PLACEHOLDER
        };
        */
        return {
            name: lang.SEARCH,
            details: this.getMediaTypeLabel(),
            type: 'action',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);                
                renderer.ui.emit('omni-show');
            }
        };
    }
    async getMenuHook(entries, path) {
        if (lists.loaded() && lists.activeLists.length) {
            if (path == lang.LIVE) {
                entries.unshift(this.getSearchEntry('live'));
            } else if (lang.CATEGORY_MOVIES_SERIES == path) {
                entries.unshift(this.getSearchEntry('all'));
            }
        }
        return entries
    }
}
export default Search;
