var body = $('body'), content = $('#explorer content'), wrap = document.querySelector('#explorer wrap'), wrapper = $(wrap)

if(typeof(window.onerror) != 'function'){
    window.onerror = parent.onerror
}

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
    parent.updateConfig && parent.updateConfig.apply(parent, [config])
    uiSoundsEnable = config['ui-sounds']
    explorer.setViewSize(config['view-size-x'], config['view-size-y'], config['view-size-portrait-x'], config['view-size-portrait-y'])
    hideBackButton(config['hide-back-button'])
    parent.animateBackground(config['animate-background'])
    idle.setTimeoutAwayState(config['timeout-secs-energy-saving'])
}

function langUpdated(){    
    jQuery('[data-language]').each((i, e) => {
        const key = e.getAttribute('data-language'), tag = e.tagName.toLowerCase(), val = lang[key] || key
        if(!key) return
        const text = val.replace(new RegExp('\r?\n', 'g'), '<br />')
        const plainText = val.replace(new RegExp('[\r\n]+', 'g'), ' ')
        if(tag == 'input' && e.type == 'text') {
            e.placeholder = plainText
        } else {
            if([e.innerText, e.innerHTML].includes(text) && !e.getElementsByTagName('*')){
                e.innerHTML = text
            }
        }
        e.title = plainText
    })
}

function resolveNativePath(uri, callback) {
    const originalURI = uri, errorcb = err => callback(err)
    uri = decodeURIComponent(uri).replace('/raw%3A', '/raw:')
    if (uri.startsWith('file://')) {
        uri = uri.replace('file://', '')
    }
    if (uri.indexOf('raw:') !== -1) {
        uri = uri.substr(uri.indexOf('raw:') + 4);
        uri = uri.replace(new RegExp('\\?.*$'), '')
    }
    uri = decodeURIComponent(uri)
    if(!uri.startsWith('content:')){
        return callback(null, uri)
    }
    parent.FilePath.resolveNativePath(originalURI, filepath => {
        parent.resolveLocalFileSystemURL(filepath, fileEntry => {
            fileEntry.file(file => {
                const reader = new FileReader()
                reader.onloadend = () => {
                    const tempDir = cordova.file.tempDirectory, blob = new Blob([new Uint8Array(this.result)], {
                        type: file.type
                    })
                    parent.resolveLocalFileSystemURL(tempDir, tempEntry => {
                        tempEntry.getFile(file.name, { create: true }, tempFileEntry => {
                            tempFileEntry.createWriter(writer => {
                                writer.write(blob)
                                callback(null, tempFileEntry.nativeURL)
                            }, errorcb)
                        }, errorcb)
                    }, errorcb)
                }
                reader.readAsArrayBuffer(file)
            }, errorcb)
        }, errorcb)
    }, errorcb)
}

