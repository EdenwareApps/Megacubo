import { main } from '../../../modules/bridge/renderer';
import { Menu } from '../../../modules/menu/renderer'
import { OMNI } from '../../../modules/omni/renderer'
import { AndroidWinActions, ElectronWinActions} from './window-actions'
import { Hotkeys } from './hotkeys'
import { Clock } from './clock'
import { css, traceback } from './utils'
import swipey from 'swipey.js'
import FFmpegController from '../../../modules/ffmpeg/renderer'
import { ImageProcessor } from '../../../modules/icon-server/renderer'

function openExternalFile(file, mimetype) {
	console.log('openExternalFile', file);
	if (window.capacitor) {
		alert('Cannot open file: ' + file.split('/').pop())
	} else if (parent.api) { // electron
		parent.api.openExternal(file)
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
    if (!main.menu || main.menu.inModal()) return
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
				channel.post('message', ['open-url', url.replace(new RegExp('.*megacubo\.tv/(w|assistir)/', ''), 'mega://')]);
			})
		}
	}, 0);
}

const setupFontDetector = () => {
    if(typeof(window.isFontAvailable) != 'function'){
        var width, body = document.body || document.querySelector('body')  
        var container = document.createElement('span')
        container.innerHTML = Array(100).join('wi')
        container.style.cssText = [
            'position:absolute',
            'width:auto',
            'font-size:128px',
            'left:-99999px'
        ].join(' !important;')
        var getWidth = fontFamily => {
            container.style.fontFamily = fontFamily.split(',').map(f => "'"+ f.trim() +"'").join(',')
            body.appendChild(container)
            width = container.clientWidth
            body.removeChild(container)        
            return width
        }
        // Pre compute the widths of monospace, serif & sans-serif
        // to improve performance.
        var monoWidth  = getWidth('monospace')
        var serifWidth = getWidth('serif')
        var sansWidth  = getWidth('sans-serif')  
        window.isFontAvailable = font => {
          return monoWidth !== getWidth(font + ',monospace') ||
            sansWidth !== getWidth(font + ',sans-serif') ||
            serifWidth !== getWidth(font + ',serif');
        }
    }
}

const getFontList = () => {
    setupFontDetector()
    return [
        '-apple-system',
        'Arial',
        'BlinkMacSystemFont', 
        'Calibri',
        'Cantarell', 
        'Century Gothic',
        'Comic Sans',
        'Consolas',
        'Courier',
        'Dejavu Sans',
        'Dejavu Serif',
        'Futura',
        'Georgia',
        'Gill Sans',
        'Gotham',
        'Helvetica',
        'Helvetica Neue', 
        'Impact',
        'Lato',
        'Lucida Sans',
        'Myriad Pro',
        'Netflix Sans',
        'Open Sans',
        'Oxygen-Sans', 
        'Palatino',
        'Roboto',
        'Segoe UI', 
        'sans-serif',
        'Tahoma',
        'Times New Roman',
        'Trebuchet',
        'Ubuntu', 
        'Verdana',
        'Zapfino'
    ].filter(isFontAvailable)
}

