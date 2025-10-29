import Download from '../download/download.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import pLimit from "p-limit";
import config from "../config/config.js"

class Xtr extends EventEmitter {
    constructor(addr, debug) {
        super();
        if (debug === true)
            this.debugInfo = [];
        let parts = addr.split('#');
        let authAddr = parts[0];
        this.flags = parts.length > 1 ? parts[1] : '';
        parts = authAddr.split('@')[0].split('/').pop().split(':');
        this.user = parts[0];
        this.pass = parts[1];
        this.addr = authAddr.replace(this.user + ':' + this.pass + '@', '');
        this.meta = {};
        this.foundStreams = 0;
    }
    async execute(action) {
        let err;
        const url = this.addr + '/player_api.php?username=' + this.user + '&password=' + this.pass + '&action=' + action;
        const data = await Download.get({
            url,
            timeout: 30,
            responseType: 'json',
            keepalive: true,
            maxAuthErrors: 0,
            maxAbortErrors: 1,
            maxRedirects: 1
        }).catch(e => err = e);
        this.debugInfo && this.debugInfo.push({ url, data, err });
        if (err)
            throw err;
        return data;
    }
    async getSeriesStreams(id) {
        const streams = await this.execute('get_series_info&series_id=' + id);
        const episodes = [];
        if (streams && streams.info) {
            let root = lang.SERIES + '/';
            if (streams.info.category_id && this.cmap && this.cmap.names[streams.info.category_id]) {
                root += this.cmap.names[streams.info.category_id] + '/';
            }
            root += streams.info.name;
            Object.keys(streams.episodes).map(season => {
                streams.episodes[season].forEach(episode => {
                    episodes.push({
                        name: episode.title,
                        group: root + '/' + season,
                        stream_icon: episode.info.movie_image || streams.info.cover,
                        stream_id: episode.id,
                        stream_url: this.addr + '/series/' + this.user + '/' + this.pass + '/' + episode.id + '.' + episode.container_extension
                    });
                });
            });
        }
        return episodes;
    }
    livefmt() {
        if (!this._livefmt) {
            const pref = config.get('preferred-livestream-fmt');
            const availables = this.info && this.info.user_info && this.info.user_info.allowed_output_formats ? this.info.user_info.allowed_output_formats : 'ts';
            if (pref == 'hls' && availables.includes('m3u8')) {
                this._livefmt = 'm3u8';
            } else {
                this._livefmt = 'ts';
            }
        }
        return this._livefmt;
    }
    async prepare() {
        if (!this.info) {
            this.info = await this.execute('get_live_info');
        }
        if (this.cmap)
            return;
        let series = [];
        const names = {};
        const parents = { series: {} };
        const categories = [];
        for (const type of ['live', 'vod', 'series']) {
            const cats = await this.execute('get_' + type + '_categories')
            Array.isArray(cats) && categories.push(...cats)
            if (type == 'series') {
                if (this.flags.endsWith('-all')) {
                    series = await this.execute('get_series');
                }
            }
        }
        categories.forEach(c => {
            names[c.category_id] = c.category_name;
            if (c.parent_id) {
                parents[c.category_id] = c.parent_id;
            }
        });
        if(Array.isArray(series)) {
            series.forEach(c => {
                if (c.category_id && c.series_id) {
                    parents.series[c.series_id] = c.category_id;
                }
            })
        } else { // why did it happenned without rejecting?!
            series = []
        }
        this.cmap = { names, parents, series };
        this.meta.epg = this.addr + '/xmltv.php?username=' + this.user + '&pass=' + this.pass;
        this.emit('meta', this.meta);
    }
    async run() {
        let currentProgress = 10, processed = 0, firstStepWeight = 2;
        this.emit('progress', 1);
        await this.prepare();
        this.emit('progress', firstStepWeight);
        const limit = pLimit(2);
        const tasksCount = 2 + this.cmap.series.length;
        const taskWeight = (100 - firstStepWeight) / tasksCount;
        const progress = () => {
            processed++;
            const p = parseInt(firstStepWeight + (processed * taskWeight));
            if (p != currentProgress) {
                currentProgress = p;
                this.emit('progress', p);
            }
        };
        const tasks = ['live', 'vod', ...this.cmap.series].map(s => {
            return async () => {
                if (typeof(s) == 'string') {
                    this.emitEntries(await this.execute('get_' + s + '_streams'), s);
                } else {
                    this.emitEntries(await this.getSeriesStreams(s.category_id), 'series');
                }
                progress();
            };
        }).map(limit);
        await Promise.allSettled(tasks);
    }
    emitEntries(streams, type) {
        if (Array.isArray(streams)) {
            if (type == 'vod')
                type = 'movie';
            const defaultExt = type == 'live' ? this.livefmt() : 'mp4';
            for (const s of streams) {
                // stream_type: "live"
                const ext = s.container_extension || defaultExt;
                let name = s.name;
                if (s.is_adult && s.is_adult != '0' && !s.name.toLowerCase().includes('xxx')) {
                    name += ' XXX'; // parental control internal hint
                }
                let i = 6, cid = s.category_id, group = s.group || this.cmap.names[s.category_id] || '';
                if (!s.group) {
                    while (i && this.cmap.parents[cid]) {
                        group = this.cmap.names[this.cmap.parents[cid]] + '/' + group;
                        cid = this.cmap.parents[cid];
                        i--;
                    }
                }
                const url = s.stream_url ||
                    (this.addr + '/' + type + '/' + this.user + '/' + this.pass + '/' + s.stream_id + '.' + ext);
                this.emit('entry', {
                    name, group,
                    icon: s.stream_icon,
                    url
                });
                this.foundStreams++;
            }
        }
    }
    destroy() {
        this.emit('finish');
    }
}
export default Xtr;
