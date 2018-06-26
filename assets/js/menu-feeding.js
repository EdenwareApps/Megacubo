
function getWindowModeEntries(short){
    var options = [];
    if(isMiniPlayerActive()){
        options.push({name: Lang.RESTORE+' (ESC)', logo:'fa-window-restore', type: 'option', callback: function (){
            leaveMiniPlayer();
            Menu.refresh()
        }})
    } else if(isFullScreen()){
        options.push({name: Lang.RESTORE+' (ESC)', logo:'fa-window-restore', type: 'option', callback: function (){
            setFullScreen(false);
            Menu.refresh()
        }})
    } else {
        options.push({name: Lang.FULLSCREEN+' (F11)', logo:'fa-window-maximize', type: 'option', callback: function (){
            setFullScreen(true);
            Menu.refresh()
        }})
        options.push({name: 'Miniplayer (Ctrl+M)', logo:'fa-level-down-alt', type: 'option', callback: function (){
            enterMiniPlayer();
            Menu.refresh()
        }})
        if(short !== true){
            options.push({name: Lang.DUPLICATE+' (Ctrl+Alt+D)', logo:'fa-copy', type: 'option', callback: function (){
                spawnOut()
            }})
        }
    }
    options.push({name: 'Aspect Ratio (F4)', logo:'fa-arrows-alt', type: 'option', callback: function (){
        changeScaleMode()
    }})    
    if(short !== true){
        options.push({name: Lang.START_IN_FULLSCREEN, type: 'check', check: function (checked){
            Config.set('start-in-fullscreen', checked)
        }, checked: () => {
                return Config.get('start-in-fullscreen')
            }
        })
        options.push({name: Lang.GPU_RENDERING, type: 'check', check: function (checked){
            notify(Lang.SHOULD_RESTART, 'fa-cogs', 'normal');
            Config.set('gpu-rendering', checked);
            setHardwareAcceleration(checked)
        }, checked: () => {
                return Config.get('gpu-rendering')
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
        options.push({name: Lang.CLEAR, logo:'fa-user-secret', type: 'option', callback: function (){
            History.clear();
            Menu.refresh()
        }})
    } else {
        options.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
    }
    return options;
}

function getRemoteSources(callback){
    var url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json';
    return fetchEntries(url, callback)
}

function loadSource(url, name, callback, filter){
    var path = assumePath(name);
    var container = Menu.container(true);
    backEntryRender(container, dirname(path), name);
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle', 'normal');
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
                jQuery('.entry:not(.entry-back)').remove();
                Menu.asyncResult(path, parsed)
            } else {
                failed()
            }
        })
    }, loadingToActionDelay);
    return [getLoadingEntry()];
}

var remoteXtrasAppended = false;

function getWatchingEntries(){
    var name = Lang.BEEN_WATCHED;
    return fetchAndRenderWatchingEntries(name)
}

function getWatchingData(cb, update){
    var ckey = 'watching-data';
    data = Store.get(ckey);
    if(!jQuery.isArray(data)){
        data = [];
    }
    if(update || !data.length){
        var url = 'http://app.megacubo.net/stats/data/watching.'+getLocale(true)+'.json';
        fetchEntries(url, (entries) => {
            if(!jQuery.isArray(entries)){
                entries = [];
            } else {
                entries = entries.map((entry) => {
                    entry.label = entry.label.format(Lang.USER, Lang.USERS);
                    if(!entry.logo){
                        entry.logo = 'http://app.megacubo.net/logos/'+encodeURIComponent(entry.name)+'.png';
                    }
                    setStreamStateCache(entry, true);
                    return entry;
                });
                //sharedListsSearchIndex['watching'] = entries;
            }
            if(entries.length){
                Store.set(ckey, entries, 30 * (24 * 3600))
            }
            if(typeof(cb)=='function'){
                cb(entries)
            }
        })
    } else {
        if(typeof(cb)=='function'){
            cb(data)
        }
    }
    return data;
}

function preInjectClean(prepend){ 
    for(var i in Menu.index){
        if(Menu.index[i] && typeof(Menu.index[i])=='object' && Menu.index[i].prependName == prepend){
            Menu.index.splice(i, 1);
            return preInjectClean(prepend);
            break;
        }
    }
}

var updateSideSidgetDelay = 0;
function posInjectClean(){
    clearTimeout(updateSideSidgetDelay);
    for(var i=0; i<Menu.index.length; i++){
        if(Menu.index[i] && !Menu.index[i].prependName && Menu.index[i].type == 'stream'){
            Menu.index.splice(i, 1);
            break;
        }
    }
    updateSideSidgetDelay = setTimeout(() => {
        updateSideWidget()
    }, 100)
}

