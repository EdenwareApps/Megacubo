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
        this.workerListenersSetup = false;
        this.on('bitrate', bitrate => {
            if (bitrate > this.workerMessageBufferSize) {
                this.workerMessageBufferSize = bitrate;
            }
        });
        this.usingWorker = config.get('mpegts-use-worker');
        // Configure processor for live streams (TS streams are typically live)
        const isLive = opts.isLive !== false && (opts.mediaType === 'live' || opts.mediaType !== 'video');
        // Store listener functions so we can remove them later
        this.processorDataListener = (data) => (data && this.output(data));
        this.processorFailListener = () => this.emit('fail');
        
        if (this.usingWorker) {
            const workerPath = path.join(paths.cwd + '/modules/streamer/utils/mpegts-processor-worker.js')
            this.worker = new MultiWorker()
            this.processor = this.worker.load(workerPath, true)
            
            // Wait for worker to be ready before setting up event listeners
            this.setupWorkerEventListeners().then(() => {
                // Configure processor for live streams
                if (isLive && this.processor && typeof this.processor.setLive === 'function') {
                    this.processor.setLive(true).catch(err => console.error('Error setting live mode on worker processor:', err));
                }
                // Only add listeners after worker is confirmed ready and prevent duplicates
                if (!this.workerListenersSetup && this.processor && typeof this.processor.on === 'function') {
                    this.processor.on('data', this.processorDataListener);
                    this.processor.on('fail', this.processorFailListener);
                    this.workerListenersSetup = true;
                }
            }).catch(err => {
                console.error('Failed to setup worker listeners:', err)
                // Configure processor for live streams even if setup failed
                if (isLive && this.processor && typeof this.processor.setLive === 'function') {
                    this.processor.setLive(true).catch(e => console.error('Error setting live mode on worker processor:', e));
                }
                // Fallback: try to add listeners anyway if processor exists
                if (!this.workerListenersSetup && this.processor && typeof this.processor.on === 'function') {
                    this.processor.on('data', this.processorDataListener);
                    this.processor.on('fail', this.processorFailListener);
                    this.workerListenersSetup = true;
                }
            })
            
            this.once('destroy', () => {
                const done = () => {
                    if (this.worker && this.worker.terminate) {
                        this.worker.terminate();
                        this.worker = null;
                    }
                }
                if (this.processor) {
                    // Remove listeners before terminating (EventEmitter supports both off() and removeListener())
                    if (this.workerListenersSetup && (this.processor.off || this.processor.removeListener)) {
                        try {
                            const removeListener = this.processor.off || this.processor.removeListener;
                            if (this.processorDataListener) {
                                removeListener.call(this.processor, 'data', this.processorDataListener);
                            }
                            if (this.processorFailListener) {
                                removeListener.call(this.processor, 'fail', this.processorFailListener);
                            }
                        } catch (e) {
                            console.error('Error removing processor listeners:', e);
                        }
                    }
                    this.processor.terminate().catch(err => console.error(err)).finally(done)
                } else {
                    done();
                }
            });
        } else {
            this.processor = new MPEGTSProcessor();
            // Configure processor for live streams (TS streams are typically live)
            const isLive = opts.isLive !== false && (opts.mediaType === 'live' || opts.mediaType !== 'video');
            if (isLive) {
                this.processor.setLive(true);
            }
            // Use stored listener functions
            this.processor.on('data', this.processorDataListener);
            this.processor.on('fail', this.processorFailListener);
            this.once('destroy', () => {
                if (this.processor) {
                    // Remove listeners before terminating (EventEmitter supports both off() and removeListener())
                    const removeListener = this.processor.off || this.processor.removeListener;
                    if (removeListener) {
                        try {
                            if (this.processorDataListener) {
                                removeListener.call(this.processor, 'data', this.processorDataListener);
                            }
                            if (this.processorFailListener) {
                                removeListener.call(this.processor, 'fail', this.processorFailListener);
                            }
                        } catch (e) {
                            console.error('Error removing processor listeners:', e);
                        }
                    }
                    this.processor.terminate().catch(err => console.error(err));
                    this.processor = null;
                }
            });
        }
    }

    setupWorkerEventListeners() {
        if (this.usingWorker && this.worker) {
            // Use a Promise-based approach to wait for worker to be ready
            return this.waitForWorkerReady().then(() => {
                if (this.worker && this.worker.worker) {
                    this.worker.worker.on('exit', () => {
                        if (!this.destroyed && !this.joinerDestroyed) {
                            this.fail(-7)
                        }
                    })
                }
            }).catch(err => {
                console.error('Failed to setup worker event listeners:', err)
                throw err
            })
        }
        return Promise.resolve()
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
        if (!this.processor) {
            throw new Error('Processor not initialized')
        }
        if (this.usingWorker) {
            // Ensure worker is ready before calling
            try {
                await this.waitForWorkerReady()
                // Additional check: ensure processor proxy is ready
                if (this.worker && this.worker.workerReady && this.processor) {
                    return this.processor.setPacketFilterPolicy(policy).catch(err => {
                        console.error('setPacketFilterPolicy error (after ready):', err)
                        throw err
                    })
                } else {
                    // If worker not ready, queue the call but add timeout
                    console.warn('Worker not ready for setPacketFilterPolicy, attempting call anyway')
                    return Promise.race([
                        this.processor.setPacketFilterPolicy(policy),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('setPacketFilterPolicy timeout')), 5000))
                    ]).catch(err => {
                        console.error('setPacketFilterPolicy error:', err)
                        throw err
                    })
                }
            } catch (err) {
                console.error('Failed to wait for worker ready in setPacketFilterPolicy:', err)
                throw err
            }
        } else {
            return this.processor.setPacketFilterPolicy(policy)
        }
    }
    handleData(data) {
        if (!this.processor || this.destroyed || this.joinerDestroyed) return
        
        // CRITICAL: Prevent buffer overflow by limiting workerMessageBuffer size
        if (this.usingWorker) {
            // Check if buffer is getting too large (more than 5MB) and force flush
            const currentBufferSize = this.len(this.workerMessageBuffer);
            if (currentBufferSize > 5 * 1024 * 1024) {
                console.warn('Worker message buffer too large, forcing flush:', currentBufferSize);
                this.flush(true);
            }
            
            this.workerMessageBuffer.push(data);
            if (this.len(this.workerMessageBuffer) < this.workerMessageBufferSize) return
            data = Buffer.concat(this.workerMessageBuffer);
            this.workerMessageBuffer = [];
        }
        this.processor.push(data);
    }
    flush(force) {
        if (!this.processor || this.destroyed || this.joinerDestroyed) return
        
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
        if (this.destroyed || this.joinerDestroyed) {
            return;
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
        
        // CRITICAL: Clear worker message buffer to prevent memory leaks
        if (this.workerMessageBuffer && this.workerMessageBuffer.length > 0) {
            this.workerMessageBuffer = [];
        }
        
        if (!this.joinerDestroyed) {
            this.joinerDestroyed = true;
            if (this.processor) {
                // Remove listeners before destroying (EventEmitter supports both off() and removeListener())
                const removeListener = this.processor.off || this.processor.removeListener;
                if (removeListener && this.workerListenersSetup) {
                    try {
                        if (this.processorDataListener) {
                            removeListener.call(this.processor, 'data', this.processorDataListener);
                        }
                        if (this.processorFailListener) {
                            removeListener.call(this.processor, 'fail', this.processorFailListener);
                        }
                    } catch (e) {
                        console.error('Error removing processor listeners in destroy:', e);
                    }
                }
                try {
                    this.processor.destroy();
                } catch (e) {
                    console.error('Error destroying processor:', e);
                }
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
