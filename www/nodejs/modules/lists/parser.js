import { EventEmitter } from "events";
import LineReader from "../line-reader/line-reader.js";
import { absolutize, listNameFromURL } from '../utils/utils.js'

// Object Pool para reutilizar objetos e reduzir pressão no GC
class ObjectPool {
    constructor(createFn, resetFn) {
        this.pool = [];
        this.createFn = createFn;
        this.resetFn = resetFn;
    }
    
    get() {
        return this.pool.pop() || this.createFn();
    }
    
    release(obj) {
        this.resetFn(obj);
        this.pool.push(obj);
    }
}

export const regexes = {
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

// Regexes otimizadas para sanitizeName
const SANITIZE_REGEXES = {
    // Regex consolidada para caracteres de controle e quebras de linha
    controlChars: new RegExp('[\\r\\n\\t\\x00-\\x1f\\x7f-\\x9f]', 'g'),
    // Regex para aspas e barras invertidas
    jsonChars: new RegExp('[\\"\\\\]', 'g'),
    // Regex para múltiplos espaços
    multipleSpaces: new RegExp('\\s+', 'g'),
    // Regex para barras
    slashes: new RegExp('/', 'g')
};

// Função otimizada de sanitização
export const sanitizeName = s => {
    // Early returns para casos comuns
    if (s == null) return 'Untitled ' + Math.floor(Math.random() * 10000);
    if (typeof s !== 'string') return 'Untitled ' + Math.floor(Math.random() * 10000);
    if (s.length === 0) return 'Untitled ' + Math.floor(Math.random() * 10000);
    
    // Verificar caracteres de controle de forma mais eficiente
    let hasControlChars = false;
    for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code < 32 || code === 127 || (code >= 128 && code <= 159)) {
            hasControlChars = true;
            break;
        }
    }
    
    if (hasControlChars) {
        s = s.replace(SANITIZE_REGEXES.controlChars, ' ');
    }
    
    // Aplicar limpezas em sequência otimizada
    s = s
        .replace(SANITIZE_REGEXES.jsonChars, ' ')
        .replace(SANITIZE_REGEXES.multipleSpaces, ' ')
        .trim();
    
    // Se ficou vazio após limpeza, usar nome padrão
    if (!s) {
        return 'Untitled ' + Math.floor(Math.random() * 10000);
    }
    
    // Tratar barras de forma otimizada - substituir por | para evitar problemas de navegação
    if (s.includes('/')) {
        if (s.includes('[/')) {
            s = s.split('[/').join('[|');
        }
        s = s.replace(SANITIZE_REGEXES.slashes, ' | ');
    }
    
    // Garantir que o nome não seja muito longo
    if (s.length > 200) {
        s = s.substring(0, 200) + '...';
    }
    
    return s;
};

export class Parser extends EventEmitter {
    constructor(opts) {
        super();
        this.opts = opts;
        this.meta = {};
        this.expectingHeader = true;
        this.attrMap = {
            'logo': 'icon',
            'm3u-name': 'name',
            'tvg-id': 'gid',
            'tvg-name': 'name',
            'tvg-logo': 'icon',
            'tvg-language': 'lang',
            'tvg-country': 'country',
            'group-title': 'group',
            'pltv-subgroup': 'sub-group',
            'subtitles': 'subtitle',
            'sub-file': 'subtitle',
            'http-user-agent': 'user-agent',
            'referrer': 'referer',
            'http-referer': 'referer',
            'http-referrer': 'referer',
            // Age and parental control attributes
            'rating': 'rating',
            'tvg-rating': 'rating',
            'parental': 'parental',
            'censored': 'parental',
            'age-restriction': 'ageRestriction',
            'tvg-genre': 'genre',
            'region': 'region',
            'category-id': 'categoryId'
        };
        this.headerAttrMap = {
            'url-tvg': 'epg',
            'x-tvg-url': 'epg',
            'iptv-name': 'name',
            'pltv-cover': 'icon',
            'pltv-logo': 'icon',
            'pltv-author': 'author',
            'pltv-site': 'site',
            'pltv-email': 'email',
            'pltv-phone': 'phone',
            'pltv-name': 'name',
            'pltv-description': 'description'
        };
        
        // Pre-compile regexes once
        this.attrMapRegex = this.generateAttrMapRegex(this.attrMap);
        this.headerAttrMapRegex = this.generateAttrMapRegex(this.headerAttrMap);
        
        // Simple object creation - no object pool needed
        this.createEntry = () => ({ 
            url: '', 
            icon: '', 
            name: '', 
            gid: '', 
            group: '', 
            groups: [], 
            groupName: '',
            age: 0  // Default age rating (0 = no restriction)
        });
        this.createAttr = () => ({});
        
        this.readen = 0;
        this.ended = false;
        this.destroyed = false;
    }
    
