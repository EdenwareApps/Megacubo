import Download from '../download/download.js'
import { decodeURIComponentSafe, prepareCORS, sanitize, time, forwardSlashes } from '../utils/utils.js';
import osd from '../osd/osd.js'
import menu from '../menu/menu.js'
import storage from '../storage/storage.js'
import crypto from 'crypto';
import lists from '../lists/lists.js';
import fs from 'fs';
import imp from '../icon-server/image-processor.js';
import crashlog from '../crashlog/crashlog.js';
import paths from '../paths/paths.js';
import path from 'path';
import pLimit from 'p-limit';
import Icon from './icon.js';
import http from 'http';
import Reader from '../reader/reader.js';
import closed from '../on-closed/on-closed.js';
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import { stringify } from '../serialize/serialize.js'

class IconDefault {
    constructor() {
        this.defaultIconExtension = process.platform == 'win32' ? 'ico' : 'png';
    }
    prepareDefaultName(terms) {
        if (!Array.isArray(terms)) {
            terms = lists.tools.terms(terms);
        }
        return sanitize(terms.filter(s => s.length && !s.startsWith('-')).join('-'));
    }
    getDefaultFile(terms) {
        return new Promise((resolve, reject) => {
            if (!terms || !terms.length) {
                return resolve(false);
            }            
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + '/' + name;
            fs.stat(file, (err, stat) => {
                if (stat && stat.size >= 32) {
                    resolve(file);
                } else {
                    resolve(false);
                }
            });
        });
    }
    async saveDefaultFile(terms, sourceFile) {        
        if (!lists.loaded() || !lists.activeLists.length) { // we may find a better logo later
            return false;
        }
        if (terms && terms.length) {
            let err, name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + '/' + name;
            if (this.opts.debug) {
                console.log('saveDefaultFile', terms, name, sourceFile, file);
            }            
            await fs.promises.stat(sourceFile).catch(e => err = e);
            if (!err)
                await fs.promises.copyFile(sourceFile, file);
        }
    }
    getDefaultIcon(terms) {
        return new Promise(resolve => {
            if (!terms || !terms.length) {
                return resolve(false);
            }            
            let name = this.prepareDefaultName(terms) + '.icon.' + this.defaultIconExtension, file = this.opts.folder + '/' + name;
            fs.stat(file, (err, stat) => {
                if (stat && stat.size >= 32) {
                    resolve(file);
                } else {
                    resolve(false);
                }
            });
        });
    }
    async saveDefaultIcon(terms, sourceFile, force) {  
        if (force || !lists.loaded() || !lists.activeLists.length) { // we may find a better logo later
            return false;
        }
        if (terms && terms.length) {
            let err, name = this.prepareDefaultName(terms) + '.icon.' + this.defaultIconExtension, file = this.opts.folder + '/' + name;
            if (this.opts.debug) {
                console.log('saveDefaultFile', terms, name, sourceFile, file);
            }            
            await fs.promises.stat(sourceFile).catch(e => err = e);
            if (!err)
                await fs.promises.copyFile(sourceFile, file);
            return file;
        }
    }
    async adjust(file, options) {
        return this.limiter.adjust(async () => {
            let opts = {
                autocrop: config.get('autocrop-logos')
            };
            if (options) {
                Object.assign(opts, options);
            }
            return imp.transform(file, opts)
        })
    }
}
class IconSearch extends IconDefault {
    constructor() {
        super()
        this.trendingIcons = {}
        renderer.ready(() => {
            global.channels.trending.on('update', () => this.updateTrendingIcons())
            this.updateTrendingIcons()
        })
    }
    updateTrendingIcons() {
        if(!global.channels.trending.currentRawEntries) return
        this.trendingIcons = {}
        global.channels.trending.currentRawEntries.forEach(e => {
            if (e.icon) {
                if(typeof(this.trendingIcons[e.icon]) == 'undefined') {
                    this.trendingIcons[e.icon] = 1
                } else {
                    this.trendingIcons[e.icon]++
                }
            }
        })
    }
    seemsLive(e) {        
        return (e.gid || lists.mi.isLive(e.url)) ? 1 : 0; // gid here serves as a hint of a live stream
    }
    async search(ntms) {
        if (this.opts.debug) {
            console.log('icons.search', ntms)
        }
        if (this.opts.debug) {
            console.log('is channel', ntms)
        }            
        let images = []
        let ret = await lists.search(ntms, {
            type: 'live',
            withIconOnly: true,
            safe: !lists.parentalControl.lazyAuth()
        })
        if (this.opts.debug) {
            console.log('fetch from terms', ntms, JSON.stringify(ret));
        }
        if (!ret.length) {
            return [];
        }
        const already = {}, alreadySources = {};
        ret = ret.map((e, i) => {
            if (typeof(already[e.icon]) == 'undefined') {
                already[e.icon] = i;
                alreadySources[e.icon] = [e.source];
                return {
                    icon: e.icon,
                    live: this.seemsLive(e) ? 1 : 0,
                    hits: 1,
                    trending: this.trendingIcons[e.icon] || 0,
                    epg: 0
                };
            } else {
                if (!alreadySources[e.icon].includes(e.source)) {
                    alreadySources[e.icon].push(e.source);
                    ret[already[e.icon]].hits++;
                }
                if (!ret[already[e.icon]].live && this.seemsLive(e)) {
                    ret[already[e.icon]].live = true;
                }
            }
        }).filter(e => !!e);
        ret = ret.sortByProp('hits', true).sortByProp('live', true); // gid here serves as a hint of a live stream
        if (this.opts.debug) {
            console.log('search() result', ret);
        }
        images.push(...ret);
        return images
    }
}
class IconServerStore extends IconSearch {
    constructor() {
        super();
        this.ttlCache = 24 * 3600
        this.ttlBadCache = 600
        this.activeDownloads = {}
        this.downloadErrors = {}
    }
    key(url) {
        return crypto.createHash('md5').update(url).digest('hex');
    }
    isHashKey(key) {
        return key.length == 32 && !key.includes(',');
    }
    validate(content) {
        if (content && content.length > 25) {
            const jsign = content.readUInt16BE(0);
            if (jsign === 0xFFD8) {
                return 1; // is JPEG
            } else {
                const gsign = content.toString('ascii', 0, 3);
                if (gsign === 'GIF') {
                    if (content.length > (512 * 1024)) { // 512kb
                        return 0; // avoid huge GIFs
                    } else {
                        return 1;
                    }
                }
            }
            const magic = content.toString('hex', 0, 4);
            if (magic === '89504e47') {
                // PNG: 89 50 4E 47
                const chunkType = content.toString('ascii', 12, 16);
                if (chunkType === 'IHDR') {
                    const colorType = content.readUInt8(25);
                    const hasAlphaChannel = (colorType & 0x04) !== 0;
                    if (hasAlphaChannel) {
                        // PNG has alpha channel - check for actual transparency
                        // Ultra-light check: look for tRNS chunk (transparency)
                        if (content.includes(Buffer.from('tRNS'))) {
                            return 2; // Has transparency chunk
                        }
                        
                        // For PNG with alpha channel, assume NO transparency by default
                        // Canvas detection will handle actual transparency checking
                        return 1; // Valid PNG with alpha channel, but no transparency detected
                    }
                }
                return 1;
            } else if (magic === '52494646') {
                // RIFF format (WEBP, AVI, etc.): 52 49 46 46
                const format = content.toString('ascii', 8, 12);
                if (format === 'WEBP') {
                    // WEBP can have alpha - check for VP8X chunk (extended format)
                    if (content.length >= 30) {
                        const chunkType = content.toString('ascii', 12, 16);
                        if (chunkType === 'VP8X') {
                            const flags = content.readUInt8(20);
                            const hasAlpha = (flags & 0x10) !== 0; // Alpha bit
                            if (hasAlpha) {
                                return 2; // valid, has alpha
                            }
                        }
                    }
                    return 1; // WEBP without alpha
                }
                return 1; // Other RIFF formats are valid
            } else if (magic === '424d') {
                // BMP: 42 4D (BM)
                return 1; // BMP is valid
            } else if (magic === '47494638' || magic === '47494637') {
                // GIF: 47 49 46 38 (GIF8) or 47 49 46 37 (GIF7)
                // GIF can have transparency - check packed field
                if (content.length >= 11) {
                    const packed = content.readUInt8(10);
                    const hasGlobalColorTable = (packed & 0x80) !== 0;
                    const globalColorTableSize = 2 << (packed & 0x07);
                    
                    // Check if there's a transparent color index
                    if (hasGlobalColorTable && content.length >= 14 + globalColorTableSize) {
                        const transparentColorFlag = content.readUInt8(11);
                        if ((transparentColorFlag & 0x01) !== 0) {
                            return 2; // GIF with transparency
                        }
                    }
                }
                return 1; // GIF without transparency
            } else if (magic === '49492a00' || magic === '4d4d002a') {
                // TIFF: 49 49 2A 00 (little endian) or 4D 4D 00 2A (big endian)
                // TIFF can have alpha - check photometric interpretation
                if (content.length >= 20) {
                    const isLittleEndian = magic === '49492a00';
                    let ifdOffset;
                    if (isLittleEndian) {
                        ifdOffset = content.readUInt32LE(4);
                    } else {
                        ifdOffset = content.readUInt32BE(4);
                    }
                    
                    if (ifdOffset && content.length >= ifdOffset + 12) {
                        // Look for PhotometricInterpretation tag (tag 262)
                        // This is a simplified check - full TIFF parsing is complex
                        // For now, assume TIFF can have alpha if it's large enough
                        if (content.length > 1000) {
                            return 2; // Assume large TIFF might have alpha
                        }
                    }
                }
                return 1; // TIFF without alpha
            } else if (content.length >= 4 && content.toString('ascii', 0, 4) === 'GIF8') {
                // Alternative GIF detection - use same logic as above
                if (content.length >= 11) {
                    const packed = content.readUInt8(10);
                    const hasGlobalColorTable = (packed & 0x80) !== 0;
                    const globalColorTableSize = 2 << (packed & 0x07);
                    
                    if (hasGlobalColorTable && content.length >= 14 + globalColorTableSize) {
                        const transparentColorFlag = content.readUInt8(11);
                        if ((transparentColorFlag & 0x01) !== 0) {
                            return 2; // GIF with transparency
                        }
                    }
                }
                return 1; // GIF without transparency
        } else if (content.length >= 8 && content.toString('ascii', 1, 4) === 'PNG') {
            // Alternative PNG detection (89 PNG) - use same logic as above
            if (content.length >= 29) {
                const colorType = content.readUInt8(25);
                const hasAlpha = (colorType & 0x04) !== 0;
                if (hasAlpha) {
                    // Check for tRNS chunk for actual transparency
                    if (content.includes(Buffer.from('tRNS'))) {
                        return 2; // Has transparency chunk
                    }
                    return 1; // PNG with alpha channel, but no transparency detected
                }
            }
            return 1; // PNG without alpha
            } else {
                console.error('BAD MAGIC', magic, content);
            }
        }
    }
    async validateFile(file) {
        let err
        await fs.promises.access(file, fs.constants.R_OK)
        const readSize = 32, content = Buffer.alloc(readSize)
        const fd = await fs.promises.open(file, 'r')
        const { bytesRead } = await fd.read(content, 0, readSize, 0).catch(e => err = e)
        await fd.close()
        if(err) throw err
        return this.validate(content.slice(0, bytesRead))
    }
    async serve(file) {
        // Serve a local file through the icon server
        // Extract the key from the file path instead of generating a new one
        const filename = file.split('/').pop().split('\\').pop(); // Handle both / and \
        const key = filename.replace('icons-cache-', '').replace('.dat', '');
        return this.url + 'icons-cache-' + key + '.dat';
    }
    async checkCache(key) {
        const has = await storage.exists('icons-cache-' + key)
        if (has !== false) {
            const resolved = storage.resolve('icons-cache-' + key);
            return resolved;
        }
        throw 'no http cache'
    }
    async saveCacheExpiration(key, valid) {
        const file = storage.resolve('icons-cache-' + key);
        if (typeof(valid) != 'boolean') {
            const stat = await fs.promises.stat(file).catch(() => false);
            valid = stat && stat.size && stat.size > 25
        }
        const time = valid ? this.ttlCache : this.ttlBadCache;
        storage.setTTL('icons-cache-' + key, time);
    }
    async fetchURL(url) {
        const now = time()
        if (this.downloadErrors[url] && this.downloadErrors[url].ttl > now) {
            throw this.downloadErrors[url].error
        }
        const suffix = 'data:image/png;base64,';
        if (String(url).startsWith(suffix)) {            
            const key = this.key(url);
            const buffer = Buffer.from(url.substr(suffix.length), 'base64');
            const storageFile = storage.resolve('icons-cache-' + key);
            
            // Save buffer directly to file and register path in storage
            await storage.set('icons-cache-' + key, buffer, {ttl: this.ttlCache });
            this.opts.debug && console.log('FETCHED ' + url + ' => ' + storageFile);
            const ret = await this.validateFile(storageFile);
            
            // Use canvas-based transparency detection for more accuracy
            let alpha = ret == 2;
            if (alpha && ret == 2) {
                try {
                    const canvasResult = await imp.hasTransparency(storageFile);
                    alpha = canvasResult;
                } catch (err) {
                    console.log('Canvas transparency check failed, using file-based detection:', err.message);
                    // Keep the file-based detection as fallback
                }
            }
            
            return { key, file: storageFile, alpha };
        }
        if (typeof(url) != 'string' || !url.includes('//')) {
            throw 'bad url ' + stringify(url);
        }
        const key = this.key(url);
        if (this.opts.debug) {
            console.warn('WILLFETCH', url);
        }
        let err;
        const cfile = await this.checkCache(key).catch(e => err = e);
        if (!err) { // has cache
            if (this.opts.debug) {
                console.log('fetchURL', url, 'cached');
            }
            const ret = await this.validateFile(cfile).catch(e => {
                this.opts.debug && console.warn('Icon server validateFile failed', cfile, e);
                err = e;
            });
            if (!err) {
                return { key, file: cfile, alpha: ret == 2 };
            }
        }
        if (this.opts.debug) {
            console.log('fetchURL', url, 'request', err);
        }
        const storageFile = storage.resolve('icons-cache-' + key);
        err = null;
        await this.limiter.download(async () => {
            if(!this.activeDownloads[url]) {
                // Try different header strategies for different domains
                const urlObj = new URL(url);
                const domain = urlObj.hostname;
                
                // Strategy 1: Full browser headers (default)
                let headers = {
                    'content-encoding': 'identity',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9,pt;q=0.8',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'Sec-Fetch-Dest': 'image',
                    'Sec-Fetch-Mode': 'no-cors',
                    'Sec-Fetch-Site': 'cross-site',
                    'Sec-Ch-Ua': '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
                    'Sec-Ch-Ua-Mobile': '?0',
                    'Sec-Ch-Ua-Platform': '"Windows"',
                    'DNT': '1',
                    'Connection': 'keep-alive',
                    'Upgrade-Insecure-Requests': '1'
                };
                
                // Add referer for specific domains that need it
                if (domain.includes('github.com') || domain.includes('raw.githubusercontent.com')) {
                    headers['Referer'] = 'https://github.com/';
                } else if (domain.includes('imgur.com') || domain.includes('i.imgur.com')) {
                    headers['Referer'] = 'https://imgur.com/';
                } else if (domain.includes('wikipedia.org') || domain.includes('wikimedia.org')) {
                    headers['Referer'] = 'https://www.wikipedia.org/';
                } else if (domain.includes('epg.best')) {
                    headers['Referer'] = 'https://epg.best/';
                } else {
                    headers['Referer'] = urlObj.origin + '/';
                }
                
                this.activeDownloads[url] = Download.file({
                    url,
                    file: storageFile,
                    retries: 2,
                    timeout: 15,
                    maxContentLength: this.opts.maxContentLength,
                    headers,
                    cacheTTL: this.ttlBadCache
                }).catch(e => err = e)
            }
            await this.activeDownloads[url]
            delete this.activeDownloads[url]
        })
        if (err) {
            this.downloadErrors[url] = {error: String(err), ttl: time() + 60}
            const exists = await fs.promises.access(storageFile).catch(() => false);
            if (exists) {
                await fs.promises.unlink(storageFile).catch(err => console.error(err))
            }
            throw err
        }
        // Register the downloaded file path in storage
        await storage.touch('icons-cache-' + key, { ttl: this.ttlCache });
        await this.saveCacheExpiration(key, true);
        const ret2 = await this.validateFile(storageFile);
        
        // Use canvas-based transparency detection for more accuracy
        let alpha = ret2 == 2;
        if (alpha && ret2 == 2) {
            try {
                const canvasResult = await imp.hasTransparency(storageFile);
                alpha = canvasResult;
            } catch (err) {
                console.log('Canvas transparency check failed, using file-based detection:', err.message);
                // Keep the file-based detection as fallback
            }
        }
        
        const atts = { key, file: storageFile, alpha };
        if (this.opts.debug) {
            console.log('fetchURL', url, 'validated');
        }
        return Object.assign({}, atts);
    }
}
class IconServer extends IconServerStore {
    constructor() {
        super();
        const { data } = paths;
        this.opts = {
            addr: '127.0.0.1',
            port: 0,
            maxContentLength: 1 * (1024 * 1024),
            folder: data + '/icons',
            debug: false
        };
        this.opts.folder = forwardSlashes(path.resolve(this.opts.folder));
        
        fs.access(this.opts.folder, err => {
            if (err !== null) {
                fs.mkdir(this.opts.folder, () => {});
            }
        });
        this.closed = false;
        this.server = false;
        this.limiter = {
            download: pLimit(20),
            adjust: pLimit(2)
        };
        this.rendering = {};
        this.renderingPath = null;
        this._ready = new Promise(resolve => {
            this._resolveReady = resolve;
        });
        this.listen();
    }
    async ensureReady() {
        if (this.destroyed) {
            throw new Error('IconServer is destroyed');
        }
        return this._ready;
    }
    get(e, j) {
        if (!e) {
            console.error('[IconServer] get() called with null entry');
            return Promise.reject(new Error('Entry is null'));
        }
        if (this.destroyed) {
            console.error('[IconServer] get() called on destroyed IconServer');
            return Promise.reject(new Error('IconServer is destroyed'));
        }
        const icon = new Icon(e, this);

        icon.on('result', ret => this.result(e, e.path, j, ret))
        if(e.iconFallback) {
            icon.on('failed', () => {
                const ret = {url: e.iconFallback, force: true, alpha: true}
                this.result(e, e.path, j, ret)
            })
        }

        const promise = icon.get();
        promise.catch(err => console.error(err))
        promise.destroy = () => icon.destroy()
        promise.icon = icon;
        promise.entry = e;

        return promise
    }
    result(e, path, tabindex, ret) {
        if (this.destroyed || !ret || !ret.url) return;
        if (this.opts.debug) {
            console.error('ICON=' + (e.path || 'undefined') + ' (' + e.name + ', ' + tabindex + '), url=' + ret.url + ' alpha=' + ret.alpha)
        }
        if (e.name && path?.endsWith(e.name) && tabindex != -1) {
            path = path.substr(0, path.length - 1 - e.name.length)
        }
        renderer.ui.emit('icon', { ...ret, path: path || '', tabindex, name: e.name});
    }
    listsLoaded() {        
        return lists.loaded() && lists.activeLists.length;
    }
    debug(...args) {
        osd.show(Array.from(args).map(s => String(s)).join(', '), 'fas fa-info-circle', 'active-downloads', 'persistent');
    }
    qualifyEntry(e) {
        if (!e || (e.class && e.class.includes('no-icon'))) {
            return false;
        }
        if (e.icon || e.programme) {
            return true;
        }
        const t = e.type || 'stream';
        if (t == 'stream' || ['entry-meta-stream', 'entry-icon'].some(c => {
            return e.class && e.class.includes(c);
        })) {
            return true;
        }
        if (t == 'action' && e.fa == 'fas fa-play-circle') {
            return true;
        }
    }
    addRenderTolerance(range, limit) {
        let vx = config.get('view-size').landscape.x;
        range.start = Math.max(range.start - vx, 0);
        range.end = Math.min(range.end + vx, limit);
        return range;
    }
    render(entries, path) {
        if (!config.get('show-logos'))
            return;
        let metrics = config.get('view-size').landscape, vs = metrics.x * metrics.y, range = {
            start: 0,
            end: vs
        };
        range = this.addRenderTolerance(range, entries.length);
        this.renderRange(range, path);
    }
    renderRange(range, path) {
        if (path == menu.path && Array.isArray(menu.pages[path])) {
            range = this.addRenderTolerance(range, menu.pages[path].length);
            if (path != this.renderingPath) {
                for(const r in this.rendering) {
                    this.rendering[r] && this.rendering[r].destroy()
                }
                this.rendering = {}
                this.renderingPath = path
                menu.pages[path].slice(range.start, range.end).map((e, i) => {
                    const j = range.start + i
                    if (this.qualifyEntry(e)) {
                        this.rendering[j] = this.get(e, j) // do not use then directly to avoid losing destroy method
                    } else {
                        this.rendering[j] = null
                    }
                })
            } else {
                for(const i in this.rendering) {
                    const n = parseInt(i)
                    if (i != -1 && this.rendering[i] && (n < range.start || n > range.end)) {
                        this.rendering[i].destroy()
                        delete this.rendering[i]
                    }
                }
                menu.pages[path].slice(range.start, range.end).map((e, i) => {
                    const j = range.start + i;
                    if ((!this.rendering[j] || this.rendering[j].entry.name != e.name) && this.qualifyEntry(e)) {
                        this.rendering[j] = this.get(e); // do not use then directly to avoid losing destroy method
                    }
                })
            }
        }
    }
    listen() {
        if (!this.server) {
            if (this.server) {
                this.server.close();
            }
            this.server = http.createServer((req, response) => {
                this.opts.debug && console.log('Icon server request received', req.method, req.url, 'from', req.headers['user-agent']);
                if (this.opts.debug) {
                    console.log('req starting...', req.url);
                }
                if (req.method == 'OPTIONS') {
                    this.opts.debug && console.log('Icon server OPTIONS request, returning 200');
                    response.writeHead(200, prepareCORS({
                        'Content-Length': 0,
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    }, req));
                    response.end();
                    return;
                }
                if (this.closed) {
                    this.opts.debug && console.log('Icon server already closed, returning 200');
                    response.writeHead(200, prepareCORS({
                        'Content-Length': 0,
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    }, req));
                    response.end();
                    return;
                }
                const key = req.url.split('/').pop().split('.')[0].replace('icons-cache-', '');
                const send = file => {
                    if (file) {
                        if (this.opts.debug) {
                            console.log('get() resolved', file);
                        }
                        response.writeHead(200, prepareCORS({
                            'Connection': 'close',
                            'Cache-Control': 'max-age=0, no-cache, no-store',
                            'Content-Type': 'image/png'
                        }, req));
                        const stream = new Reader(file)
                        stream.on('data', c => response.write(c))
                        closed(req, response, stream, () => {
                            stream.destroy()
                            response.end()
                        });
                    } else {
                        if (this.opts.debug) {
                            console.log('BADDATA', file);
                        }
                        console.error('icons.get() not validated', req.url, file);
                        response.writeHead(404, prepareCORS({
                            'Content-Length': 0,
                            'Connection': 'close',
                            'Cache-Control': 'max-age=0, no-cache, no-store'
                        }, req));
                        response.end();
                    }
                }
                if (this.opts.debug) {
                    console.log('serving', req.url, key);
                }
                this.opts.debug && console.log('Icon server request for', req.url, 'key', key, 'isHashKey', this.isHashKey(key), 'key length', key.length);
                const onerr = err => {
                    console.error('icons.get() catch', err, req.url);
                    if (this.opts.debug) {
                        console.log('get() catch', err, req.url);
                    }
                    // Return 404 for missing cache files, not 403
                    response.writeHead(404, prepareCORS({
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    }, req));
                    response.end();
                };
                if (this.isHashKey(key)) {
                    this.checkCache(key).then(send).catch(onerr);
                } else {
                    this.getDefaultFile(decodeURIComponentSafe(key).split(',')).then(send).catch(onerr);
                }
            }).listen(this.opts.port, this.opts.addr, err => {
                if (err) {
                    console.error('unable to listen on port', err);
                    return;
                }
                this.opts.port = this.server.address().port;
                this.url = 'http://' + this.opts.addr + ':' + this.opts.port + '/';
                this.opts.debug && console.log('Icon server started on', this.url);
                if (this._resolveReady) {
                    this._resolveReady();
                    this._resolveReady = null;
                }
            });
        }
    }
    refresh() {
        Object.values(this.rendering).forEach(r => r && r.destroy())
        this.rendering = {}
        this.render(menu.pages[menu.path], menu.path)
    }
    destroy() {
        if (this.opts.debug) {
            console.log('closing...');
        }
        this.closed = true;
        
        // Clear all rendering icons
        Object.values(this.rendering).forEach(r => r && r.destroy());
        this.rendering = {};
        this.renderingPath = null;
        
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        
        // Clear other references
        this.opts = null;
        this.url = null;
        if (this._resolveReady) {
            this._resolveReady();
            this._resolveReady = null;
        }
        
        this.removeAllListeners();
    }
}
export default new IconServer();
