
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
        jQuery('<script>').attr('type', 'text/javascript').text(this.parseMomentLocale(content) + ';importMomentLocaleCallback()').appendTo('head')
    }).fail((jqXHR, textStatus) => {
        console.error( "Request failed: " + textStatus )
    })
}

function askExit(){
    explorer.dialog([
        {template: 'question', text: lang.ASK_EXIT, fa: 'fas fa-times-circle'},
        {template: 'option', text: lang.NO, id: 'no'},
        {template: 'option', text: lang.YES, id: 'yes'}
    ], c => {
        if(c == 'yes'){
            exit()
        }
    }, 'no')
}

function exitUI(){
    console.log('exitUI()')
    try {
        streamer.stop()
        $('wrap').html('<div style="vertical-align: middle; height: 100%; display: flex; justify-content: center; align-items: center;"><i class="fa-mega" style="font-size: 25vh;color: var(--font-color);"></i></div>')
        $('#home-arrows').hide()
    } catch(e) {
        console.error(e)
    }
}

function restart(){
    console.log('restart()')
    explorer.dialog([
        {template: 'question', text: 'Megacubo', fa: 'fas fa-info-circle'},
        {template: 'message', text: lang.SHOULD_RESTART},
        {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
    ], () => {
        exit()
    })
}

function exit(){
    console.log('exit()', traceback())
    app.emit('close')
    exitUI()
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

function getViewportRange(){
    let as = explorer.currentElements, limit = (explorer.viewSizeX * explorer.viewSizeY)
    if(as.length){
        let i = Math.round(wrap.scrollTop / as[0].offsetHeight) * explorer.viewSizeX
        return {start: i, end: Math.min(i + limit, as.length - 1)}
    } else {
        return {start: 0, end: Math.min(limit, as.length - 1)}
    }
}

function getViewportEntries(onlyWithIcons){
    let ret = [], as = explorer.currentElements
    if(as.length){
        let range = getViewportRange(wrap.scrollTop)
        ret = as.slice(range.start, range.end)
        if(onlyWithIcons){
            ret = ret.filter(a => {
                return a.getAttribute('data-icon')
            })
        }
    }
    return ret
}

function hideBackButton(){
    if(config['hide-back-button']){
        css(' #explorer a[data-type="back"] { display: none; } ', 'hide-back-button')
    } else {
        css(' ', 'hide-back-button')
    }
}

function initApp(){ 
    console.log('INITAPP')
    app.on('load-js', (src) => {
        console.warn('LOADJS ' + src)
        var s = document.createElement('script')
        s.src = src
        s.async = true
        document.querySelector('head, body').appendChild(s)
    }) 
    app.on('theme-background', (path, color, fontColor, animate) => {
        parent.theming(path, color, fontColor, animate)
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
    app.on('open-file', (uploadURL, cbID, mimetypes) => {
        if(parent.cordova){
            parent.checkPermissions([
                'READ_EXTERNAL_STORAGE', 
                'WRITE_EXTERNAL_STORAGE'
            ], () => {
                let finish = () => {
                    osd.hide('theme-upload')
                    explorer.get({name: lang.CHANGE_BACKGROUND_IMAGE}).forEach(e => {
                        explorer.setLoading(e, false)
                    })
                }
                console.log('MIMETYPES: ' + mimetypes.replace(new RegExp(' *, *', 'g'), '|'))
                parent.fileChooser.open(file => { // {"mime": mimetypes.replace(new RegExp(' *, *', 'g'), '|')}, 
                    osd.show(lang.PROCESSING, 'fa-mega spin-x-alt', 'theme-upload', 'normal')
                    explorer.get({name: lang.CHANGE_BACKGROUND_IMAGE}).forEach(e => {
                        explorer.setLoading(e, true, lang.PROCESSING)
                    })
                    parent.resolveLocalFileSystemURL(file, fileEntry => {
                        let name = fileEntry.fullPath.split('/').pop().replace(new RegExp('[^0-9A-Za-z\\.]+', 'g'), '') + '.tmp', target = parent.cordova.file.cacheDirectory
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
        } else {
            explorer.openFile(uploadURL, cbID, mimetypes)
        }
    })
    app.on('display-error', txt => {
        osd.show(txt, 'fas fa-exclamation-circle faclr-red', 'error', 'normal')
    })
    app.on('restart', () => {
        restart()
    })
    app.on('config', c => {
        console.warn('CONFIG CHANGED FROM CLIENT', c)
        config = c
        explorer.setViewSize(config['view-size-x'], config['view-size-y'])
        hideBackButton()
        parent.animateBackground(config['animate-background'])
    })
    app.on('fontlist', () => {
        app.emit('fontlist', getFontList())
    })
    app.on('sound', (n, v) => {
        sound(n, v)
    })
    app.on('ask-exit', () => {
        askExit()
    })
    app.on('exit', () => {
        exit()
    })
    
    /* icons start */
    icons = new IconServerClient()
    icons.on('validate', (element, src, buf) => {
        if(src && element.parentNode && config['show-logos']){
            if(buf){
                let u = URL.createObjectURL(buf), m = document.createElement('img')
                m.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=' // transparent pixel
                m.style.backgroundImage = 'url(' + u + ')'
                m.onload = m.onerror = () => {
                    // URL.revokeObjectURL(u)
                }
                if(element.className == 'explorer-location-icon-placeholder'){
                    jQuery(element).replaceWith(m)
                } else {
                    let c = element.querySelector('.entry-icon-image')
                    if(c){
                        c.innerHTML = ''
                        c.appendChild(m)
                    }
                }
            }
        }
        base64 = element = null
    })
    icons.on('run', () => {
        if(config['show-logos']){
            (explorer.ranging ? getViewportEntries(true) : wrap.querySelectorAll('a[data-icon]')).forEach(element => {
                var src = element.getAttribute('data-icon')
                element.removeAttribute('data-icon')
                if(src){
                    // console.warn('validating', element, src)
                    icons.add(element, src)
                }
                element = null
            })
        }
    })
    /* icons end */

    $(() => {
        console.log('load app')

        explorer = new Explorer(jQuery, '#explorer', app)   
        explorer.on('render', (path, icon) => {
            var iconTag = ''
            if(path){
                if(!icon){
                    iconTag = '<i class="fas fa-folder-open"></i>'          
                } else if(icon.indexOf('//') != -1) {
                    iconTag = '<i class="explorer-location-icon-placeholder"></i>'                    
                } else {     
                    iconTag = '<i class="fas '+ icon +'"></i>'                         
                }
            } else {
                iconTag = '<i class="fas fa-home"></i>'
            }
            document.querySelector('#explorer header span.explorer-location-icon').innerHTML = iconTag
            document.querySelector('#explorer header span.explorer-location-text').innerHTML = path ? path.split('/').pop() : '&nbsp;'
            if(config['show-logos'] && icon && icon.indexOf('//') != -1) {
                let e = document.querySelector('.explorer-location-icon-placeholder')
                icons.add(e, icon)
            }
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
                window.haUpdate()
            }, 0)
        })           
        explorer.on('update-range', icons.run.bind(icons))
        explorer.on('render', icons.run.bind(icons)) // keep this order
        if(navigator.app){
            explorer.on('init', () => {
                document.dispatchEvent(new CustomEvent('init', {}))
            })
        }

        setupShortcuts()
                
        window.osd = new OSD(document.getElementById('osd-root'), app)
        explorer.setViewSize(config['view-size-x'], config['view-size-y']);
        
        ([
            {
                level: 'default', 
                selector: '#explorer wrap a', 
                condition: () => {
                    return explorer.isExploring()
                },
                resetSelector(){
                    return getViewportEntries(false)
                },
                default: true
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
                }
            }
        ]).forEach(explorer.addView.bind(explorer))
        explorer.start()

        explorer.on('focus', element => {
            setTimeout(() => {
                sound('menu', 1)
                haUpdate()
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
        explorer.on('arrow', elpShow)

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
        
        window.streamer = new StreamerClient(document.querySelector('controls'), app)
        window.dispatchEvent(new CustomEvent('appready'))
        console.log('loaded app')

        explorer.on('scroll', y => {
            elpShow()
            haUpdate()
            explorer.updateRange(y)
        })

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
                        haBottom.css('opacity', 'var(--opacity-level-2)')
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
                        haTop.css('opacity', 'var(--opacity-level-2)')
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
            /*
            let mask = 'none'
            if(window['home-arrows-active'].top || window['home-arrows-active'].bottom){
                if(window['home-arrows-active'].top){
                    mask = 'transparent 1%, #fff 3%, '
                } else {
                    mask = '#fff 0%, '
                }
                if(window['home-arrows-active'].bottom){
                    mask += '#fff 97%, transparent 99%'
                } else {
                    mask += '#fff 100%'
                }
                mask = 'linear-gradient(to bottom, ' + mask + ')'
            }
            wrapper.css('-webkit-mask-image', mask) // linear-gradient(to top, transparent 2%, #fff 8%, #fff 92%, transparent 98%);
            */
        }

        streamer.on('show', explorer.reset.bind(explorer))
        streamer.on('stop', () => {
            explorer.reset()
            if(explorer.modalContainer && explorer.modalContainer.querySelector('#modal-template-option-wait')){
                explorer.endModal()
            }
        })

        moment.tz.setDefault(Intl.DateTimeFormat().resolvedOptions().timeZone)
        if(lang.locale && !moment.locales().includes(lang.locale)){
            importMomentLocale(lang.locale, () => {
                moment.locale(lang.locale)
                clock.update()
            })
        }

        clock = new Clock(document.querySelector('header time'))

        if(parent.cordova){
            function handleSwipe(e){
                console.log('swipey', e)
                let swipeDist = (innerHeight < innerWidth ? innerHeight : innerWidth) / 2
                if(swipeDist <= e.swipeLength){
                    switch(e.direction){
                        case 'left':
                            if(explorer.inPlayer()){                            
                                streamer.seekFwd()
                            }
                            break
                        case 'right':                        
                            if(explorer.inPlayer()){
                                streamer.seekBack()
                            } else {
                                escapePressed()
                            }
                            break
                        case 'up':
                            if(explorer.inPlayer()){
                                if(!explorer.isExploring()){
                                    arrowDownPressed()
                                }
                            }
                            break
                        case 'down':
                            if(explorer.inPlayer()){
                                if(!explorer.isExploring()){
                                    arrowDownPressed()
                                }
                            }
                            break
                    }
                }
            }
            swipey.add(document.body, handleSwipe, {diagonal: false})
        }

        var setup = new Setup()

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
                window.open('https://megacubo.tv/share/?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(title) + '&text=' + encodeURIComponent(text))
            }
        })

        window.addEventListener('idle-start', () => {
            if(explorer.inPlayer() && !explorer.isExploring()){
                if(document.activeElement != document.body){
                    document.activeElement.blur()
                }
            }
        })
        window.addEventListener('idle-stop', () => {
            setTimeout(explorer.reset.bind(explorer), 400)
        })

        jQuery('html').on('keypress', e => {
            if(!e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && explorer.isExploring()){
                const key = String(e.key).toLowerCase()
                if(key.match(new RegExp('[A-Za-z0-9]'))){
                    let pos = -1
                    explorer.currentEntries.some((n, i) => {
                        if(n.name.charAt(0).toLowerCase() == key){
                            pos = i 
                            return true
                        }
                    })
                    if(pos > 0){
                        explorer.focus(explorer.currentElements[pos])
                    }
                }
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