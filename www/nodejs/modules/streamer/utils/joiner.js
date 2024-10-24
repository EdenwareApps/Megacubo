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
            this.worker.worker.on('exit', () => this.fail(-7))
            this.once('destroy', () => {
                const done = () => this.worker && this.worker.terminate()
                if (this.processor) {
                    this.processor.terminate().catch(console.error).finally(done)
                } else {
                    done();
                }
            });
        } else {
            this.processor = new MPEGTSProcessor();
            this.once('destroy', () => this.processor && this.processor.terminate().catch(console.error));
        }
        this.processor.on('data', data => (data && this.output(data)));
        this.processor.on('fail', () => this.emit('fail'));
        // this.opts.debug = this.processor.debug  = true
        this.once('destroy', () => {
            if (!this.joinerDestroyed) {
                this.joinerDestroyed = true
                this.processor.destroy();
                this.processor = null;
            }
        });
    }
    async setPacketFilterPolicy(policy) {
        return await this.processor.setPacketFilterPolicy(policy)
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
            const data = Buffer.concat(this.workerMessageBuffer);
            this.workerMessageBuffer = []
            this.processor.push(data)
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
}
export default Joiner;
