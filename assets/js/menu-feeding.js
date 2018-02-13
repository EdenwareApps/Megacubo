
function getWindowModeEntries(){
    var options = [];
    if(top.miniPlayerActive){
        options.push({name: Lang.RESTORE+' (ESC)', logo:'fa-window-restore', type: 'option', callback: function (){
            top.leaveMiniPlayer();
            refreshListing()
        }})
    } else if(top.isFullScreen()){
        options.push({name: Lang.RESTORE+' (ESC)', logo:'fa-window-restore', type: 'option', callback: function (){
            top.setFullScreen(false);
            refreshListing()
        }})
    } else {
        options.push({name: Lang.FULLSCREEN+' (F11)', logo:'fa-window-maximize', type: 'option', callback: function (){
            top.setFullScreen(true);
            refreshListing()
        }})
        options.push({name: 'Miniplayer (Ctrl+M)', logo:'fa-level-down', type: 'option', callback: function (){
            top.enterMiniPlayer();
            refreshListing()
        }})
        options.push({name: Lang.DUPLICATE+' (Ctrl+Alt+D)', logo:'fa-files-o', type: 'option', callback: function (){
            top.spawnOut();
            refreshListing()
        }})
    }
    options.push({name: 'Aspect Ratio (F4)', logo:'fa-arrows-alt', type: 'option', callback: function (){
        top.changeScaleMode()
    }})
    options.push({name: Lang.START_IN_FULLSCREEN, type: 'check', check: function (checked){
        Config.set('start-in-fullscreen', checked)
    }, checked: () => {
            return Config.get('start-in-fullscreen')
        }
    })
    options.push({name: Lang.GPU_RENDERING, type: 'check', check: function (checked){
        notify(Lang.SHOULD_RESTART, 'fa-cogs', 'normal');
        Config.set('gpu-rendering', checked);
        top.setHardwareAcceleration(checked)
    }, checked: () => {
            return Config.get('gpu-rendering')
        }
    })
    /*
    options.push({name: 'Chromecast', logo:'fa-chrome', type: 'option', callback: function (){
        top.castManagerInit();
        refreshListing()
    }})
    */
    return options;
}

function getHistoryEntries(){
    var options = History.get();
    if(options.length){
        options.push({name: Lang.CLEAR, logo:'fa-user-secret', type: 'option', callback: function (){
            History.clear();
            refreshListing()
        }})
    } else {
        options.push({name: Lang.EMPTY, logo:'fa-files-o', type: 'option'})
    }
    return options;
}

function getRemoteXtras(url, name){
    var url = 'http://app.megacubo.net/stats/data/xtras.'+getLocale(true)+'.json', name = Lang.EXTRAS;
    fetchAndRenderEntries(url, name)
}

function getRemoteSources(callback){
    var url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json', name = Lang.ALL_LISTS;
    return fetchEntries(url, (entries) => {
        callback(entries)
    })
}

function renderRemoteSources(){
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-warning', 'normal');
        triggerBack()
    }
    setTimeout(() => {
        getRemoteSources((entries) => {
            if(entries.length){
                entries = entries.map((entry) => {
                    if(!entry.name){
                        entry.name = getNameFromSourceURL(entry.url)
                    }
                    entry.type = "group";
                    entry.label = entry.label.format(Lang.USER, Lang.USERS);
                    entry.renderer = (data) => {
                        //console.log(data);
                        return previewSourceRenderer(data.url, data.name)
                    }
                    return entry;
                });
                index = writeIndexPathEntries(listingPath, entries);
                listEntriesByPath(listingPath);
                setTimeout(markActiveSource, 250) // wait rendering
            } else {
                failed()
            }
        })
    }, 150);
    return [getLoadingEntry()];
}

function previewSourceRenderer(url, name){
    var path = assumePath(name);
    console.log('DREADY -1!', name, path, listingPath);
    listingPath = path;
    setTimeout(() => { // tricky delay, preventing it from render before to render the loadingEntry
        console.log('DREADY0!', path, listingPath);
        ListMan.deepParse(url, (parsed) => {
            console.log('DREADY1!', path, listingPath, parsed);
            if(getSourcesURLs().indexOf(url)==-1){
                parsed.unshift({
                    type: 'option',
                    logo: 'fa-download',
                    name: Lang.ADD_TO.format(Lang.MY_LISTS),
                    callback: () => {
                        registerSource(url, name)
                    }
                })
            } else {
                parsed.unshift({
                    type: 'disabled',
                    logo: 'fa-download',
                    name: Lang.LIST_ALREADY_ADDED
                })
            }
            console.log(index);
            index = writeIndexPathEntries(path, parsed, index);
            console.log(index, path);
            console.log('DREADY1.5!', path, listingPath, readIndexPath(path));
            if(path == listingPath){ // user is on same view
                console.log('DREADY2!', readIndexPath(path));
                listEntriesByPath(path);
                markActiveSource()
            }
        }, () => {
            notify(Lang.DATA_FETCHING_FAILURE, 'fa-warning', 'normal');
            triggerBack()
        }, true)
    }, 150);
    return [getLoadingEntry()]
}

