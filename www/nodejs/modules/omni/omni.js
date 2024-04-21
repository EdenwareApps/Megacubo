import menu from '../menu/menu.js'
import channels from '../channels/channels.js'
import lang from "../lang/lang.js";
import { EventEmitter } from "events";
import lists from "../lists/lists.js";
import renderer from '../bridge/bridge.js'

class OMNI extends EventEmitter {
    constructor() {
        super();
        renderer.get().on('omni-client-ready', () => {
            if (this.enabled) {
                renderer.get().emit('omni-enable'); // on linux, ui was loading after lists update, this way the search field was not showing up
            }
        });
        renderer.get().on('omni', async (text, type) => {
            if (type == 'numeric') {
                let es = channels.bookmarks.get().filter(e => e.bookmarkId == parseInt(text));
                if (es.length) {
                    renderer.get().emit('omni-callback', text, !!es.length);
                    console.warn('omni-callback', text, !!es.length, es);
                    let entry = es.shift();
                    if (entry.type == 'group') {
                        return menu.open([lang.BOOKMARKS, entry.name].join('/')).catch(e => menu.displayErr(e));
                    } else {                        
                        const {default: streamer} = await import('../streamer/main.js')
                        return streamer.play(entry);
                    }
                }
            }
            channels.searchChannels(text, true).then(results => {
                if (results.length) {
                    channels.search.go(text, 'live');
                }
                else {
                    throw new Error('no channel found, going to general search');
                }
            }).catch(err => {
                channels.search.go(text, 'all');
            }).finally(() => {
                renderer.get().emit('omni-callback', text, true);
            });
        });
        lists.on('status', status => {
            const enabled = lists.satisfied && status.length;
            if (enabled != this.enabled) {
                this.enabled = enabled;
                renderer.get().emit(enabled ? 'omni-enable' : 'omni-disable');
            }
        });
    }
}
export default new OMNI();
