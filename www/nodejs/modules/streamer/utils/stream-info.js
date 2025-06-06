import { absolutize, isYT, validateURL, isLocal } from '../../utils/utils.js'
import Download from '../../download/download.js'
import lang from "../../lang/lang.js";
import MediaURLInfo from "./media-url-info.js";
import fs from "fs";
import config from "../../config/config.js"

class StreamInfo {
    constructor() {
        this.opts = {
            debug: false,
            probeSampleSize: 2048
        };
        this.mi = new MediaURLInfo();
    }
    takeMiddleValue(arr) {
        if (!arr.length) {
            return undefined;
        }
        if (arr.length < 3) {
            return arr[0];
        }
        let i = Math.ceil(arr.length / 2);
        return arr[i];
    }
    _probe(url, timeoutSecs, retries = 0, opts = {}, recursion = 10) {
        return new Promise((resolve, reject) => {
            let sampleSize = typeof(opts.probeSampleSize) == 'number' ?
                opts.probeSampleSize :
                (opts.skipSample ? 0 : this.opts.probeSampleSize);
            let status = 0, timer = 0, headers = {}, sample = [], start = (Date.now() / 1000);
            if (validateURL(url)) {
                if (typeof(timeoutSecs) != 'number') {
                    timeoutSecs = 10;
                }
                const req = {
                    url,
                    followRedirect: true,
                    acceptRanges: false,
                    keepalive: false,
                    retries,
                    headers: []
                };
                if (opts && typeof(opts) == 'object' && opts) {
                    if (opts['user-agent']) {
                        req.headers['user-agent'] = opts['user-agent'];
                    }
                    if (opts['referer']) {
                        req.headers['referer'] = opts['referer'];
                    }
                }
                let download = new Download(req), ended = false, finish = () => {
                    if (this.opts.debug) {
                        console.log('finish', ended, sample, headers);
                    }
                    if (!ended) {
                        ended = true;
                        clearTimeout(timer);
                        const ping = (Date.now() / 1000) - start;
                        const done = () => {
                            const received = JSON.stringify(headers).length + this.len(sample);
                            const speed = received / ping;
                            const ret = { status, headers, sample, ping, speed, url, directURL: download.currentURL };
                            resolve(ret);
                        };
                        if (download) {
                            download.destroy();
                        }
                        sample = Buffer.concat(sample);
                        let strSample = String(sample);
                        if (strSample.toLowerCase().includes('#ext-x-stream-inf')) {
                            let trackUrls = strSample.split("\n").map(s => s.trim()).filter(line => line.length > 3 && !line.startsWith('#'));
                            let trackUrl = this.takeMiddleValue(trackUrls); // get a middle track to try to prevent possibly offline tracks in m3u8
                            trackUrl = absolutize(trackUrl, download.currentURL);
                            console.error(JSON.stringify({ trackUrl }, null, 3));
                            recursion--;
                            if (recursion <= 0) {
                                return reject('Max recursion reached.');
                            }
                            return this._probe(trackUrl, timeoutSecs, retries, opts, recursion).then(resolve).catch(err => {
                                console.error('HLSTRACKERR*', err, url, trackUrl);
                                reject(err);
                            });
                        } else if (strSample.toLowerCase().includes('#extinf')) {
                            let segmentUrls = strSample.split("\n").map(s => s.trim()).filter(line => line.length > 3 && !line.startsWith('#'));
                            let segmentUrl = this.takeMiddleValue(segmentUrls); // get a middle segment to try to prevent possibly expiring segments in m3u8
                            segmentUrl = absolutize(segmentUrl, download.currentURL);
                            recursion--;
                            if (recursion <= 0) {
                                return reject('Max recursion reached.');
                            }
                            return this._probe(segmentUrl, timeoutSecs, retries, opts, recursion).then(ret => {
                                if (ret && ret.status && ret.status >= 200 && ret.status < 300) {
                                    done(); // send data from m3u8
                                } else {
                                    resolve(ret); // send bad data from ts
                                }
                            }).catch(err => {
                                console.error('HLSTRACKERR', err, url, segmentUrl);
                                reject(err);
                            });
                        } else {
                            done();
                        }
                    }
                };
                if (this.opts.debug) {
                    console.log(url, timeoutSecs);
                }
                download.on('error', err => {
                    console.warn(url, err);
                });
                download.on('data', chunk => {
                    if (typeof(chunk) == 'string') {
                        chunk = Buffer.from(chunk);
                    }
                    sample.push(chunk);
                    if (this.len(sample) >= sampleSize) {
                        //console.log('sample', sample, sampleSize)
                        finish();
                    }
                });
                download.once('response', (statusCode, responseHeaders) => {
                    if (this.opts.debug) {
                        console.log(url, statusCode, responseHeaders);
                    }
                    headers = responseHeaders;
                    status = statusCode;
                    if (this.mi.isM3U8(download.currentURL, false, headers) && sampleSize < this.opts.probeSampleSize) { // ensure sampleSize is not 0
                        sampleSize = this.opts.probeSampleSize; // ensure segment testing
                    }
                    sampleSize || finish();
                });
                download.once('end', finish);
                download.start();
                if (this.opts.debug) {
                    console.log(url, timeoutSecs);
                }
                timer = setTimeout(() => finish(), timeoutSecs * 1000);
            } else {
                reject('invalid url');
            }
        });
    }
    async readFilePartial(filePath, length) {
        let err
        const fd = await fs.promises.open(filePath, 'r');
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await fd.read(buffer, 0, length, 0).catch(e => err = e)
        fd.close().catch(err => console.error(err))
        if(err) throw err
        return buffer.slice(0, bytesRead);
    }
    async probe(url, retries = 2, opts = {}) {
        const timeout = config.get('connect-timeout') * 2;
        const proto = this.mi.proto(url);
        if (proto.startsWith('http')) {
            if (opts.allowBlindTrust) {
                const blindTrust = String(config.get('tuning-blind-trust')).split(',');
                if (blindTrust.length) {
                    const mediaType = this.mi.mediaType(url);
                    if (blindTrust.includes(mediaType)) {
                        let contentType;
                        // this function should return contentType always lowercase
                        const ext = this.mi.ext(url);
                        if (mediaType == 'video') {
                            if (this.mi.isVideo(url, ext)) {
                                contentType = 'video/mp4';
                            }
                        } else {
                            if (ext == 'm3u8') {
                                contentType = 'application/x-mpegurl';
                            } else if (ext == 'ts') {
                                contentType = 'video/mp2t';
                            } else if (ext == 'mpd') {
                                contentType = 'application/dash+xml';
                            }
                        }
                        if (contentType && contentType != 'application/x-mpegurl') { // m3u8 requires additional checking for availability and to know if it's a vodhls
                            const ret = {
                                status: 200,
                                headers: {
                                    'content-type': contentType
                                },
                                sample: Buffer.from(''),
                                url,
                                directURL: url,
                                ext
                            };
                            return ret;
                        }
                    }
                }
            }
            const ret = await this._probe(url, timeout, retries, opts);
            let cl = ret.headers['content-length'] || -1, ct = ret.headers['content-type'] || '', st = ret.status || 0;
            if (st < 200 || st >= 400 || st == 204) { // 204=No content
                if (st == 0)
                    st = 'timeout';
                throw st;
            }
            if (ct) {
                ct = ct.split(',')[0].split(';')[0];
            } else {
                ct = '';
            }
            if ((!ct || ct.substr(0, 5) == 'text/') && ret.sample) { // sniffing						
                if (String(ret.sample).match(new RegExp('#EXT(M3U|INF)', 'i'))) {
                    ct = 'application/x-mpegURL';
                } else if (this.isBin(ret.sample) && ret.sample.length >= this.opts.probeSampleSize) { // check length too to skip plain text error messages
                    if (this.mi.isVideo(url)) {
                        ct = 'video/mp4';
                    } else {
                        ct = 'video/MP2T';
                    }
                }
            }
            if (ct.substr(0, 4) == 'text' && !isYT(url)) {
                console.error('Bad content type: ' + ct);
                throw 404;
            }
            ret.status = st;
            ret.contentType = ct.toLowerCase();
            ret.contentLength = cl;
            if (!ret.directURL) {
                ret.directURL = ret.url;
            }
            ret.ext = this.mi.ext(ret.directURL) || this.mi.ext(url);
            return ret;
        } else if (validateURL(url)) { // maybe rtmp
            let ret = {};
            ret.status = 200;
            ret.contentType = '';
            ret.contentLength = 999999;
            ret.url = url;
            ret.directURL = url;
            ret.ext = this.mi.ext(url);
            return ret;
        } else if (isLocal(url)) {
            let err;
            
            const stat = await fs.promises.stat(url).catch(e => err = e);
            if (stat && stat.size) {
                let ret = {};
                ret.status = 200;
                ret.contentType = 'video/mp4';
                ret.contentLength = stat.size;
                ret.url = url;
                ret.directURL = url;
                ret.ext = this.mi.ext(url);
                ret.isLocalFile = true;
                let err;
                const sample = await this.readFilePartial(url, Math.min(stat.size, this.opts.probeSampleSize)).catch(e => err = e);
                ret.sample = err ? null : sample;
                return ret;
            }
            throw lang.NOT_FOUND;
        } else {
            throw lang.INVALID_URL;
        }
    }
    proto(url, len) {
        var ret = '', res = url.split(':');
        if (res.length > 1 && res[0].length >= 3 && res[0].length <= 6) {
            ret = res[0];
        } else if (url.match(new RegExp('^//[^/]+\\.'))) {
            ret = 'http';
        }
        if (ret && typeof(len) == 'number') {
            ret = ret.substr(0, len);
        }
        return ret;
    }
    rawType(url) {
        const mediaType = this.mi.mediaType({ url });
        if (mediaType == 'live') {
            return this.mi.isM3U8(url) ? 'hls' : 'ts';
        }
        return mediaType;
    }
    validate(value) {
        if (value.startsWith('//')) {
            value = 'http:' + value;
        }
        let v = value.toLowerCase(), prt = v.substr(0, 4), pos = v.indexOf('://');
        if (['http'].includes(prt) && pos >= 4 && pos <= 6) {
            return true // /^(?:(?:(?:https?|rt[ms]p[a-z]?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
        }
    }
    len(data) {
        if (!data) {
            return 0;
        }
        if (Array.isArray(data)) {
            return data.reduce((acc, val) => acc + this.len(val), 0);
        }
        return data.byteLength || data.length || 0;
    }
    isBin(buf) {
        if (!buf) {
            return false;
        }
        let sepsLimitPercentage = 5, seps = [' ', '<', '>', ','];
        let sample = String(Buffer.concat([buf.slice(0, 64), buf.slice(buf.length - 64)]).toString('binary')), len = this.len(sample);
        let isAscii = sample.match(new RegExp('^[ -~\t\n\r]+$')); // sample.match(new RegExp('^[\x00-\x7F]*[A-Za-z0-9]{3,}[\x00-\x7F]*$'))
        if (isAscii) {
            let sepsLen = sample.split('').filter(c => seps.includes(c)).length;
            if (sepsLen < (len / (100 / sepsLimitPercentage))) { // separators chars are less then x% of the string
                isAscii = false;
            }
        }
        return !isAscii;
    }
}
export default StreamInfo;
