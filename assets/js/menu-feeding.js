
function getWindowModeEntries(){
    var options = [];
    if(top.window.miniPlayerActive){
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
            top.window.spawnOut();
            refreshListing()
        }})
    }
    options.push({name: 'Aspect Ratio (F4)', logo:'fa-arrows-alt', type: 'option', callback: function (){
        changeScaleMode()
    }})
    options.push({name: Lang.START_IN_FULLSCREEN, type: 'check', check: function (checked){
        Store.set('start-in-fullscreen', checked)
    }, checked: () => {
            return Store.get('start-in-fullscreen')
        }
    })
    options.push({name: Lang.USE_HARDWARE_ACCELERATION, type: 'check', check: function (checked){
        notify(Lang.SHOULD_RESTART, 'fa-cogs', 'normal');
        Store.set('disable-gpu', !checked);
        top.setHardwareAcceleration(checked)
    }, checked: () => {
            return !Store.get('disable-gpu')
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
    return fetchEntries(url, name)
}

function getRemoteSources(){
    var url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json', name = Lang.CONNECTED_LISTS;
    return fetchEntries(url, name, (entry) => {
        if(!entry.name){
            entry.name = getNameFromSourceURL(entry.url)
        }
        entry.type = "group";
        entry.label = entry.label.format(Lang.USER, Lang.USERS);
        entry.renderer = (data) => {
            //console.log(data);
            return previewSourceRenderer(data.url, data.name)
        }
        setTimeout(markActiveSource, 250); // wait rendering
        return entry;
    })
}

function previewSourceRenderer(url, name){
    var path = listingPath;
    if(basename(path) != name){
        path += '/'+name;
    }
    listingPath = path;
    //console.log('DREADY -1!', path, listingPath);
    setTimeout(() => { // tricky delay, preventing it from render before to render the loadingEntry
        //console.log('DREADY0!', path, listingPath);
        fetchAndParseIPTVListFromAddr(url, (content, parsed) => {
            //console.log('DREADY1!', path, listingPath, parsed);
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
            index = writeIndexPathEntries(path, parsed, index);
            //console.log('DREADY1.5!', path, listingPath, readIndexPath(path));
            if(path == listingPath){ // user is on same view
                //console.log('DREADY2!', readIndexPath(path));
                listEntriesByPath(path);
                markActiveSource()
            }
        }, () => {
            notify(Lang.DATA_FETCHING_FAILURE, 'fa-warning', 'normal');
            triggerBack()
        }, true);
    }, 250);
    return [getLoadingEntry()]
}

function getWatchingEntries(){
    var url = 'http://app.megacubo.net/stats/data/watching.'+getLocale(true)+'.json', name = Lang.BEEN_WATCHED;
    return fetchEntries(url, name, (entry) => {
        entry.label = entry.label.format(Lang.USER, Lang.USERS);
        setTimeout(updateStreamEntriesFlags, 250); // wait rendering
        return entry;
    })
}

function getXtraEntries(){
    var options = getBookmarksEntries(false);
    options.push({name: Lang.OPEN_URL+' (Ctrl+U)', logo:'fa-link', type: 'option', callback: () => {playCustomURL()}});
    options.push({name: Lang.RECORDINGS, logo:'fa-download', type: 'group', renderer: getRecordingEntries, entries: []});
    options.push({name: Lang.HISTORY+' (Ctrl+H)', logo:'fa-history', type: 'group', renderer: getHistoryEntries, entries: []});
    options.push({name: Lang.EXTRAS, logo:'fa-folder', type: 'group', renderer: getRemoteXtras, entries: []});
    return options;
}

function getParentalControlEntries(){
    var options = [];
    options.push({
        type: 'input',
        logo: 'assets/icons/white/shield.png',
        change: function (entry, element, val){
            Store.set('parental-control-terms', val)
        },
        value: parentalControlTerms().join(',')
    });
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
            options.push({name: Lang.ADD+': '+stream.name, logo:'fa-plus', type: 'option', callback: function (){
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
                    Store.set('overridden-locale', locale);
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
        if(!(entry instanceof Array)) continue;
        if(notActive === true && entry[1] == active) continue;
        if(typeof(entry[2])=='object'){
            var locale = getLocale(false, true);
            length = Number(entry[2].length).toLocaleString(locale);
            groups = Number(entry[2]['groups']).toLocaleString(locale);
        }
        options.push({name: entry[0], logo:'fa-shopping-bag', type: 'option', url: entry[1], label: Lang.STREAMS+': '+length+' &middot '+Lang.GROUPS+': '+groups, 
            callback: function (data){
                //console.log(data);
                setActiveSource(data.url);
                setTimeout(function (){
                    listEntriesByPath(Lang.CHANNELS)
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
        options.push({name: Lang.CONNECTED_LISTS, logo: 'fa-users', type: 'group', renderer: getRemoteSources, entries: []});
        // options.push({name: Lang.FIND_LISTS, logo: 'fa-search', type: 'option', callback: function (){nw.Shell.openExternal(getIPTVListSearchURL())}});
        options.push({name: Lang.SHARE_LISTS, type: 'check', check: function (checked){
            Store.set('unshare-lists', !checked)
        },  checked: () => {
                return !Store.get('unshare-lists')
            }
        })
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


