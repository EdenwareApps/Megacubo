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
            storage.set(this.key, vs, { expiration: true });
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
        
        // Fase 2: Cache e configurações para sugestões
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
    entriesLive() {
        if (this.currentSearchType != 'live') {
            this.currentSearchType = 'live';
            this.searchMediaType = 'live';
            this.currentEntries = null;
        }
        return new Promise((resolve, reject) => {
            if (this.currentEntries) {
                return resolve(this.currentEntries);
            }
            this.searchSuggestionEntries().then(es => {
                const { parentalControl } = lists;
                es = es.map(e => {
                    return {
                        name: ucWords(e.search_term),
                        fa: 'fas fa-search'
                    };
                });
                es = es.map(e => this.channels.toMetaEntry(e, false));
                es = parentalControl.filter(es, true);
                es = this.addFixedEntries(this.currentSearchType, es);
                resolve(es);
            }).catch(err => {
                console.error(err);
                resolve(es || []);
            });
        });
    }
    entries() {
        if (this.currentSearchType != 'all') {
            this.currentSearchType = 'all';
            this.searchMediaType = 'all';
            this.currentEntries = null;
        }
        return new Promise((resolve, reject) => {
            if (this.currentEntries) {
                return resolve(this.currentEntries);
            }
            resolve(this.addFixedEntries(this.currentSearchType, []));
        });
    }
    async go(value, mediaType, excludeUrls) {
        if (!value)
            return false;
        if (!mediaType) {
            mediaType = 'all';
        }
        
        osd.show(lang.SEARCHING, 'fas fa-search busy-x', 'search', 'persistent');
        
        let allResults = [];
        let searchSources = [];
        
        try {
            // Estratégia de busca em camadas para maximizar resultados
            // Camada 1: Busca Live (sempre tentar primeiro)
            console.log('🔍 Layer 1: Searching live channels...');
            const liveResults = mediaType == 'live' ? await this.channelsResults(value).catch(e => {
                console.warn('Live search failed:', e);
                return [];
            }) : [];
            
            if (liveResults.length > 0) {
                allResults.push(...liveResults);
                searchSources.push(`Live: ${liveResults.length}`);
                console.log(`✅ Live results: ${liveResults.length}, Total: ${allResults.length}`);
            }
            
            // Continuar buscando até atingir o limite máximo
            if (allResults.length < this.resultsAmountLimit && mediaType == 'live') {
                console.log('🔍 Layer 2: Searching EPG...');
                const epgResults = await this.channels.epgSearch(value).catch(e => {
                    console.warn('EPG search failed:', e);
                    return [];
                });
                
                if (epgResults.length > 0) {
                    // FP: Evitar duplicatas entre live e EPG
                    const uniqueEpgResults = epgResults.filter(epgItem => 
                        !allResults.some(existingItem => 
                            existingItem.url === epgItem.url || existingItem.name === epgItem.name
                        )
                    );
                    
                    if (uniqueEpgResults.length > 0) {
                        // Limitar resultados se exceder o máximo
                        const remainingSlots = this.resultsAmountLimit - allResults.length;
                        const limitedEpgResults = uniqueEpgResults.slice(0, remainingSlots);
                        
                        allResults.push(...limitedEpgResults);
                        searchSources.push(`EPG: ${limitedEpgResults.length}`);
                        console.log(`✅ EPG results: ${limitedEpgResults.length}, Total: ${allResults.length}`);
                    }
                }
            }
            
            // Continuar buscando se ainda há espaço
            if (allResults.length < this.resultsAmountLimit) {
                console.log('🔍 Layer 3: Searching all content...');
                const allResults_search = await this.results(value, { type: mediaType, group: mediaType === 'all' }, excludeUrls).catch(e => {
                    console.warn('All search failed:', e);
                    return [];
                });
                
                if (allResults_search.length > 0) {
                    // FP: Evitar duplicatas
                    const uniqueAllResults = allResults_search.filter(allItem => 
                        !allResults.some(existingItem => 
                            existingItem.url === allItem.url || existingItem.name === allItem.name
                        ) && 
                        (!excludeUrls || !excludeUrls.has(allItem.url))
                    );
                    
                    if (uniqueAllResults.length > 0) {
                        // Limitar resultados se exceder o máximo
                        const remainingSlots = this.resultsAmountLimit - allResults.length;
                        const limitedAllResults = uniqueAllResults.slice(0, remainingSlots);
                        
                        allResults.push(...limitedAllResults);
                        searchSources.push(`All: ${limitedAllResults.length}`);
                        console.log(`✅ All results: ${limitedAllResults.length}, Total: ${allResults.length}`);
                    }
                }
            }
            
            // Adicionar sugestões se ainda há espaço e poucos resultados
            if (allResults.length < this.resultsAmountLimit && allResults.length < 20) {
                console.log('🔍 Layer 4: Adding suggestions...');
                const suggestions = await this.searchWithSuggestions(value, { mediaType }).catch(e => {
                    console.warn('Suggestions failed:', e);
                    return [];
                });
                
                if (suggestions.length > 0) {
                    // Limitar sugestões se exceder o máximo
                    const remainingSlots = this.resultsAmountLimit - allResults.length;
                    const limitedSuggestions = suggestions.slice(0, remainingSlots);
                    
                    allResults.push(...limitedSuggestions);
                    searchSources.push(`Suggestions: ${limitedSuggestions.length}`);
                    console.log(`✅ Suggestions: ${limitedSuggestions.length}, Total: ${allResults.length}`);
                }
            }
            
            // Finalizar busca
            osd.hide('search');
            
            console.log(`🎯 Final results: ${allResults.length}/${this.resultsAmountLimit} (sources: ${searchSources.join(', ')})`);
            
            // Emitir evento de busca
            this.emit('search', { query: value });
            
            // Configurar menu se necessário
            if (!menu.path) {
                menu.path = lang.SEARCH;
            }
            
            // Renderizar resultados
            const resultsCount = allResults.length;
            menu.render(this.addFixedEntries(mediaType, allResults, excludeUrls), menu.path, {
                icon: 'fas fa-search',
                backTo: '/'
            });
            
            // Mostrar notificação de resultados
            if (resultsCount > 0) {
                osd.show(lang.X_RESULTS.format(resultsCount), 'fas fa-check-circle', 'search', 'short');
            } else {
                osd.show(lang.NO_RESULTS_FOUND, 'fas fa-info-circle', 'search', 'normal');
            }
            
            // Adicionar ao histórico
            this.history.add(value);
            return true;
            
        } catch (err) {
            // Erro na busca
            console.error('Search error:', err);
            osd.hide('search');
            menu.displayErr(err);
            return false;
        }
    }
    refresh() {
        if (this.currentSearch) {
            this.go(this.currentSearch.name, this.currentSearchType);
        }
    }
    mediaTypeName() {
        let type = String(this.searchMediaType).toUpperCase();
        if (typeof(lang[type]) == 'string') {
            type = lang[type];
        }
        return type;
    }
    addFixedEntries(mediaType, es) {
        es.unshift({
            name: lang.NEW_SEARCH,
            details: this.mediaTypeName(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);
                this.go(value, mediaType);
            },
            value: () => {
                return this.defaultTerms();
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
                        this.go(this.currentSearch.name, 'all', new Set(es.map(e => e.url)))
                    }
                });
            }
        }
        return es;
    }
    
    // Fase 2: Métodos para cache e sugestões
    async getValidTermsForList(listUrl) {
        if (this.validTermsCache.has(listUrl)) {
            return this.validTermsCache.get(listUrl);
        }
        
        try {
            const list = lists.lists[listUrl];
            if (list && list.indexer && list.indexer.db) {
                const nameTerms = list.indexer.db.indexManager.readColumnIndex('nameTerms');
                const groupTerms = list.indexer.db.indexManager.readColumnIndex('groupTerms');
                
                // Combinar termos únicos
                const allTerms = new Set([...nameTerms, ...groupTerms]);
                this.validTermsCache.set(listUrl, allTerms);
                
                // Limitar cache se necessário
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
    
    async getAllValidTerms() {
        const allTerms = new Set();
        
        for (const [url, list] of Object.entries(lists.lists || {})) {
            try {
                const terms = await this.getValidTermsForList(url);
                terms.forEach(term => allTerms.add(term));
            } catch (err) {
                console.warn('Error getting terms from list:', url, err);
            }
        }
        
        return allTerms;
    }
    
    getCachedSuggestions(searchTerm) {
        return this.suggestionCache.get(searchTerm.toLowerCase());
    }
    
    setCachedSuggestions(searchTerm, suggestions) {
        // Limitar tamanho do cache
        if (this.suggestionCache.size >= this.suggestionConfig.cacheSize) {
            const firstKey = this.suggestionCache.keys().next().value;
            this.suggestionCache.delete(firstKey);
        }
        
        this.suggestionCache.set(searchTerm.toLowerCase(), suggestions);
    }
    
    async findSuggestionsForTerm(searchTerm) {
        // Verificar cache primeiro
        const cached = this.getCachedSuggestions(searchTerm);
        if (cached) {
            return cached;
        }
        
        try {
            const validTerms = await this.getAllValidTerms();
            
            // Estratégia 1: Buscar sugestões para a frase completa
            let suggestions = findSuggestions(searchTerm, validTerms, this.suggestionConfig);
            
            // Estratégia 2: Se não encontrou sugestões para a frase completa,
            // tentar corrigir palavras individuais na frase
            if (suggestions.length === 0 && searchTerm.includes(' ')) {
                suggestions = await this.findWordCorrectionSuggestions(searchTerm, validTerms);
            }
            
            // Cache das sugestões
            this.setCachedSuggestions(searchTerm, suggestions);
            
            return suggestions;
        } catch (err) {
            console.warn('Error finding suggestions:', err);
            return [];
        }
    }
    
    async findWordCorrectionSuggestions(searchTerm, validTerms) {
        const words = searchTerm.split(' ');
        const suggestions = [];
        
        // Para cada palavra na busca, tentar encontrar correções
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            
            // Buscar sugestões para esta palavra específica
            const wordSuggestions = findSuggestions(word, validTerms, {
                ...this.suggestionConfig,
                maxSuggestions: 3
            });
            
            // Para cada sugestão de palavra, criar uma sugestão de frase completa
            for (const wordSuggestion of wordSuggestions) {
                const correctedWords = [...words];
                correctedWords[i] = wordSuggestion.term;
                const correctedPhrase = correctedWords.join(' ');
                
                // Verificar se a frase corrigida não é idêntica à original
                if (correctedPhrase.toLowerCase() !== searchTerm.toLowerCase()) {
                    suggestions.push({
                        score: wordSuggestion.score * 0.8, // Penalizar ligeiramente por ser correção parcial
                        term: correctedPhrase,
                        distance: wordSuggestion.distance,
                        originalWord: word,
                        correctedWord: wordSuggestion.term
                    });
                }
            }
        }
        
        // Ordenar por score e remover duplicatas
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
    
    async searchWithSuggestions(terms, options = {}) {
        // 1. Tentar busca normal primeiro
        let results = await this.search(terms, options);
        
        // 2. Se não encontrou resultados, buscar sugestões
        if (results.length === 0) {
            const suggestions = await this.findSuggestionsForTerm(terms);
            
            if (suggestions.length > 0) {
                // 3. Adicionar entrada de sugestão principal
                const mainSuggestion = suggestions[0];
                const suggestionEntry = {
                    name: lang.DID_YOU_MEAN.format(mainSuggestion.term),
                    details: mainSuggestion.originalWord ? 
                        `"${mainSuggestion.originalWord}" → "${mainSuggestion.correctedWord}"` : 
                        `Score: ${(mainSuggestion.score * 100).toFixed(1)}%`,
                    type: 'action',
                    action: () => this.go(mainSuggestion.term, options.mediaType || this.searchMediaType),
                    fa: 'fas fa-lightbulb',
                    prepend: '<i class="fas fa-lightbulb"></i> '
                };
                
                results.unshift(suggestionEntry);
                
                // 4. Adicionar outras sugestões se existirem
                for (let i = 1; i < Math.min(suggestions.length, this.suggestionConfig.maxSuggestions); i++) {
                    const suggestion = suggestions[i];
                    results.push({
                        name: lang.OR_MAYBE.format(suggestion.term),
                        details: suggestion.originalWord ? 
                            `"${suggestion.originalWord}" → "${suggestion.correctedWord}"` : 
                            `Score: ${(suggestion.score * 100).toFixed(1)}%`,
                        type: 'action',
                        action: () => this.go(suggestion.term, options.mediaType || this.searchMediaType),
                        fa: 'fas fa-lightbulb',
                        prepend: '<i class="fas fa-lightbulb"></i> '
                    });
                }
            } else {
                // 5. Se não há sugestões, mostrar mensagem amigável
                results.push({
                    name: lang.NO_RESULTS_FOUND,
                    details: lang.TRY_DIFFERENT_TERMS,
                    type: 'info',
                    fa: 'fas fa-info-circle',
                    prepend: '<i class="fas fa-info-circle"></i> '
                });
            }
        }
        
        return results;
    }
    
    async searchGroups(tms) {
        if (!Array.isArray(tms)) {
            tms = terms(tms)
        }
        const map = {}, entries = []        
        const es = await this.search(tms, {groupsOnly: true})
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
    async search(terms, atts = {}, excludeUrls) {        
        const policy = config.get('parental-control');
        const parentalControlActive = ['remove', 'block'].includes(policy);
        const isAdultQueryBlocked = policy == 'remove' && !lists.parentalControl.allow(terms);
        const opts = {
            partial: this.searchInaccurate,
            type: this.searchMediaType,
            typeStrict: this.searchStrict,
            group: this.searchMediaType != 'live',
            parentalControl: policy == 'remove' ? false : undefined // allow us to count blocked results
        };
        Object.assign(opts, atts);
        if (typeof(opts.limit) != 'number') {
            opts.limit = 256
        }
        if (excludeUrls) {
            opts.limit += excludeUrls.size
        }
        console.log('will search', terms, opts);
        let es = await lists.search(terms, opts);
        console.log('has searched', es.length, {terms, parentalControlActive, isAdultQueryBlocked, excludeUrls});
        if (excludeUrls) {
            es = es.filter(e => !excludeUrls.has(e.url));
        }
        if (isAdultQueryBlocked) {
            es = [
                {
                    prepend: '<i class="fas fa-info-circle"></i> ',
                    name: lang.X_BLOCKED_RESULTS.format(es.length),
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
            if (config.get('search-youtube') && es.length < minResultsWanted) {
                let ys = await this[this.searchMediaType == 'live' ? 'ytLiveResults' : 'ytResults'](terms).catch(err => console.error(err));
                Array.isArray(ys) && es.push(...ys)
            }
            if (es.length) {
                es = lists.parentalControl.filter(es);
            }
        }
        console.log('search: results finished', es);
        return es;
    }
    async results(terms, opts = {}, excludeUrls) {
        let u = ucWords(terms);
        this.currentSearch = {
            name: u,
            url: mega.build(u, { terms, mediaType: this.searchMediaType })
        };
        
        const es = await this.search(terms, opts, excludeUrls);
        renderer.ui.emit('current-search', terms, this.searchMediaType);
        if (!lists.loaded(true)) {
            if (paths.ALLOW_ADDING_LISTS) {
                return [lists.manager.noListsEntry()];
            }
            return [];
        }
        return es;
    }
    fixYTTitles(name) {
        return name.replaceAll('/', '|');
    }
    async ytResults(tms) {
        let terms = tms;
        if (Array.isArray(terms)) {
            terms = terms.join(' ');
        }
        const filters = await ytsr.getFilters(terms);
        const filter = filters.get('Type').get('Video');
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
                name: this.fixYTTitles(t.title),
                icon,
                type: 'stream',
                url: t.url
            };
        });
    }
    async ytLiveResults($tms) {        
        if (!Array.isArray($tms)) {
            $tms = terms($tms)
        }
        let tms = $tms.join(' ');
        tms += ' (' + lang.LIVE + ' OR 24h)'
        console.warn('YTSEARCH', tms);
        const filters = await ytsr.getFilters(tms);
        const filter = filters.get('Type').get('Video');
        const filters2 = await ytsr.getFilters(filter.url);
        const filter2 = filters2.get('Features').get('Live');
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
        results.items = results.items.filter(t => {
            let ytms = terms(t.title);
            console.warn('YTSEARCH', $tms, ytms);
            return match(tms, ytms, true);
        });
        return results.items.map(t => this.channels.toMetaEntry({
            name: this.fixYTTitles(t.title),
            icon: t.thumbnails ? t.thumbnails.sortByProp('width').shift().url : undefined,
            type: 'stream',
            url: t.url
        }));
    }
    async channelsResults($terms) {        
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

        const gs = await this.searchGroups($terms)
        es.push(...gs)

        const minResultsWanted = 256
        if (config.get('search-youtube') && es.length < minResultsWanted) {
            let ys = await this.ytLiveResults($terms).catch(err => console.error(err));
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
    matchTerms(nlc, precision, es) {
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
    termsFromEntry(entry, precision, searchSugEntries) {
        return new Promise((resolve, reject) => {
            let name = entry.originalName || entry.name;
            if (typeof name !== 'string') {
                return resolve(false);
            }
            let nlc = name.toLowerCase();
            if (Array.isArray(searchSugEntries)) {
                resolve(this.matchTerms(nlc, precision, searchSugEntries));
            } else {
                this.searchSuggestionEntries().then(es => {
                    resolve(this.matchTerms(nlc, precision, es));
                }).catch(e => {
                    console.error(e);
                    resolve(false);
                });
            }
        });
    }
    async searchSuggestionEntries(removeAliases, countryOnly) {
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
            return this.searchSuggestionEntries(removeAliases, false);
        }
        if (removeAliases === true) {
            ret = this.removeSearchSuggestionsTermsAliasesObject(ret).sortByProp('cnt', true);
        }
        return ret;
    }
    removeSearchSuggestionsCheckNames(a, b) {
        return (a != b && (a.substr(b.length * -1) == b || (a.includes(b) && a.length <= (b.length + 3))));
    }
    removeSearchSuggestionsGetAliases(o) {
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
                    if (this.removeSearchSuggestionsCheckNames(t, k)) {
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
    removeSearchSuggestionsTermsAliases(s) {
        if (s.length) {
            let aliases = this.removeSearchSuggestionsGetAliases(s);
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
    removeSearchSuggestionsTermsAliasesObject(s) {
        if (s.length) {
            let aliases = this.removeSearchSuggestionsGetAliases(s), cnts = {};
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
    defaultTerms() {
        let def = '';
        if (this.currentSearch) {
            def = this.currentSearch.name;
        }
        return def;
    }
    entry(mediaType = 'live') {
        this.searchMediaType = mediaType;
        /*
        return {
            name: lang.SEARCH,
            details: this.mediaTypeName(),
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);
                this.go(value, mediaType);
            },
            value: () => {
                return this.defaultTerms();
            },
            placeholder: lang.SEARCH_PLACEHOLDER
        };
        */
        return {
            name: lang.SEARCH,
            details: this.mediaTypeName(),
            type: 'action',
            fa: 'fas fa-search',
            action: (e, value) => {
                console.log('new search', e, value, mediaType);                
                renderer.ui.emit('omni-show');
            }
        };
    }
    async hook(entries, path) {
        if (lists.loaded() && lists.activeLists.length) {
            if (path == lang.LIVE) {
                entries.unshift(this.entry('live'));
            } else if (lang.CATEGORY_MOVIES_SERIES == path) {
                entries.unshift(this.entry('all'));
            }
        }
        return entries
    }
}
export default Search;
