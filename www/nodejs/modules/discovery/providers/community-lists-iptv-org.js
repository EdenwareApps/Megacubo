import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import { EventEmitter } from 'events';
import Countries from "../../countries/countries.js";
import cloud from "../../cloud/cloud.js";
import config from "../../config/config.js"
import renderer from '../../bridge/bridge.js'
import menu from '../../menu/menu.js'

class CommunityListsIPTVORG extends EventEmitter {
    constructor(master) {
        super()
        this.master = master
        this.data = {};
        this.countries = new Countries();
        this.load().catch(console.error);
        renderer.ready(() => menu.addFilter(this.hook.bind(this)));
    }
    async load() {
        if (!Object.keys(this.data).length) {
            await cloud.get('configure').then(c => {
                this.data = c['sources'] || {};
            }).catch(console.error);
        }
        this.isReady = true;
        this.emit('ready');
    }
    async ready() {
        await new Promise((resolve, reject) => {
            if (this.isReady) {
                resolve();
            }
            else {
                this.once('ready', resolve);
            }
        });
    }
    async discovery(adder) {
        if (paths.ALLOW_COMMUNITY_LISTS) {
            await this.ready();
            let locs = await lang.getActiveCountries(0).catch(console.error);
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
            }
            else {
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
                renderer: async (data) => {
                    let err;
                    this.master.lists.manager.openingList = true;
                    let ret = await this.master.lists.manager.directListRenderer(data, { fetch: true }).catch(e => err = e);
                    this.master.lists.manager.openingList = false;
                    osd.hide('list-open');
                    if (err)
                        throw err;
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
export default CommunityListsIPTVORG;
