var start = time(), 
    lastUpdate = 0, 
    connected, 
    terminated, 
    processingInterval = 3600, 
    reportingInterval = 60, 
    leftWindowDiffTimer, 
    leftWindowDiff,
    Indexer,
    mediaTypeStreamsCount = mediaTypeStreamsCountTemplate

const ipc = require('node-ipc'), 
    win = nw.Window.get()

ipc.config.id = 'indexer'
ipc.config.socketRoot = Store.folder + path.sep;

const connect = () => {
    ipc.connectTo('main', () => {
        console.log('IPC connected', time())
        var events = {
            'disconnect': () => {
                console.log('detected disconnect event')
                isMainPIDRunning((err, running) => {
                    if(running){
                        connect()
                    } else {
                        terminate(true)
                    }
                })
            },
            'indexer-update': () => {
                init()
            },
            'indexer-sync': () => {
                Config.reload()
                getActiveLists((urls) => {
                    Indexer.setLists(urls) 
                })
            },
            'indexer-adult-filter': (opts) => {
                ipc.of.main.emit('indexer-query-result', indexerAdultFilter(opts))
            },
            'indexer-filter': (opts) => {
                ipc.of.main.emit('indexer-query-result', indexerFilter(opts))
            },
            'indexer-query': (opts) => {
                ipc.of.main.emit('indexer-query-result', indexerQuery(opts))
            }
        }
        Object.keys(events).forEach(name => {
            ipc.of.main.on(name, events[name])
        })
        connected = true
    })
}

connect()

indexerFilter = opts => {
    opts.names = opts.names.filter(name => {
        if(!Indexer.has){
            console.warn('Indexer.has', Indexer, typeof(Indexer))
        }
        return Indexer.has(name, !opts.strict, true, [opts.type])
    })
    return opts
}

indexerAdultFilter = opts => {
    let ks = Object.keys(Indexer.lists)
    opts.entries = opts.entries.map(e => {
        ks.some(u => {
            if(e.parentalControlSafe !== false){
                let found = false
                Indexer.lists[u].some(n => {
                    if(e.name == n.name || e.url == n.url){
                        found = true
                        if(n.parentalControlSafe === false){
                            e.parentalControlSafe = false
                            return true
                        }
                    }
                })
                if(!found && e.parentalControlSafe !== false && !parentalControlAllow(e, true)){
                    e.parentalControlSafe = false
                    return true
                }
            }
        })
        return e
    })
    return opts
}

indexerQuery = (opts) => {
    let limit = searchResultsLimit, ret = Indexer.search(opts.term, !opts.strict, true, [opts.type], typeof(opts.adult) == 'boolean' ? opts.adult : null)    
    let maybe = searchResultsLimit > ret.results.length ? ret.maybe.slice(0, searchResultsLimit - ret.results.length) : []
    return {uid: opts.uid, results: ret.results.slice(0, searchResultsLimit), maybe}
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

function init(loadcb){
    mediaTypeStreamsCount = Object.assign({}, mediaTypeStreamsCountTemplate)
    var listRetrieveTimeout = 10 // make timeout low, we have caches anyway in case of timeouts
    Config.reload()
    getActiveLists((urls) => {
        console.warn('BUILD*', Config.get('search-range-size'), urls)
        if(!Indexer){
            Indexer = new (require(path.resolve('modules/m3u-indexer')))(GStore, Lang, request)
            Indexer.on('stats', (stats, groups) => {
                mediaTypeStreamsCount = stats
                sharedListsGroups = groups
                report()
            })
        }
        Indexer.addFilter(entry => {
            if(typeof(entry.parentalControlSafe) != 'boolean'){
                entry.parentalControlSafe = parentalControlAllow(entry, true)
            }
            return entry
        }) 
        Indexer.setLists(urls) 
        if(typeof(loadcb) == 'function'){
            loadcb(urls)
        }
    })
}

function ready(){
    Config.reload()
    if(navigator.onLine && (Config.get('search-range-size') > 0 || getSources().length)){
        console.log('Start indexing...')
        var pop = nw.Window.get()
        pop.maximize()
        pop.hide()
        leftWindowDiffTimer = setInterval(() => {
            if(pop.x <= 0){
                clearInterval(leftWindowDiffTimer)
                try {
                    leftWindowDiff = pop.x
                    ipc.of.main.emit('indexer-load')
                } catch(e) {
                    console.error(e)
                }
            }
        }, 250)    
        init()
        setInterval(init, processingInterval * 1000)
        setInterval(report, reportingInterval * 1000)
    } else {
        setTimeout(ready, 1500)
    }
}

ready()

