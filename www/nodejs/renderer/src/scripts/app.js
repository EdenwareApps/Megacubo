import { main } from '../../../modules/bridge/renderer';
import { Menu } from '../../../modules/menu/renderer'
import { OMNI } from '../../../modules/omni/renderer'
import { AndroidWinActions, ElectronWinActions} from './window-actions'
import { Hotkeys } from './hotkeys'
import { getFontList } from './font-detector'
import { css, traceback } from './utils'
import swipey from 'swipey.js'
import FFmpegController from '../../../modules/ffmpeg/renderer'
import { ImageProcessor } from '../../../modules/icon-server/renderer'

let menu;

function openExternalFile(file, mimetype) {
	console.log('openExternalFile', file);
	if (window.capacitor) {
		alert('Cannot open file: ' + file.split('/').pop())
	} else if (parent.electron) { // electron
		parent.electron.openExternal(file)
	} else {
		window.open(file, '_system')
	}
}

var hidingBackButton = false
function hideBackButton(doHide) {
    if (doHide != hidingBackButton) {
        hidingBackButton = doHide
        if (hidingBackButton) {
            css(' #menu a[data-type="back"] { display: none; } ', 'hide-back-button')
        } else {
            css(' ', 'hide-back-button')
        }
    }
}

function configUpdated() {
    menu.sounds.enabled = main.config['ui-sounds']
    const ms = main.config['view-size']
    menu.setGrid(ms.landscape.x, ms.landscape.y, ms.portrait.x, ms.portrait.y)
    hideBackButton(main.config['hide-back-button'])
    if (typeof(window['winActions']) == 'undefined' || !window['winActions']) {
        return
    }
    window['winActions'].enabled = main.config['miniplayer-auto']
    if (!window.capacitor) {
        parent.Manager.fsapi = !!main.config['fsapi']
        if (!window.configReceived) { // run once
            window.configReceived = true
            switch (main.config['startup-window']) {
                case 'fullscreen':
                    if (parent.Manager && parent.Manager.setFullScreen) {
                        parent.Manager.setFullScreen(true)
                    }
                    break
                case 'miniplayer':
                    window['winActions'].enter()
                    break
            }
        }
    }
}

function handleSwipe(e) {
    if (!main.menu || main.menu?.dialogs.inDialog()) return
    console.log('swipey', e)
    let orientation = innerHeight > innerWidth ? 'portrait' : 'landscape'
    let swipeDist, swipeArea = ['up', 'down'].includes(e.direction) ? innerHeight : innerWidth
    switch (e.direction) {
        case 'left':
        case 'right':
            swipeDist = swipeArea / (orientation == 'portrait' ? 2 : 3)
            break
        case 'up':
        case 'down': // dont use default here to ignore diagonal moves
            swipeDist = swipeArea / (orientation == 'portrait' ? 3 : 2)
            break
    }
    if (swipeDist && e.swipeLength >= swipeDist) {
        let swipeWeight = Math.round((e.swipeLength - swipeDist) / swipeDist)
        if (swipeWeight < 1) swipeWeight = 1
        console.log('SWIPE WEIGHT', swipeWeight)
        switch (e.direction) {
            case 'left':
                if (main.menu.inPlayer() && !main.menu.isVisible()) {
                    main.hotkeys.arrowRightPressed(true)
                }
                break
            case 'right':
                if (main.menu.inPlayer() && !main.menu.isVisible()) {
                    main.hotkeys.arrowLeftPressed(true)
                }
                break
            case 'up': // go down
                if (main.menu.inPlayer()) {
                    if (!main.menu.isVisible()) {
                        main.hotkeys.arrowDownPressed(true)
                    }
                }
                break
            case 'down': // go up
                if (main.menu.inPlayer()) {
                    if (main.menu.isVisible()) {
                        if (!main.menu.scrollContainer.scrollTop) {
                            main.emit('menu-playing', true)
                            document.body.classList.remove('menu-playing')
                        }
                    } else {
                        main.hotkeys.arrowUpPressed()
                    }
                }
                break
        }
    }
}

window.handleOpenURL = url => { // avoid local scoping
	setTimeout(function() {
		if (url && url.match('^[a-z]*:?//')) {
			main.waitMain(() => {
				channel.post('message', ['open-url', url.replace(new RegExp('.*megacubo\\.tv/(w|assistir)/', ''), 'mega://')]);
			})
		}
	}, 0);
}

