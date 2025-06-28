import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import mega from "../mega/mega.js";
import renderer from '../bridge/bridge.js'
import { insertEntry } from '../utils/utils.js'

class Zap extends EventEmitter {
    constructor(master) {
        super()
        this.streamer = master
        this.isZapping = false;
        this.skips = [];
        this.icon = 'fas fa-random'
        renderer.ready(() => this.init())
    }
    async init() {
        this.title = lang.ZAP
        this.lists = lists
        global.menu.addFilter(this.hook.bind(this));
        this.streamer.on('stop', err => {
            if (this.isZapping) {
                this.go().catch(err => console.error(err));
            }
        });
        this.streamer.on('stop-from-client', err => {
            this.setZapping(false, true, true);
        });
        this.streamer.on('commit', () => {
            if (this.isZapping) {
                this.setZapping(true, true);
            }
        });
        renderer.ui.on('zap', () => {
            this.go().catch(err => console.error(err));
        });
        renderer.ui.on('stop', () => {
            this.setZapping(false);
        });
        await renderer.ready()
        renderer.ui.emit('add-player-button', 'zap', 'ZAP', this.icon, 6, 'zap')
    }
    async hook(entries, path) {
        if (this.lists && path == lang.LIVE && global.lists.loaded() && global.lists.activeLists.length) {
            let pos, has = entries.some((e, i) => {
                if (e.name == this.title) {
                    pos = i;
                    return true;
                }
            });
            if (!has) {
                if (typeof(pos) == 'undefined') {
                    pos = 0;
                }
                entries.splice(pos, 0, this.entry());
            }
        } else if (path == '' && !paths.ALLOW_ADDING_LISTS) {
            insertEntry(this.entry(), entries, [lang.OPTIONS, lang.TOOLS])
        }
        return entries;
    }
    async random() {
        let entries = await this.channelsList();
        let tickets = [];
        entries.forEach((e, i) => {
            if (!this.skips.includes(e.name)) {
                tickets.push(...Array.from({ length: e.weight }, () => i));
            }
        });
        if (tickets.length) {
            let ticket = tickets[Math.floor(Math.random() * tickets.length)];
            this.skips.push(entries[ticket].name);
            if (this.skips.length > 20) {
                this.skips = this.skips.slice(-20);
            }
            console.log('zap random', entries[ticket]);
            return entries[ticket];
        }
    }
    async go() {
        if (this.zappingLocked) {
            return;
        }
        this.setZapping(true);
        if (this.connecting) {
            return;
        }
        if (this.streamer.tuning && !this.streamer.tuning.paused && !this.streamer.tuning.finished) { // already resumed tuning
            return;
        }
        this.connecting = true;
        let entry = await this.random();
        if (entry) {
            entry.url = mega.build(entry.name, { mediaType: 'live' });            
            let succeeded = await this.streamer.play(entry, undefined, true).catch(err => {
                console.error('Zap go operation failed:', err.message || err)
            });
            this.setZapping(true, succeeded);
            this.connecting = false;
            if (this.streamer.tuning) {
                this.streamer.tuning.destroy();
                this.streamer.tuning = null;
            }
            if (!succeeded) {
                return this.go();
            }
            return succeeded === true;
        }
    }
    setZapping(state, skipOSD, force) {
        if (state && this.zappingLocked) {
            return;
        }
        this.isZapping = state;
        renderer.ui.emit('is-zapping', this.isZapping, skipOSD);
        if (!state && force) {
            this.zappingLocked = true;
            setTimeout(() => this.zappingLocked = false, 2000);
        }
    }
    async channelsList() {        
        let chs = [], wdata = {};
        (await global.channels.trending.entries()).forEach(e => {
            wdata[e.name] = e.users;
        });
        Object.keys(global.channels.channelList.channelsIndex).forEach(name => {
            if (!global.lists.mi.isRadio(name)) {
                chs.push({
                    name,
                    weight: 1,
                    terms: global.channels.channelList.channelsIndex[name]
                });
            }
        });
        return chs;
    }
    entry() {
        return {
            name: this.title,
            details: lang.ZAP_DESCRIPTION,
            fa: this.icon,
            type: 'action',
            action: () => this.go()
        };
    }
}
export default Zap;
