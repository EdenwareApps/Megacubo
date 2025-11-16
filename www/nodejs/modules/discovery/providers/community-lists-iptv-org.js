import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import { EventEmitter } from 'node:events';
import Countries from "../../countries/countries.js";
import cloud from "../../cloud/cloud.js";
import config from "../../config/config.js"
import renderer from '../../bridge/bridge.js'
import menu from '../../menu/menu.js'
import Download from '../../download/download.js'
import ready from '../../ready/ready.js'

export default class CommunityListsIPTVORG extends EventEmitter {
    constructor(master) {
        super()
        this.master = master
        this.data = {}
        this.type = 'community'
        this.id = 'community-lists-iptv-org'
        this.ready = ready()
        this.countries = new Countries();
        this.forceRefreshFlag = false;
        this.load().catch(err => console.error(err));
        renderer.ready(() => menu.addFilter(this.hook.bind(this)));
    }
    setForceRefresh(enable = true) {
        if (enable) {
            this.forceRefreshFlag = true;
            this.data = {};
            this.ready = ready();
            this.load(true).catch(err => console.error(err));
        }
    }
    async load(force = false) {
        if (!Object.keys(this.data).length || force || this.forceRefreshFlag) {
            const cloudOpts = (force || this.forceRefreshFlag) ? { bypassCache: true } : undefined;
            await cloud.get('configure', cloudOpts).then(c => {
                this.data = c['sources'] || {};
            }).catch(err => console.error(err));
        }
        this.forceRefreshFlag = false;
        this.ready.done()
    }
    async discovery(adder) {
        if (paths.ALLOW_COMMUNITY_LISTS) {
            await this.ready();
            let locs = await lang.getActiveCountries().catch(err => console.error(err));
            if (Array.isArray(locs) || !locs.length) {
                locs.push = [lang.countryCode];
            }
            let lists = locs.map(code => this.data[code]).filter(c => c);
            if (lists.length) {
                const maxLists = 48, factor = 0.9; // factor here adds some gravity to grant higher priority to community lists instead
                if (lists.length > maxLists) {
                    lists = lists.slice(0, maxLists);
                }
                adder(lists.map((list, i) => {
                    list = { type: 'community', url: list, health: factor * (1 - (i * (1 / lists.length))) };
                    return list;
                }));
            } else {
                console.error('[CommunityListsIPTVORG] no list found for this language or country.');
            }
        }
        return [];
    }
    async entries() {
        await this.ready();
        let entries = Object.keys(this.data);
        entries.unshift(lang.countryCode);
        entries = entries.unique().map(countryCode => {
            return {
                name: this.countries.getCountryName(countryCode, lang.locale),
                type: 'group',
                url: this.data[countryCode],
                countryCode,
                renderer: async data => {
                    let err;
                    let ret = await this.master.lists.manager.renderList(data, { fetch: true }).catch(e => err = e);
                    osd.hide('list-open');
                    if (err) throw err;
                    return ret;
                }
            };
        });
        return entries;
    }
    async hook(entries, path) {
        if (path.split('/').pop() == lang.COMMUNITY_LISTS && config.get('communitary-mode-lists-amount')) {
            entries.splice(entries.length - 1, 0, { name: lang.COUNTRIES, details: lang.ALL, fa: 'fas fa-globe', details: this.details, type: 'group', renderer: this.entries.bind(this) });
        }
        return entries;
    }
}
