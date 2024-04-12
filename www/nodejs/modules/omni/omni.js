const { EventEmitter } = require('events')

class OMNI extends EventEmitter {
    constructor (){
        super()
        global.renderer.on('omni-client-ready', () => {
            if(this.enabled){
                global.renderer.emit('omni-enable') // on linux, ui was loading after lists update, this way the search field was not showing up
            }
        })
        global.renderer.on('omni', (text, type) => {
            if(type == 'numeric'){
                const bookmarks = require('../bookmarks')
                let es = bookmarks.get().filter(e => e.bookmarkId == parseInt(text))
                if(es.length){
                    global.renderer.emit('omni-callback', text, !!es.length)
                    console.warn('omni-callback', text, !!es.length, es)
                    let entry = es.shift()
                    if(entry.type == 'group'){
                        return global.menu.open([global.lang.BOOKMARKS, entry.name].join('/')).catch(displayErr)
                    } else {
                        const streamer = require('../streamer/main')
                        return streamer.play(entry)
                    }
                }
            }
            const search = require('../search')
            global.channels.search(text, true).then(results => {
                if(results.length){
                    search.go(text, 'live')
                } else {
                    throw new Error('no channel found, going to general search')
                }
            }).catch(err => {
                search.go(text, 'all')
            }).finally(() => {
                global.renderer.emit('omni-callback', text, true)
            })
        })
        const lists = require('../lists')
        lists.on('status', status => {
            const enabled = lists.satisfied && status.length
            if(enabled != this.enabled) {
                this.enabled = enabled
                global.renderer.emit(enabled ? 'omni-enable' : 'omni-disable')
            }
        })
    }
}

module.exports = new OMNI()
