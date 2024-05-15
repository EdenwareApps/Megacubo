import StreamerBaseIntent from "./base.js";
import downloads from "../../downloads/downloads.js";
import { isPacketized } from "../../utils/utils.js";
        
class StreamerVODTSIntent extends StreamerBaseIntent {
    constructor(data, opts, info) {
        console.log('TSOPTS', opts);
        Object.assign(opts, {
            audioCodec: 'copy'
        });
        super(data, opts, info);
        this.type = 'vodts';
        this.mimetype = this.mimeTypes.ts;
        this.mediaType = 'video';
    }
    _start() {
        return new Promise((resolve, reject) => {
            this.mimetype = this.mimeTypes.mpegts;
            const isLocalFile = this.info && this.info.isLocalFile;
            if (isLocalFile) {
                downloads.serve(this.info.url || this.data.url, false, false).then(url => {
                    this.endpoint = url;
                    resolve();
                }).catch(reject);
            } else {
                this.endpoint = this.info.url || this.data.url;
                resolve();
            }
        });
    }
}
StreamerVODTSIntent.mediaType = 'video';
StreamerVODTSIntent.supports = info => {
    if (info.ext && ['mp4', 'ts', 'mts', 'm2ts'].includes(info.ext)) { // mp4 files have been seen with video/mp2t contentType
        if (info.sample && isPacketized(info.sample)) {
            return true;
        }
    }
    return false;
};
export default StreamerVODTSIntent;