    generateAttrMapRegex(attrs) {
        const keys = Object.keys(attrs);
        if (keys.length === 0) return new RegExp('(?!.*)');
        return new RegExp('(' +
            keys.join('|').replace(new RegExp('-', 'g'), '-') +
            ')\\s*=\\s*"([^\r\n"]+)', // always between DOUBLE quotes?!
        'g');
    }
    
    handleExtM3U(line) {
        if (this.expectingHeader) {
            let match;
            const regex = this.headerAttrMapRegex;
            regex.lastIndex = 0; // Reset regex state
            while ((match = regex.exec(line)) !== null) {
                if (match && match[2]) {
                    const key = this.headerAttrMap[match[1]] || match[1];
                    this.meta[key] = match[2];
                }
            }
        }
    }
    
    handleExtInf(line, g, a, e) {
        if (this.expectingHeader) {
            this.expectingHeader = false;
            this.emit('meta', this.meta);
        }
        
        this.expectingPlaylist = this.isExtInfPlaylist(line);
        let n = '', sg = '';
        
        let match;
        const regex = this.attrMapRegex;
        regex.lastIndex = 0; // Reset regex state
        while ((match = regex.exec(line)) !== null) {
            if (match && match[2]) {
                const tag = this.attrMap[match[1]] || match[1];
                switch (tag) {
                    case 'name':
                        n = match[2];
                        break;
                    case 'group':
                        if (!g || g === 'N/A') {
                            g = match[2];
                        }
                        break;
                    case 'sub-group':
                        if (!sg || sg === 'N/A') {
                            sg = match[2];
                        }
                        break;
                    default:
                        if (!e[this.attrMap[match[1]]]) {
                            e[this.attrMap[match[1]]] = match[2];
                        }
                }
            }
        }
        
        // Ensure g is not undefined before trimming
        if (typeof g !== 'string' || g === 'undefined' || !g) {
            g = '';
        }
        g = this.trimPath(g);
        if (sg) {
            g = this.mergePath(g, this.trimPath(sg));
        }
        
        if (!n) {
            const pos = line.lastIndexOf(',');
            if (pos !== -1) {
                n = line.substr(pos + 1).trim();
            }
        }
        
        // Only set name if we have a valid name
        if (n && n.trim().length > 0) {
            e.name = sanitizeName(n);
        }
        
        return { g, a, e };
    }
    
    handleHashedLine(line, sig, g, a) {
        if (sig === '#EXTGRP') {
            const i = line.indexOf(':');
            if (i !== -1) {
                const nwg = line.substr(i + 1).trim();
                if (nwg.length && (!g || g.length < nwg.length)) {
                    g = nwg;
                }
            }
        } else if (sig === '#EXTVLC') {
            const i = line.indexOf(':');
            if (i !== -1) {
                const content = line.substr(i + 1).trim();
                const equalIndex = content.indexOf('=');
                if (equalIndex !== -1) {
                    const key = content.substring(0, equalIndex).toLowerCase();
                    const value = this.trimQuotes(content.substring(equalIndex + 1) || '');
                    a[this.attrMap[key] || key] = value;
                }
            }
        }
        
        return { g, a };
    }
    
    handleUrlLine(line, g, a, e) {
        e.url = line.trim();
        
        // Skip empty URLs
        if (!e.url || e.url.length === 0) {
            return { g, a, e };
        }
        
        // Processar URL e parâmetros em uma única passada
        const urlData = this.processUrlInOnePass(e.url);
        e.url = urlData.url;
        if (urlData.params) {
            Object.assign(a, urlData.params);
        }
        
        // Skip if URL is still empty after processing
        if (!e.url || e.url.length === 0) {
            return { g, a, e };
        }
        
        // Resolver nome se não existir
        if (!e.name) {
            e.name = e.gid || listNameFromURL(e.url);
        }
        
        // Skip if name is still empty
        if (!e.name || e.name.trim().length === 0) {
            return { g, a, e };
        }
        
        // Processar nome em uma única operação
        const name = e.name.replace(regexes['between-brackets'], '');
        if (name !== e.name) {
            e.rawname = e.name;
            e.name = name;
        }
        
        // Final validation - skip if name is empty after processing
        if (!e.name || e.name.trim().length === 0) {
            return { g, a, e };
        }
        
        // Limpar ícone se existir
        if (e.icon) {
            e.icon = e.icon.trim();
        }
        
        // Aplicar atributos
        if (Object.keys(a).length) {
            Object.assign(e, a);
            a = this.createAttr();
        }
        
        // Processar grupo
        g = this.sanitizeGroup(g);
        e.group = g;
        e.groups = g.split('/');
        e.groupName = e.groups[e.groups.length - 1];
        
        // Debug logging for final entry
        if (this.debug) {
            console.log('🔍 [PARSER] Final entry data:', {
                name: e.name,
                icon: e.icon,
                gid: e.gid,
                url: e.url,
                group: e.group,
                groupName: e.groupName
            });
        }
        
        if (this.expectingPlaylist) {
            this.emit('playlist', e);
        } else {
            this.emit('entry', e);
        }
        
        // Don't release the entry pool here - it will be released after validation
        return { g, a, e };
    }
    
