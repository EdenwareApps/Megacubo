
function getWindowModeEntries(short){
    var options = [];
    if(isMiniPlayerActive()){
        options.push({name: Lang.RESTORE, append: getActionHotkey('ESCAPE'), logo:'fa-window-restore', type: 'option', callback: function (){
            leaveMiniPlayer();
            Menu.refresh()
        }})
    } else if(isFullScreen()){
        options.push({name: Lang.RESTORE, append: getActionHotkey('ESCAPE'), logo:'fa-window-restore', type: 'option', callback: function (){
            setFullScreen(false);
            Menu.refresh()
        }})
    } else {
        options.push({name: Lang.FULLSCREEN, append: getActionHotkey('FULLSCREEN'), logo:'fa-window-maximize', type: 'option', callback: function (){
            setFullScreen(true);
            Menu.refresh()
        }})
        options.push({name: 'Miniplayer', append: getActionHotkey('MINIPLAYER'), logo:'fa-level-down-alt', type: 'option', callback: function (){
            enterMiniPlayer();
            Menu.refresh()
        }})
        if(short !== true){
            options.push({name: Lang.DUPLICATE, append: getActionHotkey('DUPLICATE'), logo:'fa-copy', type: 'option', callback: function (){
                spawnOut()
            }})
        }
    }
    if(short !== true){  
        var resLimit = Config.get('resolution-limit'), cb = (res) => {
            if(!res){
                res = '99999x99999';
            }
            resLimit = res;
            Config.set('resolution-limit', res);
            applyResolutionLimit();
            Menu.refresh();
            setTimeout(() => {
                Menu.restoreScroll();
                mrk()
            }, 400)
        }, mrk = () => {
            var entries = jQuery('a.entry-option');
            entries.each((i) => {
                var el = entries.eq(i), v = el.data('entry-data');
                if(v && (v.label == resLimit || (v.label=='' && resLimit == '99999x99999'))) {
                    setEntryFlag(el, 'fa-check-circle', true)
                }
            })
        };
        
        options.push({name: Lang.RESOLUTION_LIMIT, logo: 'fa-arrows-alt', type: 'group', entries: [
            {name: '480p', label: '854x480', type: 'option', logo:'fa-arrows-alt', callback: (data) => {
                cb(data.label)
            }},
            {name: '720p', label: '1280X720', type: 'option', logo:'fa-arrows-alt', callback: (data) => {
                cb(data.label)
            }},
            {name: '1080p', label: '1920X1080', type: 'option', logo:'fa-arrows-alt', callback: (data) => {
                cb(data.label)
            }},
            {name: Lang.UNLIMITED, label: '', type: 'option', logo:'fa-arrows-alt', callback: (data) => {
                cb(data.label)
            }}
        ], callback: mrk}); 
        
        options.push({name: Lang.GPU_RENDERING, type: 'check', check: function (checked){
            notify(Lang.SHOULD_RESTART, 'fa-cogs faclr-yellow', 'normal');
            Config.set('gpu-rendering', checked);
            setHardwareAcceleration(checked)
        }, checked: () => {
                return Config.get('gpu-rendering')
            }
        });
        
        options.push({
            name: Lang.ACTION_ON_TYPING, 
            type: 'group', 
            logo: 'fa-keyboard',
            entries: [],
            renderer: () => {
                return Object.keys(dialingActions).map((action) => {
                    return {
                        name: ucWords(Lang[action.toUpperCase().replaceAll('-', '_')] || action),
                        type: 'option',
                        logo: dialingActions[action]['icon'],
                        action: action,
                        callback: (data) => {
                            if(Config.get('dialing-action') != data.action){
                                Config.set('dialing-action', data.action);
                                setActiveEntry({action: Config.get('dialing-action')})
                            }
                        }
                    }
                })
            },
            callback: () => {
                setActiveEntry({action: Config.get('dialing-action')})
            }
        });

        options.push({
            name: Lang.MENU_AUTOSCROLL, 
            type: 'check', 
            check: (checked) => {
                Config.set('autoscroll', checked)
            }, 
            checked: () => {
                return Config.get('autoscroll')
            }
        });

        options.push({
            name: Lang.ABBREVIATE_COUNTERS, 
            type: 'check', 
            check: (checked) => {
                Config.set('abbreviate-counters', checked);
                loadTheming()
            }, 
            checked: () => {
                return Config.get('abbreviate-counters')
            }
        })

        options.push({
            name: Lang.SHOW_TOOLTIPS, 
            type: 'check', 
            check: (checked) => {
                Config.set('tooltips', checked);
                loadTheming()
            }, 
            checked: () => {
                return Config.get('tooltips')
            }
        })
    }
    /*
    // DISABLED UNTIL THE CHROMECAST NPM MODULE BE FIXED

    
    {request: {…}, error: "mime-unknown"}
    error
    :
    "mime-unknown"
    request
    :
    entity
    :
    {v: "cKG5HDyTW8o"}
    headers
    :
    {Content-Type: "application/x-www-form-urlencoded.js", Accept: "application/x-www-form-urlencoded.js, application/json;q=0.8, text/plain;q=0.5, *;q=0.2"}
    method
    :
    "POST"
    originator
    :
    ƒ interceptedClient(request)
    path
    :
    "http://192.168.1.6:8008/apps/YouTube"
    __proto__
    :
    Object
    __proto__
    :
    Object
    "Unhandled Rejection at Promise" 
    Rejected {id: 19, value: {…}, handled: false, reported: true}
    process.on	@	index.html:49
    emit	@	events.js:182
    (anonymous)	@	F:\NWJS_SDK\package.…\makePromise.js:917
    ReportTask.run	@	F:\NWJS_SDK\package.…\makePromise.js:654
    Scheduler._drain	@	F:\NWJS_SDK\package.…lib\Scheduler.js:70
    Scheduler.drain	@	F:\NWJS_SDK\package.…lib\Scheduler.js:27
    _tickCallback	@	internal/process/next_tick.js:61


    options.push({name: 'Chromecast', logo:'fa-chrome', type: 'option', callback: function (){
        castManagerInit();
        Menu.refresh()
    }})
    */
    return options;
}

function getHistoryEntries(){
    var options = History.get();
    console.log('HISTORY', options);
    if(options.length){
        options.push({name: Lang.CLEAR, logo:'fa-broom', type: 'option', callback: function (){
            History.clear();
            Menu.refresh()
        }})
    } else {
        options.push(Menu.emptyEntry())
    }
    return options;
}

function getRemoteSources(callback){
    var url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json';
    return fetchEntries(url, callback)
}

function loadSource(url, name, callback, filter, isVirtual){
    var path = assumePath(name);
    if(!isVirtual) {
        var container = Menu.container(true);
        Menu.renderBackEntry(container, dirname(path), name)
    }
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle faclr-red', 'normal');
        Menu.back()
    }
    setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
        ListMan.deepParse(url, (parsed) => {
            if(parsed.length){
                console.log(parsed);
                if(typeof(filter)=='function'){
                    parsed = parsed.map(filter)
                }
                if(path.indexOf(Lang.ALL_LISTS) != -1){
                    if(getSourcesURLs().indexOf(url)==-1){
                        parsed.unshift({
                            type: 'option',
                            logo: 'fa-download',
                            name: Lang.ADD_TO.format(Lang.MY_LISTS),
                            callback: () => {
                                registerSource(url, name, false)
                            }
                        })
                    } else {
                        parsed.unshift({
                            type: 'disabled',
                            logo: 'fa-download',
                            name: Lang.LIST_ALREADY_ADDED
                        })
                    }
                }
                Menu.asyncResult(path, parsed);
                if(typeof(callback) == 'function'){
                    callback(parsed, path)
                }
            } else {
                if(!isVirtual) {
                    failed()
                }
            }
        })
    }, loadingToActionDelay);
    return [Menu.loadingEntry()];
}

var watchingEntries = []

