import { isYT, isPacketized } from '../../utils/utils.js'

export const VIDEO_FORMATS = ['mp4', 'm4v', 'm4b', 'm4p', 'm4v', 'mkv', 'm4v', 'mov', 'flv', 'webm', 'ogv', 'avi', 'asf', 'divx', 'hevc'];
export const AUDIO_FORMATS = ['wma', 'mp3', 'mka', 'm4a', 'flac', 'aac', 'ogg', 'pls', 'nsv'];

class MediaStreamInfo {
    constructor() {
        this.extAsURLParam = new RegExp('[#&\\?]ext=([^&]+)');
        this.radioRegexA = new RegExp('r(aá|&aacute;)dio', 'i');
        this.radioRegexB = new RegExp('\\b[FA]M( |$)');
        this.protoRegexA = new RegExp('^([A-Za-z0-9]{2,6}):');
        this.protoRegexB = new RegExp('^//[^/]+\\.');
        this.seemsLiveRegex = new RegExp('(live|m3u)', 'i');
    }
    ext(url) {
        let parts = url.split('?')[0].split('#')[0].split('/').pop().split('.');
        if (parts.length > 1) {
            const ext = parts.pop();
            if (ext.length >= 2 && ext.length <= 4)
                return ext.toLowerCase();
        }
        if (url.includes('ext=')) {
            const m = url.match(this.extAsURLParam);
            if (m && m[1].length >= 2 && m[1].length <= 4)
                return m[1].toLowerCase();
        }
        return '';
    }
    proto(url, len) {
        var ret = '';
        if (url) {
            let res = url.match(this.protoRegexA);
            if (res) {
                ret = res[1];
            } else if (url.match(this.protoRegexB)) {
                ret = 'http';
            }
            if (ret && typeof(len) == 'number') {
                ret = ret.substr(0, len);
            }
        }
        return ret;
    }
    setM3UStreamFmt(url, fmt) {
        let badfmt, type;
        if (fmt == 'hls') {
            badfmt = new RegExp('(type|output)=(m3u|ts|mpegts)(&|$)', 'gi');
            type = 'hls';
        } else {
            badfmt = new RegExp('(type|output)=(m3u_plus|m3u8|hls)(&|$)', 'gi');
            type = 'ts';
        }
        let alturl = url.replace(badfmt, (...args) => {
            let t = args[2];
            switch (args[1]) {
                case 'output':
                    t = type;
                    break;
                case 'type':
                    t = 'm3u_plus';
                    break;
            }
            return args[1] + '=' + t + args[3];
        });
        if (alturl != url) {
            return alturl;
        }
    }
    mediaType(entry, def, ext) {
        if (!entry || typeof(entry) != 'object') {
            entry = {
                url: String(entry)
            };
        }
        if (entry.mediaType && entry.mediaType != -1) {
            return entry.mediaType;
        }
        if (!ext)
            ext = this.ext(entry.url);
        const proto = this.proto(entry.url);
        if (this.isLive(entry.url, ext, proto)) {
            return 'live';
        }
        if (this.isVideo(entry.url, ext, proto) || this.isAudio(entry.url, ext) || isYT(entry.url)) {
            return 'video';
        } else if (entry.url.match(this.seemsLiveRegex)) {
            return 'live';
        } else if (entry.url.includes('video')) {
            return 'video';
        } else {
            const name = entry.name + ' ' + (entry.group || '');
            if (this.isRadio(name)) {
                return 'live';
            }
        }
        return (def && typeof(def) == 'string') ? def : 'live'; // "live" by default
    }
    isM3U8(url, ext, headers) {
        if (!ext)
            ext = this.ext(url);
        if (ext == 'm3u8' || ext == 'm3u')
            return true;
        if (headers && headers['content-type'] && headers['content-type'].toLowerCase().includes('mpegurl'))
            return true;
        return false;
    }
    isLocalTS(url, ext, proto) {
        if (!ext) {
            ext = this.ext(url);
        }
        if (!proto) {
            proto = this.proto(url);
        }
        return ext == 'ts' && !this.isHTTP(url, proto);
    }
    isRemoteTS(url, ext, proto) {
        if (!ext) {
            ext = this.ext(url);
        }
        return ext == 'ts' && this.isHTTP(url, proto);
    }
    isHTTP(url, proto) {
        if (!proto) {
            proto = this.proto(url);
        }
        return ['https', 'http'].includes(proto);
    }
    isRTP(url, proto) {
        return ['mms', 'mmsh', 'mmst', 'rtp', 'rtsp', 'rtmp'].includes(this.proto(url, 4));
    }
    isVideo(url, ext, proto) {
        if (!url)
            return false;
        if (!ext)
            ext = this.ext(url);
        if (ext == 'ts') {
            if (!proto) {
                proto = this.proto(url);
            }
            return this.isLocalTS(url, ext, proto);
        } else {
            return VIDEO_FORMATS.includes(ext);
        }
    }
    isAudio(url, ext) {
        if (!ext) {
            ext = this.ext(url);
        }
        return AUDIO_FORMATS.includes(ext);
    }
    isRadio(name) {
        if (name.match(this.radioRegexA) || name.match(this.radioRegexB)) {
            return true;
        } else {
            return false;
        }
    }
    isLive(url, ext, proto) {
        if (!ext)
            ext = this.ext(url);
        if (!proto)
            proto = this.proto(url);
        return this.isM3U8(url, ext) || this.isRTP(url, proto) || this.isRemoteTS(url, ext, proto);
    }
}