    processUrlInOnePass(url) {
        const result = { url, params: null };
        
        // Verificar se tem parâmetros (pipe)
        const pipeIndex = url.indexOf('|');
        if (pipeIndex !== -1 && regexes['m3u-url-params'].test(url)) {
            const urlPart = url.substring(0, pipeIndex);
            const paramPart = url.substring(pipeIndex + 1);
            
            const equalIndex = paramPart.indexOf('=');
            if (equalIndex !== -1) {
                const key = paramPart.substring(0, equalIndex).toLowerCase();
                const value = this.trimQuotes(paramPart.substring(equalIndex + 1));
                result.params = { [key]: value };
            }
            
            result.url = urlPart;
        }
        
        // Resolver URL relativa em uma única verificação
        const urlStart = result.url.substring(0, 8);
        const pos = urlStart.indexOf('//');
        if (pos === 0) {
            result.url = 'http:' + result.url;
        } else if (pos === -1) {
            result.url = absolutize(result.url, this.opts.url);
        }
        
        return result;
    }
    
    sanitizeGroup(s) {
        if (!s || s.length === 0) {
            return '';
        }
        
        if (s.length === 3 && s.toLowerCase().trim() === 'n/a') {
            return '';
        }
        
        if (!s.includes('/') && s.match(regexes['group-separators'])) {
            s = s.replace(regexes['group-separators'], '/');
            if (s.startsWith('/')) s = s.substr(1);
            if (s.endsWith('/')) s = s.substr(0, s.length - 1);
        }
        
        if (s.includes('[')) {
            s = s.replace(regexes['between-brackets'], '');
        }
        
        // Ensure we don't return empty string
        if (!s || s.trim().length === 0) {
            return '';
        }
        
        return s;
    }
    
    isExtInf(sig) {
        return sig === '#EXTINF';
    }
    
    isExtInfPlaylist(line) {
        return line.includes('playlist') && line.match(regexes['type-playlist']);
    }
    
    isExtM3U(sig) {
        return sig === '#EXTM3U' || sig === '#PLAYLI';
    }
    
    trimQuotes(text) {
        if (!text) return '';
        
        const f = text.charAt(0), l = text.charAt(text.length - 1);
        if (f === '"' || f === "'") {
            text = text.substr(1);
        }
        if (l === '"' || l === "'") {
            text = text.substr(0, text.length - 1);
        }
        return text;
    }
    
    trimPath(path) {
        if (!path || typeof path !== 'string') {
            return '';
        }
        
        // Remove leading and trailing slashes and whitespace
        path = path.trim();
        if (path.startsWith('/')) {
            path = path.substring(1);
        }
        if (path.endsWith('/')) {
            path = path.substring(0, path.length - 1);
        }
        
        // Ensure we don't return empty string if path was just slashes
        return path;
    }
    
    mergePath(a, b) {
        if (!a) {
            if (!b) {
                return '';
            }
            return b;
        }
        if (!b) {
            return a;
        }
        return a + '/' + b
    }
    
    end() {
        if (!this.ended && !this.destroyed) {
            this.ended = true;
            this.liner && this.liner.end();
        }
    }
    
    close() {
        this.emit('finish');
    }
    
    destroy() {
        if (!this.destroyed) {
            this.destroyed = true;
            this.emit('destroy');
            this.end();
        }
        
        // Clear resources
        this.liner && this.liner.destroy();
        
        // Limpar pools de objetos
        // No object pools to clean up
        
        this.removeAllListeners();
    }
    
