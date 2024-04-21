import Download from '../download/download.js'
import osd from '../osd/osd.js'
import lang from "../lang/lang.js";
import storage from '../storage/storage.js'
import { EventEmitter } from "events";
import StreamInfo from "./utils/stream-info.js";
import Mag from "../lists/mag.js";
import StreamerProxy from "./utils/proxy.js";
import mega from "../mega/mega.js";
import Subtitles from "../subtitles/subtitles.js";
import listsTools from "../lists/tools.js";
import cloud from "../cloud/cloud.js";
import Zap from "../zap/zap.js";
import AutoTuner from "../tuner/auto-tuner.js";
import aac from './engines/aac.js'
import hls from './engines/hls.js'
import rtmp from './engines/rtmp.js'
import dash from './engines/dash.js'
import ts from './engines/ts.js'
import video from './engines/video.js'
import vodhls from './engines/vod-hls.js'
import vodts from './engines/vod-ts.js'
import yt from './engines/yt.js'
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import paths from '../paths/paths.js'
import { deepClone, kbsfmt, ucFirst, ucWords, validateURL } from "../utils/utils.js";
import StreamState from "../stream-state/stream-state.js";

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
        if (opts && typeof (opts) == 'object') {
            Object.keys(opts).forEach((k) => {
                if (['debug'].indexOf(k) == -1 && typeof (opts[k]) == 'function') {
                    this.on(k, opts[k]);
                }
                else {
                    this.opts[k] = opts[k];
                }
            });
        }
    }
    isEntry(e) {
        return typeof (e) == 'object' && e && typeof (e.url) == 'string';
    }
    validate(value) {
        let v = value.toLowerCase(), prt = v.substr(0, 4), pos = v.indexOf('://');
        if (['http'].includes(prt) && pos >= 4 && pos <= 6) {
            return true; // /^(?:(?:(?:https?|rt[ms]p[a-z]?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
        }
    }
    isLocalFile(file) {
        if (typeof (file) != 'string') {
            return;
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true;
        }
        else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true;
            }
        }
    }
    async info(url, retries = 2, entry = {}) {
        if (!url) {
            throw lang.INVALID_URL;
        }
        await this.pingSource(entry.source).catch(console.error);
        let type = false;
        const now = (Date.now() / 1000);
        const isMAG = url.indexOf('#mag-') != -1; // MAG URLs should be revalidated
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
            url = await this.magResolver.link(url);
        }
        const nfo = await this.streamInfo.probe(url, retries, Object.assign({ skipSample }, entry));
        if (nfo && (nfo.headers || nfo.isLocalFile)) {
            Object.keys(this.engines).some(name => {
                if (this.engines[name].supports(nfo)) {
                    type = name;
                    return true;
                }
            });
        }
        if (type) {
            if (type == 'ts' && !skipSample && !nfo.sample.length) {
                console.error('empty response', entry, nfo, Object.keys(this.engines).slice(0), this.destroyed);
                throw 'empty response';
            }
            nfo.type = type;
            nfo.until = now + 600;
            this.streamInfoCaching[cachingKey] = nfo;
            return nfo;
        }
        else {
            console.error('unknown stream type', nfo, Object.keys(this.engines).slice(0), this.destroyed);
            throw 'unknown stream type';
        }
    }
    infoCacheKey(url) {
        const rawType = this.streamInfo.rawType(url);
        const proto = this.streamInfo.mi.proto(url);
        const domain = this.streamInfo.mi.getDomain(url);
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
        }
        else {
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
            throw lang.INVALID_URL;
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
            if (String(err).match(new RegExp("(: 401|^401$)"))) {
                this.forbid(data.url);
            }
            throw err;
        }
        return await this.intentFromInfo(data, opts, aside, nfo);
    }
    async pingSource(url) {
        if (typeof (this._streamerPingSourceTTLs) == 'undefined') { // using global here to make it unique between any tuning and streamer
            this._streamerPingSourceTTLs = {};
        }
        if (validateURL(url) && !url.match(new RegExp('#(xtr|mag)'))) {
            let now = (Date.now() / 1000);
            if (!this._streamerPingSourceTTLs[url] || this._streamerPingSourceTTLs[url] < now) {
                console.log('pingSource', this._streamerPingSourceTTLs[url], now);
                this._streamerPingSourceTTLs[url] = now + 60; // lock while connecting
                let err;
                const ret = await Download.head({
                    url,
                    timeout: 10,
                    retry: 0,
                    receiveLimit: 1,
                    followRedirect: true
                }).catch(r => err = r);
                if (typeof (err) != 'undefined') {
                    console.warn('pingSource error?: ' + String(err));
                }
                else {
                    console.log('pingSource: ok');
                    if (ret.statusCode < 200 || ret.statusCode >= 400) { // in case of error, renew after 5min
                        this._streamerPingSourceTTLs[url] = now + 300;
                    }
                    else { // in case of success, renew after 10min
                        this._streamerPingSourceTTLs[url] = now + 600;
                    }
                }
            }
        }
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
        }
        else {
            this.unregisterAllLoadingIntents();
            this.registerLoadingIntent(intent);
            if (this.opts.debug) {
                console.log('RUN', intent, opts);
            }
            let err;
            await intent.start().catch(e => err = e);
            if (err) {
                if (!this.opts.shadow) {
                    osd.hide('streamer');
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
            }
            else {
                if (this.opts.debug) {
                    console.log('COMMIT', intent);
                }
                await this.commit(intent);
                return intent;
            }
        }
    }
    async askExternalPlayer() {
        if (!this.active || paths.android)
            return;
        const url = this.active.data.url;
        const chosen = await this.menu.dialog([
            { template: 'question', text: lang.OPEN_EXTERNAL_PLAYER_ASK, fa: 'fas fa-play' },
            { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle' }
        ], 'yes');
        if (chosen == 'yes') {
            renderer.get().emit('external-player', url);
            return true;
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
    async commit(intent) {
        if (intent) {
            if (this.active == intent) {
                return true; // 'ALREADY COMMITTED'
            }
            else {
                if (this.opts.debug) {
                    console.log('COMMITTING');
                }
                if (intent.destroyed) {
                    console.error('COMMITTING DESTROYED INTENT', intent);
                    return false;
                }
                if (this.opts.debug) {
                    console.log('INTENT SWITCHED !!', this.active ? this.active.data : false, intent ? intent.data : false, intent.destroyed);
                    if (!intent.opts.debug) {
                        intent.opts.debug = this.opts.debug;
                    }
                }
                this.unload();
                this.active = intent; // keep referring below as intent to avoid confusion on changing intents, specially inside events
                this.lastActiveData = this.active.data;
                intent.committed = true;
                intent.commitTime = (Date.now() / 1000);
                intent.once('destroy', () => {
                    console.error('streamer intent destroy()');
                    if (intent == this.active) {
                        this.emit('uncommit', intent);
                        if (this.opts.debug) {
                            console.log('ACTIVE INTENT UNCOMMITTED & DESTROYED!!', intent, this.active);
                        }
                        this.stop();
                    }
                    if (this.opts.debug) {
                        console.log('INTENT UNCOMMITTED & DESTROYED!!', intent);
                    }
                });
                intent.on('bitrate', bitrate => {
                    if (intent == this.active) {
                        renderer.get().emit('streamer-bitrate', bitrate);
                    }
                });
                intent.on('type-mismatch', () => this.typeMismatchCheck());
                intent.on('fail', err => {
                    this.emit('uncommit', intent);
                    if (this.opts.debug) {
                        console.log('INTENT FAILED !!');
                    }
                    this.handleFailure(intent.data, err).catch(e => this.menu.displayErr(e));
                });
                intent.on('codecData', async (codecData) => {
                    if (codecData && intent == this.active) {
                        renderer.get().emit('codecData', codecData);
                    }
                    if (!paths.android && !intent.isTranscoding()) {
                        if (codecData.video && codecData.video.match(new RegExp('(mpeg2video|mpeg4)')) && intent.opts.videoCodec != 'libx264') {
                            const openedExternal = await this.askExternalPlayer().catch(console.error);
                            if (openedExternal !== true) {
                                if ((!this.tuning && !this.zap.isZapping) || config.get('transcoding-tuning')) {
                                    this.transcode(null, err => {
                                        if (err)
                                            intent.fail('unsupported format');
                                    });
                                }
                                else {
                                    return intent.fail('unsupported format');
                                }
                            }
                        }
                    }
                });
                intent.on('streamer-connect', () => this.uiConnect().catch(console.error));
                if (intent.codecData) {
                    intent.emit('codecData', intent.codecData);
                }
                this.emit('commit', intent);
                intent.emit('commit');
                await this.uiConnect(intent);
                console.warn('STREAMER COMMIT ' + intent.data.url);
                return true;
            }
        }
        else {
            return 'NO INTENT';
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
    async uiConnect(intent, skipTranscodingCheck) {
        const {default: icons} = await import('../icon-server/icon-server.js')
        if (!intent)
            intent = this.active;
        const data = Object.assign({}, intent.data); // clone it before to change subtitle attr or any other
        if (data.subtitle) {
            const adapter = await this.getProxyAdapter(intent);
            data.subtitle = adapter.proxify(data.subtitle);
        }
        data.engine = intent.type;
        if (data.icon) {
            data.originalIcon = data.icon;
            data.icon = icons.url + icons.key(data.icon);
        }
        else {
            data.icon = icons.url + this.channels.entryTerms(data).join(',');
        }
        intent.on('outside-of-live-window', () => renderer.get().emit('outside-of-live-window'));
        this.emit('streamer-connect', intent.endpoint, intent.mimetype, data);
        if (!skipTranscodingCheck && intent.transcoderStarting) {
            renderer.get().emit('streamer-connect-suspend');
            if (!this.opts.shadow) {
                osd.hide('streamer');
            }
        }
        return data;
    }
    transcode(intent, _cb, silent) {
        let transcoding = config.get('transcoding');
        let cb = (err, transcoder) => {
            if (typeof (_cb) == 'function') {
                _cb(err, transcoder);
                _cb = null;
            }
        };
        if (!intent) {
            if (this.active) {
                intent = this.active;
            }
            else {
                return cb(lang.START_PLAYBACK_FIRST);
            }
        }
        if ((transcoding || silent) && intent.transcode) {
            if (intent.transcoder) {
                if (intent.transcoderStarting) {
                    intent.transcoder.once('transcode-started', () => cb(null, intent.transcoder));
                    intent.transcoder.once('transcode-failed', cb);
                }
                else {
                    cb(null, intent.transcoder);
                }
            }
            else {
                console.warn('Transcoding started');
                if (!silent) {
                    renderer.get().emit('streamer-connect-suspend');
                    renderer.get().emit('transcode-starting', true);
                }
                intent.transcode().then(async () => {
                    await this.uiConnect(intent, true);
                    cb(null, intent.transcoder);
                }).catch(err => {
                    if (this.active) {
                        console.error(err);
                        cb(err);
                        intent.fail('unsupported format', err, intent.codecData);
                        silent || intent.fail('unsupported format');
                    }
                }).finally(() => {
                    renderer.get().emit('transcode-starting', false);
                });
            }
            return true;
        }
        else {
            cb('Transcoding unavailable');
        }
    }
    pause() {
        if (this.active) {
            if (!this.opts.shadow) {
                renderer.get().emit('pause');
            }
        }
    }
    stop(err) {
        console.error('streamer stop()');
        if (!this.opts.shadow) {
            osd.hide('streamer');
            osd.hide('transcode');
        }
        this.unregisterAllLoadingIntents();
        if (this.active) {
            let data = this.active.data;
            this.emit('streamer-disconnect', err);
            console.log('STREAMER->STOP', err);
            if (!err && this.active.failed) {
                err = 'failed';
            }
            if (!err) { // stopped with no error
                let longWatchingThreshold = 15 * 60, watchingDuration = ((Date.now() / 1000) - this.active.commitTime);
                console.log('STREAMER->STOP', watchingDuration, this.active.commitTime);
                if (this.active.commitTime && watchingDuration > longWatchingThreshold) {
                    renderer.get().emit('streamer-long-watching', watchingDuration);
                    this.emit('streamer-long-watching', watchingDuration);
                }
            }
            this.active.destroy();
            this.active = null;
            this.emit('stop', err, data);
        }
    }
    share() {
        if (this.active && !this.opts.shadow) {
            let url = this.active.data.originalUrl || this.active.data.url;
            let name = this.active.data.originalName || this.active.data.name;
            let icon = this.active.data.originalIcon || this.active.data.icon;
            if (mega.isMega(url)) {
                renderer.get().emit('share', ucWords(paths.manifest.name), name, 'https://megacubo.tv/w/' + encodeURIComponent(url.replace('mega://', '')));
            }
            else {
                url = mega.build(name, { url, icon, mediaType: this.active.mediaType });
                renderer.get().emit('share', ucWords(paths.manifest.name), name, url.replace('mega://', 'https://megacubo.tv/w/'));
            }
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
class StreamerSpeedo extends StreamerBase {
    constructor(opts) {
        super(opts);
        this.downlink = 0;
        if (!this.opts.shadow) {
            renderer.get().on('downlink', downlink => this.downlink = downlink);
            this.on('commit', this.startSpeedo.bind(this));
            this.on('uncommit', this.endSpeedo.bind(this));
            this.on('speed', speed => renderer.get().emit('streamer-speed', speed));
            this.speedoSpeedListener = speed => this.emit('speed', speed);
        }
    }
    bindSpeedo() {
        this.unbindSpeedo();
        this.speedoAdapter = this.active.findLowAdapter(this.active, ['proxy', 'downloader', 'joiner']); // suitable adapters to get download speed
        if (this.speedoAdapter) {
            this.speedoAdapter.on('speed', this.speedoSpeedListener);
        }
    }
    unbindSpeedo() {
        if (this.speedoAdapter) {
            this.speedoAdapter.removeListener('speed', this.speedoSpeedListener);
            this.speedoAdapter = false;
        }
    }
    startSpeedo() {
        if (this.active && !this.speedoAdapter) {
            this.bindSpeedo();
        }
    }
    endSpeedo() {
        this.unbindSpeedo();
    }
}
class StreamerThrottling extends StreamerSpeedo {
    constructor(opts) {
        super(opts);
        this.throttling = {};
        this.throttleTTL = 10;
    }
    throttle(url) {
        let rule = 'allow', domain = this.streamInfo.mi.getDomain(url);
        if (typeof (this.throttling[domain]) != 'undefined') {
            let now = (Date.now() / 1000);
            if (this.throttling[domain] > now) {
                rule = 'deny';
            }
            else {
                delete this.throttling[domain];
            }
        }
        return rule == 'allow';
    }
    forbid(url) {
        this.throttling[this.streamInfo.mi.getDomain(url)] = (Date.now() / 1000) + this.throttleTTL;
    }
}
class StreamerGoNext extends StreamerThrottling {
    constructor(opts) {
        super(opts);
        if (!this.opts.shadow) {
            renderer.get().on('video-ended', () => {
                if (this.active && this.active.mediaType == 'video') {
                    this.goNext().catch(e => this.menu.displayErr(e));
                }
            });
            renderer.get().on('video-resumed', () => this.cancelGoNext());
            renderer.get().on('stop', () => this.cancelGoNext());
            renderer.get().on('go-prev', () => this.goPrev().catch(e => this.menu.displayErr(e)));
            renderer.get().on('go-next', () => this.goNext(true).catch(e => this.menu.displayErr(e)));
            this.on('pre-play-entry', e => this.saveQueue(e).catch(e => this.menu.displayErr(e)));
            this.on('streamer-connect', () => this.goNextButtonVisibility().catch(e => this.menu.displayErr(e)));
            process.nextTick(() => {
                this.aboutRegisterEntry('gonext', async () => {
                    if (this.active.mediaType == 'video') {
                        const next = await this.getNext();
                        if (next)
                            return { template: 'option', fa: 'fas fa-step-forward', text: lang.GO_NEXT, id: 'gonext' };
                    }
                }, () => this.goNext().catch(e => this.menu.displayErr(e)), null, true);
            });
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    async getQueue() {
        let entries = await storage.get('streamer-go-next-queue').catch(console.error);
        if (!Array.isArray(entries))
            entries = [];
        return entries;
    }
    async getPrev(offset = 0) {
        const entry = this.active ? this.active.data : this.lastActiveData;
        const entries = await this.getQueue();
        if (entry && entries.length) {
            let prev, found = -1;
            if (entry.originalUrl)
                found = entries.findIndex(e => (e.originalUrl || e.url) == entry.originalUrl);
            if (found == -1)
                found = entries.findIndex(e => e.url == entry.url);
            if (found == -1)
                return false;
            entries.slice(0, found).reverse().some(e => {
                if (e) {
                    if (offset) {
                        offset--;
                    }
                    else {
                        prev = e;
                        return true;
                    }
                }
            });
            return prev;
        }
    }
    async getNext(offset = 0) {
        const entry = this.active ? this.active.data : this.lastActiveData;
        const entries = await this.getQueue();
        if (entry && entries.length) {
            let next, found = -1;
            if (entry.originalUrl)
                found = entries.findIndex(e => (e.originalUrl || e.url) == entry.originalUrl);
            if (found == -1)
                found = entries.findIndex(e => e.url == entry.url);
            if (found == -1)
                return false;
            entries.slice(found + 1).some(e => {
                if (e) {
                    if (offset) {
                        offset--;
                    }
                    else {
                        next = e;
                        return true;
                    }
                }
            });
            return next;
        }
    }
    async saveQueue(e) {
        if (e.url) {
            const entries = this.menu.currentStreamEntries(true); // will clone before alter
            if (entries.length > 1) {
                storage.set('streamer-go-next-queue', entries.map(n => {
                    if (n.renderer)
                        delete n.renderer;
                    return n;
                }), { expiration: true });
            }
        }
    }
    async goNextButtonVisibility() {
        const next = await this.getNext();
        renderer.get().emit('enable-player-button', 'next', !!next);
    }
    async goPrev() {
        let offset = 0;
        
        const msg = lang.GOING_PREVIOUS;
        osd.show(msg, 'fa-mega spin-x-alt', 'go-next', 'persistent');
        this.goingNext = true;
        while (true) {
            const prev = await this.getPrev(offset), ret = {};
            if (!prev)
                break;
            const isMega = mega.isMega(prev.url);
            if (!isMega) {
                ret.info = await this.info(prev.url, 2, Object.assign({ allowBlindTrust: true, skipSample: true }, prev)).catch(err => ret.err = err);
                if (ret.err) {
                    offset++;
                    continue; // try prev one
                }
            }
            if (this.goingNext !== true)
                return; // cancelled
            let err;
            if (isMega) {
                await this.play(prev).catch(err => err = err);
            }
            else {
                await this.intentFromInfo(prev, {}, undefined, ret.info).catch(e => err = e);
            }
            if (err) {
                offset++;
                continue; // try prev one
            }
            else {
                break;
            }
        }
        this.goingNext = false;
        osd.hide('go-next');
    }
    async goNext(immediate) {
        let offset = 0, start = (Date.now() / 1000), delay = immediate ? 0 : 5;
        
        const msg = delay ? lang.GOING_NEXT_SECS_X.format(delay) : lang.GOING_NEXT;
        osd.show(msg, 'fa-mega spin-x-alt', 'go-next', 'persistent');
        this.goingNext = true;
        while (true) {
            const next = await this.getNext(offset), ret = {};
            if (!next)
                break;
            const isMega = mega.isMega(next.url);
            if (!isMega) {
                ret.info = await this.info(next.url, 2, Object.assign({ allowBlindTrust: true, skipSample: true }, next)).catch(err => ret.err = err);
                if (ret.err) {
                    offset++;
                    continue; // try next one
                }
            }
            const now = (Date.now() / 1000), elapsed = now - start;
            if (this.goingNext !== true)
                return; // cancelled
            let err;
            if (elapsed < delay)
                await this.sleep((delay - elapsed) * 1000);
            if (isMega) {
                await this.play(next).catch(err => err = err);
            }
            else {
                await this.intentFromInfo(next, {}, undefined, ret.info).catch(e => err = e);
            }
            if (err) {
                offset++;
                continue; // try next one
            }
            else {
                break;
            }
        }
        this.goingNext = false;
        osd.hide('go-next');
    }
    cancelGoNext() {
        delete this.goingNext;
        osd.hide('go-next');
    }
}
class StreamerTracks extends StreamerGoNext {
    constructor(opts) {
        super(opts);
        if (!this.opts.shadow) {
            renderer.get().on('audioTracks', tracks => {
                if (this.active) {
                    this.active.audioTracks = tracks;
                }
            });
            renderer.get().on('subtitleTracks', tracks => {
                if (this.active) {
                    this.active.subtitleTracks = tracks;
                    if (!this.active.subtitleAutoConfigured && tracks.length && config.get('subtitles')) {
                        this.active.subtitleAutoConfigured = true;
                        const id = tracks[0].id || 0;
                        this.active.subtitleTrack = id;
                        renderer.get().emit('streamer-subtitle-track', id);
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
                }
                else if (track.language) {
                    text = track.language + ' ' + String(track.id);
                }
                else {
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
        opts.unshift({ template: 'question', text: lang.SELECT_QUALITY });
        let ret = await this.menu.dialog(opts, activeTrackId);
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
        opts.unshift({ template: 'question', fa: 'fas fa-volume-up', text: lang.SELECT_AUDIO });
        let ret = await this.menu.dialog(opts, activeTrackId);
        console.warn('TRACK OPTS RET', ret, opts);
        if (ret) {
            const n = ret.replace(new RegExp('^track\\-'), '');
            this.active.audioTrack = n;
            renderer.get().emit('streamer-audio-track', n);
        }
        return { ret, opts };
    }
    async showSubtitleTrackSelector() {
        if (!this.active)
            return;
        let activeTrackId, activeTrack = this.active.subtitleTrack, tracks = this.active.getSubtitleTracks(), opts = this.getExtTrackOptions(tracks, activeTrack);
        let hasActive = opts.some(o => !!o.fa);
        opts.unshift({ template: 'option', text: lang.NONE, id: 'track--1', fa: hasActive ? undefined : 'fas fa-check-circle' });
        opts.forEach(o => {
            if (o.fa)
                activeTrackId = o.id;
        });
        opts.unshift({ template: 'question', fa: 'fas fa-comments', text: lang.SELECT_SUBTITLE });
        if (!paths.android && this.active.mediaType == 'video') {
            opts.push({ template: 'option', fa: 'fas fa-search-plus', details: 'Opensubtitles.com', id: 'search', text: lang.SEARCH });
        }
        let ret = await this.menu.dialog(opts, activeTrackId);
        if (ret == 'search') {
            await this.showSearchSubtitleTrackSelector();
        }
        else if (ret) {
            const n = ret.replace(new RegExp('^track\\-'), '');
            this.active.subtitleTrack = n;
            renderer.get().emit('streamer-subtitle-track', n);
            config.set('subtitles', ret != '-1');
        }
    }
    async showSearchSubtitleTrackSelector(query, ask) {
        if (!this.active)
            return;
        if (!this.subtitles)
            this.subtitles = new Subtitles();
        if (!query) {
            query = listsTools.terms(this.active.data.name).join(' ');
        }
        let err, hasActive, activeTrackId = '', cancelId = 'track--1';
        let extraOpts = [];
        extraOpts.push({ template: 'option', text: lang.SEARCH, id: 'submit', fa: 'fas fa-search' });
        extraOpts.push({ template: 'option', text: lang.CANCEL, id: cancelId, fa: 'fas fa-times-circle' });
        if (!query || ask) {
            query = await this.menu.prompt({
                question: lang.ADJUST_SEARCH_TERMS,
                defaultValue: query,
                placeholder: query,
                fa: 'fas fa-search-plus',
                extraOpts
            });
        }
        osd.show(lang.SEARCHING, 'fas fa-circle-notch fa-spin', 'search-subs', 'persistent');
        const results = await this.subtitles.search(query).catch(e => err = e);
        osd.hide('search-subs');
        if (err)
            this.menu.displayErr(err);
        if (!Array.isArray(results) || !results.length) {
            if (query && query != cancelId) {
                err || this.menu.displayErr(lang.NOT_FOUND + ', ' + lang.X_RESULTS.format(0));
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
        opts.push({ template: 'option', text: lang.NONE, id: cancelId, fa: hasActive ? undefined : 'fas fa-check-circle' });
        opts.push({ template: 'option', text: lang.SEARCH, id: 'search', fa: 'fas fa-search' });
        /*
        opts.forEach(o => {
            if(o.fa) activeTrackId = o.id
        })
        */
        opts.unshift({ template: 'question', fa: 'fas fa-comments', text: lang.SELECT_SUBTITLE });
        const ret = await this.menu.dialog(opts, activeTrackId);
        console.error('SELECTED SUB OK: ' + ret);
        if (ret == 'search') {
            await this.showSearchSubtitleTrackSelector(query, true);
        }
        else if (ret != cancelId) {
            const i = results.findIndex(r => r.url == ret);
            this.active.subtitleTrack = ret;
            renderer.get().emit('streamer-add-subtitle-track', results[i]);
            config.set('subtitles', true);
        }
        else {
            config.set('subtitles', false);
        }
    }
}
class StreamerAbout extends StreamerTracks {
    constructor(opts) {
        super(opts);
        if (!this.opts.shadow) {
            this.aboutEntries = [];
            this.moreAboutEntries = [];
            const aboutTitleRenderer = (data, short) => {
                let text;
                if (this.active.mediaType == 'live' || !data.groupName) {
                    text = data.name;
                }
                else {
                    text = '<div style="display: flex;flex-direction: row;"><span style="opacity: 0.5;display: inline;">' + data.groupName + '&nbsp;&nbsp;&rsaquo;&nbsp;&nbsp;</span>' + data.name + '</div>';
                }
                return { template: 'question', text, fa: 'fas fa-info-circle' };
            };
            this.aboutRegisterEntry('title', aboutTitleRenderer);
            this.aboutRegisterEntry('title', aboutTitleRenderer, null, null, true);
            this.aboutRegisterEntry('text', (data, short) => {
                if (!short)
                    return { template: 'message', text: this.aboutText() };
            });
            this.aboutRegisterEntry('ok', () => {
                return { template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle' };
            });
            this.aboutRegisterEntry('share', data => {
                if (!data.isLocal) {
                    return { template: 'option', text: lang.SHARE, id: 'share', fa: 'fas fa-share-alt' };
                }
            }, this.share.bind(this));
            this.aboutRegisterEntry('more', data => {
                return { template: 'option', text: lang.MORE_OPTIONS, id: 'more', fa: 'fas fa-ellipsis-v' };
            }, this.moreAbout.bind(this));
            this.aboutRegisterEntry('tracks', async () => {
                if (this.active.getQualityTracks) {
                    const tracks = await this.active.getQualityTracks();
                    if (Object.keys(tracks).length > 1) {
                        return { template: 'option', fa: 'fas fa-bars', text: lang.SELECT_QUALITY, id: 'tracks' };
                    }
                }
            }, this.showQualityTrackSelector.bind(this), null, true);
            this.aboutRegisterEntry('audiotracks', () => {
                return { template: 'option', fa: 'fas fa-volume-up', text: lang.SELECT_AUDIO, id: 'audiotracks' };
            }, this.showAudioTrackSelector.bind(this), null, true);
            this.aboutRegisterEntry('subtitletracks', () => {
                return { template: 'option', fa: 'fas fa-comments', text: lang.SELECT_SUBTITLE, id: 'subtitletracks' };
            }, this.showSubtitleTrackSelector.bind(this), null, true);
            this.aboutRegisterEntry('streamInfo', () => {
                if (this.active && this.active.data.url.indexOf('://') != -1) {
                    return { template: 'option', fa: 'fas fa-info-circle', text: lang.KNOW_MORE, id: 'streamInfo' };
                }
            }, this.showStreamInfo.bind(this), 99, true);
            renderer.get().on('streamer-update-streamer-info', async () => {
                if (this.active) {
                    let opts = await this.aboutStructure(true);
                    let msgs = opts.filter(o => ['question', 'message'].includes(o.template)).map(o => o.text);
                    // msgs[1] = msgs[1].split('<i')[0].replace(new RegExp('<[^>]*>', 'g'), '')
                    renderer.get().emit('streamer-info', msgs.join('<br />'));
                }
            });
        }
    }
    async showStreamInfo() {
        if (!this.active)
            return;
        let countryCode, country = 'Unknown'
        const { manager } = lists;
        try {
            const domain = Download.getDomain(this.active.data.url);
            const addr = await Download.stream.lookup.lookup(domain, {});
            countryCode = await cloud.getCountry(addr).catch(e => this.menu.displayErr(e));
            country = lang.countries.getCountryName(countryCode, lang.locale)
        } catch(e) {}
        const source = this.active.data.source ? (await manager.name(this.active.data.source)) : 'N/A';
        const text = 'Broadcast server country: ' + (country || countryCode) + "\r\n" +
            'Source list: ' + source;
        const opts = [
            { template: 'question', text: lang.KNOW_MORE, fa: 'fas fa-info-circle' },
            { template: 'message', text },
            { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.COPY_STREAM_URL, id: 'copy-stream', fa: 'fas fa-play-circle' },
            { template: 'option', text: lang.COPY_LIST_URL, id: 'copy-list', fa: 'fas fa-satellite-dish' }
        ];
        const ret = await this.menu.dialog(opts, 'submit');
        if (!this.active)
            return;
        if (ret == 'copy-stream') {
            renderer.get().emit('clipboard-write', this.active.data.url, lang.COPIED_URL);
        }
        else if (ret == 'copy-list') {
            renderer.get().emit('clipboard-write', this.active.data.source || 'no list', lang.COPIED_URL);
        }
    }
    aboutRegisterEntry(id, renderer, action, position, more) {
        if (this.opts.shadow)
            return;
        let e = { id, renderer, action };
        let k = more ? 'moreAboutEntries' : 'aboutEntries';
        if (this[k]) {
            if (typeof (position) == 'number' && position < this[k].length) {
                this[k].splice(position, 0, e);
            }
            else {
                this[k].push(e);
            }
        }
        else {
            console.error('aboutRegisterEntry ERR ' + k, this[k]);
        }
    }
    async aboutTrigger(id, more) {
        let k = more ? 'moreAboutEntries' : 'aboutEntries';
        const found = this[k].some(e => {
            if (e.id == id) {
                this.active && e.action(this.active.data);
                return true;
            }
        });
        if (!found && !more) {
            return await this.aboutTrigger(id, true);
        }
        return found;
    }
    async aboutStructure(short) {
        const benchmarks = {};
        const results = await Promise.allSettled(this.aboutEntries.map(async (o) => {
            benchmarks[o.id] = (Date.now() / 1000);
            const ret = await o.renderer(this.active.data, short);
            benchmarks[o.id] = (Date.now() / 1000) - benchmarks[o.id];
            return ret;
        }));
        let ret = [], textPos = -1, titlePos = -1;
        results.forEach(r => {
            if (r.status == 'fulfilled' && r.value) {
                if (Array.isArray(r.value)) {
                    ret.push(...r.value);
                }
                else if (r.value) {
                    ret.push(r.value);
                }
            }
        });
        ret = ret.filter((r, i) => {
            if (r.template == 'question') {
                if (titlePos == -1) {
                    titlePos = i;
                }
                else {
                    ret[titlePos].text += ' &middot; ' + r.text;
                    return false;
                }
            }
            if (r.template == 'message') {
                if (textPos == -1) {
                    textPos = i;
                }
                else {
                    ret[textPos].text += ' ' + r.text;
                    return false;
                }
            }
            return true;
        });
        ret.some((r, i) => {
            if (r.template == 'message') {
                // ret[i].text = '<div>'+ r.text +' '+ Object.keys(benchmarks).map(id => id +': '+ parseFloat(benchmarks[id]).toFixed(1)).join(', ') +'</div>'
                ret[i].text = '<div>' + r.text + '</div>';
                return true;
            }
        });
        return ret;
    }
    moreAboutStructure() {
        return new Promise((resolve, reject) => {
            Promise.allSettled(this.moreAboutEntries.map(o => {
                return Promise.resolve(o.renderer(this.active.data));
            })).then(results => {
                let ret = [], textPos = -1, titlePos = -1;
                results.forEach(r => {
                    if (r.status == 'fulfilled' && r.value) {
                        if (Array.isArray(r.value)) {
                            ret.push(...r.value);
                        }
                        else if (r.value) {
                            ret.push(r.value);
                        }
                    }
                });
                ret = ret.filter((r, i) => {
                    if (r.template == 'question') {
                        if (titlePos == -1) {
                            titlePos = i;
                        }
                        else {
                            ret[titlePos].text += ' &middot; ' + r.text;
                            return false;
                        }
                    }
                    if (r.template == 'message') {
                        if (textPos == -1) {
                            textPos = i;
                        }
                        else {
                            ret[textPos].text += r.text;
                            return false;
                        }
                    }
                    return true;
                });
                ret.some((r, i) => {
                    if (r.template == 'message') {
                        ret[i].text = '<div>' + r.text + '</div>';
                        return true;
                    }
                });
                resolve(ret);
            }).catch(reject);
        });
    }
    aboutText() {
        let text = '';
        const currentSpeed = parseInt((this.speedoAdapter || this.active).currentSpeed || 0), icon = '<i class=\'fas fa-circle {0}\'></i> ';
        if (this.active.bitrate && !this.active.data.isLocal) {
            const tuneable = this.isTuneable;
            if (this.downlink < currentSpeed) {
                this.downlink = currentSpeed;
            }
            let p = parseInt(currentSpeed / (this.active.bitrate / 100));
            if (p > 100) {
                p = 100;
            }
            console.log('about conn', currentSpeed, this.downlink, this.active.bitrate, p + '%');
            if (p == 100) {
                text += icon.format('faclr-green');
                text += lang.STABLE_CONNECTION + ' (' + kbsfmt(this.active.bitrate) + ')';
            }
            else {
                if (p < 80) {
                    text += icon.format('faclr-red');
                }
                else {
                    text += icon.format('faclr-orange');
                }
                if (this.downlink && !isNaN(this.downlink) && this.active.bitrate && (this.downlink < this.active.bitrate)) {
                    if (tuneable) {
                        text += lang.YOUR_CONNECTION_IS_SLOW_TIP.format('<i class="' + config.get('tuning-icon') + '"></i>');
                    }
                    else {
                        text += lang.YOUR_CONNECTION_IS_SLOW;
                    }
                    text += ' (' + kbsfmt(this.downlink) + ' < ' + kbsfmt(this.active.bitrate) + ')';
                }
                else {
                    text += lang.SLOW_SERVER + ' (' + kbsfmt(currentSpeed) + ' < ' + kbsfmt(this.active.bitrate) + ')';
                }
            }
        }
        else if (currentSpeed && !isNaN(currentSpeed) && currentSpeed >= 0) {
            text += icon.format('faclr-orange') + ' ' + kbsfmt(currentSpeed);
        }
        let meta = [this.active.type.toUpperCase()], dimensions = this.active.dimensions();
        dimensions && meta.push(dimensions);
        if (this.active.codecData && (this.active.codecData.video || this.active.codecData.audio)) {
            let codecs = [this.active.codecData.video, this.active.codecData.audio].filter(s => s);
            codecs = codecs.map(c => c = c.replace(new RegExp('\\([^\\)]*[^A-Za-z\\)][^\\)]*\\)', 'g'), '').replace(new RegExp(' +', 'g'), ' ').trim());
            meta.push(...codecs);
        }
        this.active.transcoder && meta.push(lang.TRANSCODING.replaceAll('.', ''));
        if (text)
            text = '<div>' + text + '</div>';
        text += '<div>' + meta.join(' | ') + '</div>';
        return text;
    }
    async about() {
        if (this.opts.shadow) {
            return;
        }
        let title, text = '';
        if (this.active) {
            let struct = await this.aboutStructure();
            let ret = await this.menu.dialog(struct, 'ok');
            this.aboutCallback(ret);
        }
        else {
            title = ucWords(paths.manifest.name) + ' v' + paths.manifest.version + ' - ' + process.arch;
            text = lang.NONE_STREAM_FOUND;
            this.menu.info(title, text.trim());
        }
    }
    async moreAbout() {
        if (this.opts.shadow)
            return;
        let title, text = '';
        if (this.active) {
            let struct = await this.moreAboutStructure();
            let ret = await this.menu.dialog(struct, 'ok');
            this.aboutCallback(ret);
        }
        else {
            title = ucWords(paths.manifest.name) + ' v' + paths.manifest.version + ' - ' + process.arch;
            text = lang.NONE_STREAM_FOUND;
            this.menu.info(title, text.trim());
        }
    }
    aboutCallback(chosen) {
        console.log('about callback', chosen);
        if (this.active && this.active.data) {
            this.aboutEntries.concat(this.moreAboutEntries).some(o => {
                if (o.id && o.id == chosen) {
                    if (typeof (o.action) == 'function') {
                        const ret = o.action(this.active.data);
                        ret && ret.catch && ret.catch(e => this.menu.displayErr(e));
                    }
                    return true;
                }
            });
        }
    }
}
class Streamer extends StreamerAbout {
    constructor(opts) {
        super(opts);
        if (!this.opts.shadow) {
            this.zap = new Zap(this)
            renderer.ready(async () => {
                this.menu = (await import('../menu/menu.js')).default
                this.channels = (await import('../channels/channels.js')).default
                this.menu.on('open', path => {
                    if (this.tuning && path.indexOf(lang.STREAMS) != -1) {
                        this.tuning.destroy();
                        this.tuning = null;
                    }
                })
            })
            renderer.get().on('streamer-duration', duration => {
                if (this.active && this.active.mediaType == 'video' && this.active.type != 'vodhls' && this.active.info.contentLength) {
                    const bitrate = (this.active.info.contentLength / duration) * 8;
                    if (bitrate > 0) {
                        this.active.emit('bitrate', bitrate);
                        this.active.bitrate = bitrate;
                        renderer.get().emit('streamer-bitrate', bitrate);
                    }
                }
            });
            renderer.get().on('streamer-seek-failure', async () => {
                const ret = await this.menu.dialog([
                    { template: 'question', fa: 'fas fa-warn-triangle', text: 'Force MPEGTS broadcasts to be seekable (' + lang.SLOW + ')' },
                    { template: 'message', text: lang.ENABLE_MPEGTS_SEEKING },
                    { template: 'option', text: lang.NO, fa: 'fas fa-times-circle', id: 'no' },
                    { template: 'option', text: lang.YES, fa: 'fas fa-check-circle', id: 'yes' }
                ], 'no');
                if (ret == 'yes') {
                    config.set('ffmpeg-broadcast-pre-processing', 'mpegts');
                    this.reload();
                }
            });
        }
    }
    setTuneable(enable) {
        this.isTuneable = !!enable;
        renderer.get().emit('tuneable', this.isTuneable);
    }
    findPreferredStreamURL(name) {
        let ret = null;
        this.channels.history.get().some(e => {
            if (e.name == name || e.originalName == name) {
                ret = e.preferredStreamURL;
                return true;
            }
        });
        return ret;
    }
    async playFromEntries(entries, name, megaURL, txt, connectId, mediaType, preferredStreamURL, silent) {
        if (this.opts.shadow) {
            throw 'in shadow mode';
        }
        const loadingEntriesData = [lang.AUTO_TUNING, name];
        console.warn('playFromEntries', name, connectId, silent);
        this.menu.setLoadingEntries(loadingEntriesData, true, txt);
        silent || osd.show(lang.TUNING_WAIT_X.format(name) + ' 0%', 'fa-mega spin-x-alt', 'streamer', 'persistent');
        this.tuning && this.tuning.destroy();
        if (this.connectId != connectId) {
            throw 'another play intent in progress';
        }
        console.log('tuning', name, entries.length);
        let tuning = new AutoTuner(entries, {
            preferredStreamURL,
            name,
            megaURL,
            mediaType,
            streamer: this
        });
        this.tuning = tuning;
        tuning.txt = txt;
        tuning.on('progress', i => {
            if (!silent && i.progress && !isNaN(i.progress)) {
                osd.show(lang.TUNING_WAIT_X.format(name) + ' ' + i.progress + '%', 'fa-mega spin-x-alt', 'streamer', 'persistent');
            }
        });
        tuning.on('finish', () => {
            tuning.destroy();
        });
        tuning.once('destroy', () => {
            osd.hide('streamer');
            tuning = null;
        });
        let hasErr;
        await tuning.tune().catch(err => {
            if (err != 'cancelled by user') {
                hasErr = err;
                console.error(err);
            }
        });
        if (hasErr) {
            silent || osd.show(lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal');
            this.emit('hard-failure', entries);
        }
        else {
            this.setTuneable(true);
        }
        this.menu.setLoadingEntries(loadingEntriesData, false);
        return !hasErr;
    }
    async playPromise(e, results, silent) {
        if (this.opts.shadow) {
            throw 'in shadow mode';
        }
        e = deepClone(e);
        if (this.active && !config.get('play-while-loading')) {
            this.stop();
        }
        if (this.tuning) {
            if (!this.tuning.destroyed && this.tuning.opts.megaURL && this.tuning.opts.megaURL == e.url) {
                return await this.tune(e);
            }
            this.tuning.destroy();
            this.tuning = null;
        }
        const connectId = (Date.now() / 1000);
        this.connectId = connectId;
        this.emit('connecting', connectId);
        
        const isMega = mega.isMega(e.url), txt = isMega ? lang.TUNING : undefined;
        const opts = isMega ? mega.parse(e.url) : { mediaType: 'live' };
        const loadingEntriesData = [e, lang.AUTO_TUNING];
        silent || this.menu.setLoadingEntries(loadingEntriesData, true, txt);
        console.warn('STREAMER INTENT', e, results);
        let succeeded;
        this.emit('pre-play-entry', e);
        if (Array.isArray(results)) {
            let name = e.name;
            if (opts.name) {
                name = opts.name;
            }
            succeeded = await this.playFromEntries(results, name, isMega ? e.url : '', txt, connectId, opts.mediaType, e.preferredStreamURL || this.findPreferredStreamURL(name), silent);
            if (this.connectId == connectId) {
                this.connectId = false;
                if (!succeeded) {
                    this.emit('connecting-failure', e);
                }
            }
            else {
                silent || this.menu.setLoadingEntries(loadingEntriesData, false);
                throw 'another play intent in progress';
            }
        }
        else if (isMega && !opts.url) {            
            let name = e.name;
            if (opts.name) {
                name = opts.name;
            }
            let terms = opts.terms || listsTools.terms(name);
            silent || osd.show(lang.TUNING_WAIT_X.format(name), 'fa-mega spin-x-alt', 'streamer', 'persistent');
            const {default: lists} = await import('../lists/lists.js')
            const listsReady = await lists.manager.waitListsReady(10);
            if (listsReady !== true) {
                silent || osd.hide('streamer');
                throw lang.WAIT_LISTS_READY;
            }
            let entries = await lists.search(terms, {
                type: 'live',
                safe: !lists.parentalControl.lazyAuth(),
                limit: 1024
            });
            if (this.connectId != connectId) {
                silent || this.menu.setLoadingEntries(loadingEntriesData, false);
                throw 'another play intent in progress';
            }
            // console.error('ABOUT TO TUNE', terms, name, JSON.stringify(entries), opts)
            entries = entries.results;
            if (entries.length) {
                entries = entries.map(s => {
                    s.originalName = name;
                    if (s.rawname)
                        s.rawname = name;
                    s.originalUrl = e.url;
                    s.programme = e.programme;
                    return s;
                });
                succeeded = await this.playFromEntries(entries, name, e.url, txt, connectId, opts.mediaType, e.preferredStreamURL || this.findPreferredStreamURL(name), silent);
            }
            if (!succeeded) {
                osd.hide('streamer');
                this.connectId = false;
                this.emit('connecting-failure', e);
                if (!silent) {
                    const err = lists.activeLists.length ?
                        lang.NONE_STREAM_WORKED_X.format(name) :
                        ((global.lists && Object.keys(global.lists).length) ? lang.NO_LIST : lang.NO_LISTS_ADDED);
                    osd.show(err, 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal');
                    renderer.get().emit('sound', 'static', 25);
                    this.emit('hard-failure', entries);
                }
            }
        }
        else {
            if (opts.url) {
                e = Object.assign(Object.assign({}, e), opts);
            }
            console.warn('STREAMER INTENT', e);
            let terms = this.channels.entryTerms(e);
            this.setTuneable(!this.streamInfo.mi.isVideo(e.url) && this.channels.isChannel(terms));
            silent || osd.show(lang.CONNECTING + ' ' + e.name + '...', 'fa-mega spin-x-alt', 'streamer', 'persistent');
            let hasErr, intent = await this.intent(e).catch(r => hasErr = r);
            if (typeof (hasErr) != 'undefined') {
                if (this.connectId != connectId) {
                    silent || this.menu.setLoadingEntries(loadingEntriesData, false);
                    throw 'another play intent in progress';
                }
                console.warn('STREAMER INTENT ERROR', hasErr);
                renderer.get().emit('sound', 'static', 25);
                this.connectId = false;
                this.emit('connecting-failure', e);
                this.handleFailure(e, hasErr).catch(e => this.menu.displayErr(e));
            }
            else {
                if (intent.mediaType != 'live') {
                    this.setTuneable(false);
                }
                console.warn('STREAMER INTENT SUCCESS', intent.type, e);
                succeeded = true;
            }
        }
        silent || this.menu.setLoadingEntries(loadingEntriesData, false);
        return succeeded;
    }
    play(e, results, silent) {
        return this.playPromise(e, results, silent).catch(silent ? console.error : this.menu.displayErr);
    }
    async tune(e) {
        if (this.opts.shadow)
            return;
        if (!this.isEntry(e)) {
            if (this.active) {
                e = this.active.data;
            }
        }
        if (this.isEntry(e)) {
            if (this.active && !config.get('play-while-loading')) {
                this.stop();
            }
            const ch = this.channels.isChannel(this.channels.entryTerms(e));
            if (ch) {
                e.name = ch.name;
            }
            const same = this.tuning && !this.tuning.finished && !this.tuning.destroyed && (this.tuning.has(e.url) || this.tuning.opts.megaURL == e.url);
            const loadingEntriesData = [e, lang.AUTO_TUNING];
            console.log('tuneEntry', e, same);
            if (same) {
                let err;
                await this.tuning.tune().catch(e => err = e);
                this.menu.setLoadingEntries(loadingEntriesData, false);
                if (err) {
                    if (err != 'cancelled by user') {
                        this.emit('connecting-failure', e);
                        console.error('tune() ERR', err);
                        osd.show(lang.NO_MORE_STREAM_WORKED_X.format(e.name), 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal');
                    }
                    return;
                }
                this.setTuneable(true);
            }
            else {
                
                if (ch) {
                    e.url = mega.build(ch.name, { terms: ch.terms });
                }
                else {
                    const name = e.originalName || e.name;
                    let terms = listsTools.terms(name)
                    if (Array.isArray(terms)) terms = terms.join(' ')
                    e.url = mega.build(name, { terms });
                }
                this.play(e);
            }
            return true;
        }
    }
    async handleFailure(e, r, silent, doTune) {
        let c = doTune ? 'tune' : 'stop'
        if (!this.isEntry(e)) {
            if (this.active) {
                e = this.active.data;
            }
            else {
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
        }
        else if (c != 'tune' && e && (this.tuning && this.tuning.has(e.url))) {
            c = 'tune';
        }
        if ((r != null && typeof (r) != 'undefined') && (c != 'tune' || !e) && (silent !== true || c == 'stop' || !e)) {
            this.handleFailureMessage(r);
        }
        console.error('handleFailure', r, c, e);
        
        const isMega = e && mega.isMega(e.url);
        if (!isMega && e) {
            if (c == 'stop') {
                const terms = this.channels.entryTerms(e);
                const ch = this.channels.isChannel(terms);
                if (ch) {
                    const skips = [lang.STREAMS, lang.MY_LISTS, lang.CATEGORY_MOVIES_SERIES];
                    if (skips.every(s => this.menu.path.indexOf(s) == -1)) {
                        const chosen = await this.menu.dialog([
                            { template: 'question', text: lang.PLAYBACK_OFFLINE_STREAM, fa: 'fas fa-exclamation-triangle faclr-red' },
                            { template: 'message', text: lang.PLAY_ALTERNATE_ASK },
                            { template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle' },
                            { template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle' }
                        ], 'yes');
                        if (chosen == 'yes')
                            c = 'tune';
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
    humanizeFailureMessage(r) {
        r = String(r);
        let msg = lang.PLAYBACK_OFFLINE_STREAM, status = '';
        if (status) {
            msg += ': ' + ucFirst(status);
        }
        return msg;
    }
    handleFailureMessage(r) {
        process.nextTick(() => {
            osd.show(this.humanizeFailureMessage(r), 'fas fa-exclamation-triangle faclr-red', 'failure', 'normal');
        });
    }
}
export default Streamer;
