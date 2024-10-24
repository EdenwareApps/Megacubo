import { EventEmitter } from "events";

class ListIndexUtils extends EventEmitter {
    constructor() {
        super();
        this.seriesRegex = new RegExp('(\\b|^)[st]?[0-9]+ ?[epx]{1,2}[0-9]+($|\\b)', 'i');
        this.vodRegex = new RegExp('[\\.=](mp4|mkv|mpeg|mov|m4v|webm|ogv|hevc|divx)($|\\?|&)', 'i');
        this.liveRegex = new RegExp('([0-9]+/[0-9]+|[\\.=](m3u8|ts))($|\\?|&)', 'i');
        this.indexTemplate = {
            groups: {},
            terms: {},
            meta: {}
        };
    }
    sniffStreamType(e) {
        if (e.name && e.name.match(this.seriesRegex)) {
            return 'series';
        } else if (e.url.match(this.vodRegex)) {
            return 'vod';
        } else if (e.url.match(this.liveRegex)) {
            return 'live';
        }
    }
}
export default ListIndexUtils