function getWatchingEntries(){
    var url = 'http://app.megacubo.net/stats/data/watching.'+getLocale(true)+'.json', name = Lang.BEEN_WATCHED;
    return fetchAndRenderEntries(url, name, (entry) => {
        entry.label = entry.label.format(Lang.USER, Lang.USERS);
        setTimeout(updateStreamEntriesFlags, 250); // wait rendering
        return entry;
    })
}

jQuery(document).on('lngload', () => {
    var lastEntry = History.get(0);
    if(lastEntry instanceof Object){
        lastEntry.prependName = Lang.CONTINUE+': ';
        lastEntry.label = basename(lastEntry.group || '');
        if(!Config.get('resume')){
            index.unshift(lastEntry)
        }
    }
    top.PlaybackManager.on('commit', () => {
        if(index[0].prependName == Lang.CONTINUE+': '){
            index = index.slice(1);
            if(!listingPath){
                refreshListing()
            }
        }
    });
    var url = 'http://app.megacubo.net/stats/data/watching.'+getLocale(true)+'.json';
    fetchEntries(url, (entries) => {
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
                console.log('GOING', index[0], index[0].type, index[0].name, entry.name, index[0].prependName, Lang.FEATURED+': ');
                if((index[0].type || index[0].type == 'stream') && (index[0].name == entry.name || index[0].prependName == Lang.FEATURED+': ')){
                    index = index.slice(1)
                }
                entry.prependName = Lang.FEATURED+': ';
                entry.label = entry.label.format(Lang.USER, Lang.USERS);
                index.unshift(entry)
                if(!listingPath){
                    refreshListing()
                }
            }
            if(entry.logo && entry.logo.substr(0, 3)!='fa-'){
                var m = new Image();
                m.onload = () => {
                    go(true)
                }
                m.onerror = () => {
                    go(false)
                }
                m.src = entry.logo;
            } else {
                go(false)
            }
        }
    })
});

function getXtraEntries(){
    var options = getBookmarksEntries(false);
    options.push({name: Lang.RECORDINGS, logo:'fa-download', type: 'group', renderer: getRecordingEntries, entries: []});
    options.push({name: Lang.HISTORY+' (Ctrl+H)', logo:'fa-history', type: 'group', renderer: getHistoryEntries, entries: []});
    options.push({name: Lang.EXTRAS, logo:'fa-folder', type: 'group', renderer: getRemoteXtras, entries: []});
    return options;
}

function getSearchRangeEntries(){
    var options = [];
    var callback = (entry, r) => {
        Config.set('search-range', entry.value);
        console.log('RANGER', entry, entry.value);
        top.location.reload()
    }
    options.push({name: Lang.LOW+' ('+Lang.LISTS+': 18)', value: 18, logo:'fa-search-minus', type: 'option', renderer: getRecordingEntries, callback: callback});
    options.push({name: Lang.MEDIUM+' ('+Lang.LISTS+': 36)', value: 36, logo:'fa-search', type: 'option', renderer: getRecordingEntries, callback: callback});
    options.push({name: Lang.HIGH+' ('+Lang.LISTS+': 64)', value: 64, logo:'fa-search-plus', type: 'option', renderer: getRecordingEntries, callback: callback});
    options.push({name: Lang.XTREME+' ('+Lang.LISTS+': 96, '+Lang.SLOW+')', value: 96, logo:'fa-search-plus', type: 'option', renderer: getRecordingEntries, callback: callback});
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
        {
            name: Lang.HIDE_ADULT_CONTENT,
            type: 'check',
            check: (checked) => {
                Config.set('show-adult-content', !checked);
                showAdultContent = !checked;
            }, 
            checked: () => {
                return !Config.get('show-adult-content')
            }
        },
        {
            type: 'input',
            logo: 'assets/icons/white/shield.png',
            change: function (entry, element, val){
                Config.set('parental-control-terms', val)
            },
            value: userParentalControlTerms().join(','),
            placeholder: Lang.FILTER_WORDS
        }
    ];
    return options;
}

