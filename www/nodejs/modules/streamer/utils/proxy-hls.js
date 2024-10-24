import Download from '../../download/download.js'
import { absolutize, isWritable, joinPath, kbsfmt, prepareCORS, ucWords } from "../../utils/utils.js";
import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import StreamerProxyBase from "./proxy-base.js";
import decodeEntities from "decode-entities";
import { Parser as ManifestParser } from "m3u8-parser";
import http from "http";
import stoppable from "stoppable";
import closed from "../../on-closed/on-closed.js";
import config from "../../config/config.js"

class HLSJournal {
    constructor(url, altURL, master) {
        this.url = url;
        this.altURL = altURL;
        this.master = master;
        this.header = '';
        this.journal = {};
        this.maxLen = Math.ceil(config.get('live-window-time') / 3);
        this.initialMediaSequence = 0;
        this.currentMediaSequence = null;
        this.mediaSequence = {};
        this.regexes = {
            unproxify: new RegExp('/127\.0\.0\.1:[0-9]+(/s/|/)'),
            protoNDomain: new RegExp('(https?://|//)[^/]+/'),
            tsBasename: new RegExp('[^/]*\\.(m4s|mts|m2ts|ts)', 'i'),
            ts: new RegExp('^[^\\\\?]*\\.(m4s|mts|m2ts|ts)', 'i')
        };
    }
    process(content) {
        if (content) {
            let header = [], segments = {}, extinf, currentSegmentName;
            let m = content.match(new RegExp('EXT-X-MEDIA-SEQUENCE: *([0-9]+)', 'i'));
            if (m) {
                this.currentMediaSequence = parseInt(m[1]);
                if (this.initialMediaSequence != this.currentMediaSequence) {
                    this.initialMediaSequence = this.currentMediaSequence;
                }
            }
            let seg = 0;
            content.split("\n").filter(s => s.length >= 7).forEach(line => {
                const isExtinf = line.substr(0, 7) == '#EXTINF';
                const key = seg + this.currentMediaSequence;
                if (!segments[key]) {
                    segments[key] = { live: true, url: '', extinf: '' };
                }
                if (isExtinf) {
                    segments[key].extinf += line;
                } else if (segments[key].extinf) {
                    if (line.startsWith('#')) {
                        segments[key].extinf += "\r\n" + line;
                    } else {
                        segments[key].extinf += "\r\n" + line;
                        if (line.length > segments[key].url.length) {
                            segments[key].url = this.master.unproxify(absolutize(line, this.url));
                            seg++;
                        }
                    }
                } else {
                    header.push(line);
                }
            });
            Object.keys(this.journal).forEach(k => {
                const live = !!segments[k];
                if (this.journal[k].live !== live) {
                    this.journal[k].live = live;
                }
            });
            Object.keys(segments).forEach(k => {
                if (!this.journal[k]) {
                    this.journal[k] = segments[k];
                    this.journal[k].urls = [segments[k].url];
                } else {
                    if (!this.journal[k].urls.includes(segments[k].url)) {
                        this.journal[k].urls.push(segments[k].url);
                        this.journal[k].url = segments[k].url;
                    }
                }
            });
            this.header = header.join("\r\n");
            let d = content.match(new RegExp('EXTINF: *([0-9\\.]+)', 'i')), lwt = config.get('live-window-time');
            d = d ? parseFloat(d[1]) : 2;
            let journalKeys = Object.keys(this.journal);
            let maxJournalSize = parseInt(lwt / d);
            if (journalKeys.length > maxJournalSize) {
                const trimCount = journalKeys.length - maxJournalSize;
                journalKeys.slice(0, trimCount).forEach(k => {
                    delete this.journal[k];
                });
            }
        }
    }
    readM3U8() {
        let content = this.header;
        Object.keys(this.journal).forEach((mediaSequence, i) => {
            if (i == 0) {
                content = content.replace(new RegExp('EXT-X-MEDIA-SEQUENCE: *([0-9]+)', 'i'), 'EXT-X-MEDIA-SEQUENCE:' + mediaSequence - 1);
            }
            content += "\r\n" + this.journal[mediaSequence].extinf;
        });
        return content;
    }
    segmentName(url) {
        let match, nurl = url;
        if (nurl.match(this.regexes.unproxify)) {
            nurl = nurl.replace(this.regexes.unproxify, '/');
        }
        if (nurl.match(this.regexes.protoNDomain)) {
            nurl = nurl.replace(this.regexes.protoNDomain, '/');
        }
        match = nurl.match(this.regexes.ts);
        if (match) {
            return match[0];
        }
        return nurl;
    }
    inLiveWindow(name) {
        let n = name;
        if (n.includes('://')) {
            n = this.segmentName(n);
        }
        return Object.keys(this.journal).some(k => {
            this.journal[k].urls.some(u => {
                return u.includes(n);
            });
        });
    }
}
class HLSRequests extends StreamerProxyBase {
    constructor(opts) {
        super(opts);
        this.debugConns = false;
        this.debugUnfinishedRequests = false;
        this.activeManifest = null;
        this.activeRequests = {};
        this.mpegURLRegex = new RegExp('mpegurl', 'i');
        this.once('destroy', () => {
            Object.keys(this.activeRequests).forEach(url => {
                if (this.activeRequests[url].request) {
                    this.activeRequests[url].request.destroy();
                }
                delete this.activeRequests[url];
            });
            if (Download.debugConns) {
                osd.hide('hlsprefetch');
            }
        });
        this.maxDiskUsage = 200 * (1024 * 1024);
        /* disable content ranging, as we are rewriting meta and segments length comes incorrect from server sometimes */
        this.responseHeadersRemoval.push(...['content-range', 'accept-ranges']);
    }
    url2file(url) {
        let f = sanitize(url);
        if (f.length >= 42) { // Android filename length limit may be lower https://www.reddit.com/r/AndroidQuestions/comments/65o0ds/filename_50character_limit/
            f = this.md5(f);
        }
        return f;
    }
    findSegmentIndexInJournal(segmentUrl, journalUrl) {
        if (!this.journals[journalUrl])
            return;
        let key, mediaSequence, name = this.journals[journalUrl].segmentName(segmentUrl);
        Object.keys(this.journals[journalUrl].journal).some(seq => {
            return this.journals[journalUrl].journal[seq].urls.some(url => {
                if (url.includes(name)) {
                    mediaSequence = seq;
                    return true;
                }
            });
        });
        if (key)
            return mediaSequence;
    }
    findJournalFromSegment(url) {
        let ret;
        Object.keys(this.journals).some(jurl => {
            const mediaSequence = this.findSegmentIndexInJournal(url, jurl);
            if (mediaSequence !== undefined) {
                ret = { journal: jurl, mediaSequence };
                return true;
            }
        });
        return ret;
    }
    async getNextInactiveSegment() {
        const journalUrl = this.activeManifest;
        if (typeof(this.journals[journalUrl]) == 'undefined')
            return;
        const journal = this.journals[journalUrl].journal;
        let next, lastDownloadingMediaSequence, lastDownloadingMediaSequenceIndex;
        Object.keys(journal).some((mediaSequence, i) => {
            return journal[mediaSequence].urls.some(url => {
                if (url == this.lastUserRequestedSegment) {
                    lastDownloadingMediaSequence = mediaSequence;
                    lastDownloadingMediaSequenceIndex = i;
                    return true;
                }
            });
        });
        if (lastDownloadingMediaSequence) {
            for (const k of Object.keys(journal).slice(lastDownloadingMediaSequenceIndex + 1)) {
                if (!journal[k])
                    continue; // TypeError: Cannot read property 'urls' of undefined
                let cached = await this.selectCacheAvailableURL(journal[k].urls);
                if (cached)
                    continue;
                if (this.activeRequests[journal[k].url])
                    continue;
                next = journal[k].url;
                break;
            }
            if (this.debugConns && !next) {
                console.warn('ALL CACHED IN: ' + journal[Object.keys(journal).pop()].url);
            }
        }
        return next;
    }
    async selectCacheAvailableURL(urls) {
        if (!Array.isArray(urls)) {
            const ptr = this.findJournalFromSegment(originalUrl);
            if (!ptr)
                return;
            urls = this.journals[ptr.journal].journal[ptr.mediaSequence].urls;
        }
        for (const url of urls) {
            const cachedInfo = await Download.cache.info(url);
            if (cachedInfo)
                return url;
        }
    }
    finishObsoleteSegmentRequests(journalUrl) {
        if (!this.journals[journalUrl])
            return;
        Object.keys(this.journals[journalUrl].journal).forEach(mediaSequence => {
            if (this.journals[journalUrl].journal[mediaSequence].live)
                return;
            for (const segmentUrl of this.journals[journalUrl].journal[mediaSequence].urls) {
                if (typeof(this.activeRequests[segmentUrl]) != 'undefined') {
                    if (!this.activeRequests[segmentUrl] || this.activeRequests[segmentUrl].ended)
                        continue;
                    const notFromUser = this.activeRequests[segmentUrl].opts.shadowClient;
                    if (notFromUser) {
                        console.log('finishing prefetch request outside of live window', segmentUrl);
                        this.activeRequests[segmentUrl].destroy();
                        delete this.activeRequests[segmentUrl];
                    }
                }
            }
        });
    }
    inLiveWindow(url) {
        let pos = this.findJournalFromSegment(url);
        if (pos) {
            return this.journals[pos.journal].journal[pos.mediaSequence].live;
        }
    }
    report404ToJournal(url) {
        if (this.debugConns)
            console.log('report404');
        let pos = this.findJournalFromSegment(url);
        if (pos) {
            this.journals[pos.journal].journal[pos.mediaSequence].offline = true;
        } else {
            console.error('report404 ERR ' + url + ' not found in journal');
        }
    }
    validateStatus(code) {
        return code >= 200 && code <= 400 && code != 204;
    }
    async download(opts) {
        let url = opts.url;
        const now = (Date.now() / 1000), seg = this.isSegmentURL(url);
        if (seg) {
            const ptr = this.findJournalFromSegment(url);
            if (ptr) {
                if (!this.journals[ptr.journal].journal[ptr.mediaSequence].live) {
                    console.error('OUT OF LIVE WINDOW', url, this.journals[ptr.journal].journal[ptr.mediaSequence]);
                    opts.cachedOnly = true;
                    const bestUrl = await this.selectCacheAvailableURL(url); // get cached one alternative
                    if (bestUrl && bestUrl != url) {
                        opts.url = url = bestUrl;
                    }
                } else { // update url to most updated alternative
                    if (this.journals[ptr.journal].journal[ptr.mediaSequence].url != url) {
                        opts.url = url = this.journals[ptr.journal].journal[ptr.mediaSequence].url;
                    }
                }
            }
        }
        if (this.debugConns) {
            console.warn('REQUEST CONNECT START', now, url);
        }
        if (seg && !opts.shadowClient) {
            this.lastUserRequestedSegment = url;
        }
        const request = new Download(opts);
        this.activeRequests[url] = request;
        this.debugActiveRequests();
        if (this.debugUnfinishedRequests) {
            osd.show('unfinished: ' + Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent');
        }
        let ended, mediaType, end = () => {
            if (this.debugConns) {
                console.error('REQUEST CONNECT END', (Date.now() / 1000) - now, url, request.statusCode);
            }
            if (this.activeRequests[url]) {
                delete this.activeRequests[url];
                this.debugActiveRequests();
            }
            if (this.activeRequests[url]) {
                delete this.activeRequests[url];
            }
            if (!ended) {
                ended = true;
                if (!opts.shadowClient) {
                    let manifest;
                    if (mediaType == 'meta') {
                        manifest = url;
                    } else if (mediaType == 'video') {
                        if (!this.findSegmentIndexInJournal(url, this.activeManifest)) {
                            const pos = this.findJournalFromSegment(url);
                            if (pos && pos.journal && pos.journal != this.activeManifest) {
                                manifest = pos.journal;
                            }
                        }
                    }
                    if (manifest && manifest != this.activeManifest) {
                        this.activeManifest = manifest;
                        if (this.playlistsMeta[manifest]) {
                            if (this.playlistsMeta[manifest].bandwidth && !isNaN(this.playlistsMeta[manifest].bandwidth) && this.playlistsMeta[manifest].bandwidth > 0) {
                                this.bitrateChecker.save(this.playlistsMeta[manifest].bandwidth, true);
                            }
                            if (this.playlistsMeta[manifest].resolution) {
                                this.emit('dimensions', this.playlistsMeta[manifest].resolution);
                            }
                        }
                        this.finishObsoleteSegmentRequests(manifest);
                    }
                }
                if (this.activeManifest && this.committed) { // has downloaded at least one segment to know from where the player is starting
                    if (seg && this.bitrateChecker.acceptingSamples()) {
                        if (!this.playlistsMeta[this.activeManifest] || !this.codecData || !(this.codecData.audio || this.codecData.video)) {
                            this.committed && this.bitrateChecker.addSample(this.proxify(url));
                        }
                    }
                    // Using nextTick to prevent "RangeError: Maximum call stack size exceeded"
                    process.nextTick(() => (config.get('hls-prefetching') && this.prefetch(opts)))
                }
            }
        };
        request.once('response', (status, headers) => {
            if (this.validateStatus(status)) {
                mediaType = 'video';
                if (this.ext(request.currentURL) == 'm3u8' || (headers['content-type'] && headers['content-type'].match(this.mpegURLRegex))) {
                    mediaType = 'meta';
                }
            } else {
                if (this.debugConns) {
                    console.error('Request error', status, headers, url, request.authErrors, request.opts.maxAuthErrors);
                }
                if (this.debugUnfinishedRequests) {
                    osd.show('unfinished: ' + Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent');
                    osd.show('error ' + url.split('/').pop().split('?')[0] + ' - ' + status, 'fas fa-info-circle', 'hlsr', 'long');
                }
                if (status == 410) {
                    status = 404;
                }
                if (status == 404) {
                    this.report404ToJournal(url);
                    status = 204; // Exoplayer doesn't plays well with 404 errors
                }
            }
        });
        request.on('data', chunk => this.downloadLog(this.len(chunk)));
        request.once('end', end);
        return request;
    }
    async prefetch(opts) {
        if (this.destroyed) return
        let next = await this.getNextInactiveSegment();
        if (!next || Object.keys(this.activeRequests).length > 1) {
            this.debugConns && console.warn('NOT PREFETCHING', Object.values(this.activeRequests).length, this.lastUserRequestedSegment);
            return
        }
        this.debugConns && console.warn('PREFETCHING', this.lastUserRequestedSegment, '=>', next);
        const nopts = opts;
        nopts.url = next;
        nopts.cachedOnly = false;
        nopts.shadowClient = true;
        const dl = await this.download(nopts);
        dl.start()
    }
    debugActiveRequests() {
        if (Download.debugConns) {
            osd.show(Object.keys(this.activeRequests).length + ' active requests', 'fas fa-download', 'hlsprefetch', 'persistent');
        }
    }
    findJournal(url, altURL) {
        if (typeof(this.journals[url]) != 'undefined')
            return this.journals[url];
        if (typeof(this.journals[altURL]) != 'undefined')
            return this.journals[altURL];
        let ret, urls = [url, altURL];
        Object.values(this.journals).some(j => {
            if (j.altURL && urls.includes(j.altURL)) {
                ret = j;
                return true;
            }
        });
        return ret;
    }
}
class StreamerProxyHLS extends HLSRequests {
    constructor(opts) {
        super(opts);
        this.opts.port = 0;
        this.type = 'proxy';
        this.networkOnly = false;
        this.journals = {};
        this.opts.followRedirect = true; // some servers require m3u8 to requested by original url, otherwise will trigger 406 status, while the player may call directly the "location" header url on next requests ¬¬
        this.opts.forceExtraHeaders = null;
        /* disable content ranging, as we are rewriting meta and segments length comes incorrect from server sometimes */
        this.requestHeadersRemoval = ['range', 'cookie', 'referer', 'origin', 'user-agent'];
        if (this.opts.debug) {
            console.log('OPTS', this.opts);
        }
        this.once('destroy', () => {
            if (this.server) {
                this.server.close();
            }
        });
        this.playlists = {}; // fallback mirrors for when one playlist of these returns 404, it happens, strangely...
        this.playlistsMeta = {};
    }
    proxify(url) {
        if (typeof(url) == 'string' && url.includes('//')) {
            if (!this.opts.port) {
                console.error('proxify() before server is ready', url);
                return url; // srv not ready
            }
            url = this.unproxify(url);
            if (url.substr(0, 7) == 'http://') {
                url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + url.substr(7);
            } else if (url.substr(0, 8) == 'https://') {
                url = 'http://' + this.opts.addr + ':' + this.opts.port + '/s/' + url.substr(8);
            }
        }
        return url;
    }
    unproxify(url) {
        if (typeof(url) == 'string') {
            if (url.substr(0, 3) == '/s/') {
                url = 'https://' + url.substr(3);
            } else if (url.startsWith('/') && url.charAt(1) != '/') {
                url = 'http://' + url.substr(1);
            } else if (this.opts.addr && url.includes('//')) {
                if (url.includes(this.opts.addr + ':' + this.opts.port + '/')) {
                    url = url.replace(new RegExp('^(http://|//)' + this.opts.addr.replaceAll('.', '\\.') + ':' + this.opts.port + '/', 'g'), '$1');
                    url = url.replace('://s/', 's://');
                }
            }
            if (url.includes(';') && url.includes('&')) {
                url = decodeEntities(url);
            }
        }
        return url;
    }
    trackNameChooseAttrs(attributes) {
        let attrs = Object.assign({}, attributes);
        if (attrs['BANDWIDTH'] && attrs['AVERAGE-BANDWIDTH']) {
            delete attrs['AVERAGE-BANDWIDTH'];
        }
        if (Object.keys(attrs).length > 2 && attrs['FRAME-RATE']) {
            delete attrs['FRAME-RATE'];
        }
        if (Object.keys(attrs).length > 2 && attrs['CODECS']) {
            delete attrs['CODECS'];
        }
        return Object.keys(attrs);
    }
    trackName(track) {
        let name = this.trackNameChooseAttrs(track.attributes).map(k => {
            let v = track.attributes[k];
            if (k == 'RESOLUTION') {
                v = track.attributes[k].width + 'x' + track.attributes[k].height;
            }
            if (['AVERAGE-BANDWIDTH', 'BANDWIDTH'].includes(k)) {
                v = kbsfmt(parseInt(v));
            }
            return ucWords(k, true) + ': ' + v;
        }).join(' &middot; ');
        return name || track.uri;
    }
    proxifyM3U8(body, baseUrl, url) {
        if (!this.isM3U8Content(body))
            return body;
        body = body.trim();
        let u, parser = new ManifestParser(), replaces = {};
        try {
            parser.push(body);
            parser.end();
        }
        catch (e) {
            /*
            TypeError: Cannot read property 'slice' of null
    at parseAttributes (/data/data/tv.megacubo.app/files/www/nodejs-project/node_modules/m3u8-parser/dist/m3u8-parser.cjs.js:115:41)
            */
            console.error(e);
        }
        if (this.opts.debug) {
            console.log('M3U8 PARSED', baseUrl, url, parser);
        }
        if (parser.manifest) {
            if (parser.manifest.segments && parser.manifest.segments.length) {
                parser.manifest.segments.map(segment => {
                    segment.uri = segment.uri.trim();
                    let dn = this.getURLRoot(segment.uri);
                    if (typeof(replaces[dn]) == 'undefined') {
                        let df = segment.uri.length - dn.length;
                        if (this.opts.debug) {
                            console.log('dn', dn, df, segment.uri);
                        }
                        u = absolutize(segment.uri, baseUrl);
                        let n = this.proxify(u);
                        replaces[dn] = n.substr(0, n.length - df);
                        if (this.opts.debug) {
                            console.log('replace', dn, replaces[dn], '|', df, n, '|', segment.uri);
                        }
                        body = this.applyM3U8Replace(body, dn, replaces[dn]);
                        if (this.opts.debug) {
                            console.log('ok', replaces, body);
                        }
                    }
                });
                let journal = this.findJournal(baseUrl, url);
                if (typeof(journal) == 'undefined') {
                    this.journals[baseUrl] = journal = new HLSJournal(baseUrl, url, this);
                }
                journal.process(body);
                body = journal.readM3U8(body);
            }
            if (parser.manifest.playlists && parser.manifest.playlists.length) {
                if (typeof(this.playlists[url]) == 'undefined') {
                    this.playlists[url] = {};
                }
                parser.manifest.playlists.forEach(playlist => {
                    let dn = this.dirname(playlist.uri);
                    u = absolutize(playlist.uri, baseUrl);
                    if (!this.playlists[url][u]) {
                        this.playlists[url][u] = { state: true, name: this.trackName(playlist) }; // state=true here means "online"
                    }
                    if (typeof(replaces[dn]) == 'undefined') {
                        if (this.opts.debug) {
                            console.log('dn', dn);
                        }
                        replaces[dn] = this.dirname(this.proxify(u));
                        if (this.opts.debug) {
                            console.log('replace', dn, replaces[dn]);
                        }
                        body = this.applyM3U8Replace(body, dn, replaces[dn]);
                        if (this.opts.debug) {
                            console.log('ok');
                        }
                    }
                    if (playlist.attributes && !this.playlistsMeta[u]) {
                        this.playlistsMeta[u] = {};
                        if (playlist.attributes['AVERAGE-BANDWIDTH'] && parseInt(playlist.attributes['AVERAGE-BANDWIDTH']) > 128) {
                            this.playlistsMeta[u].bandwidth = parseInt(playlist.attributes['AVERAGE-BANDWIDTH']);
                        } else if (playlist.attributes['BANDWIDTH'] && parseInt(playlist.attributes['BANDWIDTH']) > 128) {
                            this.playlistsMeta[u].bandwidth = parseInt(playlist.attributes['BANDWIDTH']);
                        }
                        if (playlist.attributes['RESOLUTION']) {
                            this.playlistsMeta[u].resolution = playlist.attributes['RESOLUTION'].width + 'x' + playlist.attributes['RESOLUTION'].height;
                        }
                    }
                });
            }
            body = body.replace(new RegExp('(URI="?)([^\\n"\']+)', 'ig'), (...match) => {
                if (!match[2].includes('127.0.0.1')) {
                    match[2] = absolutize(match[2], baseUrl);
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
            if (!line.includes('/') || line.substr(0, 2) == './' || line.substr(0, 3) == '../') {
                if (from == '') {
                    lines[i] = joinPath(to, line);
                }
            } else {
                if (line.substr(0, from.length) == from) {
                    lines[i] = to + line.substr(from.length);
                }
            }
        });
        return lines.join("\n");
    }
    start() {
        return new Promise((resolve, reject) => {
            this.server = http.createServer(this.handleRequest.bind(this));
            this.serverStopper = stoppable(this.server);
            this.server.listen(0, this.opts.addr, (err) => {
                if (this.destroyed && !err) {
                    err = 'destroyed';
                }
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
    }
    async handleRequest(req, response) {
        if (this.destroyed || req.url.includes('favicon.ico')) {
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
        if (this.opts.debug) {
            console.log('req starting...', req.url);
        }
        let ended, url = this.unproxify(req.url);
        let reqHeaders = req.headers;
        reqHeaders = this.removeHeaders(reqHeaders, this.requestHeadersRemoval);
        if (this.type == 'network-proxy') {
            reqHeaders['x-from-network-proxy'] = '1';
        } else {
            if (reqHeaders['x-from-network-proxy']) {
                delete reqHeaders['x-from-network-proxy'];
            }
        }
        reqHeaders = this.getDefaultRequestHeaders(reqHeaders);
        if (this.opts.debug) {
            if (this.type == 'network-proxy') {
                console.log('network serving', url, reqHeaders);
            } else {
                console.log('serving', url, req, url, reqHeaders);
            }
        }
        let match;
        const isCacheable = this.committed && (match = url.match(this.isCacheableRegex)) && match.length && match[0].length; // strangely it was returning [""] sometimes on electron@9.1.2
        const cacheTTL = isCacheable ? config.get('live-window-time') : 0;
        const keepalive = this.committed && config.get('use-keepalive');
        const download = await this.download({
            url,
            cacheTTL,
            acceptRanges: !!cacheTTL,
            debug: false,
            headers: reqHeaders,
            authURL: this.opts.authURL || false,
            keepalive,
            followRedirect: this.opts.followRedirect,
            maxAuthErrors: this.committed ? 10 : 3,
            retries: this.committed ? 10 : 3
        });
        const abort = data => {
            if (!ended) {
                ended = true;
            }
            response.destroy();
            // download.destroy()
            if (this.opts.debug) {
                console.log('abort');
            }
        };
        const end = data => {
            if (!ended) {
                ended = true;
            }
            if (data && isWritable(response)) {
                response.write(data);
            }
            response.end();
            download.destroy();
            if (this.opts.debug) {
                console.log('ended');
            }
        };
        closed(req, response, download, () => {
            if (!ended) { // req disconnected
                if (this.opts.debug) {
                    console.log('response closed or request aborted', ended, response.ended);
                }
                end();
            }
        });
        download.on('error', err => {
            if (this.type == 'network-proxy') {
                console.log('network request error', url, err);
            }
            if (this.committed) {
                osd.show(lang.CONNECTION_FAILURE + ' (' + (err.response ? err.response.statusCode : 'timeout') + ')', 'fas fa-times-circle', 'debug-conn-err', 'normal');
                if (this.opts.debug) {
                    console.log('download err', err);
                }
            }
        });
        download.once('response', (statusCode, headers) => {
            //console.warn('RECEIVING RESPONSE', statusCode, headers, download.currentURL, download)
            headers = this.removeHeaders(headers, this.responseHeadersRemoval);
            headers = prepareCORS(headers, url);
            if (this.opts.forceExtraHeaders) {
                Object.assign(headers, this.opts.forceExtraHeaders);
            }
            //console.log('download response', url, statusCode, headers)
            headers['connection'] = 'close';
            if (!statusCode || [-1, 0, 401, 403].includes(statusCode)) {
                /* avoid to passthrough 403 errors to the client as some streams may return it esporadically */
                return abort();
            }
            if (statusCode >= 200 && statusCode < 300) { // is data response
                if (statusCode == 206) {
                    statusCode = 200;
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
                } else {
                    this.handleResponse(download, statusCode, headers, response, end);
                }
            } else {
                if (this.committed && (!statusCode || statusCode < 200 || statusCode >= 400)) { // skip redirects
                    osd.show(lang.CONNECTION_FAILURE + ' (' + (statusCode || 'timeout') + ')', 'fas fa-times-circle', 'debug-conn-err', 'normal');
                }
                let fallback, location;
                headers['content-length'] = 0;
                if (statusCode == 404) {
                    Object.keys(this.playlists).some(masterUrl => {
                        if (Object.keys(this.playlists[masterUrl]).includes(url)) { // we have mirrors for this playlist
                            Object.keys(this.playlists[masterUrl]).some(playlist => {
                                if (playlist == url) {
                                    this.playlists[masterUrl][playlist].state = false; // means offline
                                    return true;
                                }
                            });
                            let hasFallback = Object.keys(this.playlists[masterUrl]).some(playlist => {
                                if (playlist != url && this.playlists[masterUrl][playlist].state === true) {
                                    fallback = playlist;
                                    console.warn('Fallback playlist redirect', url, '>>', playlist, JSON.stringify(this.playlists));
                                    return true;
                                }
                            });
                            if (!hasFallback) {
                                console.warn('No more fallbacks', url, JSON.stringify(this.playlists));
                                this.fail(404);
                            }
                        }
                    });
                } else if (typeof(headers.location) != 'undefined') {
                    location = this.proxify(absolutize(headers.location, url));
                } else if (!statusCode) {
                    statusCode = 500;
                }
                if (fallback) {
                    headers.location = fallback;
                    response.writeHead(301, headers);
                    if (this.opts.debug) {
                        console.log('download sent response headers', 301, headers);
                    }
                } else if (location) {
                    headers.location = location;
                    statusCode = (statusCode >= 300 && statusCode < 400) ? statusCode : 307;
                    response.writeHead(statusCode, headers);
                    if (this.opts.debug) {
                        console.log('download sent response headers', statusCode, headers);
                    }
                } else {
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
    handleMetaResponse(download, statusCode, headers, response, end) {
        const isSRT = this.isSRT(headers, download.opts.url);
        if (isSRT)
            headers['content-type'] = 'text/vtt';
        let closed, data = [];
        if (headers['content-length'])
            delete headers['content-length'];
        if (!response.headersSent) {
            response.writeHead(statusCode, headers);
            if (this.opts.debug) {
                console.log('download sent response headers', statusCode, headers);
            }
        }
        download.on('data', chunk => {
            data.push(chunk);
            if (download.receivedUncompressed >= this.typeMismatchCheckingThreshold) {
                this.typeMismatchCheck(data);
            }
        });
        download.once('end', () => {
            data = String(Buffer.concat(data));
            if (isSRT) {
                data = this.srt2vtt(data);
            } else {
                data = this.proxifyM3U8(data, download.currentURL, download.opts.url);
            }
            if (!closed) {
                if (isWritable(response)) {
                    try {
                        //console.warn('RECEIVING wr', chunk)
                        response.write(data);
                    }
                    catch (e) {
                        console.error(e);
                        closed = true;
                    }
                }
            }
            end();
        });
    }
    handleResponse(download, statusCode, headers, response, end) {
        const ext1 = this.ext(download.opts.url);
        const ext2 = this.ext(download.currentURL);
        if (ext1 == 'm3u8' || ext2 == 'm3u8' ||
            (!ext1 && !ext2 && headers['content-type'] && headers['content-type'].match(this.mpegURLRegex)) // TS segments sent with application/x-mpegURL has been seen ¬¬
        ) {
            return this.handleMetaResponse(download, statusCode, headers, response, end);
        }
        let closed;
        if (!response.headersSent) {
            response.writeHead(statusCode, headers);
            if (this.opts.debug) {
                console.log('download sent response headers', statusCode, headers);
            }
        }
        //console.log('handleResponse', download.opts.url, headers, response.headersSent)
        download.on('data', chunk => {
            if (!closed) {
                if (isWritable(response)) {
                    try {
                        response.write(chunk);
                    }
                    catch (e) {
                        console.error(e);
                        closed = true;
                    }
                }
            }
        });
        download.once('end', end);
    }
}
export default StreamerProxyHLS;
