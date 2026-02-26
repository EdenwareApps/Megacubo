import Download from '../download/download.js'
import StreamerBase from './base.js'
import cloud from '../cloud/cloud.js'
import Zap from '../zap/zap.js'
import AutoTuner from '../tuner/auto-tuner.js'
import renderer from '../bridge/bridge.js'
import mega from '../mega/mega.js'
import { terms } from "../lists/tools.js"
import config from "../config/config.js"
import paths from '../paths/paths.js'
import Limiter from '../limiter/limiter.js'
import { clone, getDomain, kbsfmt, ucWords, validateURL } from '../utils/utils.js';

class StreamerAbout extends StreamerBase {
    constructor(opts) {
        super(opts)
        if (!this.opts.shadow) {
            this.aboutEntries = []
            this.moreAboutEntries = []
            this.aboutRegisterEntry('title', this.aboutTitleRenderer.bind(this));
            this.aboutRegisterEntry('title', this.aboutTitleRenderer.bind(this), null, null, true);
            this.aboutRegisterEntry('text', (data, short) => {
                if (!short) return { template: 'message', text: this.aboutText() }
            });
            this.aboutRegisterEntry('ok', () => {
                return { template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle' };
            });
            this.aboutRegisterEntry('share', data => {
                if (!data.isLocal) {
                    return { template: 'option', text: global.lang.SHARE, id: 'share', fa: 'fas fa-share-alt' };
                }
            }, this.share.bind(this));
            this.aboutRegisterEntry('more', data => {
                return { template: 'option', text: global.lang.MORE_OPTIONS, id: 'more', fa: 'fas fa-ellipsis-v' };
            }, this.moreAbout.bind(this));
            this.aboutRegisterEntry('tracks', async () => {
                if (this.active.getQualityTracks) {
                    const tracks = await this.active.getQualityTracks();
                    if (Object.keys(tracks).length > 1) {
                        return { template: 'option', fa: 'fas fa-bars', text: global.lang.SELECT_QUALITY +': '+ tracks.length, id: 'tracks' };
                    }
                }
            }, this.showQualityTrackSelector.bind(this), null, true);
            this.aboutRegisterEntry('audiotracks', async () => {
                let length = 0
                if(this.active && this.active.getAudioTracks) {
                    length = this.active.getAudioTracks().length
                }
                return { template: 'option', fa: 'fas fa-volume-up', text: global.lang.SELECT_AUDIO +': '+ length, id: 'audiotracks' };
            }, this.showAudioTrackSelector.bind(this), null, true);
            this.aboutRegisterEntry('subtitletracks', async () => {
                let length = 0
                if(this.active && this.active.getSubtitleTracks) {
                    length = this.active.getSubtitleTracks().length
                }
                return { template: 'option', fa: 'fas fa-comments', text: global.lang.SELECT_SUBTITLE +': '+ length, id: 'subtitletracks' };
            }, this.showSubtitleTrackSelector.bind(this), null, true);
            this.aboutRegisterEntry('streamInfo', () => {
                if (this.active && this.active.data.url.includes('://')) {
                    return { template: 'option', fa: 'fas fa-info-circle', text: global.lang.KNOW_MORE, id: 'streamInfo' };
                }
            }, this.showStreamInfo.bind(this), 99, true);
            renderer.ui.on('streamer-update-streamer-info', async () => {
                if (this.active) {
                    const opts = await this.aboutStructure(true)
                    const msgs = opts.filter(o => ['question', 'message'].includes(o.template)).map(o => o.text).join('<br />')
                    // msgs[1] = msgs[1].split('<i')[0].replace(new RegExp('<[^>]*>', 'g'), '')
                    if(this.latestStreamerInfo !== msgs) {
                        this.latestStreamerInfo = msgs
                        renderer.ui.emit('streamer-info', msgs)
                    }
                }
            })
        }
    }
    aboutTitleRenderer(data, short) {
        let text
        if (this.active.mediaType == 'live' || !data.groupName) {
            text = data.name
        } else {
            text = '<div style="display: flex;flex-direction: row;"><span style="opacity: 0.5;display: inline;">' + data.groupName + '&nbsp;&nbsp;&rsaquo;&nbsp;&nbsp;</span>' + data.name + '</div>'
        }
        return { template: 'question', text, fa: 'fas fa-info-circle' }
    }
    async showStreamInfo() {
        if (!this.active) return
        let countryCode, country = 'Unknown'
        const { manager } = lists;
        try {
            const domain = getDomain(this.active.data.url)
            const addr = await Download.lookup(domain, {})
            countryCode = await cloud.getCountry(addr).catch(e => global.menu.displayErr(e))
            country = global.lang.countries.getCountryName(countryCode, global.lang.locale)
        } catch(e) {}
        const source = this.active.data.source ? (await manager.name(this.active.data.source)) : 'N/A'
        const text = 'Broadcast server country: ' + (country || countryCode) + "\r\n" +
            'Source list: ' + source;
        const opts = [
            { template: 'question', text: global.lang.KNOW_MORE, fa: 'fas fa-info-circle' },
            { template: 'message', text },
            { template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle' },
            { template: 'option', text: global.lang.COPY_STREAM_URL, id: 'copy-stream', fa: 'fas fa-play-circle' },
            { template: 'option', text: global.lang.COPY_LIST_URL, id: 'copy-list', fa: 'fas fa-satellite-dish' }
        ];
        const ret = await global.menu.dialog(opts, 'submit');
        if (!this.active)
            return;
        if (ret == 'copy-stream') {
            await renderer.ui.clipboard(this.active.data.url, global.lang.COPIED_URL)
        } else if (ret == 'copy-list') {
            await renderer.ui.clipboard(this.active.data.source || 'no list', global.lang.COPIED_URL)
        }
    }
    aboutRegisterEntry(id, renderer, action, position, more) {
        if (this.opts.shadow)
            return;
        let e = { id, renderer, action };
        let k = more ? 'moreAboutEntries' : 'aboutEntries';
        if (this[k]) {
            if (typeof(position) == 'number' && position < this[k].length) {
                this[k].splice(position, 0, e);
            } else {
                this[k].push(e);
            }
        } else {
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
            return this.aboutTrigger(id, true);
        }
        return found;
    }
    async aboutStructure(short) {
        const benchmarks = {}
        const results = await Promise.allSettled(this.aboutEntries.map(async o => {
            //benchmarks[o.id] = (Date.now() / 1000)
            const ret = await o.renderer(this.active.data, short)
            //benchmarks[o.id] = (Date.now() / 1000) - benchmarks[o.id]
            return ret
        }))
        let ret = [], textPos = -1, titlePos = -1
        results.forEach(r => {
            if (r.status == 'fulfilled' && r.value) {
                if (Array.isArray(r.value)) {
                    ret.push(...r.value)
                } else if (r.value) {
                    ret.push(r.value)
                }
            }
        })
        ret = ret.filter((r, i) => {
            if (r.template == 'question') {
                if (titlePos == -1) {
                    titlePos = i
                } else {
                    ret[titlePos].text += ' &middot; ' + r.text
                    return false
                }
            }
            if (r.template == 'message') {
                if (textPos == -1) {
                    textPos = i
                } else {
                    ret[textPos].text += ' ' + r.text
                    return false
                }
            }
            return true
        })
        ret.some((r, i) => {
            if (r.template == 'message') {
                // ret[i].text = '<div>'+ r.text +' '+ Object.keys(benchmarks).map(id => id +': '+ parseFloat(benchmarks[id]).toFixed(1)).join(', ') +'</div>'
                ret[i].text = '<div>' + r.text + '</div>';
                return true;
            }
        })
        return ret
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
                        } else if (r.value) {
                            ret.push(r.value);
                        }
                    }
                });
                ret = ret.filter((r, i) => {
                    if (r.template == 'question') {
                        if (titlePos == -1) {
                            titlePos = i;
                        } else {
                            ret[titlePos].text += ' &middot; ' + r.text;
                            return false;
                        }
                    }
                    if (r.template == 'message') {
                        if (textPos == -1) {
                            textPos = i;
                        } else {
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
                text += global.lang.STABLE_CONNECTION + ' (' + kbsfmt(this.active.bitrate) + ')';
            } else {
                if (p < 80) {
                    text += icon.format('faclr-red');
                } else {
                    text += icon.format('faclr-orange');
                }
                if (this.downlink && !isNaN(this.downlink) && this.active.bitrate && (this.downlink < this.active.bitrate)) {
                    if (tuneable) {
                        text += global.lang.YOUR_CONNECTION_IS_SLOW_TIP.format('<i class="' + config.get('tuning-icon') + '"></i>');
                    } else {
                        text += global.lang.YOUR_CONNECTION_IS_SLOW;
                    }
                    text += ' (' + kbsfmt(this.downlink) + ' < ' + kbsfmt(this.active.bitrate) + ')';
                } else {
                    text += global.lang.SLOW_SERVER + ' (' + kbsfmt(currentSpeed) + ' < ' + kbsfmt(this.active.bitrate) + ')';
                }
            }
        } else if (currentSpeed && !isNaN(currentSpeed) && currentSpeed >= 0) {
            text += icon.format('faclr-orange') + ' ' + kbsfmt(currentSpeed);
        }
        let meta = [this.active.type.toUpperCase()], dimensions = this.active.dimensions();
        dimensions && meta.push(dimensions);
        if (this.active.codecData && (this.active.codecData.video || this.active.codecData.audio)) {
            let codecs = [this.active.codecData.video, this.active.codecData.audio].filter(s => s);
            codecs = codecs.map(c => c = c.replace(new RegExp('\\([^\\)]*[^A-Za-z\\)][^\\)]*\\)', 'g'), '').replace(new RegExp(' +', 'g'), ' ').trim());
            meta.push(...codecs);
        }
        this.active.transcoder && meta.push(global.lang.TRANSCODING.replaceAll('.', ''));
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
            let ret = await global.menu.dialog(struct, 'ok');
            this.aboutCallback(ret);
        } else {
            title = ucWords(paths.manifest.name) + ' v' + paths.manifest.version + ' - ' + process.arch;
            text = global.lang.NONE_STREAM_FOUND;
            global.menu.info(title, text.trim());
        }
    }
    async moreAbout() {
        if (this.opts.shadow)
            return;
        let title, text = '';
        if (this.active) {
            let struct = await this.moreAboutStructure();
            let ret = await global.menu.dialog(struct, 'ok');
            this.aboutCallback(ret);
        } else {
            title = ucWords(paths.manifest.name) + ' v' + paths.manifest.version + ' - ' + process.arch;
            text = global.lang.NONE_STREAM_FOUND;
            global.menu.info(title, text.trim());
        }
    }
    aboutCallback(chosen) {
        console.log('about callback', chosen);
        if (this.active && this.active.data) {
            this.aboutEntries.concat(this.moreAboutEntries).some(o => {
                if (o.id && o.id == chosen) {
                    if (typeof(o.action) == 'function') {
                        const ret = o.action(this.active.data);
                        ret && ret.catch && ret.catch(e => global.menu.displayErr(e));
                    }
                    return true;
                }
            });
        }
    }
}

