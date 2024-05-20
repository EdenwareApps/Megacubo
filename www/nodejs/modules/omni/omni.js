import menu from '../menu/menu.js'
import channels from '../channels/channels.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import lists from "../lists/lists.js";
import renderer from '../bridge/bridge.js'

class OMNI extends EventEmitter {
    constructor() {
        super()
        const ui = renderer.get()
        ui.on('omni-client-ready', () => {
            if (this.enabled) {
                ui.emit('omni-enable') // on linux, ui was loading after lists update, this way the search field was not showing up
            }
        });
        ui.on('omni', async (text, type) => {
            if (type == 'numeric') {
                let es = channels.bookmarks.get().filter(e => e.bookmarkId == parseInt(text));
                if (es.length) {
                    ui.emit('omni-callback', text, !!es.length);
                    console.warn('omni-callback', text, !!es.length, es);
                    let entry = es.shift();
                    if (entry.type == 'group') {
                        ui.emit('menu-playing')
                        menu.open([lang.BOOKMARKS, entry.name].join('/')).catch(e => menu.displayErr(e));
                        return
                    } else {                        
                        global.streamer.play(entry)
                        ui.emit('menu-playing-close')
                        return
                    }
                }
            }
            channels.searchChannels(text, true).then(results => {
                if (results.length) {
                    channels.search.go(text, 'live');
                } else {
                    throw new Error('no channel found, going to general search');
                }
            }).catch(err => {
                channels.search.go(text, 'all');
            }).finally(() => {
                ui.emit('omni-callback', text, true)
            });
        });
        lists.on('status', status => {
            const enabled = lists.satisfied && status.length;
            if (enabled != this.enabled) {
                this.enabled = enabled;
                ui.emit(enabled ? 'omni-enable' : 'omni-disable');
            }
        });
    }
}
export default new OMNI();
