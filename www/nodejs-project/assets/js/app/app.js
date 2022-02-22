
var body = $('body'), content = $('#explorer content'), wrap = document.querySelector('#explorer wrap'), wrapper = $(wrap)


function parseMomentLocale(content){
    let startPos = content.indexOf('moment.defineLocale('), endPos = content.lastIndexOf('return ')
    if(startPos != -1 && endPos != -1){
        content = content.substr(startPos, endPos - startPos)
    }
    return content
}

function importMomentLocale(locale, cb){
    importMomentLocaleCallback = cb
    jQuery.ajax({
        url: 'node_modules/moment/locale/' + locale + '.js',
        dataType: 'text',
        cache: true
    }).done(content => {
        let txt = this.parseMomentLocale(content)
        jQuery('<script>').attr('type', 'text/javascript').text('try{ '+ txt + '} catch(e) { console.error(e) };importMomentLocaleCallback()').appendTo('head')
    }).fail((jqXHR, textStatus) => {
        console.error( "Request failed: " + textStatus )
    })
}

function waitMessage(action, cb){
    const listener = e => {
        if(e.data.action == action){
            console.log(action)
            window.removeEventListener('message', listener)
            cb()
        }
    }
    window.addEventListener('message', listener)
}

var hidingBackButton = false
function hideBackButton(doHide){
    if(doHide != hidingBackButton){
        hidingBackButton = doHide
        if(hidingBackButton){
            css(' #explorer a[data-type="back"] { display: none; } ', 'hide-back-button')
        } else {
            css(' ', 'hide-back-button')
        }
    }
}

function configUpdated(keys, c){
    config = c
    if(parent.updateConfig){
        parent.updateConfig(config)
    }
    uiSoundsEnable = config['ui-sounds']
    explorer.setViewSize(config['view-size-x'], config['view-size-y'])
    hideBackButton(config['hide-back-button'])
    parent.animateBackground(config['animate-background'])
}

