import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

class Writer extends EventEmitter {
    constructor(file, opts) {
        super();
        this.setMaxListeners(20);
        this.autoclose = true;
        this.debug = false;
        this.file = file;
        this.opts = opts;
        this.written = 0;
        this.writable = true;
        this.writing = false;
        this.writeQueue = [];
        this.position = 0;
        this.prepare(() => this.emit('open'));
        this.uid = file +'-'+ (new Date()).getTime()
    }
    write(data, position) {
        if (this.destroyed)
            return;
        if (typeof(position) == 'undefined') {
            position = this.position;
            this.position += data.length;
        }
        this.writeQueue.push({ data, position });
        this.pump();
    }
    ready(cb) {
        const done = callback => {
            if (this.fd) {
                fs.close(this.fd, callback);
                this.fd = null;
            } else {
                callback();
            }
        };
        const run = callback => {
            if (this.writing || this.writeQueue.length) {
                this.once('drain', () => done(callback));
            } else {
                done(callback);
            }
        };
        if (cb) {
            run(cb);
        } else {
            return new Promise(resolve => run(resolve));
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    prepare(cb) {
        this.debug && console.log('writeat prepare', this.file)        
        fs.access(this.file, err => {
            this.debug && console.log('writeat prepared', this.file, err);
            if (err) {
                this.debug && console.log('writeat creating', this.file);
                fs.mkdir(path.dirname(this.file), { recursive: true }, () => {
                    fs.writeFile(this.file, '', cb);
                });
            } else {
                cb();
            }
        });
    }
    open(file = '', flags, cb) {
        if (this.fd) {
            cb(null);
        } else {            
            this.debug && console.log('writeat open', this.file);
            fs.open(this.file, flags, (err, fd) => {
                this.debug && console.log('writeat opened', this.file)
                this.fd = fd
                cb(err)
            })
        }
    }
    pump() {
        if (this.writing)
            return;
        if (!this.writeQueue.length)
            return this.emit('drain');
        this.writing = true;
        this.prepare(() => {
            this.open(undefined, 'r+', err => {
                this.debug && console.log('writeat opened*', this.file, err);
                if (err)
                    return this.fail(err);
                this._write(this.fd).catch(err => console.error(err)).finally(() => {
                    if (this.autoclose && this.fd) {                        
                        fs.close(this.fd, () => {})
                        this.fd = null;
                    }
                    this.writing = false;
                    this.emit('drain');
                });
            });
        });
    }
    async truncate(size) {
        let err;
        await this.ready()
        await fs.promises.truncate(this.file, size).catch(e => err = e)
        if (err) return this.fail(err)
        this.position = size
    }
    fsWrite(fd, data, offset, length, position) {
        return new Promise((resolve, reject) => {            
            fs.write(fd, data, offset, length, position, (err, writtenBytes) => {
                if (err)
                    return reject(err);
                resolve(writtenBytes);
            });
        });
    }
    async _write(fd) {        
        while (this.writeQueue.length) {
            let err;
            const current = this.writeQueue.shift();
            if (!Buffer.isBuffer(current.data))
                current.data = Buffer.from(current.data);
            this.debug && console.log('writeat writing', this.file, current);
            const len = current.data.length;
            const writtenBytes = await this.fsWrite(fd, current.data, 0, len, current.position).catch(e => err = e);
            if (err) {
                this.debug && console.error('writeat error: ' + String(err), err);
                if (this.destroyed)
                    return;
                let err;
                await fs.promises.stat(this.file).catch(e => err = e);
                if (err)
                    return this.fail(err);
                this.writeQueue.unshift(current);
                await this.sleep(250);
                continue;
            }
            this.written += writtenBytes;
            if (writtenBytes < len) {
                this.debug && console.warn('writeat written PARTIALLY', this.file);
                this.writeQueue.unshift({ data: current.data.slice(writtenBytes), position: current.position + writtenBytes });
                continue;
            }
            this.debug && console.log('writeat written', this.file);
        }
    }
    fail(err) {
        this.error = err;
        this.debug && console.log(err);
        this.listenerCount('error') && this.emit('error', err);
        this.close();
        this.writeQueue = [];
    }
    end() {
        this.writable = false
        this.finished = true
        this.ended = true
        this.ready(() => this.destroy())
    }
    close() {
        this.end()
    }
    destroy() {
        if(this.fd) {
            fs.close(this.fd, () => {})
            this.fd = null
        }
        this.destroyed = parseInt(((new Date()).getTime() - this.uid) / 1000)
        this.writeQueue = []                            
        this.emit('close')
        this.emit('destroy')
        this.removeAllListeners()
    }
}
export default Writer;
