import StreamerBaseIntent from "./base.js";
import downloads from "../../downloads/downloads.js";
import StreamerProxy from "../utils/proxy.js";
import config from "../../config/config.js"
import { isMPEGTSFromInfo, VIDEO_FORMATS } from "../utils/media-url-info.js";

class StreamerVideoIntent extends StreamerBaseIntent {
    constructor(data, opts, info) {
        super(data, opts, info);
        this.type = 'video';
        this.mediaType = 'video';
        if (this.info.contentType && this.info.contentType.includes('o/')) {
            this.mimetype = this.info.contentType;
        } else {
            this.mimetype = this.mimeTypes.video;
        }
    }
    _start() {
        return new Promise((resolve, reject) => {
            const isLocalFile = this.info && this.info.isLocalFile;
            const isLocalHost = this.data.url.startsWith('http://127.0.0.1'); // proxify https anyway to prevent SSL errors
            if (isLocalFile || isLocalHost) {
                this.endpoint = this.data.url;
                if (isLocalFile) {
                    downloads.serve(this.data.url, false, false).then(url => {
                        this.endpoint = url;
                        resolve();
                    }).catch(reject);
                } else { //  if is localhost URL, don't proxify
                    resolve();
                }
            } else {
                const adapter = new StreamerProxy(Object.assign({
                    authURL: this.data.authURL || this.data.source,
                    timeout: 30
                }, this.opts));
                adapter.bitrateChecker.opts.minCheckSize = 6 * (1024 * 1024);
                adapter.bitrateChecker.opts.maxCheckSize = 3 * adapter.bitrateChecker.opts.minCheckSize;
                adapter.bitrateChecker.opts.checkingAmount = 1;
                this.connectAdapter(adapter);
                adapter.start().then(() => {
                    this.endpoint = adapter.proxify(this.info.url || this.data.url);
                    resolve();
                }).catch(e => {
                    reject(e);
                });
            }
        });
    }
}
StreamerVideoIntent.mediaType = 'video';
StreamerVideoIntent.supports = info => {
    if(isMPEGTSFromInfo(info)) {
        return false;
    }
    if (info.isLocalFile) {
        return true;
    }
    if (VIDEO_FORMATS.includes(info.ext)) {
        return true;
    }
    if (info.contentType?.includes('video/') && (info.headers['content-length'] || info.headers['last-modified'])) {
        return true;
    }
    return false;
};
export default StreamerVideoIntent;
