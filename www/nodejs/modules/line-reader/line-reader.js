import { EventEmitter } from 'events';
import { Writable } from "stream";

class LineEmitter extends Writable {
    constructor(options = {}) {
        super(options);
        this.buffer = '';
        this.bufferSize = 1024 * 64;
    }
    _write(chunk, encoding, callback) {
        this.buffer += chunk;
        if (this.buffer.length > this.bufferSize)
            this.emitLines();
        callback();
    }
    _final(callback) {
        this.emitLines(true);
        this.emit('close');
        callback();
    }
    emitLines(final) {
        const nl = "\n", r = "\r";
        let startIndex = 0;
        let lineIndex;
        while ((lineIndex = this.buffer.indexOf(nl, startIndex)) !== -1) {
            let line = this.buffer.substring(startIndex, this.buffer[lineIndex - 1] === r ? (lineIndex - 1) : lineIndex);
            this.emit('line', line);
            startIndex = lineIndex + 1;
        }
        if (final) {
            this.emit('line', this.buffer.substring(startIndex));
        } else {
            this.buffer = this.buffer.substring(startIndex);
        }
    }
}
class LineReader extends EventEmitter {
    constructor(opts = {}) {
        super();
        this.readOffset = 0;
        this.liner = null;
        this.opts = opts;
        if (!this.opts.stream)
            throw 'LineReader initialized with no stream specified';
        this.start();
    }
    start() {
        this.liner = new LineEmitter();
        this.liner.on('line', line => this.emit('line', line));
        this.liner.once('close', () => this.close());
        this.liner.on('finish', () => this.close());
        this.opts.stream.on('error', err => {
            console.error(err);
            this.listenerCount('error') && this.emit('error', err);
        });
        this.opts.stream.on('data', chunk => this.liner.write(chunk));
        this.opts.stream.once('close', () => this.end());
    }
    end() {
        this.liner && this.liner.end();
    }
    close() {
        this.end();
        this.emit('close');
        this.emit('finish');
        this.destroy();
    }
    destroy() {
        this.destroyed = true;
        this.opts.stream && this.opts.stream.close();
        this.liner && this.liner.destroy();
        this.removeAllListeners();
    }
}
export default LineReader;
