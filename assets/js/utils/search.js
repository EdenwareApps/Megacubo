

var searchKeypressTimer = 0, searchResultsLimit = 196, searchEngines = {}

function registerSearchEngine(name, slug, callback, public){
    searchEngines[slug] = {name, slug, callback, mode: public ? 'public' : 'private'}
}

function getDefaultSearchTerms(){
    var c = Playback.active ? Playback.active.entry : (Playback.lastActiveIntent ? Playback.lastActiveIntent.entry : History.get(0))
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
    var entry = {
        type: 'input',
        name: Lang.SEARCH,
        change: (entry, element, val) => {
            var np = container.find('a.entry-input'), initPath = Menu.path;
            clearTimeout(searchKeypressTimer);
            container.find('a.entry-stream, a.entry-loading, a.entry-autoclean, a.entry-empty').remove();
            if(val){
                lastSearchTerm = val;
                Store.set('last-search-term', val);
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
                    results = results.map((entry) => {
                        entry.origin = {
                            term: term,
                            searchType: type
                        }
                        return entry
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
                    var parentalControlAllowed = parentalControlAllow(val, true)
                    if(val.length && (adultContentPolicy == 'allow' || parentalControlAllowed)){   
                        searchEngines[type].callback(val, callback)
                    } else {
                        callback([])
                    }
                    //console.warn('INPUT2', val, np.find('input').val());
                    if(val.length > 2){
                        sendStats('search', {query: val, type: type})
                    } else {
                        getSearchSuggestions()
                    }
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

var sharedListsSearchCaching = false;
function fetchSharedListsSearchResults(cb, type, term, matchAll, _strict, filter){
    var r = [], limit = searchResultsLimit;
    if(!term){
        var c = jQuery('.list > div > div input');
        if(c.length){
            term = c.val().toLowerCase()
        } else {
            term = ''
        }
    }
    if(term && term.length > 2){
        if(sharedListsSearchCaching && sharedListsSearchCaching.query == term && sharedListsSearchCaching.type == type && sharedListsSearchCaching.matchAll == matchAll && sharedListsSearchCaching.strict == _strict){
            r = sharedListsSearchCaching.entries;
        } else {
            var maybe = [], already = {}, terms = prepareSearchTerms(term);
            if(terms.length >= 1){
                var resultHitMap = {}, resultEntryMap = {};
                terms.forEach((_term) => {
                    var already = {}, _terms = [];
                    if(typeof(sharedListsSearchWordsIndex[_term]) != 'undefined'){
                        _terms.push(_term)
                    }
                    var l = _term.length, f = _term.charAt(0);
                    if(!_strict){
                        for(var k in sharedListsSearchWordsIndex){
                            if(k.length > l && k.charAt(0) == f && k.substr(0, l) == _term){
                                _terms.push(k)
                            }
                        }
                    }
                    _terms.forEach((t) => {
                        if(typeof((_strict?sharedListsSearchWordsIndexStrict:sharedListsSearchWordsIndex)[t]) != 'undefined'){
                            (_strict?sharedListsSearchWordsIndexStrict:sharedListsSearchWordsIndex)[t].entries.forEach((entry, i) => {
                                if(entry.mediaType == -1){
                                    (_strict?sharedListsSearchWordsIndexStrict:sharedListsSearchWordsIndex)[t].entries[i].mediaType = getStreamBasicType(entry);
                                }
                                if(('all' == type || entry.mediaType == type) && typeof(already[entry.url])=='undefined'){
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
                });
                var max = matchAll ? terms.length : Math.max.apply(null, Object.values(resultHitMap));
                //console.warn("GOLD", resultEntryMap, resultHitMap, terms);
                Object.keys(resultHitMap).sort((a, b) => {
                    return resultHitMap[b] - resultHitMap[a]
                }).forEach((url) => {
                    if(r.length < searchResultsLimit){
                        if(!matchAll || resultHitMap[url] >= max){
                            var entry = Object.assign({}, resultEntryMap[url]);
                            r.push(entry)
                        } else if(resultHitMap[url] >= max - 1) {
                            var entry = Object.assign({}, resultEntryMap[url]);
                            maybe.push(entry)
                        }
                    }
                });
                //console.warn("GOLD", r, maybe);
                if(typeof(filter) == 'function'){
                    r = filter(r)
                }
                if(r.length < limit && !matchAll){
                    if(typeof(filter) == 'function'){
                        maybe = filter(maybe)
                    }
                    r = r.concat(maybe.slice(0, limit - r.length))
                }
                sharedListsSearchCaching = {type: type, query: term, entries: r, matchAll: matchAll, strict: _strict};                    
            }
        }
    }
    if(typeof(cb)=='function'){
        cb(r)
    }
    return r;
}

addAction('appLoad', () => {
    var s = Store.get('search-history')
    if(s && s.length){
        lastSearchTerm = s[0].term, lastSearchType = s[0].type;    
    } else {
        lastSearchTerm = '', lastSearchType = 'all';
    }
    registerSearchEngine(Lang.LIVE, 'live', (val, callback) => {
        fetchSharedListsSearchResults(callback, 'live', val, true)
    }, true)
    registerSearchEngine(Lang.VIDEOS, 'video', (val, callback) => {
        fetchSharedListsSearchResults(callback, 'video', val, true)
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
