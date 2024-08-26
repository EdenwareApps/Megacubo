import { EventEmitter } from "events";
import { listNameFromURL, validateURL } from '../utils/utils.js'
import lang from "../lang/lang.js";
import renderer from '../bridge/bridge.js'

class OMNI extends EventEmitter {
    constructor() {
        super()
    }
    async open(text, type) {
        if (type == 'numeric') {
            const n = parseInt(text), es = global.channels.bookmarks.get().filter(e => e.bookmarkId == n);
            if (es.length) {
                ui.emit('omni-callback', text, !!es.length);
                console.warn('omni-callback', text, !!es.length, es);
                let entry = es.shift();
                if (entry.type == 'group') {
                    ui.emit('menu-playing')
                    global.menu.open([lang.BOOKMARKS, entry.name].join('/')).catch(e => global.menu.displayErr(e));
                    return
                } else {                        
                    global.streamer.play(entry)
                    ui.emit('menu-playing-close')
                    return
                }
            }
        } else if(validateURL(text)) {
            return await this.openURL(text).catch(e => global.menu.displayErr(e))
        }
        await global.channels.searchChannels(text, true).then(results => {
            if (results.length) {
                global.channels.search.go(text, 'live');
            } else {
                throw new Error('no channel found, going to general search');
            }
        }).catch(err => {
            global.channels.search.go(text, 'all');
        }).finally(() => {
            ui.emit('omni-callback', text, true)
        });
    }
    async openURL(url) {
        const info = await global.streamer.streamInfo.probe(url)
        if(info.sample) {
            if(String(info.sample).substr(0, 24).toUpperCase().indexOf('#EXTM3U') != -1) { // is list
                return await global.lists.manager.addList(url)
            }
        }
        const name = listNameFromURL(url), e = {
            name,
            url,
            terms: {
                name: global.lists.tools.terms(name),
                group: []
            }
        };
        config.set('open-url', url);
        await lists.manager.waitListsReady()
        await global.streamer.play(e)
    }
}
export default new OMNI();