function initApp(){ 
    console.log('INITAPP')
    app.on('open-external-url', url => parent.openExternalURL(url)) 
    app.on('open-external-file', (url, mimetype) => parent.openExternalFile(url, mimetype)) 
    app.on('load-js', src => {
        console.warn('LOADJS ' + src)
        var s = document.createElement('script')
        s.src = src
        s.async = true
        document.querySelector('head, body').appendChild(s)
    }) 
    app.on('theme-background', (image, video, color, fontColor, animate) => {
        parent.theming(image, video, color, fontColor, animate)
    })
    app.on('download', (url, name) => {
        console.log('download', url, name)
        if(parent.cordova){
            parent.checkPermissions([
                'READ_EXTERNAL_STORAGE', 
                'WRITE_EXTERNAL_STORAGE'
            ], () => {
                parent.requestFileSystem.apply(parent, [
                    parent.LocalFileSystem.PERSISTENT, 
                    0, 
                    fileSystem => {
                        let target
                        if(parent.cordova.platformId == 'android'){
                            target = parent.cordova.file.externalRootDirectory + 'Download'
                        } else {
                            target = parent.cordova.file.documentsDirectory || parent.cordova.file.externalRootDirectory || fileSystem.root.nativeURL
                        }
                        target = target.replace(new RegExp('\/+$'), '')
                        app.emit('download-in-background', url, name, target)
                    }
                ])
            })
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
    app.on('open-file', (uploadURL, cbID, mimetypes, optionTitle) => {
        if(parent.cordova){
            parent.checkPermissions([
                'READ_EXTERNAL_STORAGE', 
                'WRITE_EXTERNAL_STORAGE'
            ], () => {
                let finish = () => {
                    osd.hide('theme-upload')
                    explorer.get({name: optionTitle}).forEach(e => {
                        explorer.setLoading(e, false)
                    })
                }
                console.log('MIMETYPES: ' + mimetypes.replace(new RegExp(' *, *', 'g'), '|'))
                parent.fileChooser.open(file => { // {"mime": mimetypes.replace(new RegExp(' *, *', 'g'), '|')}, 
                    osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'theme-upload', 'normal')
                    explorer.get({name: optionTitle}).forEach(e => {
                        explorer.setLoading(e, true, lang.PROCESSING)
                    })
                    parent.resolveLocalFileSystemURL(file, fileEntry => {
                        let name = fileEntry.fullPath.split('/').pop().replace(new RegExp('[^0-9A-Za-z\\._\\- ]+', 'g'), '') || 'file.tmp', target = parent.cordova.file.cacheDirectory
                        if(target.charAt(target.length - 1) != '/'){
                            target += '/'
                        }
                        parent.resolveLocalFileSystemURL(target, dirEntry => {
                            fileEntry.copyTo(dirEntry, name, () => {
                                console.log('Copy success', target, name)
                                app.emit(cbID, [
                                    target.replace(new RegExp('^file:\/+'), '/') + name
                                ])
                                finish()
                            }, e => {
                                console.log('Copy failed', fileEntry, dirEntry, target, name, e)
                            })
                        }, null)
                    }, err => {
                        console.error(err)
                        finish()
                        osd.show(String(err), 'fas fa-exclamation-circle', 'theme-upload', 'normal')
                    })
                }, err => {
                    console.error(err)
                    finish()
                    osd.show(String(err), 'fas fa-exclamation-circle', 'theme-upload', 'normal')
                })
            })
        } else if(top.Manager) {
            top.Manager.openFile(mimetypes, (err, file) => {
                app.emit(cbID, [file])
            })
        } else {
            explorer.openFile(uploadURL, cbID, mimetypes)
        }
    })
    app.on('display-error', txt => {
        osd.show(txt, 'fas fa-exclamation-circle faclr-red', 'error', 'normal')
    })
    app.on('clear-cache', () => {
        if(top.nw){
            top.nw.App.clearCache()
        }
    })
    app.on('restart', () => {
        parent.winman.restart()
    })
    app.on('config', configUpdated)
    app.on('fontlist', () => {
        app.emit('fontlist', getFontList())
    })
    app.on('sound', (n, v) => {
        sound(n, v)
    })
    app.on('ask-exit', () => {
        parent.winman.askExit()
    })
    app.on('ask-restart', () => {
        parent.winman.askRestart()
    })
    app.on('exit', force => {
        parent.winman.exit(force)
    })
    app.on('background-mode-lock', name => {
        if(parent.player && parent.winman) parent.winman.backgroundModeLock(name)
    })
    app.on('background-mode-unlock', name => {
        if(parent.player && parent.winman) parent.winman.backgroundModeUnlock(name)
    })

    $(() => {
        console.log('load app')

        explorer = new Explorer(jQuery, '#explorer', app)   
        explorer.on('render', (path, icon) => {
            var iconTag = ''
            if(path){
                if(!icon){
                    iconTag = '<i class="fas fa-folder-open"></i>'          
                } else {     
                    iconTag = '<i class="'+ icon +'"></i>'                         
                }
            } else {
                iconTag = '<i class="fas fa-home"></i>'
            }
            document.querySelector('#explorer header span.explorer-location-icon').innerHTML = iconTag
            document.querySelector('#explorer header span.explorer-location-text').innerHTML = path ? path.split('/').pop() : '&nbsp;'
        })
        explorer.on('render', path => {
            if(path){
                if(body.hasClass('home')){
                    body.removeClass('home')                        
                }
            } else {
                body.addClass('home')
            }
            setTimeout(() => {
                if(typeof(haUpdate) == 'function'){
                    haUpdate()
                }
            }, 0)
        })
    
        /* icons start */
        iconCaching = {}
        const icon = (src, path, tabIndex, name, force) => {
            if(typeof(iconCaching[path]) == 'undefined'){
                iconCaching[path] = {}
            }
            if(force || !iconCaching[path][tabIndex] || iconCaching[path][tabIndex].src != src || iconCaching[path][tabIndex].name != name){
                iconCaching[path][tabIndex] = {src, name}
            }
            if(explorer.path == path){
                let element = tabIndex == -1 ? document.querySelector('.explorer-location-icon i') : explorer.currentElements[tabIndex], m = document.createElement('img')
                m.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=' // transparent pixel
                m.style.backgroundImage = 'url(' + src + ')'
                if(tabIndex == -1) {
                    jQuery(element).replaceWith(m)
                } else {
                    let c = element.querySelector('.entry-icon-image')
                    if(c){
                        let g = c.querySelector('img')
                        if(!g || force || m.style.backgroundImage != g.style.backgroundImage){
                            c.innerHTML = ''
                            c.appendChild(m)
                        }
                    }
                }
            }
        }
        const iconRange = () => {
            if(typeof(iconCaching[explorer.path]) != 'undefined' && config['show-logos']){
                Array.from(new Array(explorer.range.end - explorer.range.start), (x, i) => i + explorer.range.start).forEach(i => {
                    if(explorer.currentEntries[i]){
                        if(typeof(iconCaching[explorer.path][i]) != 'undefined' && iconCaching[explorer.path][i].name == explorer.currentEntries[i].name){
                            icon(iconCaching[explorer.path][i].src, explorer.path, i, explorer.currentEntries[i].name)
                        }
                    }
                })
            }
        }
        app.on('icon', icon)
        explorer.on('render', iconRange)
        explorer.on('update-range', iconRange)
        /* icons end */

        if(navigator.app){
            explorer.on('init', () => {
                document.dispatchEvent(new CustomEvent('init', {}))
            })
        }
         
        if(parent.updateConfig){
            parent.updateConfig(config)
        }
        
        window.osd = new OSD(document.getElementById('osd-root'), app)
        explorer.setViewSize(config['view-size-x'], config['view-size-y']);
        
        ([
            {
                level: 'default', 
                selector: '#explorer wrap a, .explorer-omni span', 
                condition: () => {
                    return explorer.isExploring()
                },
                resetSelector(){
                    return explorer.viewportEntries(false)
                },
                default: true,
                overScrollAction: direction => {
                    if(direction == 'up'){
                        let playing = explorer.inPlayer()
                        if(!playing){
                            console.log('OVERSCROLLACTION!!!!!!!')
                            explorer.focus(explorer.container.find('.explorer-omni > span'), true)
                            return true
                        } else {
                            console.log('OVERSCROLLACTION!!!!!!!')
                            explorer.body.removeClass('menu-playing')
                            idle.stop()
                            idle.lock(0.1)
                        }
                    }
                }
            },
            {
                level: 'modal', 
                selector: '#modal-content input, #modal-content textarea, #modal-content .button, #modal-content a', 
                condition: () => {
                    return explorer.inModal()
                }
            },
            {
                level: 'player', 
                selector: 'controls button', 
                condition: () => {
                    return explorer.inPlayer() && !explorer.inModal() && !explorer.isExploring()
                },
                overScrollAction: direction => {
                    if(direction == 'down'){
                        explorer.body.addClass('menu-playing')
                        setTimeout(() => explorer.reset(), 100)
                        return true
                    } else if(direction == 'up') {
                        idle.start()
                        return true
                    }
                }
            }
        ]).forEach(explorer.addView.bind(explorer))
        explorer.start()

        explorer.on('arrow', element => {
            setTimeout(() => {
                sound('menu', 1)
                if(typeof(haUpdate) == 'function'){
                    haUpdate()
                }
            }, 0)
        })

        document.body.addEventListener('focus', e => { // use addEventListener instead of on() here for capturing
            setTimeout(() => {
                if(document.activeElement == document.body){
                    console.log('body focus, explorer.reset', e)
                    explorer.reset()
                }
            }, 100)
        }, true)

        explorer.on('prompt-start', explorer.reset.bind(explorer))
        explorer.on('ask-start', explorer.reset.bind(explorer))
        explorer.on('input-save', (element, value) => {
            var t = element.querySelector('.entry-details'), mask = element.getAttribute('data-mask') || '{0}'
            if(t){
                if(value.length > 12){
                    value = value.substr(0, 9) + '...'
                }
                t.innerHTML = mask.replace('{0}', value)
            }
            setTimeout(() => {
                explorer.focus(element, true)
            }, 10)
        })

        window.addEventListener('message', e => {
            if(e.data.action){
                switch(e.data.action){
                    case 'backbutton':
                        escapePressed()
                        break
                }
            }
        })

        app.emit('init')

        waitMessage('player-ready', () => {
            setup = new Setup()        
            window.streamer = new StreamerClient(document.querySelector('controls'), app)        
            streamer.on('show', explorer.reset.bind(explorer))
            streamer.on('stop', () => {
                if(explorer.modalContainer && explorer.modalContainer.querySelector('#modal-template-option-wait')){
                    explorer.endModal()
                }                
                explorer.body.removeClass('menu-playing')
                explorer.updateSelection() || explorer.reset()
            })
            window.dispatchEvent(new CustomEvent('streamer-ready'))
            app.emit('streamer-ready')
        })

        configUpdated([], config)
        window.dispatchEvent(new CustomEvent('appready'))
        console.log('loaded app')

        requestIdleCallback(() => {

            hotkeys = new Hotkeys()
            hotkeys.start(config.hotkeys)
            app.on('config', (keys, c) => {
                if(keys.includes('hotkeys')){
                    hotkeys.start(c.hotkeys)
                }
            })

            omni = new OMNI()
            jQuery(document).on('keyup', omni.eventHandler.bind(omni))

            explorer.on('scroll', y => {
                explorer.updateRange(y)
                elpShow()
                haUpdate()  
            })

            var elp = $('.explorer-location-pagination'), elpTxt = elp.find('span'), elpTimer = 0, elpDuration = 5000, elpShown = false, elpShow = txt => {
                clearTimeout(elpTimer)
                if(!elpShown){
                    elpShown = true
                    elp.show()
                }
                if(typeof(txt) == 'string'){
                    elpTxt.html(txt)
                }
                if(explorer.selectedIndex < 2){
                    elpTimer = setTimeout(() => {
                        if(elpShown){
                            elpShown = false
                            elp.hide()
                        }
                    }, elpDuration)
                }
            }
            explorer.on('focus', element => {
                let offset = explorer.path ? 0 : 1
                elpShow(' '+ (explorer.selectedIndex + offset) +'/'+ (explorer.currentEntries.length - 1 + offset))
            })
            explorer.on('arrow', () => requestIdleCallback(elpShow))

            var haTop = $('#home-arrows-top'), haBottom = $('#home-arrows-bottom')
            haTop.on('click', () => {
                explorer.arrow('up')
            })
            haBottom.on('click', () => {
                explorer.arrow('down')
            })
    
            window['home-arrows-active'] = {bottom: null, top: null, timer: 0};
            window.haUpdate = () => {
                var as = wrap.getElementsByTagName('a')
                if(as.length > (explorer.viewSizeX * explorer.viewSizeY)){
                    var lastY = (as[as.length - 1].offsetTop) - wrap.scrollTop, firstY = as[0].offsetTop - wrap.scrollTop
                    if(lastY >= wrap.parentNode.offsetHeight){
                        if(window['home-arrows-active'].bottom !== true){
                            window['home-arrows-active'].bottom = true
                            haBottom.css('opacity', 'var(--opacity-level-3)')
                        }
                    } else {
                        if(window['home-arrows-active'].bottom !== false){
                            window['home-arrows-active'].bottom = false
                            haBottom.css('opacity', 0)
                        }
                    }
                    if(firstY < 0){
                        if(window['home-arrows-active'].top !== true){
                            window['home-arrows-active'].top = true
                            haTop.css('opacity', 'var(--opacity-level-3)')
                        }
                    } else {
                        if(window['home-arrows-active'].top !== false){
                            window['home-arrows-active'].top = false
                            haTop.css('opacity', 0)
                        }
                    }
                } else {
                    window['home-arrows-active'].top = window['home-arrows-active'].bottom = false
                    haBottom.add(haTop).css('opacity', 0)
                }
            }
    
            moment.tz.setDefault(Intl.DateTimeFormat().resolvedOptions().timeZone)
            if(lang.locale && !moment.locales().includes(lang.locale)){
                importMomentLocale(lang.locale, () => {
                    moment.locale(lang.locale)
                    clock.update()
                })
            }
    
            clock = new Clock(document.querySelector('header time'))
    
            function handleSwipe(e){
                if(explorer.inModal()) return
                console.log('swipey', e)
                let orientation = innerHeight > innerWidth ? 'portrait' : 'landscape'
                let swipeDist, swipeArea = ['up', 'down'].includes(e.direction) ? innerHeight : innerWidth
                switch(e.direction) {
                    case 'left':
                    case 'right':                        
                        swipeDist = swipeArea / (orientation == 'portrait' ? 2 : 3)
                        break
                    case 'up':
                    case 'down': // dont use default here to ignore diagonal moves
                        swipeDist = swipeArea / (orientation == 'portrait' ? 3 : 2)
                        break
                }
                if(swipeDist && e.swipeLength >= swipeDist){
                    let swipeWeight = Math.round((e.swipeLength - swipeDist) / swipeDist)
                    if(swipeWeight < 1) swipeWeight = 1
                    console.log('SWIPE WEIGHT', swipeWeight)
                    switch(e.direction){
                        case 'left':
                            if(explorer.inPlayer()){       
                                arrowRightPressed(true) 
                            }
                            break
                        case 'right':                        
                            if(explorer.inPlayer()){   
                                arrowLeftPressed(true)   
                            } else {
                                escapePressed()
                            }
                            break
                        case 'up': // go down
                            if(explorer.inPlayer()){
                                if(!explorer.isExploring()){
                                    arrowDownPressed(true)
                                }
                            }
                            break
                        case 'down': // go up
                            if(explorer.inPlayer()){
                                if(explorer.isExploring()){
                                    if(!explorer.scrollContainer.scrollTop()){
                                        explorer.body.removeClass('menu-playing')
                                    }
                                } else {
                                    arrowUpPressed(false)
                                }
                            }
                            break
                    }
                }
            }
            swipey.add(document.body, handleSwipe, {diagonal: false})
            
            var mouseWheelMovingTime = 0, mouseWheelMovingInterval = 200;
            ['mousewheel', 'DOMMouseScroll'].forEach(n => {
                window.addEventListener(n, event => {
                    if(!explorer.inPlayer() || explorer.isExploring()) return
                    let now = (new Date()).getTime()
                    if(now > (mouseWheelMovingTime + mouseWheelMovingInterval)){
                        mouseWheelMovingTime = now
                        let delta = (event.wheelDelta || -event.detail)
                        if(delta > 0){   
                            //this.seekForward()
                            arrowUpPressed()
                        } else {
                            //this.seekRewind()
                            arrowDownPressed()
                        }
                    }
                })
            }) 

            var internetConnStateOsdID = 'network-state', updateInternetConnState = () => {
                if(navigator.onLine){
                    app.emit('network-state-up')
                    osd.hide(internetConnStateOsdID)
                } else {
                    app.emit('network-state-down')
                    osd.show(lang.NO_INTERNET_CONNECTION, 'fas fa-exclamation-triangle faclr-red', internetConnStateOsdID, 'persistent')
                }
            }
            jQuery(window).on('online', updateInternetConnState).on('offline', updateInternetConnState)
            if(!navigator.onLine){
                updateInternetConnState()
            }
            
            app.on('share', (title, text, url) => {
                console.log('share', title, text, url)
                if(typeof(parent.navigator.share) == 'function'){
                    parent.navigator.share(text + "\r\n" + url, title, 'text/plain', (...args) => {
                        console.log('share', args)
                    }, err => {
                        console.error('share error', err)
                    })
                } else {
                    parent.openExternalURL('https://megacubo.tv/share/?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title) + '&text=' + encodeURIComponent(text))
                }
            })
    
            idle.on('start', () => {
                if(explorer.inPlayer() && !explorer.isExploring()){
                    if(document.activeElement != document.body){
                        document.activeElement.blur()
                    }
                }
            })
            
            ffmpeg.bind()

            jQuery('#menu-playing-close').on('click', () => {
                explorer.body.removeClass('menu-playing')
            })

            if(parent.cordova){
				parent.cordova.plugins.backgroundMode.disable()
                parent.cordova.plugins.backgroundMode.setDefaults({
                    title: 'Megacubo',
                    text: lang.RUNNING_IN_BACKGROUND || '...',                
                    icon: 'icon', // this will look for icon.png in platforms/android/res/drawable|mipmap
                    color: config['background-color'].slice(-6), // hex format like 'F14F4D'
                    resume: true,
                    hidden: true,
                    silent: false,
                    allowClose: true,
                    closeTitle: lang.CLOSE || 'X'
                    //, bigText: Boolean
                })
            } else {
                jQuery('body').on('dblclick', event => {
                    if(streamer.active || !jQuery(event.target).parents('wrap').length){
                        streamer.toggleFullScreen()
                        event.preventDefault()
                        event.stopPropagation()
                    }
                })
            }
        })
    })
}

window.addEventListener('beforeunload', () => {
	console.log('beforeunload at app')
})

if(parent.frontendBackendReadyCallback){
    parent.frontendBackendReadyCallback('frontend') 
} else {
    waitMessage('app_js_ready', () => {
        parent.frontendBackendReadyCallback('frontend') 
    })
}