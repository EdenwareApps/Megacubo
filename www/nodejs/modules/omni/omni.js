import { EventEmitter } from "events";
import { listNameFromURL, validateURL } from '../utils/utils.js'
import lang from "../lang/lang.js";
import renderer from '../bridge/bridge.js'

class OMNI extends EventEmitter {
    constructor() {
        super()
        renderer.ui.on('omni', (text, type) => this.open(text, type))
    }
    async open(text, type) {
        if (type == 'numeric') {
            const n = parseInt(text), es = global.channels.bookmarks.get().filter(e => e.bookmarkId == n);
            if (es.length) {
                renderer.ui.emit('omni-callback', text, !!es.length);
                console.warn('omni-callback', text, !!es.length, es);
                let entry = es.shift();
                if (entry.type == 'group') {
                    renderer.ui.emit('menu-playing')
                    global.menu.open([lang.BOOKMARKS, entry.name].join('/')).catch(e => global.menu.displayErr(e));
                    return
                } else {                        
                    global.streamer.play(entry)
                    renderer.ui.emit('menu-playing-close')
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
            renderer.ui.emit('omni-callback', text, true)
        });
    }
    async openURL(url) {
        const info = await global.streamer.streamInfo.probe(url)
        if (info.sample) {
            const sample = String(info.sample).substr(0, 128).toUpperCase()
            const isM3U = sample.includes('#EXTM3U')
            const isM3U8 = !sample.match(new RegExp('#EXT\-X\-(TARGETDURATION|MEDIA\-SEQUENCE)'))
            const hasStreamNames = sample.match(new RegExp('#EXTINF:.+,.*[A-Z]+'))    
            if (isM3U && !isM3U8 && hasStreamNames) {
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
        await lists.ready()
        await global.streamer.play(e)
    }
}
export default new OMNI();