addAction('getWatchingData', (entries) => {
    var options = entries.slice(0)
    let groups = {}, gcount = {}, gentries = []
    options = options.map(entry => {
        if(entry.label.indexOf('{') != -1){
            entry.label = entry.label.format(Lang.USER, Lang.USERS)
        }
        entry.users = extractInt(entry.label)
        return entry
    })
    options.forEach((entry, i) => {
        let term = searchTermFromEntry(entry)
        if(term){
            if(typeof(groups[term]) == 'undefined'){
                groups[term] = []
                gcount[term] = 0
            }
            groups[term].push(entry)
            gcount[term] += entry.users
            delete options[i]
        }
    })
    Object.keys(groups).forEach(n => {
        let e, already = [], megas = [], streams = []
        groups[n].forEach((e, i) => {            
            if(isMegaURL(e.url)){
                let atts = parseMegaURL(e.url)
                if(atts.name){
                    let nl = atts.name.toLowerCase()
                    if(already.indexOf(nl) == -1){
                        groups[n][i].name = ucWords(atts.name)
                        already.push(nl)
                        megas.push(groups[n][i])
                    }
                }
            } else {
                streams.push(e)
            }
        })
        if(megas.length > 1){
            e = {
                name: ucWords(n), 
                type: 'group',
                logo: defaultIcons['stream'], 
                logos: pickLogosFromEntries(groups[n]),
                entries: megas,
                users: gcount[n]
            }
        } else if(megas.length == 1) {
            e = megas[0]
        } else {
            e = {
                name: ucWords(n), 
                type: 'stream',
                logo: defaultIcons['stream'], 
                logos: pickLogosFromEntries(groups[n]),
                url: 'mega://play|'+ucWords(n),
                users: gcount[n]
            }
        }
        gentries.push(e)
    })
    //console.warn('GENTR', options)
    options = options.filter(e => {
        return !!e
    }).concat(gentries).sort((a,b) => {
        return (a.users > b.users) ? -1 : ((b.users > a.users) ? 1 : 0)
    })
    options.forEach((entry, i) => {
        if(!entry.__parsed){
            options[i].label = (i + 1)+'&ordm; &middot; '+(entry.isAudio ? Lang.LISTENING : Lang.X_WATCHING).format(parseCounter(options[i].users))
            if(typeof(entry.url) == 'string' && isMegaURL(entry.url)){
                //console.log('FETCH WATCHING', entry.url, mediaType);
                options[i].url = updateMegaURLQSAppend(entry.url, {mediaType: entry.mediaType})
            }
            entry.__parsed = true
        }   
    })
    if(!options.length){
        options.push(Menu.emptyEntry())
    }
    watchingEntries = options
})

function getWatchingEntries(mediaType){
    var options = watchingEntries.slice(0)
    if(mediaType && mediaType != 'all'){
        options = options.filter(e => {
            return mediaType == e.mediaType || (e.url && e.url.indexOf('mediaType='+mediaType) != -1)
        })
    }
    if(!options.length){
        if(watchingEntries.length){
            options.push(Menu.emptyEntry())
        } else {
            options.push(Menu.loadingEntry())
        }
    }
    return paginateEntries(options)
}

function getWatchingData(cb, update, locale){
    let entries = watchingData.slice(0)
    if(typeof(cb)=='function'){
        cb(entries)
    }
    return entries
}

addAction('getWatchingData', (entries) => {
    return entries.map((entry) => {
        setStreamStateCache(entry, true)
        return entry
    })
})

function parseLabelCount(data){
    var count = 0, ctl = '', type = 'total', fmt = Lang.X_WATCHING, type = 'total'
    /*
    if(typeof(data.mediaType) != 'undefined' && typeof(mediaTypeStreamsCount[data.mediaType]) != 'undefined'){
        count = mediaTypeStreamsCount[data.mediaType];
        type = data.mediaType;
        switch(type){
            case 'live':
                fmt = Lang.X_BROADCASTS;
                break;
            case 'video':
                fmt = Lang.X_VIDEOS;
                break;
            case 'audio':
                fmt = Lang.X_STATIONS;
                break;
        }
    }
    */
    if(typeof(onlineUsersCount[type]) != 'undefined'){
        count = onlineUsersCount[type];
        return fmt.format(parseCounter(count))
        /*
        if(typeof(mediaTypeStreamsCount[type]) != 'undefined'){
            if(!indexerVarsAvailable){
                return '<i class="fas fa-circle-notch pulse-spin search-index-vary"></i> '+Lang.PROCESSING
            }
            count = type == 'total' ? onlineUsersCount['total'] : mediaTypeStreamsCount[type];
            return fmt.format(parseCounter(count))
        */
    }
    return '';
}