class StreamerSpeedo extends StreamerAbout {
    constructor(opts) {
        super(opts);
        this.downlink = 0;
        if (!this.opts.shadow) {
            renderer.ui.on('downlink', downlink => this.downlink = downlink);
            this.on('commit', this.startSpeedo.bind(this));
            this.on('uncommit', this.endSpeedo.bind(this));
            this.on('speed', speed => renderer.ui.emit('streamer-speed', speed));
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

class StreamerGoNext extends StreamerSpeedo {
    constructor(opts) {
        super(opts);
        if (!this.opts.shadow) {
            renderer.ui.on('video-ended', () => {
                if (this.active && this.active.mediaType == 'video') {
                    this.goNext().catch(e => global.menu.displayErr(e));
                }
            });
            renderer.ui.on('video-resumed', () => this.cancelGoNext());
            renderer.ui.on('stop', () => this.cancelGoNext());
            renderer.ui.on('go-prev', () => this.goPrev().catch(e => global.menu.displayErr(e)));
            renderer.ui.on('go-next', () => this.goNext(true).catch(e => global.menu.displayErr(e)));
            this.on('pre-play-entry', e => this.saveQueue(e).catch(e => global.menu.displayErr(e)));
            this.on('streamer-connect', () => this.goNextButtonVisibility().catch(e => global.menu.displayErr(e)));
            process.nextTick(() => {
                this.aboutRegisterEntry('gonext', async () => {
                    if (this.active.mediaType == 'video') {
                        const next = await this.getNext();
                        if (next)
                            return { template: 'option', fa: 'fas fa-step-forward', text: global.lang.GO_NEXT, id: 'gonext' };
                    }
                }, () => this.goNext().catch(e => global.menu.displayErr(e)), null, true);
            });
        }
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms))
    }
    async getQueue() {
        let entries = await global.storage.get('streamer-go-next-queue').catch(err => console.error(err))
        return Array.isArray(entries) ? entries : ''
    }
    async getPrev(offset = 0) {
        const entry = this.active ? this.active.data : this.lastActiveData
        const entries = await this.getQueue()
        if (entry && entries.length) {
            let prev, found = -1;
            if (entry.originalUrl)
                found = entries.findIndex(e => (e.originalUrl || e.url) == entry.originalUrl)
            if (found == -1)
                found = entries.findIndex(e => e.url == entry.url)
            if (found == -1)
                return false
            entries.slice(0, found).reverse().some(e => {
                if (e) {
                    if (offset) {
                        offset--
                    } else {
                        prev = e
                        return true
                    }
                }
            })
            return prev
        }
    }
    async getNext(offset = 0, fromEntry=null) {
        const entry = fromEntry || (this.active ? this.active.data : this.lastActiveData)
        if (entry) {
            const entries = await this.getQueue()
            if (entries.length) {
                let found = -1;
                if (entry.originalUrl)
                    found = entries.findIndex(e => (e.originalUrl || e.url) == entry.originalUrl)
                if (found == -1)
                    found = entries.findIndex(e => e.url == entry.url)
                if (found == -1)
                    return false
                for(const e of entries.slice(found + 1)) {
                    if (e) {
                        if (offset) {
                            offset--
                        } else {
                            return e
                        }
                    }
                }
            }
        }
    }
    async saveQueue(e) {
        if (e.url) {
            const entries = global.menu.currentStreamEntries(true); // will clone before alter
            if (entries.length > 1) {
                global.storage.set('streamer-go-next-queue', entries.map(n => {
                    if (n.renderer)
                        delete n.renderer;
                    return n;
                }), { expiration: true });
            }
        }
    }
    async goNextButtonVisibility() {
        const next = await this.getNext();
        renderer.ui.emit('enable-player-button', 'next', !!next);
    }
    async goPrev() {
        let offset = 0        
        const msg = global.lang.GOING_PREVIOUS;
        this.opts.shadow || global.osd.show(msg, 'fa-mega busy-x', 'go-next', 'persistent');
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
            } else {
                await this.intentFromInfo(prev, {}, undefined, ret.info).catch(e => err = e);
            }
            if (err) {
                offset++;
                continue; // try prev one
            } else {
                break;
            }
        }
        this.goingNext = false;
        this.opts.shadow || global.osd.hide('go-next');
    }
    async goNext(immediate) {
        let offset = 0, start = (Date.now() / 1000), delay = immediate ? 0 : 5        
        const msg = delay ? global.lang.GOING_NEXT_SECS_X.format(delay) : global.lang.GOING_NEXT;
        this.opts.shadow || global.osd.show(msg, 'fa-mega busy-x', 'go-next', 'persistent');
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
            } else {
                await this.intentFromInfo(next, {}, undefined, ret.info).catch(e => err = e);
            }
            if (err) {
                offset++;
                continue; // try next one
            } else {
                break;
            }
        }
        this.goingNext = false;
        this.opts.shadow || global.osd.hide('go-next');
    }
    cancelGoNext() {
        delete this.goingNext;
        this.opts.shadow || global.osd.hide('go-next');
    }
}