export const initApp = async () => {
    window.main = main
    main.imp = new ImageProcessor(main)
    main.on('clipboard-write', (text, successMessage) => {
        main.menu.writeClipboard(text).then(() => {
            successMessage && main.osd.show(successMessage, 'fas fa-check-circle faclr-green', 'clipboard', 'normal')
        }).catch(err => {
            main.osd.show(String(err.message || err), 'fas fa-exclamation-triangle faclr-red', 'clipboard', 'normal')
        })
    })
    main.on('clipboard-read', (callbackId) => {
        main.menu.readClipboard().then(text => {
            main.emit(callbackId, null, text)
        }).catch(err => {
            console.error(err)
            main.emit(callbackId, null, '')
        })
    })
    main.on('open-external-url', url => winActions.openExternalURL(url))
    main.on('open-external-file', (url, mimetype) => openExternalFile(url, mimetype))
    main.on('load-js', src => {        
        console.warn('LOADJS ' + src)
        var s = document.createElement('script')
        s.src = src
        s.async = true
        const target = document.querySelector('head, body')
        if (target) target.appendChild(s)
    })
    main.on('call-js', content => {
        console.log('Call JS')
        const s = document.createElement('script'), b = document.querySelector('head, body')
        s.textContent = content
        if (b) {
            b.appendChild(s)
            setTimeout(() => b.removeChild(s), 100)
        }
    })
    main.on('download', async (url, name) => {
        console.log('download', url, name)
        if (window.capacitor) {
            await capacitor.NativeFileDownloader.scheduleFileDownload({url, fileName: name})
        } else {
            let e = document.createElement('a')
            e.setAttribute('href', url)
            e.setAttribute('download', name)
            e.style.display = 'none'
            document.body.appendChild(e)
            e.click()
            document.body.removeChild(e)
        }
    })
    main.on('config', configUpdated)
    main.on('fontlist', () => main.emit('fontlist', getFontList()))
    main.on('css', (css, id) => main.css(css, id))
    console.log('load app')
    const menuElement = document.querySelector('#menu')
    if (menuElement) {
        main.menu = menu = new Menu(menuElement)
    } else {
        console.error('Menu element not found')
        return
    }
    main.on('sound', (n, v) => menu.sounds.play(n, v))
    menu.on('render', path => {   
        if(menu.lastNavPath !== path || menu.sideMenuPending) {
            menu.sideMenuPending = false
            menu.lastNavPath = path
            menu.sideMenu(false, 'instant')
        }
        if (path) {
            if (document.body.classList.contains('home')) {
                document.body.classList.remove('home')
            }   
        } else {
            document.body.classList.add('home')    
        }
    })

    configUpdated([], main.config);
    main.on('streamer-ready', () => {
        const reset = () => menu.emit('reset', true)
        main.streamer.on('streamer-pause', reset)
        main.streamer.on('start', () => {
            main.menu.showWhilePlaying(false)
            reset()
        })
        main.streamer.on('show', reset)
        main.idle.on('active', () => {
            if (menu.inPlayer() && !menu.isVisible()) {
                if (main.streamer?.seekbarFocus() && main.idle.idleTime() > 1) {
                    main.menu.emit('focus-index', 0)
                }
            }
        })
        main.menu.on('x-focus', (idx, e) => {
            if(e == main.streamer.seekbar.lastElementChild) {
                main.streamer.setSeeking()
            } else {
                main.streamer.unsetSeeking()
            }
        })
        main.streamer.on('state', s => {
            if (s == 'playing' && menu.dialogs.container && menu.dialogs.container.querySelector('#dialog-template-option-wait')) {
                menu.dialogs.end(true)
            }
        })
        main.streamer.on('hide', () => {
            menu.sounds.play('click-out', {volume: 30})
            menu.sideMenu(false, 'instant')
            menu.showWhilePlaying(false)
            if (menu.dialogs.container && (
                menu.dialogs.container.querySelector('#dialog-template-option-wait') ||
                menu.dialogs.container.querySelector('#dialog-template-option-resume')
            )) {
                menu.dialogs.end(true)
            } else {
                menu.emit('reset', true)
            }
        })
        const buttons = {
            play: document.querySelector('.control-layer-icon.cl-icon-play'),
            stop: document.querySelector('.control-layer-icon.cl-icon-stop'),
            menu: document.querySelector('.control-layer-icon.cl-icon-menu')
        }
        const titles = {
            play: main.lang.PLAY,
            stop: main.lang.STOP,
            menu: main.lang.MORE
        }
        const actions = {
            play: () => main.streamer.playOrPauseNotIdle(),
            stop: () => {
                if(main.streamer.casting) return main.streamer.castUIStop()
                main.streamer.stop()
            },
            menu: () => menu.showWhilePlaying(true)
        }
        for(const k in buttons) {
            buttons[k].setAttribute('title', titles[k])
            buttons[k].setAttribute('aria-label', titles[k])
            buttons[k].addEventListener('click', actions[k])
        }
        main.on('streamer-connect', () => menu.sideMenu(false, 'instant'))
        main.on('streamer-disconnect', () => menu.sideMenu(false, 'instant'))
        const WinActions = window.capacitor ? AndroidWinActions : ElectronWinActions
        window.winActions = new WinActions(main)
        main.on('open-file', (uploadURL, callbackId, mimetypes) => {
            const next = () => {
                menu.openFile(uploadURL, callbackId, mimetypes).catch(err => {
                    main.osd.show(String(err), 'fas fa-exclamation-triangle', 'menu', 'normal')
                    main.emit(callbackId, null)
                }).finally(() => {
                    winActions.backgroundModeUnlock('open-file')
                })
            }
            if (parent.Manager) {
                parent.Manager.openFile(mimetypes, (err, file) => main.emit(callbackId, err ? null : [file]))
            } else {
                window.capacitor && winActions.backgroundModeLock('open-file')
                next()
            }
        })
        main.on('restart', () => winActions.restart())
        main.on('ask-exit', () => winActions.askExit())
        main.on('ask-restart', () => winActions.askRestart())
        main.on('exit', force => winActions.exit(force))
        main.on('background-mode-lock', name => {
            if (player) winActions.backgroundModeLock(name)
        })
        main.on('background-mode-unlock', name => {
            if (player) winActions.backgroundModeUnlock(name)
        });

        if (window.capacitor) {
            winActions.setBackgroundModeDefaults({
                title: document.title,
                text: main.lang.RUNNING_IN_BACKGROUND || '...',
                icon: 'icon', // this will look for icon.png in platforms/android/res/drawable|mipmap
                color: main.config['background-color'].slice(-6), // hex format like 'F14F4D'
                resume: true,
                hidden: true,
                silent: false,
                allowClose: true,
                closeTitle: main.lang.CLOSE || 'X'
            })
            winActions.setBackgroundMode(true) // enable once at startup to prevent service not registered crash
            setTimeout(() => winActions.setBackgroundMode(false), 5000)
        } else {
            document.body.addEventListener('dblclick', event => {
                const valid = event.clientY < (window.innerHeight / 10)
                if (valid) {
                    main.streamer.toggleFullScreen()
                    event.preventDefault()
                    event.stopPropagation()
                }
            })
        }
        parent.Manager && parent.Manager.appLoaded()
    })
    
    menu.on('dialog-start', () => menu.reset())
    menu.on('dialog-end', () => menu.reset())
    menu.on('x-select', (element) => {
        const key = element ? menu.getKey(element) : null;
        if (key == main.menu.lastSelectedKey) return;
        main.menu.lastSelectedKey = key;
        main.menu.sounds.play('click-in', {volume: 30})
    })
    
    menu.on('menu-playing', enable => {
        main.emit('menu-playing', enable)
        main.idle.reset()
        main.idle.lock(0.1)
    })

    menu.on('side-menu', () => menu.reset(true))
    main.on('menu-playing', () => menu.showWhilePlaying(true))
    main.on('menu-playing-close', () => menu.showWhilePlaying(false))

    main.localEmit('menu-ready')
    main.emit('menu-ready')
    
    const menuCloseBtn = document.querySelector('#menu-playing-close')
    if (menuCloseBtn) {
        menuCloseBtn.addEventListener('click', () => {
            menu.showWhilePlaying(false)
        })
    }
    
    const arrowHintBtn = document.querySelector('div#arrow-down-hint i')
    if (arrowHintBtn) {
        arrowHintBtn.addEventListener('click', () => {
            menu.showWhilePlaying(true)
        })
    }

    main.omni = new OMNI()
    main.omni.on('show', () => menu.sideMenu(false, 'instant'))
    main.omni.on('hide', () => menu.reset())

    const wrap = document.querySelector('svelte-virtual-grid-contents')

    configUpdated([], config)

    main.hotkeys = new Hotkeys()
    main.hotkeys.start(main.config.hotkeys)
    main.on('config', (keys, c) => {
        if (keys.includes('hotkeys')) {
            main.hotkeys.start(c.hotkeys)
        }
    })

    var toggle = document.querySelector('.side-menu-toggle')
    if(toggle && window.capacitor) { // tapping
        toggle.addEventListener('click', () => {
            menu.inSideMenu() || menu.dialogs.inDialog() || menu.sideMenu(true, 'smooth')
        })
        swipey.add(document.body, handleSwipe, { diagonal: false })
    } else if(toggle) { // pc mouse hovering
        toggle.addEventListener('mouseenter', () => {
            menu.inSideMenu() || menu.dialogs.inDialog() || menu.sideMenu(true)
        })
    }
    
    if (wrap) {
        wrap.addEventListener('mouseenter', () => menu.sideMenu(false))

        let autoScrollInterval = 0, autoScrollDirection = 'down'
        const autoScrollFn = () => {
            menu.emit('arrow', autoScrollDirection, true)
        }
        const autoScrollClearTimer = () => clearInterval(autoScrollInterval);
        for (const o of [
            { direction: 'up'},
            { direction: 'down'}
        ]) {
            const element = document.querySelector('#arrow-'+ o.direction)
            if (element) {
                element.addEventListener('mouseenter', () => {
                    element.addEventListener('mouseleave', autoScrollClearTimer)
                    autoScrollClearTimer()
                    autoScrollDirection = o.direction
                    autoScrollInterval = setInterval(autoScrollFn, 750)
                    autoScrollFn()
                })
            }
        }
    }

    var mouseWheelMovingTime = 0, mouseWheelMovingInterval = 200;
    window.capacitor || ['mousewheel', 'DOMMouseScroll'].forEach(n => {
        window.addEventListener(n, event => {
            if (!menu.inPlayer() || menu.isVisible()) return
            let now = (new Date()).getTime()
            if (now > (mouseWheelMovingTime + mouseWheelMovingInterval)) {
                mouseWheelMovingTime = now
                let delta = (event.wheelDelta || -event.detail)
                if (delta > 0) {
                    //this.seekForward()
                    main.hotkeys.arrowUpPressed()
                } else {
                    //this.seekRewind()
                    main.hotkeys.arrowDownPressed()
                }
            }
        })
    })

    main.on('share', (title, text, url) => {
        console.log('share', title, text, url)
        if (window.capacitor) {
            capacitor.Share.share({
                text,
                url,
                title
            }).catch(err => {
                console.error('Share error', err)
            })
        } else {
            winActions.openExternalURL('https://megacubo.tv/share/?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title) + '&text=' + encodeURIComponent(text))
        }
    })
    main.idle.on('idle', () => {
        if (menu.inPlayer() && !menu.isVisible()) {
            if (document.activeElement != document.body) {
                document.activeElement.blur()
            }
        }
    })
    main.menu.wrap.addEventListener('scroll', () => main.idle.reset());
    
    const ffmpeg = new FFmpegController(parent.ffmpeg)
    if(!window.capacitor) {
        main.on('ffmpeg-path', (dir, executable) => {
            console.log('ffmpeg-path', dir, executable)
            ffmpeg.master.setExecutable(dir +'/'+ executable)
        })        
    }
    ffmpeg.bind()

    main.localEmit('renderer')
}

window.onerror = function (message, file, line, column, errorObj) {
	let stack = typeof errorObj == 'object' && errorObj !== null && errorObj.stack ? errorObj.stack : traceback();
	console.error(errorObj || message, { errorObj, message, file, stack });
	return true;
}
	
if (window.capacitor) {
    capacitor.App.addListener('backButton', () => {
        main.hotkeys && main.hotkeys.escapePressed()
    })
	capacitor.Keyboard.addListener('keyboardWillShow', function (event) {
		adjustLayoutForKeyboard(event.keyboardHeight)
	})
	capacitor.Keyboard.addListener('keyboardWillHide', function () {
		adjustLayoutForKeyboard(false)
	})
	function adjustLayoutForKeyboard(keyboardHeight) {
		const m = document.body.querySelector('div#dialog > div > div')
		if (m) {
			const mi = m.querySelector('.dialog-wrap')
			if (keyboardHeight) {		
				const h = window.innerHeight - keyboardHeight
				m.style.height = h + 'px'
				if (mi && mi.offsetHeight > h) {
					var mq = mi.querySelector('span.dialog-template-question')
					if (mq) {
						mq.style.display = 'none'
					}
				}
			} else {
				m.style.height = '100vh'
				if (mi) {
					mi.querySelector('span.dialog-template-question').style.display = 'flex'
				}
			}
		}
	}
}
