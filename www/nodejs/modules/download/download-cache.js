import storage from '../storage/storage.js'
import { EventEmitter } from 'events';
import Reader from '../reader/reader.js';
import Writer from '../writer/writer.js';
import fs from 'fs';
import config from '../config/config.js'

const url2id = url => {
    return 'dlc-' + url.replace(new RegExp('^https?://'), '').replace(new RegExp('[^A-Za-z0-9]+', 'g'), '-').substr(0, 255);
};
class DownloadCacheFileReader extends EventEmitter {
    constructor(master, opts) {
        super();
        this.file = master.file;
        this.opts = opts;
        this.opts.persistent = !master.finished;
        master.once('finish', () => {
            this.opts.persistent = false;
            this.stream && this.stream.endPersistence();
        });
        master.once('error', err => {
            this.listenerCount('error') && this.emit('error', err);
            this.destroy();
        });
        this.once('close', () => this.destroy());
        process.nextTick(() => this.init());
    }
    init() {
        this.stream = new Reader(this.file, this.opts);
        ['data', 'end', 'error', 'finish', 'close'].forEach(n => this.forward(n));
    }
    forward(name) {
        this.stream.on(name, (...args) => this.listenerCount(name) && this.emit(name, ...args));
    }
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.emit('end');
        this.emit('close');
        this.emit('finish');
        this.removeAllListeners();
        this.stream && this.stream.close && this.stream.close();
    }
}
/*
Cache saver to disk which allows to read it even while saving, with createReadStream()
*/
class DownloadCacheChunks extends EventEmitter {
    constructor(url) {
        super();
        this.setMaxListeners(99);
        this.folder = storage.opts.folder + '/';
        this.uid = url2id(url);
        this.file = storage.resolve(this.uid);
        this.size = 0;
        this.created = false;
        this.writer = new Writer(this.file);
        this.writer.once('open', () => {
            this.opened = true;
            this.emit('open');
        });
        this.writer.once('finish', () => this.finish());
    }
    push(chunk) {
        this.writer.write(chunk);
        this.size += chunk.length;
    }
    finish() {
        if (!this.ended) {
            this.end();
        } else if (!this.finished) {
            this.finished = true;
            this.emit('finish');
            this.destroy();
        }
    }
    fail(err) {
        this.error = err;
        this.emit('error', err);
        this.finish();
        fs.unlink(this.file, () => {});
    }
    end() {
        this.ended = true;
        this.writer.end();
        if (this.writer.finished)
            this.finish();
    }
    createReadStream(opts = {}) {
        return new DownloadCacheFileReader(this, opts);
    }
    destroy() {
        this.end();
    }
}
class DownloadCacheMap extends EventEmitter {
    constructor() {
        super();
        this.saving = {};
        this.debug = false;
        this.folder = storage.opts.folder + '/';
    }
    async info(url) {
        if (this.saving[url])
            return this.saving[url];
        const key = url2id(url);
        const hkey = 'dch-' + key.substr(4);
        if (!storage.index[key] || !storage.index[hkey]) {
            return null;
        }
        const info = await storage.get(hkey).catch(() => {});
        if (!info || !info.headers)
            return null;
        
        const file = storage.resolve(key);
        const stat = await fs.promises.stat(file).catch(() => {});
        if (!stat || typeof(stat.size) != 'number')
            return null;
        return {
            status: info.statusCode,
            headers: info.headers,
            size: info.size,
            type: 'file',
            file
        };
    }
    async invalidate(url) {
        if (this.saving[url]) {
            if (this.saving[url].chunks && this.saving[url].chunks.fail) {
                this.saving[url].chunks.fail('Removed')
            }
            delete this.saving[url]
        }
        const key = url2id(url)
        const hkey = 'dch-' + key.substr(4)
        await Promise.allSettled([
            storage.delete(key).catch(() => {}),
            storage.delete(hkey).catch(() => {})
        ])
    }
    save(downloader, chunk, ended) {
        if (!config.get('in-disk-caching-size'))
            return;
        if (downloader.requestingRange &&
            (downloader.requestingRange.start > 0 ||
                (downloader.requestingRange.end && downloader.requestingRange.end < (downloader.totalContentLength - 1)))) { // partial content request, skip saving
            return;
        }
        const opts = downloader.opts;
        const url = downloader.currentURL;
        if (typeof(this.saving[url]) == 'undefined') {
            const uid = url2id(url);
            const huid = 'dch-' + uid.substr(4);
            const time = parseInt((Date.now() / 1000));
            let ttl = time + opts.cacheTTL;
            if (downloader.lastHeadersReceived && typeof(downloader.lastHeadersReceived['x-cache-ttl']) != 'undefined') {
                const rttl = parseInt(downloader.lastHeadersReceived['x-cache-ttl']);
                if (rttl < ttl) {
                    ttl = rttl;
                }
            }
            const headers = downloader.lastHeadersReceived ? Object.assign({}, downloader.lastHeadersReceived) : {};
            const chunks = new DownloadCacheChunks(url);
            chunks.on('error', err => console.error('DownloadCacheChunks error: ' + err));
            if (headers['content-encoding']) {
                delete headers['content-encoding']; // already uncompressed
                if (headers['content-length']) {
                    delete headers['content-length']; // length uncompressed is unknown
                }
            }
            this.saving[url] = {
                type: 'saving',
                chunks,
                time,
                ttl,
                status: downloader.lastStatusCodeReceived,
                size: headers['content-length'] || false,
                headers,
                uid,
                huid,
                dlid: opts.uid
            };
        }
        if (this.saving[url] && this.saving[url].type == 'saving' && this.saving[url].dlid == opts.uid) {
            chunk && this.saving[url].chunks.push(chunk);
            if (ended) {
                const chunks = this.saving[url].chunks;
                const finish = () => {
                    if (!this.saving[url])
                        return;
                    const expectedLength = this.saving[url].size === false ? downloader.totalContentLength : chunks.size;
                    if (chunks.error) {
                        console.warn(chunks.error);
                        chunks.fail(chunks.error);
                        delete this.saving[url];
                    } else if ((this.saving[url].size === false && !expectedLength) || (expectedLength > chunks.size)) {
                        const err = 'Bad file size. Expected: ' + this.saving[url].size + ', expected*: ' + expectedLength + ', received: ' + chunks.size + ', discarding http cache.';
                        console.warn(err);
                        chunks.fail(err);
                        delete this.saving[url];
                    } else if (downloader.statusCode < 200 || downloader.statusCode > 400 || (downloader.errors.length && !downloader.received)) {
                        const err = 'Bad download. Status: ' + downloader.statusCode + ', received: ' + chunks.size;
                        console.warn(err);
                        chunks.fail(err);
                        delete this.saving[url];
                    } else {
                        const done = () => {
                            const size = chunks.size;
                            const ttl = this.saving[url].ttl;
                            storage.set(this.saving[url].huid, {
                                statusCode: this.saving[url].status,
                                headers: this.saving[url].headers,
                                compress: true,
                                size
                            }, { expiration: true });
                            storage.touch(this.saving[url].uid, {
                                raw: true,
                                size,
                                ttl,
                                file: chunks.file,
                                expiration: true
                            });
                            delete this.saving[url];
                        };
                        if (chunks.finished) {
                            done();
                        } else {
                            chunks.once('finish', done);
                            chunks.end();
                        }
                    }
                };
                if (chunks.finished) {
                    finish();
                } else {
                    chunks.on('finish', finish);
                }
                chunks.end();
            }
        }
    }
}
export default new DownloadCacheMap()
