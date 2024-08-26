import { hotkeysActions } from './hotkeys-actions'
import { HotkeysHandler } from './hotkeys-handler'
import { main } from '../../../modules/bridge/renderer'

class GamepadHandler {
    constructor() {
        this.connectedGamepads = {}
        this.lastActionTimes = {}
        this.minInterval = 200
        this.events = {
            x: [],
            o: [],
            up: [],
            down: [],
            left: [],
            right: []
        }
        window.addEventListener("gamepadconnected", (e) => {
            console.log("Gamepad connected:", e.gamepad)
            this.connectedGamepads[e.gamepad.index] = e.gamepad
            this.lastActionTimes[e.gamepad.index] = {
                leftStick: 0,
                rightStick: 0,
                dpadUp: 0,
                dpadDown: 0,
                dpadLeft: 0,
                dpadRight: 0,
                buttonX: 0,
                buttonO: 0
            }
            this.requestUpdate()
        })
        window.addEventListener("gamepaddisconnected", (e) => {
            console.log("Gamepad disconnected:", e.gamepad)
            delete this.connectedGamepads[e.gamepad.index]
            delete this.lastActionTimes[e.gamepad.index]
        })
    }
    requestUpdate() {
        if (!this.animationFrameId) {
            this.animationFrameId = window.requestAnimationFrame(this.updateGamepadStatus.bind(this))
        }
    }
    updateGamepadStatus() {
        if(!Object.keys(this.connectedGamepads)) return
        const now = Date.now()
        for (let index in this.connectedGamepads) {
            const gamepad = this.connectedGamepads[index]
            const lastActionTime = this.lastActionTimes[index]
            if (gamepad) {
                const buttonX = gamepad.buttons[0]
                const buttonO = gamepad.buttons[1]
                if (buttonX.pressed && this.canEmitEvent(lastActionTime.buttonX)) {
                    this.emit('x')
                    lastActionTime.buttonX = now
                }
                if (buttonO.pressed && this.canEmitEvent(lastActionTime.buttonO)) {
                    this.emit('o')
                    lastActionTime.buttonO = now
                }
                const dpadUp = gamepad.buttons[12]
                const dpadDown = gamepad.buttons[13]
                const dpadLeft = gamepad.buttons[14]
                const dpadRight = gamepad.buttons[15]
                if (dpadUp.pressed && this.canEmitEvent(lastActionTime.dpadUp)) {
                    this.emit('up')
                    lastActionTime.dpadUp = now
                }
                if (dpadDown.pressed && this.canEmitEvent(lastActionTime.dpadDown)) {
                    this.emit('down')
                    lastActionTime.dpadDown = now
                }
                if (dpadLeft.pressed && this.canEmitEvent(lastActionTime.dpadLeft)) {
                    this.emit('left')
                    lastActionTime.dpadLeft = now
                }
                if (dpadRight.pressed && this.canEmitEvent(lastActionTime.dpadRight)) {
                    this.emit('right')
                    lastActionTime.dpadRight = now
                }

                const threshold = 0.5
                const leftStickX = gamepad.axes[0]
                const leftStickY = gamepad.axes[1]
                const rightStickX = gamepad.axes[2]
                const rightStickY = gamepad.axes[3]
                
                if (leftStickX < -threshold && this.canEmitEvent(lastActionTime.leftStick)) {
                    this.emit('left')
                    lastActionTime.leftStick = now
                } else if (leftStickX > threshold && this.canEmitEvent(lastActionTime.leftStick)) {
                    this.emit('right')
                    lastActionTime.leftStick = now
                } else if (leftStickY < -threshold && this.canEmitEvent(lastActionTime.leftStick)) {
                    this.emit('up')
                    lastActionTime.leftStick = now
                } else if (leftStickY > threshold && this.canEmitEvent(lastActionTime.leftStick)) {
                    this.emit('down')
                    lastActionTime.leftStick = now
                }
            }
        }
        this.animationFrameId = window.requestAnimationFrame(this.updateGamepadStatus.bind(this))
    }
    canEmitEvent(lastTime) {
        const now = Date.now()
        return now - lastTime > this.minInterval
    }
    on(event, callback) {
        if (event in this.events) {
            this.events[event].push(callback)
        }
    }
    emit(event) {
        if (event in this.events) {
            this.events[event].forEach(callback => callback())
        }
    }
}

export class Hotkeys {
    constructor() {
        this.handler = new HotkeysHandler()
        this.gamepadHandler = new GamepadHandler()
        this.gamepadHandler.on('up', this.arrowUpPressed.bind(this))
        this.gamepadHandler.on('down', this.arrowDownPressed.bind(this))
        this.gamepadHandler.on('left', this.arrowLeftPressed.bind(this))
        this.gamepadHandler.on('right', this.arrowRightPressed.bind(this))
        this.gamepadHandler.on('x', this.enterPressed.bind(this))
        this.gamepadHandler.on('o', this.escapePressed.bind(this))
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
            if (main.omni.active()) return main.omni.hide()
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
                    } else {
                        if(main.menu.inSideMenu()) {
                            menu.sideMenu(false)
                        } else if(!menu.inModal()) {
                            menu.sideMenu(true)
                        }
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
            noNav || main.menu.arrow('up')
        }
    }
    arrowDownPressed(noNav) {
        if (!main.menu.inModal() && main.menu.inPlayer()) {
            if (main.menu.isExploring()) {
                noNav || main.menu.arrow('down')
            } else {
                if (!noNav && main.streamer.isVolumeButtonActive()) {
                    main.streamer.volumeDown(1)
                } else {
                    if (main.idle.isIdle) {
                        main.idle.reset()
                    } else if (noNav) {
                        main.emit('menu-playing', true)
                        document.body.classList.add('menu-playing')
                    } else {
                        noNav || main.menu.arrow('down')
                    }
                }
            }
        } else {
            let s = main.menu.selected()
            if (s && s.tagName.toLowerCase() == 'input' && s.id && s.id == 'menu-omni-input') {
                main.menu.focus(main.menu.currentElements[main.menu.selectedIndex])
            } else {
                noNav || main.menu.arrow('down')
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
                noNav || main.menu.arrow('right')
            }
        } else {
            noNav || main.menu.arrow('right')
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
                noNav || main.menu.arrow('left')
            }
        } else {
            noNav || main.menu.arrow('left')
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

