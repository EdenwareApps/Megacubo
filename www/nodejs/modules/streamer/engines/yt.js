import Download from '../../download/download.js'
import StreamerHLSIntent from "./hls.js";
import ytdl from "ytdl-core";
import StreamerProxy from "../utils/proxy.js";
import StreamerHLSProxy from "../utils/proxy-hls.js";
import downloads from "../../downloads/downloads.js";
import fs from "fs";
import config from "../../config/config.js"
import paths from "../../paths/paths.js";
import { ext, getDomain } from "../../utils/utils.js";

const YTDomainRegex = new RegExp('youtube\.com|youtu\.be');
const YTIDRegex = new RegExp('(v=|/v/|/embed/|\.be/)([A-Za-z0-9\-_]+)');
class StreamerYTHLSIntent extends StreamerHLSIntent {
    constructor(data, opts, info) {
        super(data, opts, info);
        this.type = 'yt';
        this.mimetype = this.mimeTypes.hls;
        this.mediaType = 'live';
    }
    generateMasterPlaylist(tracks) {
        let resolutionMap = {
            '144p': '256x144',
            '240p': '426x240',
            '360p': '640x360',
            '480p': '854x480',
            '720p': '1280x720',
            '1080p': '1920x1080',
            '1440p': '2560x1440'
        };
        let body = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-INDEPENDENT-SEGMENTS
`;
        tracks.map(track => {
            body += '#EXT-X-STREAM-INF:BANDWIDTH=' + track.bitrate + ',AVERAGE-BANDWIDTH=' + track.bitrate;
            if (resolutionMap[track.qualityLabel]) {
                +',RESOLUTION=' + resolutionMap[track.qualityLabel];
            }
            body += "\r\n" + track.url + "\r\n";
        });
        console.warn(body, tracks);
        return body;
    }
    async getYTInfo(id) {
        let info, err, retries = 5, url = 'https://www.youtube.com/watch?v=' + id;
        while ((!info || !info.formats) && retries) {
            retries--;
            console.warn('TRY', (Date.now() / 1000));
            info = await ytdl.getInfo(url, {
                requestOptions: {
                    rejectUnauthorized: false,
                    transform: (parsed) => {
                        return Object.assign(parsed, {
                            rejectUnauthorized: false
                        });
                    }
                }
            }).catch(e => {
                console.error(err);
                if (String(err).match(new RegExp('Status code: 4'))) { // permanent error, like 410
                    retries = 0;
                }
                err = e;
            });
        }
        if (!info)
            throw err;
        return info;
    }
    validateTrackConnectivity(url) {
        return new Promise((resolve, reject) => {
            let resolved;
            console.log('validateTrackConnectivity', url);
            const stream = new Download({ url });
            stream.on('response', (status, headers) => {
                console.log('validateTrackConnectivity', url, status, headers);
                resolved = true;
                if (status >= 200 && status < 400) {
                    resolve(true);
                } else {
                    reject('bad status ' + status);
                }
                stream.destroy();
            });
            stream.once('end', () => {
                if (!resolved) {
                    console.log('validateTrackConnectivity', url, stream);
                    reject('unreachable');
                }
            });
            stream.start();
        });
    }
    async selectTrackBW(tracks, bandwidth) {
        let chosen, chosenBandwidth, chosenMimeType;
        tracks.sortByProp('bitrate').some((track, i) => {
            if (!chosen) {
                chosen = track.url;
                chosenMimeType = track.mimeType;
                chosenBandwidth = track.bitrate;
            } else {
                if (!bandwidth || track.bitrate <= bandwidth) {
                    chosen = track.url;
                    chosenMimeType = track.mimeType;
                    chosenBandwidth = track.bitrate;
                    if (!bandwidth && i == 1) { // if we don't know the connection speed yet, use the #1 to skip a possible audio track
                        return true;
                    }
                } else {
                    return true; // to break
                }
            }
        });
        const valid = await this.validateTrackConnectivity(chosen).catch(console.error);
        if (valid !== true) {
            tracks = tracks.filter(t => t.url != chosen);
            if (tracks.length) {
                return await this.selectTrackBW(tracks, bandwidth);
            } else {
                throw 'no valid track';
            }
        }
        chosenBandwidth && this.prx && this.prx.bitrateChecker.reset(chosenBandwidth);
        return { url: chosen, mimetype: chosenMimeType, bandwidth: chosenBandwidth };
    }
    async _startVideo(info) {
        this.mimetype = this.mimeTypes.video;
        this.mediaType = 'video';
        info.formats = info.formats.filter(fmt => {
            return fmt.hasAudio && fmt.hasVideo && !fmt.isDashMPD;
        })
        let ret = await this.selectTrackBW(info.formats, global.streamer ? global.streamer.downlink : undefined);
        this.mimetype = ret.mimetype;
        this.prx = new StreamerProxy(Object.assign({}, this.opts));
        this.connectAdapter(this.prx);
        await this.prx.start();
        this.endpoint = this.prx.proxify(ret.url);
        return { endpoint: this.endpoint, mimetype: this.mimetype };
    }
    async _start() {
        const matches = this.data.url.match(YTIDRegex);
        if (!matches || !matches.length)
            throw 'Bad yt url';
        let info = await this.getYTInfo(matches[2]);
        this.data.name = info.videoDetails.title;
        let tracks = info.formats.filter(s => s.isHLS).filter(s => s.hasVideo || s.hasAudio);
        if (!tracks.length) {
            return this._startVideo(info);
        }
        const mw = config.get('hls-prefetching');
        this.prx = new (mw ? StreamerHLSProxy : StreamerProxy)(Object.assign({}, this.opts));
        this.connectAdapter(this.prx);
        await this.prx.start();
        tracks = tracks.map(s => {
            s.url = this.prx.proxify(s.url);
            return s;
        });
        const { temp } = paths;
        let file = temp + '/master.m3u8';
        await fs.promises.writeFile(file, this.generateMasterPlaylist(tracks));
        let url = await downloads.serve(file);
        this.endpoint = this.prx.proxify(url); // proxify again to get tracks on super()
        return { endpoint: this.endpoint, mimetype: this.mimetype };
    }
}
StreamerYTHLSIntent.mediaType = 'live';
StreamerYTHLSIntent.supports = info => {
    if (info.url && getDomain(info.url).match(YTDomainRegex)) {
        return true;
    }
    return false;
};
export default StreamerYTHLSIntent;
