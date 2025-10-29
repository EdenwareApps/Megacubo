import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import pLimit from "p-limit";
import data from "./search-redirects.json" with {type: 'json'};
import countryCodes from '../countries/countries.json' with {type: 'json'};
import options from "./options.json" with { type: 'json' }
import { basename, forwardSlashes } from "../utils/utils.js";
import { sanitizeName } from "./parser.js";

// Define regexes locally to avoid circular import issues
const regexes = {
    'group-separators': new RegExp('( ?[\\\\|;] ?| /+|/+ )', 'g'),
    'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
    'between-brackets': new RegExp('\\[[^\\]]*?\\]', 'g'), // Non-greedy
    'accents': new RegExp('[\\u0300-\\u036f]', 'g'),
    'plus-signal': new RegExp('\\+', 'g'),
    'hyphen': new RegExp('-', 'g'),
    'hyphen-not-modifier': new RegExp('(.)-', 'g'),
    'spaces': new RegExp(' {2,}', 'g'),
    'type-playlist': new RegExp('type[\\s\'"]*=[\\s\'"]*playlist[\\s\'"]*'),
    'strip-query-string': new RegExp('\\?.*$'),
    'strip-proto': new RegExp('^[a-z]*://'),
    'm3u-url-params': new RegExp('.*\\|[A-Za-z0-9\\-]*=')
};

const LIST_DATA_KEY_MASK = 'list-data-1-{0}'

export const resolveListDatabaseKey = url => {
    return LIST_DATA_KEY_MASK.format(url)
}

export const resolveListDatabaseFile = (url, index = false) => {
    return storage.resolve(resolveListDatabaseKey(url), index ? 'idx.jdb' : 'jdb')
}

