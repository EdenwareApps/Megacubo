import { EventEmitter } from "events";
import { isLocal, listNameFromURL, validateURL } from '../utils/utils.js'
import osd from '../osd/osd.js'
import lang from "../lang/lang.js";
import renderer from '../bridge/bridge.js'
import { distinguishM3UType } from '../lists/tools.js'
import config from '../config/config.js'

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
        // Don't show PROCESSING OSD here - let the search module handle its own OSD
        let err = null
        try {
            await global.channels.search.go(text, 'live'); // will fallback live -> all automatically if no channels or groups were found
        } catch (e) {
            err = e
        }
        renderer.ui.emit('omni-callback', text, !err)
        if (err) {
            console.error(err)
        }
    }
    async openURL(url) {
        osd.show(lang.SEARCHING, 'fa-mega busy-x', 'omni', 'persistent')
        try {
            const info = await global.streamer.streamInfo.probe(url)
            if (info.sample) {
                // Use distinguishM3UType to properly identify IPTV playlists
                const m3uType = distinguishM3UType(info.sample)
                if (m3uType.isIPTVPlaylist) {
                    osd.hide('omni')
                    return global.lists.manager.addList(url)
                }
            } else if (info.ext == 'm3u') {
                // If extension is .m3u, try to verify it's an IPTV playlist
                // If we don't have sample, assume it's an IPTV playlist for .m3u files
                osd.hide('omni')
                return global.lists.manager.addList(url)
            }
        } catch (e) {
            console.error(e)
        }
        try {
            const name = listNameFromURL(url), e = {
                name,
                url,
                terms: {
                    name: global.lists.tools.terms(name),
                    group: []
                }
            };
            config.set('open-url', url);
            await global.lists.ready()
            osd.hide('omni')
            await global.streamer.play(e)
        } catch (e) {
            console.error(e)
            osd.hide('omni')
        }
    }
}
export default new OMNI();