export const initApp = async () => {
    window.main = main
    main.imp = new ImageProcessor(main)
    main.on('clipboard-write', (text, successMessage) => {
        if(window.capacitor) {
            return window.capacitor.clipboard(text).then(ret => {
                successMessage && main.osd.show(successMessage, 'fas fa-check-circle faclr-green', 'clipboard', 'normal')
            }).catch(err => {
                main.osd.show(String(err.message || err), 'fas fa-exclamation-triangle faclr-red', 'clipboard', 'normal')
            })
        }
        if (!top.navigator.clipboard) {
            main.osd.show('Your webview doesn\'t supports copying to clipboard.', 'fas fa-exclamation-triangle faclr-red', 'clipboard', 'normal')
            return
        }
        top.navigator.clipboard.writeText(text).then(() => {
            successMessage && main.osd.show(successMessage, 'fas fa-check-circle faclr-green', 'clipboard', 'normal')
        }).catch(err => {
            main.osd.show(String(err.message || err), 'fas fa-exclamation-triangle faclr-red', 'clipboard', 'normal')
        })
    })
    main.on('clipboard-read', (callbackId, timeoutMs=0) => {
        main.menu.readClipboard(timeoutMs).then(text => {
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
        document.querySelector('head, body').appendChild(s)
    })
    main.on('call-js', content => {
        console.log('CALLJS')
        const s = document.createElement('script'), b = document.querySelector('head, body')
        s.textContent = content
        b.appendChild(s)
        setTimeout(() => b.removeChild(s), 100)
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
    menu = new Menu(document.querySelector('#menu'))
    main.menu = menu
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
                const selected = menu.selectedElementX
                console.warn('idle active', selected, selected?.parentNode?.tagName?.toLowerCase() || null)
                if (selected?.parentNode?.tagName?.toLowerCase() == 'seekbar') {
                    reset()
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
            if (s == 'playing' && menu.modalContainer && menu.modalContainer.querySelector('#modal-template-option-wait')) {
                menu.endModal()
            }
        })
        main.streamer.on('hide', () => {
            menu.sideMenu(false, 'instant')
            menu.showWhilePlaying(false)
            if (menu.modalContainer && (
                menu.modalContainer.querySelector('#modal-template-option-wait') ||
                menu.modalContainer.querySelector('#modal-template-option-resume')
            )) {
                menu.endModal()
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
        main.on('streamer-connect', () => {
            menu.sideMenu(false, 'instant')
        })
        main.on('streamer-disconnect', () => menu.sideMenu(false, 'instant'))
        const WinActions = window.capacitor ? AndroidWinActions : ElectronWinActions
        window.winActions = new WinActions(main)
        main.on('open-file', (uploadURL, callbackId, mimetypes) => {
            const next = () => {
                menu.openFile(uploadURL, callbackId, mimetypes).catch(err => {
                    main.osd.show(String(err), 'fas fa-exclamation-triangle', 'menu', 'normal')
                    main.emit(callbackId, null)
                }).finally(() => {
                    winActions && winActions.backgroundModeUnlock('open-file')
                })
            }
            if (parent.Manager) {
                parent.Manager.openFile(mimetypes, (err, file) => main.emit(callbackId, err ? null : [file]))
            } else {
                window.capacitor && window.winActions && winActions.backgroundModeLock('open-file')
                next()
            }
        })
        main.on('restart', () => winActions && winActions.restart())
        main.on('ask-exit', () => winActions && winActions.askExit())
        main.on('ask-restart', () => winActions && winActions.askRestart())
        main.on('exit', force => winActions && winActions.exit(force))
        main.on('background-mode-lock', name => {
            if (player && winActions) winActions && winActions.backgroundModeLock(name)
        })
        main.on('background-mode-unlock', name => {
            if (player && winActions) winActions && winActions.backgroundModeUnlock(name)
        });

        if (window.capacitor) {
            winActions && winActions.setBackgroundMode(true) // enable once at startup to prevent service not registered crash
            window.cordova.plugins.backgroundMode.disableBatteryOptimizations()
            setTimeout(() => winActions && winActions.setBackgroundMode(false), 5000)
            window.cordova.plugins.backgroundMode.setDefaults({
                title: document.title,
                text: main.lang.RUNNING_IN_BACKGROUND || '...',
                icon: 'icon', // this will look for icon.png in platforms/android/res/drawable|mipmap
                color: main.config['background-color'].slice(-6), // hex format like 'F14F4D'
                resume: true,
                hidden: true,
                silent: false,
                allowClose: true,
                closeTitle: main.lang.CLOSE || 'X'
                //, bigText: Boolean
            })
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
    
    menu.on('modal-start', () => menu.reset())
    menu.on('pos-modal-end', () => menu.reset())
    menu.on('focus', () => menu.sounds.play('menu', 7))
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
    
    document.querySelector('#menu-playing-close').addEventListener('click', () => {
        menu.showWhilePlaying(false)
    })
    document.querySelector('div#arrow-down-hint i').addEventListener('click', () => {
        menu.showWhilePlaying(true)
    })

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
    if(window.capacitor) { // tapping
        menu.sideMenu(false, 'instant')
        toggle.addEventListener('click', () => {
            menu.inSideMenu() || menu.inModal() || menu.sideMenu(true, 'smooth')
        })
        swipey.add(document.body, handleSwipe, { diagonal: false })
    } else { // pc mouse hovering
        toggle.addEventListener('mouseenter', () => {
            menu.inSideMenu() || menu.inModal() || menu.sideMenu(true)
        })
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
            element.addEventListener('mouseenter', () => {
                element.addEventListener('mouseleave', autoScrollClearTimer)
                autoScrollClearTimer()
                autoScrollDirection = o.direction
                autoScrollInterval = setInterval(autoScrollFn, 750)
                autoScrollFn()
            })
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
		const m = document.body.querySelector('div#modal > div > div')
		if (m) {
			const mi = m.querySelector('.modal-wrap')
			if (keyboardHeight) {		
				const h = window.innerHeight - keyboardHeight
				m.style.height = h + 'px'
				if (mi && mi.offsetHeight > h) {
					var mq = mi.querySelector('span.modal-template-question')
					if (mq) {
						mq.style.display = 'none'
					}
				}
			} else {
				m.style.height = '100vh'
				if (mi) {
					mi.querySelector('span.modal-template-question').style.display = 'flex'
				}
			}
		}
	}
}