function getAppearanceOptionsEntries(){
    return [
        {
            name: Lang.HIDE_MENU_AUTOMATICALLY, 
            type: 'check', 
            check: (checked) => {
                Theme.set('hide-menu-auto', checked);
                Menu.autoHide(checked)
            }, 
            checked: () => {
                return Theme.get('hide-menu-auto')
            }
        },
        {
            name: Lang.SLIDE_MENU_TRANSITIONS, 
            type: 'check', 
            check: (checked) => {
                Theme.set('slide-menu-transitions', checked)
            }, 
            checked: () => {
                return Theme.get('slide-menu-transitions')
            }
        },
        {
            name: Lang.HIGHLIGHT_INTENSITY, 
            type: 'slider', 
            logo: 'fa-adjust', 
            range: {start: 0, end: 100}, 
            getValue: (data) => {
                return Theme.get('highlight-opacity')
            },
            value: Theme.get('highlight-opacity'),
            change:  (data, element, value) => {
                Theme.set('highlight-opacity', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        },
        {
            name: Lang.MENU_OPACITY, 
            type: 'slider', 
            logo: 'fa-adjust', 
            range: {start: 0, end: 100}, 
            getValue: (data) => {
                return Theme.get('menu-opacity')
            },
            value: Theme.get('menu-opacity'),
            change:  (data, element, value) => {
                Theme.set('menu-opacity', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        },
        {
            name: Lang.ICON_ROUNDING, 
            type: 'slider', 
            logo: 'fa-adjust', 
            range: {start: 0, end: 50}, 
            getValue: (data) => {
                return Theme.get('icon-rounding')
            },
            value: Theme.get('icon-rounding'),
            change:  (data, element, value) => {
                Theme.set('icon-rounding', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        },       
        {
            name: Lang.ICON_FRAMING, 
            type: 'group',
            logo: 'fa-adjust',
            entries: [],
            renderer: () => {
                return ['x', 'y', 'disabled'].map((o) => {
                    let u = o.toUpperCase(), n = typeof(Lang[u]) == 'string' ? Lang[u] : u
                    return {
                        name: n,
                        type: 'option',
                        mode: o,
                        callback: (data) => {
                            if(Theme.get('icon-framing') != data.mode){
                                Theme.set('icon-framing', o);
                                loadTheming();
                                setActiveEntry({mode: Theme.get('icon-framing')})
                            }
                        }
                    }
                })
            },
            callback: () => {
                setActiveEntry({mode: Theme.get('icon-framing')})
            }
        }
    ]
}

function getAppearanceSizeEntries(){
    return [
        {
            name: Lang.ICON_SIZE, 
            logo: 'fa-ruler',
            type: 'slider', 
            range: {start: 12, end: 48}, 
            getValue: (data) => {
                return Theme.get('icon-size')
            },
            value: Theme.get('icon-size'),
            change:  (data, element, value) => {
                Theme.set('icon-size', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }, 
        {
            name: Lang.MENU_WIDTH, 
            type: 'slider', 
            logo: 'fa-ruler',  
            range: {start: 10, end: 100}, 
            getValue: (data) => {
                return Theme.get('menu-width')
            },
            value: Theme.get('menu-width'),
            change:  (data, element, value) => {
                Theme.set('menu-width', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }, 
        {
            name: Lang.MENU_HEIGHT, 
            type: 'slider', 
            logo: 'fa-ruler',  
            range: {start: 4, end: 36}, 
            getValue: (data) => {
                return Theme.get('menu-entry-vertical-padding')
            },
            value: Theme.get('menu-entry-vertical-padding'),
            change:  (data, element, value) => {
                Theme.set('menu-entry-vertical-padding', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }, 
        {
            name: Lang.MENU_MARGIN, 
            type: 'slider', 
            logo: 'fa-ruler', 
            range: {start: 0, end: 50}, 
            getValue: (data) => {
                return Theme.get('menu-margin')
            },
            value: Theme.get('menu-margin'),
            change:  (data, element, value) => {
                Theme.set('menu-margin', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }, 
        {
            name: Lang.MENU_INSET_SHADOW, 
            type: 'slider', 
            logo: 'fa-ruler', 
            range: {start: 0, end: 50}, 
            getValue: (data) => {
                return Theme.get('menu-inset-shadow')
            },
            value: Theme.get('menu-inset-shadow'),
            change:  (data, element, value) => {
                Theme.set('menu-inset-shadow', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }, 
        {
            name: Lang.HIDE_BUTTON_OPT.format(Lang.BACK, 'Backspace'), 
            type: 'check', 
            check: (checked) => {
                Theme.set('hide-back-button',checked);
                Menu.refresh()
            }, 
            checked: () => {return Theme.get('hide-back-button')}
        }
    ]
}

function getAppearanceColorsEntries(){
    var bgcb = (data, element, key) => {
        setEntryFlag(element, 'fa-check-circle', true);
        var prevColor = Theme.get(key), prevImage = Theme.get('background-image');
        if(prevImage.substr(6, 9) == '-gradient' && prevImage.indexOf(prevColor) != -1){
            Theme.set('background-image', prevImage.replaceAll(prevColor, data.color));
        }
        Theme.set(key, data.color);
        loadTheming()
    }
    return [
        {
            name: Lang.REMOVE_BACKGROUND_IMAGE, 
            type: 'option',
            logo: 'fa-image',
            callback: () => {
                Theme.set('background-image', 'linear-gradient(to top, #000004 0%, '+Theme.get('background-color')+' 75%)');
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        },            
        {
            name: Lang.CHANGE_BACKGROUND_IMAGE, 
            type: 'option',
            logo: 'fa-image',
            callback: () => {
                openFileDialog((file) => {
                    applyBackgroundImage(file)
                }, ".jpeg,.jpg,.png,.webm,.mp4")
            }
        },            
        {
            name: Lang.CHANGE_LOGO_IMAGE, 
            type: 'option',
            logo: 'fa-image',
            callback: () => {
                openFileDialog((file) => {
                    applyLogoImage(file)
                }, ".png")
            }
        },
        {
            name: Lang.BACKGROUND_COLOR, 
            type: 'group',
            logo: 'fas fa-paint-roller',
            entries: [Menu.loadingEntry()],
            callback: () => {
                let alreadyChosenColor = Theme.get('background-color'), curPath = Menu.path, wpfile = "assets/images/wallpaper.png";
                getImageColorsForTheming(Theme.get('background-image') || wpfile, (colors) => {
                    let alreadyChosenIndex = -1;
                    console.warn('WOW', curPath, Menu.path, colors);
                    var entries = colors.darkColors.concat(colors.lightColors).concat(getThemeColors()).getUnique().map((color, i) => {
                        let _color = color;
                        if(_color == alreadyChosenColor) {
                            alreadyChosenIndex = i;
                        }
                        return {
                            name: _color,
                            type: 'option',
                            logo: 'fas fa-circle',
                            color: _color,
                            logoColor: _color,
                            callback: (data, element) => {
                                alreadyChosenColor = data.color;
                                bgcb(data, element, 'background-color');
                            }
                        }
                    });
                    entries.push({
                        name: Lang.OTHER_COLOR,
                        type: 'option',
                        logo: 'fa-palette',
                        callback: (data, element) => {
                            pickColor((_color) => {
                                if(_color){
                                    alreadyChosenColor = data.color = _color;
                                    bgcb(data, element, 'background-color')
                                }
                            }, alreadyChosenColor)
                        }
                    });
                    if(curPath == Menu.path){
                        Menu.container(true);
                        Menu.renderBackEntry(Menu.container(true), dirname(curPath), basename(curPath));
                        Menu.render(entries, curPath);
                        if(alreadyChosenIndex != -1){
                            setEntryFlag(Menu.getEntries(false, false).get(alreadyChosenIndex + 1), 'fa-check-circle', true)
                        }
                    }
                })
            }
        },
        {
            name: Lang.BACKGROUND_COLOR_WHILE_PLAYING, 
            type: 'group',
            logo: 'fas fa-paint-roller',
            entries: [Menu.loadingEntry()],
            callback: () => {
                let alreadyChosenColor = Theme.get('background-color-playing'), curPath = Menu.path, wpfile = "assets/images/wallpaper.png";
                getImageColorsForTheming(Theme.get('background-image') || wpfile, (colors) => {
                    let alreadyChosenIndex = -1;
                    console.warn('WOW', curPath, Menu.path, colors);
                    var entries = colors.darkColors.concat(colors.lightColors).concat(getThemeColors()).getUnique().map((color, i) => {
                        let _color = color;
                        if(_color == alreadyChosenColor) {
                            alreadyChosenIndex = i;
                        }
                        return {
                            name: _color,
                            type: 'option',
                            logo: 'fas fa-circle',
                            logoColor: _color,
                            color: _color,
                            callback: (data, element) => {
                                alreadyChosenColor = data.color;
                                bgcb(data, element, 'background-color-playing')
                            }
                        }
                    });
                    entries.push({
                        name: Lang.OTHER_COLOR,
                        type: 'option',
                        logo: 'fa-palette',
                        callback: (data, element) => {
                            pickColor((_color) => {
                                if(_color){
                                    alreadyChosenColor = data.color = _color;
                                    bgcb(data, element, 'background-color-playing')
                                }
                            }, alreadyChosenColor)
                        }
                    });
                    if(curPath == Menu.path){
                        Menu.container(true);
                        Menu.renderBackEntry(Menu.container(true), dirname(curPath), basename(curPath));
                        Menu.render(entries, curPath);
                        if(alreadyChosenIndex != -1){
                            setEntryFlag(Menu.getEntries(false, false).get(alreadyChosenIndex + 1), 'fa-check-circle', true)
                        }
                    }
                })
            }
        },        
        {
            name: Lang.BACKGROUND_OPACITY, 
            logo: 'fa-cog',
            type: 'slider', 
            range: {start: 0, end: 100}, 
            getValue: (data) => {
                return Theme.get('background-opacity')
            },
            value: Theme.get('background-opacity'),
            change:  (data, element, value) => {
                Theme.set('background-opacity', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }
    ]
}

function getAppearanceFontEntries(){
    return [          
        {
            name: Lang.FONT, 
            type: 'group',
            logo: 'fa-font',
            entries: [],
            renderer: () => {
                return getFontList().map((font) => {
                    return {
                        name: ucWords(font),
                        type: 'option',
                        font: font,
                        callback: (data) => {
                            if(Theme.get('font-family') != data.font){
                                Theme.set('font-family', data.font);
                                loadTheming();
                                setActiveEntry({font: Theme.get('font-family')})
                            }
                        }
                    }
                })
            },
            callback: () => {
                setActiveEntry({font: Theme.get('font-family')})
            }
        },
        {
            name: Lang.FONT_SIZE, 
            logo: 'fa-font',
            type: 'slider', 
            range: {start: 6, end: 32}, 
            getValue: (data) => {
                return Theme.get('font-size')
            },
            value: Theme.get('font-size'),
            change:  (data, element, value) => {
                Theme.set('font-size', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        }, 
        {
            name: Lang.FONT_WEIGHT, 
            logo: 'fa-font',
            type: 'slider', 
            range: {start: 100, end: 800}, 
            getValue: (data) => {
                return Theme.get('font-weight')
            },
            value: Theme.get('font-weight'),
            change:  (data, element, value) => {
                Theme.set('font-weight', value);
                clearTimeout(window['loadThemingApplyTimer']);
                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
            }
        },
        {
            name: Lang.FONT_COLOR, 
            type: 'group',
            logo: 'fa-paint-brush',
            entries: [Menu.loadingEntry()],
            callback: () => {
                let alreadyChosenColor = Theme.get('font-color'), curPath = Menu.path, wpfile = "assets/images/wallpaper.png";
                getImageColorsForTheming(wpfile, (colors) => {
                    let alreadyChosenIndex = -1;
                    console.warn('WOW', curPath, Menu.path, colors);
                    var entries = colors.darkColors.concat(colors.lightColors).concat(getThemeColors()).getUnique().map((color, i) => {
                        let _color = color;
                        if(_color == alreadyChosenColor){
                            alreadyChosenIndex = i;
                        }
                        return {
                            name: _color,
                            type: 'option',
                            logo: 'fas fa-circle',
                            logoColor: _color,
                            callback: (data, element) => {
                                setEntryFlag(element, 'fa-check-circle', true);
                                Theme.set('font-color', _color);
                                loadTheming()
                            }
                        }
                    });
                    entries.push({
                        name: Lang.OTHER_COLOR,
                        type: 'option',
                        logo: 'fa-palette',
                        callback: (data, element) => {
                            pickColor((_color) => {
                                if(_color){
                                    Theme.set('font-color', _color);
                                    loadTheming()
                                }
                            }, alreadyChosenColor)
                        }
                    });
                    if(curPath == Menu.path){
                        Menu.container(true);
                        Menu.renderBackEntry(Menu.container(true), dirname(curPath), basename(curPath));
                        Menu.render(entries, curPath);
                        if(alreadyChosenIndex != -1){
                            setEntryFlag(Menu.getEntries(false, false).get(alreadyChosenIndex + 1), 'fa-check-circle', true)
                        }
                    }
                })
            }
        },  
        {
            name: Lang.ANIMATE_BACKGROUND_ON_TUNING, 
            type: 'group', 
            logo: 'fa-cog',
            entries: [
                {name: 'None', type: 'option', animation: 'none', callback: setBackgroundAnimationCallback},
                {name: 'Spin X', type: 'option', animation: 'spin-x', callback: setBackgroundAnimationCallback}
            ],
            callback: () => {
                setActiveEntry({animation: Theme.get('tuning-background-animation')})
            }
        },
        {
            name: Lang.HIDE_SEEKBAR, 
            type: 'check', 
            check: (checked) => {
                Theme.set('hide-seekbar', checked);
                hideSeekbar(checked)
            }, 
            checked: () => {return Theme.get('hide-seekbar')}
        },
        {
            name: Lang.HIDE_BUTTON_OPT.format(Lang.BACK, 'Backspace'), 
            type: 'check', 
            check: (checked) => {
                Theme.set('hide-back-button',checked);
                Menu.refresh()
            }, 
            checked: () => {return Theme.get('hide-back-button')}
        },
        {
            name: Lang.UPPERCASE_LETTERS_MENU, 
            type: 'check', 
            check: (checked) => {
                Theme.set('menu-uppercase', checked);
                loadTheming()
            }, 
            checked: () => {return Theme.get('menu-uppercase')}
        }
    ]
}

function getToolsEntries(){
    var opts = [
        {name: Lang.HISTORY, append: getActionHotkey('HISTORY'), logo:'fa-history', type: 'group', renderer: getHistoryEntries, entries: []}, 
        {name: Lang.TIMER, logo:'fa-stopwatch', class: 'entry-timer', type: 'group', renderer: timer},    
        {name: ucWords(Lang.USERS), type: 'group', logo: 'fa-user', renderer: getProfileEntries}
    ]
    opts = applyFilters('afterToolsEntries', applyFilters('toolsEntries', opts))
    opts.push({name: Lang.HELP, logo: 'fa-question-circle', class: 'entry-nosub', type: 'option', callback: help})
    return opts
}

function getTranscodeEntries(){
    var opts = [        
        /*
        ,
        {
            name: 'Force framerate',
            logo: 'fa-film',
            type: 'group',
            entries: [
                {
                    name: Lang.NONE,
                    logo: 'fa-film',
                    type: 'option',
                    callback: () => {
                        Config.set('transcode-fps', 0)
                        Playback.transcode(null)
                        Menu.back()
                    }
                },
                {
                    name: '60fps',
                    logo: 'fa-film',
                    type: 'option',
                    callback: () => {
                        Config.set('transcode-fps', 60)
                        Playback.transcode(null)
                        Menu.back()
                    }
                },
                {
                    name: '120fps',
                    logo: 'fa-film',
                    type: 'option',
                    callback: () => {
                        Config.set('transcode-fps', 120)                        
                        Playback.transcode(null)
                        Menu.back()
                    }
                }
            ]
        }
        */
    ]
    let active = Playback.active || Playback.lastActive
    if(active){
        if(['html'].indexOf(active.type) == -1){
            opts.push({
                name: 'Audio',
                type: 'check',
                class: 'entry-vary-play-state',
                checked: () => {
                    active = Playback.active || Playback.lastActive
                    return active.audioCodec != 'copy'
                },
                check: (checked) => { 
                    active = Playback.active || Playback.lastActive
                    active.audioCodec = checked ? 'aac' : 'copy'
                    active.restartDecoder()
                }
            })
            opts.push({
                name: 'Video',
                type: 'check',
                class: 'entry-vary-play-state',
                checked: () => {
                    active = Playback.active || Playback.lastActive
                    return active.videoCodec != 'copy'
                },
                check: (checked) => { 
                    active = Playback.active || Playback.lastActive
                    active.videoCodec = checked ? 'libx264' : 'copy'
                    active.restartDecoder()
                }
            })
        } else {
            opts.push({
                name: Lang.PLAYBACK_UNSUPPORTED_STREAM,
                logo: 'fa-ban',
                type: 'option',
                class: 'entry-vary-play-state',
                callback: jQuery.noop
            })
        }
    } else {
        opts.push({
            name: Lang.START_PLAYBACK_FIRST,
            logo: 'fa-ban',
            type: 'option',
            class: 'entry-vary-play-state',
            callback: jQuery.noop
        })
    }
    return opts
}

function searchingEntriesSetLoading(){
    let container = Menu.container()
    if(!container.find('a.entry-loading').length){
        container.find('a.entry-stream, a.entry-loading, a.entry-tuning, a.entry-empty').remove()
        Menu.render([
            Menu.loadingEntry()
        ], -1, container.find('a.entry').length)
    }
}

function getSearchingEntries(){
    let term = lastSearchTerm, type = lastSearchType, n = Playback.active, container = Menu.container()
    if(n && n.entry.originalUrl && isMegaURL(n.entry.originalUrl)){
        var data = parseMegaURL(n.entry.originalUrl)
        if(data && data.type == 'play'){
            term = data.name
        }
    }
    let entries = [
        {
            type: 'input',
            name: Lang.SEARCH,
            change: (e, element, val) => {
                var np = container.find('a.entry-input'), initPath = Menu.path;
                clearTimeout(searchKeypressTimer);
                if(val){
                    lastSearchTerm = val
                    Store.set('last-search-term', val, true)
                    searchingEntriesSetLoading()
                } else {
                    if(!container.find('a.entry-empty').length){
                        container.find('a.entry-stream, a.entry-loading, a.entry-tuning, a.entry-empty').remove()
                        Menu.list([Menu.emptyEntry()], Menu.path)
                    }
                }
                Pointer.focus(np)
                np.find('input').get(0).focus()
                var initialTerms = val, callback = (results) => {
                    if(Menu.path == initPath && initialTerms == lastSearchTerm){
                        var append = Menu.query(Menu.getEntries(true, true, true), {type: 'stream'}).length;
                        console.log('QQQ', results, val, type, Menu.path);
                        results = results.map((e) => {
                            e.origin = {
                                term: val,
                                searchType: type
                            }
                            return e
                        })
                        if(append){
                            if(results.length){
                                Menu.list(results, Menu.path, Menu.getEntries(false, false, false).length)
                            }
                        } else {
                            container.find('a.entry-stream, a.entry-loading, a.entry-tuning, a.entry-group:not(.entry-search-meta), a.entry-suggest, a.entry-empty').remove();
                            if(!results.length){
                                results = [Menu.emptyEntry(Lang.NO_RESULTS, 'fa-ban')]
                            }
                            Menu.list(results, Menu.path)
                        }
                        Pointer.focus(np)
                        np.find('input').get(0).focus()
                    }
                }
                searchKeypressTimer = setTimeout(() => {
                    clearTimeout(searchKeypressTimer)
                    if(initPath == Menu.path){
                        if(val.length < 2){
                            callback([])
                            if(type == 'live'){
                                getSearchSuggestions()
                            }
                            return
                        }
                        searchingEntriesSetLoading()
                        var parentalControlAllowed = parentalControlAllow(val, true)
                        console.warn('SEARCHING...', type, parentalControlAllowed)
                        if(adultContentPolicy == 'allow' || parentalControlAllowed){   
                            searchEngines[type].callback(val, callback)
                        } else if(!parentalControlAllowed) {
                            let e = Menu.emptyEntry(Lang.ADULT_CONTENT_BLOCKED, 'fa-ban')
                            e.callback = () => {
                                Menu.go(secPath, () => {
                                    Menu.setBackTo(initPath)
                                })
                            }
                            callback([e])
                        } else {
                            callback([Menu.emptyEntry(Lang.NO_RESULTS, 'fa-ban')])
                        }
                        sendStats('search', {query: val, type})
                    }
                }, 750)
            },
            value: term,
            placeholder: Lang.SEARCH_PLACEHOLDER
        },
        {
            name: Lang.SEARCH_OPTIONS, 
            label: Lang.SEARCH, 
            type: 'group', 
            logo: 'fa-cog', 
            class: 'entry-search-meta',
            callback: () => {
                Menu.setBackTo(searchPath)
                setTimeout(() => {
                    if(basename(Menu.path) == Lang.SEARCH_OPTIONS){
                        Menu.setBackTo(searchPath)
                    }
                }, 200)
            },
            entries: [
                {name: Lang.SEARCH_FOR, type: 'group', logo: 'fa-search', renderer: () => { 
                    return Object.values(searchEngines).map(engine => {
                        return {
                            name: engine.name,
                            slug: engine.slug,
                            logo: 'fa-search',
                            type: 'option',
                            callback: (data) => {
                                goSearch(null, data.slug)
                            }
                        }
                    })
                }, callback: () => {
                    setActiveEntry({slug: lastSearchType})
                }},
                {name: Lang.SECURITY, type: 'option', logo: 'fa-shield-alt', callback: () => { 
                    Menu.go(secPath);
                    Menu.setBackTo(searchPath)
                }},
                {name: Lang.TUNE, type: 'option', logo: 'fa-broadcast-tower', callback: () => { 
                    Menu.go(tunePath);
                    Menu.setBackTo(searchPath)
                }}
            ]
        }
    ]
    return entries
}

function getSettingsEntries(){
    var showP2PPortSelector = (show) => {
        jQuery('.entry-p2p-port')[(show?'remove':'add')+'Class']('entry-hide')
    }
    var opts = [
        {name: Lang.PREFERRED_SECTIONS, type: 'group', logo: 'fa-th-list', entries: [],
            renderer: () => {
                return Menu.entries.filter((e) => { return typeof(e.homeId) != 'undefined' }).map((e) => { return e.homeId }).
                map((type) => {
                    return {
                        name: Lang[type.toUpperCase().replaceAll('-', '_')] || type,
                        homeId: type,
                        type: 'check', 
                        check: (checked, data) => {
                            var curs = Config.get('initial-sections');
                            if(checked){
                                if(curs.indexOf(data.homeId) == -1){
                                    curs.push(data.homeId)
                                }
                            } else {
                                var i = curs.indexOf(data.homeId);
                                if(i != -1){
                                    curs.splice(i, 1);
                                }
                            }
                            Config.set('initial-sections', curs)
                        }, 
                        checked: (data) => {
                            var curs = Config.get('initial-sections');
                            return curs.indexOf(data.homeId) != -1;
                        }
                    }
                })
            }
        },  
        {name: Lang.PREFERRED_SECTIONS_ONLY, type: 'check', 
            check: (checked) => {
                Config.set('initial-sections-only', checked)
            }, 
            checked: () => {
                return Config.get('initial-sections-only')
            }
        },
        {name: Lang.INITIAL_SECTION, type: 'group', logo: 'fa-home', entries: [],
            renderer: () => {
                var entries = Menu.entries.filter((e) => { return typeof(e.homeId) != 'undefined' && e.type =='group' }).map((e) => { return e.homeId }).
                map((type) => {
                    return {
                        name: Lang[type.toUpperCase().replaceAll('-', '_')] || type,
                        homeId: type,
                        type: 'option', 
                        callback: (data) => {
                            Config.set('initial-section', data.homeId);
                            setActiveEntry({homeId: data.homeId})
                        }
                    }
                });
                entries.unshift({
                    name: Lang['HOME'],
                    homeId: '',
                    type: 'option', 
                    callback: (data) => {
                        Config.set('initial-section', data.homeId);
                        setActiveEntry({homeId: data.homeId})
                    }
                });
                return entries;
            },
            callback: () => {
                setActiveEntry({homeId: Config.get('initial-section')})
            }
        },             
        {name: Lang.LANGUAGE, homeId: 'live', append: getActionHotkey('CHANGELANG'), logo:'fa-language', type: 'group', renderer: getLanguageEntries, callback: markActiveLocale, entries: []},
        {name: Lang.WINDOW, homeId: 'live', logo:'fa-window-maximize', type: 'group', renderer: getWindowModeEntries, entries: []},
        {name: Lang.APPEARANCE, homeId: 'live', logo:'fa-palette', type: 'group', renderer: getThemeEntries, entries: [], callback: () => {
            setActiveEntry({
                name: Theme.data.name
            })
        }},
        {name: Lang.SECURITY, logo: 'fa-shield-alt', type: 'group', entries: [
            {
                name: Lang.HIDE_LOGOS,
                type: 'check',
                check: (checked) => {
                    Theme.set('hide-logos', checked);
                    showLogos = !checked;
                }, 
                checked: () => {
                    return Theme.get('hide-logos')
                }
            },
            {
                name: Lang.ADULT_CONTENT,
                logo: 'fa-user-lock',
                type: 'group',
                isSafe: true,
                callback: () => {
                    setActiveEntry({
                        value: Config.get('adult-content-policy')
                    })
                },
                renderer: () => {
                    return [
                        {
                            key: 'allow',
                            logo: 'fa-lock-open'
                        }, 
                        {
                            key: 'block',
                            logo: 'fa-lock'
                        }
                    ].map(n => {
                        return {
                            name: Lang[n.key.replaceAll('-', '_').toUpperCase()],
                            value: n.key,
                            logo: n.logo,
                            type: 'option',
                            isSafe: true,
                            callback: (data) => {
                                adultContentPolicy = n.key;
                                Config.set('adult-content-policy', n.key)
                                setActiveEntry({value: n.key})
                            }
                        }
                    })
                }
            },
            {
                type: 'input',
                logo: 'assets/icons/white/shield.png',
                change: function (entry, element, val){
                    Config.set('parental-control-terms', val)
                },
                value: userParentalControlTerms().join(','),
                placeholder: Lang.FILTER_WORDS,
                isSafe: true,
                name: Lang.FILTER_WORDS
            }
        ]},
        {name: Lang.PLAYBACK, logo:'fa-play', type: 'group', entries: [
            {name: Lang.RESUME_PLAYBACK, type: 'check', check: (checked) => {
                Config.set('resume', checked)
            }, checked: () => {
                return Config.get('resume')
            }},
            {name: Lang.WARN_IF_CONN_ERR, type: 'check', check: (checked) => {
                Config.set('warn-on-connection-errors', checked)
            }, checked: () => {
                return Config.get('warn-on-connection-errors')
            }},
            {name: Lang.ASPECT_RATIO, append: getActionHotkey('CHANGESCALE'), logo:'fa-arrows-alt', type: 'group', renderer: () => {
                return scaleModes.concat(['1:1', '1.85:1', '2.35:1', '2.39:1', '2.4:1']).map((scale) => {
                    return {
                        name: scale,
                        logo: 'fa-arrows-alt',
                        type: 'option',
                        callback: (data) => {
                            Playback.setRatio(data.name)
                            setActiveEntry({name: data.name})
                        }
                    }
                })
            }, callback: () => {
                setActiveEntry({name: Playback.ratio})
            }},   
            {name: Lang.STRETCH_TO_FIT, type: 'check', check: function (checked){
                Config.set('autofit', checked);
                AutoScaler.update()
            }, checked: () => {
                    return Config.get('autofit')
                }
            },  
            {name: Lang.FORCE_TRANSCODE_BROADCAST, logo: 'fa-cogs', type: 'group', renderer: getTranscodeEntries},
            {name: Lang.ADVANCED, logo:'fa-cogs', type: 'group', renderer: () => {
                return [
                    {name: 'TS JOINING NEEDLE SIZE', type: 'slider', logo: 'fa-cut', mask: '{0} KB', value: Config.get('ts-joining-needle-size'), range: {start: 64, end: 9136}, change: (data, element) => {
                        Config.set("ts-joining-needle-size", data.value)
                        if(TSPool){
                            TSPool.updateConfig()
                        }
                    }},
                    {name: 'TS JOINING STACK SIZE', type: 'slider', logo: 'fa-ruler-horizontal', mask: '{0} MB', value: Config.get('ts-joining-stack-size'), range: {start: 2, end: 24}, change: (data, element) => {
                        Config.set("ts-joining-stack-size", data.value)
                        if(TSPool){
                            TSPool.updateConfig()
                        }
                    }},
                    {name: Lang.RESTORE, logo:'fa-undo', type: 'option', callback: function (){
                        ["ts-joining-needle-size", "ts-joining-stack-size"].forEach((r) => {
                            Config.set(r, Config.defaults[r])
                        })
                        Menu.refresh()
                        if(TSPool){
                            TSPool.updateConfig()
                        }
                    }}
                ]
            }}
        ]},
        {name: Lang.TUNE, logo: 'fas fa-satellite-dish', type: 'group', entries: [
            {name: Lang.P2P_ACCELERATION, label: '&nbsp;', type: 'check', class: 'entry-allow-p2p', check: (checked) => {
                Config.set('p2p', checked)
                // showP2PPortSelector(checked)
                if(Playback.active){
                    goReload()
                }
            }, checked: () => {return Config.get('p2p')}},    
            {name: Lang.PLAY_WHILE_TUNING, type: 'check', check: (checked) => {
                Config.set('play-while-tuning', checked)
            }, checked: () => {
                return Config.get('play-while-tuning')
            }},
            {name: Lang.IGNORE_WEB_PAGES, type: 'check', check: (checked) => {
                Config.set('tuning-ignore-webpages', checked)
                Tuning.destroyAll()
            }, checked: () => {
                return Config.get('tuning-ignore-webpages')
            }},
            {name: Lang.BOOKMARKS_DIALING, type: 'check', check: (checked) => {
                Config.set('bookmark-dialing', checked)
            }, checked: () => {
                return Config.get('bookmark-dialing')
            }},
            {name: Lang.SEARCH_RANGE, logo: 'fa-search', type: 'group', renderer: getSearchRangeEntries, entries: [], callback: () => {
                setActiveEntry({
                    value: Config.get('search-range-size')
                })
            }},
            {name: Lang.WHEN_TRANSMISSION_FAILS, logo: 'fa-times-circle', type: 'group', renderer: getConnectingErrorEntries, entries: [], callback: () => {
                setActiveEntry({
                    value: Config.get('connecting-error-action')
                })
            }},
            {name: Lang.DIAGNOSTIC_TOOL, type: 'group', logo: 'fa-medkit', renderer: checkPlaybackHealthEntries},
            {name: Lang.ADVANCED, logo:'fa-cogs', type: 'group', renderer: () => {
                return [
                    {name: Lang.CONNECT_TIMEOUT, type: 'slider', logo: 'fa-plug', mask: '{0}s', value: Config.get('connect-timeout'), range: {start: 10, end: 20}, change: (data, element) => {
                        Config.set("connect-timeout", data.value)
                    }},
                    {name: Lang.TUNE_TIMEOUT, type: 'slider', logo: 'fa-plug', mask: '{0}s', value: Config.get('tune-timeout'), range: {start: 25, end: 120}, change: (data, element) => {
                        Config.set("tune-timeout", data.value)
                    }},
                    {name: Lang.MIN_BUFFER_BEFORE_COMMIT, type: 'slider', logo: 'fa-stopwatch', mask: '{0}s', value: Config.get('min-buffer-secs-before-commit'), range: {start: 2, end: 60}, change: (data, element) => {
                        Config.set("min-buffer-secs-before-commit", data.value)
                    }},
                    {name: Lang.RESTORE, logo:'fa-undo', type: 'option', callback: function (){
                        ["connect-timeout", "tune-timeout", "min-buffer-secs-before-commit"].forEach((r) => {
                            Config.set(r, Config.defaults[r])
                        })
                        Menu.refresh()
                    }}
                ]
            }}
        ]},
        {name: Lang.KEYBOARD_MAPPING, logo: 'fa-keyboard', type: 'group', class: 'entry-nosub', entries: [], renderer: getKeyboardMappingEntries},
        {name: Lang.OPEN_DEBUG_CONSOLE, type: 'option', logo: 'fa-terminal', class: isSDKBuild ? '' : 'entry-disable entry-hide', callback: () => { if(isSDKBuild) win.showDevTools() }},
        {name: Lang.RESET_CONFIG, logo:'fa-trash', type: 'option', callback: resetConfig},
        {name: Lang.EXIT, homeId: 'exit', logo:'fa-power-off', type: 'option', callback: closeApp}
    ]
    opts = applyFilters('optionsEntries', opts)
    return opts;
}

addAction('getWatchingData', (entries) => {
    if(entries.length){
        Object.keys(mediaTypeStreamsCountTemplate).forEach(k => {
            if(typeof(onlineUsersCount[k]) == 'undefined'){
                onlineUsersCount[k] = 0
            }
        })
        let total = 0
        entries.forEach(entry => {
            if(typeof(onlineUsersCount[entry.mediaType])=='undefined'){
                onlineUsersCount[entry.mediaType] = 0;
            }
            let n = extractInt(entry.label)
            onlineUsersCount[entry.mediaType] += n
            total += n
        })
        if(typeof(onlineUsersCount['total']) == 'undefined' || onlineUsersCount['total'] < total){
            onlineUsersCount['total'] = total
        }
    }
    return entries;
})

function setMiniPlayerContinueData(entry, prepend){
    if(entry && entry.name){
        var srcs = [], html = '<i class="fas '+defaultIcons['stream']+' entry-logo-fa" aria-hidden="true"></i>'
        if(entry.logo){
            if(entry.logo.substr(0, 3)=="fa-"){
                html = '<i class="fas '+entry.logo+' entry-logo-fa" aria-hidden="true"></i>'
            } else if(entry.logo.indexOf(" fa-")!=-1){
                html = '<i class="'+entry.logo+' entry-logo-fa" aria-hidden="true"></i>'
            } else if(entry.logo.indexOf('//') != -1){
                srcs.push(entry.logo)
            }
        }
        jQuery('.miniplayer-continue-logo').html(html);
        jQuery('.miniplayer-continue-text').html((prepend ? (prepend + ' ') : '') + entry.name);
        jQuery('#miniplayer-continue').off('click').on('click', () => {
            playEntry(entry)
        }).label((prepend ? (prepend + ' ') : '') + entry.name, 'up').data('entry-data', entry)
        entry.logos = srcs
        jQuery('#miniplayer-continue').data('entry-data', entry)
        LogoFind.add(document.querySelector('#miniplayer-continue'))
    } else {
        jQuery('#miniplayer-continue').off('click')
        jQuery('.miniplayer-continue-logo').html('')
        jQuery('.miniplayer-continue-text').html('')
    }
}

var homeMetaOptions = {featured: [], continue: []}

addAction('getWatchingData', (entries) => {
    prepareFeaturedOptions(entries, updateHomeMetaOptions)
})

function prepareFeaturedOptions(entries, cb){
    var fes = []
    async.each(entries, (entry, done) => {
        var go = (iconExists) => {
            if(iconExists){
                fes.push(entry)
            }
            done()
        }
        if(isLive(entry.url) && entry.logo && entry.logo.substr(0, 3)!='fa-'){
            checkImage(entry.logo, () => {
                go(true)
            }, () => {
                go(false)
            })
        } else {
            go(false)
        }
    }, () => {
        homeMetaOptions['featured'] = fes
        if(typeof(cb) == 'function'){
            cb()
        }
    })
}

function prepareContinueOptions(entries, cb){
    var ces = []
    homeMetaOptions['continue'] = History.get()
    if(typeof(cb) == 'function'){
        cb()
    }
}

function updateHomeMetaOptions(){
    var excludes = []
    if(Playback.active){
        excludes.push(Playback.active.entry.name)
        excludes.push(Playback.active.entry.url)
        excludes.push(Playback.active.entry.originalUrl)
    }
    [
        {type: 'continue', prepend: Lang.CONTINUE+':'},
		{type: 'featured', prepend: Lang.FEATURED + ':'}
    ].forEach(data => {
        if(Array.isArray(Menu.entries)){
            Menu.entries = Menu.entries.filter((entry) => {
                return typeof(entry.prepend) == 'undefined' || entry.prepend != data.prepend
            })
            if(homeMetaOptions[data.type] && homeMetaOptions[data.type].length){
                homeMetaOptions[data.type].some(entry => {
                    if(excludes.indexOf(entry.url) == -1 && excludes.indexOf(entry.name) == -1){
                        var nentry = Object.assign({}, entry)
                        excludes.push(nentry.url)
                        excludes.push(nentry.name)
                        nentry.label = (nentry.label || '').format(Lang.USER, Lang.USERS);
                        nentry.homeId = data.type;
                        nentry.class = 'entry-nosub';
                        nentry.prepend = data.prepend;
                        Menu.entries.unshift(nentry)     
                        return true               
                    }
                })
            }
        }
    })
    setMiniPlayerContinueData(homeMetaOptions['continue'].length ? homeMetaOptions['continue'][0] : false, Lang.CONTINUE + ':')
    if(Menu.initialized && Menu.path == ''){
        Menu.refresh()
    }
}

(() => {
    var waiting = false;
    prepareContinueOptions(History.get(), () => {})
    addAction('indexerLoad', () => {
        getWatchingData((entries) => {
            if(waiting === true){
                updateHomeMetaOptions()
            }
        })
    })
    addAction('preMenuInit', () => {
        updateHomeMetaOptions()
        if(!homeMetaOptions['featured'] || !homeMetaOptions['featured'].length){
            waiting = true
        }
        History.on('change', (entries) => {
            prepareContinueOptions(entries, updateHomeMetaOptions)
        })
        Playback.on('commit', (intent) => {
            updateHomeMetaOptions(intent)
        })        
        Playback.on('stop', () => {
            setTimeout(updateHomeMetaOptions, 150)
        })
    })
})()

function getConnectingErrorEntries(){
    var options = []
    var callback = (entry, r) => {
        if(entry.value != Config.get('connecting-error-action')){
            Config.set('connecting-error-action', entry.value)
        }
        setActiveEntry({value: entry.value})
    }
    options.push({name: Lang.SEARCH_ALTERNATIVES, value: 'search', logo:'fa-search-plus', type: 'option', callback: callback})
    options.push({name: Lang.TUNE_ALTERNATIVE, value: 'tune', logo:'fa-satellite-dish', type: 'option', callback: callback})
    options.push({name: Lang.STOP, value: '', logo:'fa-stop', type: 'option', callback: callback})
    return options
}

function getSearchRangeEntries(){
    var options = []
    var callback = (entry, r) => {
        if(entry.value != Config.get('search-range-size')){
            Config.set('search-range-size', entry.value);        
            ipc.server.broadcast('indexer-update')
        }
        setActiveEntry({value: entry.value})
    }
    if(Config.get('search-range-size') < 1){
        options.push({name: Lang.EXCLUSIVE_MODE, label: Lang.MY_LISTS_ONLY, value: 0, logo:'fa-search-minus', type: 'option', callback: callback, class: getSources().length?'':'entry-disable'})
    } else {
        options.push({name: Lang.LOW+' ('+Lang.LISTS+': 18)', value: 18, logo:'fa-search-minus', type: 'option', callback: callback})
        options.push({name: Lang.MEDIUM+' ('+Lang.LISTS+': 36)', value: 36, logo:'fa-search', type: 'option', callback: callback})
        options.push({name: Lang.HIGH+' ('+Lang.LISTS+': 64)', value: 64, logo:'fa-search-plus', type: 'option', callback: callback})
        options.push({name: Lang.XTREME+' ('+Lang.LISTS+': 96, '+Lang.SLOW+')', value: 96, logo:'fa-search-plus', type: 'option', callback: callback})
    }
    return options
}

function getKeyboardMappingEntries(){
    var _path = Menu.path + '/' + Lang.KEYBOARD_MAPPING;
    var hotkeys = Config.get('hotkeys');
    var entries = [];
    console.warn('HOTKEY', hotkeys);
    if(hotkeys && typeof(hotkeys)=='object'){
        console.warn('HOTKEY', hotkeys);
        for(var key in hotkeys){
            console.warn('HOTKEY', hotkeys);
            let n = hotkeys[key];
            if(typeof(Lang['ACTION_DESC_'+n]) != 'undefined'){
                n = Lang['ACTION_DESC_'+n]
            } else if(typeof(Lang[n]) != 'undefined'){
                n = Lang[n]
            }
            entries.push({name: n, label: key, type: 'option', callback: (data) => {
                detectKeys(data.label, n, (k) => {
                    if(k && k != data.label){
                        var r = false;
                        if(typeof(hotkeys[k]) != 'undefined'){
                            r = hotkeys[k];
                        }
                        hotkeys[k] = hotkeys[data.label];
                        delete hotkeys[data.label];
                        if(r){
                            hotkeys[data.label] = r;
                        }
                    }
                    console.warn('HOTKEY', k, data.label, hotkeys);
                    Config.set('hotkeys', hotkeys);
                    Menu.refresh()
                })
            }})
        }
    }
    console.warn('HOTKEY', entries, Menu.path, _path);
    return entries;
}

function getSearchHistoryEntries(){
    var opts = [], hpath = assumePath(Lang.HISTORY), sugs = Store.get('search-history');
    if(Array.isArray(sugs) && sugs.length){
        sugs.forEach((sug) => {
            opts.push({
                name: sug.term,
                type: 'option',
                callback: () => {
                    goSearch(sug.term, sug.type)
                }
            })
        })
        opts.push({
            name: Lang.CLEAR,
            logo: 'fa-undo',
            type: 'option',
            callback: () => {
                Store.set('search-history', [], true);
                Menu.back()
            }
        })
    } else {
        opts.push(Menu.emptyEntry())
    }
    Menu.setBackTo(searchPath);
    setTimeout(() => {
        if(basename(Menu.path) == Lang.HISTORY){
            Menu.setBackTo(searchPath)
        }
    }, 200);
    return opts;
}

var currentBookmarkAddingByName = {
    name: '',
    search_live: true,
    search_vod: false,
    logo: ''
};

function getAddBookmarkByNameEntries(){
    return [
        {name: Lang.CHANNEL_OR_CONTENT_NAME, type: 'input', value: currentBookmarkAddingByName.name, label: Lang.CHANNEL_OR_CONTENT_NAME, change: (data, element, value) => {
            currentBookmarkAddingByName['name'] = value;
        }},
        {name: Lang.ALLOW_LIVE, type: 'check', checked: () => {
            return currentBookmarkAddingByName.search_live;
        }, check: (value) => {
            currentBookmarkAddingByName.search_live = value;
            if(!value && !currentBookmarkAddingByName.search_vod){
                currentBookmarkAddingByName.search_vod = true;
            }
        }},
        {name: Lang.ALLOW_VOD, type: 'check', checked: () => {
            return currentBookmarkAddingByName.search_vod;
        }, check: (value) => {
            currentBookmarkAddingByName.search_vod = value;
            if(!value && !currentBookmarkAddingByName.search_live){
                currentBookmarkAddingByName.search_live = true;
            }
        }},
        {name: Lang.SAVE, type: 'option', logo: 'fa-save', type: 'group', renderer: getAddBookmarkByNameEntriesPhase2}
    ]
}

function getAddBookmarkByNameEntriesPhase2(){
    if(!currentBookmarkAddingByName.name){
        return -1;
    }
    var type = 'all', _path = assumePath(Lang.SAVE)
    if(!currentBookmarkAddingByName.search_live){
        type = 'video';
    } else if(!currentBookmarkAddingByName.search_vod){
        type = 'live';
    }
    search(sentries => {
        var entries = []
        var type = (currentBookmarkAddingByName.search_live && currentBookmarkAddingByName.search_vod) ? 'all' : (currentBookmarkAddingByName.search_live ? 'live' : 'video');
        var url = 'mega://play|'+encodeURIComponent(currentBookmarkAddingByName.name)+'?search_type='+type;
        var logos = sentries.map((entry) => { return entry.logo; }).filter((logoUrl) => { return isHTTP(logoUrl) }).getUnique().slice(0, 96).forEach((logoUrl) => {
            entries.push({
                name: Lang.SELECT_ICON,
                logo: logoUrl,
                type: 'option',
                callback: () => {
                    currentBookmarkAddingByName.logo = logoUrl;
                    Bookmarks.add({
                        name: currentBookmarkAddingByName.name,
                        logo: currentBookmarkAddingByName.logo,
                        type: (type == 'live' ? 'stream' : 'group'),
                        url: url
                    });
                    goBookmarks()
                }
            })
        })
        entries.push({
            name: Lang.SELECT_ICON,
            logo: defaultIcons['stream'],
            type: 'option',
            callback: () => {
                currentBookmarkAddingByName.logo = '';
                Bookmarks.add({
                    name: currentBookmarkAddingByName.name,
                    logo: currentBookmarkAddingByName.logo,
                    type: (type == 'live' ? 'stream' : 'group'),
                    url: url
                });
                goBookmarks()
            }
        })
        Menu.asyncResult(_path, entries)
    }, type, currentBookmarkAddingByName.name, true, false)
    return [Menu.loadingEntry()]
}

function expandMegaURL(url, cb){
    var data = parseMegaURL(url);
    if(data){
        if(data.type == 'link'){
            cb([{
                name: data.name || 'Unknown',
                type: 'stream',
                url: data.url
            }])
            return
        } else if(data.type == 'play') {
            search(cb, data.mediaType || 'live', data.name, true, false)
            return
        }
    } else {
        console.error('Bad mega:// URL', entry)
    }
    cb([])
}

function getBookmarksEntries(reportEmpty){
    var options = [], stream;
    var bookmarks = Bookmarks.get()
    if(stream = currentStream()){
        if(!Bookmarks.is(stream)){
            options.push({name: Lang.ADD+': '+stream.name, logo:'fa-star', type: 'option', callback: function (){
                addFav(stream);
                Menu.refresh()
            }})
        }
    }
    options.push({name: Lang.ADD_BY_NAME, logo:'fa-star', type: 'group', renderer: getAddBookmarkByNameEntries});
    if(bookmarks && bookmarks.length){
        options = options.concat(bookmarks.map((opt, i) => {
            opt.label = '<i class="fas fa-star"></i> ' + opt.bookmarkId;
            return opt;
        }));
        options.push({name: Lang.REMOVE, logo: 'fa-trash', type: 'group', entries: [], renderer: getBookmarksForRemoval})
    } else if(reportEmpty === true) {
        options.push(Menu.emptyEntry())
    }
    return options;
}

function getBookmarksForRemoval(){
    var bookmarks = Bookmarks.get();
    var entries = [];
    if(bookmarks.length){
        for(var i in bookmarks){
            if(bookmarks[i].name){
                entries.push({
                    name: Lang.REMOVE.toUpperCase()+': '+bookmarks[i].name, 
                    logo: 'assets/icons/white/trash.png', 
                    type: 'option',
                    stream: bookmarks[i], 
                    callback: (data) => {
                        removeFav(data.stream);
                        if(Bookmarks.get().length){
                            Menu.refresh()
                        } else {
                            goBookmarks()
                        }
                    }
                })
            }
        }
    } else {
        entries.push(Menu.emptyEntry())
    }
    //console.warn(entries);
    return entries;
}

function getLanguageEntries(){
    var options = []; 
    fs.readdirSync('lang').forEach(file => {
        if(file.indexOf('.json')!=-1){
            console.log(file);
            var locale = file.split('.')[0];
            var logoPath = 'assets/images/flags/'+locale+'.png';
            if(!fs.existsSync(logoPath)){
                logoPath = 'fa-language';
            }
            options.push({
                name: availableLanguageNames[locale] || Lang.LANGUAGE+': '+locale.toUpperCase(),
                label: languageLabelMask.format(locale.toUpperCase()),
                logo: logoPath,
                type: 'option',
                callback: function (data){
                    if(locale != Config.get('locale')){
                        Config.set('locale', locale);
                        markActiveLocale();
                        setTimeout(function (){
                            restartApp(true)
                        }, 1000)
                    } else {
                        goHome()
                    }
                }
            })
        }
    });
    return options;
}

function getThemeEntries() {
    var options = [], themes = Theme.themes(); 
    Object.keys(themes).forEach(name => {
        var uname = ucWords(name).replaceAll('-', ' ');
        if(Theme.data.name == name){
            options.push({
                name: uname,
                slug: name,
                label: '<i class="fas fa-cog"></i> ' + Lang.CUSTOMIZE,
                type: 'group',
                logo: 'fa-palette',
                entries: [
                    {
                        name: Lang.FONT, 
                        type: 'group',
                        logo: 'fa-font',
                        renderer: getAppearanceFontEntries
                    },
                    {
                        name: Lang.SIZE, 
                        type: 'group',
                        logo: 'fa-ruler-combined',
                        renderer: getAppearanceSizeEntries
                    },
                    {
                        name: Lang.COLORS, 
                        type: 'group',
                        logo: 'fa-palette',
                        renderer: getAppearanceColorsEntries
                    },
                    {
                        name: Lang.OPTIONS, 
                        type: 'group',
                        logo: 'fa-cog',
                        renderer: getAppearanceOptionsEntries
                    },
                    {name: Lang.EXPORT, logo:'fa-file-export', type: 'option', callback: () => {
                        saveAs((Theme.data.name || 'export') + '.theme.json', (file) => {
                            if(file){
                                exportTheme(file, jQuery.noop)
                            }
                        })
                    }},
                    {name: Lang.RESET_THEME, logo:'fa-trash', type: 'option', callback: () => {
                        resetTheme(() => {
                            restartApp(false)
                        })
                    }}
                ]
            })
        } else {
            options.push({
                name: uname,
                slug: name,
                logo: 'fa-palette',
                type: 'option',
                callback: function (data){
                    console.warn('##', data);
                    Theme.activate(data.slug, () => {
                        Menu.refresh(null, () => {
                            setActiveEntry({
                                slug: data.slug
                            })
                        })
                    })
                }
            })
        }
    });
    options.push({name: Lang.IMPORT, logo:'fa-file-import', type: 'option', callback: () => {
        openFileDialog((file) => {
            importThemeFile(file, loadTheming)
        }, '.json')
    }})
    if(options.length){
        options.push({name: Lang.REMOVE_THEME, logo: 'fa-trash', type: 'group', renderer: getThemeEntriesForRemoval})
    }
    return options;
}

function getThemeEntriesForRemoval(){
    var options = [], themes = Config.get('themes') || {}; 
    Object.keys(themes).forEach(name => {
        if(name != 'default'){
            options.push({
                name: Lang.REMOVE.toUpperCase()+': '+name, 
                logo: 'fa-trash',
                type: 'option',
                theme: name,
                callback: function (data){
                    var themes = Theme.themes(), keys = Object.keys(themes), nthemes = {};
                    if(typeof(themes[data.theme]) != 'undefined'){
                        keys.forEach(key => {
                            if(key != data.theme){
                                nthemes[key] = themes[key]
                            }
                        })
                        Theme.themes(nthemes);
                        if(data.theme == Theme.active){
                            Theme.activate('default')
                        }
                        Menu.refresh()
                    }
                }
            })
        }
    })
    if(!options.length) {
        options.push(Menu.emptyEntry())
    }
    return options;
}

function getListsEntries(notActive, noManagement, isVirtual){
    var options = [
        {name: Lang.MY_LISTS, label: Lang.IPTV_LISTS, type: 'group', renderer: () => {
            var sources = getSources(), active = getActiveSource(), options = []
            for(var i in sources) {
                var entry = sources[i], length = '-', groups = '-'
                if(!Array.isArray(entry)){
                    continue
                }
                if(notActive === true && entry[1] == active){
                    continue
                }
                if(typeof(entry[2])=='object') {
                    var locale = getLocale(false, true)
                    length = Number(entry[2].length).toLocaleString(locale)
                    groups = Number(entry[2]['groups']).toLocaleString(locale)
                }
                options.push({
                    name: basename(entry[0]), 
                    logo: 'fa-shopping-bag', 
                    type: 'group', 
                    url: entry[1], 
                    label: Lang.STREAMS+': '+length, 
                    renderer: (data, element, isVirtual) => {
                        // return loadSource(data.url, data.name, null, null, isVirtual)
                        var path = assumePath(data.name)
                        console.warn('GHOST', path, data.url)
                        indexerQueryList(data.url, (ret) => {
                            console.warn('GHOST', ret.results)
                            ListMan.deepParse(ret.results, (parsed) => {
                                Menu.asyncResult(path, parsed)
                            })
                        })
                        return [Menu.loadingEntry()]
                    },
                    delete: (data) => {
                        unRegisterSource(data.url)
                        markActiveSource()
                        Menu.refresh()          
                    }, 
                    rename: (name, data) => {   
                        setSourceName(data.url, name)
                    }
                })
            }
            if(!options.length){
                options.push(Menu.emptyEntry())
            }
            return options            
        }},
        {name: Lang.ADD_LIST, logo: 'fa-plus', type: 'option', callback: () => {
            askForList()
        }}
    ]
    if(getSources().length){
        options.push({name: Lang.REMOVE_LIST, logo: 'fa-trash', type: 'group', renderer: getListsEntriesForRemoval, callback: markActiveSource})
    }
    if(!isVirtual && Config.get('search-range-size') > 0){
        options.push({name: Lang.ALL_LISTS, logo: 'fa-users', type: 'group', renderer: (data) => {
            return renderRemoteSources(data.name)
        }, entries: []})
    }
    return options
}

function getListsEntriesForRemoval(){
    var sources = getSources();
    var entries = [];
    if(sources.length){
        sources.forEach((source, i) => {
            entries.push({
                name: Lang.REMOVE.toUpperCase()+': '+basename(sources[i][0]), 
                logo: 'fa-trash', 
                type: 'option', 
                url: sources[i][1], 
                callback: function (data){
                    unRegisterSource(data.url); 
                    Menu.go(dirname(data.path), () => {
                        Menu.refresh()
                    })
                }, 
                path: Lang.LISTS
            })
        })
    } else {
        entries.push(Menu.emptyEntry())
    }
    return entries;
}

function getListingGroups(type){
    if(sharedListsGroups === false){
        sharedListsGroups = {video: [], live: [], audio: [], adult: []}
        // processing offloaded for indexer.js
    }
    if(type == 'all'){
        let ret = []
        Object.keys(sharedListsGroups).forEach(t => {
            if(t != 'adult'){
                ret = ret.concat(sharedListsGroups[t])
            }
        })
        return [...new Set(ret.sort())]
    } else if(typeof(sharedListsGroups[type]) != 'undefined'){
        return sharedListsGroups[type]
    } else if(type.indexOf('-') != -1){
        return getListingGroups(type.split('-')[0])
    } else {
        return []
    }
}

function sharedGroupsAsEntries(type, mediaType, filter){
    if(!mediaType){
        mediaType = type
    }
    var groups = getListingGroups(type)
    return foldEntries(groups.map(group => {
        return {
            name: group,
            type: 'group',
            mediaType,
            renderer: data => {
                _path = assumePath(group)
                search(entries => {
                    Menu.asyncResult(_path, entries)
                }, data.mediaType, data.name, true, false, filter)
                return [Menu.loadingEntry()]
            }
        }
    }))
}

function foldEntries(entries){
    if(entries.length > 96){
        return indexateEntries(entries)
    } else {
        return entries
    }
}

function indexateEntries(entries, mask){    
    var groups = {}, firstChar
    if(!mask){
		mask = Lang.CATEGORIES + ' {0}'
	}
    for(var i=0; i<entries.length; i++){
        firstChar = entries[i].name.toUpperCase().match(new RegExp('[A-Z0-9]'));
        firstChar = (firstChar && firstChar.length >= 1) ? firstChar[0] : '0';
        if(typeof(groups[firstChar])=='undefined'){
            groups[firstChar] = []
        }
        groups[firstChar].push(entries[i])
    }
    var groupsParsed = [], parsingGroup = [], parsingGroupIndexStart = false, parsingGroupIndexEnd = false;
    for(var key in groups){
        if(parsingGroupIndexStart === false){
            parsingGroupIndexStart = key;
        }
        if((parsingGroup.length + groups[key].length) >= folderSizeLimit){
            groupsParsed.push({
                name: mask.format(lettersToRange(parsingGroupIndexStart, parsingGroupIndexEnd)+' ('+parsingGroup.length+')'),
                type: 'group',
                entries: parsingGroup
            });
            parsingGroup = groups[key];
            parsingGroupIndexStart = key;
        } else {
            parsingGroup = parsingGroup.concat(groups[key])
        }
        parsingGroupIndexEnd = key;
    }
    if(parsingGroup.length){
        groupsParsed.push({
            name: mask.format(lettersToRange(parsingGroupIndexStart, parsingGroupIndexEnd)+' ('+parsingGroup.length+')'),
            type: 'group',
            entries: parsingGroup
        })
    }
    return groupsParsed
}

function paginateEntries(entries, limit){
    if(typeof(limit) != 'number'){
        limit = 24
    }
    let ranges = [], result = []
    entries.forEach((e, i) => {
        let ib = parseInt(i / limit)
        if(typeof(ranges[ib]) == 'undefined'){
            ranges[ib] = []
        }
        ranges[ib].push(e)
    })
    console.log('R', ranges)
    var r = ranges.length - 1
	for(var i = ranges.length - 1; i > 0; i--){
		let pvi = i - 1
		//console.log('I', i, pvi)
        let e = {
            name: Lang.NEXT + ' ' + i + '&#47;' + r,
            type: 'group',
            logo: 'fa-angle-right',
            entries: ranges[i],
            callback: () => {
                Menu.scrollCache[dirname(Menu.path)] = {offset: 0, data: false}
                Menu.scrollContainer().scrollTop(0)
            }
        }
		//console.log('I', ranges, pvi)
        ranges[pvi].push(e)
        delete ranges[i]
    }
    console.log('R', ranges)
    return ranges.filter(Array.isArray).shift()
}