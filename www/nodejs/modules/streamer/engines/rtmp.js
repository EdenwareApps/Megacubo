import StreamerBaseIntent from "./base.js";
import StreamerFFmpeg from "../utils/ffmpeg.js";
import paths from '../../paths/paths.js'

class StreamerRTMPIntent extends StreamerBaseIntent {
    constructor(data, opts, info) {
        console.log('RTMPOPTS', opts);
        let audioCodec = 'copy';
        let videoCodec = paths.android ?
            'copy' :
            'libx264'; // rtmp can get flickering on HTML5 without transcode
        Object.assign(opts, { audioCodec, videoCodec });
        super(data, opts, info);
        this.type = 'rtmp';
        this.mimetype = this.mimeTypes.hls;
        this.mediaType = 'live';
    }
    _start() {
        return new Promise((resolve, reject) => {
            this.rtmp2hls = new StreamerFFmpeg(this.info.url || this.data.url, this.opts);
            this.mimetype = this.mimeTypes[this.rtmp2hls.opts.outputFormat];
            this.connectAdapter(this.rtmp2hls);
            this.rtmp2hls.audioCodec = this.opts.audioCodec;
            this.rtmp2hls.start().then(() => {
                this.endpoint = this.rtmp2hls.endpoint;
                resolve({ endpoint: this.endpoint, mimetype: this.mimetype });
            }).catch(reject);
        });
    }
}
StreamerRTMPIntent.mediaType = 'live';
StreamerRTMPIntent.supports = info => {
    if (info.url && info.url.match(new RegExp('^(udp|mmsh?|rt[sm]?p)[a-z]*://', 'i'))) {
        return true;
    }
    if (info.contentType) {
        if (info.contentType.toLowerCase() == 'application/octet-stream' && !['ts', 'aac', 'm3u8', 'mpd', 'mkv', 'ogg', 'ogv', 'mp4'].includes(info.ext)) {
            return true;
        }
    }
    return false;
};
export default StreamerRTMPIntent;