class TermsHandler {
    constructor() {
        this.countryCodes = new Set(countryCodes.map(c => c.code)); // precompute country codes as Set
        this.regexes = regexes;
        this.allowedCharsRegex = new RegExp('[^ a-z0-9\\-\\+\\*@$|]+', 'g') // remove chars not allowed (keep | for OR logic)
        this.sanitizeName = sanitizeName;
        this.searchRedirects = [];
        this.stopWords = new Set(['sd', '4k', 'hd', 'h264', 'h.264', 'fhd', 'uhd', 'null', 'undefined']); // common words to ignore on searching
        this.loadSearchRedirects();
    }
    loadSearchRedirects() {
        if (!this.searchRedirects.length && data && typeof data === 'object') {
            this.searchRedirects = Object.entries(data).map(([key, value]) => ({
                from: this.terms(key),
                to: this.terms(value),
            }));
        }
    }
    applySearchRedirects(terms) {
        if (terms instanceof Set) {
            terms = Array.from(terms);
        } else if (typeof terms === 'string') {
            terms = this.terms(terms, true, false);
        } else if (!Array.isArray(terms)) {
            return [];
        }
        for (const redirect of this.searchRedirects) {
            if (redirect.from.every(t => terms.includes(t))) {
                terms = terms.filter(t => !redirect.from.includes(t));
                terms.push(...redirect.to);
            }
        }
        return terms;
    }
    applySearchRedirectsOnObject(e) {
        if (Array.isArray(e)) {
            return this.applySearchRedirects(e);
        } else if (e.terms) {
            if (Array.isArray(e.terms)) {
                e.terms = this.applySearchRedirects(e.terms);
            }
        }
        return e;
    }
    terms(txt, noModifiers, keepStopWords) {
        if (!txt) return [];        
        if (Array.isArray(txt)) txt = txt.join(' ');

        if (noModifiers && txt.includes('|')) {
            txt = txt.split('|').shift();
        }

        txt = txt
            .toLowerCase() // normalize to lowercase
            .normalize('NFD') // decompose accents
            .replace(/[\u0300-\u036f]/g, '') // remove accents
            .replace(this.regexes['plus-signal'], 'plus') // specific replacements
            .replace(this.regexes['between-brackets'], '') // remove bracket contents
            .replace(this.allowedCharsRegex, ' '); // remove disallowed chars

        const sep = txt.charAt(2);
        if (sep == ' ') {
            if (!Array.isArray(this.countryCodes)) {
                this.countryCodes = new Set(global.lang?.countries?.getCountries() || [])
            }
            
            // for channels name formatted like 'US: CNN', 'US - CNN' or 'US | CNN'
            const maybeCountryCode = txt.substr(0, 2);
            if (this.countryCodes.has(maybeCountryCode)) {
                txt = txt.substr(3).trim();
            }
        }

        let terms = txt.split(' ').map(s => {
            if (s.startsWith('-')) {
                if (noModifiers) return '';
                s = s.replace(this.regexes['hyphen-not-modifier'], '$1');
                return s.length > 1 ? s : '';
            } else if (s === '|') {
                if (noModifiers) return '';
                return '|'; // Keep | when noModifiers is false
            }
            return s.replace(this.regexes['hyphen-not-modifier'], '$1');
        });

        terms = terms.filter(s => s); // remove empty terms

        if (!keepStopWords) {
            terms = terms.filter(s => !this.stopWords.has(s));
        }

        return this.applySearchRedirects(terms); // apply redirects last
    }
    match(needleTerms, stackTerms, partial = false) {
        if (!Array.isArray(needleTerms) || !Array.isArray(stackTerms)) return 0;

        if (needleTerms.includes('|')) {
            return Math.max(
                ...needleTerms
                    .join(' ')
                    .split('|')
                    .map(s => this.match(s.trim().split(' '), stackTerms, partial))
            );
        }

        const nTerms = needleTerms.filter(t => !t.startsWith('-'));
        const sTerms = stackTerms.filter(t => !t.startsWith('-'));
        const weakTerms = this.stopWords;

        // Check for exclude terms
        if (
            needleTerms.some(t => t.startsWith('-') && sTerms.includes(t.slice(1))) ||
            stackTerms.some(t => t.startsWith('-') && nTerms.includes(t.slice(1)))
        ) {
            return 0;
        }

        const matchedTerms = new Set();
        let score = 0;

        for (const term of nTerms) {
            if (partial) {
                const len = term.length;
                if (sTerms.some(sTerm => sTerm.startsWith(term) && (sTerm.length === len || sTerm.startsWith(term)))) {
                    matchedTerms.add(term);
                    score++;
                }
            } else if (sTerms.includes(term)) {
                matchedTerms.add(term);
                score++;
            }
        }

        // If all matched terms are weak, ignore the match
        if ([...matchedTerms].every(t => weakTerms.has(t))) return 0;

        if (score) {
            if (score === nTerms.length) {
                return score === sTerms.length ? 3 : 2; // Full match or partial match
            }
            if (nTerms.length >= 3 && score === nTerms.length - 1) return 1; // Almost full match
        }

        return 0;
    }
}