function injectContinueOption(){
    var lastEntry, prepend = Lang.CONTINUE+':';
    var c = currentStream(), playingName = c ? c.name : false;
    var start = (c || Config.get('resume')) ? 1 : 0;
    preInjectClean(prepend);
    for(var i=start; i < 3; i++){
        lastEntry = History.get(i);
        if(lastEntry && lastEntry.name != playingName){
            lastEntry.prependName = String(prepend);
            lastEntry.label = basename(lastEntry.group || '');
            if(!lastEntry.logo || lastEntry.logo.indexOf('.')==-1){
                lastEntry.logo = 'fa-redo-alt';
            }
            var go = (iconExists) => {
                if(!iconExists){
                    lastEntry.logo = 'fa-redo-alt';
                }
                preInjectClean(prepend);
                Menu.index.unshift(lastEntry);
                posInjectClean();
                if(!Menu.path){
                    Menu.refresh()
                }
            }
            if(lastEntry.logo && lastEntry.logo.substr(0, 3)!='fa-'){
                checkImage(lastEntry.logo, () => {
                    go(true)
                }, () => {
                    go(false)
                })
            } else {
                go(false)
            }
            break;
        }
    }
}

function injectFeaturedOption(entry){
    var lastEntry, prepend = Lang.FEATURED+':';
    var c = currentStream(), playingName = c ? c.name : false;
    var start = (c || Config.get('resume')) ? 1 : 0;
    entry.prependName = prepend;
    preInjectClean(prepend);
    entry.label = entry.label.format(Lang.USER, Lang.USERS);
    Menu.index.unshift(entry);
    posInjectClean();
    if(!Menu.path){
        Menu.refresh()
    }
}

function sideWidget(entries){
    var html = "", sw = jQuery('#side-widget').empty();
    entries.slice(0, 5).forEach((entry) => {
        var piece = jQuery("<div class=\"side-widget-entry\"><a href=\""+entry.url+"\" title=\""+entry.name+"\" aria-label=\""+entry.name+"\" style=\"background: url('"+entry.logo+"')\">&nbsp;</a></div>");
        piece.find('a').data('entry-data', entry).on('mousedown', () => {
            var entry = jQuery(event.currentTarget).data('entry-data');
            if(entry) {
                playEntry(entry)
            }
        }).on('click', (event) => {
            event.preventDefault();
            event.stopPropagation()
        });
        piece.appendTo(sw)        
    });
    sw.animate({opacity: 1, paddingLeft: 0}).show()
}

function updateSideWidget(){
    if(!jQuery.isArray(Menu.index) || !Menu.index.length){
        return setTimeout(() => {
            updateSideWidget()
        }, 200)
    }
    var max = Menu.index.length, i = 0, results = [], _next = () => {
        var n = sideWidgetEntries[i];
        if(n){
            i++;
            if(n.logo && n.logo.indexOf('//') != -1){
                checkImage(n.logo, () => {
                    results.push(n);
                    if(results.length == max){
                        sideWidget(results)
                    } else if(results.length < max) {
                        _next()
                    }
                }, _next)
            } else {
                _next()
            }
        }
    }
    _next();
}

PlaybackManager.on('commit', injectContinueOption);
PlaybackManager.on('stop', injectContinueOption);

jQuery(document).on('lngload', () => {
    injectContinueOption();
    getWatchingData((entries) => {
        var entry = false;
        for(var i=0; i<entries.length; i++){
            if(isLive(entries[i].url)){
                entry = Object.assign({}, entries[i]);
                break;
            }
        }
        if(entry){
            var go = (iconExists) => {
                if(!iconExists){
                    entry.logo = 'fa-fire';
                }
                console.log('GOING', Menu.index[0], Menu.index[0].type, Menu.index[0].name, entry.name, Menu.index[0].prependName, Lang.FEATURED+': ');
                injectFeaturedOption(entry)
            }
            if(entry.logo && entry.logo.substr(0, 3)!='fa-'){
                checkImage(entry.logo, () => {
                    go(true)
                }, () => {
                    go(false)
                })
            } else {
                go(false)
            }
        }
    }, true);
    var p = getFrame('player'), o = getFrame('overlay');
    createMouseObserverForControls(p);
    createMouseObserverForControls(o);
    createMouseObserverForControls(window)
});

function getSearchRangeEntries(){
    var options = [];
    var callback = (entry, r) => {
        Config.set('search-range', entry.value);
        console.log('RANGER', entry, entry.value);
        location.reload()
    }
    options.push({name: Lang.LOW+' ('+Lang.LISTS+': 18)', value: 18, logo:'fa-search-minus', type: 'option', callback: callback});
    options.push({name: Lang.MEDIUM+' ('+Lang.LISTS+': 36)', value: 36, logo:'fa-search', type: 'option', callback: callback});
    options.push({name: Lang.HIGH+' ('+Lang.LISTS+': 64)', value: 64, logo:'fa-search-plus', type: 'option', callback: callback});
    options.push({name: Lang.XTREME+' ('+Lang.LISTS+': 96, '+Lang.SLOW+')', value: 96, logo:'fa-search-plus', type: 'option', callback: callback});
    return options;
}

