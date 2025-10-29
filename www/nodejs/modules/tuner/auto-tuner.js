import { EventEmitter } from "events";
import Tuner from "./tuner.js";
import config from "../config/config.js"
import { getDomain } from "../utils/utils.js";

class AutoTuner extends EventEmitter {
    constructor(entries, opts) {
        super();
        opts.mediaType = opts.mediaType == 'audio' ? 'all' : opts.mediaType; // is we're searching a radio, no problem to return a radio studio webcam
        this.opts = opts || {};
        this.paused = false;
        this.headless = false;
        this.minProgress = 0;
        this.resultsBuffer = 2;
        this.results = {};
        this.commitResults = {};
        this.intents = [];
        this.succeededs = {}; // -1 = bad mediatype, 0 = initialized, 1 = intenting, 2 = committed, 3 = starting failed
        this.entries = entries
        this.ffmpegBasedTypes = ['ts', 'rtmp', 'dash', 'aac']
    }
    async start() {
        if (!this.opts.allowedTypes || !Array.isArray(this.opts.allowedTypes)) {
            this.opts.allowedTypes = [];
            Object.keys(global.streamer.engines).forEach(n => {
                if (global.streamer.engines[n].mediaType == this.opts.mediaType) {
                    this.opts.allowedTypes.push(n);
                }
            });
        }
        if (!this.tuner) {
            const preferredStreamServers = this.preferredStreamServers()
            this.entries = this.sort(this.entries, preferredStreamServers, this.opts.preferredStreamURL)
            this.tuner = new Tuner(this.entries, this.opts, this.opts.megaURL)
            this.tuner.on('success', (e, nfo, n) => {
                if (typeof(this.succeededs[n]) == 'undefined') {
                    this.succeededs[n] = 0;
                    if (!this.paused) {
                        this.pump();
                    }
                }
            });
            if (this.listenerCount('progress')) {
                this.tuner.on('progress', () => this.progress());
            }
            this.tuner.on('finish', () => {
                if (!this.paused) {
                    this.pump();
                }
            });
        }
    }
    active() {
        return !this.paused && !this.destroyed;
    }
    ext(file) {
        return String(file).split('?')[0].split('#')[0].split('.').pop().toLowerCase();
    }
    preferredStreamServers() {
        if(global.channels && global.channels.history) {
            return global.channels.history.get().map(e => e.preferredStreamURL || e.url).map(u => getDomain(u)).unique()
        }
        return []
    }
    sort(entries, preferredStreamServers, preferredStreamURL) {
        let preferredStreamEntry
        const fmt = config.get('live-stream-fmt'), validfmt = ['hls', 'mpegts'].includes(fmt)
        const streams = [], deferredStreams = [], goodStreams = [], badStreams = []
        const preferredStreamServersLeveledEntries = {}
        entries.forEach(e => {
            const state = global.streamer.state.get(e.url)
            if(state === false || state === 'offline') { // bad state streams go to the end of the queue
                badStreams.push(e)
                return
            }
            if (e.url == preferredStreamURL) { // last watching stream go to the top of queue
                preferredStreamEntry = e
                return
            }
            if (typeof(state) == 'string' && state) { // stream known to be online
                goodStreams.push(e)
                return
            }
            if (preferredStreamServers.length) { // streams from servers already known from the history gets some priority
                let i = preferredStreamServers.indexOf(getDomain(e.url))
                if (i != -1) {
                    if (typeof(preferredStreamServersLeveledEntries[i]) == 'undefined') {
                        preferredStreamServersLeveledEntries[i] = []
                    }
                    preferredStreamServersLeveledEntries[i].push(e)
                    return
                }
            }
            if (validfmt) { // consider preferred stream format from options if any
                const isHLS = this.ext(e.url) == 'm3u8'
                if (isHLS == (fmt == 'hls')) {
                    streams.push(e)
                } else {
                    deferredStreams.push(e)
                }
            } else {
                streams.push(e)
            }
        })
        entries = []
        if (preferredStreamEntry) {
            entries.push(preferredStreamEntry)
        }
        Object.keys(preferredStreamServersLeveledEntries).sort().forEach(k => {
            entries.push(...preferredStreamServersLeveledEntries[k])
        })
        entries.push(...goodStreams)
        entries.push(...streams)
        entries.push(...deferredStreams)
        entries.push(...badStreams)
        return entries
    }
    pause() {
        if (this.opts && this.opts.debug) {
            console.log('autotuner PAUSE');
        }
        this.paused = true;
        if (this.tuner && !this.tuner.finished) {
            this.tuner.pause();
        }
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    resume() {
        if (!this.destroyed) {
            if (this.opts && this.opts.debug) {
                console.log('autotuner RESUME');
            }
            this.paused = false;
            if (this.tuner) {
                if (this.tuner.finished) {
                    this.pump();
                } else {
                    this.tuner.resume();
                }
            }
            if (this.listenerCount('progress')) {
                clearInterval(this.timer);
                this.timer = null;
                this.timer = setInterval(() => this.progress(), 2000);
            }
            return true;
        }
    }
    progress() {
        if (!this.tuner) return;
        const stats = this.tuner.getStats();
        let pending = Object.values(this.succeededs).filter(i => i == 0 || i == 1);
        stats.successes -= pending.length;
        this.intents.filter(n => !n.destroyed).map(n => n.timeoutStatus() / 100).forEach(s => stats.successes += s);
        stats.processed = stats.successes + stats.failures;
        stats.progress = parseInt(stats.processed / (stats.total / 100));
        if (stats.progress > 99) {
            stats.progress = 99;
        }
        if (this.lastProgress != stats.progress) {
            this.lastProgress = stats.progress;
            this.emit('progress', stats);
        }
    }
    tune() {
        if (this.opts && this.opts.debug) {
            console.log('auto-tuner tune');
        }
        return new Promise((resolve, reject) => {
            if (this.destroyed) {
                return reject('destroyed');
            }
            this.start().then(() => {
                let resolved;
                this.progress();
                const removeListeners = () => {
                    this.removeListener('success', successListener);
                    this.removeListener('finish', finishListener);
                };
                const successListener = async (n) => {
                    removeListeners();
                    //console.log('auto-tuner tune commit', n)
                    this.pause();
                    if (resolved) {
                        console.error('Tuner success after finish, verify it');
                    } else {
                        resolved = true;
                        if (n.nid) {
                            n = this.prepareIntentToEmit(n);
                            if (!this.headless) {
                                
                                let ret = await global.streamer.commit(n)
                                this.commitResults[n.nid] = ret
                                if (ret !== true) {
                                    menu.displayErr('TUNER COMMIT ERROR ' + ret + ' - ' + n.data.name);
                                    this.once('success', successListener);
                                    this.succeededs[n.nid] = 3;
                                    return; // don't resolve on commit error
                                }
                            }
                            resolve(n);
                        } else {
                            reject('cancelled by user'); // maybe it's not a intent from the AutoTuner instance, but one else started by the user, resolve anyway
                        }
                    }
                };
                const finishListener = () => {
                    removeListeners();
                    if (this.opts && this.opts.debug) {
                        console.log('auto-tuner tune finish');
                    }
                    this.pause();
                    if (!resolved) {
                        resolved = true;
                        reject('finished');
                    }
                };
                this.once('success', n => successListener(n).catch(reject));
                this.once('finish', finishListener);
                this.resume();
                this.pump();
            }).catch(reject);
        });
    }
    prepareIntentToEmit(e) {
        if (this.opts.mediaType == 'live' && this.opts.megaURL && this.opts.name) {
            e.data = Object.assign({
                originalUrl: this.opts.megaURL,
                originalName: this.opts.name
            }, e.data);
            if (this.opts.terms) {
                e.data.terms = this.opts.terms;
            }
            if (e.data.originalIcon) {
                delete e.data.originalIcon;
            }
            if (e.data.icon) {
                delete e.data.icon;
            }
        }
        return e;
    }
    getQueue() {
        const busyDomains = []; // don't lock here considering Tuner busy domains
        let slotCount = config.get('tune-concurrency');
        let ffmpegBasedSlotCount = config.get('tune-ffmpeg-concurrency');
        let ks = Object.keys(this.succeededs).filter(i => {
            return this.tuner.info[i];
        }), index = ks.filter(i => this.succeededs[i] == 0), processingIndex = ks.filter(i => this.succeededs[i] == 1);
        processingIndex.forEach(i => {
            slotCount--;
            if (this.ffmpegBasedTypes.includes(this.tuner.info[i].type)) {
                ffmpegBasedSlotCount--;
            }
            busyDomains.push(this.tuner.domainAt(i));
        });
        index = index.filter(nid => {
            if (slotCount <= 0) {
                return;
            }
            const domain = this.tuner.domainAt(nid);
            if (busyDomains.includes(domain)) {
                return;
            }
            return true;
        });
        if (this.tuner) {
            if (this.tuner.finished) {
                if (!index.length && !processingIndex.length) {
                    this.finish();
                    index.length = 0;
                }
            } else {
                if (slotCount > 0) {
                    this.tuner.paused && this.tuner.resume();
                } else {
                    !this.tuner.paused && this.tuner.pause();
                }
            }
        }
        return { index, busyDomains, slotCount, ffmpegBasedSlotCount };
    }
    pump() {
        if (this.paused || this.destroyed) {
            return
        }
        let { index, busyDomains, slotCount, ffmpegBasedSlotCount } = this.getQueue();
        index.forEach(nid => {
            if (slotCount <= 0) {
                return;
            }
            const domain = this.tuner.domainAt(nid);
            if (busyDomains.includes(domain)) {
                return;
            }
            const nidType = this.tuner.info[nid].type;
            const nidFFmpeg = this.ffmpegBasedTypes.includes(nidType);
            if (nidFFmpeg) {
                if (ffmpegBasedSlotCount <= 0) {
                    return;
                }
            }
            
            let intent = new global.streamer.engines[this.tuner.info[nid].type](this.tuner.entries[nid], {}, this.tuner.info[nid]);
            if (this.opts.mediaType && this.opts.mediaType != 'all' && intent.mediaType != this.opts.mediaType) {
                console.warn('bad mediaType, skipping', intent.data.url, intent.mediaType, this.opts.mediaType);
                this.succeededs[n] = -1;
                intent.destroy();
                return;
            }
            this.intents.push(intent);
            intent.nid = nid;
            slotCount--;
            if (nidFFmpeg) {
                ffmpegBasedSlotCount--;
            }
            busyDomains.push(domain);
            this.succeededs[nid] = 1;
            intent.once('destroy', () => {
                const timeoutId = setTimeout(() => {
                    if (intent && !this.destroyed) {
                        this.succeededs[nid] = 3;
                        this.intents = this.intents.filter(n => n.nid != nid);
                        intent = null;
                        this.pump();
                    }
                }, 400);
                
                // Store timeout ID for potential cleanup
                if (intent) {
                    intent._timeoutId = timeoutId;
                }
            });
            intent.start().then(() => {
                if (this.paused) {
                    this.succeededs[nid] = 0;
                    intent.destroy();
                    return;
                }
                this.pause();
                this.results[nid] = [true, intent.type];
                this.succeededs[nid] = 2;
                this.emit('success', intent);
                // destroy other intents
                this.intents.filter(nt => nt && nt.nid != nid).forEach(nt => {
                    if (nt.committed) {
                        menu.displayErr('DESTROYING COMMITTED INTENT?');
                    } else if (nt.destroyed) {
                        menu.displayErr('DESTROYING ALREADY DESTROYED INTENT?');
                    }
                    this.succeededs[nt.nid] = 0;
                    nt.destroy();
                });
                this.intents = [];
                intent = null;
            }).catch(err => {
                if (intent) {
                    if (this.succeededs[nid] != 0) { // not destroyed by other intent commit
                        console.error('INTENT FAILED', err);
                        this.results[nid] = [false, String(err)];
                        this.succeededs[nid] = 3;
                    }
                    this.intents = this.intents.filter(n => n.nid != nid);
                    if (!intent.destroyed) {
                        intent.destroy();
                    }
                    intent = null;
                    this.pump();
                }
            });
        });
    }
    log() {
        let ret = {};
        if (this.tuner) {
            this.tuner.entries.forEach((e, i) => {
                let v;
                if (typeof(this.tuner.errors[i]) == 'undefined') {
                    v = 'untested';
                } else {
                    if (this.tuner.errors[i] === 0) {
                        v = 'timeout';
                    } else if (this.tuner.errors[i] === -1) {
                        v = 'unreachable';
                    } else {
                        v = this.tuner.errors[i];
                    }
                }
                const url = e.url;
                let state = v == 'success', info = state ? this.succeededs[i] : v;
                if (this.results[i]) {
                    state = this.results[i][0];
                    info = [this.succeededs[i], this.results[i][1]].join(' - ');
                }
                if (typeof(this.commitResults[i]) != 'undefined') {
                    info = String(this.commitResults[i]);
                }
                ret[i] = {
                    name: e.name,
                    url,
                    source: e.source,
                    type: this.tuner.info[i] ? this.tuner.info[i].type : null,
                    state,
                    info
                };
            });
        }
        return ret;
    }
    logText(showStreams) {
        let ret = [], info = Object.values(this.log());
        ret.push(this.tuner.entries.length + ' streams');
        ret.push(...info.map(e => {
            let row = (showStreams === true ? e.url : e.name) + ' => ';
            if (e.info == 'untested') {
                row += 'untested';
            } else {
                row += (e.state ? 'success' : 'failed') + (e.info === null ? '' : ', ' + e.info);
            }
            return row;
        }));
        return ret.join("\r\n");
    }
    has(url) {
        return this.tuner.entries.some(e => e.url == url);
    }
    finish() {
        console.warn('AUTOTUNER FINISH');
        this.finished = true;
        this.emit('finish');
        this.timer && clearInterval(this.timer);
        this.timer = null;
        this.intents.forEach(n => n.destroy());
        this.intents = [];
        this.destroy();
    }
    destroy() {
        if (this.opts && this.opts.debug) {
            console.log('auto-tuner destroy');
        }
        this.paused = true;
        this.destroyed = true;
        this.emit('destroy');
        this.intents.forEach(n => {
            // Clear any pending timeouts
            if (n._timeoutId) {
                clearTimeout(n._timeoutId);
                n._timeoutId = null;
            }
            n.destroy();
        });
        this.intents = [];
        this.tuner && this.tuner.destroy();
        this.tuner = null;
        this.removeAllListeners();
        this.timer && clearInterval(this.timer);
        this.timer = null;
        
        // Clear all references to help garbage collection
        this.entries = null;
        this.results = null;
        this.commitResults = null;
        this.succeededs = null;
        this.opts = null;
    }
}
export default AutoTuner;
