import { main } from '../../../modules/bridge/renderer'

export const hotkeysActions = {
    'HOME': [
        () => {
            if(main.menu.scrollTop()){
                main.menu.scrollTop(0, true)
            } else {
                main.menu.triggerAction('').catch(err => {
                    console.error('Hotkey action failed:', err.message || err)
                })
            }
        }, 'up', true
    ],
    'PLAYPAUSE': [
        () => {
            if(main.menu.inPlayer()){
                streamer.playOrPause()
            }
        }, 'up'
    ],
    'PLAY_PREVIOUS': [
        () => {
            main.emit('go-prev')
        }, 'up'
    ],
    'PLAY_NEXT': [
        () => {
            main.emit('go-next')
        }, 'up'
    ],
    'BACKNOTINPUT': [
        () => {
            main.hotkeys.escapePressed()
        }, 'hold'
    ],
    'BACK': [
        () => { // with Ctrl it work on inputs so
            // ...
        }, 'up', true
    ],
    'SHOW_HIDE_MENU': [
        () => {
            main.hotkeys.tabPressed()
        }, 'up', true
    ],
    'ESCAPE': [
        () => {            
            main.hotkeys.escapePressed()
        }, 'up', true
    ],
    'STOP': [
        () => {
            main.streamer.stop()
        }, 'up', true
    ],
    'VOLUMEUP': [
        () => {
            main.streamer.volumeUp(1)
        }, 'hols', true
    ],
    'VOLUMEDOWN': [
        () => {
            main.streamer.volumeDown(1)
        }, 'hold', true
    ],
    'VOLUMEMUTE': [
        () => {
            main.streamer.volumeMute()
        }, 'up', true
    ],
    'SEEKREWIND': [
        () => {
            main.streamer.seekRewind()
        }, 'hold', true
    ],
    'SEEKFORWARD': [
        () => {
            main.streamer.seekForward()
        }, 'hold', true
    ],
    'NAVUP': [
        () => {
            main.hotkeys.arrowUpPressed()
        }, 'hold', true
    ],
    'NAVDOWN': [
        () => {
            main.hotkeys.arrowDownPressed()
        }, 'hold', true
    ],
    'NAVRIGHT': [
        () => {
            main.hotkeys.arrowRightPressed()
        }, 'hold', false
    ],
    'NAVLEFT': [
        () => {
            main.hotkeys.arrowLeftPressed()
        }, 'hold', false
    ],
    'NAVENTER': [
        () => {
            main.hotkeys.enterPressed()
        }, 'up'
    ],
    'SEARCH': [
        () => {
            main.omni.show(true)
        }, 'up', true
    ],
    'OPENURL': [
        () => {
            main.menu.triggerAction(main.lang.TOOLS, main.lang.OPEN_URL).catch(err => {
                console.error('Open URL action failed:', err.message || err)
            })
        }, 'up', true
    ],
    'PASTEURL': [
        () => {
            const focusedTag = document.activeElement.tagName;
            if(focusedTag === 'INPUT' || focusedTag === 'TEXTAREA') {
                return;
            }
            main.menu.readClipboard().then(url => {
                url && main.emit('open-url', url)
            }).catch(err => console.error(err))
        }, 'up', true
    ],
    'HISTORY': [
        () => {
            main.menu.triggerAction(main.lang.TOOLS, main.lang.KEEP_WATCHING).catch(err => {
                console.error('Keep watching action failed:', err.message || err)
            })
        }, 'up', true
    ],
    'BOOKMARKS': [
        () => {
            main.menu.triggerAction(main.lang.BOOKMARKS).catch(err => {
                console.error('Bookmarks action failed:', err.message || err)
            })
        }, 'up', true
    ],
    'LANGUAGE': [
        () => {
            main.menu.triggerAction(main.lang.OPTIONS, main.lang.LANGUAGE).catch(err => {
                console.error('Language options action failed:', err.message || err)
            })
        }, 'up', true
    ],
    'BOOKMARK': [
        () => {
            main.emit('toggle-fav')
        }, 'up', true
    ],
    'DEVTOOLS': [
        () => {
            main.emit('devtools')
        }, 'up', true
    ],
    'RELOAD': [
        () => {
            main.hotkeys.reload()
        }, 'up', true
    ],
    'MINIPLAYER': [
        () => {
            winActions.toggle().catch(err => {
                console.error('Window actions toggle failed:', err.message || err)
            })
        }, 'up', true
    ],
    'RECORDING': [
        () => {
            main.emit('recording')
        }, 'up', true
    ],
    'ABOUT': [
        () => {
            main.emit('about')
        }, 'up', true
    ],
    'FULLSCREEN': [
        () => {
            if(parent.Manager){
                parent.Manager.toggleFullScreen()
                if(window.main.idle.reset){
                    window.main.idle.reset()
                }
            }
        }, 'up', true
    ]
}