class Tools extends TermsHandler {
    constructor() {
        super()
    }
    dedup(entries) {
        let changed, already = {}, map = {};
        for (var i = 0; i < entries.length; i++) {
            if (!entries[i]) {
                changed = true;
                delete entries[i];
            } else if (entries[i].url &&
                !entries[i].prepend &&
                (typeof(entries[i].type) == 'undefined' || entries[i].type == 'stream')) {
                if (typeof(already[entries[i].url]) != 'undefined') {
                    changed = true;
                    var j = map[entries[i].url];
                    entries[j] = this.mergeEntries(entries[j], entries[i]);
                    delete entries[i];
                } else {
                    already[entries[i].url] = 1;
                    map[entries[i].url] = i;
                }
            }
        }
        already = map = null;
        return changed ? entries.filter(item => item !== undefined) : entries;
    }
    dirname(str) {
        let _str = new String(str), pos = forwardSlashes(_str).lastIndexOf('/');
        if (!pos)
            return '';
        _str = _str.substring(0, pos);
        return _str;
    }
    mapRecursively(list, cb, root) {
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i].type && list[i].type == 'group') {
                if (typeof(list[i].entries) != 'undefined') {
                    let ret = this.mapRecursively(list[i].entries, cb, true);
                    if (Array.isArray(ret)) {
                        list[i].entries = ret;
                    } else {
                        list[i].renderer = ret;
                        delete list[i].entries;
                    }
                }
            }
        }
        if (root) {
            list = cb(list);
        }
        return list;
    }
    async asyncMapRecursively(list, cb, root) {
        for (var i = list.length - 1; i >= 0; i--) {
            if (list[i].type && list[i].type == 'group') {
                if (typeof(list[i].entries) != 'undefined') {
                    let ret = await this.asyncMapRecursively(list[i].entries, cb, true);
                    if (Array.isArray(ret)) {
                        list[i].entries = ret;
                    } else {
                        list[i].renderer = ret;
                        delete list[i].entries;
                    }
                }
            }
        }
        if (root) {
            list = await cb(list);
        }
        return list;
    }
    async offload(list, url) {
        if (list.length <= options.offloadThreshold) {
            return list;
        } else {
            let i = 0;
            const limit = pLimit(4);
            return this.asyncMapRecursively(list, async (slist) => {
                let key = 'offload-' + i + '-' + url;
                limit(async () => {
                    return storage.set(key, slist, { expiration: true });
                });
                i++;
                return key;
            }, false);
        }
    }
    insertAtPath(_index, groupname, group) {
        var structure = this.buildPathStructure(groupname, group);
        _index = this.mergeEntriesWithNoCollision(_index, structure);
        return _index;
    }
    isASCIIChar(chr) {
        let c = chr.charCodeAt(0);
        return ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122));
    }
    groupDetails(entries) {
        let streams, categories, details = [];
        streams = entries.filter(e => e.url).length;
        categories = entries.length - streams;
        if (streams)
            details.push(lang.X_BROADCASTS.format(streams));
        if (categories)
            details.push(lang.X_CATEGORIES.format(categories));
        return details.join(', ');
    }    
    sort(entries, key = 'name') {
        if (typeof(Intl) != 'undefined' && lang.locale) {
            if (typeof(this.collator) == 'undefined') {
                this.collator = new Intl.Collator(lang.locale, { numeric: true, sensitivity: 'base' });
            }
            return entries.sort((a, b) => this.collator.compare(a[key], b[key]));
        } else {
            return entries.sort((a, b) => (a[key] > b[key] ? 1 : (a[key] < b[key] ? -1 : 1)));
        }
    }
    mergeEntriesWithNoCollision(leveledIndex, leveledEntries) {
        var ok;
        if (Array.isArray(leveledIndex) && Array.isArray(leveledEntries)) {
            for (var j = 0; j < leveledEntries.length; j++) {
                ok = false;
                for (var i = 0; i < leveledIndex.length; i++) {
                    if (leveledIndex[i].name == leveledEntries[j].name && leveledIndex[i].type == leveledEntries[j].type) {
                        leveledIndex[i].entries = this.mergeEntriesWithNoCollision(leveledIndex[i].entries, leveledEntries[j].entries);
                        ok = true;
                        break;
                    }
                }
                if (!ok) {
                    leveledIndex.push(leveledEntries[j]);
                }
            }
        }
        return leveledIndex;
    }
    buildPathStructure(path, group) {
        var groupEntryTemplate = { name: '', path: '', type: 'group', details: '', entries: [] };
        path = path.replace(new RegExp('\\+'), '/');
        var parts = path.split('/');
        var structure = group;
        for (var i = (parts.length - 2); i >= 0; i--) {
            var entry = groupEntryTemplate;
            entry.entries = [Object.assign({}, structure)];
            entry.name = parts[i];
            entry.details = '';
            entry.path = parts.slice(0, i + 1).join('/');
            structure = entry;
        }
        return [structure];
    }
    mergeNames(a, b) {
        if (!a || !b) return a || b;
        
        var la = a.toLowerCase().trim();
        var lb = b.toLowerCase().trim();
        
        // If one name is completely contained in the other, return the longer one
        if (la && la.includes(lb)) {
            return a;
        }
        if (lb && lb.includes(la)) {
            return b;
        }
        
        // Enhanced substring detection for cases like "beIN Sports US" + "beIN Sports"
        if (this.isSubstringMatch(la, lb)) {
            return a; // Return the longer one
        }
        if (this.isSubstringMatch(lb, la)) {
            return b; // Return the longer one
        }
        
        // Special case: Check if one name is a prefix of the other with additional words
        if (this.isPrefixMatch(la, lb)) {
            return a; // Return the longer one
        }
        if (this.isPrefixMatch(lb, la)) {
            return b; // Return the longer one
        }
        
        // Split names into words for intelligent merging
        const wordsA = a.trim().split(/\s+/);
        const wordsB = b.trim().split(/\s+/);
        
        // Find common words between the two names (case-insensitive)
        const commonWords = wordsA.filter(word => 
            wordsB.some(bWord => 
                word.toLowerCase() === bWord.toLowerCase()
            )
        );
        
        // If there are common words, merge intelligently
        if (commonWords.length > 0) {
            // Remove common words from both names
            const uniqueWordsA = wordsA.filter(word => 
                !commonWords.some(common => 
                    word.toLowerCase() === common.toLowerCase()
                )
            );
            const uniqueWordsB = wordsB.filter(word => 
                !commonWords.some(common => 
                    word.toLowerCase() === common.toLowerCase()
                )
            );
            
            // Combine unique words with common words (preserve original case)
            const result = [...uniqueWordsA, ...commonWords, ...uniqueWordsB]
                .filter(word => word.length > 0)
                .join(' ');
            
            return result || a; // Fallback to original if result is empty
        }
        
        // Check for quality indicators and merge them intelligently
        const qualityResult = this.mergeQualityIndicators(wordsA, wordsB);
        if (qualityResult) {
            return qualityResult.join(' ');
        }
        
        // Check for partial word matches (e.g., "TV" and "Television")
        const partialMatches = this.findPartialMatches(wordsA, wordsB);
        if (partialMatches.length > 0) {
            // Use the longer/more complete version of partial matches
            const mergedWords = this.mergePartialMatches(wordsA, wordsB, partialMatches);
            return mergedWords.join(' ');
        }
        
        // No common words or partial matches, use separator
        return a + ' - ' + b;
    }
    
    findPartialMatches(wordsA, wordsB) {
        const matches = [];
        for (const wordA of wordsA) {
            for (const wordB of wordsB) {
                const la = wordA.toLowerCase();
                const lb = wordB.toLowerCase();
                
                // Check if one word is a common abbreviation of another
                if (this.isAbbreviation(la, lb) || this.isAbbreviation(lb, la)) {
                    matches.push({ wordA, wordB, type: 'abbreviation' });
                }
                // Check if one word contains the other (but not exact match)
                else if (la.includes(lb) && la !== lb && lb.length > 2) {
                    matches.push({ wordA, wordB, type: 'contains' });
                }
                else if (lb.includes(la) && la !== lb && la.length > 2) {
                    matches.push({ wordA, wordB, type: 'contains' });
                }
            }
        }
        return matches;
    }
    
    isAbbreviation(short, long) {
        const abbreviations = {
            'tv': 'television',
            'hd': 'high definition',
            'fhd': 'full high definition',
            'uhd': 'ultra high definition',
            '4k': 'ultra high definition',
            'sd': 'standard definition',
            'fm': 'frequency modulation',
            'am': 'amplitude modulation',
            'dtv': 'digital television',
            'hdtv': 'high definition television',
            'fhd': 'full high definition'
        };
        
        return abbreviations[short] === long || 
               (short.length <= 3 && long.toLowerCase().startsWith(short.toLowerCase()));
    }
    
    mergePartialMatches(wordsA, wordsB, partialMatches) {
        const result = [...wordsA];
        const usedWordsB = new Set();
        
        for (const match of partialMatches) {
            const indexA = result.indexOf(match.wordA);
            const indexB = wordsB.indexOf(match.wordB);
            
            if (indexA !== -1 && indexB !== -1 && !usedWordsB.has(match.wordB)) {
                // Replace with the longer/more complete version
                const replacement = match.wordA.length > match.wordB.length ? match.wordA : match.wordB;
                result[indexA] = replacement;
                usedWordsB.add(match.wordB);
            }
        }
        
        // Add remaining words from B that weren't matched
        for (const wordB of wordsB) {
            if (!usedWordsB.has(wordB)) {
                result.push(wordB);
            }
        }
        
        return result;
    }
    
    // Helper method to detect quality indicators and merge them intelligently
    mergeQualityIndicators(wordsA, wordsB) {
        const qualityPatterns = [
            /\((\d+)p\)/i,  // (720p), (1080p), etc.
            /\((\d+)k\)/i,  // (4k), (8k), etc.
            /hd/i,          // HD
            /fhd/i,         // FHD
            /uhd/i,         // UHD
            /sd/i           // SD
        ];
        
        const hasQualityA = wordsA.some(word => qualityPatterns.some(pattern => pattern.test(word)));
        const hasQualityB = wordsB.some(word => qualityPatterns.some(pattern => pattern.test(word)));
        
        if (hasQualityA && hasQualityB) {
            // Both have quality indicators, keep the higher quality
            return this.keepHigherQuality(wordsA, wordsB);
        } else if (hasQualityA || hasQualityB) {
            // Only one has quality indicator, keep it
            return hasQualityA ? wordsA : wordsB;
        }
        
        return null; // No quality indicators to merge
    }
    
    keepHigherQuality(wordsA, wordsB) {
        const getQualityValue = (words) => {
            for (const word of words) {
                const match = word.match(/\((\d+)p\)/i);
                if (match) return parseInt(match[1]);
            }
            return 0;
        };
        
        const qualityA = getQualityValue(wordsA);
        const qualityB = getQualityValue(wordsB);
        
        return qualityA >= qualityB ? wordsA : wordsB;
    }
    
    // Enhanced substring detection for better merging
    isSubstringMatch(longer, shorter) {
        if (!longer || !shorter) return false;
        
        // Direct substring check
        if (longer.includes(shorter)) {
            return true;
        }
        
        // Check if shorter is a significant part of longer (at least 80% of words)
        const longerWords = longer.split(/\s+/);
        const shorterWords = shorter.split(/\s+/);
        
        if (shorterWords.length === 0) return false;
        
        // Count how many words from shorter are found in longer (exact match or contains)
        const matchedWords = shorterWords.filter(shortWord => 
            longerWords.some(longWord => 
                longWord.toLowerCase() === shortWord.toLowerCase() || 
                longWord.toLowerCase().includes(shortWord.toLowerCase())
            )
        );
        
        // If most words match, consider it a substring
        const matchRatio = matchedWords.length / shorterWords.length;
        return matchRatio >= 0.8; // 80% match threshold for better accuracy
    }
    
    // Check if one name is a prefix of the other with additional words
    isPrefixMatch(longer, shorter) {
        if (!longer || !shorter) return false;
        
        const longerWords = longer.split(/\s+/);
        const shorterWords = shorter.split(/\s+/);
        
        if (shorterWords.length === 0 || longerWords.length <= shorterWords.length) {
            return false;
        }
        
        // Check if all words from shorter are found at the beginning of longer
        for (let i = 0; i < shorterWords.length; i++) {
            if (longerWords[i].toLowerCase() !== shorterWords[i].toLowerCase()) {
                return false;
            }
        }
        
        return true; // All words from shorter are at the beginning of longer
    }
    
    mergeEntries(a, b) {
        if (a.name != b.name || a.rawname != b.rawname) {
            const oaName = a.name
            const hasRawName = (a.rawname && a.rawname != a.name)
            a.name = this.mergeNames(a.name, b.name)
            if (hasRawName) {
                a.rawname = this.mergeNames(a.rawname || a.name, b.rawname || a.name)
            }
            if (a.path) {
                const parts = a.path.split('/');
                if (parts[parts.length - 1] == oaName) {
                    parts[parts.length - 1] = a.name;
                    a.path = parts.join('/');
                }
            }
        }
        if (b.icon && !a.icon) {
            a.icon = b.icon
        }
        return a;
    }
    shortenSingleFolders(list) {
        for (var i = 0; i < list.length; i++) {
            if (list[i].type == 'group') {
                if (typeof(list[i].entries) != 'undefined' && list[i].entries.length == 1) {
                    list[i].entries[0].name = this.mergeNames(list[i].name, list[i].entries[0].name);
                    list[i] = list[i].entries[0];
                    list[i].path = this.dirname(list[i].path);
                    list[i].group = this.dirname(list[i].group);
                }
            }
        }
        return list;
    }
    async deepify(entries, opts = {}) {
        const shouldOffload = entries.length > 4096;
        let parsedGroups = {}, groupedEntries = [];
        for (let i = 0; i < entries.length; i++) {
            if (entries[i].group) {
                if (typeof(parsedGroups[entries[i].group]) == 'undefined') {
                    parsedGroups[entries[i].group] = [];
                }
                parsedGroups[entries[i].group].push(entries[i]);
                entries[i] = undefined;
            }
        }
        for (let k in parsedGroups) {
            groupedEntries.push({
                name: basename(k), 
                path: k, type: 'group', 
                entries: parsedGroups[k] 
            })
        }
        entries = entries.filter(e => e);
        for (let i = 0; i < groupedEntries.length; i++) {
            if (groupedEntries[i].path.includes('/')) { // has path
                entries = this.insertAtPath(entries, groupedEntries[i].path, groupedEntries[i])
            }
        }
        for (let i = 0; i < groupedEntries.length; i++) {
            if (!groupedEntries[i].path.includes('/')) { // no path
                entries = this.mergeEntriesWithNoCollision(entries, [groupedEntries[i]])
            }
        }
        groupedEntries = parsedGroups = null
        entries = this.shortenSingleFolders(entries)
        if (opts.source) {
            entries = this.mapRecursively(entries, list => {
                if (list.length && !list[0].source) {
                    list[0].source = opts.source // leave a hint for expandEntries
                }
                return list
            }, true)
        }
        if (shouldOffload) {
            entries = await this.offload(entries, opts.source)
        }
        return entries
    }
    
    // Fase 1: Algoritmo de Similaridade para Correção de Busca
    levenshteinDistance(str1, str2) {
        const matrix = [];
        const len1 = str1.length;
        const len2 = str2.length;
        
        // Inicializar matriz
        for (let i = 0; i <= len1; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= len2; j++) {
            matrix[0][j] = j;
        }
        
        // Calcular distância
        for (let i = 1; i <= len1; i++) {
            for (let j = 1; j <= len2; j++) {
                const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,      // deleção
                    matrix[i][j - 1] + 1,      // inserção
                    matrix[i - 1][j - 1] + cost // substituição
                );
            }
        }
        
        return matrix[len1][len2];
    }
    
    calculateSimilarityScore(searchTerm, validTerm) {
        if (!searchTerm || !validTerm) return 0;
        
        const distance = this.levenshteinDistance(searchTerm.toLowerCase(), validTerm.toLowerCase());
        const maxLength = Math.max(searchTerm.length, validTerm.length);
        const lengthRatio = Math.min(searchTerm.length, validTerm.length) / maxLength;
        
        // Score baseado na distância e proporção de tamanho
        const distanceScore = 1 - (distance / maxLength);
        const finalScore = (distanceScore * 0.7) + (lengthRatio * 0.3);
        
        return {
            score: Math.max(0, finalScore),
            term: validTerm,
            distance: distance
        };
    }
    
    findSuggestions(searchTerm, validTerms, options = {}) {
        const {
            maxSuggestions = 3,
            minSimilarityScore = 0.7,
            maxDistance = 2
        } = options;
        
        if (!searchTerm || !validTerms || validTerms.size === 0) {
            return [];
        }
        
        const suggestions = [];
        
        for (const validTerm of validTerms) {
            // FP: Ignorar o próprio termo pesquisado (distância 0)
            if (validTerm.toLowerCase() === searchTerm.toLowerCase()) {
                continue;
            }
            
            const result = this.calculateSimilarityScore(searchTerm, validTerm);
            
            // Filtrar por score mínimo e distância máxima
            // FP: Garantir que há alguma diferença (distância > 0)
            if (result.score >= minSimilarityScore && result.distance > 0 && result.distance <= maxDistance) {
                suggestions.push(result);
            }
        }
        
        // Ordenar por score (maior primeiro) e limitar resultados
        return suggestions
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSuggestions);
    }
}

const tools = new Tools();
export const terms = tools.terms.bind(tools);
export const match = tools.match.bind(tools);
export const sort = tools.sort.bind(tools);
export const levenshteinDistance = tools.levenshteinDistance.bind(tools);
export const calculateSimilarityScore = tools.calculateSimilarityScore.bind(tools);
export const findSuggestions = tools.findSuggestions.bind(tools);
export default tools;
