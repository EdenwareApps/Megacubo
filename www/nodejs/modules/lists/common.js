import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import List from "./list.js";
import tools from "./tools.js";
import MediaURLInfo from "../streamer/utils/media-url-info.js";
import ParentalControl from "./parental-control.js";
import options from "./options.json" with { type: 'json' }

export class Fetcher extends EventEmitter {
    constructor(url, atts, master) {
        super();
        this.progress = 0;
        this.atts = atts;
        this.url = url;
        this.playlists = [];
        this.master = master;
        process.nextTick(() => {
            this.start().catch(err => {
                if(!this.error) this.error = err
            }).finally(() => {
                this.isReady = true
                this.emit('ready')
            })
        })
    }
    ready() {
        return new Promise(resolve => {
            if (this.isReady) {
                resolve()
            } else {
                this.once('ready', resolve)
            }
        });
    }
    async start() {
        if(!this.master) {
            throw new Error('Fetcher master not set')
        }
        this.list = new List(this.url, this.master)
        try {
            return await this.list.start()
        } catch (err) {
            if(!this.master.loader) {
                throw new Error('Fetcher loader not set')
            }
            try {
                await this.master.loader.addListNow(this.url, this.atts)
                try {
                    return await this.list.start()
                } catch(e) { // will trigger outer catch
                    console.error('Fetcher start error', e)
                    throw err
                }
            } catch(err) {
                console.error('Fetcher start error *', err)
                this.error = err
                this.list.destroy()
                throw err
            }
        }
    }
    validateCache(content) {
        return typeof(content) == 'string' && content.length >= this.minDataLength;
    }
    isLocal(file) {
        if (typeof(file) != 'string') {
            return;
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true;
        } else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true;
            }
        }
    }
    async fetchAll() {
        await this.ready();
        return await this.list.fetchAll();
    }
    async getMap(map) {
        await this.ready();
        return await this.list.getMap(map);
    }
    async meta() {
        await this.ready();
        return this.list.indexer.db?.index?.meta || {};
    }
    destroy() {
        this.list && this.list.destroy();
        this.updater && this.list.destroy();
    }
}

export class Common extends EventEmitter {
    constructor(opts) {
        super()
        this.opts = options;
        if (opts) {
            Object.keys(opts).forEach(k => {
                this[k] = opts[k];
            });
        }
        this.tools = tools;
        this.mi = new MediaURLInfo()
        this.parentalControl = new ParentalControl()
    }
    validateType(e, type, strict) {
        if (typeof(type) == 'string' && type) {
            switch (type) {
                case 'live':
                    if (strict) {
                        return this.mi.isLive(e.url);
                    } else {
                        let ext = this.mi.ext(e.url);
                        return !(this.mi.isVideo(e.url, ext) || this.mi.isAudio(e.url, ext));
                    }
                    break;
                case 'video':
                    if (strict) {
                        return this.mi.isVideo(e.url);
                    } else {
                        let ext = this.mi.ext(e.url);
                        return !(this.mi.isLive(e.url, ext) || this.mi.isAudio(e.url, ext));
                    }
                    break;
                case 'audio':
                    if (strict) {
                        return this.mi.isAudio(e.url);
                    } else {
                        let ext = this.mi.ext(e.url);
                        return this.mi.isAudio(e.url, ext) || !(this.mi.isLive(e.url, ext) || this.mi.isVideo(e.url, ext));
                    }
                    break;
            }
        }
        return true;
    }
    prepareEntry(e) {
        if (typeof(e._) == 'undefined' && typeof(e.terms) == 'undefined') {
            e.terms = {
                name: this.tools.terms(e.name),
                group: this.tools.terms(e.group || '')
            }
        }
        return e
    }
    prepareEntries(es) {
        return es.map(this.prepareEntry.bind(this))
    }
    listMetaKey(url) {
        return options.listMetaKeyPrefix + url
    }
    async getListMeta(url) {
        let haserr, meta = await storage.get(this.listMetaKey(url)).catch(err => {
            haserr = true
            console.error(err)
        });
        if (haserr || !meta) {
            meta = {}
        }
        return meta
    }
    async setListMeta(url, newMeta) {
        if (newMeta && typeof(newMeta) == 'object') {
            let changed, meta = await this.getListMeta(url);
            Object.keys(newMeta).forEach(k => {
                if (newMeta[k] && meta[k] !== newMeta[k]) {
                    meta[k] = newMeta[k];
                    if (!changed) {
                        changed = true;
                    }
                }
            });
            if (changed) {
                await storage.set(this.listMetaKey(url), meta, {
                    expiration: true
                });
            }
        }
    }
    async getListMetaValue(url, key) {
        const meta = await this.getListMeta(url);
        if (meta)
            return meta[key] || undefined;
    }
    async setListMetaValue(url, key, value) {
        const meta = await this.getListMeta(url);
        meta[key] = value;
        await this.setListMeta(url, meta);
    }
    isLocal(file) {
        if (typeof(file) != 'string') {
            return
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true
        } else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true
            }
        }
    }
}
