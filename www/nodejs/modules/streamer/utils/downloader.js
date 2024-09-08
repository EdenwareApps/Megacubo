import Download from '../../download/download.js'
import { basename, kbfmt, prepareCORS } from "../../utils/utils.js";
import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import http from "http";
import StreamerAdapterBase from "../adapters/base.js";
import MultiBuffer from "./multibuffer.js";
import stoppable from "stoppable";
import fs from "fs";
import paths from "../../paths/paths.js";
import config from "../../config/config.js"

const SYNC_BYTE = 0x47;
const PACKET_SIZE = 188;
class Downloader extends StreamerAdapterBase {
    constructor(url, opts) {
        /*
        Warmcache is only helpful on PC for streams not natively supported
        that would have to restart connection to transcode. It aims to let this process
        of starting trancode on a MPEGTS stream less slow.
        */
        opts = Object.assign({
            debug: false,
            debugHTTP: false,
            persistent: false,
            errorLimit: 30,
            initialerrorLimit: 2,
            warmCache: true,
            warmCacheSeconds: 6,
            warmCacheMinSize: 6 * (1024 * 1024),
            warmCacheMaxSize: 6 * (4096 * 1024),
            warmCacheMaxMaxSize: 6 * (8192 * 1024),
            sniffingSizeLimit: 196 * 1024 // if minor, check if is binary or ascii (maybe some error page)
        }, opts || {});
        super(url, opts);
        if (opts.persistent) {
            this.opts.errorLimit = Number.MAX_SAFE_INTEGER;
            this.opts.initialErrorLimit = Number.MAX_SAFE_INTEGER;
        }
        const ms = (config.get('connect-timeout-secs') || 5) * 1000;
        const pms = (7 * (24 * 3600)) * 1000;
        this.timeoutOpts = {
            lookup: ms,
            connect: opts.persistent ? pms : ms,
            response: opts.persistent ? pms : ms
        };
        this.type = 'downloader';
        this.internalErrorLevel = 0;
        this.internalErrors = [];
        this.connectable = false;
        this.connected = false;
        this._destroyed = false;
        this.timer = 0;
        this.connectTime = -1;
        this.lastConnectionStartTime = 0;
        this.lastConnectionEndTime = 0;
        this.lastConnectionReceived = 0;
        this.ext = 'ts';
        this.currentDownloadUID = undefined;
        if (this.opts.warmCache) {
            this.warmCache = new MultiBuffer()
            this.on('bitrate', bitrate => {
                const newMaxSize = Math.min(Math.max(this.opts.warmCacheMinSize, bitrate * this.opts.warmCacheSeconds), this.opts.warmCacheMaxMaxSize);
                if (typeof (newMaxSize) == 'number' && !isNaN(newMaxSize)) {
                    this.opts.warmCacheMaxSize = newMaxSize;
                }
            });
            this.on('destroy', () => this.destroyWarmCache());
        }
        let m = url.match(new RegExp('\\.([a-z0-9]{2,4})($|[\\?#])', 'i'));
        if (m && m.length > 1) {
            this.ext = m[1];
        }
        this.once('destroy', () => {
            if (!this._destroyed) {
                console.log('DOWNLOADER DESTROY', this._destroyed);
                this._destroyed = true;
                this.endRequest();
                if (this.server) {
                    this.server.close();
                }
                this.currentRequest = null;
            }
        });
        process.nextTick(() => this.pump());
    }
    getContentType() {
        if (this.opts.contentType) {
            return this.opts.contentType;
        } else {
            switch (this.ext) {
                case 'aac':
                case 'aacp':
                    return 'audio/aacp';
                case 'mp3':
                    return 'audio/mpeg';
            }
            return 'video/MP2T';
        }
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, response) => {
                if (basename(req.url) == 'stream') {
                    response.writeHead(200, prepareCORS({
                        'content-type': this.getContentType()
                    }, req));
                    let finished;
                    const uid = parseInt(Math.random() * 1000000);
                    if (this.warmCache && this.warmCache.length) {
                        let buf = this.warmCache.slice()
                        if(typeof(buf) == 'object') {
                            buf = Buffer.from(buf)
                        }
                        buf && buf.length && response.write(buf)
                        console.warn('SENT WARMCACHE', this.warmCache.length)
                    }
                    if (this.connected === false) {
                        this.connected = {};
                    }
                    this.connected[uid] = true;
                    const listener = (url, chunk) => {
                        finished || (chunk && response.write(chunk))
                    }, finish = () => {
                        if (!finished) {
                            finished = true;
                            this.removeListener('data', listener);
                            this.removeListener('destroy', finish);
                            response.end();
                        }
                        if (this.connected[uid]) {
                            delete this.connected[uid];
                            if (Object.keys(this.connected).length) {
                                this.pump();
                            } else {
                                this.connected = false;
                            }
                        }
                    };
                    req.once('close', finish);
                    this.on('data', listener);
                    this.once('destroy', finish);
                    this.pump();
                } else {
                    response.statusCode = 404;
                    response.end('File not found!');
                }
            });
            this.serverStopper = stoppable(this.server);
            this.server.listen(this.opts.port, '127.0.0.1', err => {
                if (err) {
                    console.error('unable to listen on port', err);
                    return reject(err);
                }
                if (!this.server) {
                    return reject('destroyed');
                }
                this.opts.port = this.server.address().port;
                this.endpoint = 'http://127.0.0.1:' + this.opts.port + '/stream';
                resolve(this.endpoint);
                const getBitrate = () => this.bitrateChecker.addSample(this.endpoint);
                if (this.warmCache && this.warmCache.length) {
                    getBitrate();
                } else {
                    this.once('data', getBitrate);
                }
            });
        });
    }
    rotateWarmCache() {
        if (this.warmCache.length < this.opts.warmCacheMaxSize)
            return true;
        const desiredSize = this.opts.warmCacheMaxSize * 0.75; // avoid to run it too frequently
        const startPosition = this.warmCache.length - desiredSize;
        const currentSize = this.warmCache.length;
        if (this.committed && this.bitrateChecker.acceptingSamples(currentSize)) {
            const file = paths.temp + '/' + parseInt(Math.random() * 1000000) + '.ts';
            fs.writeFile(file, this.warmCache.slice(), () => this.bitrateChecker.addSample(file, currentSize, true));
        }
        const syncBytePosition = this.warmCache.indexOf(SYNC_BYTE, startPosition);
        if (syncBytePosition == -1) {
            menu.displayErr('!!! SYNC_BYTE não encontrado');
            this.warmCache.clear();
        } else {
            this.warmCache.consume(syncBytePosition);
        }
        return true;
    }
    destroyWarmCache() {
        if (this.warmCache) {
            this.warmCache.destroy();
            this.warmCache = null;
        }
    }
    internalError(e) {
        this.internalErrorLevel++;
        this.internalErrors.push(e);
        if (this.internalErrorLevel >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)) {
            const status = this.internalErrorStatusCode();
            console.error('[' + this.type + '] error limit reached', this.committed, this.internalErrorLevel, this.internalErrors, status, this.opts.persistent, this.opts.errorLimit, this.opts.initialErrorLimit);
            this.fail(status);
        }
        return this.destroyed || this._destroyed;
    }
    internalErrorStatusCode() {
        let status = 0;
        this.internalErrors.some(code => {
            if (code >= 400 && code < 500) {
                status = code;
                return true;
            }
        });
        if (!status) {
            this.internalErrors.some(code => {
                if (code >= 500) {
                    status = code;
                    return true;
                }
            });
        }
        return status;
    }
    handleData(data) {
        this.output(data);
    }
    output(data, len) {
        if (this.destroyed || this._destroyed)
            return;
        if(typeof(data) == 'object') {
            data = Buffer.from(data)
        }
        if (typeof (len) != 'number')
            len = this.len(data);
        if (!len)
            return;
        this.internalErrorLevel = 0;
        this.downloadLog(len);
        this.emit('data', this.url, data, len);
        if (this.warmCache) {
            this.warmCache.append(data);
            const currentSize = this.warmCache.length;
            if (!this.minimalWarmCacheBitrateCheck && this.committed && this.bitrateChecker.acceptingSamples(currentSize)) {
                this.minimalWarmCacheBitrateCheck = true;
                
                const { temp } = paths;
                const file = temp + '/' + parseInt(Math.random() * 1000000) + '.ts';
                fs.writeFile(file, this.warmCache.slice(), () => {
                    if (this.destroyed) {
                        return fs.unlink(file, () => {}); // late for the party
                    }
                    this.bitrateChecker.addSample(file, this.warmCache.length, true);
                });
            } else {
                this.rotateWarmCache();
            }
        }
    }
    afterDownload(err, callback, data) {
        this.endRequest();
        if (this.destroyed || this._destroyed) {
            return;
        }
        if (this.opts.debug) {
            if (err) {
                console.log('[' + this.type + '] DOWNLOAD ERR', err, data);
            } else {
                console.log('[' + this.type + '] after download', data);
            }
        }
        callback && process.nextTick(callback.bind(this, err, data));
    }
    download(callback) {
        clearTimeout(this.timer);
        if (this.destroyed || this._destroyed || this.currentRequest)
            return;
        let connTime, received = 0, connStart = (Date.now() / 1000);
        this.currentDownloadUID = 'cdl-' + String(connStart);
        this.lastConnectionStartTime = connStart;
        const opts = {
            url: this.url,
            authURL: this.opts.authURL || false,
            keepalive: this.committed && config.get('use-keepalive'),
            followRedirect: true,
            acceptRanges: false,
            retries: 2,
            resume: false,
            debug: this.opts.debugHTTP,
            headers: this.getDefaultRequestHeaders(),
            timeout: this.timeoutOpts,
            compression: false
        };
        if (this.opts.persistent) {
            Object.assign(opts, {
                initialErrorLimit: Number.MAX_SAFE_INTEGER,
                errorLimit: 1
            });
        }
        const download = this.currentRequest = new Download(opts);
        download.on('error', error => {
            let elapsed = (Date.now() / 1000) - connStart;
            console.warn('[' + this.type + '] ERR after ' + elapsed + 's', error, this.url);
            if (this.committed) {
                let statusCode = 0;
                if (error && error.response && error.response.statusCode) {
                    statusCode = error.response.statusCode;
                }
                osd.show(lang.CONNECTION_FAILURE + ' (' + (statusCode || 'timeout') + ')', 'fas fa-times-circle', 'debug-conn-err', 'normal');
            }
        });
        download.once('response', (statusCode, headers) => {
            let contentType = '';
            if (this.opts.debug) {
                console.log('[' + this.type + '] response', statusCode, headers);
            }
            statusCode = statusCode;
            headers = headers;
            contentType = typeof (headers['content-type']) != 'undefined' ? headers['content-type'] : '';
            if (this.opts.debug) {
                console.log('[' + this.type + '] headers received', headers, statusCode, contentType); // 200
            }
            if (statusCode >= 200 && statusCode <= 300) {
                if (!this.opts.contentType && contentType.match(new RegExp('^(audio|video)'))) {
                    this.opts.contentType = contentType;
                }
                download.on('data', chunk => {
                    if (typeof (connTime) == 'undefined') {
                        connTime = (Date.now() / 1000) - connStart;
                        this.connectTime = connTime;
                        if (this.opts.debug) {
                            console.log('[' + this.type + '] receiving data, took ' + connTime + 's to connect'); // 200
                        }
                    }
                    received += chunk.length;
                    this.handleData(chunk);
                });
                download.once('end', () => {
                    this.lastConnectionEndTime = (Date.now() / 1000);
                    this.lastConnectionReceived = received;
                    if (this.opts.debug) {
                        console.log('[' + this.type + '] received ' + kbfmt(received) + ' in ' + (this.lastConnectionEndTime - connStart) + 's to connect'); // 200
                    }
                    this.endRequest();
                    received || this.internalError(500);
                    if (callback) {
                        this.afterDownload(null, callback, { contentType, statusCode, headers });
                        callback = null;
                    }
                });
            } else {
                download.end();
                if (this.committed && (!statusCode || statusCode < 200 || statusCode >= 400)) { // skip redirects
                    osd.show(lang.CONNECTION_FAILURE + ' (' + (statusCode || 'timeout') + ')', 'fas fa-times-circle', 'debug-conn-err', 'normal');
                }
                this.internalError(statusCode);
                if (statusCode) {
                    setTimeout(() => this.afterDownload('bad response', callback, { contentType, statusCode, headers }), 1000); // delay to avoid abusing
                } else {
                    this.afterDownload('bad response', callback, { contentType, statusCode, headers }); // timeout, no delay so
                }
            }
        });
        download.start();
    }
    pump() {
        if (this.currentRequest) {
            return;
        }
        this.download(() => {
            if (this.opts.debug) {
                console.log('[' + this.type + '] host closed', Array.isArray(this.nextBuffer));
            }
            this.endRequest();
            if (this.destroyed || this._destroyed) {
                return;
            }
            this.timer = setTimeout(this.pump.bind(this), 0);
            /* avoiding nested call to next pump to prevent mem leaking */
        });
    }
    endRequest() {
        if (this.currentRequest) {
            this.currentRequest.destroy();
            this.currentRequest = null;
            this.currentDataValidated = false;
        }
    }
}
export default Downloader;
