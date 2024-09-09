import osd from '../../osd/osd.js'
import lang from "../../lang/lang.js";
import { EventEmitter } from 'events';
import Countries from "../../countries/countries.js";
import cloud from "../../cloud/cloud.js";
import config from "../../config/config.js"
import renderer from '../../bridge/bridge.js'
import { insertEntry, kfmt, listNameFromURL } from "../../utils/utils.js";

const FreeTVMap = {
    "al": ["playlist_albania.m3u8"],
    "ad": ["playlist_andorra.m3u8"],
    "ar": ["playlist_argentina.m3u8", "playlist_zz_news_ar.m3u8", "playlist_zz_documentaries_ar.m3u8"],
    "au": ["playlist_australia.m3u8"],
    "at": ["playlist_austria.m3u8"],
    "az": ["playlist_azerbaijan.m3u8"],
    "by": ["playlist_belarus.m3u8"],
    "be": ["playlist_belgium.m3u8"],
    "ba": ["playlist_bosnia_and_herzegovina.m3u8"],
    "br": ["playlist_brazil.m3u8"],
    "bg": ["playlist_bulgaria.m3u8"],
    "ca": ["playlist_canada.m3u8"],
    "td": ["playlist_chad.m3u8"],
    "cl": ["playlist_chile.m3u8"],
    "cn": ["playlist_china.m3u8"],
    "cr": ["playlist_costa_rica.m3u8"],
    "hr": ["playlist_croatia.m3u8"],
    "cy": ["playlist_cyprus.m3u8"],
    "cz": ["playlist_czech_republic.m3u8"],
    "dk": ["playlist_denmark.m3u8"],
    "do": ["playlist_dominican_republic.m3u8"],
    "ee": ["playlist_estonia.m3u8"],
    "fo": ["playlist_faroe_islands.m3u8"],
    "fi": ["playlist_finland.m3u8"],
    "fr": ["playlist_france.m3u8"],
    "ge": ["playlist_georgia.m3u8"],
    "de": ["playlist_germany.m3u8"],
    "gr": ["playlist_greece.m3u8"],
    "gl": ["playlist_greenland.m3u8"],
    "hk": ["playlist_hong_kong.m3u8", "playlist_hongkong.m3u8"],
    "hu": ["playlist_hungary.m3u8"],
    "is": ["playlist_iceland.m3u8"],
    "in": ["playlist_india.m3u8"],
    "ir": ["playlist_iran.m3u8"],
    "iq": ["playlist_iraq.m3u8"],
    "ie": ["playlist_ireland.m3u8"],
    "il": ["playlist_israel.m3u8"],
    "it": ["playlist_italy.m3u8"],
    "jp": ["playlist_japan.m3u8"],
    "kr": ["playlist_korea.m3u8"],
    "xk": ["playlist_kosovo.m3u8"],
    "lv": ["playlist_latvia.m3u8"],
    "lt": ["playlist_lithuania.m3u8"],
    "lu": ["playlist_luxembourg.m3u8"],
    "mo": ["playlist_macau.m3u8"],
    "mt": ["playlist_malta.m3u8"],
    "mx": ["playlist_mexico.m3u8"],
    "md": ["playlist_moldova.m3u8"],
    "mc": ["playlist_monaco.m3u8"],
    "me": ["playlist_montenegro.m3u8"],
    "nl": ["playlist_netherlands.m3u8"],
    "kp": ["playlist_north_korea.m3u8"],
    "mk": ["playlist_north_macedonia.m3u8"],
    "no": ["playlist_norway.m3u8"],
    "py": ["playlist_paraguay.m3u8"],
    "pe": ["playlist_peru.m3u8"],
    "pl": ["playlist_poland.m3u8"],
    "pt": ["playlist_portugal.m3u8"],
    "qa": ["playlist_qatar.m3u8"],
    "ro": ["playlist_romania.m3u8"],
    "ru": ["playlist_russia.m3u8"],
    "sm": ["playlist_san_marino.m3u8"],
    "sa": ["playlist_saudi_arabia.m3u8"],
    "rs": ["playlist_serbia.m3u8"],
    "sk": ["playlist_slovakia.m3u8"],
    "si": ["playlist_slovenia.m3u8"],
    "so": ["playlist_somalia.m3u8"],
    "es": ["playlist_spain.m3u8", "playlist_spain_vod.m3u8", "playlist_zz_news_es.m3u8"],
    "se": ["playlist_sweden.m3u8"],
    "ch": ["playlist_switzerland.m3u8"],
    "tw": ["playlist_taiwan.m3u8"],
    "tt": ["playlist_trinidad.m3u8"],
    "tr": ["playlist_turkey.m3u8"],
    "gb": ["playlist_uk.m3u8"],
    "ua": ["playlist_ukraine.m3u8"],
    "ae": ["playlist_united_arab_emirates.m3u8"],
    "us": ["playlist_usa.m3u8", "playlist_usa_vod.m3u8"],
    "ve": ["playlist_venezuela.m3u8"]
};
class PublicLists extends EventEmitter {
    constructor(master) {
        super()
        this.master = master
        this.data = {};
        this.countries = new Countries();
        this.load().catch(console.error);
        renderer.ready(async () => {
            global.menu.addFilter(this.hook.bind(this));
        });
    }
    async load() {
        if (!Object.keys(this.data).length) {
            Object.keys(FreeTVMap).forEach(code => {
                if (!this.data[code])
                    this.data[code] = [];
                this.data[code].push(...FreeTVMap[code].map(n => {
                    return 'https://github.com/Free-TV/IPTV/raw/master/playlists/' + n;
                }));
            });
            await cloud.get('configure').then(c => {
                Object.keys(c['Free-IPTV-Extras']).forEach(code => {
                    if (!this.data[code])
                        this.data[code] = [];
                    this.data[code].push(c['Free-IPTV-Extras'][code]);
                });
            }).catch(console.error);
        }
        this.isReady = true;
        this.emit('ready');
    }
    async ready() {
        await new Promise((resolve, reject) => {
            if (this.isReady) {
                resolve();
            } else {
                this.once('ready', resolve);
            }
        });
    }
    async discovery(adder) {
        await this.ready()
        let locs = await lang.getActiveCountries().catch(console.error);
        if (!Array.isArray(locs) || !locs.length) {
            locs = [lang.countryCode]
        }
        let lists = locs.map(code => this.data[code]).flat().filter(c => c);
        if (lists.length) {
            const maxLists = 48, factor = 0.9 // factor here adds some gravity to grant higher priority to community lists instead
            if (lists.length > maxLists) {
                lists = lists.slice(0, maxLists)
            }
            if (!adder) return lists
            adder(lists.map((list, i) => {
                return { type: 'public', url: list, health: factor * (1 - (i * (1 / lists.length))) }
            }))
        }
    }
    async entries(local, silent) {
        await this.ready();
        let entries = Object.keys(this.data);
        entries.unshift(lang.countryCode);
        if (local === true) {
            let locs = await lang.getActiveCountries().catch(console.error);
            entries = entries.filter(e => locs.includes(e));
        }
        entries = entries.unique().map(countryCode => {
            return {
                name: this.countries.getCountryName(countryCode, lang.locale),
                type: 'group',
                url: this.data[countryCode],
                countryCode,
                renderer: async () => {
                    let err;
                    this.master.lists.manager.openingList = true;
                    let ret = [];
                    for (const url of this.data[countryCode]) {
                        let es = await this.master.lists.manager.directListRenderer({ url }, {
                            raw: true,
                            fetch: true,
                            expand: true,
                            silent: silent === true // for channels.getPublicListsCategories()
                        }).catch(e => err = e);
                        if (Array.isArray(es)) {
                            ret.push(...es.filter(e => e.name != lang.EMPTY));
                        }
                    }
                    this.master.lists.manager.openingList = false;
                    osd.hide('list-open');
                    if (err)
                        throw err;
                    return this.master.lists.tools.sort(ret);
                }
            };
        });
        paths.ALLOW_ADDING_LISTS || entries.unshift(this.infoEntry());
        return entries;
    }
    entry() {
        return {
            name: lang.PUBLIC_LISTS, type: 'group', fa: 'fas fa-broadcast-tower',
            renderer: async () => {
                let toggle = config.get('public-lists') ? 'fas fa-toggle-on' : 'fas fa-toggle-off';
                let options = [
                    {
                        name: lang.ACCEPT_LISTS, details: '', type: 'select', fa: toggle, renderer: async () => {
                            let def = config.get('public-lists');
                            return [
                                {
                                    name: lang.YES,
                                    value: 'yes'
                                },
                                {
                                    name: lang.ONLY,
                                    value: 'only'
                                },
                                {
                                    name: lang.NO,
                                    value: ''
                                }
                            ].map(n => {
                                return {
                                    name: n.name,
                                    type: 'action',
                                    selected: def == n.value,
                                    action: async () => {
                                        config.set('public-lists', n.value)
                                        global.menu.refreshNow()
                                    }
                                };
                            });
                        }
                    },
                    {
                        name: lang.RECEIVED_LISTS,
                        details: lang.SHARED_AND_LOADED,
                        fa: 'fas fa-users',
                        type: 'group',
                        renderer: this.receivedListsEntries.bind(this)
                    }
                ];
                config.get('public-lists') && options.push(this.countriesEntry());
                options.push(this.infoEntry());
                return options;
            }
        };
    }
    infoEntry() {
        return {
            name: lang.LEGAL_NOTICE,
            fa: 'fas fa-info-circle',
            type: 'action',
            action: this.showInfo.bind(this)
        };
    }
    countriesEntry() {
        return {
            name: lang.COUNTRIES,
            fa: 'fas fa-globe',
            details: lang.ALL,
            type: 'group',
            renderer: this.entries.bind(this)
        };
    }
    async receivedListsEntries() {
        const info = await this.master.lists.info();
        let entries = Object.keys(info).filter(u => info[u].origin == 'public').sort((a, b) => {
            if ([a, b].some(a => typeof (info[a].score) == 'undefined'))
                return 0
            if (info[a].score == info[b].score)
                return 0
            return info[a].score > info[b].score ? -1 : 1
        }).map(url => {
            let data = this.master.details(url)
            if (!data) {
                console.error('LIST NOT FOUND ' + url)
                return;
            }
            //let health = this.master.averageHealth(data) || -1
            let name = data.name || listNameFromURL(url)
            let author = data.author || undefined
            let icon = data.icon || undefined
            let length = data.length || info[url].length || 0
            let details = []
            author && details.push(author)
            details.push(lang.RELEVANCE + ': ' + parseInt((info[url].score || 0) * 100) + '%')
            details.push('<i class="fas fa-play-circle" aria-label="hidden"></i> ' + kfmt(length, 1))
            details = details.join(' &middot; ')
            return {
                name, url, icon, details,
                fa: 'fas fa-satellite-dish',
                type: 'group',
                class: 'skip-testing',
                renderer: this.master.lists.manager.directListRenderer.bind(this.master.lists.manager)
            };
        }).filter(l => l)
        if (!entries.length) {
            if (!this.master.lists.loaded()) {
                entries = [this.master.lists.manager.updatingListsEntry()];
            } else {
                entries = [this.master.lists.manager.noListsRetryEntry()];
            }
        }
        return entries;
    }
    async hook(entries, path) {
        if (path.split('/').pop() == lang.MY_LISTS) {
            insertEntry(this.entry(), entries, [], lang.ADD_LIST);
        } else if (path == '') {
            if (!paths.ALLOW_ADDING_LISTS) {
                insertEntry(this.countriesEntry(), entries, [lang.TOOLS], [lang.TREENDING]);
            }
        }
        return entries;
    }
    async showInfo() {
        global.menu.dialog([
            { template: 'question', text: lang.PUBLIC_LISTS, fa: 'fas fa-users' },
            { template: 'message', text: lang.PUBLIC_LISTS_INFO },
            { template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle' },
            { template: 'option', text: lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle' }
        ], 'ok').then(ret => {
            if (ret == 'know') {
                renderer.get().emit('open-external-url', 'https://github.com/EdenwareApps/Free-IPTV-Extras');
            }
        }).catch(console.error);
    }
}
export default PublicLists;
