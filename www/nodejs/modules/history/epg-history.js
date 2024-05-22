import menu from '../menu/menu.js'
import lang from "../lang/lang.js";
import EntriesGroup from "../entries-group/entries-group.js";
import moment from "moment-timezone";
import { ready } from '../bridge/bridge.js'
import { ts2clock } from "../utils/utils.js";

class EPGHistory extends EntriesGroup {
    constructor(channels) {
        super('epg-history', channels)
        this.storeInConfig = true;
        this.limit = 48;
        this.minWatchingTime = 240;
        this.checkingInterval = 60; // to prevent losing data on program closing, we'll save it periodically
        this.resumed = false;
        this.session = null;
        this.allowDupes = true;
        channels.on('epg-loaded', () => {
            if (this.inSection()) {
                menu.refresh()
            }
        })
        ready(() => {
            moment.locale(global.lang.locale)
            global.streamer.on('commit', async () => {
                await this.busy()
                const data = this.currentStreamData()
                const name = data.originalName || data.name
                if (this.session && this.session.name != name) {
                    await this.finishSession().catch(console.error)
                }
                if (!global.streamer.active)
                    return
                if (!this.session) {
                    let validate = !global.streamer.active.info.isLocalFile && global.streamer.active.mediaType == 'live' && this.channels.isChannel(name)
                    if (validate) {
                        console.warn('Session started')
                        this.startSession()
                    } else {
                        console.warn('Session not started, not a channel')
                    }
                } else {
                    console.warn('Session already started')
                }
            })
            global.streamer.on('uncommit', () => {
                console.warn('Session finished')
                this.finishSession()
            })
        })
    }
    currentStreamData() {        
        if(!global.streamer) return {}
        return Object.assign({}, global.streamer.active ? global.streamer.active.data : global.streamer.lastActiveData)
    }
    startSession() {
        this.session = this.currentStreamData()
        if (this.session.originalName) {
            this.session.name = this.session.originalName
        }
        this.session.startTime = (Date.now() / 1000)
        this.startSessionTimer()
    }
    async finishSession() {
        if (this.session) {
            this.setBusy(true)
            clearInterval(this.session.timer)
            await this.check().catch(console.error)
            this.session = null
            this.setBusy(false)
        }
    }
    startSessionTimer() {
        clearInterval(this.session.timer);
        this.session.timer = setInterval(() => {
            this.check().catch(console.error)
        }, this.checkingInterval * 1000)
    }
    finishSessionTimer() {
        clearInterval(this.session.timer)
    }
    async check() {
        if (!this.session)
            return
        const now = (Date.now() / 1000), data = this.currentStreamData()
        let nextRunTime = 0, info = await this.channels.epgChannelLiveNowAndNextInfo(data)
        if (info) {
            info = Object.values(info);
            if (this.session && this.session.lastInfo) {
                this.session.lastInfo.forEach(inf => {
                    if (!info.some(f => f.t == inf.t)) {
                        info.unshift(inf);
                    }
                });
            }
            let save;
            info.forEach(f => {
                data.watched = this.getWatchingTime(f);
                if (data.watched && data.watched.time > this.minWatchingTime) {
                    const updated = this.data.some((entry, i) => {
                        if (entry.watched.name == data.watched.name) {
                            if (entry.watched.start == data.watched.start) {
                                this.data[i] = this.cleanAtts(data);
                                save = true;
                                return true;
                            } else {
                                let diff = data.watched.start - entry.watched.end;
                                if (diff < 120) {
                                    data.watched.start = entry.watched.start;
                                    data.watched.time = data.watched.end - data.watched.start;
                                    this.data[i] = this.cleanAtts(data);
                                    save = true;
                                    return true;
                                }
                            }
                        }
                    });
                    if (!updated) {
                        save = false;
                        if (this.data.length >= this.limit) {
                            this.data = this.data.slice(this.data.length - (this.limit - 1));
                        }
                        this.add(data);
                        if (this.inSection() == 1) {
                            menu.refreshNow();
                        }
                    }
                }
                ;
                [f.start, f.e].forEach(s => {
                    if (s > now && (!nextRunTime || s < nextRunTime)) {
                        nextRunTime = s;
                    }
                });
            });
            if (save) {
                this.save(true);
            }
        }
    }
    getWatchingTime(epgEntry) {
        if (this.session) {
            const start = Math.max(this.session.startTime, epgEntry.start);
            const end = Math.min((Date.now() / 1000), epgEntry.e);
            return {
                start, end,
                time: end - start,
                name: epgEntry.t,
                icon: epgEntry.i,
                categories: epgEntry.c.unique()
            };
        }
        return null;
    }
    inSection(entries, path) {
        if (!Array.isArray(entries)) {
            entries = menu.currentEntries;
        }
        if (typeof (path) != 'string') {
            path = menu.path;
        }
        if (this.data.length && this.channels.loadedEPG) {
            if (path == lang.LIVE) {
                return 3;
            } else if (path == lang.BOOKMARKS) {
                return 2;
            } else if (path.indexOf(lang.RECOMMENDED_FOR_YOU) != -1) {
                return 1;
            }
        }
    }
    async historyRemovalEntries(e) {
        let es = this.get();
        es = es.map((o, i) => {
            const details = moment(o.watched.start * 1000).fromNow();
            const e = Object.assign({}, o);
            e.details = details;
            if (e.icon) {
                delete e.icon;
            }
            e.name = e.watched.name;
            e.details += ' <i class="fas fa-clock"></i> ' + ts2clock(e.watched.start) + '-' + ts2clock(e.watched.end); // [e.category].concat(e.programme.c).join(', ') + ''            
            e.type = 'action';
            e.action = () => {
                this.remove(o);
                menu.refreshNow();
            };
            e.fa = 'fas fa-trash';
            delete e.url;
            return e;
        });
        return es;
    }
    async historyEntries(e) {
        let es = this.get().map(e => {
            e.details = moment(e.watched.start * 1000).fromNow();
            e = this.channels.toMetaEntry(e, false);
            if (e.watched.icon) {
                e.icon = e.watched.icon;
            }
            e.name = e.watched.name;
            e.details += ' <i class="fas fa-clock"></i> ' + ts2clock(e.watched.start) + '-' + ts2clock(e.watched.end); // [e.category].concat(e.programme.c).join(', ') + ''            
            e.type = 'action';
            e.action = () => {
                this.channels.epgProgramAction(e.watched.start, e.originalName, { t: e.watched.name, e: e.watched.end, c: e.watched.categories.unique() }, e.terms);
            };
            e.fa = 'fas fa-history';
            delete e.url;
            return e;
        });
        if (es.length) {
            es.push({ name: lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.historyRemovalEntries.bind(this) });
        }
        return es;
    }
    setBusy(set) {
        this.isBusy = set;
        if (!this.isBusy) {
            this.emit('release');
        }
    }
    busy() {
        return new Promise((resolve, reject) => {
            if (this.isBusy) {
                this.once('release', async () => {
                    this.check().catch(console.error).finally(resolve);
                });
            } else {
                this.check().catch(console.error).finally(resolve);
            }
        });
    }
}
export default EPGHistory
