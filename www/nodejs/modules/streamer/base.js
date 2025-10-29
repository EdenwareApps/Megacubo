import { EventEmitter } from 'node:events'
import StreamInfo from './utils/stream-info.js'
import Mag from '../lists/mag.js'
import StreamerProxy from './utils/proxy.js'
import mega from '../mega/mega.js'
import Subtitles from '../subtitles/subtitles.js'
import { terms } from '../lists/tools.js'
import aac from './engines/aac.js'
import hls from './engines/hls.js'
import rtmp from './engines/rtmp.js'
import dash from './engines/dash.js'
import ts from './engines/ts.js'
import video from './engines/video.js'
import vodhls from './engines/vod-hls.js'
import vodts from './engines/vod-ts.js'
import yt from './engines/yt.js'
import config from '../config/config.js'
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import { getDomain, time, ucFirst } from '../utils/utils.js'
import StreamState from '../stream-state/stream-state.js'

const SYNC_BYTE = 0x47
const PACKET_SIZE = 188

class StreamerTools extends EventEmitter {
    constructor() {
        super()
        this.state = new StreamState(this)
        this.streamInfo = new StreamInfo()
        this.streamInfoCaching = {} // avoid iptv server abusing
        this.on('failure', data => this.invalidateInfoCache(data.url))
    }
    setOpts(opts) {
        if (opts && typeof(opts) == 'object') {
            Object.keys(opts).forEach((k) => {
                if (!['debug'].includes(k) && typeof(opts[k]) == 'function') {
                    this.on(k, opts[k]);
                } else {
                    this.opts[k] = opts[k];
                }
            });
        }
    }
    isEntry(e) {
        return typeof(e) == 'object' && e && typeof(e.url) == 'string';
    }
    validate(value) {
        let v = value.toLowerCase(), prt = v.substr(0, 4), pos = v.indexOf('://');
        if (['http'].includes(prt) && pos >= 4 && pos <= 6) {
            return true; // /^(?:(?:(?:https?|rt[ms]p[a-z]?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
        }
    }
    async info(url, retries = 2, entry = {}) {
        if (!url) {
            throw global.lang.INVALID_URL
        }
        this.pingSource && await this.pingSource(entry.source).catch(err => console.error(err))
        let type = false;
        const now = time();
        const isMAG = url.includes('#mag-'); // MAG URLs should be revalidated
        const cachingKey = this.infoCacheKey(url), skipSample = entry.skipSample || entry.allowBlindTrust || (entry.skipSample !== false && this.streamInfo.mi.isVideo(url));
        if (cachingKey && !isMAG && this.streamInfoCaching[cachingKey] && now < this.streamInfoCaching[cachingKey].until) {
            if (skipSample || (this.streamInfoCaching[cachingKey].sample && this.streamInfoCaching[cachingKey].sample.length)) {
                const result = Object.assign({}, this.streamInfoCaching[cachingKey]);
                if (result.url != url) { // avoid opening cached URL from other stream
                    result.url = url;
                    result.directURL = url;
                }
                return result;
            }
        }
        if (isMAG) {
            if (!entry.source) {
                throw 'Source URL required';
            }
            if (!this.magResolver || this.magResolver.id != entry.source) {
                this.magResolver = new Mag(entry.source);
                await this.magResolver.prepare();
            }
            url = await this.magResolver.link(url)
        }
        const nfo = await this.streamInfo.probe(url, retries, Object.assign({ skipSample }, entry));
        if (nfo && (nfo.headers || nfo.isLocalFile)) {
            Object.keys(this.engines).some(name => {
                if (this.engines[name].supports(nfo)) {
                    type = name
                    return true
                }
            })
        }
        const empty = !skipSample && !nfo.sample.length
        if (type && (!empty || type != 'ts')) {
            nfo.type = type;
            nfo.until = now + 600;
            this.streamInfoCaching[cachingKey] = nfo;
            return nfo;
        } else if (empty) {
            console.error('empty response', nfo, this.destroyed);
            throw 'empty response';
        } else {
            console.error('unknown stream type', nfo, this.destroyed);
            throw 'unknown stream type';
        }
    }
    infoCacheKey(url) {
        const rawType = this.streamInfo.rawType(url);
        const proto = this.streamInfo.mi.proto(url);
        const domain = getDomain(url);
        if (!rawType)
            return null;
        return [proto, domain, rawType].join('-');
    }
    invalidateInfoCache(url) {
        const cachingKey = this.infoCacheKey(url);
        if (cachingKey && this.streamInfoCaching[cachingKey]) {
            delete this.streamInfoCaching[cachingKey];
        }
    }
    isTuning() {
        return this.tuning && this.tuning.active();
    }
    ext(file) {
        let basename = String(file).split('?')[0].split('#')[0].split('/').pop();
        basename = basename.split('.');
        if (basename.length > 1) {
            return basename.pop().toLowerCase();
        } else {
            return '';
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
    isPacketized(sample) {
        return Buffer.isBuffer(sample) && sample.length >= PACKET_SIZE && sample[0] == SYNC_BYTE && sample[PACKET_SIZE] == SYNC_BYTE;
    }
    destroy() {
        this.removeAllListeners();
        this.destroyed = true;
        this.engines = {};
    }
}
class StreamerBase extends StreamerTools {
    constructor(opts) {
        super(opts);
        const { temp } = paths;
        this.opts = {
            workDir: temp + '/streamer',
            shadow: false,
            debug: false,
            osd: false
        };
        this.engines = {
            aac,
            hls,
            rtmp,
            dash,
            ts,
            video,
            vodhls,
            vodts,
            yt
        };
        this.loadingIntents = [];
        this.setOpts(opts);
    }
    registerLoadingIntent(intent) {
        this.loadingIntents.push(intent);
    }
    unregisterLoadingIntent(intent, keep) {
        if (!keep) {
            intent.cancel = true;
        }
        let i = this.loadingIntents.indexOf(intent);
        if (i != -1) {
            delete this.loadingIntents[i];
            this.loadingIntents = this.loadingIntents.filter(n => {
                return !!n;
            }).slice(0);
        }
    }
    unregisterAllLoadingIntents() {
        this.loadingIntents.forEach((intent, i) => {
            this.loadingIntents[i].cancel = true;
        });
        this.loadingIntents = [];
    }
    async intent(data, opts, aside) {
        if (!data.url) {
            throw global.lang.INVALID_URL;
        }
        if (!this.throttle(data.url)) {
            throw '401';
        }
        let err;
        const nfo = await this.info(data.url, 2, Object.assign({ allowBlindTrust: true }, data)).catch(e => err = e);
        if (err) {
            if (this.opts.debug) {
                console.log('ERR', err);
            }
            if (String(err).match(new RegExp('(: 401|^401$)'))) {
                this.forbid(data.url);
            }
            throw err;
        }
        return this.intentFromInfo(data, opts, aside, nfo);
    }
    async intentFromInfo(data, opts, aside, nfo) {
        opts = Object.assign(Object.assign({}, this.opts), opts || {});
        if (data && data['user-agent']) {
            opts.userAgent = data['user-agent'];
        }
        if (data && data['referer']) {
            opts.referer = data['referer'];
        }
        let intent;
        try {
            intent = new this.engines[nfo.type](data, opts, nfo);
        }
        catch (err) {
            throw 'Engine "' + nfo.type + '" not found. ' + err;
        }
        if (aside) {
            return intent;
        } else {
            this.unregisterAllLoadingIntents();
            this.registerLoadingIntent(intent);
            if (this.opts.debug) {
                console.log('RUN', intent, opts);
            }
            let err;
            await intent.start().catch(e => err = e);
            if (err) {
                if (!this.opts.shadow) {
                    global.osd && global.osd.hide('streamer');
                }
                this.unregisterLoadingIntent(intent);
                if (this.opts.debug) {
                    console.log('ERR', err);
                }
                intent.destroy();
                throw err;
            }
            this.unregisterLoadingIntent(intent, true);
            if (intent.cancel) {
                if (this.opts.debug) {
                    console.log('CANCEL');
                }
                intent.destroy();
                reject('cancelled by user');
            } else {
                if (this.opts.debug) {
                    console.log('COMMIT', intent);
                }
                await this.commit(intent);
                return intent;
            }
        }
    }
    reload() {
        console.warn('RELOADING');
        let data = this.active ? this.active.data : this.lastActiveData;
        if (data) {
            this.stop();
            process.nextTick(() => this.play(data));
        }
    }
    async typeMismatchCheck(info) {
        if (!this.active)
            return;
        if (this.active.typeMismatchChecked)
            return;
        this.active.typeMismatchChecked = true;
        let err;
        const data = this.active.data;
        if (!data.allowBlindTrust)
            return;
        data.allowBlindTrust = false;
        if (!info)
            info = await this.info(data.url, 2, data).catch(e => err = e);
        if (err !== undefined) {
            this.active.typeMismatchChecked = false;
            return false;
        }
        this.active.typeMismatchChecked = info;
        const incorrectEngineDetected = this.active && info &&
            info.type != this.active.info.type &&
            this.engines[info.type];
        console.error('TYPEMISMATCH', info.type, this.active.info.type);
        if (incorrectEngineDetected) {
            // some servers use m3u8 ext but send mp2t content directly on it
            // blind trust config may let pass these cases, so here is a late fix to reopen on right engine
            await this.intentFromInfo(data, {}, false, info); // commit fixed intent
        }
        return true;
    }
    async getProxyAdapter(intent) {
        let adapter;
        if (!intent) {
            intent = this.active;
        }
        if (!intent)
            return;
        adapter = intent.findAdapter(null, ['proxy'], a => !a.opts.agnostic);
        if (!adapter) {
            adapter = new StreamerProxy({ agnostic: false }); // agnostic mode will not transform to vtt
            intent.connectAdapter(adapter);
            await adapter.start();
        }
        return adapter;
    }
    pause() {
        if (this.active) {
            if (!this.opts.shadow) {
                renderer.ui.emit('pause');
            }
        }
    }
    stop(err) {
        console.error('streamer stop()');
        if (!this.opts.shadow) {
            global.osd && global.osd.hide('streamer');
            global.osd && global.osd.hide('transcode');
        }
        this.unregisterAllLoadingIntents();
        if (this.active) {
            let data = this.active.data;
            const elapsed = time() - this.active.commitTime
            this.emit('streamer-disconnect', err);
            if (!err && this.active.failed) {
                err = 'failed';
            }
            if (!err) { // stopped with no error
                let longWatchingThreshold = 15 * 60, watchingDuration = (time() - this.active.commitTime);
                if (this.active.commitTime && watchingDuration > longWatchingThreshold) {
                    renderer.ui.emit('streamer-long-watching', watchingDuration);
                    this.emit('streamer-long-watching', watchingDuration);
                }
            }
            this.active.destroy();
            this.active = null;
            this.emit('stop', err, data, elapsed)
        }
    }
    unload() {
        if (this.active) {
            this.active.emit('uncommit');
            this.emit('uncommit', this.active);
            this.stop();
        }
    }
}
class StreamerThrottling extends StreamerBase {
    constructor(opts) {
        super(opts);
        this.throttling = {};
        this.throttleTTL = 10;
    }
    throttle(url) {
        let rule = 'allow', domain = getDomain(url);
        if (typeof(this.throttling[domain]) != 'undefined') {
            let now = time();
            if (this.throttling[domain] > now) {
                rule = 'deny';
            } else {
                delete this.throttling[domain];
            }
        }
        return rule == 'allow';
    }
    forbid(url) {
        this.throttling[getDomain(url)] = time() + this.throttleTTL;
    }
}
class StreamerTracks extends StreamerThrottling {
    constructor(opts) {
        super(opts);
        if (!this.opts.shadow) {
            renderer.ui.on('audioTracks', tracks => {
                if (this.active) {
                    this.active.audioTracks = tracks;
                }
            });
            renderer.ui.on('subtitleTracks', tracks => {
                if (this.active) {
                    this.active.subtitleTracks = tracks;
                    if (!this.active.subtitleAutoConfigured && tracks.length && config.get('subtitles')) {
                        this.active.subtitleAutoConfigured = true;
                        const id = tracks[0].id || 0;
                        this.active.subtitleTrack = id;
                        renderer.ui.emit('streamer-subtitle-track', id);
                    }
                }
            });
        }
    }
    getTrackOptions(tracks, activeTrack) {
        const sep = ' &middot; ', opts = Object.keys(tracks).map((name, i) => {
            let opt = { template: 'option', text: name, id: 'track-' + i };
            if (tracks[name].url == activeTrack)
                opt.fa = 'fas fa-play';
            return opt;
        });
        let names = opts.map(o => o.text.split(sep));
        for (let i = 0; i < names[0].length; i++) {
            if (names.slice(1).map(n => n[i] || '').every(n => n == names[0][i])) {
                names.forEach((n, j) => {
                    names[j][i] = '';
                });
            }
        }
        names.forEach((n, i) => {
            opts[i].otext = opts[i].text;
            opts[i].text = n.filter(l => l).join(sep);
        });
        return opts;
    }
    getExtTrackOptions(tracks, activeTrack) {
        return this.removeCommonAttributes(tracks).map(track => {
            let text = track.label || track.name;
            if (!text) {
                if (track.lang) {
                    text = track.lang + ' ' + String(track.id);
                } else if (track.language) {
                    text = track.language + ' ' + String(track.id);
                } else {
                    text = String(track.id);
                }
            }
            let opt = { template: 'option', text, id: 'track-' + track.id };
            if (track.id == activeTrack)
                opt.fa = 'fas fa-check-circle';
            return opt;
        });
    }
    removeCommonAttributes(arr) {
        const valueCounts = {};
        arr.forEach(obj => {
            for (const key in obj) {
                valueCounts[key] = valueCounts[key] || {};
                valueCounts[key][obj[key]] = (valueCounts[key][obj[key]] || 0) + 1;
            }
        });
        const totalObjects = arr.length;
        const attributesToDelete = [];
        for (const key in valueCounts) {
            const values = Object.keys(valueCounts[key]);
            if (values.length !== totalObjects) {
                attributesToDelete.push(key);
            }
        }
        attributesToDelete.length && arr.forEach(obj => {
            attributesToDelete.forEach(attr => {
                delete obj[attr];
            });
        });
        return arr;
    }
    async showQualityTrackSelector() {
        if (!this.active)
            return;
        let activeTrackId, activeTrack = this.active.getActiveQualityTrack();
        let tracks = await this.active.getQualityTracks(true);
        let opts = this.getTrackOptions(tracks, activeTrack);
        opts.forEach(o => {
            if (o.fa)
                activeTrackId = o.id;
        });
        opts.unshift({ template: 'question', text: global.lang.SELECT_QUALITY });
        let ret = await global.menu.dialog(opts, activeTrackId);
        if (ret) {
            let uri, bandwidth;
            opts.some(o => {
                if (o.id != ret)
                    return;
                const track = tracks[o.otext || o.text];
                if (track) {
                    uri = this.active.prx.proxify(track.url);
                    bandwidth = track.bandwidth;
                    return true;
                }
            });
            if (uri && uri != this.active.endpoint) {
                this.active.setActiveQualityTrack(uri, bandwidth);
                this.active.endpoint = uri;
                await this.uiConnect();
            }
        }
        return { ret, opts };
    }
    async showAudioTrackSelector() {
        if (!this.active)
            return;
        let activeTrackId, activeTrack = this.active.audioTrack, tracks = this.active.getAudioTracks(), opts = this.getExtTrackOptions(tracks, activeTrack);
        opts.forEach(o => {
            if (o.fa)
                activeTrackId = o.id;
        });
        opts.unshift({ template: 'question', fa: 'fas fa-volume-up', text: global.lang.SELECT_AUDIO });
        let ret = await global.menu.dialog(opts, activeTrackId);
        console.warn('TRACK OPTS RET', ret, opts);
        if (ret) {
            const n = ret.replace(new RegExp('^track-'), '');
            this.active.audioTrack = n;
            renderer.ui.emit('streamer-audio-track', n);
        }
        return { ret, opts };
    }
    async showSubtitleTrackSelector() {
        if (!this.active)
            return;
        let activeTrackId, activeTrack = this.active.subtitleTrack, tracks = this.active.getSubtitleTracks(), opts = this.getExtTrackOptions(tracks, activeTrack);
        let hasActive = opts.some(o => !!o.fa);
        opts.unshift({ template: 'option', text: global.lang.NONE, id: 'track--1', fa: hasActive ? undefined : 'fas fa-check-circle' });
        opts.forEach(o => {
            if (o.fa)
                activeTrackId = o.id;
        });
        opts.unshift({ template: 'question', fa: 'fas fa-comments', text: global.lang.SELECT_SUBTITLE });
        if (!paths.android && this.active.mediaType == 'video') {
            opts.push({ template: 'option', fa: 'fas fa-search-plus', details: 'Opensubtitles.com', id: 'search', text: global.lang.SEARCH });
        }
        let ret = await global.menu.dialog(opts, activeTrackId);
        if (ret == 'search') {
            await this.showSearchSubtitleTrackSelector();
        } else if (ret) {
            const n = ret.replace(new RegExp('^track-'), '');
            this.active.subtitleTrack = n;
            renderer.ui.emit('streamer-subtitle-track', n);
            config.set('subtitles', ret != '-1');
        }
    }
    async showSearchSubtitleTrackSelector(query, ask) {
        if (!this.active)
            return;
        if (!this.subtitles)
            this.subtitles = new Subtitles();
        if (!query) {
            query = terms(this.active.data.name).join(' ');
        }
        let err, hasActive, activeTrackId = '', cancelId = 'track--1';
        let extraOpts = [];
        extraOpts.push({ template: 'option', text: global.lang.SEARCH, id: 'submit', fa: 'fas fa-search' });
        extraOpts.push({ template: 'option', text: global.lang.CANCEL, id: cancelId, fa: 'fas fa-times-circle' });
        if (!query || ask) {
            query = await global.menu.prompt({
                question: global.lang.ADJUST_SEARCH_TERMS,
                defaultValue: query,
                placeholder: query,
                fa: 'fas fa-search-plus',
                extraOpts
            });
        }
        global.osd && global.osd.show(global.lang.SEARCHING, 'fa-mega busy-x', 'search-subs', 'persistent');
        const results = await this.subtitles.search(query).catch(e => err = e);
        global.osd && global.osd.hide('search-subs');
        if (err)
            global.menu.displayErr(err);
        if (!Array.isArray(results) || !results.length) {
            if (query && query != cancelId) {
                err || global.menu.displayErr(global.lang.NOT_FOUND + ', ' + global.lang.X_RESULTS.format(0));
                await this.showSearchSubtitleTrackSelector(query, true);
            }
            return;
        }
        const opts = results.map(r => {
            return {
                template: 'option',
                text: r.name,
                id: r.url
            };
        });
        opts.push({ template: 'option', text: global.lang.NONE, id: cancelId, fa: hasActive ? undefined : 'fas fa-check-circle' });
        opts.push({ template: 'option', text: global.lang.SEARCH, id: 'search', fa: 'fas fa-search' });
        /*
        opts.forEach(o => {
            if(o.fa) activeTrackId = o.id
        })
        */
        opts.unshift({ template: 'question', fa: 'fas fa-comments', text: global.lang.SELECT_SUBTITLE });
        const ret = await global.menu.dialog(opts, activeTrackId);
        console.error('SELECTED SUB OK: ' + ret);
        if (ret == 'search') {
            await this.showSearchSubtitleTrackSelector(query, true);
        } else if (ret != cancelId) {
            const i = results.findIndex(r => r.url == ret);
            this.active.subtitleTrack = ret;
            renderer.ui.emit('streamer-add-subtitle-track', results[i]);
            config.set('subtitles', true);
        } else {
            config.set('subtitles', false);
        }
    }
}
class Streamer extends StreamerTracks {
    constructor(opts) {
        super(opts)
    }
    async handleFailure(e, r, silent, doTune) {
        let c = doTune ? 'tune' : 'stop'
        if (!this.isEntry(e)) {
            if (this.active) {
                e = this.active.data;
            } else {
                e = this.lastActiveData;
            }
        }
        if (!doTune || !config.get('play-while-loading')) {
            this.stop({ err: r });
        }
        this.emit('failure', e);
        if (this.opts.shadow)
            return;
        if (this.zap.isZapping) {
            c = 'stop';
        } else if (c != 'tune' && e && (this.tuning && this.tuning.has(e.url))) {
            c = 'tune';
        }
        if ((r != null && typeof(r) != 'undefined') && (c != 'tune' || !e) && (silent !== true || c == 'stop' || !e)) {
            this.handleFailureMessage(r);
        }
        console.error('Streamer failure:', { 
            reason: typeof r === 'string' ? r : 'unknown',
            action: c,
            hasEntry: !!e,
            entryType: e ? e.type : 'none'
        });
        
        const isMega = e && mega.isMega(e.url);
        if (!isMega && e) {
            if (c == 'stop') {
                const tms = global.channels.entryTerms(e, true)
                const ch = global.channels.isChannel(tms)
                if (ch) {
                    const skips = [global.lang.STREAMS, global.lang.MY_LISTS, global.lang.CATEGORY_MOVIES_SERIES];
                    if (skips.every(s => !global.menu.path.includes(s))) {
                        const chosen = await global.menu.dialog([
                            { template: 'question', text: global.lang.PLAYBACK_OFFLINE_STREAM, fa: 'fas fa-exclamation-triangle faclr-red' },
                            { template: 'message', text: global.lang.PLAY_ALTERNATE_ASK },
                            { template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                            { template: 'option', text: global.lang.NO, id: 'no', fa: 'fas fa-times-circle' },
                            { template: 'option', text: global.lang.RETRY, id: 'retry', fa: 'fas fa-redo' }
                        ], 'yes')
                        if (chosen == 'yes')
                            c = 'tune'
                        else if(chosen == 'retry') {
                            return this.reload()
                        }
                    }
                }
            }
            if (c != 'stop') {
                if (await this.tune(e))
                    return;
                if (!config.get('play-while-loading')) {
                    this.stop({ err: 'tune failure' });
                }
            }
        }
        this.emit('hard-failure', [e]);
    }
    humanizeFailureMessage(r){
		r = String(r)
		let msg = global.lang.PLAYBACK_OFFLINE_STREAM, status = ''
        switch(r) {
            case 'playback':
                msg = global.lang.PLAYBACK_ERROR
                break
            case 'network':
                msg = global.lang.PLAYBACK_OVERLOADED_SERVER
                break
            case 'request error':
                msg = global.lang.PLAYBACK_OFFLINE_STREAM
                status = r
                break
            case 'timeout':
                msg = global.lang.SLOW_SERVER
                status = 'timeout'
                break
            case 'unsupported format':
            case 'invalid url':
                msg = global.lang.PLAYBACK_UNSUPPORTED_STREAM
                break
            default:
                msg = r
                let code = msg.match(new RegExp('(code|error):? ([0-9]+)'))
                code = String((code && code.length) ? code[2] : msg)
                const http = require('http');
                if(http.STATUS_CODES[code]) {
                    status = http.STATUS_CODES[code].toLowerCase()
                }
                switch(code){
                    case '-7':
                        msg = 'Worker crashed.'
                        status = 'worker exited'
                        break
                    case '0':
                        msg = global.lang.SLOW_SERVER
                        status = 'timeout'
                        break
                    case '400':
                    case '401':
                    case '403':
                        msg = global.lang.PLAYBACK_PROTECTED_STREAM
                        break
                    case '458':
                        msg = 'Content blocked - Check subscription or region'
                        status = 'license restriction'
                        break
                    case '-1':
                    case '404':
                    case '406':
                    case '410':
                    case '508':
                        msg = global.lang.PLAYBACK_OFFLINE_STREAM
                        if(r == -1) status = 'unreachable'
                        break
                    case '421':
                    case '453':
                    case '500':
                    case '502':
                    case '503':
                    case '504':
                        msg = global.lang.PLAYBACK_OVERLOADED_SERVER
                        break
                    case '422':
                        msg = global.lang.NO_INTERNET_CONNECTION
                        break
                }
        }
        if(status) {
            msg += ': '+ ucFirst(status)
        }
        return msg
    }
    handleFailureMessage(r) {
        process.nextTick(() => {
            global.osd && global.osd.show(this.humanizeFailureMessage(r), 'fas fa-exclamation-triangle faclr-red', 'failure', 'normal');
        })
    }
}
export default Streamer;
