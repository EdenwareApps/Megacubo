import stream from "stream";
import fs from "fs";

// wrapper around fs.createReadStream to prevent fatal errors when file is deleted before opening
const { Readable } = stream;
class Reader extends Readable {
    constructor(file, opts = {}) {
        super(opts);
        this.file = file;
        this.opts = opts;
        this.fd = null;
        this.bytesRead = 0;
        if (typeof(this.opts.start) == 'undefined')
            this.opts.start = 0;
        if (!this.file)
            throw 'Reader initialized with no file specified';
        process.nextTick(() => this.openFile());
    }
    _read(size) {
        clearTimeout(this.nextReadTimer);
        if (this.isPaused()) {
            this.once('resume', () => this._read(size));
            return;
        }
        if (this.fd === null) {
            this.once('open', () => this._read(size));
            return;
        }
        if (this._isReading) {
            return;
        }
        if (this.isClosed) {
            this.close();
            this.push(null);
            return;
        }
        const remainingBytes = this.end !== undefined ? (this.end - this.bytesRead) : undefined;
        if (remainingBytes !== undefined && remainingBytes <= 0) {
            this.close();
            this.push(null);
            return;
        }
        const position = this.opts.start + this.bytesRead;
        this._isReading = true;
        fs.fstat(this.fd, (err, stat) => {
            if (err) {
                console.error('READER ERROR: ' + err);
                this.emit('error', err);
                return this.close();
            }
            const available = stat.size - position;
            const readSize = typeof(size) == 'number' ? Math.min(size, available) : available;
            const done = () => {
                if (this.opts.persistent === true) {
                    this.nextReadTimer = setTimeout(() => {
                        if (this.fd)
                            this._read();
                    }, 1000);
                } else {
                    this.close();
                    this.push(null);
                }
            };
            if (readSize < 0) {
                err = 'Readen more than the file size';
                console.error('READER ERROR: ' + err);
                return this.close();
            } else if (readSize == 0 || this.fd === null) {
                return done();
            }
            const buffer = Buffer.alloc(readSize);
            fs.read(this.fd, buffer, 0, readSize, position, (err, bytesRead) => {
                const readen = bytesRead && bytesRead > 0;
                if (readen) {
                    this.bytesRead += bytesRead;
                    this.push(buffer.slice(0, bytesRead));
                }
                this._isReading = false;
                if (err) {
                    console.error('READER ERROR: ' + err);
                    this.emit('error', err);
                    this.close();
                } else if (!readen) {
                    done();
                }
            });
        });
    }
    async openFile() {
        try {
            this.fileHandle = await fs.promises.open(this.file, 'r');
            this.fd = this.fileHandle.fd;
            this.emit('open')
        } catch (err) {
            console.error('Error opening file:', err);
            this.emitError(err);
        }
    }
    emitError(err) {
        this.listenerCount('error') && this.emit('error', err);
        this.close();
    }
    endPersistence() {
        this.opts.persistent = false;
    }
    close() {
        if (!this.isClosed || this.fd) { // Cannot set property closed of #<Readable> which has only a getter		
            this.isClosed = true
            const done = () => {
                this.emit('finish')
                this.emit('close')
                this.destroy()
            }
            if (this.fd !== null) {            
                this.fileHandle.close().then(err => {
                    if (err) {
                        console.error('Failed to close Reader file descriptor: ' + err)
                    }
                    done()
                }).catch(err => {
                    console.error('Failed to close Reader file descriptor: ' + err)
                    done()
                }).finally(() => {
                    this.fd = null
                    this.fileHandle = null
                })
            } else {
                done()
            }
        }
    }
}
export default Reader;
