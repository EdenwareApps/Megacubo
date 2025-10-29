import { EventEmitter } from 'node:events';
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
        // Substituir todos os caracteres de controle por quebras de linha
        this.buffer = this.buffer.replace(/[\x00-\x1f\x7f-\x9f]/g, '\n');
        
        const nl = "\n";
        let startIndex = 0;
        let lineIndex;
        while ((lineIndex = this.buffer.indexOf(nl, startIndex)) !== -1) {
            let line = this.buffer.substring(startIndex, lineIndex);
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
        this.lineQueue = [];
        this.resolvers = [];
        this.ended = false;
        if (!this.opts.stream)
            throw 'LineReader initialized with no stream specified';
        this.start();
    }
    start() {
        this.liner = new LineEmitter();
        this.liner.on('line', line => {
            this.emit('line', line);
            // Add to queue for async iteration
            this.lineQueue.push(line);
            // Resolve waiting promises
            if (this.resolvers.length > 0) {
                const resolver = this.resolvers.shift();
                resolver({ value: line, done: false });
            }
        });
        this.liner.once('close', () => this.close());
        this.liner.on('finish', () => this.close());
        this.opts.stream.on('error', err => {
            console.error(err);
            this.listenerCount('error') && this.emit('error', err);
            // Reject waiting promises on error
            while (this.resolvers.length > 0) {
                const resolver = this.resolvers.shift();
                resolver({ value: undefined, done: true });
            }
        });
        this.opts.stream.on('data', chunk => this.liner.write(chunk));
        this.opts.stream.once('close', () => this.end());
        this.opts.stream.once('end', () => this.end());
    }
    end() {
        this.liner && this.liner.end();
    }
    close() {
        this.ended = true;
        this.end();
        this.emit('close');
        this.emit('finish');
        // Resolve all waiting promises when closing
        while (this.resolvers.length > 0) {
            const resolver = this.resolvers.shift();
            resolver({ value: undefined, done: true });
        }
        this.destroy();
    }
    destroy() {
        this.destroyed = true;
        if (this.opts.stream) {
            if (this.opts.stream.destroy) {
                this.opts.stream.destroy();
            } else {
                this.opts.stream.close();
            }
        }
        this.liner && this.liner.destroy();
        this.removeAllListeners();
    }
    
    // Async iterator for streaming consumption
    async *walk() {
        while (!this.ended && !this.destroyed) {
            // If we have queued lines, yield them first
            if (this.lineQueue.length > 0) {
                yield this.lineQueue.shift();
                continue;
            }
            
            // Wait for next line
            const result = await new Promise((resolve) => {
                this.resolvers.push(resolve);
            });
            
            if (result.done) {
                break;
            }
            
            yield result.value;
        }
    }
}
export default LineReader;
