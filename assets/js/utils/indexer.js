var start = time(), 
    lastUpdate = 0, 
    processingInterval = 3600, 
    reportingInterval = 60, 
    connected, 
    terminated, 
    leftWindowDiffTimer, 
    leftWindowDiff
const ipc = require('node-ipc'), 
    win = nw.Window.get(),
    indexerResultsFile = Store.resolve('indexer-data')

ipc.config.id = 'indexer-' + rand(1, 999999)
ipc.config.socketRoot = Store.folder + path.sep;

const connect = () => {
    ipc.connectTo('main', () => {
        console.log('IPC connected', time())
        var events = {
            'disconnect': () => {
                console.log('detected disconnect event')
                //terminate(true)
                connect()
            },
            'indexer-update': () => {
                init()
            },
            'indexer-query': (opts) => {
                ipc.of.main.emit('indexer-query-result', indexerQuery(opts))
            }
        }
        Object.keys(events).forEach(name => {
            ipc.of.main.on(name, events[name])
        })
        connected = true;
    })
}

connect()

indexerQuery = (opts) => {
    var results = [], limit = searchResultsLimit, maybe = [], already = {}, terms = prepareSearchTerms(opts.term)
    if(terms.length >= 1){
        var resultHitMap = {}, resultEntryMap = {}
        terms.forEach((_term) => {
            var already = {}, _terms = []
            if(typeof(sharedListsSearchWordsIndex[_term]) != 'undefined'){
                _terms.push(_term)
            }
            var l = _term.length, f = _term.charAt(0)
            if(!opts.strict){
                for(var k in sharedListsSearchWordsIndex){
                    if(k.length > l && k.charAt(0) == f && k.substr(0, l) == _term){
                        _terms.push(k)
                    }
                }
            }
            _terms.forEach((t) => {
                if(typeof((opts.strict?sharedListsSearchWordsIndexStrict:sharedListsSearchWordsIndex)[t]) != 'undefined'){
                    (opts.strict?sharedListsSearchWordsIndexStrict:sharedListsSearchWordsIndex)[t].entries.forEach((entry, i) => {
                        if(entry.mediaType == -1){
                            (opts.strict?sharedListsSearchWordsIndexStrict:sharedListsSearchWordsIndex)[t].entries[i].mediaType = getStreamBasicType(entry)
                        }
                        if(('all' == opts.type || entry.mediaType == opts.type) && typeof(already[entry.url])=='undefined'){
                            already[entry.url] = true;
                            if(typeof(resultHitMap[entry.url])=='undefined'){
                                resultHitMap[entry.url] = 0;
                            }
                            resultHitMap[entry.url]++;
                            resultEntryMap[entry.url] = entry;
                        }
                    })
                }
            });
            already = null;
        })
        var max = opts.matchAll ? terms.length : Math.max.apply(null, Object.values(resultHitMap));
        //console.warn("GOLD", resultEntryMap, resultHitMap, terms);
        Object.keys(resultHitMap).sort((a, b) => {
            return resultHitMap[b] - resultHitMap[a]
        }).forEach((url) => {
            if(results.length < searchResultsLimit){
                if(!opts.matchAll || resultHitMap[url] >= max){
                    var entry = Object.assign({}, resultEntryMap[url]);
                    results.push(entry)
                } else if(resultHitMap[url] >= max - 1) {
                    var entry = Object.assign({}, resultEntryMap[url]);
                    maybe.push(entry)
                }
            }
        })
    }
    return {uid: opts.uid, results, maybe}
}

addAction('addEntriesToSearchIndex', updateMediaTypeStreamsCount)

