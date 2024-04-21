import Download from '../../download/download.js'
import { absolutize, isWritable, prepareCORS, sanitize } from "../../utils/utils.js";
import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import StreamerProxyBase from "./proxy-base.js";
import decodeEntities from "decode-entities";
import { Parser as ManifestParser } from "m3u8-parser";
import http from "http";
import stoppable from "stoppable";
import closed from "../../on-closed/on-closed.js";
import paths from "../../paths/paths.js";
import Writer from "../../writer/writer.js";
import config from "../../config/config.js"

class StreamerProxy extends StreamerProxyBase {
    constructor(opts) {
        super(opts);
        this.opts.port = 0;
        this.type = 'proxy';
        this.networkOnly = false;
        this.connections = {};
        this.internalRequestAbortedEvent = 'request-aborted';
        this.opts.followRedirect = true;
        this.opts.forceExtraHeaders = null;
        if (this.opts.debug) {
            console.log('OPTS', this.opts);
        }
        this.once('destroy', () => {
            console.warn('proxy.destroy()', Object.keys(this.connections));
            Object.keys(this.connections).forEach(this.destroyConn.bind(this));
            this.connections = {};
            if (this.server) {
                this.server.close();
            }
        });
    }
    destroyConn(uid, data = false, force = true) {
        if (this.connections[uid]) {
            if (this.connections[uid].response) {
                if (data && typeof (data) != 'number' && isWritable(this.connections[uid].response)) {
                    if (!this.connections[uid].response.headersSent) {
                        const origin = this.type == 'network-proxy' ? '*' : undefined;
                        this.connections[uid].response.writeHead(500, prepareCORS(response, undefined, origin));
                    }
                    this.connections[uid].response.end(data);
                }
                else {
                    this.connections[uid].response.end();
                }
            }
            if (this.connections[uid].download) {
                this.connections[uid].download.destroy();
            }
            delete this.connections[uid];
        }
    }
    destroyAllConns() {
        Object.keys(this.connections).forEach(uid => {
            this.destroyConn(uid, false, true);
        });
    }
    proxify(url) {
        if (typeof (url) == 'string' && url.indexOf('//') != -1) {
            if (!this.opts.port) {
                console.error('proxify() before server is ready', url);
                return url; // srv not ready
            }
            url = this.unproxify(url);
            if (url.substr(0, 7) == 'http://') {
                url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + url.substr(7);
            }
            else if (url.substr(0, 8) == 'https://') {
                url = 'http://' + this.opts.addr + ':' + this.opts.port + '/s/' + url.substr(8);
            }
        }
        return url;
    }
    unproxify(url) {
        if (typeof (url) == 'string') {
            if (url.substr(0, 3) == '/s/') {
                url = 'https://' + url.substr(3);
            }
            else if (url.startsWith('/') && url.charAt(1) != '/') {
                url = 'http://' + url.substr(1);
            }
            else if (this.opts.addr && url.indexOf('//') != -1) {
                /*
                if(!this.addrp){
                    this.addrp = this.opts.addr.split('.').slice(0, 3).join('.')
                }
                if(url.indexOf(this.addrp) != -1){
                    url = url.replace(new RegExp('^(http://|//)'+ this.addrp.replaceAll('.', '\\.') +'\\.[0-9]{0,3}:([0-9]+)/', 'g'), '$1')
                    url = url.replace('://s/', 's://')
                }
                */
                if (url.indexOf(this.addr + ':' + this.opts.port + '/') != -1) {
                    url = url.replace(new RegExp('^(http://|//)' + this.addr.replaceAll('.', '\\.') + ':' + this.opts.port + '/', 'g'), '$1');
                    url = url.replace('://s/', 's://');
                }
            }
            if (url.indexOf('&') != -1 && url.indexOf(';') != -1) {
                url = decodeEntities(url);
            }
        }
        return url;
    }
    proxifyM3U8(body, url) {
        if (!this.isM3U8Content(body))
            return body;
        body = body.replace(new RegExp('^ +', 'gm'), '');
        body = body.replace(new RegExp(' +$', 'gm'), '');
        let parser = new ManifestParser(), replaces = {}, u;
        parser.push(body);
        try {
            parser.end();
        }
        catch (e) {
            console.error(e);
            /*
            TypeError: Cannot read property 'slice' of null
            at parseAttributes (C:\\ProgramData\\Megacubo\\package.nw\node_modules\\m3u8-parser\\dist\\m3u8-parser.cjs.js:115:41)
            */
        }
        // console.log('M3U8 PARSED', url, parser)
        if (parser.manifest) {
            let qs = url.indexOf('?') ? url.split('?')[1] : '';
            if (parser.manifest.segments && parser.manifest.segments.length) {
                parser.manifest.segments.map(segment => {
                    segment.uri = segment.uri.trim();
                    let dn = this.getURLRoot(segment.uri);
                    if (typeof (replaces[dn]) == 'undefined') {
                        let df = segment.uri.length - dn.length;
                        if (this.opts.debug) {
                            console.log('dn', dn, df, segment.uri);
                        }
                        u = absolutize(segment.uri, url);
                        let n = this.proxify(u);
                        replaces[dn] = n.substr(0, n.length - df);
                        if (this.opts.debug) {
                            console.log('replace', dn, replaces[dn], df, n);
                        }
                        body = this.applyM3U8Replace(body, dn, replaces[dn]);
                        if (this.opts.debug) {
                            console.log('ok');
                        }
                    }
                });
            }
            if (parser.manifest.playlists && parser.manifest.playlists.length) {
                parser.manifest.playlists.forEach(playlist => {
                    let dn = this.dirname(playlist.uri);
                    if (typeof (replaces[dn]) == 'undefined') {
                        if (this.opts.debug) {
                            console.log('dn', dn);
                        }
                        u = absolutize(playlist.uri, url);
                        replaces[dn] = this.dirname(this.proxify(u));
                        if (this.opts.debug) {
                            console.log('replace', dn, replaces[dn]);
                        }
                        body = this.applyM3U8Replace(body, dn, replaces[dn]);
                        if (this.opts.debug) {
                            console.log('ok');
                        }
                    }
                });
            }
            // console.warn('PRXBODY', body, parser.manifest, replaces)
            body = body.replace(new RegExp('(URI="?)([^\\n"\']+)', 'ig'), (...match) => {
                if (match[2].indexOf('127.0.0.1') == -1) {
                    match[2] = absolutize(match[2], url);
                    match[2] = this.proxify(match[2]);
                }
                return match[1] + match[2];
            });
        }
        parser.dispose();
        parser = null;
        return body;
    }
    applyM3U8Replace(body, from, to) {
        let lines = body.split("\n");
        lines.forEach((line, i) => {
            if (line.length < 3 || line.startsWith('#')) {
                return;
            }
            if (line.indexOf('/') == -1 || line.substr(0, 2) == './' || line.substr(0, 3) == '../') {
                // keep it relative, no problem in these cases
                /*
                if(from == ''){
                    lines[i] = to + line
                }
                */
            }
            else {
                if (line.substr(0, from.length) == from) {
                    lines[i] = to + line.substr(from.length);
                }
            }
        });
        return lines.join("\n");
    }
    contentRange(type, size, range) {
        const irange = range || { start: 0, end: size - 1 };
        return type + ' ' + irange.start + '-' + irange.end + '/' + (size || '*');
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(this.handleRequest.bind(this));
            this.serverStopper = stoppable(this.server);
            this.server.listen(0, this.opts.addr, (err) => {
                if (err) {
                    if (this.opts.debug) {
                        console.log('unable to listen on port', err);
                    }
                    this.fail();
                    reject(err);
                    return;
                }
                this.connectable = true;
                this.opts.port = this.server.address().port;
                resolve(true);
            });
        });
    }
    setNetworkOnly(enable) {
        this.networkOnly = enable;
        this.destroyAllConns();
    }
    disable(type) {
        this.disabled = type || 'ts';
        this.destroyAllConns();
    }
    enable() {
        if (this.disabled) {
            delete this.disabled;
        }
    }
    fileNameFromURL(url, defaultExt = 'mp4') {
        let filename = url.split('?')[0].split('/').filter(s => s).pop();
        if (!filename || filename.indexOf('=') != -1) {
            filename = 'video';
        }
        if (filename.indexOf('.') == -1) {
            filename += '.' + defaultExt;
        }
        return sanitize(filename);
    }
    handleRequest(req, response) {
        if (this.disabled && this.disabled != 'hls') {
            response.writeHead(404, prepareCORS({
                'connection': 'close'
            }, req));
            return response.end();
        }
        if (this.destroyed || req.url.indexOf('favicon.ico') != -1) {
            response.writeHead(404, prepareCORS({
                'connection': 'close'
            }, req));
            return response.end();
        }
        if (this.networkOnly) {
            if (this.type != 'network-proxy') {
                if (!req.headers['x-from-network-proxy'] && !req.rawHeaders.includes('x-from-network-proxy')) {
                    console.warn('networkOnly block', this.type, req.rawHeaders);
                    response.writeHead(504, prepareCORS({
                        'connection': 'close'
                    }, req));
                    return response.end();
                }
            }
        }
        if (this.mapper && this.mapper(req, response)) {
            return;
        }
        if (this.opts.debug) {
            console.log('req starting...', req.url);
        }
        if (typeof (this.connectionsServed) != 'undefined') { // for networkproxy activity detection
            this.connectionsServed++;
        }
        const uid = this.uid();
        const keepalive = this.committed && config.get('use-keepalive');
        let ended, url = this.unproxify(req.url);
        let reqHeaders = req.headers;
        reqHeaders = this.removeHeaders(reqHeaders, ['cookie', 'referer', 'origin', 'user-agent']);
        if (this.type == 'network-proxy') {
            reqHeaders['x-from-network-proxy'] = '1';
        }
        else {
            if (reqHeaders['x-from-network-proxy']) {
                delete reqHeaders['x-from-network-proxy'];
            }
        }
        reqHeaders = this.getDefaultRequestHeaders(reqHeaders);
        if (this.opts.debug) {
            console.log('serving', url, req, url, reqHeaders, uid);
        }
        if (this.type == 'network-proxy' && this.opts.debug) {
            console.log('network serving', url, reqHeaders);
        }
        const cacheTTL = (this.committed && url.match(this.isCacheableRegex)) ? 60 : 0;
        const download = new Download({
            url,
            cacheTTL,
            acceptRanges: !!cacheTTL,
            timeout: this.opts.timeout || undefined,
            retries: this.committed ? 10 : 2,
            maxAuthErrors: this.committed ? 10 : 2,
            headers: reqHeaders,
            authURL: this.opts.authURL || false,
            keepalive,
            followRedirect: this.opts.followRedirect,
            debug: this.opts.debug
        });
        this.connections[uid] = { response, download };
        const end = data => {
            if (!ended) {
                ended = true;
                this.destroyConn(uid, data, false);
            }
            if (this.opts.debug) {
                console.log('ended', uid);
            }
        };
        closed(req, response, download, () => {
            if (!ended) { // req disconnected
                if (this.opts.debug) {
                    console.log('response closed', ended, response.ended);
                }
                response.emit(this.internalRequestAbortedEvent);
                if (this.connections[uid] && this.connections[uid].response) {
                    this.connections[uid].response.emit(this.internalRequestAbortedEvent);
                }
                end();
            }
        });
        download.on('error', err => {
            if (this.type == 'network-proxy' && this.opts.debug) {
                console.log('serving', url, err);
            }
            if (this.committed) {
                osd.show(lang.CONNECTION_FAILURE + ' (' + (err.response ? err.response.statusCode : 'timeout') + ')', 'fas fa-times-circle', 'debug-conn-err', 'normal');
                if (this.opts.debug) {
                    console.log('download err', err);
                }
            }
        });
        download.once('response', (statusCode, headers) => {
            const origin = this.type == 'network-proxy' ? '*' : undefined;
            headers = this.removeHeaders(headers, this.responseHeadersRemoval);
            headers = prepareCORS(headers, url, origin);
            if (this.opts.forceExtraHeaders) {
                Object.assign(headers, this.opts.forceExtraHeaders);
            }
            if (this.opts.debug) {
                console.log('download response', statusCode, headers, uid);
            }
            headers['connection'] = 'close';
            if (!statusCode || [-1, 0].includes(statusCode)) {
                /* avoid to passthrough 403 errors to the client as some streams may return it esporadically */
                return end();
            }
            if (statusCode >= 200 && statusCode < 300) { // is data response
                if (!headers['content-disposition'] || headers['content-disposition'].indexOf('attachment') == -1 || headers['content-disposition'].indexOf('filename=') == -1) {
                    // setting filename to allow future file download feature
                    // will use sanitize to prevent net::ERR_RESPONSE_HEADERS_MULTIPLE_CONTENT_DISPOSITION on bad filename
                    headers['content-disposition'] = 'attachment; filename="' + this.fileNameFromURL(url) + '"';
                }
                let len = parseInt(headers['content-length']);
                if (len && typeof (headers['content-range']) == 'undefined') {
                    headers['content-range'] = 'bytes 0-' + (len - 1) + '/' + len; // improve upnp compat
                }
                if (this.type == 'network-proxy' && this.opts.debug) {
                    console.log('network serving', url, reqHeaders, statusCode, headers);
                }
                const isSRT = this.isSRT(headers, url);
                if (isSRT)
                    headers['content-type'] = 'text/vtt';
                if (req.method == 'HEAD') {
                    if (this.opts.debug) {
                        console.log('download sent response headers', statusCode, headers);
                    }
                    response.writeHead(statusCode, headers);
                    end();
                }
                else {
                    const mediaType = this.opts.agnostic ? '' : this.getMediaType(headers, url);
                    switch (mediaType) {
                        case 'meta':
                            this.handleMetaResponse(download, statusCode, headers, response, end, url);
                            break;
                        case 'video':
                            this.handleVideoResponse(download, statusCode, headers, response, end, url, uid);
                            break;
                        default:
                            this.handleGenericResponse(download, statusCode, headers, response, end);
                    }
                }
            }
            else {
                if (this.committed && (!statusCode || statusCode < 200 || statusCode >= 400)) { // skip redirects
                    osd.show(lang.CONNECTION_FAILURE + ' (' + (statusCode || 'timeout') + ')', 'fas fa-times-circle', 'debug-conn-err', 'normal');
                }
                let location;
                headers['content-length'] = 0;
                if (typeof (headers.location) != 'undefined') {
                    location = this.proxify(absolutize(headers.location, url));
                }
                if (location) {
                    headers.location = location;
                    statusCode = (statusCode >= 300 && statusCode < 400) ? statusCode : 307;
                    response.writeHead(statusCode, headers);
                    if (this.opts.debug) {
                        console.log('download sent response headers', statusCode, headers);
                    }
                }
                else {
                    response.writeHead(statusCode, headers);
                    if (this.opts.debug) {
                        console.log('download sent response headers', statusCode, headers);
                    }
                }
                end();
            }
        });
        download.start();
    }
    handleMetaResponse(download, statusCode, headers, response, end, url) {
        let data = [];
        if (!headers['content-type']) {
            headers['content-type'] = 'application/x-mpegURL';
        }
        headers = this.addCachingHeaders(headers, 6); // set a min cache to this m3u8 to prevent his overfetching
        download.on('data', chunk => {
            data.push(chunk);
            if (download.receivedUncompressed >= this.typeMismatchCheckingThreshold) {
                this.typeMismatchCheck(data);
            }
        });
        download.once('end', () => {
            data = Buffer.concat(data);
            if (data && data.length > 12) {
                const isSRT = this.isSRT(headers, url);
                if (isSRT) {
                    data = this.srt2vtt(String(data));
                }
                else {
                    data = this.proxifyM3U8(String(data), download.currentURL);
                }
                if (this.disabled) {
                    data += "\r\n#EXT-X-ENDLIST";
                }
                headers['content-length'] = data.length;
                if (!response.headersSent) {
                    response.writeHead(statusCode, headers);
                    if (this.opts.debug) {
                        console.log('download sent response headers', statusCode, headers);
                    }
                }
                if (this.opts.debug) {
                    console.log('M3U8 ' + data, url);
                }
            }
            else {
                console.error('Invalid response from server', url, data);
                if (!response.headersSent) {
                    response.writeHead(504, headers);
                    if (this.opts.debug) {
                        console.log('download sent response headers', 504, headers);
                    }
                }
            }
            end(data);
        });
    }
    handleVideoResponse(download, statusCode, headers, response, end, url, uid) {
        if (this.opts.forceVideoContentType) {
            headers['content-type'] = this.opts.forceVideoContentType;
        }
        else if (!headers['content-type'] || !headers['content-type'].match(new RegExp('^(audio|video)'))) { // fix bad mimetypes
            switch (this.ext(url)) {
                case 'ts':
                case 'mts':
                case 'm2ts':
                    headers['content-type'] = 'video/MP2T';
                    break;
                default:
                    headers['content-type'] = 'video/mp4';
            }
        }
        if (!response.headersSent) {
            if (this.opts.debug) {
                console.log('download sent response headers', statusCode, headers);
            }
            response.writeHead(statusCode, headers);
            if (this.type == 'network-proxy' && this.opts.debug) {
                console.log('network serving response', url, headers);
            }
        }
        const { temp } = paths;
        let initialOffset = download.requestingRange ? download.requestingRange.start : 0, offset = initialOffset;
        let sampleCollected, doBitrateCheck = this.committed && this.type != 'network-proxy' && this.bitrateChecker.acceptingSamples();
        let sampleWriter, sampleFile = doBitrateCheck ? temp + '/' + parseInt(Math.random() * 100000) + '.ts' : '';
        const onend = () => {
            if (doBitrateCheck) {
                if (this.opts.debug) {
                    console.log('finishBitrateSampleProxy', url, sampleCollected, initialOffset, offset);
                }
                finishSample();
            }
            end();
        };
        const finishSample = () => {
            if (sampleCollected || !sampleWriter)
                return;
            sampleWriter.end();
            sampleCollected = true;
            if (this.opts.debug) {
                console.log('collectBitrateSampleProxy', url, sampleCollected, initialOffset, offset);
            }
            sampleWriter.ready(() => {
                this.bitrateChecker.addSample(sampleFile, null, true);
            });
        };
        // console.warn('handleVideoResponse', doBitrateCheck, this.opts.forceFirstBitrateDetection, offset, download, statusCode, headers)
        download.on('data', chunk => {
            response.write(chunk);
            let len = this.len(chunk);
            this.downloadLog(len);
            if (sampleFile && !sampleCollected) {
                if (!sampleWriter)
                    sampleWriter = new Writer(sampleFile);
                sampleWriter.write(chunk);
                if (sampleWriter.position > this.bitrateChecker.opts.maxCheckingSize) {
                    finishSample();
                }
            }
            offset += len;
        });
        download.once('end', onend);
        download.ended && onend();
    }
    handleGenericResponse(download, statusCode, headers, response, end) {
        if (!response.headersSent) {
            response.writeHead(statusCode, headers);
            if (this.opts.debug) {
                console.log('download sent response headers', statusCode, headers);
            }
        }
        download.on('data', chunk => response.write(chunk));
        download.once('end', () => end());
    }
}
export default StreamerProxy;
