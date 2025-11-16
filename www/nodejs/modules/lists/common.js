import { EventEmitter } from "events";
import List from "./list.js";
import tools from "./tools.js";
import MediaURLInfo from "../streamer/utils/media-url-info.js";
import ParentalControl from "./parental-control.js";
import options from "./options.json" with { type: 'json' }
import ready from '../ready/ready.js'
import { resolveListDatabaseFile } from './tools.js'
import { getListMeta } from './list-meta.js'

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
        return this.list.indexer.index?.meta || {};
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
        if (typeof(e.nameTerms) == 'undefined' || !Array.isArray(e.nameTerms) || e.nameTerms.length === 0) {
            e.nameTerms = this.tools.terms(e.name)
        }
        if (typeof(e.groupTerms) == 'undefined' || !Array.isArray(e.groupTerms) || e.groupTerms.length === 0) {
            if (typeof(e.group) !== 'string') {
                e.group = ''
            }
            e.groupTerms = this.tools.terms(e.group)
        }
        return e
    }
    prepareEntries(es) {
        return es.map(this.prepareEntry.bind(this))
    }
    
    async getUpdateAfter(url) {
        const meta = await getListMeta(url);
        return meta?.updateAfter;
    }
    
    async getContentLength(url) {
        const meta = await getListMeta(url);
        return meta?.contentLength;
    }
    
}

// Re-export resolveListDatabaseFile from tools.js
export { resolveListDatabaseFile } from './tools.js';
