
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
            options.push({name: Lang.DUPLICATE+' (Ctrl+T)', logo:'fa-copy', type: 'option', callback: function (){
                spawnOut()
            }})
        }
    }
    options.push({name: Lang.ASPECT_RATIO + ' (F4)', logo:'fa-arrows-alt', type: 'option', callback: function (){
        changeScaleMode()
    }});   
    if(short !== true){  
        var resLimit = Config.get('resolution-limit'), cb = (res) => {
            if(!res){
                res = '99999x99999';
            }
            resLimit = res;
            Config.set('resolution-limit', res);
            Menu.refresh();
            mrk();
            Menu.restoreScroll()
        }, mrk = () => {
            var entries = jQuery('a.entry-option');
            entries.each((i) => {
                var el = entries.eq(i), v = el.data('entry-data');
                if(v && v.label == resLimit){
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

function loadSource(url, name, callback, filter, isVirtual){
    var path = assumePath(name);
    if(!isVirtual) {
        var container = Menu.container(true);
        backEntryRender(container, dirname(path), name)
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
                if(!isVirtual()) {
                    failed()
                }
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
    var url = 'http://app.megacubo.net/stats/data/watching.'+getLocale(true)+'.json';
    data = fetchEntries(url, (entries) => {
        if(!jQuery.isArray(entries)){
            entries = [];
        }
        entries = entries.map((entry) => {
            entry.label = entry.label.format(Lang.USER, Lang.USERS);
            if(isMega(entry.url)){
                var data = parseMegaURL(entry.url);
                if(data && data.type == 'play' && data.name && data.name.length < entry.name.length) {
                    entry.name = data.name;
                }
            }
            if(!entry.logo){
                entry.logo = 'http://app.megacubo.net/logos/'+encodeURIComponent(entry.name)+'.png';
            }
            setStreamStateCache(entry, true);
            return entry;
        });
        if(isListSharingActive()) {
            addEntriesToSearchIndex(entries, url)
        }
        if(typeof(cb)=='function'){
            cb(entries)
        }
    });
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

function posInjectClean(){
    for(var i=0; i<Menu.index.length; i++){
        if(Menu.index[i] && !Menu.index[i].prependName && Menu.index[i].type == 'stream'){
            Menu.index.splice(i, 1);
            break;
        }
    }
}

function setMiniPlayerContinueData(entry, prepend){
    if(entry && entry.name){
        var html = '<img src="[logo]" onerror="lazyLoad(this, [\'[auto-logo]\', \'[default-logo]\'])" title="" />', autoLogo = getAutoLogo(entry.name);
        if(entry.logo.substr(0, 3)=="fa-"){
            html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="fas '+entry.logo+' entry-logo-fa" aria-hidden="true"></i>')
        } else if(entry.logo.indexOf(" fa-")!=-1){
            html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="'+entry.logo+' entry-logo-fa" aria-hidden="true"></i>')
        } else {
            html = html.replaceAll('[logo]', entry.logo);
            html = html.replaceAll('[auto-logo]', autoLogo);
            html = html.replaceAll('[default-logo]', defaultIcons['stream'])
        }
        jQuery('.miniplayer-continue-logo').html(html);
        jQuery('.miniplayer-continue-text').html((prepend ? (prepend + ' ') : '') + entry.name);
        jQuery('#miniplayer-continue').off('click').on('click', () => {
            playEntry(entry)
        })
    }
}

function injectContinueOptions(){
    var entry, prepend = Lang.CONTINUE + ':';
    var i = Menu.index.length;
    preInjectClean(prepend);
    if(i != Menu.index.length){
        Menu.refresh()
    }
    var e = jQuery('a.entry'), ch = jQuery('div#controls').height(), eh = e.eq(0).outerHeight(); 
    var maxLimit = 1, limit = Math.floor((ch / eh)) - (e.length + 1);
    //console.warn('CONTINUE', limit, e.length, i, ch, eh);
    if(limit > maxLimit){
        limit = maxLimit;
    } else if(limit < 1) {
        limit = 1;
    }
    var start = (c || Config.get('resume')) ? 1 : 0;
    var lastEntries = [], already = [];
    var c = currentStream(), playingName = c ? c.name : false;
    if(playingName){
        already.push(playingName)
    }
    for(var i=start; i < 20 && limit > 0; i++){
        entry = History.get(i);
        //console.warn('CONTINUE', i, entry);
        if(entry && already.indexOf(entry.name) == -1){
            already.push(entry.name);
            entry.prependName = String(prepend);
            entry.label = basename(entry.group || '');
            if(!entry.logo || entry.logo.indexOf('.')==-1){
                entry.logo = 'fa-redo-alt';
            }
            lastEntries.push(entry);
            limit--;
        }
    }
    console.warn('CONTINUE', lastEntries);
    var iterator = 0, finalEntries = [], tasks = Array(lastEntries.length).fill((callback) => {
        var entry = lastEntries[iterator];
        iterator++;
        var go = (iconExists) => {
            if(!iconExists){
                entry.logo = 'fa-redo-alt';
            }
            //console.warn('CONTINUE', entry);
            finalEntries.push(entry);
            callback()
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
    });
    async.parallel(tasks, (err, results) => { 
        console.warn('CONTINUE', finalEntries);
        preInjectClean(prepend);
        finalEntries.reverse().slice(0, maxLimit).forEach((entry) => {
            Menu.index.unshift(entry)
        });
        setMiniPlayerContinueData(finalEntries[0], prepend);
        posInjectClean();
        if(!Menu.path){
            Menu.refresh()
        }
    })
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
    setMiniPlayerContinueData(entry, prepend)
}

PlaybackManager.on('commit', injectContinueOptions);
PlaybackManager.on('stop', injectContinueOptions);

function getSearchRangeEntries(){
    var options = [];
    var callback = (entry, r) => {
        Config.set('search-range-size', entry.value);        
        initSearchIndex(() => {});
        setActiveEntry({value: entry.value})
    }
    options.push({name: Lang.MY_LISTS_ONLY, value: 0, logo:'fa-search-minus', type: 'option', callback: callback});
    options.push({name: Lang.LOW+' ('+Lang.LISTS+': 18)', value: 18, logo:'fa-search-minus', type: 'option', callback: callback});
    options.push({name: Lang.MEDIUM+' ('+Lang.LISTS+': 36)', value: 36, logo:'fa-search', type: 'option', callback: callback});
    options.push({name: Lang.HIGH+' ('+Lang.LISTS+': 64)', value: 64, logo:'fa-search-plus', type: 'option', callback: callback});
    options.push({name: Lang.XTREME+' ('+Lang.LISTS+': 96, '+Lang.SLOW+')', value: 96, logo:'fa-search-plus', type: 'option', callback: callback});
    return options;
}

function getSearchHistoryEntries(){
    var opts = [], hpath = assumePath(Lang.HISTORY), sugs = Config.get('search-history');
    if(jQuery.isArray(sugs) && sugs.length){
        sugs.forEach((sug) => {
            opts.push({
                name: sug,
                type: 'option',
                callback: () => {
                    goSearch(sug, hpath)
                }
            })
        })
        opts.push({
            name: Lang.CLEAR,
            logo: 'fa-undo',
            type: 'option',
            callback: () => {
                Config.set('search-history', []);
                Menu.back()
            }
        })
    } else {
        opts.push({
            name: Lang.EMPTY,
            type: 'option',
            callback: () => { }
        })
    }
    setBackTo(searchPath);
    setTimeout(() => {
        if(basename(Menu.path) == Lang.HISTORY){
            setBackTo(searchPath)
        }
    }, 200);
    return opts;
}

PlaybackManager.on('commit', () => {
    if(Menu.path.indexOf(searchPath) != -1){
        var str = lastSearchTerm;
        var sugs = Config.get('search-history');
        if(!jQuery.isArray(sugs)){
            sugs = []
        }
        if(sugs.indexOf(str) == -1) {
            sugs.push(str);
            Config.set('search-history', sugs)
        }
    }
});

function getBookmarksEntries(reportEmpty){
    var options = [], stream;
    var bookmarks = Bookmarks.get();
    if(stream = currentStream()){
        if(!Bookmarks.is(stream)){
            options.push({name: Lang.ADD+': '+stream.name, logo:'fa-star', type: 'option', callback: function (){
                addFav(stream);
                Menu.refresh()
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
                        removeFav(data.stream);
                        Menu.refresh()
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

function getThemeEntries() {
    var options = []; 
    fs.readdirSync('themes').forEach(file => {
        if(file.indexOf('.json')!=-1){
            console.log(file);
            var n = basename(file).replace('.json', '');
            options.push({
                name: n,
                file: 'themes/' + file,
                logo: 'fa-palette',
                type: 'option',
                callback: function (data){
                    console.warn('##', data);
                    importTheme(data.file, () => {
                        loadTheming();
                        Menu.back()
                    })
                }
            })
        }
    });
    return options;
}

function getListsEntries(notActive, noManagement, isVirtual){
    var options = [
        {name: Lang.MY_LISTS, label: Lang.IPTV_LISTS, type: 'group', renderer: () => {
            var sources = getSources(), active = getActiveSource(), options = [];
            for(var i in sources) {
                var entry = sources[i], length = '-', groups = '-';
                if(!jQuery.isArray(entry)) continue;
                if(notActive === true && entry[1] == active) continue;
                if(typeof(entry[2])=='object') {
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
                    renderer: (data, element, isVirtual) => {
                        return loadSource(data.url, data.name, null, null, isVirtual)
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
                })
            }
            if(!options.length){
                options.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
            }
            return options;            
        }},
        {name: Lang.ADD_NEW_LIST, logo: 'fa-plus', type: 'option', callback: addNewSource},
        {name: Lang.REMOVE_LIST, logo: 'fa-trash', type: 'group', renderer: getListsEntriesForRemoval, callback: markActiveSource},
        {name: Lang.LIST_SHARING, type: 'check', check: function (checked) {
            var v = checked ? Config.defaults['search-range-size'] : 0;
            Config.set('search-range-size', v);        
            initSearchIndex(() => {})
            Menu.refresh()
        },  checked: () => {
                return isListSharingActive()
            }
        }
    ];
    if(!isVirtual && isListSharingActive()){
        options.push({name: Lang.ALL_LISTS, logo: 'fa-users', type: 'group', renderer: (data) => {
            return renderRemoteSources(data.name)
        }, entries: []})
    }
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
                    Menu.go(dirname(data.path), () => {
                        Menu.refresh()
                    })
                }, 
                path: Lang.LISTS
            })
        })
    } else {
        entries.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
    }
    return entries;
}


