import fs from 'fs';
import Reader from "../reader/reader.js";
import DownloadStreamBase from "./stream-base.js";
import cacheMap from "./download-cache.js";

class DownloadStreamCache extends DownloadStreamBase {
    constructor(opts) {
        super(opts);
        this.type = 'cache';
    }
    async start() {
        if (this.started) {
            throw 'Already started';
        }
        if (this.ended) {
            throw 'Already ended';
        }
        if (this.destroyed) {
            throw 'Already destroyed';
        }
        const url = this.opts.url
        const row = await cacheMap.info(url)
        if (!row || !row.status || row.dlid == this.opts.uid || row.file === undefined) {
            throw 'Not cached';
        }
        const stat = await fs.promises.stat(row.file).catch(() => null)
        if (!stat || !stat.size) throw 'Now cached *'
        let range;
        const headers = Object.assign({}, row.headers) || {};
        const source = headers['x-megacubo-dl-source'];
        headers['x-megacubo-dl-source'] = source ? 'cache-' + source : 'cache';
        if (this.opts.headers.range) {
            range = this.parseRange(this.opts.headers.range);
            if (!range.end && row.size) {
                range.end = row.size;
            }
            const total = row.type == 'saving' ? '*' : row.size;
            const end = range.end || (total == '*' ? '*' : row.size - 1);
            if (range.start > row.processed)
                throw 'Range not satisfiable';
            headers['content-range'] = 'bytes=' + range.start + '-' + end + '/' + total;
        }
        headers['x-megacubo-dl-source'] += '-' + row.type;
        this.response = new DownloadStreamBase.Response(range ? 206 : 200, headers);
        this.emit('response', this.response);
        let stream, bytesRead = 0;
        if (row.chunks) {
            stream = row.chunks.createReadStream(range);
        } else {
            try {
                stream = new Reader(row.file, range);
            }
            catch (e) {
                return this.emitError('Cache download failed*', false);
            }
        }
        stream.on('error', err => {
            this.response.listenerCount('error') && this.response.emit('error', err);
            this.end();
        });
        stream.on('data', chunk => {
            bytesRead += chunk.length;
            this.response.write(chunk);
        });
        stream.once('close', () => {
            this.end();
        });
        return true;
    }
}
export default DownloadStreamCache;
