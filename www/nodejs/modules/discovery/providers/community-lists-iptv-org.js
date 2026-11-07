import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import { EventEmitter } from 'node:events';
import countries from '@edenware/countries';
import cloud from "../../cloud/cloud.js";
import config from "../../config/config.js"
import renderer from '../../bridge/bridge.js'
import menu from '../../menu/menu.js'
import Download from '../../download/download.js'
import ready from '../../ready/ready.js'
import paths from '../../paths/paths.js'
import contentProfile from '../../profiles/content-profile.js'

export default class CommunityListsIPTVORG extends EventEmitter {
    constructor(master) {
        super()
        this.master = master
        this.contentProfile = contentProfile
        this.data = {}
        this.type = 'community'
        this.id = 'community-lists-iptv-org'
        this.ready = ready()
        this.countries = countries;
        this.forceRefreshFlag = false;
        this.adultList = '';

        // Mantém this.data['sources'] sempre atualizado via cloud.sync
        this._unsubConfigure = cloud.sync('configure', c => {
            this.data = (c && c['sources']) || {};
            this.adultList = (c && c['adult-iptv']) || '';
        });

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
        const noData = !Object.keys(this.data).length;
        if (noData || force || this.forceRefreshFlag) {
            const cloudOpts = (force || this.forceRefreshFlag) ? { bypassCache: true } : undefined;
            await cloud.get('configure', cloudOpts).catch(err => console.error(err));
            // data updated by sync callback automatically
        }
        this.forceRefreshFlag = false;
        this.ready.done()
    }
    /**
     * Lists contributed by the content profile in force (e.g. the adult list, or
     * a themed list when the cloud defines one for the selected focus).
     */
    profileLists() {
        const ret = this.contentProfile.listsForDiscovery()
        return ret.filter(u => typeof u == 'string' && u.trim()).map(u => u.trim())
    }
    adultLists() {
        const val = this.adultList;
        if (!val) {
            return [];
        }
        return (Array.isArray(val) ? val : [val])
            .filter(u => typeof u == 'string' && u.trim())
            .map(u => u.trim());
    }
    /**
     * Outside the adult content profile the adult list must not be kept as a
     * known community list (e.g. after switching back from the adult profile).
     */
    discardAdultLists() {
        const known = this.adultLists();
        if (this.contentProfile.profile() == 'adult' && this.contentProfile.adultAllowed()) {
            return;
        }
        const master = this.master;
        if (!known.length || !master || !Array.isArray(master.knownLists)) {
            return;
        }
        const knownLists = master.knownLists.filter(l => !known.includes(l.url));
        if (knownLists.length != master.knownLists.length) {
            master.knownLists = knownLists;
            master.save && master.save().catch(err => console.error(err));
        }
    }
    async discovery(adder) {
        let ret = [];
        this.discardAdultLists();
        if (paths.ALLOW_COMMUNITY_LISTS) {
            await this.ready();
            let locs = await lang.getActiveCountries().catch(err => console.error(err));
            if (!Array.isArray(locs)) {
                locs = [];
            }
            if (!locs.length) {
                locs = [lang.countryCode];
            }
            let lists = locs.map(code => this.data[code]).filter(c => c);
            const profileLists = this.profileLists();
            if (profileLists.length) {
                // The list(s) of the content profile in force are bundled along with community lists
                lists = profileLists.concat(lists.filter(url => !profileLists.includes(url)));
            }
            if (lists.length) {
                const maxLists = 48, factor = 0.9; // factor here adds some gravity to grant higher priority to community lists instead
                if (lists.length > maxLists) {
                    lists = lists.slice(0, maxLists);
                }
                ret = lists.map((list, i) => {
                    list = { type: 'community', url: list, health: factor * (1 - (i * (1 / lists.length))) };
                    return list;
                });
                adder && adder(ret);
            } else {
                console.error('[CommunityListsIPTVORG] no list found for this language or country.');
            }
        }
        return ret;
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
        if (path.split('/').pop() == lang.COMMUNITY_LISTS && config.get('community-mode-lists-amount')) {
            entries.splice(entries.length - 1, 0, { name: lang.COUNTRIES, details: lang.ALL, fa: 'fas fa-globe', details: this.details, type: 'group', renderer: this.entries.bind(this) });
        }
        return entries;
    }
}
