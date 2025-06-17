import lang from "../../lang/lang.js";
import { EventEmitter } from "events";
import paths from "../../paths/paths.js";
import fs from "fs";
import config from "../../config/config.js"

class StreamerBaseIntent extends EventEmitter {
    constructor(data, opts, info) {
        super();
        this.mimeTypes = {
            hls: 'application/x-mpegURL',
            dash: 'application/dash+xml',
            mpegts: 'video/MP2T',
            video: 'video/mp4'
        };
        this.mediaType = 'video';
        this.codecData = null;
        this.type = 'base';
        this.timeout = Math.max(20, config.get('broadcast-start-timeout'));
        this.committed = false;
        this.manual = false;
        this.loaded = false;
        this.adapters = [];
        this.errors = [];
        this.data = data;
        this.subtitle = false;
        this.started = false;
        this.ignoreErrors = false;
        this.mimetype = '';
        this.audioTrack = 0;
        this.subtitleTrack = null;
        this.failListener = this.onFail.bind(this)
        this.opts = {
            workDir: paths.temp + '/streamer/ffmpeg/data',
            videoCodec: 'copy',
            audioCodec: 'copy'
        }
        if (opts) {
            this.setOpts(opts);
        }
        fs.mkdir(this.opts.workDir, { recursive: true }, (err) => {
            if (err) {
                console.error(err);
            }
        });
        this.info = info;
        this.on('dimensions', dimensions => {
            if (dimensions && this._dimensions != dimensions) {
                this._dimensions = dimensions;
                this.emit('dimensions', this._dimensions);
            }
        });
        this.on('error', () => this.unload())
        if (!this.data.authURL && this.data.source && global.lists) {
            this.data.authURL = global.lists.getAuthURL(this.data.source)
        }
    }
    isTranscoding() {
        if (this.transcoderStarting || this.transcoder) {
            return true;
        }
        return this.adapters.some(a => a.isTranscoding && a.isTranscoding() === true);
    }
    getTranscodingCodecs() {
        const opts = { audioCodec: 'aac', videoCodec: 'libx264' };
        if (this.codecData) {
            if (this.codecData.video && this.codecData.video.includes('h264')) {
                opts.videoCodec = 'copy';
            }
            if (this.codecData.audio && this.codecData.audio.includes('aac')) {
                opts.audioCodec = 'copy';
            }
        }
        return opts;
    }
    getTranscodingOpts() {
        return Object.assign({
            workDir: this.opts.workDir,
            authURL: this.data.authURL || this.data.source,
            debug: this.opts.debug,
            isLive: this.mediaType == 'live'
        }, this.getTranscodingCodecs());
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
    connectAdapter(adapter) {
        this.adapters.push(adapter);
        adapter.mediaType = this.mediaType;
        adapter.on('type-mismatch', () => this.emit('type-mismatch'));
        adapter.on('outside-of-live-window', () => this.emit('outside-of-live-window'));
        adapter.on('dimensions', dimensions => {
            this.emit('dimensions', dimensions);
        });
        adapter.on('codecData', codecData => this.addCodecData(codecData));
        adapter.on('speed', speed => {
            if (speed > 0 && this.currentSpeed != speed) {
                this.currentSpeed = speed;
            }
        });
        adapter.on('wait', () => this.resetTimeout());
        adapter.on('fail', this.failListener);
        adapter.on('streamer-connect', () => this.emit('streamer-connect'));
        this.on('commit', () => {
            adapter.emit('commit');
            if (!adapter.committed) {
                adapter.committed = true;
            }
        });
        this.on('uncommit', () => {
            if (adapter.committed) {
                adapter.emit('uncommit');
                adapter.committed = false;
            }
        });
        adapter.on('bitrate', (bitrate, speed) => {
            if (speed && speed > 0) {
                this.currentSpeed = speed;
            }
            if (bitrate >= 0 && this.bitrate != bitrate) {
                this.bitrate = bitrate;
                this.emit('bitrate', this.bitrate, this.currentSpeed);
            }
        });
        adapter.committed = this.committed;
        if (adapter.bitrate) {
            this.bitrate = adapter.bitrate;
            this.emit('bitrate', adapter.bitrate, this.currentSpeed);
        }
    }
    disconnectAdapter(adapter) {
        adapter.removeListener('fail', this.failListener);
        ['dimensions', 'codecData', 'bitrate', 'type-mismatch', 'speed', 'commit', 'uncommit'].forEach(n => adapter.removeAllListeners(n));
        let pos = this.adapters.indexOf(adapter);
        if (pos != -1) {
            this.adapters.splice(pos, 1);
        }
    }
    addCodecData(codecData, ignoreAdapter) {
        let changed;
        if (!this.codecData) {
            this.codecData = { audio: '', video: '' };
        }
        ;
        ['audio', 'video'].forEach(type => {
            if (codecData[type] && codecData[type] != this.codecData[type]) {
                changed = true;
                this.codecData[type] = codecData[type];
            }
        });
        if (changed) {
            this.emit('codecData', this.codecData);
            this.adapters.forEach(adapter => {
                if (adapter.addCodecData && adapter != ignoreAdapter) {
                    adapter.addCodecData(codecData);
                }
            });
        }
        return this.codecData;
    }
    onFail(err) {
        if (!this.destroyed) {
            console.log('[' + this.type + '] adapter fail', err);
            this.fail(err);
        }
    }
    findLowAdapter(base, types, filter) {
        if (!base) {
            base = this;
        }
        let adapters = this.findAllAdapters(base, types, filter);
        if (adapters) {
            let ret;
            for (let i = 0; i < adapters.length; i++) { // not reverse, to find the lower level adapter, useful to get stream download speed
                if (!ret || types.indexOf(adapters[i].type) < types.indexOf(ret.type)) {
                    ret = adapters[i];
                }
            }
            return ret;
        }
    }
    findAdapter(base, types, filter) {
        if (!base) {
            base = this;
        }
        let adapters = this.findAllAdapters(base, types, filter);
        if (adapters) {
            let ret;
            for (let i = adapters.length - 1; i >= 0; i--) { // reverse lookup to find the higher level adapter, so it should be HTML5 compatible already
                if (!ret || types.indexOf(adapters[i].type) < types.indexOf(ret.type)) {
                    ret = adapters[i];
                }
            }
            return ret;
        }
    }
    findAllAdapters(base, types, filter) {
        if (!base) {
            base = this;
        }
        let adapters = [];
        if (base.adapters) {
            for (let i = base.adapters.length - 1; i >= 0; i--) { // reverse lookup to find the higher level adapter, so it should be HTML5 compatible already
                if (base.adapters[i].type && types.includes(base.adapters[i].type) && (!filter || filter(base.adapters[i]))) {
                    adapters.push(base.adapters[i]);
                } else {
                    adapters.push(...this.findAllAdapters(base.adapters[i], types, filter));
                }
            }
        }
        return adapters;
    }
    destroyAdapters() {
        this.adapters.forEach(a => {
            if (a) {
                if (a.destroy) {
                    if (!a.destroyed) {
                        a.destroy();
                    }
                } else if (a.close) {
                    if (a.closed) {
                        a.close();
                        a.closed = true;
                    }
                } else {
                    console.error('No destroy method for', a);
                }
            }
        });
        this.adapters = [];
    }
    dimensions() {
        let dimensions = '';
        if (this._dimensions) {
            dimensions = this._dimensions;
        } else {
            this.adapters.some(a => {
                if (a._dimensions) {
                    dimensions = a._dimensions;
                    return true;
                }
            });
        }
        return dimensions;
    }
    setTimeout(secs) {
        if (this.committed)
            return;
        if (this.timeout != secs) {
            this.timeout = secs;
        }
        this.clearTimeout();
        this.timeoutStart = (Date.now() / 1000);
        this.timeoutTimer = setTimeout(() => {
            if (this && !this.failed && !this.destroyed && !this.committed) {
                console.log('Timeouted engine after ' + ((Date.now() / 1000) - this.timeoutStart), this.committed);
                this.fail('timeout');
            }
        }, secs * 1000);
    }
    clearTimeout() {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = 0;
    }
    resetTimeout() {
        this.setTimeout(this.timeout);
    }
    timeoutStatus() {
        return Math.max(100, ((Date.now() / 1000) - this.timeoutStart) / (this.timeout / 100));
    }
    start() {
        let resolved;
        this.resetTimeout();
        return new Promise((resolve, reject) => {
            this.on('fail', err => {
                if (!resolved) {
                    resolved = true;
                    reject(err);
                }
            });
            this.once('destroy', () => {
                setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        reject('destroyed');
                    }
                }, 400);
            });
            this._start().then(data => {
                if (!resolved) {
                    resolve(data);
                }
            }).catch(err => {
                if (!resolved) {
                    reject(err);
                }
            });
        });
    }
    getAudioTracks() {
        if (Array.isArray(this.audioTracks) && this.audioTracks.length) {
            return this.audioTracks;
        }
        return [
            { id: 0, name: lang.DEFAULT, enabled: true }
        ];
    }
    getSubtitleTracks() {
        if (Array.isArray(this.subtitleTracks) && this.subtitleTracks.length) {
            return this.subtitleTracks;
        }
        return [];
    }
    fail(err) {
        if (this && !this.failed && !this.destroyed) {
            console.log('fail', err);
            this.failed = err || true;
            this.errors.push(err);
            this.emit('fail', err);
            this.destroy();
        }
    }
    destroy() {
        if (!this.destroyed) {
            this.destroyAdapters();
            this.destroyed = true;
            if (this.serverStopper) {
                this.serverStopper.stop();
                this.serverStopper = null;
            }
            if (this.server) {
                this.server.close();
                this.server = null;
            }
            if (this.committed) {
                this.emit('uncommit');
            }
            this.emit('destroy');
            this.removeAllListeners();
            this.adapters.forEach(a => a.destroy());
            this.adapters = [];
        }
    }
}
StreamerBaseIntent.isVODM3U8 = (content, contentLength, headers) => {
    let sample = String(content).toLowerCase()
    if (sample.match(new RegExp('ext-x-playlist-type: *(vod|event)')))
        return true
    if (sample.includes('#ext-x-media-sequence') && !sample.match(new RegExp('#ext-x-media-sequence:[0-1][^0-9]')))
        return false
    if (headers) {
        if (headers['last-modified']) {
            let date = new Date(headers['last-modified']);
            if (!isNaN(date.getTime())) {
                const elapsed = (Date.now() / 1000) - (date.getTime() / 1000);
                if (elapsed > 180) {
                    return true
                }
            }
        }
    }
    let pe = sample.indexOf('#ext-x-endlist')
    let px = sample.lastIndexOf('#extinf')
    if (pe != -1) {
        return pe > px
    }
    if (!sample.includes('#ext-x-program-date-time')) {
        const pieces = sample.split('#extinf')
        if (pieces.length > 30) {
            return true
        }
        if (typeof(contentLength) == 'number' && pieces.length > 2) { //  at least 3 pieces, to ensure that the first extinf is complete
            let header = pieces.shift()
            let pieceLen = pieces[0].length + 7
            let totalEstimatedPieces = (contentLength - header.length) / pieceLen
            if (totalEstimatedPieces > 30) {
                return true
            }
        }
    }
};
export default StreamerBaseIntent;
