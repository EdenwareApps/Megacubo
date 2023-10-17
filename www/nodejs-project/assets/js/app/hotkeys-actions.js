var hotkeysActions = {
    'HOME': [
        () => {
            if(explorer.scrollContainer.scrollTop()){
                explorer.scrollContainer.scrollTop(0)
            } else {
                explorer.triggerAction('').catch(console.error)
            }
        }, 'up', true
    ],
    'PLAYPAUSE': [
        () => {
            if(explorer.inPlayer()){
                streamer.playOrPause()
            }
        }, 'up'
    ],
    'PLAY_PREVIOUS': [
        () => {
            app.emit('go-prev')
        }, 'up'
    ],
    'PLAY_NEXT': [
        () => {
            app.emit('go-next')
        }, 'up'
    ],
    'BACKNOTINPUT': [
        () => {
            escapePressed()
        }, 'hold'
    ],
    'BACK': [
        () => { // with Ctrl it work on inputs so
            // ...
        }, 'up', true
    ],
    'ESCAPE': [
        () => {
            escapePressed()
        }, 'up', true
    ],
    'STOP': [
        () => {
            streamer.stop()
        }, 'up', true
    ],
    'VOLUMEUP': [
        () => {
            streamer.volumeUp(1)
        }, 'hols', true
    ],
    'VOLUMEDOWN': [
        () => {
            streamer.volumeDown(1)
        }, 'hold', true
    ],
    'VOLUMEMUTE': [
        () => {
            streamer.volumeMute()
        }, 'up', true
    ],
    'SEEKREWIND': [
        () => {
            streamer.seekRewind()
        }, 'hold', true
    ],
    'SEEKFORWARD': [
        () => {
            streamer.seekForward()
        }, 'hold', true
    ],
    'NAVUP': [
        () => {
            arrowUpPressed()
        }, 'hold', true
    ],
    'NAVDOWN': [
        () => {
            arrowDownPressed()
        }, 'hold', true
    ],
    'NAVRIGHT': [
        () => {
            arrowRightPressed()
        }, 'hold', false
    ],
    'NAVLEFT': [
        () => {
            arrowLeftPressed()
        }, 'hold', false
    ],
    'NAVENTER': [
        () => {
            enterPressed()
        }, 'up'
    ],
    'SEARCH': [
        () => {
            omni.focus()
        }, 'up', true
    ],
    'OPENURL': [
        () => {
            explorer.triggerAction(lang.TOOLS, lang.OPEN_URL).catch(console.error)
        }, 'up', true
    ],
    'HISTORY': [
        () => {
            explorer.triggerAction(lang.TOOLS, lang.KEEP_WATCHING).catch(console.error)
        }, 'up', true
    ],
    'BOOKMARKS': [
        () => {
            explorer.triggerAction(lang.BOOKMARKS).catch(console.error)
        }, 'up', true
    ],
    'LANGUAGE': [
        () => {
            explorer.triggerAction(lang.OPTIONS, lang.LANGUAGE).catch(console.error)
        }, 'up', true
    ],
    'BOOKMARK': [
        () => {
            app.emit('toggle-fav')
        }, 'up', true
    ],
    'DEVTOOLS': [
        () => {
            app.emit('devtools')
        }, 'up', true
    ],
    'RELOAD': [
        () => {
            if(streamer.isZapping){
                app.emit('zap')
            } else {
                app.emit('tune')
            }
        }, 'up', true
    ],
    'MINIPLAYER': [
        () => {
            parent.winman.toggle().catch(console.error)
        }, 'up', true
    ],
    'RECORDING': [
        () => {
            app.emit('recording')
        }, 'up', true
    ],
    'ABOUT': [
        () => {
            app.emit('about')
        }, 'up', true
    ],
    'FULLSCREEN': [
        () => {
            if(parent.parent.Manager){
                parent.parent.Manager.toggleFullScreen()
                if(window.idle.reset){
                    window.idle.reset()
                }
            }
        }, 'up', true
    ]
}