

var searchKeypressTimer = 0, searchEngines = {}

function registerSearchEngine(name, slug, callback, public){
    searchEngines[slug] = {name, slug, callback, mode: public ? 'public' : 'private'}
}

function getDefaultSearchTerms(){
    var c = Playback.active ? Playback.active.entry : (Playback.lastActive ? Playback.lastActive.entry : History.get(0))
    if(c){
        return prepareSearchTerms(c.name).slice(0, 3).join(' ')
    }
    return ''
}

function goSearch(searchTerm, type, _backTo){
    if(isMiniPlayerActive()){
        leaveMiniPlayer()
    }
    var s
    if(searchTerm){
        lastSearchTerm = searchTerm;
    } else if(Playback.active) {
        lastSearchTerm = getDefaultSearchTerms()
    } else if(s = Store.get('search-history')){
        lastSearchTerm = s[0].term
    }
    if(typeof(type) == 'string' && typeof(searchEngines[type]) != 'undefined'){
        lastSearchType = type
    }
    console.warn('BACKTO', _backTo, ',', Menu.path)
    var callback = () => {
        Menu.show()
        if(typeof(_backTo) == 'string'){
            Menu.setBackTo(_backTo)
        }
        if(lastSearchTerm){
            Menu.container().find('.entry-input input').val(lastSearchTerm).trigger('input')
        } else {
            getSearchSuggestions()
        }
    }
    if(Menu.path == searchPath){
        Menu.refresh(null, () => {
            callback()
        })
    } else {
        Menu.go(searchPath, () => {
            callback()
        })
    }
}

var indexerReady, indexerQueryCallbacks = {}

function indexerSync(){
    if(!indexerReady){
        return setTimeout(() => {
            indexerSync()
        }, 1000)
    }
    ipc.server.broadcast('indexer-sync', {})
}

function indexerAdultFilter(entries, cb){
    if(!indexerReady){
        return setTimeout(() => {
            indexerAdultFilter(entries, cb)
        }, 1000)
    }
    return cb(entries)
    let uid = 0
    while(typeof(indexerQueryCallbacks[uid]) == 'function'){
        uid = rand(1, 1000000)
    }
    indexerQueryCallbacks[uid] = opts => {
        cb(opts.entries)
    }
    ipc.server.broadcast('indexer-adult-filter', {uid, entries})
}

function indexerSearch(type, term, matchGroup, matchPartial, cb, adult){
    if(!indexerReady){
        return setTimeout(() => {
            indexerSearch(type, term, matchGroup, matchPartial, cb, adult)
        }, 1000)
    }
    let uid = 0
    while(typeof(indexerQueryCallbacks[uid]) == 'function'){
        uid = rand(1, 1000000)
    }
    indexerQueryCallbacks[uid] = cb
    ipc.server.broadcast('indexer-query', {uid, type, term, matchGroup, matchPartial, adult})
}

function indexerQueryList(url, cb){
    if(!indexerReady){
        return setTimeout(() => {
            indexerQueryList(url, cb)
        }, 1000)
    }
    let uid = 0
    while(typeof(indexerQueryCallbacks[uid]) == 'function'){
        uid = rand(1, 1000000)
    }
    indexerQueryCallbacks[uid] = cb
    ipc.server.broadcast('indexer-query-list', {uid, url})
}

function indexerFilter(type, names, matchAll, strict, cb){
    if(!indexerReady){
        return setTimeout(() => {
            indexerFilter(type, names, matchAll, strict, cb)
        }, 1000)
    }
    let uid = 0
    while(typeof(indexerQueryCallbacks[uid]) == 'function'){
        uid = rand(1, 1000000)
    }
    indexerQueryCallbacks[uid] = cb
    ipc.server.broadcast('indexer-filter', {uid, type, names, matchAll, strict})
}

ipc.server.on('indexer-query-result', (results) => {
    console.log('RESULT', results)
    if(typeof(indexerQueryCallbacks[results.uid]) == 'function'){
        indexerQueryCallbacks[results.uid](results)
        delete indexerQueryCallbacks[results.uid]
    }
})

ipc.server.on('indexer-ready', (results) => {
    indexerReady = true
})

ipc.server.on('indexer-empty', (results) => {
    askForInputNotification.update(Lang.NO_LIST_PROVIDED.format(Lang.SEARCH_RANGE), 'fa-exclamation-circle faclr-red', 'normal')
})

var sharedListsSearchCaching = false;
function search(cb, type, term, matchGroup, matchPartial, filter, adult){
    var r = [], limit = searchResultsLimit
    if(!term){
        var c = jQuery('.list > div > div input')
        if(c.length){
            term = c.val().toLowerCase()
        } else {
            term = ''
        }
    }
    if(term && term.length > 2){
        console.warn('SEARCH FETCH', type, traceback())
        const autoStrict = (matchPartial == 'auto'), done = ret => {
            console.warn('SEARCH RESULT', ret)
            //console.warn("GOLD", r, maybe);
            if(typeof(filter) == 'function'){
                ret.results = filter(ret.results)
            }
            if(ret.results.length < limit && !matchGroup){
                if(typeof(filter) == 'function'){
                    ret.maybe = filter(ret.maybe)
                }
                ret.results = ret.results.concat(ret.maybe.slice(0, limit - r.length))
            }
            ret.results = sortEntriesByEngine(ret.results)
            ret.results = ret.results.map((e, i) => { e.score = i; return e })
            ret.results = sortEntriesByState(ret.results)
            cb(ret.results)
        }
        if(autoStrict){
            matchPartial = false
        }
        indexerSearch(type, term, matchGroup, matchPartial, (ret) => {
            if(autoStrict && !ret.results.length){
                indexerSearch(type, term, matchGroup, true, (ret) => { // query again allow partial matching
                    done(ret)
                }, adult)
            } else {
                done(ret)
            }
        }, adult)
    } else {
        cb([])
    }
}

function sortEntriesByEngine(entries){
    let groups = {}, rentries = []
    entries.forEach(e => {
	    let g = getEngine(e)
	    if(typeof(groups[g]) == 'undefined'){
    		groups[g] = []
    	}
    	groups[g].push(e)
    })
    Playback.intentTypesPriorityOrder.forEach(g => {
        if(typeof(groups[g]) != 'undefined'){
            rentries = rentries.concat(groups[g])
        }
    })
    return rentries
}

addAction('appLoad', () => {
    var s = Store.get('search-history')
    if(s && s.length){
        lastSearchTerm = s[0].term, lastSearchType = s[0].type;    
    } else {
        lastSearchTerm = '', lastSearchType = 'all';
    }
    registerSearchEngine([Lang.LIVE, Lang.VIDEOS].join(', '), 'all', (val, callback) => {
        search(callback, 'all', val, true, true)
    }, true)
    Playback.on('commit', (intent, entry) => {
        console.warn('PLAYBACK COMMIT', intent, entry)
        if(entry.origin && (typeof(entry.origin.searchType) != 'undefined' || typeof(searchEngines[entry.origin.searchType]) != 'undefined')){
            var add = {term: entry.origin.term, type: entry.origin.searchType}
            var sugs = Store.get('search-history')
            if(!Array.isArray(sugs)){
                sugs = []
            }
            if(sugs.indexOf(add) == -1) {
                sugs.push(add)
                console.warn('PLAYBACK COMMIT', sugs)
                Store.set('search-history', sugs, true)
            }
        }
    })
})