function addEntriesToSearchIndex(_entries, listURL){
    var b, bs, s = [], ss = [], sep = ' _|_ ';
    var entries = _entries.filter((entry) => {
        return entry && !isMegaURL(entry.url);
    })
    for(var i=0; i<entries.length; i++){
        b = bs = entries[i].name;
        if(typeof(entries[i].group) != 'undefined' && entries[i].group != 'undefined'){
            b += ' ' + entries[i].group
        }
        if(b == bs){
            bs = b = prepareSearchTerms(b)
        } else {
            b = prepareSearchTerms(b), bs = prepareSearchTerms(bs)
        }
        if(typeof(entries[i].mediaType) == 'undefined' || entries[i].mediaType == -1){
            entries[i].mediaType = getStreamBasicType(entries[i])
        }
        entries[i].source = entries[i].source || listURL;
        b.forEach((t) => {
            if(t.length > 1){
                if(typeof(sharedListsSearchWordsIndex[t])=='undefined'){
                    sharedListsSearchWordsIndex[t] = {entries: []}
                }
                sharedListsSearchWordsIndex[t].entries.push(entries[i])
            }
        })
        bs.forEach((t) => {
            if(t.length > 1){
                if(typeof(sharedListsSearchWordsIndexStrict[t])=='undefined'){
                    sharedListsSearchWordsIndexStrict[t] = {entries: []}
                }
                sharedListsSearchWordsIndexStrict[t].entries.push(entries[i])
            }
        })
    }
    doAction('addEntriesToSearchIndex', entries)
}

function updateMediaTypeStreamsCount(entries, wasEmpty){
    if(wasEmpty){
        mediaTypeStreamsCount = Object.assign({}, mediaTypeStreamsCountTemplate);
    }
    entries.forEach((entry) => {
        if(typeof(mediaTypeStreamsCount[entry.mediaType])=='undefined'){
            mediaTypeStreamsCount[entry.mediaType] = 0;
        }
        mediaTypeStreamsCount[entry.mediaType]++;
    })
}

function terminate() {
    var debug = debugAllow(false)
    try {
        ipc.disconnect('main')
    } catch(e) {
        console.error(e)
    }
    console.log('closing', traceback())
    if(!debug){
        win.close(true)
    } else {
        console.warn('Closing prevented for debugging')
    }
}

function report(){
    ipc.of.main.emit('indexer-vars', {mediaTypeStreamsCount, leftWindowDiff, sharedListsGroups})
}

function init(cb) {
    buildSharedListsSearchIndex((urls) => {
        console.log('Search index builden', time())
        fetchSharedListsGroups('live')
        console.log('Shared groups builden', time())
        report()
        console.log('Search index sent', time())
        async.forEach(urls, (url, callback) => {
            getHeaders(url, callback)
        }, () => {
            console.log('DONE') // dont close yet, keep with main
        }) // ping lists anyway for any possible auth
        if(typeof(cb) == 'function'){
            cb()
        }
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
    mediaTypeStreamsCount = Object.assign({}, mediaTypeStreamsCountTemplate)
    sharedListsSearchCaching = false;
    sharedListsSearchWordsIndex = {}
    sharedListsSearchWordsIndexStrict = {}
    var listRetrieveTimeout = 10 // make timeout low, we have caches anyway in case of timeouts
    Config.reload()
    getActiveLists((urls) => {
        if(urls.length){
            console.warn('BUILD*', Config.get('search-range-size'), urls)
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
            loadcb([])
        }
    })
}

function ready(){
    Config.reload()
    if(navigator.onLine && (Config.get('search-range-size') > 0 || getSources().length)){
        console.log('Start indexing...')
        var pop = nw.Window.get()
        pop.maximize()
        leftWindowDiffTimer = setInterval(() => {
            if(pop.x <= 0){
                clearInterval(leftWindowDiffTimer)
                try {
                    leftWindowDiff = pop.x
                    pop.hide()
                    ipc.of.main.emit('indexer-load')
                } catch(e) {
                    console.error(e)
                }
            }
        }, 250)    
        init(() => {
            setInterval(init, processingInterval * 1000)
            setInterval(report, reportingInterval * 1000)
        })        
    } else {
        setTimeout(ready, 1500)
    }
}

ready()

