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
        const {default: menu} = await import('../menu/menu.js')
        const {default: lists} = await import('../lists/lists.js')
        const {default: channels} = await import('../channels/channels.js')
        this.title = lang.ZAP
        this.lists = lists
        this.channels = channels
        menu.addFilter(this.hook.bind(this));
        this.streamer.on('stop', err => {
            if (this.isZapping) {
                this.go().catch(console.error);
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
        renderer.get().on('zap', () => {
            this.go().catch(console.error);
        });
        renderer.get().on('stop', () => {
            this.setZapping(false);
        });
        renderer.get().on('streamer-ready', () => {
            renderer.get().emit('add-player-button', 'zap', 'ZAP', this.icon, 6, 'zap');
        });
    }
    async hook(entries, path) {
        if (this.lists && path == lang.LIVE && this.lists.loaded() && this.lists.activeLists.length) {
            let pos, has = entries.some((e, i) => {
                if (e.name == this.title) {
                    pos = i;
                    return true;
                }
            });
            if (!has) {
                if (typeof (pos) == 'undefined') {
                    pos = 0;
                }
                entries.splice(pos, 0, this.entry());
            }
        }
        else if (path == '' && !paths.ALLOW_ADDING_LISTS) {
            insertEntry(this.entry(), entries, -2, [lang.OPTIONS, lang.TOOLS]);
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
            
            let succeeded = await this.streamer.play(entry, undefined, true).catch(console.error);
            this.connecting = false;
            this.setZapping(true, succeeded);
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
        renderer.get().emit('is-zapping', this.isZapping, skipOSD);
        if (!state && force) {
            this.zappingLocked = true;
            setTimeout(() => this.zappingLocked = false, 2000);
        }
    }
    async channelsList() {        
        let chs = [], wdata = {};
        (await this.channels.watching.entries()).forEach(e => {
            wdata[e.name] = e.users;
        });
        Object.keys(this.channels.channelList.channelsIndex).forEach(name => {
            if (!this.lists.mi.isRadio(name)) {
                chs.push({
                    name,
                    weight: 1,
                    terms: this.channels.channelList.channelsIndex[name]
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
