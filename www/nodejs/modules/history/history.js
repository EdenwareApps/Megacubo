import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import EntriesGroup from "../entries-group/entries-group.js";
import mega from "../mega/mega.js";
import moment from "moment-timezone";
import EPGHistory from './epg-history.js'
import { ready } from '../bridge/bridge.js'
import { ucFirst, insertEntry } from '../utils/utils.js'

class History extends EntriesGroup {
    constructor(channels) {
        super('history', channels)
        this.limit = 36;
        this.resumed = false;
        this.storeInConfig = true;
        ready(async () => {
            global.streamer.on('commit', () => {
                if (!global.streamer.active.info.isLocalFile) {
                    let time = (Date.now() / 1000);
                    if (this.timer) {
                        clearTimeout(this.timer);
                    }
                    this.timer = setTimeout(() => {
                        if (global.streamer.active) {
                            let entry = global.streamer.active.data;
                            entry.historyTime = time;
                            this.remove(entry);
                            this.add(entry);
                            this.channels.updateUserTasks().catch(console.error);
                        }
                    }, 90000);
                }
            })
            global.streamer.on('uncommit', () => {
                if (this.timer) {
                    clearTimeout(this.timer)
                }
            })
            this.iconsPort = global.icons.opts.port
        })
        this.on('load', () => {
            ready(() => menu.updateHomeFilters());
        });
        this.epg = new EPGHistory(channels)
    }
    get(...args) {
        let ret = super.get(...args)
        if (ret && this.iconsPort) {
            const fixIcon = e => {
                if (e.icon && e.icon.startsWith('http://127.0.0.1:') && e.icon.match(rgx)) {
                    e.icon = e.icon.replace(rgx, '$1'+ this.iconsPort +'$2')
                }
                return e;
            };
            const rgx = new RegExp('^(http://127\.0\.0\.1:)[0-9]+(/[A-Za-z0-9,]+)$');
            if (Array.isArray(ret)) {
                ret = ret.map(fixIcon);
            } else {
                ret = fixIcon(ret);
            }
        }
        for (let i = 0; i < ret.length; i++) {
            if (!ret[i].originalUrl) {
                const ch = this.channels.isChannel(ret[i].name);
                if (ch) {
                    ret[i].originalUrl = mega.build(ch.name, { terms: ch.terms });
                }
            }
        }
        return ret;
    }
    resume() {
        ready(async () => {
            if (!this.resumed) {
                this.resumed = true;
                let es = this.get();
                console.log('resuming', es);
                if (es.length) {
                    console.log('resuming', es[0], es)
                    global.streamer.play(es[0])
                }
            }
        });
    }
    entry() {
        return {
            name: lang.KEEP_WATCHING,
            details: lang.WATCHED,
            fa: 'fas fa-history', type: 'group',
            hookId: this.key, renderer: this.entries.bind(this)
        }
    }
    async hook(entries, path) {
        if (path == lang.TOOLS) {
            insertEntry(this.entry(), entries, [lang.TOOLS, lang.OPTIONS], [lang.BOOKMARKS, lang.MY_LISTS])
        }
        return entries
    }
    async entries(e) {        
        const epgAddLiveNowMap = {}
        moment.locale(global.lang.locale)
        let gentries = this.get().map((e, i) => {
            e.details = ucFirst(moment(e.historyTime * 1000).fromNow(), true);
            const isMega = e.url && mega.isMega(e.url);
            if (isMega) {
                let atts = mega.parse(e.url)
                if (atts.mediaType == 'live') {
                    return (epgAddLiveNowMap[i] = this.channels.toMetaEntry(e, false))
                } else {
                    e.type = 'group'
                    e.renderer = async () => {
                        let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : global.lists.tools.terms(atts.name)
                        return await global.lists.search(terms, {
                            type: 'video',
                            group: true,
                            safe: !global.lists.parentalControl.lazyAuth()
                        })
                    }
                }
            } else if (e.type != 'group') {
                e.type = 'stream'
            }
            return e
        });
        let entries = await this.channels.epgChannelsAddLiveNow(Object.values(epgAddLiveNowMap), true).catch(console.error);
        if (Array.isArray(entries)) {
            const ks = Object.keys(epgAddLiveNowMap);
            entries.forEach((e, i) => gentries[ks[i]] = e);
        }
        if (gentries.length) {
            gentries.push({ name: lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.removalEntries.bind(this) });
        }
        return gentries;
    }
}
export default History;
