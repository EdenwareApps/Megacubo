import axios from 'axios';
import fs from 'fs';
import resolver from './lookup.js';
import config from "../config/config.js";
import { absolutize, getDomain, parseRange, traceback, validateURL } from '../utils/utils.js';
import StreamCache from './stream-cache.js';
import cacheMap from './download-cache.js';
import { temp } from '../paths/paths.js';
import { EventEmitter } from 'node:events';
import { HttpCookieAgent, HttpsCookieAgent } from 'http-cookie-agent/http';
import { CookieJar } from 'tough-cookie';
import qs from 'querystring';

const lookup = async (hostname, options, callback) => {
    try {
        const ip = await resolver.lookup(hostname, options);
        if(!ip) {
            throw new Error('No IP address found');
        }
        const family = resolver.family(ip);
        callback && callback(null, ip, family);
        return ip;
    } catch (error) {
        if (callback) {
            callback(error);
        } else {
            throw error;
        }
    }
}

const createCustomAgent = (opts) => {
    opts = Object.assign({
        keepAlive: false,
        lookup
    }, opts);
    return {
        httpsAgent: new HttpsCookieAgent({ rejectUnauthorized: false, ...opts }),
        httpAgent: new HttpCookieAgent(opts)
    };
};

const jar = new CookieJar();
const { httpsAgent, httpAgent } = createCustomAgent({keepAlive: false});
const { httpsAgent: httpsAgentKeepAlive, httpAgent: httpAgentKeepAlive } = createCustomAgent({keepAlive: true});

class Download extends EventEmitter {
    constructor(opts) {
        super();
        this.traceback = traceback();
        this.opts = {
            url: '',
            cacheTTL: 0,
            debug: false,
            bypassCache: false,
            acceptRanges: true,
            uid: parseInt(Math.random() * 100000000000),
            maxContentLength: Infinity,
            maxRedirects: 20,
            retries: 2,
            resume: true,
            decompress: true,
            headers: {
                'accept': '*/*'
            },
            timeout: {
                connect: config.get('connect-timeout') || 15,
                response: config.get('read-timeout') || 10,
                'accept-language': this.defaultAcceptLanguage()
            },
            followRedirect: true,
            maxAuthErrors: 2,
            maxAbortErrors: 2,
            authErrorCodes: [401, 403],
            permanentErrorCodes: [-1, 400, 404, 405, 410, 521],
            permanentErrorRegex: new RegExp('(ENOTFOUND|ENODATA|ENETUNREACH|ECONNREFUSED|cannot resolve)', 'i'),
        };
        this.opts = {
            ...this.opts,
            ...opts,
            headers: {
                ...this.opts.headers,
                ...opts.headers
            }
        };

        this.currentURL = this.opts.url;
        this.received = 0;
        this.totalContentLength = -1;
        this.supportsRange = false;
        this.errors = [];
        this.timeout = 0;
        this.statusCode = 0;
        this.headersSent = false;
        this.retryCount = 0;
        this.retryDelay = 400;
        this.redirectCount = 0;
        this.cancelTokenSource = null;
        this.streamEnded = false;
        this.authErrors = 0;
        this.requestHeaders = {}
        for (const [key, value] of Object.entries(this.opts.headers)) {
            this.requestHeaders['content-type'] = value;
            if(key.toLowerCase() !== key) {
                delete this.opts.headers[key];
                this.opts.headers[key.toLowerCase()] = value;
            }
        }

        if(typeof(this.opts['user-agent']) !== 'string') {
            this.opts['user-agent'] = config.get('user-agent') || config.get('default-user-agent');
        }

        const type = typeof(this.opts.timeout);
        if(type === 'number') {
            this.opts.timeout = { 
                connect: this.opts.timeout, 
                response: this.opts.timeout 
            };
        } else if(type === 'undefined') {
            this.opts.timeout = {
                connect: config.get('connect-timeout') || 10,
                response: config.get('read-timeout') || 10
            }
        }
        
        if(this.opts.decompress) {
            this.opts.headers['accept-encoding'] = 'gzip, deflate, br';
        } else {
            this.opts.headers['accept-encoding'] = 'identity';
        }

        if(this.opts.post) {
            this.opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
            if(typeof(this.opts.post) === 'object') {
                this.opts.post = qs.stringify(this.opts.post);
            }
        }
    }

