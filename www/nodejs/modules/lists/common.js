import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import List from "./list.js";
import parser from "./parser.js";
import tools from "./tools.js";
import MediaURLInfo from "../streamer/utils/media-url-info.js";
import ParentalControl from "./parental-control.js";
import data from "./search-redirects.json" assert {type: 'json'};
import countryCodes from '../countries/countries.json' assert {type: 'json'};

class Fetcher extends EventEmitter {
    constructor(url, atts, master) {
        super();
        this.progress = 0;
        this.atts = atts;
        this.url = url;
        this.playlists = [];
        this.master = master;
        process.nextTick(() => {
            this.start().catch(e => this.error = e).finally(() => {
                this.isReady = true;
                this.emit('ready');
            });
        });
    }
    ready() {
        return new Promise(resolve => {
            if (this.isReady) {
                resolve();
            }
            else {
                this.once('ready', resolve);
            }
        });
    }
    start() {
        return new Promise((resolve, reject) => {
            this.list = new List(this.url, this.master);
            this.list.skipValidating = true;
            this.list.start().then(resolve).catch(err => {
                this.error = err;
                this.master.loader.addListNow(this.url, this.atts).then(() => {
                    this.list.start().then(resolve).catch(err => {
                        this.error += ' ' + err;
                        this.list.destroy();
                        reject(err);
                    });
                }).catch(err => {
                    this.error += ' ' + err;
                    this.list.destroy();
                    reject(this.error);
                });
            });
        });
    }
    validateCache(content) {
        return typeof (content) == 'string' && content.length >= this.minDataLength;
    }
    isLocal(file) {
        if (typeof (file) != 'string') {
            return;
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true;
        }
        else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true;
            }
        }
    }
    async fetch() {
        await this.ready();
        return await this.list.fetchAll();
    }
    async getMap(map) {
        await this.ready();
        return await this.list.getMap(map);
    }
    async meta() {
        await this.ready();
        return this.list.index.meta || {};
    }
    destroy() {
        this.list && this.list.destroy();
        this.updater && this.list.destroy();
    }
}
class Common extends EventEmitter {
    constructor(opts) {
        super()
        this.Fetcher = Fetcher;
        this.listMetaKeyPrefix = 'meta-cache-';
        this.opts = {
            defaultCommunityModeReach: 12,
            folderSizeLimitTolerance: 12,
            offloadThreshold: 256
        };
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
        if (typeof (type) == 'string' && type) {
            switch (type) {
                case 'live':
                    if (strict) {
                        return this.mi.isLive(e.url);
                    }
                    else {
                        let ext = this.mi.ext(e.url);
                        return !(this.mi.isVideo(e.url, ext) || this.mi.isAudio(e.url, ext));
                    }
                    break;
                case 'video':
                    if (strict) {
                        return this.mi.isVideo(e.url);
                    }
                    else {
                        let ext = this.mi.ext(e.url);
                        return !(this.mi.isLive(e.url, ext) || this.mi.isAudio(e.url, ext));
                    }
                    break;
                case 'audio':
                    if (strict) {
                        return this.mi.isAudio(e.url);
                    }
                    else {
                        let ext = this.mi.ext(e.url);
                        return this.mi.isAudio(e.url, ext) || !(this.mi.isLive(e.url, ext) || this.mi.isVideo(e.url, ext));
                    }
                    break;
            }
        }
        return true;
    }
    prepareEntry(e) {
        if (typeof (e._) == 'undefined' && typeof (e.terms) == 'undefined') {
            e.terms = {
                name: this.tools.terms(e.name),
                group: this.tools.terms(e.group || '')
            };
        }
        return e;
    }
    prepareEntries(es) {
        return es.map(this.prepareEntry.bind(this));
    }
    listMetaKey(url) {
        return this.listMetaKeyPrefix + url;
    }
    async getListMeta(url) {
        let haserr, meta = await storage.get(this.listMetaKey(url)).catch(err => {
            haserr = true;
            console.error(err);
        });
        if (haserr || !meta) {
            meta = {};
        }
        return meta;
    }
    async setListMeta(url, newMeta) {
        if (newMeta && typeof (newMeta) == 'object') {
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
}
export default Common;
