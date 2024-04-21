import { ucWords } from '../utils/utils.js'
import { EventEmitter } from "events";
import Streamer from "../streamer/streamer.js";
import pLimit from "p-limit";
import config from "../config/config.js"

let sharedStreamerObject;
const streamer = () => {
    if (!sharedStreamerObject) {
        sharedStreamerObject = new Streamer({ shadow: true })
    }
    return sharedStreamerObject;
};
class TunerUtils extends EventEmitter {
    constructor(entries, opts, name) {
        super();
        this.paused = true;
        this.opts = {
            debug: false,
            shadow: false,
            allowedTypes: null
        };
        this.name = name ? ucWords(name) : (entries.length ? entries[0].name : '');
        if (opts) {
            this.setOpts(opts);
        }
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
    getDomain(u) {
        if (u && u.indexOf('//') != -1) {
            let d = u.split('//')[1].split('/')[0].split(':')[0];
            if (d == 'localhost' || d.indexOf('.') != -1) {
                return d;
            }
        }
        return '';
    }
}
class TunerTask extends TunerUtils {
    constructor(entries, opts, name) {
        super(entries, opts, name);
        this.info = [];
        this.results = [];
        this.domains = [];
        this.errors = [];
        this.states = [];
        this.domainDelay = {};
        this.setMaxListeners(entries.length * 2);
    }
    async test(e, i) {
        /*
        STATES, used by test()
        -2 = start failed
        -1 = probe failed
        0 = uninitialized
        1 = probing
        2 = probed, starting
        3 = success, ready

        RESULT STATES .results[], used by task() and pump()
        -2 = failure, emitted
        -1 = failure, queued
        0 = uninitialized
        1 = success, queued
        2 = success, emitted
        */
        if (this.aborted)
            return;
        if (this.opts.debug) {
            console.log('Tuner test');
        }
        this.states[i] = 1;
        const domain = this.domainAt(i);
        this.domainDelay[domain] = (Date.now() / 1000) + 1; // try to keep a max of 1 request per sec for same domain connections
        let err;
        const info = await streamer().info(e.url, 2, Object.assign({ skipSample: this.opts.skipSample }, e)).catch(r => err = r);
        if (typeof (err) != 'undefined') {
            this.states[i] = -1;
            console.error('Tuner err', err, i);
            throw err;
        }
        else {
            if (!Array.isArray(this.opts.allowedTypes) || this.opts.allowedTypes.includes(info.type)) {
                this.states[i] = 2;
                return info;
            }
            else {
                let err = 'Tuner bad intent type: ' + info.type;
                console.error(err, info, e);
                this.states[i] = -1;
                if (this.opts.debug) {
                    console.log(err, i);
                }
                throw err;
            }
        }
    }
    domainAt(i) {
        if (typeof (this.domains[i]) == 'undefined') {
            this.domains[i] = this.getDomain(this.entries[i].url);
        }
        return this.domains[i];
    }
    busyDomains() {
        let busy = [];
        this.states.forEach((v, i) => {
            const d = this.domainAt(i);
            if (v == 1) {
                if (!busy.includes(d)) {
                    busy.push(d);
                }
            }
            else {
                if (this.domainDelay[d] && this.domainDelay[d] > (Date.now() / 1000) && !busy.includes(d)) {
                    busy.push(d);
                }
            }
        });
        return busy;
    }
    nextEntry() {
        return new Promise(resolve => {
            let timer = 0;
            const updateListener = () => {
                clearTimeout(timer);
                if (this.paused)
                    return;
                let ret = -1;
                let busy = this.busyDomains();
                this.entries.some((e, i) => {
                    if (typeof (this.results[i]) == 'undefined') {
                        if (!busy.length || !busy.includes(this.domainAt(i))) {
                            ret = i;
                            return true;
                        }
                    }
                });
                if (this.finished || this.destroyed || ret != -1) {
                    this.removeListener('update', updateListener);
                    this.removeListener('finish', updateListener);
                    this.removeListener('destroy', updateListener);
                    this.results[ret] = 0; // ticket taken
                    resolve(ret);
                }
                else {
                    timer = setTimeout(updateListener, 5000); // busyDomains logic makes timer required yet
                }
            };
            this.on('resume', updateListener);
            this.on('update', updateListener);
            this.on('finish', updateListener);
            this.on('destroy', updateListener);
            updateListener();
        });
    }
    async task() {
        if (this.opts.debug) {
            console.log('TUNER TASK', this.paused);
        }
        if (this.finished)
            return;
        const i = await this.nextEntry();
        if (this.opts.debug) {
            console.log('TUNER nextEntry', i);
        }
        let err, e = this.entries[i];
        this.states[i] = 0;
        if (this.opts.debug) {
            console.log('Tuner pre', i);
        }
        const ret = await this.test(e, i).catch(e => err = e);
        if (typeof (err) != 'undefined') {
            if (this.opts.debug) {
                console.warn('Tuner failure', i);
            }
            this.errors[i] = err;
            this.results[i] = -1;
        }
        else {
            if (this.opts.debug) {
                console.log('Tuner suc', i, ret);
            }
            this.info[i] = ret;
            this.errors[i] = 'success';
            this.results[i] = 1;
        }
        this.pump();
    }
    pause() {
        if (!this.paused) {
            if (this.opts.debug) {
                console.log('tuner paused');
            }
            this.paused = true;
            this.emit('pause');
        }
    }
    resume() {
        if (this.paused) {
            if (this.opts.debug) {
                console.log('tuner resume');
            }
            this.aborted = false;
            this.paused = false;
            if (this.finished) {
                /*
                this.results.forEach((state, i) => {
                    if(this.results[i] == -2){
                        this.results[i] = -1
                    } else if(this.results[i] == 2){
                        this.results[i] = 1
                    }
                })
                */
                this.intents = [];
                this.results = [];
                this.states = [];
                this.started = false;
                this.finished = false;
                this.start();
            }
            else {
                if (this.started) {
                    this.emit('resume');
                }
                else {
                    this.start();
                }
            }
            this.stats();
        }
    }
    active() {
        return !this.paused && !this.finished && !this.destroyed;
    }
    abort() {
        if (this.opts.debug) {
            console.log('tuner abort');
        }
        if (!this.aborted) {
            this.aborted = true;
            if (!this.destroyed && !this.finished) {
                this.emit('abort');
            }
            this.finish();
        }
    }
    finish() {
        console.error('TUNER FINISH');
        if (!this.finished) {
            if (!this.aborted && !this.destroyed) {
                this.pump();
            }
            this.pause();
            this.finished = true;
            if (!this.aborted && !this.destroyed) {
                this.emit('finish');
            }
        }
    }
    destroy() {
        if (!this.destroyed) {
            this.destroyed = true;
            this.emit('destroy');
            this.abort();
            this.removeAllListeners();
        }
    }
}
class Tuner extends TunerTask {
    constructor(entries, opts, name) {
        super(entries, opts, name);
        this.entries = entries;
        this.started = false;
        this.on('resume', this.pump.bind(this));
    }
    async start() {
        if (this.started)
            return;
        this.paused = false;
        this.started = true;
        if (this.opts.debug) {
            console.log('TUNER STARTED');
        }
        this.stats();
        const limit = pLimit(config.get('tune-concurrency'));
        const tasks = new Array(this.entries.length).fill(this.task.bind(this)).map(limit);
        const ret = await Promise.allSettled(tasks);
        if (this.opts.debug) {
            console.log('TUNER FINISHED', ret);
        }
        this.finish();
    }
    getStats() {
        let stats = {
            failures: 0,
            successes: 0,
            total: this.entries.length
        };
        this.results.forEach((v, i) => {
            switch (v) {
                case -1:
                case -2:
                    stats.failures++;
                    break;
                case 1:
                case 2:
                    stats.successes++;
                    return true;
                    break;
            }
        });
        stats.processed = stats.successes + stats.failures;
        stats.progress = parseInt(stats.processed / (stats.total / 100));
        if (stats.progress > 99) {
            stats.progress = 99;
        }
        return stats;
    }
    stats() {
        if (this.active() && this.listenerCount('progress') > 0) {
            const stats = this.getStats();
            if (stats.progress !== this.lastProgress) {
                this.lastProgress = stats.progress;
                this.emit('progress', stats);
            }
        }
    }
    pump() {
        if (this.active()) {
            let changed, speed = 0, succeed = -1;
            this.results.forEach((v, i) => {
                switch (v) {
                    case -1:
                        this.results[i] = -2;
                        this.emit('failure', this.entries[i]);
                        if (!changed) {
                            changed = true;
                        }
                        break;
                    case 1:
                        if (succeed == -1 || speed < this.info[i].speed) {
                            speed = this.info[i].speed;
                            succeed = i;
                        }
                        break;
                }
            });
            if (succeed >= 0) {
                this.results[succeed] = 2;
                this.emit('success', this.entries[succeed], this.info[succeed], succeed);
                if (!changed) {
                    changed = true;
                }
            }
            if (changed) {
                this.emit('update');
                this.stats();
            }
        }
        if (this.paused) {
            return true;
        }
    }
}
export default Tuner;
