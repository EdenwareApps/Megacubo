import osd from '../osd/osd.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import onexit from "node-cleanup";
import mega from "../mega/mega.js";
import Tuner from "../tuner/tuner.js";
import config from "../config/config.js"
import renderer from '../bridge/bridge.js'
import storage from '../storage/storage.js'

class StreamState extends EventEmitter {
    constructor(master) {
        super()
        this.streamer = master
        this.debug = false;
        this.ttl = (6 * 3600);
        this.minSaveIntervalSecs = 30;
        this.limit = 4096; // max number of entries to keep
        this.data = {};
        this.waiting = {};
        this.clientFailures = {};
        this.key = 'streamstate';
        storage.get(this.key).then(data => {
            if (data) {
                Object.assign(this.data, data);
                this.sync();
            }
        }).catch(e => global.menu.displayErr(e))
        renderer.ready(() => {
            this.streamer.on('connecting', () => this.cancelTests());
            this.streamer.on('connecting-failure', data => {
                data && this.set(data.url, 'offline', true, { source: data.source });
                this.test(global.menu.currentStreamEntries()).catch(console.error);
            });
            this.streamer.on('commit', intent => {
                const url = intent.data.url;
                this.cancelTests();
                this.set(url, intent.type, true, { source: intent.data.source });
                if (this.data[url]) {
                    const data = this.data[url];
                    if (data.duration && data.position && data.position > 10 && (data.position < (data.duration - 30))) {
                        process.nextTick(() => {
                            renderer.get().emit('resume-dialog', data.position, data.duration);
                        });
                    }
                }
            });
            this.streamer.on('failure', data => {
                data && this.set(data.url, 'offline', true, { source: data.source });
            });
            this.streamer.on('stop', (err, e) => {
                setTimeout(() => {
                    if (!this.streamer.active) {
                        this.test(global.menu.currentStreamEntries()).catch(console.error);
                    }
                }, 500);
            });
            global.menu.on('open', () => this.cancelTests());
            global.menu.on('render', entries => {
                this.cancelTests();
                if (entries.some(e => this.supports(e))) {
                    this.test(entries).catch(console.error)
                }
            });
            renderer.get().on('state-atts', (url, atts) => {
                let state;
                if (this.streamer.active && url == this.streamer.active.data.url) {
                    state = this.streamer.active.type;
                } else if (typeof (this.data[url]) != 'undefined') {
                    state = this.data[url].state;
                }
                if (typeof (state) != 'undefined') {
                    this.set(url, state, true, atts);
                }
            });
            this.on('state', (url, state) => renderer.get().emit('stream-state-set', url, state));
            onexit(() => {
                this.cancelTests();
                this.save(); // sync
            })
        })
    }
    supports(e) {
        const cls = e.class || '';
        if (e && e.url && cls.indexOf('skip-testing') == -1) {
            if (cls.indexOf('allow-stream-state') != -1) {
                return true;
            }
            if (!e.type || e.type == 'stream' || cls.indexOf('entry-meta-stream') != -1) {
                return true;
            }
        }
    }
    get(url) {
        if (typeof (this.clientFailures[url]) != 'undefined' && this.clientFailures[url] === true) {
            return false
        }
        if (typeof (this.data) == 'object' && typeof (this.data[url]) == 'object' && this.data[url] && typeof (this.data[url].time) != 'undefined' && (Date.now() / 1000) < (this.data[url].time + this.ttl)) {
            return this.data[url].state
        }
        return null
    }
    set(url, state, isTrusted, atts) {
        if (typeof (this.data) == 'object') {
            if (!isTrusted && typeof (this.clientFailures[url]) != 'undefined') {
                state = 'offline';
            }
            let isMega = mega.isMega(url);
            if (!isMega) {
                let changed, time = (Date.now() / 1000);
                if (typeof (this.waiting[url]) != 'undefined') {
                    changed = true;
                    delete this.waiting[url];
                }
                if (!atts) {
                    atts = {};
                }
                atts.time = time;
                atts.state = state;
                if (typeof (this.data[url]) == 'undefined') {
                    this.data[url] = {};
                }
                Object.keys(atts).forEach(k => {
                    if (['position', 'duration'].includes(k)) {
                        const reset = k == 'position' && this.data[url] && this.data[url][k] && this.data[url][k] > (this.data[url].duration - 30); // user will watch again
                        if (!this.data[url][k] || reset || this.data[url][k] < atts[k]) {
                            this.data[url][k] = atts[k];
                            changed = true;
                        }
                    } else if (atts[k] != this.data[url][k]) {
                        this.data[url][k] = atts[k];
                        changed = true;
                    }
                });
                if (isTrusted) {
                    if (state == 'offline') {
                        if (typeof (this.clientFailures[url]) == 'undefined') {
                            this.clientFailures[url] = true;
                            changed = true;
                        }
                    } else {
                        if (typeof (this.clientFailures[url]) != 'undefined') {
                            delete this.clientFailures[url];
                            changed = true;
                        }
                    }
                }
                if (changed) {
                    this.emit('state', url, state, atts.source);
                    this.saveAsync();
                }
            }
        }
    }
    sync() {
        if (renderer) {
            let syncMap = {};
            Object.keys(this.data).forEach(url => {
                syncMap[url] = this.data[url].state;
            });
            renderer.get().emit('stream-state-sync', syncMap);
        }
    }
    trim() {
        if (typeof (this.data) != 'undefined') {
            const ks = Object.keys(this.data);
            if (ks.length > this.limit) {
                ks.map(url => ({ url, time: this.data[url].time })).sortByProp('time', true).slice(this.limit).forEach(row => {
                    delete this.data[row.url];
                });
            }
        }
    }
    async save() {
        if (typeof (this.data) != 'undefined') {
            const now = (Date.now() / 1000);
            this.lastSaveTime = now;
            this.trim();
            await storage.set(this.key, this.data, { expiration: true });
            console.warn('STREAMSTATE SAVE', now);
        }
    }
    saveAsync() {
        const delay = this.saveDelay() * 1000;
        if (delay) { // delay saving
            if (this.saveTimer) {
                clearTimeout(this.saveTimer);
            }
            this.saveTimer = setTimeout(() => this.saveAsync(), delay);
        } else { // save now
            const now = (Date.now() / 1000);
            this.lastSaveTime = now;
            this.trim();
            storage.set(this.key, this.data, { expiration: true }).catch(console.error);
            console.warn('STREAMSTATE SAVE', now);
        }
    }
    saveDelay() {
        if (typeof (this.data) != 'undefined') {
            const now = (Date.now() / 1000);
            if (!this.lastSaveTime || (this.lastSaveTime + this.minSaveIntervalSecs) <= now) {
                return 0;
            } else {
                return (this.lastSaveTime + this.minSaveIntervalSecs) - now;
            }
        } else {
            return this.minSaveIntervalSecs;
        }
    }
    isLocalFile(file) {
        if (typeof (file) != 'string') {
            return;
        }
        let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'));
        if (m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')) { // drive letter or file protocol
            return true;
        } else {
            if (file.length >= 2 && file.startsWith('/') && file.charAt(1) != '/') { // unix path
                return true;
            }
        }
    }
    test(entries, name = '', force) {
        return new Promise((resolve, reject) => {
            const ctrlKey = entries.map(e => e.url || '').join('');
            if (this.testing) {
                if (this.testing.ctrlKey == ctrlKey) {
                    return; // already testing these same entries
                }
                this.testing.finish();
            }
            if (!entries.length) {
                return resolve(true);
            }
            if (this.debug) {
                console.log('streamer.state about to test', entries);
            }
            const allowAutoTest = config.get('auto-test');
            const manuallyTesting = force === true;
            const autoTesting = !manuallyTesting && allowAutoTest;
            const nt = { name: lang.TEST_STREAMS };
            if (manuallyTesting) {
                renderer.get().emit('set-loading', nt, true, lang.TESTING);
                osd.show(lang.TESTING + ' 0%', 'fa-mega spin-x-alt', 'stream-state-tester', 'persistent');
            }
            const retest = [], syncData = {}            
            entries = entries.filter(e => {
                if (e.url && this.supports(e)) {
                    if (mega.isMega(e.url)) {
                        let s = 'tune', atts = mega.parse(e.url);
                        if (atts && atts.mediaType && atts.mediaType != 'live') {
                            s = 'folder';
                        }
                        syncData[e.url] = s;
                    } else {
                        let state = this.get(e.url);
                        if (typeof (this.clientFailures[e.url]) != 'undefined') {
                            state = 'offline';
                        }
                        if (state && typeof (state) == 'string') {
                            if (state != 'offline') {
                                syncData[e.url] = state;
                                const data = this.data[e.url];
                                if (data && this.isWatched(data)) {
                                    syncData[e.url] += ',watched';
                                }
                            } else {
                                if (manuallyTesting || autoTesting) { // if did it failed previously, move to end of queue to try again after the untested ones
                                    syncData[e.url] = 'waiting';
                                    this.waiting[e.url] = true;
                                    retest.push(e);
                                } else {
                                    syncData[e.url] = state || '';
                                    this.waiting[e.url] = false;
                                }
                            }
                            return false;
                        }
                        if (!manuallyTesting && !autoTesting) {
                            syncData[e.url] = '';
                            this.waiting[e.url] = false;
                            return;
                        }
                        syncData[e.url] = 'waiting';
                        this.waiting[e.url] = true;
                        return true;
                    }
                }
            });
            retest.length && entries.push(...retest);
            const shouldTest = manuallyTesting || autoTesting;
            if (!shouldTest || !entries.length) {
                Object.keys(syncData).forEach(k => {
                    if (syncData[k] == 'waiting')
                        delete syncData[k];
                });
            }
            renderer.get().emit('stream-state-sync', syncData);
            if (!shouldTest)
                return resolve(true);
            if (!entries.length) {
                manuallyTesting && osd.show(lang.TESTING + ' 100%', 'fa-mega spin-x-alt', 'stream-state-tester', 'normal');
                return resolve(true);
            }
            this.testing = new Tuner(entries, { skipSample: true, shadow: true }, name);
            this.testing.ctrlKey = ctrlKey;
            this.testing.on('success', this.success.bind(this));
            this.testing.on('failure', this.failure.bind(this));
            this.testing.on('progress', i => {
                manuallyTesting && osd.show(lang.TESTING + ' ' + i.progress + '%', 'fa-mega spin-x-alt', 'stream-state-tester', 'persistent');
            });
            this.testing.on('finish', () => {
                if (this.testing) {
                    if (this.debug) {
                        console.warn('TESTER FINISH!', nt, this.testing.results, this.testing.states);
                    }
                    renderer.get().emit('set-loading', nt, false);
                    manuallyTesting && osd.hide('stream-state-tester');
                    this.testing.destroy();
                    this.testing = null;
                    resolve(true);
                    this.saveAsync();
                    this.sync();
                }
            });
            this.testing.start();
        });
    }
    success(entry, info) {
        this.set(entry.url, info.type, false, { source: entry.source });
    }
    failure(entry) {
        this.set(entry.url, 'offline', true, { source: entry.source });
    }
    cancelTests() {
        if (this.testing) {
            if (this.debug) {
                console.log('streamer.state cancelTests');
            }
            this.testing.finish();
        }
    }
    isWatched(data) {
        if (!data)
            return;
        if (typeof (data) == 'string') {
            data = this.data[data];
            if (!data)
                return;
        }
        if (!data.position || !data.duration) {
            if (data.url) {
                data = this.data[data.url];
                if (!data || !data.position || !data.duration)
                    return;
            } else {
                return;
            }
        }
        const creditsTime = Math.min(180, Math.max(data.duration * 0.05, 30));
        return data.position && data.position > (data.duration - creditsTime);
    }
}
export default StreamState
