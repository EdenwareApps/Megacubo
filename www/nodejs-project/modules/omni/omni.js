const Events = require('events')

class OMNI extends Events {
    constructor (){
        super()
        this.bind()
    }
    bind(){
        global.ui.on('omni', (text, type) => {
            if(type == 'numeric'){
                let es = global.bookmarks.get().filter(e => e.bookmarkId == parseInt(text))
                global.ui.emit('omni-callback', text, !!es.length)
                console.warn('omni-callback', text, !!es.length, es)
                if(es.length){
                    global.streamer.play(es.shift())
                }
            } else {           
                global.channels.search(text, true).then(results => {
                    if(results.length > 1){
                        global.search.go(text, 'live')
                    } else if(results.length == 1) {
                        streamer.play(results[0])
                    } else {
                        throw new Error('no channel found, going to general search')
                    }
                }).catch(err => {
                    global.search.go(text, 'all')
                }).finally(() => {
                    global.ui.emit('omni-callback', text, true)
                })
            }
        })
        global.lists.manager.once('lists-updated', () => {
            global.ui.emit('omni-enable')
        })
    }
}

module.exports = OMNI
