var start = time(), connected, terminated, leftWindowDiffTimer, leftWindowDiff, ipc = require('node-ipc'), win = nw.Window.get()
ipc.config.id = 'indexer';
ipc.config.maxRetries = 1000;
ipc.config.socketRoot = Store.folder + path.sep;
ipc.config.retry = 250;
ipc.config.stopRetrying = false;
ipc.connectTo('main', () => {
    console.log('IPC connected', time())
    var events = {
        'close': () => {
            console.log('detected close event')
            terminate(true)
        }
    }
    Object.keys(events).forEach(name => {
        ipc.of.main.on(name, events[name])
    })
    connected = true;
})

function terminate(force) {
    try {
        ipc.disconnect('main')
    } catch(e) {
        console.error(e)
    }
    console.log('closing', traceback())
    var doClose = (force === true || !isSDKBuild)
    if(doClose){
        win.close(true)
    } else {
        console.warn('Closing prevented for debugging')
    }
}

function init() {
    if(Store.get('indexer-results')){
        setPriority('idle')
    }
    var pop = nw.Window.get()
    pop.maximize()
    leftWindowDiffTimer = setInterval(() => {
        if(pop.x <= 0){
            clearInterval(leftWindowDiffTimer);
            try {
                leftWindowDiff = pop.x;
                pop.hide()
            } catch(e) {
                console.error(e)
            }
        }
    }, 250)
    buildSharedListsSearchIndex((urls) => {
        console.log('Search index builden', time())
        fetchSharedListsGroups('live')
        console.log('Shared groups builden', time())
        /*
        var exports = ['mediaTypeStreamsCount','leftWindowDiff','sharedListsGroups','sharedListsSearchWordsIndex','sharedListsSearchWordsIndexStrict']
        var results = {}
        exports.forEach(v => { // no arrow function here
            results[v] = '!' + BigJSON.stringify(eval(v))
        })
        ipc.of.main.emit('indexer:results', results)
        */
        var file = Store.resolve('indexer-data')
        fs.writeFile(
            file, 
            JSON.stringify({mediaTypeStreamsCount,leftWindowDiff,sharedListsGroups,sharedListsSearchWordsIndex,sharedListsSearchWordsIndexStrict}),
            () => {
                console.log('Search index sending', time())
                ipc.of.main.emit('indexer:results', file)
                console.log('Search index sent', time())
                async.forEach(urls, (url, callback) => {
                    getHeaders(url, callback)
                }, () => {
                    ipc.disconnect('main') // end after the getHeaders delay to give a grace period for sending the results
                    terminate()
                }) // ping lists anyway for any possible auth
            }
        )   
    })
}

function fetchSharedListsGroups(type){
    if(sharedListsGroups === false){
        sharedListsGroups = {video: [], live: [], radio: [], adult: []};
        let caching = {prepareFilename: {}, parentalControlAllow: {}, mediaType: {}}, storeas = (g, gtype) => {
            if(typeof(sharedListsGroups[gtype]) == 'undefined'){
                sharedListsGroups[gtype] = []
            }
            if(sharedListsGroups[gtype].indexOf(g) == -1){
                sharedListsGroups[gtype].push(g)
            }
        }
        for(var word in sharedListsSearchWordsIndex){
            for(var n in sharedListsSearchWordsIndex[word].entries){
                var g = sharedListsSearchWordsIndex[word].entries[n].group;
                if(g && g.indexOf('/') == -1){
                    if(typeof(caching['prepareFilename'][g]) == 'undefined'){
                        caching['prepareFilename'][g] = g = prepareFilename(g, true)
                    } else {
                        g = caching['prepareFilename'][g]
                    }                    
                }
                if(g && g.indexOf('/') == -1){
                    if(typeof(sharedListsSearchWordsIndex[word].entries[n].mediaType) == 'undefined' || sharedListsSearchWordsIndex[word].entries[n].mediaType == -1){
                        if(typeof(caching['mediaType'][sharedListsSearchWordsIndex[word].entries[n].url]) == 'undefined'){
                            caching['mediaType'][sharedListsSearchWordsIndex[word].entries[n].url] = getStreamBasicType(sharedListsSearchWordsIndex[word].entries[n])
                        }      
                        sharedListsSearchWordsIndex[word].entries[n].mediaType = caching['mediaType'][sharedListsSearchWordsIndex[word].entries[n].url]
                    }
                    if(typeof(sharedListsSearchWordsIndex[word].entries[n].parentalControlSafe) == 'undefined'){
                        if(typeof(caching['parentalControlAllow'][sharedListsSearchWordsIndex[word].entries[n].url]) == 'undefined'){
                            caching['parentalControlAllow'][sharedListsSearchWordsIndex[word].entries[n].url] = parentalControlAllow(sharedListsSearchWordsIndex[word].entries[n], true)
                        }      
                        sharedListsSearchWordsIndex[word].entries[n].parentalControlSafe = caching['parentalControlAllow'][sharedListsSearchWordsIndex[word].entries[n].url]
                    }
                    if(sharedListsSearchWordsIndex[word].entries[n].parentalControlSafe === false){
                        storeas(g, 'adult')
                    }
                    storeas(g, sharedListsSearchWordsIndex[word].entries[n].mediaType)
                }
            }
        }
        sharedListsGroups['live'].sort()
        sharedListsGroups['video'].sort()
        sharedListsGroups['radio'].sort()
        sharedListsGroups['adult'].sort()
    }
    switch(type){
        case 'live':
            return sharedListsGroups['live'];
            break;
        case 'video':
            return sharedListsGroups['video'];
            break;
        case 'radio':
            return sharedListsGroups['radio'];
            break;
        default:
            var r = sharedListsGroups['live'];
            r = r.concat(sharedListsGroups['video']);
            r = r.concat(sharedListsGroups['radio']);
            r = r.sort();
            return r;
    }
}

function buildSharedListsSearchIndex(loadcb){
    var listRetrieveTimeout = 8
    fetchSharedLists((urls) => {
        if(urls.length){
            var listsCountLimit = Config.get('search-range-size');
            if(typeof(listsCountLimit)!='number' || listsCountLimit >= 0){
                listsCountLimit = 18; // default
            }
            if(urls.length > listsCountLimit){
                urls = urls.slice(0, listsCountLimit)
            }
            var iterator = 0, completeIterator = 0, tasks = Array(urls.length).fill((asyncCallback) => {
                var url = urls[iterator];
                iterator++;
                completeIterator += 0.5;
                ListMan.parse(url, (entries) => {
                    completeIterator += 0.5;
                    asyncCallback();
                    addEntriesToSearchIndex(entries, url)
                }, listRetrieveTimeout, true)            
            })
            async.parallelLimit(tasks, 8, (err, results) => {
                loadcb(urls)
            })
        } else {
            mainWin.alert(mainWin.Lang.NO_LIST_PROVIDED.format(mainWin.Lang.SEARCH_RANGE));
            loadcb([])
        }
    })
}

if(navigator.onLine){
    init()
} else {
    var iStateTimer;
    window.addEventListener('online', () => {
        iStateTimer = setTimeout(init, 5000)
    })
    window.addEventListener('offline', () => {
        if(iStateTimer){
            clearTimeout(iStateTimer)
        }
    })
}