function getParentalControlEntries(){
    var options = [
        {
            name: Lang.HIDE_LOGOS,
            type: 'check',
            check: (checked) => {
                Config.set('hide-logos', checked);
                showLogos = !checked;
            }, 
            checked: () => {
                return Config.get('hide-logos')
            }
        },
        getParentalControlToggler(),
        {
            type: 'input',
            logo: 'assets/icons/white/shield.png',
            change: function (entry, element, val){
                Config.set('parental-control-terms', val)
            },
            value: userParentalControlTerms().join(','),
            placeholder: Lang.FILTER_WORDS,
            name: Lang.FILTER_WORDS
        }
    ];
    return options;
}

function getParentalControlToggler(cb){
    return {
        name: Lang.HIDE_ADULT_CONTENT,
        type: 'check',
        check: (checked) => {
            Config.set('show-adult-content', !checked);
            showAdultContent = !checked;
            if(typeof(cb) == 'function'){
                cb(showAdultContent)
            }
        }, 
        checked: () => {
            return !Config.get('show-adult-content')
        }
    }
}

function getBookmarksEntries(reportEmpty){
    var options = [], stream;
    var bookmarks = Bookmarks.get();
    if(stream = currentStream()){
        if(!Bookmarks.is(stream)){
            options.push({name: Lang.ADD+': '+stream.name, logo:'fa-star', type: 'option', callback: function (){
                addFav(stream)
            }})
        }
    }
    if(bookmarks && bookmarks.length){
        options = options.concat(bookmarks);
        options.push({name: Lang.REMOVE, logo: 'fa-trash', type: 'group', entries: [], renderer: getBookmarksForRemoval})
    } else if(reportEmpty) {
        options.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
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
                    logo:'assets/icons/white/trash.png', 
                    type: 'option',
                    stream: bookmarks[i], 
                    callback: function (data){
                        removeFav(data.stream)
                    }
                })
            }
        }
    } else {
        entries.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
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
                            location.reload()
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

function getListsEntries(notActive, noManagement){
    var options = [
        {name: Lang.MY_LISTS, label: Lang.IPTV_LISTS, type: 'group', renderer: () => {
            var sources = getSources(), active = getActiveSource(), options = [];
            for(var i in sources){
                var entry = sources[i], length = '-', groups = '-';
                if(!jQuery.isArray(entry)) continue;
                if(notActive === true && entry[1] == active) continue;
                if(typeof(entry[2])=='object'){
                    var locale = getLocale(false, true);
                    length = Number(entry[2].length).toLocaleString(locale);
                    groups = Number(entry[2]['groups']).toLocaleString(locale);
                }
                options.push({
                    name: entry[0], 
                    logo: 'fa-shopping-bag', 
                    type: 'group', 
                    url: entry[1], 
                    label: Lang.STREAMS+': '+length, 
                    renderer: (data) => {
                        return loadSource(data.url, data.name)
                    },
                    delete: (data) => {
                        unRegisterSource(data.url);
                        markActiveSource();  
                        Menu.refresh()          
                    }, 
                    rename: (name, data) => {
                        //alert(newName)         
                        setSourceName(data.url, name)
                    }
                });
            }
            if(!options.length){
                options.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
            }
            return options;            
        }},
        {name: Lang.ADD_NEW_LIST, logo: 'fa-plus', type: 'option', callback: addNewSource},
        {name: Lang.REMOVE_LIST, logo: 'fa-trash', type: 'group', renderer: getListsEntriesForRemoval, callback: markActiveSource},
        {name: Lang.ALL_LISTS, logo: 'fa-users', type: 'group', renderer: (data) => {
            return renderRemoteSources(data.name)
        }, entries: []},
        {name: Lang.SHARE_LISTS, type: 'check', check: function (checked){
            Config.set('unshare-lists', !checked)
        },  checked: () => {
                return !Config.get('unshare-lists')
            }
        }
    ];
    return options;
}

function getListsEntriesForRemoval(){
    var sources = getSources();
    var entries = [];
    if(sources.length){
        sources.forEach((source, i) => {
            entries.push({
                name: Lang.REMOVE.toUpperCase()+': '+sources[i][0], 
                logo:'assets/icons/white/trash.png', 
                type: 'option', 
                url: sources[i][1], 
                callback: function (data){
                    unRegisterSource(data.url); 
                    Menu.go(dirname(data.path));
                    setTimeout(function (){
                        Menu.refresh()
                    }, 1000)
                }, 
                path: Lang.LISTS
            })
        })
    } else {
        entries.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
    }
    return entries;
}