class Streamer extends StreamerGoNext {
    constructor() {
        super()
        if (!this.opts.shadow) {
            this.zap = new Zap(this)            
            this.mpegtsSeekingFix = new Limiter(async () => {
                this.mpegtsSeekingFix.fromNow()
                const ret = await global.menu.dialog([
                    { template: 'question', fa: 'fas fa-warn-triangle', text: 'Force MPEGTS broadcasts to be seekable (' + global.lang.SLOW + ')' },
                    { template: 'message', text: global.lang.ENABLE_MPEGTS_SEEKING },
                    { template: 'option', text: global.lang.NO, fa: 'fas fa-times-circle', id: 'no' },
                    { template: 'option', text: global.lang.YES, fa: 'fas fa-check-circle', id: 'yes' }
                ], 'no')
                this.mpegtsSeekingFix.fromNow()
                if (ret == 'yes') {
                    config.set('ffmpeg-broadcast-pre-processing', 'mpegts')
                    this.reload()
                }
            }, { intervalMs: 10000, async: true })
            renderer.ready(async () => {
                global.menu.on('open', path => {
                    if (this.tuning && path.includes(global.lang.STREAMS)) {
                        this.tuning.destroy()
                        this.tuning = null
                    }
                })
            })
            renderer.ui.on('streamer-duration', duration => {
                if (this.active && this.active.mediaType == 'video' && this.active.type != 'vodhls' && this.active.info.contentLength) {
                    const bitrate = (this.active.info.contentLength / duration) * 8;
                    if (bitrate > 0) {
                        this.active.emit('bitrate', bitrate);
                        this.active.bitrate = bitrate;
                        renderer.ui.emit('streamer-bitrate', bitrate);
                    }
                }
            })
            renderer.ui.on('streamer-seek-failure', () => this.mpegtsSeekingFix.call())
        }
    }
    async askExternalPlayer(codecData) {
        if (!this.active || paths.android) return

        let no = global.lang.NO_THANKS, noFa = 'fas fa-stop'
        if(this.zap.isZapping) {
            noFa = 'fas fa-check-circle'
        }

        const url = this.active.data.url
        const text = Object.keys(codecData || {}).map(k => ucWords(k) +': '+ codecData[k]).join('<br />')
        const chosen = await global.menu.dialog([
            { template: 'question', text: global.lang.OPEN_EXTERNAL_PLAYER_ASK, fa: 'fas fa-window-restore' },
            { template: 'message', text },
            { template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-window-restore' },
            { template: 'option', text: no, id: 'no', fa: noFa },
            { template: 'option', text: global.lang.RETRY, id: 'retry', fa: 'fas fa-redo' },
            { template: 'option', text: global.lang.FIX_AUDIO_OR_VIDEO, id: 'transcode', fa: 'fas fa-wrench' }
        ], 'yes')
        if (chosen == 'yes') {
            renderer.ui.emit('external-player', url)
            return true
        } else if (chosen == 'transcode') {
            if (!this.active) return true // already addressed
            if (this.active.isTranscoding()) return true
            return new Promise(resolve => this.transcode(null, err => resolve(!err))) // transcode(intent, _cb, silent)
        } else if (chosen == 'retry') {
            streamer.reload()
            return true
        }
    }
    async pingSource(url) {
        if (typeof(this._streamerPingSourceTTLs) == 'undefined') { // using global here to make it unique between any tuning and streamer
            this._streamerPingSourceTTLs = {};
        }
        if (validateURL(url) && !url.match(new RegExp('#(xtr|mag)'))) {
            let now = (Date.now() / 1000);
            if (!this._streamerPingSourceTTLs[url] || this._streamerPingSourceTTLs[url] < now) {
                this._streamerPingSourceTTLs[url] = now + 60; // lock while connecting
                let err;
                const ret = await Download.head({
                    url,
                    timeout: 10,
                    retry: 0,
                    receiveLimit: 1,
                    followRedirect: true
                }).catch(r => err = r);
                if (typeof(err) != 'undefined') {
                    console.warn('pingSource error: ' + String(err));
                } else {
                    if (ret.statusCode < 200 || ret.statusCode >= 400) { // in case of error, renew after 5min
                        this._streamerPingSourceTTLs[url] = now + 300;
                    } else { // in case of success, renew after 10min
                        this._streamerPingSourceTTLs[url] = now + 600;
                    }
                }
            }
        }
    }
    async commit(intent) {
        if (intent) {
            if (this.active == intent) {
                return true; // 'ALREADY COMMITTED'
            } else {
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
                        renderer.ui.emit('streamer-bitrate', bitrate);
                    }
                });
                intent.on('type-mismatch', () => this.typeMismatchCheck());
                intent.on('fail', err => {
                    this.emit('uncommit', intent);
                    if (this.opts.debug) {
                        console.log('INTENT FAILED !!');
                    }
                    this.handleFailure(intent.data, err).catch(e => global.menu.displayErr(e));
                });
                intent.on('codecData', async (codecData) => {
                    if (codecData && intent == this.active) {
                        renderer.ui.emit('codecData', codecData);
                    }
                    if (!paths.android && !this.opts.shadow && !intent.isTranscoding()) {
                        if (codecData.video && codecData.video.match(new RegExp('(mpeg2video|mpeg4)')) && intent.opts.videoCodec != 'libx264') {
                            const openedExternal = await this.askExternalPlayer(codecData).catch(err => console.error(err));
                            if (openedExternal !== true) {
                                if (!this.tuning && !this.zap.isZapping) {
                                    this.transcode(null, err => {
                                        if (err) intent.fail('unsupported format')
                                    })
                                } else {
                                    return intent.fail('unsupported format')
                                }
                            }
                        }
                    }
                });
                intent.on('streamer-connect', () => this.uiConnect().catch(err => console.error(err)));
                if (intent.codecData) {
                    intent.emit('codecData', intent.codecData);
                }
                this.emit('commit', intent);
                intent.emit('commit');
                await this.uiConnect(intent);
                console.warn('STREAMER COMMIT ' + intent.data.url);
                return true;
            }
        } else {
            return 'NO INTENT';
        }
    }
    async uiConnect(intent, skipTranscodingCheck) {
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
            data.icon = global.icons.url + global.icons.key(data.icon);
        } else {
            data.icon = global.icons.url + global.channels.entryTerms(data).join(',');
        }
        intent.on('outside-of-live-window', () => renderer.ui.emit('outside-of-live-window'));
        this.emit('streamer-connect', intent.endpoint, intent.mimetype, data);
        if (!skipTranscodingCheck && intent.transcoderStarting) {
            renderer.ui.emit('streamer-connect-suspend');
            if (!this.opts.shadow) {
                this.opts.shadow || global.osd.hide('streamer');
            }
        }
        return data;
    }
    transcode(intent, _cb, silent) {
        let transcoding = config.get('transcoding');
        let cb = (err, transcoder) => {
            if (typeof(_cb) == 'function') {
                _cb(err, transcoder);
                _cb = null;
            }
        };
        if (!intent) {
            if (this.active) {
                intent = this.active;
            } else {
                return cb(global.lang.START_PLAYBACK_FIRST);
            }
        }
        if ((transcoding || silent) && intent.transcode) {
            if (intent.transcoder) {
                if (intent.transcoderStarting) {
                    intent.transcoder.once('transcode-started', () => cb(null, intent.transcoder));
                    intent.transcoder.once('transcode-failed', cb);
                } else {
                    cb(null, intent.transcoder);
                }
            } else {
                console.warn('Transcoding started')
                if (!silent) {
                    renderer.ui.emit('streamer-connect-suspend')
                    renderer.ui.emit('transcode-starting', true)
                }
                intent.once('destroy', () => {
                    renderer.ui.emit('transcode-starting', false)
                })
                intent.transcode().then(async () => {
                    await this.uiConnect(intent, true)
                    cb(null, intent.transcoder)
                }).catch(err => {
                    if (this.active) {
                        console.error(err)
                        intent.fail('unsupported format', err, intent.codecData)
                        silent || intent.fail('unsupported format')
                    }
                    cb(err)
                }).finally(() => {
                    renderer.ui.emit('transcode-starting', false)
                })
            }
            return true
        } else {
            cb('Transcoding unavailable')
        }
    }
    share() {
        if (this.active && !this.opts.shadow) {
            let url = this.active.data.originalUrl || this.active.data.url;
            let name = this.active.data.originalName || this.active.data.name;
            let icon = this.active.data.originalIcon || this.active.data.icon;
            if (mega.isMega(url)) {
                renderer.ui.emit('share', ucWords(paths.manifest.name), name, 'https://megacubo.tv/w/' + encodeURIComponent(url.replace('mega://', '')));
            } else {
                url = mega.build(name, { url, icon, mediaType: this.active.mediaType });
                renderer.ui.emit('share', ucWords(paths.manifest.name), name, url.replace('mega://', 'https://megacubo.tv/w/'));
            }
        }
    }
    setTuneable(enable) {
        this.isTuneable = !!enable;
        renderer.ui.emit('tuneable', this.isTuneable);
    }
    findPreferredStreamURL(name) {
        let ret = null;
        global.channels.history.get().some(e => {
            if (e.name == name || e.originalName == name) {
                ret = e.preferredStreamURL;
                return true;
            }
        });
        return ret;
    }
    /**
     * Play from multiple entries using AutoTuner for automatic stream selection
     * This is used when we have multiple candidate streams and need to find the best working one
     * 
     * @param {Array} entries - Array of entry objects to try
     * @param {string} name - Display name
     * @param {string} megaURL - Original mega URL (if any)
     * @param {string} txt - Loading text
     * @param {number} connectId - Connection ID to track concurrent requests
     * @param {string} mediaType - 'live' or 'video'
     * @param {string} preferredStreamURL - Preferred stream URL if available
     * @param {boolean} silent - Suppress UI feedback
     * @returns {Promise<boolean>} Success status
     */
    async playFromEntries(entries, name, megaURL, txt, connectId, mediaType, preferredStreamURL, silent) {
        if (this.opts.shadow) {
            throw 'in shadow mode';
        }
        const loadingEntriesData = [global.lang.AUTO_TUNING, name];
        console.warn('playFromEntries', name, connectId, silent);
        const busies = [name, global.lang.AUTO_TUNING].map(n => global.menu.setBusy(global.menu.path +'/'+ n))
        silent || (this.opts.shadow || global.osd.show(global.lang.TUNING_WAIT_X.format(name), 'fa-mega busy-x', 'streamer', 'persistent'))
        this.tuning && this.tuning.destroy();
        if (this.connectId != connectId) {
            throw 'another play intent in progress';
        }
        console.log('tuning', name, entries.length);
        const tuning = new AutoTuner(entries, {
            preferredStreamURL,
            name,
            megaURL,
            mediaType
        });
        this.tuning = tuning;
        tuning.txt = txt;
        tuning.on('progress', i => {
            if (!silent && i.progress && !isNaN(i.progress)) {
                this.opts.shadow || global.osd.show(global.lang.TUNING_WAIT_X.format(name) + ' ' + i.progress + '%', 'fa-mega busy-x', 'streamer', 'persistent');
            }
        });
        tuning.on('finish', () => {
            tuning.destroy();
        });
        tuning.once('destroy', () => {
            this.opts.shadow || global.osd.hide('streamer')
        });
        let hasErr;
        await tuning.tune().catch(err => {
            if (err != 'cancelled by user') {
                hasErr = err
                console.error(err)
            }
        });
        if (hasErr) {
            silent || (this.opts.shadow || global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal'))
            this.emit('hard-failure', entries)
        } else {
            this.setTuneable(true)
        }
        busies.forEach(b => b.release())
        return !hasErr
    }
    /**
     * Read entries from a mega URL without playing them
     * @param {string} megaUrl - Mega URL to read entries from
     * @param {Object} options - Additional options
     * @param {string} options.mediaType - Override mediaType from URL (default: 'live' for search, opts.mediaType for direct URL)
     * @param {Object} options.entryData - Additional data to merge into entries (e.g. programme)
     * @returns {Promise<Array>} Array of entries matching the mega URL parameters
     */
    async read(megaUrl, options = {}) {
        if (!mega.isMega(megaUrl)) {
            throw new Error('Invalid mega URL');
        }
        
        const opts = mega.parse(megaUrl);
        if (!opts) {
            throw new Error('Failed to parse mega URL');
        }
        
        // If URL is provided directly, return single entry
        if (opts.url) {
            const entry = {
                name: opts.name || 'Stream',
                url: opts.url,
                originalUrl: megaUrl,
                mediaType: options.mediaType || opts.mediaType || 'live',
                ...opts
            };
            if (options.entryData) {
                Object.assign(entry, options.entryData);
            }
            return [entry];
        }
        
        // Otherwise, search in lists using terms or name
        const listsReady = await global.lists.ready(10);
        if (listsReady !== true) {
            throw new Error(global.lang.WAIT_LISTS_READY);
        }
        
        // Process search terms - mega.parse() should return terms as array, but handle edge cases
        let searchTerms = opts.terms;
        if (searchTerms) {
            // Ensure it's an array
            if (!Array.isArray(searchTerms)) {
                if (typeof searchTerms === 'string') {
                    searchTerms = searchTerms.split(',').map(t => t.trim()).filter(t => t);
                } else {
                    searchTerms = null;
                }
            }
        }
        
        // Fallback to name-based search if no terms or empty array
        if (!searchTerms || searchTerms.length === 0) {
            searchTerms = terms(opts.name);
        }
        
        // Use mediaType from options or opts, but don't default to 'live' to avoid filtering issues
        // Only pass type if explicitly specified in options or opts
        const searchMediaType = options.mediaType !== undefined ? options.mediaType : (opts.mediaType !== undefined ? opts.mediaType : undefined);
        
        const searchOpts = {
            safe: !global.lists.parentalControl.lazyAuth(),
            limit: 1024
        };
        
        // Only add type if explicitly specified (don't default to 'live')
        // This matches the behavior when calling lists.search() without type option
        if (searchMediaType !== undefined) {
            searchOpts.type = searchMediaType;
            // Explicitly set typeStrict to false to avoid over-filtering
            searchOpts.typeStrict = false;
        }
        
        const entries = await global.lists.search(searchTerms, searchOpts);
        
        // Enrich entries with original mega URL info
        return entries.map(entry => {
            entry.originalName = opts.name;
            if (entry.rawname) {
                entry.rawname = opts.name;
            }
            entry.originalUrl = megaUrl;
            if (options.entryData) {
                Object.assign(entry, options.entryData);
            }
            return entry;
        });
    }
    
    /**
     * Main play method - handles different entry types and routes to appropriate playback method
     * 
     * Flow:
     * 1. If results array provided -> playFromEntries() (multiple entries with AutoTuner)
     * 2. If mega URL without direct URL -> read() + playFromEntries() (search and tune)
     * 3. If direct URL -> intent() (single stream)
     * 
     * Errors are automatically handled unless silent=true or caller handles them manually.
     * 
     * @param {Object} e - Entry object with url, name, etc.
     * @param {Array} results - Optional pre-fetched entries array
     * @param {boolean} silent - Suppress UI feedback and error handling
     * @returns {Promise<boolean>} Success status
     */
    async play(e, results, silent) {
        if (this.opts.shadow) {
            throw 'in shadow mode';
        }
        e = clone(e);
        if (this.active && !config.get('play-while-loading')) {
            this.stop();
        }
        if (this.tuning) {
            if (!this.tuning.destroyed && this.tuning.opts.megaURL && this.tuning.opts.megaURL == e.url) {
                return this.tune(e)
            }
            this.tuning.destroy()
            this.tuning = null
        }
        const connectId = (Date.now() / 1000);
        this.connectId = connectId;
        this.emit('connecting', connectId);
        
        const isMega = mega.isMega(e.url), txt = isMega ? global.lang.TUNING : undefined
        const opts = isMega ? mega.parse(e.url) : { mediaType: 'live' }
        const loadingEntriesData = [e, global.lang.AUTO_TUNING]
        const busy = silent ? false : global.menu.setBusy(global.menu.path +'/'+ e.name)
        let succeeded
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
                    this.emit('connecting-failure', e)
                }
            } else {
                busy && busy.release()
                throw 'another play intent in progress'
            }
        } else if (isMega && !opts.url) {            
            let name = e.name
            if (opts.name) {
                name = opts.name
            }
            silent || (this.opts.shadow || global.osd.show(global.lang.TUNING_WAIT_X.format(name), 'fa-mega busy-x', 'streamer', 'persistent'))
            
            // Use read() to get entries from mega URL
            // Don't pass mediaType explicitly - let read() use opts.mediaType from URL or default behavior
            let entries;
            try {
                entries = await this.read(e.url, {
                    entryData: {
                        programme: e.programme
                    }
                });
            } catch (err) {
                if (this.connectId != connectId) {
                    busy && busy.release()
                    throw 'another play intent in progress'
                }
                silent || (this.opts.shadow || global.osd.hide('streamer'))
                throw err
            }
            
            if (this.connectId != connectId) {
                busy && busy.release()
                throw 'another play intent in progress'
            }
            
            if (entries.length) {
                succeeded = await this.playFromEntries(entries, name, e.url, txt, connectId, opts.mediaType, e.preferredStreamURL || this.findPreferredStreamURL(name), silent);
            }
            if (!succeeded) {
                this.opts.shadow || global.osd.hide('streamer');
                this.connectId = false;
                this.emit('connecting-failure', e);
                if (!silent) {
                    const err = global.lists.activeLists.length ?
                        global.lang.NONE_STREAM_WORKED_X.format(name) :
                        ((global.lists && Object.keys(global.lists).length) ? global.lang.NO_LIST : global.lang.NO_LISTS_ADDED);
                    this.opts.shadow || global.osd.show(err, 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal');
                    renderer.ui.emit('sound', 'failure', {volume: 7});
                    this.emit('hard-failure', entries);
                }
            }
        } else {
            if (opts.url) {
                e = Object.assign(Object.assign({}, e), opts);
            }
            this.setTuneable(!this.streamInfo.mi.isVideo(e.url) && global.channels.isChannel(e))
            silent || (this.opts.shadow || global.osd.show(global.lang.CONNECTING + ' ' + e.name + '...', 'fa-mega busy-x', 'streamer', 'persistent'))
            let hasErr, intent = await this.intent(e).catch(r => hasErr = r);
            if (typeof(hasErr) != 'undefined') {
                if (this.connectId != connectId) {
                    busy && busy.release()
                    throw 'another play intent in progress';
                }
                renderer.ui.emit('sound', 'failure', {volume: 7});
                this.connectId = false;
                this.emit('connecting-failure', e);
                this.handleFailure(e, hasErr).catch(e => global.menu.displayErr(e));
            } else {
                if (intent.mediaType != 'live') {
                    this.setTuneable(false);
                }
                succeeded = true;
            }
        }
        busy && busy.release()
        
        // Return a promise that handles errors automatically when silent=false
        // Callers can still use .catch() to handle errors manually if needed
        // This maintains backward compatibility while allowing manual error handling
        const result = Promise.resolve(succeeded);
        if (!silent && typeof global !== 'undefined' && global.menu) {
            // Add error handler, but allow it to be overridden by manual .catch()
            return result.catch(err => {
                global.menu.displayErr(err);
                throw err; // Re-throw to allow manual handling if caller uses .catch()
            });
        }
        return result;
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
            const ch = global.channels.isChannel(e)
            if (ch) {
                e.name = ch.name
            }
            const same = this.tuning && !this.tuning.finished && !this.tuning.destroyed && (this.tuning.has(e.url) || this.tuning.opts.megaURL == e.url);
            if (same) {
                let err
                this.opts.shadow || global.osd.show(global.lang.TUNING_WAIT_X.format(e.name), 'fa-mega busy-x', 'streamer', 'persistent')
                const busies = [e.name, global.lang.AUTO_TUNING].map(name => global.menu.setBusy(global.menu.path +'/'+ name))
                await this.tuning.tune().catch(e => err = e)
                busies.forEach(b => b.release())
                if (err) {
                    if (err != 'cancelled by user') {
                        this.emit('connecting-failure', e);
                        console.error('tune() ERR', err);
                        this.opts.shadow || global.osd.show(global.lang.NO_MORE_STREAM_WORKED_X.format(e.name), 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal')
                        return
                    }
                } else {
                    this.setTuneable(true)
                }
                this.opts.shadow || global.osd.hide('streamer')
            } else {                
                if (ch) {
                    e.url = mega.build(ch.name, { terms: ch.terms });
                } else {
                    const name = e.originalName || e.name;
                    let tms = terms(name)
                    if (Array.isArray(tms)) tms = tms.join(' ')
                    e.url = mega.build(name, { terms: tms });
                }
                this.play(e)
            }
            return true
        }
    }
}

export default Streamer;
