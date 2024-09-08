import { EventEmitter } from "events";
import paths from "../paths/paths.js";
import Limiter from "../limiter/limiter.js";
import onexit from "node-cleanup";
import fs from "fs";
import zlib from "zlib";
import path from "path";
import config from "../config/config.js"
import { moveFile, parseJSON, rmdir } from '../utils/utils.js'

class StorageTools extends EventEmitter {
    constructor(opts) {
        super();
        const { data } = paths;
        this.opts = {
            main: false,
            debug: false,
            minIdleTime: 300,
            folder: data + '/storage',
            maxExpiration: 100 * (365 * (24 * 3600)),
            maxDiskUsage: config.get('in-disk-caching-size') * (1024 * 1024)
        };
        opts && Object.assign(this.opts, opts);
        this.indexFile = 'storage-index.json';
        this.locked = {};
        this.index = {};
        this.load();
        if (!this.opts.main)
            return;
        this.lastSaveTime = (Date.now() / 1000)
        this.saveLimiter = new Limiter(() => this.save(), 5000, true)
        this.alignLimiter = new Limiter(() => this.align(), 5000, true)
        process.nextTick(() => {
            onexit(() => this.saveSync());
        });
    }
    async cleanup() {
        const now = (Date.now() / 1000)
        const files = await fs.promises.readdir(this.opts.folder).catch(() => {})
        if (Array.isArray(files) && files.length) {
            let upgraded
            for (const file of files) {
                if (file == this.indexFile)
                    continue
                const ext = file.split('.').pop()
                const key = this.unresolve(file)
                if (ext == 'dat') {
                    if (this.index[key] && (this.index[key].permanent || this.index[key].expiration > now)) {
                        continue // fine
                    }
                    this.delete(key, this.opts.folder + '/' + file)
                } if (ext == 'commit') {
                    const ffile = this.opts.folder + '/' + file
                    const stat = await fs.promises.stat(ffile).catch(() => {})
                    if (stat && typeof (stat.size) == 'number') {
                        const mtime = stat.mtimeMs / 1000;
                        if ((now - mtime) > this.opts.minIdleTime) {
                            fs.promises.unlink(ffile, () => {}).catch(() => {})
                        }
                    }
                } else if (ext == 'json') {
                    upgraded = true
                    await this.upgrade(file)
                } else {
                    await fs.promises.unlink(this.opts.folder +'/'+ file).catch(() => {})
                }
            }
            upgraded && rmdir(this.opts.folder + '/dlcache', true).catch(console.error)
        }
    }
    async clear(force) {        
        for (const k of Object.keys(this.index)) {
            if (force || !this.index[k].permanent) {
                await fs.promises.unlink(this.resolve(k)).catch(() => {})
                delete this.index[k]
            }
        }
        this.saveLimiter.call()
    }
    async compress(data) {
        return await new Promise((resolve, reject) => {
            zlib.gzip(data, (err, result) => {
                if (err)
                    return reject(err)
                resolve(result)
            });
        });
    }
    async decompress(data) {
        return await new Promise((resolve, reject) => {
            zlib.gunzip(data, (err, result) => {
                if (err)
                    return reject(err)
                resolve(result)
            })
        })
    }
    async upgrade(ofile) {
        let reason = 'unknown'        
        const file = ofile.endsWith('.expires.json') ? ofile.replace('.expires.json', '.json') : ofile;
        const efile = file.replace('.json', '.expires.json');
        const tfile = file.replace('.json', '.dat');
        const key = this.unresolve(tfile);
        const tstat = await fs.promises.stat(this.opts.folder + '/' + tfile).catch(() => {});
        if (!tstat || typeof (tstat) != 'number') {
            let expiration = parseInt(await fs.promises.readFile(this.opts.folder + '/' + efile).catch(() => {}));
            if (!isNaN(expiration)) {
                let err;
                let content = await fs.promises.readFile(this.opts.folder + '/' + file).catch(e => err = e);
                if (!err && content) {
                    const movedToConfigKeys = ['bookmarks', 'history', 'epg-history'];
                    let raw = true;
                    try {
                        let parsed = JSON.parse(content);
                        content = parsed;
                        raw = false;
                    }
                    catch (e) {}
                    if (movedToConfigKeys.includes(key)) {
                        config.set(key, content);
                    } else {
                        await this.set(key, content, { expiration, raw });
                    }
                    await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
                    await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
                    console.error('+++++++ UPGRADED ' + tfile);
                    return; // upgraded
                } else {
                    reason = 'no content or error: ' + err;
                }
            } else {
                reason = 'bad expiration value';
            }
        } else {
            reason = 'newer file exists';
        }
        await fs.promises.unlink(this.opts.folder + '/' + file).catch(() => {});
        await fs.promises.unlink(this.opts.folder + '/' + efile).catch(() => {});
        console.error('+++++++ NOT UPGRADED ' + ofile + ' :: ' + reason);
    }
    size() {
        let usage = 0;
        Object.keys(this.index).forEach(k => {
            if (typeof (this.index[k].size) == 'number') {
                usage += this.index[k].size;
            }
        });
        return usage;
    }
}
class StorageIndex extends StorageTools {
    constructor(opts) {
        super(opts);
    }
    load() {
        let index        
        try {
            index = fs.readFileSync(this.opts.folder + '/' + this.indexFile, { encoding: 'utf8' })
        } catch (e) {}
        if (typeof (index) == 'string') {
            try {
                index = JSON.parse(index);
                Object.keys(index).forEach(k => {
                    if (!this.index[k] || this.index[k].time < index[k].time) {
                        this.index[k] = index[k]
                    }
                })
            } catch (e) {
                console.error(e)
            }
            this.opts.main && this.cleanup().catch(console.error)
        }
    }
    mtime(key) {
        if(key) {
            const file = this.resolve(key)
            return (
                async () => {
                    const stat = await fs.promises.stat(file).catch(() => {})
                    if (stat && typeof(stat.size) == 'number') {
                        const mtime = stat.mtimeMs / 1000
                        if(this.index[key]) {
                            if(!this.index[key].time || this.index[key].time < mtime) {
                                this.index[key].time = mtime
                            }
                        } else {
                            return mtime
                        }
                    }                
                    return this.index[key] ? this.index[key].time : 0
                }
            )()
        } else {
            const lastTouchTime = Math.max(...Object.keys(this.index).map(key => this.index[key].time)) || 0
            return Math.max(lastTouchTime, this.lastAlignTime || 0)
        }
    }
    async save() {
        if (this.mtime() < this.lastSaveTime)
            return
        const tmp = this.opts.folder +'/'+ parseInt(Math.random() * 100000) +'.commit'
        this.lastSaveTime = (Date.now() / 1000)
        await fs.promises.writeFile(tmp, JSON.stringify(this.index), 'utf8').catch(console.error)
        try {
            await fs.promises.rename(tmp, this.opts.folder +'/'+ this.indexFile)
        } catch (err) {
            fs.promises.unlink(tmp).catch(console.error)
            throw err
        }
    }
    saveSync() {
        if (this.mtime() < this.lastSaveTime)
            return
        this.lastSaveTime = (Date.now() / 1000)        
        const tmp = this.opts.folder + '/' + parseInt(Math.random() * 100000) + '.commit'
        fs.writeFileSync(tmp, JSON.stringify(this.index), 'utf8')
        try {
            fs.unlinkSync(this.opts.folder + '/' + this.indexFile)
            fs.renameSync(tmp, this.opts.folder + '/' + this.indexFile)
        } catch (e) {
            fs.unlinkSync(tmp)
        }
    }
    async align() {
        let left = this.opts.maxDiskUsage;
        const now = parseInt((Date.now() / 1000));
        this.lastAlignTime = now;
        for(const key of Object.keys(this.index)) {
            if(!this.index[key]) return // bad value or deleted in mean time
            if(!this.index[key].time || (now - this.index[key].time) > this.opts.minIdleTime) {
                await this.mtime(key) // update time for idle keys to ensure sync with workers
            }
        }
        const ordered = Object.keys(this.index).filter(a => {
            if(!this.index[a]) return // bad value or deleted in mean time
            if (this.index[a].permanent || this.locked[a]) {
                if (typeof (this.index[a].size) == 'number') {
                    left -= this.index[a].size
                }
                return false
            }
            return true
        }).sort((a, b) => {
            return (this.index[a].time > this.index[b].time) ? -1 : ((this.index[a].time < this.index[b].time) ? 1 : 0);
        });
        const removals = ordered.filter(key => {
            if(!this.index[key]) return // bad value or deleted in mean time
            if (this.index[key].expiration && (now > this.index[key].expiration)) {
                this.index[key].expired = true;
                return true // expired
            }
            const elapsed = now - this.index[key].time
            if (elapsed < this.opts.minIdleTime) {
                return false
            }
            if (typeof(this.index[key].size) == 'number') {
                left -= this.index[key].size
                return left <= 0
            }
            return false
        })
        for (const key of removals) {
            if(!this.index[key]) return // bad value or deleted in mean time
            const file = this.resolve(key)
            const size = this.index[key].size
            const elapsed = now - this.index[key].time
            const expired = this.index[key].expired ? ', expired' : ''
            // console.log('LRU cache eviction '+ key +' ('+ size + expired +') after '+ elapsed +'s idle')
            this.delete(key, file)
        }
        this.saveLimiter.call(); // always
    }
    async touch(key, atts, silent, skipAlign) {
        key = this.prepareKey(key);
        if (atts && atts.delete === true) { // IPC sync only
            if (this.index[key]) {
                delete this.index[key];
            }
            return;
        }
        const time = parseInt((Date.now() / 1000));
        if (!this.index[key]) {
            if (atts === false)
                return;
            this.index[key] = {};
        }
        const entry = this.index[key];
        if (!atts)
            atts = {};
        entry.time = time;
        if (atts.size === 'auto' || typeof (entry.size) == 'undefined') {            
            const stat = await fs.promises.stat(this.resolve(key)).catch(() => {})
            if (stat && stat.size) {
                atts.size = stat.size;
            } else {
                delete atts.size;
            }
        }
        atts = this.calcExpiration(atts || {}, entry);
        if (typeof(atts.expiration) != 'number' || !atts.expiration) {
            delete atts.expiration;
        }
        this.index[key] = Object.assign(entry, atts);
        silent || this.emit('touch', key, this.index[key]);
        if (!skipAlign && this.opts.main) { // only main process should align/save index, worker will sync through IPC		
            this.alignLimiter.call(); // will call saver when done
        }
    }
}
class StorageIO extends StorageIndex {
    constructor(opts) {
        super(opts);
    }
    async get(key, encoding) {
        key = this.prepareKey(key)
        if (!this.index[key])
            return null
        const row = this.index[key]
        // grab this row to mem to avoid losing it due to its deletion in meanwhile, maybe using a lock() would be better
        if (encoding !== null && typeof (encoding) != 'string') {
            if (row.compress) {
                encoding = null
            } else {
                encoding = 'utf-8'
            }
        }
        await this.touch(key, false) // wait writing on file to finish before to re-enable access
        await this.lock(key, false)
        const now = (Date.now() / 1000)
        if (row.expiration < now)
            return null        
        const file = this.resolve(key);
        const stat = await fs.promises.stat(file).catch(() => {});
        const exists = stat && typeof (stat.size) == 'number';
        if (exists) {
            let err;
            await this.touch(key, { size: stat.size });
            let content = await fs.promises.readFile(file, { encoding }).catch(e => err = e);
            if (!err) {
                if (row.compress) {
                    content = await this.decompress(content)
                }
                if (row.raw) {
                    return content;
                } else {
                    if (Buffer.isBuffer(content)) { // is buffer
                        content = String(content);
                    }
                    if (content != 'undefined') {
                        try {
                            let j = parseJSON(content);
                            if (j && j != null) {
                                return j;
                            }
                        }
                        catch (e) {}
                    }
                }
            }
        }
        return null;
    }
    async set(key, content, atts) {
        key = this.prepareKey(key);
        const lock = await this.lock(key, true), t = typeof (atts);
        if (t == 'boolean' || t == 'number') {
            if (t == 'number') {
                atts += (Date.now() / 1000);
            }
            atts = { expiration: atts };
        }
        if (atts.encoding !== null && typeof (atts.encoding) != 'string') {
            if (atts.compress) {
                atts.encoding = null;
            } else {
                atts.encoding = 'utf-8';
            }
        }
        let file = this.resolve(key);
        if (atts.raw && typeof (content) != 'string' && !Buffer.isBuffer(content))
            atts.raw = false;
        if (!atts.raw)
            content = JSON.stringify(content);
        if (atts.compress)
            content = await this.compress(content);
        await this.write(file, content, atts.encoding).catch(console.error);
        await this.touch(key, Object.assign(atts, { size: content.length }));
        lock.release()
    }
    calcExpiration(atts, prevAtts) {
        if (typeof (atts.expiration) == 'number') return atts
        const now = (Date.now() / 1000)
        if (typeof (atts.ttl) == 'number') {
            atts.expiration = now + atts.ttl;
            delete atts.ttl;
        } else if (!atts.expiration && !atts.permanent) {
            atts.expiration = now + 600; // default = 10min
            if (prevAtts && prevAtts.expiration > atts.expiration) {
                atts.expiration = prevAtts.expiration;
            }
        } else {
            atts.expiration = now + this.opts.maxExpiration; // true = forever (100 years)
        }
        return atts;
    }
    setTTL(key, expiration) {
        if (expiration === false) {
            expiration = 600 // default = 10min
        } else if (expiration === true || typeof (expiration) != 'number') {
            expiration = this.opts.maxExpiration // true = forever (100 years)
        }
        expiration = (Date.now() / 1000) + expiration
        this.touch(key, { size: 'auto', expiration })
    }
    expiration(key) {
        key = this.prepareKey(key)
        if (this.index[key] && this.index[key].expiration) {
            return this.index[key].expiration
        }
        return 0;
    }
    async exists(key) {
        key = this.prepareKey(key);
        if (this.has(key)) {            
            const file = this.resolve(key);
            const stat = await fs.promises.stat(file).catch(() => {});
            if (stat && typeof (stat.size) == 'number') {
                return true;
            }
        }
        return false;
    }
    has(key) {
        key = this.prepareKey(key);
        if (!this.index[key])
            return false;
        const expiral = this.expiration(key);
        return (expiral > (Date.now() / 1000));
    }
    async write(file, content, enc) {
        if (typeof (content) == 'number') {
            content = String(content);
        }        
        const tmpFile = path.join(path.dirname(file), String(parseInt(Math.random() * 1000000))) + '.commit';
        await fs.promises.writeFile(tmpFile, content, enc);
        await moveFile(tmpFile, file)
    }
    async delete(key, removeFile) {
        key = this.prepareKey(key)        
        const file = this.resolve(key) // before deleting from index
        if (this.index[key])
            delete this.index[key]
        this.emit('touch', key, { delete: true }) // IPC notify
        if (removeFile !== null)
            await fs.promises.unlink(file).catch(() => {})
        if (removeFile && removeFile != file)
            await fs.promises.unlink(removeFile).catch(() => {})
    }
}
class Storage extends StorageIO {
    constructor(opts) {
        super(opts)        
        fs.access(this.opts.folder, err => {
            if (err) {
                fs.mkdir(this.opts.folder, { recursive: true }, (err) => {
                    if (err) {
                        console.error(err)
                    }
                })
            }
        })
    }
    resolve(key) {
        key = this.prepareKey(key);
        if (this.index[key]) {
            if (this.index[key].file) { // still there?
                return this.index[key].file;
            }
        }
        return this.opts.folder +'/'+ key +'.dat'
    }
    unresolve(file) {
        const key = this.prepareKey(path.basename(file).replace(new RegExp('\\.(json|dat)$'), ''));
        this.touch(key, false); // touch to update entry time and so warmp up our interest on it
        return key;
    }
    prepareKey(key) {
        return String(key).replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr(0, 128);
    }
    lock(key, write) {
        return new Promise((resolve, reject) => {
            if (this.locked[key]) {
                this.once('unlock-' + key, () => {
                    this.lock(key, write).then(resolve).catch(reject); // call again to prevent concurrent writing
                });
            } else {
                if (write)
                    this.locked[key] = true;
                resolve({
                    release: () => {
                        if (write && this.locked[key]) {
                            delete this.locked[key];
                            this.emit('unlock-' + key);
                        }
                    }
                });
            }
        });
    }
}

export default new Storage({ main: !paths.inWorker })
