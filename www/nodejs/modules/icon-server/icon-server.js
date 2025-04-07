import Download from '../download/download.js'
import { decodeURIComponentSafe, prepareCORS, sanitize, time } from '../utils/utils.js';
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
    search(ntms, liveOnly) {
        if (this.opts.debug) {
            console.log('icons.search', ntms)
        }
        return new Promise(resolve => {
            if (this.opts.debug) {
                console.log('is channel', ntms)
            }            
            let images = []
            const next = () => {
                lists.search(ntms, {
                    type: 'live',
                    safe: !lists.parentalControl.lazyAuth()
                }).then(ret => {
                    if (this.opts.debug) {
                        console.log('fetch from terms', ntms, liveOnly, JSON.stringify(ret));
                    }
                    if (ret.length) {
                        const already = {}, alreadySources = {};
                        ret = ret.filter(e => {
                            return e.icon && e.icon.includes('//');
                        });
                        if (this.opts.debug) {
                            console.log('fetch from terms', JSON.stringify(ret));
                        }
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
                    }
                }).catch(err => console.error(err)).finally(() => resolve(images));
            }
            lists.epgSearchChannelIcon(ntms).then(srcs => images = srcs.map(src => {
                return { icon: src, live: true, hits: 1, trending: 1, epg: 1 };
            })).catch(err => console.error(err)).finally(next)
        });
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
    file(url, isKey) {
        return this.opts.folder + '/logo-' + (isKey === true ? url : this.key(url)) + '.cache';
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
                const chunkType = content.toString('ascii', 12, 16);
                if (chunkType === 'IHDR') {
                    const colorType = content.readUInt8(25);
                    const hasAlpha = (colorType & 0x04) !== 0;
                    if (hasAlpha) {
                        return 2; // valid, has alpha
                    }
                }
                return 1;
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
    resolve(key) {
        return storage.resolve('icons-cache-' + key)
    }
    async checkCache(key) {
        const has = await storage.exists('icons-cache-' + key)
        if (has !== false) {
            return this.resolve(key)
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
            const file = this.resolve(key);
            await fs.promises.writeFile(file, Buffer.from(url.substr(suffix.length), 'base64'));
            this.opts.debug && console.log('FETCHED ' + url + ' => ' + file);
            const ret = await this.validateFile(file);
            return { key, file, isAlpha: ret == 2 };
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
            const ret = await this.validateFile(cfile).catch(e => err = e);
            if (!err) {
                return { key, file: cfile, isAlpha: ret == 2 };
            }
        }
        if (this.opts.debug) {
            console.log('fetchURL', url, 'request', err);
        }
        const file = this.resolve(key);
        err = null;
        await this.limiter.download(async () => {
            if(!this.activeDownloads[url]) {
                this.activeDownloads[url] = Download.file({
                    url,
                    file,
                    retries: 2,
                    timeout: 10,
                    maxContentLength: this.opts.maxContentLength,
                    headers: {
                        'content-encoding': 'identity'
                    },
                    cacheTTL: this.ttlBadCache
                }).catch(e => err = e)
            }
            await this.activeDownloads[url]
            delete this.activeDownloads[url]
        })
        if (err) {
            this.downloadErrors[url] = {error: String(err), ttl: time() + 60}
            const exists = await fs.promises.access(file).catch(() => false);
            if (exists) {
                await fs.promises.unlink(file).catch(err => console.error(err))
            }
            throw err
        }
        await this.saveCacheExpiration(key, true);
        const ret2 = await this.validateFile(file);
        const atts = { key, file, isAlpha: ret2 == 2 };
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
        this.opts.folder = path.resolve(this.opts.folder);
        
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
        this.listen();
    }
    get(e, j) {
        const icon = new Icon(e, this);
        const promise = icon.get();
        promise.icon = icon;
        promise.entry = e;
        promise.catch(err => console.error(err))
        promise.destroy = () => icon.destroy()

        icon.on('result', ret => this.result(e, e.path, j, ret))
        if(e.iconFallback) {
            icon.on('failed', () => {
                const ret = {url: e.iconFallback, force: true, alpha: true}
                this.result(e, e.path, j, ret)
            })
        }

        return promise
    }
    result(e, path, tabindex, ret) {
        if (!this.destroyed && ret.url) {
            if (this.opts.debug) {
                console.error('ICON=' + e.path + ' (' + e.name + ', ' + tabindex + ') ' + ret.url)
            }
            if (path.endsWith(e.name) && tabindex != -1) {
                path = path.substr(0, path.length - 1 - e.name.length)
            }
            renderer.ui.emit('icon', {
                url: ret.url,
                path,
                tabindex,
                name: e.name,
                force: ret.force,
                alpha: ret.alpha
            });
        }
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
        if (e.icon || e.programme || e.side) {
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
                menu.pages[path].filter(e => !e.side).slice(range.start, range.end).map((e, i) => {
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
                menu.pages[path].filter(e => !e.side).slice(range.start, range.end).map((e, i) => {
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
                if (this.opts.debug) {
                    console.log('req starting...', req.url);
                }
                if (req.method == 'OPTIONS' || this.closed) {
                    response.writeHead(200, prepareCORS({
                        'Content-Length': 0,
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    }, req));
                    response.end();
                    return;
                }
                let key = req.url.split('/').pop(), send = file => {
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
                };
                if (this.opts.debug) {
                    console.log('serving', req.url, key);
                }
                const onerr = err => {
                    console.error('icons.get() catch', err, req.url);
                    if (this.opts.debug) {
                        console.log('get() catch', err, req.url);
                    }
                    response.writeHead(404, prepareCORS({
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    }, req));
                    response.end(err);
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
        if (this.server) {
            this.server.close();
            this.server = null;
        }
        this.removeAllListeners();
    }
}
export default new IconServer();
