import { main } from '../../../modules/bridge/renderer'

export const hotkeysActions = {
    'HOME': [
        () => {
            if(main.menu.scrollTop()){
                main.menu.scrollTop(0)
            } else {
                main.menu.triggerAction('').catch(console.error)
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
            main.omni.focus()
        }, 'up', true
    ],
    'OPENURL': [
        () => {
            main.menu.triggerAction(main.lang.TOOLS, main.lang.OPEN_URL).catch(console.error)
        }, 'up', true
    ],
    'HISTORY': [
        () => {
            main.menu.triggerAction(main.lang.TOOLS, main.lang.KEEP_WATCHING).catch(console.error)
        }, 'up', true
    ],
    'BOOKMARKS': [
        () => {
            main.menu.triggerAction(main.lang.BOOKMARKS).catch(console.error)
        }, 'up', true
    ],
    'LANGUAGE': [
        () => {
            main.menu.triggerAction(main.lang.OPTIONS, main.lang.LANGUAGE).catch(console.error)
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
            if(streamer.isZapping){
                main.emit('zap')
            } else {
                main.emit('tune')
            }
        }, 'up', true
    ],
    'MINIPLAYER': [
        () => {
            winActions.toggle().catch(console.error)
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