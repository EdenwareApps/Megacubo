import StreamerBaseIntent from "./base.js";
import StreamerAdapterAAC from "../adapters/aac.js";
import StreamerFFmpeg from "../utils/ffmpeg.js";
class StreamerAACIntent extends StreamerBaseIntent {
    constructor(data, opts, info) {
        console.log('AACOPTS', opts);
        Object.assign(opts, {
            audioCodec: null,
            videoCodec: null
        });
        super(data, opts, info);
        this.type = 'aac';
        this.mediaType = 'audio';
        this.mimetype = this.mimeTypes.hls;
    }
    _start() {
        return new Promise((resolve, reject) => {
            this.downloader = new StreamerAdapterAAC(this.info.url || this.data.url, this.opts);
            this.connectAdapter(this.downloader);
            this.downloader.start().then(() => {
                this.decoder = new StreamerFFmpeg(this.downloader.source.endpoint, this.opts);
                this.decoder.opts.audioCodec = this.opts.audioCodec;
                this.connectAdapter(this.decoder);
                this.decoder.start().then(() => {
                    this.mimetype = this.mimeTypes[this.decoder.opts.outputFormat];
                    this.endpoint = this.decoder.endpoint;
                    resolve({ endpoint: this.endpoint, mimetype: this.mimetype });
                }).catch(reject);
            }).catch(reject);
        });
    }
}
StreamerAACIntent.mediaType = 'audio';
StreamerAACIntent.supports = info => {
    if (info.contentType) {
        let c = info.contentType;
        if (c.includes('audio/') && !c.includes('mpegurl')) {
            return true
        }
    }
    if (info.ext && ['aac', 'ogg', 'mp3', 'm4a', 'flac'].includes(info.ext)) {
        return true
    }
    return false
};
export default StreamerAACIntent