var app
function initApp(){
    if(!config) {
        config = parent.config
    }
    if(!lang) {
        lang = parent.lang
    }
    app = parent.appChannel
    if(!parent.cordova){
        app.on('ffmpeg-check', (mask, folder) => {
            console.log('Starting FFmpeg check', [osd, mask, folder])
            parent.parent.ffmpeg.check(osd, mask, folder).then(ret => {
                console.log('FFmpeg checking succeeded', ret)
            }).catch(err => {
                console.error('FFmpeg checking error')
                osd.show(String(err), 'fas fa-exclamation-triangle faclr-red', 'ffmpeg-dl', 'normal')
            })
        })
    }
    app.on('open-external-url', url => parent.openExternalURL(url)) 
    app.on('open-external-file', (url, mimetype) => parent.openExternalFile(url, mimetype)) 
    app.on('load-js', src => {
        console.warn('LOADJS ' + src)
        var s = document.createElement('script')
        s.src = src
        s.async = true
        document.querySelector('head, body').appendChild(s)
    }) 
    app.on('lang', texts => {
        window.lang = window.parent.lang = texts
        langUpdated()
    })
    app.on('theme-background', (image, video, color, fontColor, animate) => {
        parent.theming(image, video, color, fontColor, animate)
    })
    app.on('download', (url, name) => {
        console.log('download', url, name)
        if(parent.cordova){
            checkPermissions([
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
        const next = () => {
            explorer.openFile(uploadURL, cbID, mimetypes).catch(err => {
                osd.show(String(err), 'fas fa-exclamation-triangle', 'explorer', 'normal')
            }).finally(() => {
                parent.winman && parent.winman.backgroundModeLock('open-file')
            })
        }
        if(parent.cordova) {
            parent.winman && parent.winman.backgroundModeLock('open-file')
            checkPermissions([
                'READ_EXTERNAL_STORAGE', 
                'WRITE_EXTERNAL_STORAGE'
            ], next)
        } else if(parent.parent.Manager) {
            parent.parent.Manager.openFile(mimetypes, (err, file) => app.emit(cbID, [file]))
        } else {
            next()
        }
    })
    app.on('display-error', txt => {
        console.error(txt)
        window.osd && osd.show(txt, 'fas fa-exclamation-triangle faclr-red', 'error', 'normal')
    })
    app.on('restart', () => {
        parent.winman && parent.winman.restart()
    })
    app.on('config', configUpdated)
    app.on('fontlist', () => {
        app.emit('fontlist', getFontList())
    })
    app.on('sound', (n, v) => {
        sound(n, v)
    })
    app.on('ask-exit', () => {
        parent.winman && parent.winman.askExit()
    })
    app.on('ask-restart', () => {
        parent.winman && parent.winman.askRestart()
    })
    app.on('exit', force => {
        parent.winman && parent.winman.exit(force)
    })
    app.on('background-mode-lock', name => {
        if(parent.player && parent.winman) parent.winman && parent.winman.backgroundModeLock(name)
    })
    app.on('background-mode-unlock', name => {
        if(parent.player && parent.winman) parent.winman && parent.winman.backgroundModeUnlock(name)
    })
    let initP2PDetails, initializedP2P, initP2P = () => { 
        if(!initP2PDetails || !config || initializedP2P || !config['p2p']) return
        initializedP2P = true
        loadJSOnIdle('./modules/download/discovery-swarm-webrtc-bundle.js', () => {
            if(typeof(require) == 'function') {
                loadJSOnIdle('./modules/download/download-p2p-client.js', () => {
                    const {addr, limit, stunServers} = initP2PDetails
                    window.p2p = new P2PManager(app, addr, limit, stunServers)
                })
            }
        })
    }
    app.on('init-p2p', (addr, limit, stunServers) => {
        initP2PDetails = {addr, limit, stunServers}
        initP2P()
    })
    app.emit('download-p2p-init');
    $(() => {
        console.log('load app')

        explorer = new Explorer(jQuery, '#explorer', app)   
        explorer.on('render', (path, icon) => {
            var iconTag = ''
            if(path){
                if(!icon){
                    iconTag = '<i class="fas fa-box-open"></i>'          
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
        const icon = data => {
            if(typeof(iconCaching[data.path]) == 'undefined'){
                iconCaching[data.path] = {}
            }
            if(data.force || !iconCaching[data.path][data.tabindex] || iconCaching[data.path][data.tabindex].url != data.url || iconCaching[data.path][data.tabindex].name != data.name){
                iconCaching[data.path][data.tabindex] = data
            }
            if(explorer.path == data.path){
                const entry = explorer.currentEntries[data.tabindex]
                const element = data.tabindex == -1 ? document.querySelector('.explorer-location-icon i') : explorer.currentElements[data.tabindex]
                const isCover = element && !data.alpha && (config['stretch-logos'] || (entry && entry.class && entry.class.indexOf('entry-force-cover') != -1))
                const bg = 'url("' + data.url + '")' // keep quotes
                console.warn('THUMB',{isCover, data, entry})
                const m = () => {
                    let d, g = document.createElement('img')
                    if(isCover){
                        d = document.createElement('div')
                        g.src = data.url
                        d.className = 'entry-cover-container'
                        d.appendChild(g)
                        return d
                    } else {
                        g.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=' // transparent pixel
                        g.style.backgroundImage = bg
                        return g
                    }
                }
                if(!element) {
                    return
                } else if(data.tabindex == -1) {
                    jQuery(element).replaceWith(m())
                } else if (element.title == data.name) { // is the same element yet?
                    let cc = element.querySelector('.entry-cover-container'), c = element.querySelector('.entry-wrapper')
                    if(!c) return
                    if(isCover){
                        if(c){
                            let g = c.querySelector('img')
                            if(!g || data.force || bg != g.src) {
                                cc && cc.parentNode.removeChild(cc)
                                let a = element.querySelector('.entry-icon-image')
                                c.className = c.className +' entry-cover-active'
                                if(a) a.innerHTML = ''
                                c.insertBefore(m(), c.childNodes[0])
                            }
                        } 
                    } else {
                        cc && cc.parentNode.removeChild(cc)
                        if(c.className && c.className.indexOf('entry-cover-active') != -1){
                            c.className = c.className.replace(new RegExp(' *entry\-cover\-active *', 'g'), ' ')
                        }
                        let a = element.querySelector('.entry-icon-image')
                        if(a){
                            let g = c.querySelector('img')
                            if(!g || data.force || bg != g.style.backgroundImage){
                                a.innerHTML = ''
                                a.appendChild(m())
                            }
                        }
                    }
                }
            }
        }
        const iconRange = () => {
            if(typeof(iconCaching[explorer.path]) != 'undefined' && config['show-logos']){
                let range = explorer.viewportRange()
                //console.log('selectionMemory iconRange', iconCaching[explorer.path], range.start, range.end)
                const len = range.end - range.start
                if(len > 0){
                    Array.from(new Array(len), (x, i) => i + range.start).forEach(i => {
                        if(explorer.currentEntries[i]){
                            if(typeof(iconCaching[explorer.path][i]) != 'undefined' && iconCaching[explorer.path][i].name == explorer.currentEntries[i].name){
                                const atts = Object.assign({}, iconCaching[explorer.path][i])
                                icon(atts)
                            }
                        }
                    })
                }
            }
        }
        app.on('icon', icon)
        explorer.on('render', iconRange)
        explorer.on('update-range', iconRange)
        /* icons end */
         
        parent.updateConfig && parent.updateConfig.apply(parent, [config])
        
        window.osd = new OSD(document.getElementById('osd-root'), app)
        explorer.setViewSize(config['view-size-x'], config['view-size-y'], config['view-size-portrait-x'], config['view-size-portrait-y']);
        
        ([
            {
                level: 'default', 
                selector: '#explorer wrap a, .explorer-omni span, .header-entry', 
                condition: () => {
                    return explorer.isExploring()
                },
                resetSelector(){
                    return explorer.viewportEntries(false)
                },
                default: true,
                overScrollAction: (direction, e) => {
                    if(direction == 'up'){
                        let playing = explorer.inPlayer()
                        if(!playing){
                            console.log('OVERSCROLLACTION!!!!!!!')
                            let n
                            if(e){
                                let entries = explorer.entries(true), i = entries.indexOf(e)
                                i++
                                if(explorer.viewSizeX == i){
                                    n = explorer.container.find('.header-entry:eq(0)')
                                }                                
                            }
                            if(!n){
                                n = explorer.container.find('.explorer-omni span')
                            }
                            explorer.focus(n, true)
                            return true
                        } else {
                            console.log('OVERSCROLLACTION!!!!!!!')
                            menuPlaying(false)
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
                        menuPlaying(true)
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
                t.innerHTML = mask == 'time' ? clock.humanize(parseInt(value), true) : mask.replace('{0}', value)
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

        langUpdated()
        app.emit('init')
        window.idle = new Idle()

        window.streamer = new StreamerClient(document.querySelector('controls'), app)        
        streamer.on('show', explorer.reset.bind(explorer))
        streamer.on('state', s => {
            if(s == 'playing' && explorer.modalContainer && explorer.modalContainer.querySelector('#modal-template-option-wait')){
                explorer.endModal()
            }
        })
        streamer.on('stop', () => {
            if(explorer.modalContainer && explorer.modalContainer.querySelector('#modal-template-option-wait')){
                explorer.endModal()
            }
            menuPlaying(false)
            explorer.updateSelection() || explorer.reset()
        })
        app.emit('streamer-ready')
        parent.parent.Manager && parent.parent.Manager.appLoaded()
        jQuery('#menu-playing-close').on('click', () => {
            menuPlaying(false)
        })
        jQuery('div#arrow-down-hint i').on('click', () => {
            menuPlaying(true)
        })

        configUpdated([], config)

        hotkeys = new Hotkeys()
        hotkeys.start(config.hotkeys)
        app.on('config', (keys, c) => {
            if(keys.includes('hotkeys')) {
                hotkeys.start(c.hotkeys)
            }
        })

        omni = new OMNI()
        omni.on('left', () => explorer.arrow('left'))
        omni.on('right', () => explorer.arrow('right'))
        omni.on('down', () => explorer.arrow('down'))
        omni.on('up', () => explorer.arrow('up'))

        explorer.on('scroll', y => {
            //console.log('selectionMemory scroll', y)
            explorer.updateRange(y)
            elpShow()
            haUpdate()
        })

        var elp = $('.explorer-location-pagination'), elpTxt = elp.find('span'), elpTimer = 0, elpDuration = 5000, elpShown = false
        const elpShow = txt => {
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
        const elpListener = () => {
            let offset = explorer.path ? 0 : 1
            elpShow(' '+ (explorer.selectedIndex + offset + 1) +'/'+ (explorer.currentEntries.length + offset))
        }
        explorer.on('arrow', elpListener)
        explorer.on('focus', elpListener)
        explorer.on('render', elpListener)

        var haTop = $('#home-arrows-top'), haBottom = $('#home-arrows-bottom')
        haTop.on('click', () => explorer.arrow('up'))
        haBottom.on('click', () => explorer.arrow('down'))

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

        clock = new Clock(document.querySelector('header time'))

        moment.tz.setDefault((Intl || parent.parent.Intl).DateTimeFormat().resolvedOptions().timeZone) // prevent "Intl is not defined"
        if(lang.locale && !moment.locales().includes(lang.locale)){
            importMomentLocale(lang.locale, () => {
                moment.locale(lang.locale)
                clock.update()
            })
        }

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
                        if(explorer.inPlayer() && !explorer.isExploring()){       
                            arrowRightPressed(true) 
                        }
                        break
                    case 'right':                        
                        if(explorer.inPlayer() && !explorer.isExploring()){   
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
                                    explorer.app.emit('explorer-menu-playing', true)
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
            jQuery(window).on(n, event => {
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
            if(parent.cordova && typeof(parent.navigator.share) == 'function'){
                parent.navigator.share({
                    text,
                    url,
                    title
                }).catch(err => {
                    console.error('Share error', err)
                })
            } else {
                parent.openExternalURL('https://megacubo.tv/share/?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title) + '&text=' + encodeURIComponent(text))
            }
        })

        var parentRoot = jQuery(parent.document.documentElement)
        var energySaver = {
            start: () => {
                parent.animateBackground('none')
                parentRoot.addClass('curtains curtains-alpha').removeClass('curtains-close')
            }, 
            end: () => {
                typeof(config) != 'undefined' && parent.animateBackground(config['animate-background'])
                parentRoot.addClass('curtains-close curtains-alpha').removeClass('curtains')
            }
        }
        idle.on('idle', () => {
            if(explorer.inPlayer() && !explorer.isExploring()){
                if(document.activeElement != document.body){
                    document.activeElement.blur()
                }
            }
        })
        idle.on('away', () => {
            streamer.active || streamer.isTuning() || energySaver.start()
        })
        idle.on('active', () => energySaver.end())
        streamer.on('show', () => energySaver.start())
        streamer.on('hide', () => {
            idle.reset() // will not call idle.on('active') if not idle, so keep lines below to ensure
            energySaver.end()
        })
        explorer.scrollContainer.on('scroll', () => idle.reset())
        
        ffmpeg.bind()

        let hs = document.getElementById('header-shutdown')
        hs.title = hs.alt = lang.EXIT
        hs.addEventListener('click',  () => {
            parent.winman && parent.winman.askExit()
        })

        let ha = document.getElementById('header-about')
        ha.title = ha.alt = lang.ABOUT
        ha.addEventListener('click',  () => {
            app.emit('about-dialog')
        })

        ha = hs = undefined

        if(parent.cordova){
            parent.winman && parent.winman.setBackgroundMode(true) // enable once at startup to prevent service not registered crash
            parent.cordova.plugins.backgroundMode.disableBatteryOptimizations()
            setTimeout(() => parent.winman && parent.winman.setBackgroundMode(false), 5000)
            parent.cordova.plugins.backgroundMode.setDefaults({
                title: document.title,
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
                const rect = document.querySelector('header').getBoundingClientRect()
                const valid = event.clientY < (rect.top + rect.height)
                if(valid) {
                    streamer.toggleFullScreen()
                    event.preventDefault()
                    event.stopPropagation()
                }
            })
        }           

        if(parent.frontendBackendReadyCallback){
            parent.frontendBackendReadyCallback('frontend') 
        } else {
            parent.addEventListener('load', () => {
                parent.frontendBackendReadyCallback('frontend') 
            })
        }
    })
}

parent.onBackendReady(initApp)