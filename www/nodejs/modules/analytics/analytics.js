import channels from '../channels/channels.js'
import lang from "../lang/lang.js";
import { EventEmitter } from 'events';
import options from "../options/options.js";
import lists from "../lists/lists.js";
import http from "http";
import streamer from "../streamer/main.js";
import paths from '../paths/paths.js'
import { ready } from '../bridge/bridge.js'
import { isWritable } from '../utils/utils.js'

class AnalyticsBase extends EventEmitter {
    constructor() {
        super();
        this.debug = false;
        this.keepAliveTTL = 600000;
    }
    toQS(obj) {
        let str = [];
        Object.keys(obj).forEach(k => {
            if (typeof (obj[k]) == 'string') {
                str.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]));
            }
        });
        return str.join('&');
    }
    register(action, data) {
        if (!data) {
            data = {};
        }
        data.uiLocale = lang.locale;
        data.arch = process.arch;
        data.platform = process.platform;
        data.country = lang.countryCode;
        data.ver = paths.manifest.version;
        data.verinf = '';
        if (options.prm() && global.premium) {
            data.verinf = global.premium.active;
        }
        if (data.url)
            data.url = this.obfuscateURL(data.url);
        if (data.source && lists.isPrivateList(data.source))
            data.source = ''; // Source URL not shareable.
        data.epg = channels.loadedEPG || data.epg || '';
        const postData = this.toQS(data);
        const opts = {
            port: 80,
            family: 4,
            method: 'POST',
            path: '/stats/' + action,
            hostname: 'app.megacubo.net',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length,
                'Cache-Control': 'no-cache'
            }
        };
        if (this.debug) {
            console.log('register', opts, postData);
        }
        const req = http.request(opts, res => {
            res.setEncoding('utf8');
            let data = '';
            res.on('data', (d) => {
                data += d;
            });
            res.once('end', () => {
                if (this.debug) {
                    console.log('register(' + action + ')', data);
                }
            });
        });
        req.on('error', (e) => {
            console.error('Houve um erro', e);
        });
        isWritable(req) && req.write(postData);
        req.end();
    }
    prepareEntry(entry) {
        if (!entry || typeof (entry) != 'object') {
            return {};
        }
        else {
            return Object.assign({}, entry);
        }
    }
    obfuscateURL(url) {
        const file = url.split('?').shift().split('/').pop(); // keep only the original filename as hint to know if it is a 'live' or 'vod' content
        return 'https://localhost/' + file;
    }
}
class AnalyticsEvents extends AnalyticsBase {
    constructor() {
        super();
    }
    data() {
        let data = {};
        if (streamer && streamer.active) {
            data = streamer.active.data;
        }
        return this.prepareEntry(data);
    }
    alive() {
        this.register('alive', this.data());
    }
    success() {
        this.register('success', this.data());
    }
    error(e) {
        if (e) {
            this.register('error', this.prepareEntry(e));
        }
    }
    stop() {
        this.register('stop');
    }
    search(e) {
        if (e) {
            this.register('search', e);
        }
    }
}
class Analytics extends AnalyticsEvents {
    constructor() {
        super()
        ready(() => {
            setInterval(this.alive.bind(this), this.keepAliveTTL);
            streamer.on('commit', this.success.bind(this));
            streamer.on('stop', this.stop.bind(this));
            channels.search.on('search', data => {
                this.search(data);
            });
            this.alive()
        })
    }
}
export default new Analytics();