    // Async generator for memory-efficient streaming consumption using LineReader
    async *walk() {
        if (!this.opts.stream)
            throw 'Parser instance started with no stream set!';
        if (!this.opts.url)
            throw 'Parser instance started with no url set!';
            
        // Initialize LineReader for streaming line-by-line processing
        this.liner = new LineReader(this.opts);
        let inExtInf, g = '', a = this.createAttr(), e = this.createEntry();
        
        // Create a promise-based queue for handling line events
        const lineQueue = [];
        let pump = null;
        let isFinished = false;
        let hasError = false;
        let error = null;
        let resolved = false;
        
        // Set up line event handler
        this.liner.on('line', (line) => {
            this.readen += (line.length + 1);
            lineQueue.push(line);
            if (pump) {
                pump();
            }
            // Emit progress
            this.emit('progress', this.readen);
        });
        
        // Set up error and close handlers
        this.liner.once('error', (err) => {
            console.error('PARSER READ ERROR', err);
            hasError = true;
            error = err;
            if (pump) {
                pump();
            }
        });
        
        this.liner.once('close', () => {
            isFinished = true;
            if (pump) {
                pump();
            }
        });
        
        try {
            // Process lines as they come in
            while (!isFinished || lineQueue.length > 0) {
                // Wait for lines to be available or processing to finish
                while (lineQueue.length === 0 && !isFinished && !hasError) {
                    await new Promise(resolve => pump = resolve)
                }
                
                // Check for errors
                if (hasError) {
                    throw error;
                }
                
                // Process all available lines
                while (lineQueue.length > 0) {
                    const line = lineQueue.shift();
                    
                    const hashed = line.startsWith('#');
                    if (!hashed && line.length < 6) {
                        continue;
                    }
                    
                    const sig = hashed ? line.substr(0, 7).toUpperCase() : '';
                    
                    // Process different line types
                    if (hashed) {
                        if (this.isExtM3U(sig)) {
                            this.handleExtM3U(line);
                        } else if (this.isExtInf(sig)) {
                            const result = this.handleExtInf(line, g, a, e);
                            inExtInf = true;
                            g = result.g;
                            a = result.a;
                            e = result.e;
                        } else if (this.expectingHeader) {
                            continue;
                        } else {
                            const result = this.handleHashedLine(line, sig, g, a);
                            g = result.g;
                            a = result.a;
                        }
                    } else if (inExtInf && line.trim().length > 0) {
                        inExtInf = false;
                        const result = this.handleUrlLine(line, g, a, e);
                        g = result.g;
                        a = result.a;
                        e = result.e;
                        
                        // Only yield if we have a valid entry with both name and URL
                        if (e && e.name && e.name.trim().length > 0 && e.url && e.url.trim().length > 0) {
                            if (this.expectingPlaylist) {
                                yield { type: 'playlist', entry: e };
                            } else {
                                yield { type: 'entry', entry: e };
                            }
                            
                            // Create a new entry object for the next entry to avoid reference issues
                            e = this.createEntry();
                            // CRITICAL FIX: Reset group variable to prevent accumulation across entries
                            g = '';
                        }
                    }
                }
            }
        } catch (err) {
            if (!resolved) {
                resolved = true
                throw err
            }
        } finally {
            // Clean up LineReader
            if (this.liner && !this.liner.destroyed) {
                this.liner.destroy();
            }
        }
    }
    
    // Helper methods for detecting M3U line types
    isExtM3U(sig) {
        return sig === '#EXTM3U';
    }
    
