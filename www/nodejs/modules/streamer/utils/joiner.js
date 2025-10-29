import Downloader from "./downloader.js";
import path from "path";
import MultiWorker from "../../multi-worker/multi-worker.js";
import MPEGTSProcessor from "./mpegts-processor.js";
import config from "../../config/config.js"
import paths from '../../paths/paths.js'

class Joiner extends Downloader {
    constructor(url, opts = {}) {
        opts.persistent = config.get('mpegts-persistent-connections');
        super(url, opts);
        this.minConnectionInterval = 1;
        this.type = 'joiner';
        this.delayUntil = 0;
        // when using worker avoid messaging overload, do some buffering
        this.workerMessageBuffer = [];
        this.workerMessageBufferSize = Math.max(this.bitrate || 0, 512 * 1024);
        this.on('bitrate', bitrate => {
            if (bitrate > this.workerMessageBufferSize) {
                this.workerMessageBufferSize = bitrate;
            }
        });
        this.usingWorker = config.get('mpegts-use-worker');
        if (this.usingWorker) {
            const workerPath = path.join(paths.cwd + '/modules/streamer/utils/mpegts-processor-worker.js')
            this.worker = new MultiWorker()
            this.processor = this.worker.load(workerPath, true)
            
            // Wait for worker to be ready before setting up event listeners
            this.setupWorkerEventListeners()
            
            this.once('destroy', () => {
                const done = () => this.worker && this.worker.terminate()
                if (this.processor) {
                    this.processor.terminate().catch(err => console.error(err)).finally(done)
                } else {
                    done();
                }
            });
        } else {
            this.processor = new MPEGTSProcessor();
            this.once('destroy', () => this.processor && this.processor.terminate().catch(err => console.error(err)));
        }
        this.processor.on('data', data => (data && this.output(data)));
        this.processor.on('fail', () => this.emit('fail'));
    }
    
    setupWorkerEventListeners() {
        if (this.usingWorker && this.worker) {
            // Use a Promise-based approach to wait for worker to be ready
            this.waitForWorkerReady().then(() => {
                if (this.worker && this.worker.worker) {
                    this.worker.worker.on('exit', () => this.fail(-7))
                }
            }).catch(err => {
                console.error('Failed to setup worker event listeners:', err)
            })
        }
    }
    
    waitForWorkerReady() {
        return new Promise((resolve, reject) => {
            if (this.worker && this.worker.workerReady && this.worker.worker) {
                // Worker is already ready
                resolve()
                return
            }
            
            if (this.worker && this.worker.finished) {
                reject(new Error('Worker was terminated before becoming ready'))
                return
            }
            
            // Listen for the worker-ready event
            const onReady = () => {
                this.worker.removeListener('worker-ready', onReady)
                this.worker.removeListener('error', onError)
                resolve()
            }
            
            const onError = (error) => {
                this.worker.removeListener('worker-ready', onReady)
                this.worker.removeListener('error', onError)
                reject(error)
            }
            
            this.worker.on('worker-ready', onReady)
            this.worker.on('error', onError)
        })
    }
    
    async setPacketFilterPolicy(policy) {
        return this.processor.setPacketFilterPolicy(policy)
    }
    handleData(data) {
        if (!this.processor) return
        if (this.usingWorker) {
            this.workerMessageBuffer.push(data);
            if (this.len(this.workerMessageBuffer) < this.workerMessageBufferSize) return
            data = Buffer.concat(this.workerMessageBuffer);
            this.workerMessageBuffer = [];
        }
        this.processor.push(data);
    }
    flush(force) {        
        if (!this.processor) return; // discard so
        if (this.usingWorker) {
            if (this.workerMessageBuffer.length > 0) {
                const data = Buffer.concat(this.workerMessageBuffer);
                this.workerMessageBuffer = []
                this.processor.push(data)
            }
        }
        this.processor.flush(force)
    }
    output(data, len) {
        if (this.destroyed || this.joinerDestroyed) {
            return;
        }
        if(typeof(data) == 'object') {
            data = Buffer.from(data)
        }
        if (typeof(len) != 'number') {
            len = this.len(data)
        }
        if (len) {
            if (this.bitrate) {
                this.delayUntil = this.lastConnectionEndTime + (len / this.bitrate) - this.connectTime;
            } else {
                this.delayUntil = 0;
            }
            super.output(data, len);
        }
    }
    pump() {
        if (this.opts.debug) {
            console.log('[' + this.type + '] pump', this.destroyed || this.joinerDestroyed);
        }
        this.download(() => {
            this.flush(true); // join prematurely to be ready for next connection anyway
            let now = (Date.now() / 1000), ms = 0;
            if (this.delayUntil && now < this.delayUntil) {
                ms = this.delayUntil - now;
                if (ms < 0) {
                    ms = 0;
                }
                ms = parseInt(ms * 1000);
            }
            const nextConnectionFrom = this.lastConnectionStartTime + this.minConnectionInterval;
            if (nextConnectionFrom > (now + (ms / 1000))) {
                ms = (nextConnectionFrom - now) * 1000;
            }
            if (this.opts.debug) {
                console.log('next connection after ' + parseInt(ms) + 'ms');
            }
            this.timer = setTimeout(this.pump.bind(this), ms); /* avoiding nested call to next pump to prevent mem leaking */
            if (this.opts.debug) {
                console.log('[' + this.type + '] delaying ' + ms + 'ms', 'now: ' + now, 'delayUntil: ' + this.delayUntil);
            }
        });
    }
    destroy() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (!this.joinerDestroyed) {
            this.joinerDestroyed = true;
            if (this.processor) {
                this.processor.destroy();
                this.processor = null;
            }
        }
        if (this.worker && this.worker.terminate) {
            this.worker.terminate();
            this.worker = null;
        }
        super.destroy && super.destroy();
    }
}
export default Joiner;
