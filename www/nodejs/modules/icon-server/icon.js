import channels from '../channels/channels.js'
import { EventEmitter } from 'events';
import pLimit from "p-limit";
import mega from "../mega/mega.js";
import lists from "../lists/lists.js";
import fs from "fs";
import config from "../config/config.js"

class IconFetcher extends EventEmitter {
    constructor() {
        super();
        this.isAlphaRegex = new RegExp('\.png', 'i');
        this.isNonAlphaRegex = new RegExp('\.(jpe?g|webp|gif)', 'i');
    }
    hasPriority(prev, next, images) {
        const prevImage = images.filter(m => m.icon == prev.icon)[0];
        const nextImage = images.filter(m => m.icon == next.icon)[0];
        if (prevImage.hits < nextImage.hits) {
            return true;
        } else if (prevImage.hits == nextImage.hits) {
            if (prevImage.trending < nextImage.trending) {
                return true;
            } else if (prevImage.trending == nextImage.trending) {
                if (!prevImage.epg && nextImage.epg) {
                    return true;
                } else {
                    if (!prevImage.live && nextImage.live) {
                        return true;
                    }
                }
            }
        }
    }
    async fetchFromTerms() {
        if (!this.terms || !this.terms.length)
            throw 'no terms, no url'
        let done;
        const images = await this.master.search(this.terms);
        if (this.master.opts.debug) {
            console.log('GOFETCH', images);
        }
        const results = {}, limit = pLimit(2);
        const tasks = images.map(image => {
            return async () => {
                if (image.icon.match(this.isNonAlphaRegex) && !image.icon.match(this.isAlphaRegex)) {
                    results[image.icon] = 'non alpha url'
                    return false // non alpha url
                }
                if (done && !this.hasPriority(done.image, image, images)) {
                    if (this.master.opts.debug) {
                        console.log('ICON DOWNLOADING CANCELLED');
                    }
                    results[image.icon] = 'already found and processed another image for this channel'
                    return false;
                }
                if (this.master.opts.debug) {
                    console.log('GOFETCH', image);
                }
                const ret = await this.master.fetchURL(image.icon);
                const key = ret.key;
                if (this.master.opts.debug) {
                    console.log('GOFETCH', image, 'THEN', ret.file);
                }
                const type = await this.master.validateFile(ret.file);
                if (type != 2) {
                    results[image.icon] = 'not an alpha png'
                    return false; // not an alpha png
                }
                if (done && !this.hasPriority(done.image, image, images)) {
                    if (this.master.opts.debug) {
                        console.warn('ICON ADJUSTING CANCELLED');
                    }
                    results[image.icon] = '** already found and processed another image for this channel'
                    return false;
                }
                const ret2 = await this.master.adjust(ret.file, { shouldBeAlpha: true, minWidth: 75, minHeight: 75 });
                await this.master.saveHTTPCacheExpiration(key);
                if (!done || this.hasPriority(done.image, image, images)) {
                    done = ret2;
                    if (!done.key) done.key = key
                    done.image = image;
                    done.url = this.master.url + done.key;
                    this.succeeded = true;
                    this.result = done;
                    results[image.icon] = 'OK'
                    this.emit('result', done);
                }
            };
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
        if (this.entry.programme && this.entry.programme.i) {
            let err;
            const ret = await this.master.fetchURL(this.entry.programme.i).catch(e => err = e);
            if (!err) {
                return [ret.key, true, ret.isAlpha]
            }
        }
        if (this.entry.icon) {
            let err;
            const ret = await this.master.fetchURL(this.entry.icon).catch(e => err = e);
            if (!err) {
                return [ret.key, true, ret.isAlpha]
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
            } else if (atts = mega.parse(this.entry.url)) {
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
                if (this.master.listsLoaded()) {
                    await this.master.saveDefaultFile(this.terms, ret.file);
                }
                return [ret.key, false, ret.isAlpha];
            }
        }
        throw 'icon not found';
    }
}
class Icon extends IconFetcher {
    constructor(entry, master) {
        super();
        this.master = master;
        this.entry = entry;
        this.start().catch(console.error);
    }
    async start() {
        let err;
        const ret = await this.resolve().catch(e => err = e);
        this.succeeded = Array.isArray(ret);
        if (this.succeeded) {
            const key = ret[0];
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
    }
}
export default Icon;
