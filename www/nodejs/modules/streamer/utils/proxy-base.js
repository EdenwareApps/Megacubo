import StreamerAdapterBase from "../adapters/base.js";
class StreamerProxyBase extends StreamerAdapterBase {
    constructor(opts) {
        super('', opts);
        this.typeMismatchCheckingThreshold = 512 * 1024; // m3u8 with more de 512KB will be checked if it's not a ts stream instead
        this.connectable = false;
        this.isCacheableRegex = new RegExp('^.*\\.(m4s|mts|m2ts|ts|key)', 'i');
        this.segmentExts = {
            'ts': null,
            'mts': null,
            'm2ts': null,
            'm4s': null
        };
        this.responseHeadersRemoval = [
            'transfer-encoding',
            'content-encoding',
            'keep-alive',
            'strict-transport-security',
            'content-security-policy',
            'x-xss-protection',
            'cross-origin-resource-policy'
        ];
        if (this.opts.discardContentLength) { // some servers send incorrect (minor) content lengths for video segments f***ing the whole thing for HTML5 video
            this.responseHeadersRemoval.push('content-length');
        }
    }
    dirname(path) {
        let i = path.lastIndexOf('/');
        if (i <= 0) {
            return '';
        } else {
            return path.substr(0, i);
        }
    }
    getURLRoot(url) {
        let pos = url.indexOf('//');
        if (pos != -1) {
            let offset, pos2 = url.indexOf('/', pos + 2);
            if (pos2 != -1) {
                offset = pos2 + 1;
            } else {
                offset = pos + 2;
            }
            pos = url.indexOf('/', offset);
            if (pos == -1) {
                return url.substr(0, offset + 1);
            } else {
                return url.substr(0, pos + 1);
            }
        } else {
            if (url.startsWith('/')) {
                pos = url.indexOf('/', 1);
                if (pos == -1) {
                    return '/';
                } else {
                    return url.substr(0, pos + 1);
                }
            } else {
                pos = url.indexOf('/');
                if (pos == -1) {
                    return '';
                } else {
                    return url.substr(0, pos + 1);
                }
            }
        }
    }
    uid() {
        let _uid = 1;
        while (typeof (this.connections[_uid]) != 'undefined') {
            _uid++;
        }
        this.connections[_uid] = false;
        return _uid;
    }
    getMediaType(headers, url) {
        let type = '', minSegmentSize = 96 * 1024;
        if (typeof (headers['content-length']) != 'undefined' && parseInt(headers['content-length']) >= minSegmentSize && this.ext(url) == 'ts') { // a ts was being sent with m3u8 content-type
            type = 'video';
        } else if (typeof (headers['content-type']) != 'undefined' && (headers['content-type'].startsWith('video/') || headers['content-type'].startsWith('audio/'))) {
            type = 'video';
        } else if (typeof (headers['content-type']) != 'undefined' && headers['content-type'].endsWith('linguist')) { // .ts bad mimetype "text/vnd.trolltech.linguist"
            type = 'video';
        } else if (typeof (headers['content-type']) != 'undefined' && (headers['content-type'].toLowerCase().endsWith('mpegurl') || headers['content-type'].startsWith('text/'))) {
            type = 'meta';
        } else if (typeof (headers['content-type']) == 'undefined' && this.ext(url) == 'm3u8') {
            type = 'meta';
        } else if (typeof (headers['content-length']) != 'undefined' && parseInt(headers['content-length']) >= minSegmentSize) {
            type = 'video';
        } else if (typeof (headers['content-type']) != 'undefined' && headers['content-type'] == 'application/octet-stream') { // force download video header
            type = 'video';
        }
        //console.warn('MEDIATYPE', type, headers, url)
        return type;
    }
    isSRT(headers, url) {
        if (url && (this.ext(url) == 'srt' || url.endsWith('.srt.gz'))) {
            return true;
        } else if (typeof (headers['content-type']) != 'undefined' && (headers['content-type'].endsWith('/srt') || headers['content-type'].endsWith('subrip'))) {
            return true;
        }
    }
    srt2vtt(srt) {
        return "WEBVTT\n\n" +
            srt.replace(new RegExp(':([0-9]{2}),', 'g'), ':$1.').trim();
    }
    isSegmentURL(url) {
        return typeof (this.segmentExts[this.ext(url)]) != 'undefined';
    }
    isM3U8Content(body) {
        // Error: Cannot create a string longer than 0x1fffffe8 characters
        return body.length < 0x1fffffe8 && body.substr(0, 12).indexOf('#EXT') != -1;
    }
    addCachingHeaders(headers, secs) {
        return Object.assign(headers, {
            'cache-control': 'max-age=' + secs + ', public',
            'expires': (new Date(Date.now() + secs)).toUTCString()
        });
    }
    typeMismatchCheck(data) {
        if (this.typeMismatchChecked)
            return;
        this.typeMismatchChecked = true;
        if (this.committed) {
            const sample = String(Buffer.concat(data));
            if (sample.indexOf('#EXT') == -1) {
                this.emit('type-mismatch');
            }
        } else {
            this.once('commit', () => this.typeMismatchCheck(data));
        }
    }
    destroy() {
        if (!this.destroyed) {
            this.destroyed = true;
            this.emit('destroy');
            if (this.server) {
                this.server.close();
                delete this.server;
            }
        }
        this.removeAllListeners();
    }
}
export default StreamerProxyBase;