const mediaTypeFromInfo = info => {
    const { headers } = info;
    let liveScore = 0;
    let vodScore = 0;

    const cacheControl = headers?.['cache-control']?.toLowerCase();
    if (cacheControl) {
        if (cacheControl.includes('no-cache')) liveScore += 1;
        if (cacheControl.includes('no-store')) liveScore += 1;
        if (cacheControl.includes('must-revalidate')) liveScore += 1;
        if (cacheControl.includes('max-age=0')) liveScore += 1;
        if (cacheControl.includes('s-maxage=0')) liveScore += 1;

        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        if (maxAgeMatch) {
            const maxAge = parseInt(maxAgeMatch[1], 10);
            if (maxAge > 0) vodScore += 2;
        }
        const sMaxAgeMatch = cacheControl.match(/s-maxage=(\d+)/);
        if (sMaxAgeMatch) {
            const sMaxAge = parseInt(sMaxAgeMatch[1], 10);
            if (sMaxAge > 0) vodScore += 2;
        }
    }

    const expires = headers?.['expires'];
    if (expires !== undefined) {
        if (expires === '0') {
            liveScore += 1;
        } else {
            vodScore += 2;
        }
    }

    if (headers?.['transfer-encoding'] === 'chunked') {
        liveScore += 1;
    }

    if (headers?.['content-length']) {
        vodScore += 1;
    }

    if (headers?.['x-content-duration']) {
        vodScore += 1;
    }

    if (headers?.['accept-ranges'] && headers['accept-ranges'].toLowerCase() === 'bytes') {
        vodScore += 1;
    }

    if (Object.keys(headers).length < 7) { // streaming servers will try to send as few headers as possible
        liveScore += 1;
    }

    return vodScore > liveScore ? 'vod' : 'live';
};

export const isMPEGTSFromInfo = info => {

    if (info.contentType && info.contentType.includes('video/mp2t')) {
        return mediaTypeFromInfo(info)
    }

    if (['ts', 'mts', 'm2ts'].includes(info.ext) && (!info.contentType || !info.contentType.includes('video/mp4'))) {
        if (info.sample) {
            return isPacketized(info.sample) ? mediaTypeFromInfo(info) : false
        }
        return mediaTypeFromInfo(info)
    }

    return false;
};

export default MediaStreamInfo;
