import Download from '../../download/download.js'
import StreamerHLSIntent from './hls.js';
import { Innertube } from 'youtubei.js';
import StreamerProxy from '../utils/proxy.js';
import StreamerHLSProxy from '../utils/proxy-hls.js';
import config from '../../config/config.js'
import { getDomain } from '../../utils/utils.js';

const YTDomainRegex = new RegExp('^(youtu\\.be|youtube\\.com|[a-z]{1,6}\\.youtube\\.com)$');
const YTIDRegex = new RegExp('(v=|/v/|/embed/|/shorts/|\\.be/)([A-Za-z0-9\\-_]+)');

// Innertube sessions are expensive to create (~1-2s). Create once and reuse.
// The ANDROID client is the one that returns the HLS manifest URL for live
// streams (and a progressive audio+video format for VODs).
let innertubePromise = null;
function getInnertube() {
    if (!innertubePromise) {
        innertubePromise = Innertube.create({
            retrieve_player: true,
            enable_session_cache: false
        }).catch(err => {
            innertubePromise = null; // allow a fresh session on next call
            throw err;
        });
    }
    return innertubePromise;
}

class StreamerYTHLSIntent extends StreamerHLSIntent {
    constructor(data, opts, info) {
        super(data, opts, info);
        this.type = 'yt';
        this.mimetype = this.mimeTypes.hls;
        this.mediaType = 'live';
    }

    async getYouTubeInfo(id) {
        let lastErr;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const yt = await getInnertube();
                return await yt.getInfo(id, { client: 'ANDROID' });
            } catch (err) {
                lastErr = err;
                console.error(`[yt] getInfo attempt ${attempt + 1} failed:`, err?.message || err);
                innertubePromise = null; // force a fresh session next attempt
            }
        }
        throw lastErr;
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

        // Progressive formats carry audio+video in a single URL
        // (youtubei.js exposes them on streaming_data.formats).
        let formats = (info.streaming_data?.formats || [])
            .filter(fmt => fmt.has_video && fmt.has_audio && fmt.url)
            .map(fmt => ({
                url: fmt.url,
                mimeType: fmt.mime_type,
                bitrate: fmt.bitrate || fmt.average_bitrate || 0,
                qualityLabel: fmt.quality_label
            }));

        if (!formats.length) throw 'No playable YouTube format';

        let ret = await this.selectTrackBW(formats, global.streamer?.downlink);

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

        let info = await this.getYouTubeInfo(matches[2]);

        if (info.basic_info?.title) {
            this.data.name = info.basic_info.title;
        }
        if (info.playability_status?.status !== 'OK') {
            throw info.playability_status?.reason || `Not playable (${info.playability_status?.status})`;
        }

        // Live streams: the ANDROID client returns the HLS master URL directly.
        // Proxy it as-is — StreamerHLSProxy rewrites the child playlists and
        // enables adaptive quality switching (no custom master needed).
        const hlsUrl = info.streaming_data?.hls_manifest_url;
        if (hlsUrl) {
            this.mediaType = 'live';
            this.mimetype = this.mimeTypes.hls;

            const mw = config.get('hls-prefetching');
            this.prx = new (mw ? StreamerHLSProxy : StreamerProxy)({...this.opts});
            this.connectAdapter(this.prx);
            await this.prx.start();

            this.endpoint = this.prx.proxify(hlsUrl);
            return { 
                endpoint: this.endpoint, 
                mimetype: this.mimetype 
            };
        }

        // VOD / no HLS manifest: fall back to a progressive (audio+video) format
        return this._startVideo(info);
    }
}

StreamerYTHLSIntent.mediaType = 'live';
StreamerYTHLSIntent.supports = info => YTDomainRegex.test(getDomain(info.url));

export default StreamerYTHLSIntent;