const Events = require('events')

class OMNI extends Events {
    constructor (){
        super()
        this.bind()
    }
    bind(){
        global.ui.on('omni-client-ready', () => {
            if(this.omniEnabled){
                global.ui.emit('omni-enable') // on linux, ui was loading after lists update, this way the search field was not showing up
            }
        })
        global.ui.on('omni', (text, type) => {
            if(type == 'numeric'){
                let es = global.bookmarks.get().filter(e => e.bookmarkId == parseInt(text))
                if(es.length){
                    global.ui.emit('omni-callback', text, !!es.length)
                    console.warn('omni-callback', text, !!es.length, es)
                    let entry = es.shift()
                    if(entry.type == 'group'){
                        return global.explorer.open([global.lang.BOOKMARKS, entry.name].join('/'))
                    } else {
                        return global.streamer.play(entry)
                    }
                }
            }     
            global.channels.search(text, true).then(results => {
                if(results.length){
                    global.search.go(text, 'live')
                } else {
                    throw new Error('no channel found, going to general search')
                }
            }).catch(err => {
                global.search.go(text, 'all')
            }).finally(() => {
                global.ui.emit('omni-callback', text, true)
            })
        })
        global.lists.manager.once('lists-updated', () => {
            this.omniEnabled = true
            global.ui.emit('omni-enable')
        })

    }
}

module.exports = OMNI
