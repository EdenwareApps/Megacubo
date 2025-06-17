import Download from '../../download/download.js'
import StreamerHLSIntent from './hls.js';
import ytdl from '@distube/ytdl-core';
import StreamerProxy from '../utils/proxy.js';
import StreamerHLSProxy from '../utils/proxy-hls.js';
import downloads from '../../downloads/downloads.js';
import fs from 'fs';
import config from '../../config/config.js'
import paths from '../../paths/paths.js';
import { getDomain } from '../../utils/utils.js';

const YTDomainRegex = new RegExp('^(youtu\\.be|youtube\\.com|[a-z]{1,6}\\.youtube\\.com)$');
const YTIDRegex = new RegExp('(v=|/v/|/embed/|/shorts/|\\.be/)([A-Za-z0-9\\-_]+)');

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
                body += ',RESOLUTION=' + resolutionMap[track.qualityLabel];
            }
            body += "\r\n" + track.url + "\r\n";
        });

        return body;
    }

    async getYTInfo(id) {
        let info, err, retries = 5, url = 'https://www.youtube.com/watch?v=' + id;
        
        const requestOptions = {
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        };

        while ((!info || !info.formats) && retries) {
            retries--;
            info = await ytdl.getInfo(url, { requestOptions })
                .catch(e => {
                    console.error(e);
                    if (String(e).match(/Status code: 4/)) retries = 0;
                    err = e;
                });
        }

        if (!info) throw err;
        return info;
    }

    validateTrackConnectivity(url) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            const stream = new Download({ url });
            
            stream.on('response', (status, headers) => {
                resolved = true;
                status >= 200 && status < 400 ? resolve(true) : reject(`bad status ${status}`);
                stream.destroy();
            });

            stream.once('end', () => {
                if (!resolved) reject('unreachable');
            });

            stream.start();
        });
    }

    async selectTrackBW(tracks, bandwidth) {
        let chosen, chosenBandwidth, chosenMimeType;

        tracks.sortByProp('bitrate').some((track, i) => {
            if (!chosen || (!bandwidth && i === 1) || (track.bitrate <= bandwidth)) {
                chosen = track.url;
                chosenMimeType = track.mimeType;
                chosenBandwidth = track.bitrate;
            }
            return track.bitrate > bandwidth;
        });

        const valid = await this.validateTrackConnectivity(chosen).catch(err => console.error(err));
        if (valid !== true) {
            const filtered = tracks.filter(t => t.url !== chosen);
            if (filtered.length) return this.selectTrackBW(filtered, bandwidth);
            throw 'no valid track';
        }

        this.prx?.bitrateChecker?.reset(chosenBandwidth);
        return { 
            url: chosen, 
            mimetype: chosenMimeType, 
            bandwidth: chosenBandwidth 
        };
    }

    async _startVideo(info) {
        this.mimetype = this.mimeTypes.video;
        this.mediaType = 'video';
        
        info.formats = info.formats.filter(fmt => 
            fmt.hasAudio && fmt.hasVideo && !fmt.isDashMPD
        );

        let ret = await this.selectTrackBW(
            info.formats, 
            global.streamer?.downlink
        );

        this.mimetype = ret.mimetype;
        this.prx = new StreamerProxy({...this.opts});
        this.connectAdapter(this.prx);
        await this.prx.start();
        
        this.endpoint = this.prx.proxify(ret.url);
        return { 
            endpoint: this.endpoint, 
            mimetype: this.mimetype 
        };
    }

    async _start() {
        const matches = this.data.url.match(YTIDRegex);
        if (!matches?.[2]) throw 'Bad YT URL';

        let info = await this.getYTInfo(matches[2]);
        this.data.name = info.videoDetails.title;

        let tracks = info.formats
            .filter(s => s.isHLS && (s.hasVideo || s.hasAudio))
            .map(s => ({
                ...s,
                url: this.prx?.proxify(s.url) || s.url
            }));

        if (!tracks.length) return this._startVideo(info);

        const mw = config.get('hls-prefetching');
        this.prx = new (mw ? StreamerHLSProxy : StreamerProxy)({...this.opts});
        this.connectAdapter(this.prx);
        await this.prx.start();

        const { temp } = paths;
        let file = `${temp}/master.m3u8`;
        
        await fs.promises.writeFile(file, this.generateMasterPlaylist(tracks));
        let url = await downloads.serve(file);
        
        this.endpoint = this.prx.proxify(url);
        return { 
            endpoint: this.endpoint, 
            mimetype: this.mimetype 
        };
    }
}

StreamerYTHLSIntent.mediaType = 'live';
StreamerYTHLSIntent.supports = info => YTDomainRegex.test(getDomain(info.url));

export default StreamerYTHLSIntent;