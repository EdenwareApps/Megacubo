

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
    var s = Store.get('search-history')
    s = s && s.length ? s[0] : {type: lastSearchType, term: lastSearchTerm}
    if(searchTerm){
        lastSearchTerm = searchTerm;
    } else {
        lastSearchTerm = Playback.active ? getDefaultSearchTerms() : s.term
    }
    if(!type){
        lastSearchType = s.type
    }
    lastSearchType = type;
    console.warn('BACKTO', _backTo, ',', Menu.path);
    var callback = () => {
        Menu.show()
        if(searchTerm) {
            console.warn('BACKTO');
            var n = jQuery(document).find('.list input');
            console.log('AA', Menu.path, searchTerm);
            n.val(searchTerm).trigger('input');
            console.log('BB', n.length)
        }
        if(typeof(_backTo) == 'string'){
            Menu.setBackTo(_backTo)
        }
    }
    if(Menu.path == searchPath){
        callback()
    } else {
        Menu.go(searchPath, callback)
    }
}

function setupSearch(term, type, onRender){
    if(typeof(searchEngines[type]) == 'undefined'){
        return;
    }
    var prevPath = Menu.path.indexOf(Lang.SEARCH) == -1 ? Menu.path : ''
    Menu.path = assumePath(Lang.SEARCH)
    var container = Menu.container(true)
    Menu.renderBackEntry(container, dirname(Menu.path), searchEngines[type].name)
    if(!term){
        if(Playback.active){
            var url = Playback.active.entry.originalUrl;
            if(isMegaURL(url)){
                var data = parseMegaURL(url);
                if(data && data.type=='play'){
                    term = data.name;
                }
            }
        }
    }
    lastSearchTerm = term;
    lastSearchType = type;
    const load = () => {
        if(!container.find('a.entry-loading').length){
            clear()
            Menu.list([
                Menu.loadingEntry()
            ], Menu.path)
        }
    }
    const clear = () => {
        container.find('a.entry-stream, a.entry-loading, a.entry-autoclean, a.entry-empty').remove()
    }
    const entry = {
        type: 'input',
        name: Lang.SEARCH,
        change: (e, element, val) => {
            load()
            var np = container.find('a.entry-input'), initPath = Menu.path;
            clearTimeout(searchKeypressTimer);
            container.find('a.entry-stream, a.entry-loading, a.entry-autoclean, a.entry-empty').remove();
            if(val){
                lastSearchTerm = val;
                Store.set('last-search-term', val, true);
                Menu.list([Menu.loadingEntry()], Menu.path)
            } else {
                Menu.list([], Menu.path) // just to update the body class
            }
            Pointer.focus(np)
            np.find('input').get(0).focus()
            var initialPath = Menu.path, initialTerms = val, callback = (results) => {
                if(Menu.path == initialPath && initialTerms == lastSearchTerm){
                    var append = Menu.query(Menu.getEntries(true, true, true), {type: 'stream'}).length;
                    console.log('QQQ', results, val, type, Menu.path);
                    results = results.map((e) => {
                        e.origin = {
                            term: term,
                            searchType: type
                        }
                        return e
                    })
                    if(append){
                        if(results.length){
                            Menu.list(results, Menu.path, Menu.getEntries(false, false, false).length)
                        }
                    } else {
                        container.find('a.entry-stream, a.entry-loading, a.entry-autoclean, a.entry-group, a.entry-suggest, a.entry-option:not(.entry-back)').remove();
                        if(!results.length){
                            results = [{name: Lang.NO_RESULTS, logo:'fa-ban', type: 'option', class: 'entry-empty'}]
                        }
                        Menu.list(results, Menu.path)
                    }
                    Pointer.focus(np)
                    np.find('input').get(0).focus()
                    if(typeof(onRender)=='function'){
                        setTimeout(onRender, 200)
                    }
                }
            }
            searchKeypressTimer = setTimeout(() => {
                clearTimeout(searchKeypressTimer);
                if(initPath == Menu.path){
                    if(val.length < 2){
                        callback([])
                        if(type == 'live'){
                            getSearchSuggestions()
                        }
                        return
                    }
                    load()
                    var parentalControlAllowed = parentalControlAllow(val, true)
                    if(adultContentPolicy == 'allow' || parentalControlAllowed){   
                        searchEngines[type].callback(val, callback)
                    } else {
                        callback([{name: Lang.NO_RESULTS, logo:'fa-ban', type: 'option', class: 'entry-empty'}])
                    }
                    sendStats('search', {query: val, type: type})
                }
            }, 750)
        },
        value: term,
        placeholder: Lang.SEARCH_PLACEHOLDER
    }
    Menu.render([entry]);
    Menu.vpath = '';
    Menu.adjustBodyClass(false);
    Menu.setBackToHome();
    jQuery('a.entry input').trigger('focus').trigger('input')
}

var indexerQueryCallbacks = {}

function indexerSearch(type, term, matchAll, strict, cb){
    let uid = 0
    while(typeof(indexerQueryCallbacks[uid]) == 'function'){
        uid = rand(1, 1000000)
    }
    indexerQueryCallbacks[uid] = cb
    ipc.server.broadcast('indexer-query', {uid, type, term, matchAll, strict})
}

function indexerFilter(type, names, matchAll, strict, cb){
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

var sharedListsSearchCaching = false;
function search(cb, type, term, matchAll, _strict, filter){
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
        console.warn('SEARCH FETCH', traceback())
        const autoStrict = (_strict == 'auto'), done = ret => {
            console.warn('SEARCH RESULT', ret)
            //console.warn("GOLD", r, maybe);
            if(typeof(filter) == 'function'){
                ret.results = filter(ret.results)
            }
            if(ret.results.length < limit && !matchAll){
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
            _strict = true
        }
        indexerSearch(type, term, matchAll, _strict, (ret) => {
            if(autoStrict && !ret.results.length){
                indexerSearch(type, term, matchAll, false, (ret) => { // query again unstrictly
                    done(ret)
                })
            } else {
                done(ret)
            }
        })
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
    registerSearchEngine(Lang.LIVE, 'live', (val, callback) => {
        search(callback, 'live', val, true)
    }, true)
    registerSearchEngine(Lang.VIDEOS, 'video', (val, callback) => {
        search(callback, 'video', val, true)
    }, true)
    registerSearchEngine(Lang.ALL, 'all', (val, cb) => {
        var results = {}
        async.each(searchEngines, (engine, done) => {
            console.warn(engine, engine.callback)
            if(engine.mode == 'public' && typeof(results[engine.slug]) == 'undefined'){
                engine.callback(val, (entries) => {
                    results[engine.slug] = entries
                    done()
                })
            } else {
                done()
            }
        }, (err) => {
            console.warn('COMPLETE', err)
            var nresults = []
            Object.keys(results).forEach(type => {
                nresults = nresults.concat(results[type])
            })
            console.warn('COMPLETE', val, results, nresults)
            cb(nresults)
        })
    })
})
