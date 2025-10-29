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
        if (this.fd === null || !this.fileHandle) {
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
        
        // Check if file descriptor is still valid before using it
        if (this.fd === null || !this.fileHandle) {
            this._isReading = false;
            this.emit('error', new Error('File descriptor is null'));
            this.close();
            return;
        }
        
        fs.fstat(this.fd, (err, stat) => {
            this._isReading = false;
            
            // Handle EBADF and other file descriptor errors gracefully
            if (err) {
                if (err.code === 'EBADF' || err.code === 'ENOENT') {
                    console.error('READER ERROR: File descriptor invalid or file not found:', err.message);
                    this.emit('error', err);
                    this.close();
                    return;
                }
                console.error('READER ERROR: ' + err);
                this.emit('error', err);
                this.close();
                return;
            }
            
            // Check again if file descriptor is still valid
            if (this.fd === null || !this.fileHandle || this.isClosed) {
                return;
            }
            
            const available = stat.size - position;
            const readSize = typeof(size) == 'number' ? Math.min(size, available) : available;
            const done = () => {
                if (this.opts.persistent === true && !this.isClosed) {
                    this.nextReadTimer = setTimeout(() => {
                        if (this.fd && !this.isClosed)
                            this._read();
                    }, 1000);
                } else {
                    this.close();
                    this.push(null);
                }
            };
            
            // FIXED: Add additional validation to prevent reading beyond file size
            if (position >= stat.size) {
                console.log(`READER: Position ${position} >= file size ${stat.size}, ending read`);
                return done();
            }
            if (readSize < 0) {
                console.error(`READER ERROR: Read more than the file size - position: ${position}, file size: ${stat.size}, available: ${available}, readSize: ${readSize}`);
                const err = new Error('Read more than the file size');
                this.emit('error', err);
                this.close();
                return;
            } else if (readSize == 0 || this.fd === null || this.isClosed) {
                return done();
            }
            
            const buffer = Buffer.alloc(readSize);
            this._isReading = true;
            fs.read(this.fd, buffer, 0, readSize, position, (err, bytesRead) => {
                this._isReading = false;
                
                // Handle EBADF and other file descriptor errors gracefully
                if (err) {
                    if (err.code === 'EBADF' || err.code === 'ENOENT') {
                        console.error('READER ERROR: File descriptor invalid during read:', err.message);
                        this.emit('error', err);
                        this.close();
                        return;
                    }
                    console.error('READER ERROR: ' + err);
                    this.emit('error', err);
                    this.close();
                    return;
                }
                
                const readen = bytesRead && bytesRead > 0;
                if (readen && !this.isClosed) {
                    // FIXED: Validate that we don't exceed file size when updating bytesRead
                    const newBytesRead = this.bytesRead + bytesRead;
                    if (newBytesRead <= stat.size) {
                        this.bytesRead = newBytesRead;
                        this.push(buffer.slice(0, bytesRead));
                    } else {
                        console.warn(`READER: Prevented bytesRead overflow - new: ${newBytesRead}, file size: ${stat.size}`);
                        this.bytesRead = stat.size;
                        this.push(buffer.slice(0, Math.max(0, stat.size - this.bytesRead + bytesRead)));
                    }
                }
                
                if (!readen) {
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
        if (!this.isClosed) { // Cannot set property closed of #<Readable> which has only a getter		
            this.isClosed = true
            clearTimeout(this.nextReadTimer)
            
            const done = () => {
                this.emit('finish')
                this.emit('close')
                this.destroy()
            }
            
            if (this.fd !== null && this.fileHandle) {            
                // Close file handle safely
                this.fileHandle.close().then(() => {
                    // File handle closed successfully
                }).catch(err => {
                    // Ignore EBADF errors when closing - file might already be closed
                    if (err.code !== 'EBADF') {
                        console.error('Failed to close Reader file descriptor:', err.message)
                    }
                }).finally(() => {
                    this.fd = null
                    this.fileHandle = null
                    done()
                })
            } else {
                // No file handle to close
                this.fd = null
                this.fileHandle = null
                done()
            }
        }
    }
}
export default Reader;
