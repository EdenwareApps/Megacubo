import { EventEmitter } from 'node:events';

class StreamResponse extends EventEmitter {
    constructor(statusCode, headers) {
        super();
        this.statusCode = statusCode;
        this.headers = headers;
    }
    write(chunk) {
        this.emit('data', chunk);
    }
    emitError(error) {
        this.error = error;
        this.listenerCount('error') && this.emit('error', error);
        this.end();
    }
    end() {
        this.destroy();
    }
    destroy() {
        if (this.ended !== true) {
            this.ended = true;
            this.emit('end');
        }
        if (this.destroyed !== true) {
            this.destroyed = true;
            this.emit('destroy');
            this.removeAllListeners();
        }
    }
}

class Stream extends EventEmitter {
    constructor(opts) {
        super();
        this.setMaxListeners(20);
        this.uid = parseInt(Math.random() * 1000000);
        this.opts = opts;
        this.timeout = opts.timeout;
        this.headersSent = false;
        this.on('end', () => {
            this.response && this.response.end();
        });
        if (!this.opts.uid) {
            this.opts.uid = parseInt(Math.random() * 10000000000000);
        }
        process.nextTick(() => {
            this.start().catch(err => this.emitError(err));
        });
    }
    extractMaxAge(headers) {
        if (typeof(headers['cache-control']) != 'undefined') {
            const match = headers['cache-control'].match(new RegExp('age=([0-9]+)'));
            if (match) {
                return parseInt(match[1]);
            }
        }
        return false;
    }
    setTimeout(ms) {
        this.timeoutTimer && clearTimeout(this.timeoutTimer);
        this.timeoutTimer = setTimeout(() => {
            if (!this.ended) {
                this.emitError('timeouted');
            }
        }, ms);
    }
    emitError(error) {
        this.error = error;
        this.listenerCount('error') && this.emit('error', error);
        this.destroy();
    }
    end() {
        this.destroyed || this.destroy();
    }
    close() {
        this.destroyed || this.destroy();
    }
    destroy() {
        if (!this.ended) {
            this.ended = true;
            this.emit('end');
        }
        if (!this.destroyed) {
            this.destroyed = true;
            this.emit('destroy');
            this.removeAllListeners();
        }
    }
}
Stream.Response = StreamResponse;
export default Stream;
