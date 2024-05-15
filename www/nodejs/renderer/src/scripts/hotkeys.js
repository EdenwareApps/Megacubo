import { hotkeysActions } from './hotkeys-actions'
import { HotkeysHandler } from './hotkeys-handler'
import { main } from '../../../modules/bridge/renderer'

export class Hotkeys {
    constructor() {
        this.handler = new HotkeysHandler()
        this.shortcuts = []
    }
    create(key, callback, type, enableInInput) {
        key = key.replaceAll(' ', ',')
        let params = {
            type: type ? type : 'down',
            mask: key,
            enableInInput: !!enableInInput,
            handler: () => {
                console.log(key + ' pressed', document.URL)
                callback.call(window.top)
            }
        }
        this.handler.add(params)
        return params
    }
    start(hotkeys) {
        this.end()
        if (typeof (hotkeys) == 'object') {
            for (let key in hotkeys) {
                if (Array.isArray(hotkeysActions[hotkeys[key]])) {
                    key.split(' ').forEach(k => {
                        let args = hotkeysActions[hotkeys[key]].slice(0)
                        args.unshift(k)
                        this.shortcuts.push(this.create.apply(this, args))
                    })
                }
            }
            this.handler.start()
        } else {
            console.error('Error loading hotkey\'s actions.')
        }
    }
    end() {
        this.handler.stop()
        this.shortcuts.forEach(s => this.handler.remove(s))
    }
    getHotkeyAction(action, nowrap) {
        if (main.config['hotkeys']) {
            let key = ''
            Object.keys(main.config['hotkeys']).forEach(k => {
                if (main.config['hotkeys'][k] == action) {
                    key = k
                }
            })
            if (!key) {
                return ''
            }
            if (nowrap) {
                return key
            }
            return ' (' + key + ')'
        }
        return ''
    }
    arePlayerControlsVisible() {
        return window.streamer && [0, '0', '0px'].indexOf(window.getComputedStyle(main.streamer.controls).getPropertyValue('bottom')) != -1
    }
    escapePressed() {
        console.log('Escape pressed')
        if (main.menu.inModal()) {
            if (!main.menu.inModalMandatory()) {
                main.menu.endModal()
            }
        } else {
            if (main.streamer.casting) return main.streamer.castUIStop()
            let playing = main.menu.inPlayer(), exploring = playing && main.menu.isExploring()
            if (playing && !exploring) {
                if (main.streamer.state == 'playing' && this.arePlayerControlsVisible()) {
                    main.idle.start()
                    main.idle.lock(1)
                } else {
                    main.streamer.stop()
                }
            } else {
                if (main.menu.path) {
                    main.emit('menu-back')
                } else {
                    if (playing) {
                        main.idle.start()
                    }
                }
            }
        }
    }
    arrowUpPressed(noNav) {
        let playing = main.menu.inPlayer(), exploring = main.menu.isExploring()
        if (!main.menu.inModal() && playing && !exploring) {
            if (!noNav && main.streamer.isVolumeButtonActive()) {
                main.streamer.volumeUp(1)
            } else {
                main.idle.start()
                main.idle.lock(1)
            }
        } else {
            if (!noNav) main.menu.arrow('up')
        }
    }
    arrowDownPressed(noNav) {
        if (!main.menu.inModal() && main.menu.inPlayer()) {
            if (main.menu.isExploring()) {
                if (!noNav) main.menu.arrow('down')
            } else {
                if (!noNav && main.streamer.isVolumeButtonActive()) {
                    main.streamer.volumeDown(1)
                } else {
                    if (main.idle.isIdle) {
                        main.idle.reset()
                    } else if (noNav) {
                        main.emit('menu-menu-playing', true)
                        document.body.classList.add('menu-playing')
                    } else {
                        if (!noNav) main.menu.arrow('down')
                    }
                }
            }
        } else {
            let s = main.menu.selected()
            if (s && s.tagName.toLowerCase() == 'input' && s.id && s.id == 'menu-omni-input') {
                main.menu.focus(main.menu.currentElements[main.menu.selectedIndex])
            } else {
                if (!noNav) main.menu.arrow('down')
            }
        }
    }
    arrowRightPressed(noNav) {
        let playing = main.menu.inPlayer(), exploring = playing && main.menu.isExploring()
        if (playing && !exploring) {
            if (main.streamer.isSeeking) {
                main.streamer.seekForward()
            } else if (main.idle.isIdle || noNav) {
                main.streamer.seekForward()
                main.idle.start()
                main.idle.lock(1)
            } else {
                if (!noNav) main.menu.arrow('right')
            }
        } else {
            if (!noNav) main.menu.arrow('right')
        }
    }
    arrowLeftPressed(noNav) {
        let playing = main.menu.inPlayer(), exploring = playing && main.menu.isExploring()
        if (playing && !exploring) {
            if (main.streamer.isSeeking) {
                main.streamer.seekRewind()
            } else if (main.idle.isIdle || noNav) {
                main.streamer.seekRewind()
                main.idle.start()
                main.idle.lock(1)
            } else {
                if (!noNav) main.menu.arrow('left')
            }
        } else {
            if (!noNav) main.menu.arrow('left')
        }
    }
    enterPressed() {
        // ENTER PRESSED true true false <button class=​"menu selected">​…​</button>​ true false -1
        console.log('ENTER PRESSED', main.menu.inPlayer(), main.menu.isExploring(), this.arePlayerControlsVisible(), document.activeElement, main.streamer.active, main.idle.isIdle, document.body.className.indexOf('idle'))
        if (main.menu.inPlayer()) {
            let e = main.menu.selected(false)
            if (e) {
                if (main.idle.isIdle) {
                    if (main.streamer.state != 'paused') {
                        console.log('ENTER IGNORED ON IDLE OUT', e)
                        return main.idle.reset()
                    }
                }
            }
        }
    }
}