    // Enhanced detection methods based on the technical report
    detectAgeFromEntry(entry) {
        // Priority 1: Direct age restriction attribute
        if (entry.ageRestriction) {
            const age = parseInt(entry.ageRestriction);
            if (!isNaN(age)) return age;
        }
        
        // Priority 2: Rating attribute (18+, PG-13, etc.)
        if (entry.rating) {
            const rating = entry.rating.toLowerCase();
            if (rating.includes('18+') || rating.includes('adult')) return 18;
            if (rating.includes('16+')) return 16;
            if (rating.includes('13+') || rating.includes('pg-13')) return 13;
            if (rating.includes('12+')) return 12;
            if (rating.includes('7+')) return 7;
            if (rating.includes('0+') || rating.includes('all')) return 0;
        }
        
        // Priority 3: Parental control attributes
        if (entry.parental === 'yes' || entry.parental === '1' || entry.parental === 'true') {
            return 18; // Assume adult content if parental control is enabled
        }
        
        // Priority 4: Group title detection
        if (entry.group) {
            const group = entry.group.toLowerCase();
            if (group.includes('adult') || group.includes('18+') || group.includes('xxx')) return 18;
            if (group.includes('teen') || group.includes('16+')) return 16;
            if (group.includes('kids') || group.includes('children')) return 0;
        }
        
        // Priority 5: Channel name detection
        if (entry.name) {
            const name = entry.name.toLowerCase();
            // Check for age indicators in brackets [18+], [PG-13], etc.
            const ageMatch = name.match(/\[(\d+)\+\]|\[(pg-\d+)\]|\[(adult)\]/i);
            if (ageMatch) {
                if (ageMatch[1]) return parseInt(ageMatch[1]);
                if (ageMatch[2] === 'pg-13') return 13;
                if (ageMatch[3] === 'adult') return 18;
            }
            
            // Check for adult keywords
            if (name.includes('adult') || name.includes('xxx') || name.includes('18+')) return 18;
            if (name.includes('teen')) return 16;
            if (name.includes('kids') || name.includes('children')) return 0;
        }
        
        // Priority 6: URL path detection
        if (entry.url) {
            const url = entry.url.toLowerCase();
            if (url.includes('/adult/') || url.includes('/18+')) return 18;
            if (url.includes('/teen/') || url.includes('/16+')) return 16;
            if (url.includes('/kids/') || url.includes('/children/')) return 0;
        }
        
        return 0; // Default: no restriction
    }
    
    detectLanguageFromEntry(entry) {
        // Priority 1: Direct language attribute
        if (entry.lang) {
            return entry.lang.toLowerCase();
        }
        
        // Priority 2: Channel name detection [PT-BR], [ES], etc.
        if (entry.name) {
            const langMatch = entry.name.match(/\[(\w{2}(-\w{2})?)\]/i);
            if (langMatch) {
                return langMatch[1].toLowerCase();
            }
        }
        
        // Priority 3: URL path detection
        if (entry.url) {
            const url = entry.url.toLowerCase();
            const pathMatch = url.match(/\/(\w{2})\//);
            if (pathMatch) {
                return pathMatch[1];
            }
        }
        
        // Priority 4: Group title detection
        if (entry.group) {
            const group = entry.group.toLowerCase();
            if (group.includes('portuguese') || group.includes('brasil')) return 'pt';
            if (group.includes('spanish') || group.includes('espanol')) return 'es';
            if (group.includes('english') || group.includes('usa')) return 'en';
            if (group.includes('french') || group.includes('francais')) return 'fr';
        }
        
        return ''; // Default: no language detected
    }
    
    detectCountryFromEntry(entry) {
        // Priority 1: Direct country attribute
        if (entry.country) {
            return entry.country.toUpperCase();
        }
        
        // Priority 2: Region attribute
        if (entry.region) {
            const region = entry.region.toLowerCase();
            if (region.includes('brazil') || region.includes('brasil')) return 'BR';
            if (region.includes('spain') || region.includes('espanha')) return 'ES';
            if (region.includes('usa') || region.includes('united states')) return 'US';
            if (region.includes('france')) return 'FR';
            if (region.includes('germany') || region.includes('deutschland')) return 'DE';
        }
        
        // Priority 3: Channel name detection [BR], [US], etc.
        if (entry.name) {
            const countryMatch = entry.name.match(/\[(\w{2})\]/i);
            if (countryMatch) {
                return countryMatch[1].toUpperCase();
            }
        }
        
        // Priority 4: URL path detection
        if (entry.url) {
            const url = entry.url.toLowerCase();
            const pathMatch = url.match(/\/(\w{2})\//);
            if (pathMatch) {
                return pathMatch[1].toUpperCase();
            }
        }
        
        // Priority 5: Group title detection
        if (entry.group) {
            const group = entry.group.toLowerCase();
            if (group.includes('brasil') || group.includes('brazil')) return 'BR';
            if (group.includes('espanha') || group.includes('spain')) return 'ES';
            if (group.includes('usa') || group.includes('america')) return 'US';
            if (group.includes('france')) return 'FR';
            if (group.includes('germany') || group.includes('deutschland')) return 'DE';
        }
        
        return ''; // Default: no country detected
    }
    
    // Enhanced entry processing with intelligent detection
    processEntryWithDetection(entry) {
        // Apply intelligent detection
        entry.age = this.detectAgeFromEntry(entry);
        
        // Only set lang/country if not already set by attributes
        if (!entry.lang) {
            entry.lang = this.detectLanguageFromEntry(entry);
        }
        
        if (!entry.country) {
            entry.country = this.detectCountryFromEntry(entry);
        }
        
        return entry;
    }
    
    isExtInf(sig) {
        return sig === '#EXTINF';
    }
}
