import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import List from "./list.js";
import tools from "./tools.js";
import MediaURLInfo from "../streamer/utils/media-url-info.js";
import ParentalControl from "./parental-control.js";
import options from "./options.json" with { type: 'json' }
import ready from '../ready/ready.js'

export class Fetcher extends EventEmitter {
    constructor(url, atts, master) {
        super();
        this.progress = 0;
        this.atts = atts;
        this.url = url;
        this.playlists = [];
        this.master = master;
        this.ready = ready()
        process.nextTick(() => {
            this.start().catch(err => {
                if(!this.error) this.error = err
                console.error('Fetcher initialization error:', err)
            }).finally(() => {
                this.ready.done()
            })
        })
    }
    async start() {
        if(this.list) {
            return this.ready()
        }
        if(!this.master) {
            const error = new Error('Fetcher master not set - initialization failed')
            this.error = error
            throw error
        }
        if(!this.master.loader) {
            const error = new Error('Fetcher loader not set - master not properly initialized')
            this.error = error
            throw error
        }
        
        this.list = new List(this.url, this.master)
        try {
            await this.list.ready()
            if (!this.list.length) {
                const error = new Error('List is empty - no content available')
                this.error = error
                throw error
            }
        } catch (err) {
            console.error('Fetcher error', this.url, err)
            try {
                await this.master.loader.addListNow(this.url, this.atts)
                try {
                    this.list = new List(this.url, this.master)
                    return this.list.ready()
                } catch(e) { // will trigger outer catch
                    console.error('Fetcher error 2', this.url, e)
                    this.error = err
                    throw err
                }
            } catch(err) {
                console.error('Fetcher error 3', this.url, err)
                this.error = err
                if (this.list) {
                    this.list.destroy()
                }
                throw err
            }
        }
    }
    validateCache(content) {
        return typeof(content) == 'string' && content.length >= this.minDataLength;
    }
    async fetchAll() {
        await this.ready();
        if (this.error) {
            throw this.error
        }
        return this.list.fetchAll();
    }
    async getMap(map) {
        await this.ready();
        return this.list.getMap(map);
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
}
