import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import pLimit from "p-limit";
import config from "../config/config.js"
import data from "./search-redirects.json" with {type: 'json'};
import countryCodes from '../countries/countries.json' with {type: 'json'};
import options from "./options.json" with { type: 'json' }
import { basename, forwardSlashes } from "../utils/utils.js";
import { regexes, sanitizeName } from "./parser.js";

class TermsHandler {
    constructor() {
        this.countryCodes = new Set(countryCodes.map(c => c.code)); // precompute country codes as Set
        this.regexes = regexes;
        this.allowedCharsRegex = new RegExp('[^ a-z0-9\-\+\*@$]+', 'g') // remove chars not allowed
        this.sanitizeName = sanitizeName;
        this.searchRedirects = [];
        this.stopWords = new Set(['sd', '4k', 'hd', 'h264', 'h.264', 'fhd', 'uhd']); // common words to ignore on searching
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
            if (Array.isArray(e.terms.name)) {
                e.terms.name = this.applySearchRedirects(e.terms.name);
            } else if (Array.isArray(e.terms)) {
                e.terms = this.applySearchRedirects(e.terms);
            }
        }
        return e;
    }
    terms(txt, noModifiers, keepStopWords) {
        if (!txt) return [];        
        if (Array.isArray(txt)) txt = txt.join(' ');
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
            } else if (s === '|' && noModifiers) {
                return '';
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
    paginateList(sentries, minPageCount) {
        sentries = this.sort(sentries);
        const folderSizeLimit = config.get('folder-size-limit');
        if (sentries.length > (folderSizeLimit + options.folderSizeLimitTolerance)) {
            if (!minPageCount) {
                minPageCount = 8;
            }
            let expectedFolderSizeLimit = folderSizeLimit;
            let n = Math.ceil(sentries.length / minPageCount);
            if (n < expectedFolderSizeLimit) {
                expectedFolderSizeLimit = n;
            }
            let group, nextName, lastName, entries = [], template = { type: 'group', fa: 'fas fa-box-open' };
            for (let i = 0; i < sentries.length; i += expectedFolderSizeLimit) {
                group = Object.assign({}, template);
                let gentries = sentries.slice(i, i + expectedFolderSizeLimit);
                nextName = sentries.slice(i + expectedFolderSizeLimit, i + expectedFolderSizeLimit + 1);
                nextName = nextName.length ? nextName[0].name : null;
                group.name = this.getRangeName(gentries, lastName, nextName);
                if (group.name.includes('[')) {
                    group.rawname = group.name;
                    group.name = group.name.replace(this.regexes['between-brackets'], '');
                }
                if (gentries.length) {
                    lastName = gentries[gentries.length - 1].name;
                    group.details = this.groupDetails(gentries);
                }
                group.entries = gentries;
                entries.push(group);
                n++;
            }
            entries = entries.map((group, i) => {
                if (i >= (entries.length - 1))
                    return group;
                const nextGroup = entries[i + 1].name;
                group.entries.push({
                    name: lang.MORE,
                    details: nextGroup,
                    type: 'action',
                    fa: 'fas fa-chevron-right',
                    action: () => {
                        menu.open(menu.dirname(menu.path) + '/' + nextGroup).catch(e => menu.displayErr(e));
                    }
                });
                return group;
            });
            sentries = entries;
        }
        return sentries;
    }
    getNameDiff(a, b) {
        let c = '';
        for (let i = 0; i < a.length; i++) {
            if (a[i] && b && b[i] && a[i] == b[i]) {
                c += a[i];
            } else {
                c += a[i];
                if (this.isASCIIChar(a[i])) {
                    break;
                }
            }
        }
        return c;
    }
    getRangeName(entries, lastName, nextName) {
        var l, start = '0', end = 'Z', r = new RegExp('[a-z\\d]', 'i'), r2 = new RegExp('[^a-z\\d]+$', 'i');
        for (var i = 0; i < entries.length; i++) {
            if (lastName) {
                l = this.getNameDiff(entries[i].name, lastName);
            } else {
                l = entries[i].name.charAt(0);
            }
            if (l.match(r)) {
                start = l.replace(r2, '');
                break;
            }
        }
        for (var i = (entries.length - 1); i >= 0; i--) {
            if (nextName) {
                l = this.getNameDiff(entries[i].name, nextName);
            } else {
                l = entries[i].name.charAt(0);
            }
            if (l.match(r)) {
                end = l.replace(r2, '');
                break;
            }
        }
        const t = {
            s: '[alpha]',
            e: '[|alpha]'
        };
        return start == end ? start : lang.X_TO_Y.format(start + t.s, t.e + end);
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
        var la = a.toLowerCase();
        var lb = b.toLowerCase();
        if (la && la.includes(lb)) {
            return a
        }
        if (lb && lb.includes(la)) {
            return b
        }
        return a + ' - ' + b
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
        const folderSizeLimit = config.get('folder-size-limit')
        if (entries.length <= folderSizeLimit) {
            entries = this.shortenSingleFolders(entries)
            return entries
        }
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
        entries = this.mapRecursively(entries, es => {
            return this.paginateList(es, opts.minPageCount)
        }, true)
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
}
export default new Tools();