function getBookmarksEntries(reportEmpty){
    var options = [], stream;
    var bookmarks = Bookmarks.get();
    if(stream = currentStream()){
        if(Bookmarks.is(stream)){
            options.push({name: Lang.REMOVE+': '+stream.name, logo:'fa-trash', type: 'option', callback: function (){
                removeFav(stream);
                refreshListing()
            }})
        } else {
            options.push({name: Lang.ADD+': '+stream.name, logo:'fa-star', type: 'option', callback: function (){
                addFav(stream);
                refreshListing()
            }})
        }
    }
    if(bookmarks && bookmarks.length){
        options = options.concat(bookmarks);
    } else if(reportEmpty) {
        options.push({name: Lang.EMPTY, logo:'fa-files-o', type: 'option'})
    }
    return options;
}

function getRecordingEntries(){
    var options = [];
    if(top.isRecording){
        options.push({name: Lang.STOP_RECORDING+' (F9)', logo:'fa-stop', type: 'option', callback: function (){
            top.stopRecording();
            refreshListing()
        }});
    } else {
        options.push({name: Lang.START_RECORDING+' (F9)', logo:'fa-download', type: 'option', callback: function (){
            top.startRecording();
            wait(function (){
                return top.isRecording;
            }, function (){
                refreshListing()
            })
        }});
    }
    RecordingHistory.sync(); // clean deleted ones
    var history = RecordingHistory.get();
    if(history && history.length){
        options = options.concat(history);
        options.push({name: Lang.CLEAR, logo:'fa-user-secret', type: 'option', callback: function (){
            RecordingHistory.clear();
            refreshListing()
        }});
    }
    return options;
}

function getLanguageEntries(){
    var options = [];
    fs.readdirSync('lang').forEach(file => {
        if(file.indexOf('.json')!=-1){
            console.log(file);
            var locale = file.split('.')[0];
            options.push({
                name: languageLabelMask.format(locale.toUpperCase()),
                logo: 'fa-language',
                type: 'option',
                callback: function (data){
                    Config.set('locale', locale);
                    markActiveLocale();
                    setTimeout(function (){
                        top.location.reload()
                    }, 1000)
                }
            })
        }
    })
    return options;
}

function getListsEntries(notActive, noManagement){
    var sources = getSources(), active = getActiveSource();
    var options = [];
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
            type: 'option', 
            url: entry[1], 
            label: Lang.STREAMS+': '+length, 
            callback: function (data){
                //console.log(data);
                setActiveSource(data.url);
                setTimeout(() => {
                    listEntriesByPath(Lang.MY_LISTS)
                }, 100)
            }, 
            delete: function (data){
                unRegisterSource(data.url);
                markActiveSource();  
                refreshListing()          
            }, 
            rename: function (name, data){
                //alert(newName)         
                setSourceName(data.url, name)
            }
        })
    }
    if(noManagement !== true){
        options.push({name: Lang.ADD_NEW_LIST, logo: 'fa-plus', type: 'option', callback: addNewSource});
        options.push({name: Lang.REMOVE_LIST, logo: 'fa-trash', type: 'group', renderer: getListsEntriesForRemoval, callback: markActiveSource});
        options.push({name: Lang.ALL_LISTS, logo: 'fa-users', type: 'group', renderer: renderRemoteSources, entries: []});
        options.push({name: Lang.SHARE_LISTS, type: 'check', check: function (checked){
            Config.set('unshare-lists', !checked)
        },  checked: () => {
                return !Config.get('unshare-lists')
            }
        });
        options.push({name: Lang.HD_LISTS, logo: 'fa-cart-arrow-down', type: 'option', callback: () => {
            var url = Config.get('hd-lists-url-'+getLocale(true)) || Config.get('hd-lists-url-en');
            if(url){
                gui.Shell.openExternal(url)
            }
        }})
    } else {
        options.push({name: Lang.ALL_LISTS, logo: 'fa-users', type: 'group', renderer: renderRemoteSources, entries: []})
    }
    return options;
}

function getListsEntriesForRemoval(){
    var sources = getSources();
    var entries = [];
    if(sources.length){
        for(var i in sources){
            entries.push({
                name: Lang.REMOVE.toUpperCase()+': '+sources[i][0], 
                logo:'assets/icons/white/trash.png', 
                type: 'option', 
                url: sources[i][1], 
                callback: function (data){
                    unRegisterSource(data.url); 
                    listEntriesByPath(dirname(data.path));
                    setTimeout(function (){
                        refreshListing()
                    }, 1000)
                }, 
                path: Lang.LISTS
            })
        }
    } else {
        entries.push({name: Lang.EMPTY, logo:'fa-files-o', type: 'option'})
    }
    return entries;
}


