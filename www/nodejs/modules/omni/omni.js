import { EventEmitter } from "events";
import { isLocal, listNameFromURL, validateURL } from '../utils/utils.js'
import osd from '../osd/osd.js'
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
        } else if(validateURL(text) || isLocal(text)) {
            return this.openURL(text).catch(e => global.menu.displayErr(e))
        }
        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'omni', 'persistent')
        await global.channels.searchChannels(text, true).then(results => {
            osd.hide('omni')
            if (results.length) {
                global.channels.search.go(text, 'live');
            } else {
                throw new Error('no channel found, going to general search');
            }
        }).catch(err => {
            global.channels.search.go(text, 'all');
        }).finally(() => {
            osd.hide('omni')
            renderer.ui.emit('omni-callback', text, true)
        });
    }
    async openURL(url) {
        osd.show(lang.PROCESSING, 'fa-mega busy-x', 'omni', 'persistent')
        const info = await global.streamer.streamInfo.probe(url)
        if (info.sample) {
            const sample = String(info.sample).substr(0, 128).toUpperCase()
            const isM3U = sample.includes('#EXTM3U')
            const isM3U8 = sample.match(new RegExp('#EXT\-X\-(TARGETDURATION|MEDIA\-SEQUENCE)'))
            const hasStreamNames = sample.match(new RegExp('#EXTINF:.+,.*[A-Z]+'))
            if (isM3U && !isM3U8 && hasStreamNames) {
                osd.hide('omni')
                return global.lists.manager.addList(url)
            }
        } else if (info.ext == 'm3u') {
            osd.hide('omni')
            return global.lists.manager.addList(url)
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
        osd.hide('omni')
        await global.streamer.play(e)
    }
}
export default new OMNI();
