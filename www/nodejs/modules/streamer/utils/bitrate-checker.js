import { kbfmt, kbsfmt } from '../../utils/utils.js'
import { EventEmitter } from "events";
import fs from "fs";
import ffmpeg from "../../ffmpeg/ffmpeg.js";

class BitrateChecker extends EventEmitter {
    constructor(opts = {}) {
        super();
        this.bitrates = [];
        this.bitrate = 0;
        this.minSampleSize = 96 * 1024;
        this.queue = [];
        this.checking = false;
        this.checkingCount = 0;
        this.checkingFails = 0;
        this.checkingBuffers = {};
        this.opts = Object.assign({
            debug: false,
            minCheckSize: 48 * 1024,
            maxCheckSize: 3 * (1024 * 1024),
            checkingAmount: 2,
            maxCheckingFails: 8
        }, opts);
        this.checkedPaths = {};
    }
    findTwoClosestValues(values) {
        let distances = [], closest = [], results = [];
        values.forEach((n, i) => {
            distances[i] = [];
            values.forEach((m, j) => {
                if (i == j) {
                    distances[i][j] = Number.MAX_SAFE_INTEGER;
                } else {
                    distances[i][j] = Math.abs(m - n);
                }
            });
            let minimal = Math.min.apply(null, distances[i]);
            closest[i] = distances[i].indexOf(minimal);
            distances[i] = minimal;
        });
        let minimal = Math.min.apply(null, distances);
        let a = distances.indexOf(minimal), b = closest[a];
        return [values[a], values[b]];
    }
    save(bitrate, force) {
        const prevBitrate = this.bitrate;
        if (force) {
            this.bitrates = [bitrate];
            this.bitrate = bitrate;
            this.checkingCount = this.opts.checkingAmount;
        } else {
            this.bitrates.push(bitrate);
            this.checkingCount++;
            if (this.bitrates.length >= 3) {
                this.bitrate = this.findTwoClosestValues(this.bitrates).reduce((a, b) => a + b, 0) / 2;
                this.bitrates = this.bitrates.slice(-3);
            } else {
                this.bitrate = this.bitrates.reduce((a, b) => a + b, 0) / this.bitrates.length;
            }
        }
        if (this.bitrate != prevBitrate) {
            this.emit('bitrate', this.bitrate, this.currentSpeed);
        }
    }
    async addSample(file, size, deleteFileAfterChecking) {
        if (!this.acceptingSamples(size) || this.checkedPaths[file]) {
            if (deleteFileAfterChecking === true) {
                fs.unlink(file, err => {
                    if (err)
                        console.error(file, err);
                });
            }
            return;
        }
        if (!size) {
            let err;
            const stat = fs.promises.stat(file).catch(e => err = e);
            if (err || stat.size < this.minSampleSize) {
                if (deleteFileAfterChecking) {
                    await fs.promises.unlink(file).catch(console.error);
                }
                return false;
            }
            size = stat.size;
        }
        this.checkedPaths[file] = true; // avoid reprocessing same file/url
        this.queue.push({ file, size, deleteFileAfterChecking });
        if (this.queue.length > this.opts.checkingAmount) {
            this.queue = this.queue.sortByProp('size', true);
            this.queue.slice(this.opts.checkingAmount).forEach(row => {
                if (row.deleteFileAfterChecking === true) {
                    fs.unlink(row.file, err => {
                        if (err)
                            console.error(row.file, err);
                    });
                }
            });
            this.queue = this.queue.slice(0, this.opts.checkingAmount);
        }
        this.pump();
    }
    check(file, size, deleteFileAfterChecking) {
        
        if (!this.acceptingSamples(size)) {
            if (deleteFileAfterChecking === true) {
                fs.unlink(file, err => {
                    if (err)
                        console.error(file, err);
                });
            }
            return;
        }
        this.checking = true;
        const isHTTP = file.match(new RegExp('^(((rt[ms]p|https?)://)|//)'));
        if (this.destroyed || (this.bitrates.length >= this.opts.checkingAmount && this.codecData) || this.checkingFails >= this.opts.maxCheckingFails) {
            this.checking = false;
            this.queue = [];
            this.clearSamples();
        } else {
            console.log('getBitrate', file, this.url, isHTTP ? null : size, this.opts.minCheckSize);
            ffmpeg.bitrate(file, (err, bitrate, codecData, dimensions, nfo) => {
                if (deleteFileAfterChecking) {
                    fs.unlink(file, err => {
                        if (err)
                            console.error(file, err);
                    });
                }
                if (!this.destroyed) {
                    console.log('gotBitrate', file, bitrate, codecData, dimensions, nfo);
                    if (codecData) {
                        this.emit('codecData', codecData);
                    }
                    if (dimensions && !this._dimensions) {
                        this._dimensions = dimensions;
                        this.emit('dimensions', this._dimensions);
                    }
                    if (err) {
                        this.checkingFails++;
                        this.opts.minCheckSize += this.opts.minCheckSize * 0.5;
                        this.opts.maxCheckSize += this.opts.maxCheckSize * 0.5;
                        this.updateQueueSizeLimits();
                    } else {
                        if (this.opts.debug) {
                            console.log('gotBitrate*', err, bitrate, codecData, dimensions, this.url);
                        }
                        if (bitrate && bitrate > 0) {
                            this.save(bitrate);
                        }
                        if (this.opts.debug) {
                            console.log('[' + this.type + '] analyzing: ' + file, isHTTP ? '' : 'sample len: ' + kbfmt(size), 'bitrate: ' + kbsfmt(this.bitrate), this.bitrates, this.url, nfo);
                        }
                    }
                    this.checking = false;
                    this.pump();
                }
            });
        }
    }
    reset(bitrate) {
        this.clearSamples();
        this.bitrates = [];
        if (bitrate) {
            this.save(bitrate, true);
        }
    }
    clearSamples() {
        
        Object.keys(this.checkingBuffers).forEach(id => {
            let file = this.checkingBuffers[id].file;
            this.checkingBuffers[id].destroy();
            file && fs.unlink(file, () => {});
        });
        this.checkingBuffers = {};
    }
    pump() {
        if (!this.checking) {
            if (this.queue.length && !this.destroyed) {
                const row = this.queue.shift();
                this.check(row.file, row.size, row.deleteFileAfterChecking);
            }
        }
    }
    updateQueueSizeLimits() {
        if (this.queue.length && !this.destroyed) {
            this.queue = this.queue.filter(row => {
                if (row.size && row.size < this.opts.minCheckSize) {
                    if (row.deleteFileAfterChecking) {
                        fs.unlink(row.file, err => {
                            if (err)
                                console.error(row.file, err);
                        });
                    }
                    return false;
                }
                return true;
            });
        }
    }
    acceptingSamples(size) {
        if (size && size < this.opts.minCheckSize) {
            return false;
        }
        return this.checkingCount < this.opts.checkingAmount &&
            this.bitrates.length <= this.opts.checkingAmount &&
            this.checkingFails < this.opts.maxCheckingFails;
    }
}
export default BitrateChecker;