    async start() {
        if (!validateURL(this.opts.url)) {
            this.endWithError('Invalid URL', 400);
            return;
        }
        this.started = true;
        this.requestingRange = null;
        this.checkRequestingRange();

        // Try using cache first
        if (this.opts.cacheTTL > 0 && !this.opts.bypassCache) {
            await this.tryCache().catch(this.opts.debug ? console.error : () => {});
        }
        if (!this.ended) this.connect(); // Continue with remote request if cache fails
    }

    checkRequestingRange() {
        const range = this.opts.headers['range'];
        if(!range) return;
        let requestingRange = parseRange(range.replace('bytes ', 'bytes='));
        if (requestingRange && typeof(requestingRange.start) == 'number' && (requestingRange.start > 0 || requestingRange.end > 0)) { // TODO: enable multi-ranging support
            this.requestingRange = requestingRange;
            if (this.requestingRange.end && this.requestingRange.end > 0) {
                this.contentLength = (this.requestingRange.end - this.requestingRange.start) + 1;
            }
            this.opts.headers['accept-encoding'] = 'identity'; // don't handle decompression with ranging requests
            return requestingRange;
        }
    }

    async tryCache() {
        let response, redirected;

        // Redirect cache events to this instance
        this.responseSource = 'cache';
        const cacheStream = new StreamCache({ ...this.opts, uid: this.opts.uid });
        cacheStream.on('response', r => {
            response = r;
            this.opts.debug && console.log('[download] tryCache: response', response);
            if (response.status >= 300 && response.status < 400 && response.headers['location']) {
                redirected = true;
                this.handleResponse(response);
            } else {
                response.on('data', chunk => {
                    if (redirected) return;
                    if (!this.headersSent) {
                        this.opts.debug && console.log('[download] tryCache: response validated', response);
                        this.statusCode = response.statusCode;
                        this.responseHeaders = response.headers;
                        this.headersSent = true;
                        this.emit('response', response.statusCode, response.headers);
                    }
                    this.received += chunk.length;
                    this.emit('data', chunk);
                });
            }
        });

        const waiting = new Promise((resolve, reject) => {
            this.once('data', resolve);
            cacheStream.once('end', resolve);
            cacheStream.once('error', reject);
            setTimeout(() => reject(new Error('Timeout')), 5000);
        });

        let err;
        await cacheStream.start().catch(e => err = e);
        await waiting.catch(e => err = e);

        if (this.received || redirected) {
            this.streamEnded = true;
            redirected || this.end();
        } else {
            throw err || new Error('Cache empty');
        }
    }

    defaultAcceptLanguage() {
        if (lang && lang.countryCode) {
            const langs = [...new Set([lang.locale + '-' + lang.countryCode.toUpperCase(), lang.locale, 'en'])]
            return langs.join(',') + ';q=1,*;q=0.7';
        } else {
            return '*';
        }
    }

    end() {
        if (this.ended) return;
        this.opts.debug && console.error('[download] end', this.received);
        if (this.opts.cacheTTL && this.responseSource === 'http') {
            Download.cache.save(this, null, true) // end it always despite of responseSource
        }
        this.ended = true;
        this.destroyStream();
        if (!this.headersSent) {
            this.emit('response', this.statusCode || -1, {});
        }
        this.emit('end');
        this.destroy();
    }

    destroy() {
        if (!this.destroyed) {
            this.destroyed = true;
            this.destroyStream();
            this.emit('destroy');
            this.removeAllListeners();
        }
    }

