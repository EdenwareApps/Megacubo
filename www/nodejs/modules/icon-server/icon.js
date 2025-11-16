import channels from '../channels/channels.js'
import { EventEmitter } from 'node:events';
import pLimit from "p-limit";
import mega from "../mega/mega.js";
import lists from "../lists/lists.js";
import fs from "fs";
import config from "../config/config.js"

class IconFetcher extends EventEmitter {
    constructor() {
        super();
        this.isAlphaRegex = new RegExp('\\.(png|webp|gif)', 'i');
        this.isNonAlphaRegex = new RegExp('\\.(jpe?g)', 'i');
    }
    hasPriority(prevImage, nextImage, images) {
        if (!prevImage.alpha && nextImage.alpha) {
            return true
        } else if (prevImage.hits < nextImage.hits) {
            return true
        } else if (prevImage.hits == nextImage.hits) {
            if (!prevImage.epg && nextImage.epg) {
                return true
            } else {
                if (!prevImage.live && nextImage.live) {
                    return true
                }
            }
        }
    }
    async fetchFromTerms() {
        if (!this.terms || !this.terms.length)
            throw 'no terms, no url'
        let done;
        if (this.master?.ensureReady) {
            await this.master.ensureReady();
        }
        const images = await this.master.search(this.terms);
        if (this.master.opts.debug) {
            console.log('GOFETCH', images);
        }
        const results = {}, limit = pLimit(2);
        const tasks = images.map(image => {
            return async () => {
                try {
                    if (image.icon.match(this.isNonAlphaRegex) && !image.icon.match(this.isAlphaRegex)) {
                        results[image.icon] = 'non alpha url'
                        return false // non alpha url
                    }
                    if (done?.alpha && !this.hasPriority(done.image, image, images)) {
                        if (this.master.opts.debug) {
                            console.log('ICON DOWNLOADING CANCELLED');
                        }
                        results[image.icon] = 'already found and processed another image for this channel'
                        return false
                    }
                    if (this.master.opts.debug) {
                        console.log('GOFETCH', image)
                    }
                    const ret = await this.master.fetchURL(image.icon);
                    const key = ret.key;
                    if (this.master.opts.debug) {
                        console.log('GOFETCH', image, 'THEN', ret.file);
                    }
                    const type = await this.master.validateFile(ret.file);
                    if (type === 0) {
                        results[image.icon] = 'invalid image format'
                        return false; // invalid image format
                    }
                    // Accept PNGs with or without alpha channel (type 1 or 2)
                    if (type !== 1 && type !== 2) {
                        results[image.icon] = 'unsupported image format'
                        return false; // unsupported format
                    }
                    if (done?.alpha && !this.hasPriority(done.image, image, images)) {
                        if (this.master.opts.debug) {
                            console.warn('ICON ADJUSTING CANCELLED');
                        }
                        results[image.icon] = '** already found and processed another image for this channel'
                        return false;
                    }
                    const ret2 = await this.master.adjust(ret.file, { shouldBeAlpha: true, minWidth: 75, minHeight: 75 });
                    await this.master.saveCacheExpiration(key, true)
                    image.alpha = ret2.alpha
                    if (!done?.alpha || this.hasPriority(done.image, image, images)) {
                        done = ret2
                        if (!done.key) done.key = key
                        done.image = image
                        if (this.destroyed) {
                            throw new Error('Icon is destroyed');
                        }
                        done.url = this.master.url + done.key
                        this.succeeded = true
                        this.result = done
                        results[image.icon] = 'OK'
                        console.log('ICON EMIT', this.terms.join(','), done)
                        this.emit('result', done)
                    }
                } catch (error) {
                    // Capture all errors including timeouts, download failures, etc.
                    const errorMessage = error.message || error.toString() || 'Unknown error';
                    results[image.icon] = `error: ${errorMessage}`;
                    
                    if (this.master.opts.debug) {
                        console.log('ICON ERROR:', image.icon, error);
                    }
                    
                    // Add delay for rate limiting errors
                    if (errorMessage.includes('429') || errorMessage.includes('Forbidden')) {
                        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000)); // 2-5s delay
                    }
                    
                    return false
                }
            }
        }).map(limit);
        await Promise.allSettled(tasks);
        if (this.destroyed) throw 'destroyed'
        if (this.master.opts.debug) {
            console.log('GOFETCH', images, 'OK', done, this.destroyed);
        }
        if (done) return done
        throw 'Couldn\'t find a logo for: ' + JSON.stringify(this.terms) +"\r\n"+ JSON.stringify(results, null, 3)
    }
    async resolve() {
        if (!this.entry) {
            throw new Error('Icon entry is null');
        }
        if (this.entry.programme && this.entry.programme.icon) {
            let err;
            const ret = await this.master.fetchURL(this.entry.programme.icon).catch(e => err = e);
            if (!err) {
                return [ret.key, true, ret.alpha]
            }
        }
        if (this.entry.icon) {
            let err;
            const ret = await this.master.fetchURL(this.entry.icon).catch(e => err = e);
            if (!err) {
                return [ret.key, true, ret.alpha]
            } else if(this.entry.iconFallback) {
                this.emit('failed')
            }
        }
        if (!this.entry.class || !this.entry.class.includes('entry-icon-no-fallback')) {
            let atts;
            this.terms = channels.entryTerms(this.entry, true)
            this.isChannel = channels.isChannel(this.terms);
            if (this.isChannel) {
                this.terms = this.isChannel.terms;
            } else if (this.entry && this.entry.url && (atts = mega.parse(this.entry.url))) {
                if (!atts.terms) {
                    atts.terms = this.entry.name;
                }
                if (!Array.isArray(atts.terms)) {
                    atts.terms = lists.tools.terms(atts.terms);
                }
                this.terms = atts.terms;
            }
            if (this.destroyed)
                throw 'destroyed';
            const file = await this.master.getDefaultFile(this.terms);
            if (this.destroyed)
                throw 'destroyed';
            if (this.master.opts.debug) {
                console.log('get > getDefault', this.entry.icon, this.terms, file);
            }
            if (file) {
                let err;
                const noIcon = 'no-icon';
                const stat = await fs.promises.stat(file).catch(e => err = e);
                if (!err) {
                    if (stat.size == noIcon.length) {
                        throw 'icon not found';
                    } else {
                        return [this.terms.join(','), false, true];
                    }
                }
            }
            if (config.get('search-missing-logos')) {
                const ret = await this.fetchFromTerms();
                if (this.master.opts.debug) {
                    console.log('get > fetch', this.terms, ret);
                }
                if (ret.alpha && this.master.listsLoaded()) {
                    await this.master.saveDefaultFile(this.terms, ret.file);
                }
                return [ret.key, false, ret.alpha];
            }
        }
        throw 'icon not found';
    }
}
class Icon extends IconFetcher {
    constructor(entry, master) {
        super();
        if (!master) {
            throw new Error('Icon constructor: master is null');
        }
        if (!entry) {
            throw new Error('Icon constructor: entry is null');
        }
        this.master = master;
        this.entry = entry;
        this.start().catch(err => {
            if (!String(err).includes('destroyed')) {
                console.error('Icon error:', err)
            }
            this.destroy()
        });
    }
    async start() {
        let err;
        if (this.master?.ensureReady) {
            await this.master.ensureReady();
        }
        const ret = await this.resolve().catch(e => err = e);
        this.succeeded = Array.isArray(ret);
        if (this.succeeded) {
            const key = ret[0];
            if (this.destroyed) {
                throw new Error('Icon is destroyed');
            }
            const url = this.master.url + key;
            const force = ret[1];
            const alpha = ret[2];
            this.result = { key, url, force, alpha };
        } else {
            this.result = err;
        }
        this.emit('result', this.result);
    }
    get() {
        return new Promise((resolve, reject) => {
            let cb = () => {
                (this.succeeded ? resolve : reject)(this.result);
                cb = () => {};
            };
            if (typeof(this.result) != 'undefined') {
                cb();
            } else {
                this.once('result', cb);
            }
        });
    }
    destroy() {
        this.destroyed = true;
        
        // Clear all references to help garbage collection
        this.master = null;
        this.entry = null;
        this.result = null;
        this.terms = null;
        
        // Remove all event listeners
        this.removeAllListeners();
    }
}
export default Icon;
