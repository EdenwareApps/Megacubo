import { EventEmitter } from "events";
import LineReader from "../line-reader/line-reader.js";
import { absolutize, listNameFromURL } from '../utils/utils.js'

export const regexes = {
    'group-separators': new RegExp('( ?[\\\\|;] ?| /+|/+ )', 'g'),
    'notags': new RegExp('\\[[^\\]]*\\]', 'g'),
    'between-brackets': new RegExp('\\[[^\\]]*\\]', 'g'),
    'accents': new RegExp('[\\u0300-\\u036f]', 'g'),
    'plus-signal': new RegExp('\\+', 'g'),
    'hyphen': new RegExp('\\-', 'g'),
    'hyphen-not-modifier': new RegExp('(.)\\-', 'g'),
    'spaces': new RegExp(' {2,}', 'g'),
    'type-playlist': new RegExp('type[\s\'"]*=[\s\'"]*playlist[\s\'"]*'),
    'strip-query-string': new RegExp('\\?.*$'),
    'strip-proto': new RegExp('^[a-z]*://'),
    'm3u-url-params': new RegExp('.*\\|[A-Za-z0-9\\-]*=')
}

export const sanitizeName = s => {
    if (typeof(s) != 'string' || !s) {
        s = 'Untitled ' + parseInt(Math.random() * 10000);
    } else if (s.includes('/')) {
        if (s.includes('[/')) {
            s = s.split('[/').join('[|');
        }
        if (s.includes('/')) {
            s = s.replaceAll('/', ' ');
        }
    }
    /* needed on too specific cases, but bad for performance
    if (s.includes('\\')) {
        s = s.replaceAll('\\', ' ')
    }
    */
    return s;
}

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
            'http-referrer': 'referer'
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
        this.attrMapRegex = this.generateAttrMapRegex(this.attrMap);
        this.headerAttrMapRegex = this.generateAttrMapRegex(this.headerAttrMap);
        this.readen = 0; // no precision required, just for progress stats
    }
    generateAttrMapRegex(attrs) {
        return new RegExp('(' +
            Object.keys(attrs).join('|').replace(new RegExp('-', 'g'), '\\-') +
            ')\\s*=\\s*"([^\r\n"]+)', // always between DOUBLE quotes?!
        'g');
    }
    async start() {
        if (!this.opts.stream)
            throw 'Parser instance started with no stream set!';
        if (!this.opts.url)
            throw 'Parser instance started with no stream set!';
        this.liner = new LineReader(this.opts);
        let inExtInf,  g = '', a = {}, e = { url: '', icon: '' };
        this.liner.on('line', line => {
            this.readen += (line.length + 1);
            const hashed = line.startsWith('#');
            const sig = hashed ? line.substr(0, 7).toUpperCase() : '';
            const isExtM3U = hashed && this.isExtM3U(sig);
            const isExtInf = ((hashed && !isExtM3U && this.isExtInf(sig)) ||
                (inExtInf && line.startsWith('"')) // if some tvg field ended with a new line, next one starts with double quotes
            );
            if (!hashed && line.length < 6)
                return
            if (isExtM3U) {
                if (this.expectingHeader) {
                    const matches = [...line.matchAll(this.headerAttrMapRegex)];
                    for (const t of matches) {
                        if (t && t[2]) {
                            t[1] = this.headerAttrMap[t[1]] || t[1];
                            this.meta[t[1]] = t[2];
                        }
                    }
                }
            } else if(isExtInf) {
                inExtInf = true;
                if (this.expectingHeader) {
                    this.expectingHeader = false;
                    this.emit('meta', this.meta);
                }
                this.expectingPlaylist = this.isExtInfPlaylist(line);
                let n = '', sg = '';
                const matches = [...line.matchAll(this.attrMapRegex)];
                for (const t of matches) {
                    if (t && t[2]) {
                        const tag = this.attrMap[t[1]] || t[1];
                        switch (tag) {
                            case 'name':
                                n = t[2];
                                break;
                            case 'group':
                                if (!g || g === 'N/A') {
                                    g = t[2];
                                }
                                break;
                            case 'sub-group':
                                if (!sg || sg === 'N/A') {
                                    sg = t[2];
                                }
                                break;
                            default:
                                if (!e[this.attrMap[t[1]]]) {
                                    e[this.attrMap[t[1]]] = t[2];
                                }
                        }
                    }
                }
                g = this.trimPath(g);
                if (sg) {
                    g = this.mergePath(g, this.trimPath(sg));
                }
                if (!n) {
                    const pos = line.lastIndexOf(',');
                    if (pos != -1) {
                        n = line.substr(pos + 1).trim();
                    }
                }
                e.name = sanitizeName(n);
            } else if (this.expectingHeader) {
                return
            } else if (hashed) {
                // parse here extra info like #EXTGRP and #EXTVLCOPT
                if (sig == '#EXTGRP') {
                    let i = line.indexOf(':');
                    if (i !== -1) {
                        let nwg = line.substr(i + 1).trim();
                        if (nwg.length && (!g || g.length < nwg.length)) {
                            g = nwg;
                        }
                    }
                } else if (sig == '#EXTVLC') { // #EXTVLCOPT
                    let i = line.indexOf(':');
                    if (i !== -1) {
                        let nwa = line.substr(i + 1).trim().split('=');
                        if (nwa) {
                            nwa[0] = nwa[0].toLowerCase();
                            a[this.attrMap[nwa[0]] || nwa[0]] = this.trimQuotes(nwa[1] || '');
                        }
                    }
                }
            } else if(inExtInf) { // not hashed so, length already checked
                inExtInf = false
                e.url = line.trim()
                if (e.url.includes('|') && e.url.match(regexes['m3u-url-params'])) {
                    let parts = e.url.split('|');
                    e.url = parts[0];
                    parts = parts[1].split('=');
                    if (parts.length > 1) {
                        parts[0] = parts[0].toLowerCase();
                        a[this.attrMap[parts[0]] || parts[0]] = this.trimQuotes(parts[1] || '');
                    }
                }
                // resolve relative urls
                const pos = e.url.substr(0, 8).indexOf('//');
                if (pos === 0) {
                    e.url = 'http:' + e.url;
                } else if (pos === -1) {
                    e.url = absolutize(e.url, this.opts.url);
                }
                // removed url validation for performance
                if (!e.name) {
                    e.name = e.gid || listNameFromURL(e.url);
                }
                const name = e.name.replace(regexes['between-brackets'], '');
                if (name != e.name) {
                    e.rawname = e.name
                    e.name = name                    
                }
                if(e.icon) {
                    e.icon = e.icon.trim()
                }
                if (Object.keys(a).length) {
                    Object.assign(e, a);
                    a = {};
                }
                g = this.sanitizeGroup(g);
                e.group = g;
                e.groups = g.split('/');
                e.groupName = e.groups[e.groups.length - 1];
                if (this.expectingPlaylist) {
                    this.emit('playlist', e);
                } else {
                    this.emit('entry', e);
                }
                e = { url: '', icon: '' };
                g = '';
            }
            this.emit('progress', this.readen);
        });
        return await new Promise(resolve => {
            const close = () => {
                this.close();
                resolve(true);
            };
            if (this.liner.destroyed) {
                return close();
            }
            this.liner.once('error', err => {
                console.error('PARSER READ ERROR', err);
                close();
            });
            this.liner.once('close', close);
        });
    }
    sanitizeGroup(s) {
        if (s.length == 3 && s.toLowerCase().trim() === 'n/a') {
            return '';
        }
        if (!s.includes('/') && s.match(regexes['group-separators'])) { // if there are few cases, is better not replace directly
            s = s.replace(regexes['group-separators'], '/');
            if (s.startsWith('/'))
                s = s.substr(1);
            if (s.endsWith('/'))
                s = s.substr(0, s.length - 1);
        }
        if (s.includes('[')) {
            s = s.replace(regexes['between-brackets'], '');
        }
        // s = s.normalize('NFD') // is it really needed?
        return s;
    }
    isExtInf(sig) {
        return sig == '#EXTINF';
    }
    isExtInfPlaylist(line) {
        return line.includes('playlist') && line.match(regexes['type-playlist']);
    }
    isExtM3U(sig) {
        return sig == '#EXTM3U' || sig == '#PLAYLI'; // #playlistv
    }
    trimQuotes(text) {
        const f = text.charAt(0), l = text.charAt(text.length - 1);
        if (f == '"' || f == "'") {
            text = text.substr(1);
        }
        if (l == '"' || l == "'") {
            text = text.substr(0, text.length - 1);
        }
        return text;
    }
    trimPath(b) {
        if (b) {
            const chr = b.charAt(b.length - 1);
            if (chr === '/' || chr === ' ') {
                b = b.substr(0, b.length - 1);
            }
        }
        if (b) {
            const chr = b.charAt(0);
            if (chr === '/' || chr === ' ') {
                b = b.substr(1);
            }
        }
        return b;
    }
    mergePath(a, b) {
        if (b) {
            a = a + '/' + b;
        }
        return a;
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
        this.liner && this.liner.destroy();
        this.removeAllListeners();
    }
}