    async connect() {
        if (this.destroyed) return;        

        const domain = getDomain(this.opts.url, false);
        const ipPromise = resolver.lookup(domain).catch(() => false); // so we know the current IP to maybe defer it later

        this.updateTimeout('connect');
        this.responseSource = 'http';
        this.cancelTokenSource = axios.CancelToken.source();
        const axiosConfig = {
            url: this.currentURL,
            method: this.opts.post ? 'POST' : 'GET',
            headers: { ...this.opts.headers },
            maxRedirects: this.opts.followRedirect ? this.opts.maxRedirects : 0,
            responseType: 'stream',
            validateStatus: () => true,
            data: this.opts.post || undefined,
            maxContentLength: this.opts.maxContentLength,
            cancelToken: this.cancelTokenSource.token,
            decompress: this.opts.decompress,
            insecureHTTPParser: true,
            transitional: {
                silentJSONParsing: false,
                forcedJSONParsing: false,
                clarifyTimeoutError: true
            },            
            validateStatus: function (status) {
                return true; // Trata todos os códigos de status como sucesso
            },
            adapter: 'http',
            httpsAgent: this.opts.keepalive ? httpsAgentKeepAlive : httpsAgent,
            httpAgent: this.opts.keepalive ? httpAgentKeepAlive : httpAgent,
            jar
        };

        if (this.received > 0 && this.supportsRange) {
            axiosConfig.headers['Range'] = `bytes=${this.received}-`;
            axiosConfig.headers['Accept-Encoding'] = 'identity';
        }

        if(!axiosConfig.headers['Host']) {
            const domainWithPort = getDomain(this.currentURL, true);
            if(domainWithPort) {
                axiosConfig.headers['Host'] = domainWithPort;
            }
        }

        try {
            this.opts.debug && console.log('[download] connect: axiosConfig', axiosConfig);
            const response = this.opts.post ? 
                await axios.post(axiosConfig.url, axiosConfig.data, axiosConfig) : 
                await axios(axiosConfig);
            this.currentResponse = response; // Store the response for control
            this.opts.debug && console.log('[download] connect: response', response.status, response.headers);
            this.handleResponse(response);
        } catch (error) {
            this.opts.debug && !this.ended && console.error('[download] connect: error', error);
            if (axios.isCancel(error)) {
                this.endWithError('Request cancelled', 499);
            } else {
                if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
                    ipPromise.then(ip => ip && resolver.defer(domain, ip));
                }
                if (this.received < this.totalContentLength && this.supportsRange) {
                    this.retryCount++;
                    if (this.retryCount <= this.opts.retries) {
                        this.opts.debug && console.log('[download] connect: retrying', this.retryCount);
                        setTimeout(() => this.connect(), this.retryDelay);
                    } else {
                        this.endWithError(`Max retries exceeded: ${error.message}`, 500);
                    }
                } else {
                    this.endWithError(`Download failed: ${error.message}`, 500);
                }
            }
        }
    }

    handleResponse(response) {
        this.statusCode = response.status;
        this.responseHeaders = response.headers;
        if (response.status >= 300 && response.status < 400 && response.headers['location']) {
            this.redirectCount++;            
            if (this.opts.cacheTTL && this.responseSource === 'http') {
                Download.cache.save(this, null, true); // save redirect, before changing currentURL
            }
            if (this.redirectCount <= this.opts.maxRedirects) {
                this.currentURL = absolutize(response.headers['location'], this.currentURL);
                this.emit('redirect', this.currentURL, response.headers);
                this.connect();
            } else {
                this.endWithError('Redirection limit reached', 508);
            }
        } else if (response.status >= 200 && response.status < 300) {
            if (response.status === 206) {
                const contentRange = response.headers['content-range'];
                const match = contentRange && contentRange.match(/bytes (\d+)-(\d+)\/(\d+)/);
                if (match) {
                    const start = parseInt(match[1]);
                    const end = parseInt(match[2]);
                    this.totalContentLength = parseInt(match[3]);
                    if (start !== this.received) {
                        this.endWithError('Range mismatch', 500);
                        return;
                    }
                } else if (contentRange) {
                    this.endWithError('Invalid Content-Range', 500);
                    return;
                }
            } else {
                this.totalContentLength = parseInt(
                    response.headers['x-decompressed-content-length'] ||
                    response.headers['content-length'] || 
                    this.totalContentLength
                ) || -1;
            }

            if (this.opts.acceptRanges !== false) {
                this.supportsRange = response.headers['accept-ranges'] === 'bytes';
            }

            if (!this.headersSent) {
                this.headersSent = true;
                this.emit('response', this.statusCode, response.headers);
            }

            response.data.on('data', chunk => {
                this.updateTimeout('response');
                if (!this.ended && !this.destroyed) {
                    this.received += chunk.length;
                    this.emit('data', chunk);                                
                    this.opts.cacheTTL && Download.cache.save(this, chunk, false);
                    if (this.totalContentLength) {
                        const progress = Math.round(this.received / (this.totalContentLength / 100));
                        this.progress = Math.min(progress, 100);
                    } else {
                        this.progress = this.received ? 25 : 0;
                    }
                    this.emit('progress', this.progress);
                }
            });
            response.data.on('end', () => {
                this.opts.debug && console.log('[download] handleResponse: end', this.received);
                this.streamEnded = true;
                this.end();
            });
            response.data.on('error', err => {
                if (this.received && this.totalContentLength > 0) {
                    if (this.received >= this.totalContentLength) {
                        this.streamEnded = true;
                        this.end();
                    } else if (this.supportsRange && this.retryCount <= this.opts.retries) {
                        this.retryCount++;
                        setTimeout(() => this.connect(), this.retryDelay);
                    } else {
                        this.endWithError(err);
                    }
                } else {
                    this.endWithError(err);
                }
            });
        } else {
            let finalize, authRequired;
            if (this.opts.authErrorCodes.includes(response.status)) {
                if (this.retryDelay < 1000) {
                    this.retryDelay = 1000;
                }
                this.authErrors++;
                if (this.authErrors >= this.opts.maxAuthErrors) {
                    finalize = true;
                } else {
                    authRequired = true;
                }
            }
            if (this.opts.permanentErrorCodes.includes(response.status)) {
                finalize = true;
            }            
            this.retryCount++;
            if (!finalize && this.retryCount <= this.opts.retries) {
                if (authRequired && this.opts.authURL) {
                    Download.get({url: this.opts.authURL, retries: 0}).catch(err => console.error(err)).finally(() => {
                        setTimeout(() => this.connect(), this.retryDelay);
                    });
                } else {
                    setTimeout(() => this.connect(), this.retryDelay);
                }
            } else {
                this.endWithError(`HTTP error ${response.status}`, response.status);
            }
        }
    }

    updateTimeout(type) {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }
        this.timeout = setTimeout(() => {
            this.endWithError('Timeout', 504);
        }, (this.opts.timeout[type] || 10) * 1000);
    }

    endWithError(err, statusCode = 500) {
        if (this.ended) return;
        this.errors.push(String(err));
        this.statusCode = statusCode;
        this.listenerCount('error') && this.emit('error', err);
        this.opts.debug && console.error('[download] endWithError', err);
        this.end();
    }

    destroyStream() {
        if (this.currentResponse) {
            this.currentResponse.data.destroy();
            this.currentResponse = null;
        }
        if (this.cancelTokenSource && !this.streamEnded) {
            this.cancelTokenSource.cancel('Request destroyed');
        }
        this.cancelTokenSource = null;
    }

    static prepareOutputData(data, responseType, urls) { // 'text', 'json' or empty (buffer)
        if (data && data.length) {
            const maxStringSize = 0xffffff0;
            if (Array.isArray(data)) {
                data = data.filter(chunk => Buffer.isBuffer(chunk));
                data = Buffer.concat(data);
            }
            if (data.length < maxStringSize) {
                switch (responseType) {
                    case 'text':
                        data = data.toString('utf8');
                        break;
                    case 'json':
                        try {
                            data = JSON.parse(data.toString('utf8'));
                        } catch (e) {
                            for (const url of urls) {
                                Download.cache.invalidate(url)
                            }
                            throw new Error(`JSON error: ${e.message}`);
                        }
                        break;
                    default:
                        break;
                }
            }
        } else {
            switch (responseType) {
                case 'text':
                    data = '';
                    break;
                case 'json':
                    throw new Error('No data');
                default:
                    data = Buffer.alloc(0);
            }
        }
        return data;
    }

    static get(opts) {
        let dl;
        if (opts.responseType === 'json') {
            if (!opts.headers) opts.headers = {};
            opts.headers.accept = 'application/json,text/*;q=0.99';
        }
        const promise = new Promise((resolve, reject) => {
            const data = [];
            dl = new Download({ ...opts });
            dl.on('data', chunk => data.push(chunk));
            dl.once('error', reject);
            dl.once('end', () => {
                if(dl.statusCode >= 200 && dl.statusCode < 400) {
                    try {
                        const ret = Download.prepareOutputData(data, opts.responseType, [opts.url, dl.currentURL]);
                        resolve(ret);
                    } catch (e) {
                        reject(e);
                    }
                } else {
                    console.error(`HTTP error ${dl.statusCode}`);
                    reject(`HTTP error ${dl.statusCode}`);
                }
                dl.destroy();
            });
            dl.start();
        });
        promise.cancel = () => {
            if (!dl.ended) {
                dl.destroyStream();
                dl.destroy();
            }
        };
        return promise;
    }

    static file = async opts => {
        if (!opts.file) opts.file = `${temp}/dl-file-${parseInt(Math.random() * 1000000000)}`;
        let dl, stream;
        const promise = new Promise((resolve, reject) => {
            dl = new Download({ ...opts });
            dl.on('response', (statusCode, headers) => {
                if (statusCode >= 200 && statusCode < 400) {
                    stream = fs.createWriteStream(opts.file);
                    dl.on('data', chunk => stream.write(chunk));
                } else {
                    dl.destroy();
                    reject(`HTTP error ${statusCode}`);
                }
            });
            dl.on('error', reject);
            dl.on('end', () => {
                const success = dl.statusCode >= 200 && dl.statusCode < 400;
                if (success && stream) {
                    stream.on('finish', () => {
                        resolve(opts.file);
                        dl.destroy();
                    });
                    stream.end();
                } else if (!success) {
                    if (stream) {
                        stream.destroy();
                        fs.unlink(opts.file, () => reject(`HTTP error ${dl.statusCode}`));
                    } else {
                        reject(`HTTP error ${dl.statusCode}`);
                    }
                    dl.destroy();
                }
            });
            dl.start();
        });
        promise.cancel = () => {
            if (!dl.ended) {
                dl.destroyStream();
                dl.destroy();
                if (stream) stream.destroy();
                fs.unlink(opts.file, () => {});
            }
        };
        return promise;
    }

    static post(opts) {
        opts.post = opts.data || opts.post;
        return Download.get(opts);
    }

    static head(opts) {
        let dl;
        const promise = new Promise((resolve, reject) => {
            dl = new Download({ ...opts, method: 'HEAD' });
            dl.on('error', reject);
            dl.on('response', (statusCode, headers) => {
                resolve({ statusCode, headers, currentURL: dl.currentURL });
                dl.destroy();
            });
            dl.start();
        });
        promise.cancel = () => {
            if (!dl.ended) {
                dl.destroyStream();
                dl.destroy();
            }
        };
        return promise;
    }

    static lookup = lookup;
    static cache = cacheMap;
}

export default Download;