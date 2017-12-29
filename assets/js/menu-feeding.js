

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
        options.push({name: Lang.DUPLICATE+' (Ctrl+Shift+D)', logo:'fa-files-o', type: 'option', callback: function (){
            top.window.spawnOut();
            refreshListing()
        }})
    }
    options.push({name: 'Aspect Ratio (F4)', logo:'fa-arrows-alt', type: 'option', callback: function (){
        changeScaleMode()
    }})
    options.push({name: Lang.START_IN_FULLSCREEN, type: 'check', check: function (checked){
        Store.set('start-in-fullscreen', checked)
    }, checked: Store.get('start-in-fullscreen')})
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

function getBookmarksEntries(){
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
    } else {
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

function getPackagesEntries(){
    var sources = getSources();
    var options = [];
    for(var i in sources){
        var entry = sources[i], length = '-', groups = '-';
        if(typeof(entry[2])=='object'){
            var locale = getLocale(false, true);
            length = Number(entry[2].length).toLocaleString(locale);
            groups = Number(entry[2]['groups']).toLocaleString(locale);
        }
        options.push({name: entry[0], logo:'fa-shopping-bag', type: 'option', url: entry[1], label: Lang.STREAMS+': '+length+' &middot '+Lang.GROUPS+': '+groups, 
            callback: function (data){
                //console.log(data);
                setActiveSource(data.url, false);
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
    options.push({name: Lang.ADD_NEW_PACKAGE, logo:'fa-plus', type: 'option', callback: addNewSource});
    options.push({name: Lang.REMOVE_PACKAGE, logo:'fa-trash', type: 'group', renderer: getPackagesEntriesForRemoval, callback: markActiveSource});
    options.push({name: Lang.WEB_SEARCH, logo:'fa-search', type: 'option', callback: function (){nw.Shell.openExternal(getIPTVListSearchURL())}});
    return options;
}

function getPackagesEntriesForRemoval(){
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
                path: Lang.PACKAGES
            })
        }
    } else {
        entries.push({name: Lang.EMPTY, logo:'fa-files-o', type: 'option'})
    }
    return entries;
}




