
const ytName = 'Youtube';
const ytLiveSearchPath = Lang.LIVE+'/'+ytName+'/'+Lang.SEARCH;
const ytVideoSearchPath = Lang.VIDEOS+'/'+ytName+'/'+Lang.SEARCH;

function ytsr(){
    var key = '__ytsr'
    if(typeof(window[key]) == 'undefined'){
        window[key] = require('ytsr')
    }
    return window[key]
}

function getYTVideoID(url){
    var ID = '';
    url = url.replace(/(>|<)/gi,'').split(/(vi\/|v=|\/v\/|youtu\.be\/|\/embed\/)/)
    if(url[2] !== undefined) {
        ID = url[2].split(/[^0-9a-z_\-]/i)
        ID = ID[0];
    } else if(url.indexOf('/') != -1) {
        ID = url;
    }
    return ID;
}

function formatYTURL(url){
    var id = url.indexOf('/') == -1 ? url : getYTVideoID(url)
    return id ? 'http://www.youtube.com/watch?v={0}'.format(id) : url;
}

function getYoutubeEntries(data, element, isVirtual){
    return [
        {name: Lang.LIVE, logo: 'fa-tv', type: 'group', class: 'entry-nosub', renderer: getYoutubeLiveEntries},
        {name: Lang.VIDEOS, logo: 'fa-film', type: 'group', class: 'entry-nosub', renderer: getYoutubeVideoEntries},
        {name: Lang.APP, logo: 'fa-th', type: 'option', callback: () => {
            playEntry({name: 'Youtube', allowWebPages: true, logo: defaultIcons['stream'], url: 'http://youtube.com/tv#nofit'})
        }}
    ]
}

function getYoutubeLiveEntries(data, element, isVirtual){
    var path = assumePath(data.name)
    if(!isVirtual){
        setTimeout(() => {
            getYTLiveFeeds(false, (entries) => {
                console.warn('YTF', basename(Menu.path), basename(path), basename(Menu.path) == basename(path))
                if(basename(Menu.path) == basename(path)){ // basename to ensure, needed
                    console.warn('YTF', entries, Menu.path, path)
                    Menu.loaded()
                    entries = Menu.mergeEntries(Menu.getEntries(true, false, true), entries)
                    Menu.asyncResult(path, entries)
                }
            })
        }, 50)
    }
    return [
        {name: Lang.SEARCH, logo: 'fa-search', type: 'option', callback: () => {
            goSearch(null, 'yt-live')
        }},
        Menu.loadingEntry()
    ]
}

function getYoutubeVideoEntries(data, element, isVirtual){
    var path = assumePath(data.name)
    if(!isVirtual){
        setTimeout(() => {
            getYTVideoFeeds(false, (entries) => {
                console.warn('YTF', basename(Menu.path), basename(path), basename(Menu.path) == basename(path))
                if(basename(Menu.path) == basename(path)){ // basename to ensure, needed
                    console.warn('YTF', entries, Menu.path, path)
                    Menu.loaded()
                    entries = Menu.mergeEntries(Menu.getEntries(true, false, true), entries)
                    Menu.asyncResult(path, entries)
                }
            })
        }, 50)
    }
    return [
        {name: Lang.SEARCH, logo: 'fa-search', type: 'option', callback: () => {
            goSearch(null, 'yt-videos')
        }},
        Menu.loadingEntry()
    ]
}

function getYTLangQueryStr(){
    return 'hl=' + getLocale(true) + '&gl=' + getLocale(false).split('_').pop().toLowerCase()+'&'
}

function searchResultsToEntries(searchResults, type){
    var entries = [];
    console.warn('YT RESULT', searchResults)
    if(searchResults){
        console.warn('YT RESULT', searchResults)
        for(var i=0; i<searchResults.items.length; i++){
            var h = searchResults.items[i].duration && searchResults.items[i].duration.length;
            if(h && type == 'live'){
                continue;
            }
            if(!h && type == 'video'){
                continue;
            }
            var label = searchResults.items[i].author.name + (searchResults.items[i].author.verified ? ' <i class="fas fa-check-circle"></i>': '')
            console.warn('NTRNTR', label)
            if(!h){ // live
                var a = searchResults.items[i].uploaded_at, b = parseCounter(a), c = Lang.X_WATCHING.format(b)
                console.warn('NTRNTR', a, ',', b, ',', c)
                label +=  ' &middot; '+ Lang.X_WATCHING.format(parseCounter(searchResults.items[i].uploaded_at))
            }
            entries.push({
                type: 'stream',
                url: searchResults.items[i].link,
                name: searchResults.items[i].title,
                logo: searchResults.items[i].thumbnail,
                label: label
            })
        }
        console.warn('YT RESULT', entries)
    }
    return entries;
}

function getYTLiveFeeds(term, cb){
    var locale = getDefaultLocale(false, false)
    var country = Countries.select(locale, 'country_'+locale.substr(0, 2)+',country_iso', 'locale', true)
    if(!term){
        var terms = getSearchSuggestionsTerms()
        terms = terms.slice(0, 3)
        terms.push(country)
        term = terms.join(' OR ')
    }
    if(term.length > 128){
        term = term.substr(0, 128)
    }
    var key = 'yt-l-feed-'+term, entries = Store.get(key)
    if(!Array.isArray(entries)){
        console.warn('YTSR', term)
            var options = {
                limit: 96,
                nextpageRef: '/results?sp=EgJAAQ%253D%253D&search_query='+encodeURIComponent(term)+'&'+getYTLangQueryStr()
            }
            ytsr()(null, options, function(err, searchResults) {
                console.warn('YTSR', err, searchResults)
                if(err) throw err;
                var entries = searchResultsToEntries(searchResults, 'live')
                Store.set(key, entries, 3600)
                cb(entries)
            })
    } else {
        console.warn('YTSR', entries)
        setTimeout(() => {
            cb(entries)
        }, 250)
    }
}

function getYTVideoFeeds(term, cb){
    var locale = getDefaultLocale(false, false)
    var country = Countries.select(locale, 'country_'+locale.substr(0, 2)+',country_iso', 'locale', true)
    if(!term){
        var terms = getSearchSuggestionsTerms()
        terms = terms.slice(0, 3)
        terms.push(country)
        term = terms.join(' OR ')
    }
    if(term.length > 128){
        term = term.substr(0, 128)
    }
    var key = 'yt-v-feed-'+term, entries = Store.get(key)
    if(!Array.isArray(entries)){
        console.warn('YTSR', term)
            var options = {
                limit: 96,
                nextpageRef: '/results?search_query='+encodeURIComponent(term)+'&'+getYTLangQueryStr()
            }
            ytsr()(null, options, (err, searchResults) => {
                console.warn('YTSR', '/results?search_query='+encodeURIComponent(term)+'&'+getYTLangQueryStr(), err, searchResults)
                if(err) throw err;
                var entries = searchResultsToEntries(searchResults, 'video')
                Store.set(key, entries, 3600)
                cb(entries)
            })
    } else {
        console.warn('YTSR', entries)
        setTimeout(() => {
            cb(entries)
        }, 250)
    }
}

function fetchYTLiveSearchResults(terms, cb) {
    if(typeof(terms)!='string'){
        terms = jQuery('.list > div > div').find('input').val().toLowerCase()
    }
    var key = 'yt-sr-l-'+terms, entries = Store.get(key)
    if(!Array.isArray(entries)){
        console.warn('@ duh', key, cb)
        ytsr().getFilters(terms, function(err, filters) {
            if(err){
                console.warn('@ duh err', err, cb)
                cb([])
                throw err;
            } else {
                console.warn('@ duh filters', filters)
                filter = filters.get('Type').find(o => o.name === 'Video')
                var options = {
                    limit: 96,
                    nextpageRef: filter.ref
                }
                console.warn('@ duh', cb)
                ytsr()(null, options, function(err, searchResults) {
                    if(err){
                        console.warn('@ duh', cb, err)
                        cb([])
                        throw err;
                    } else {
                        console.warn(searchResults, cb)
                        entries = searchResultsToEntries(searchResults, 'live')
                        Store.set(key, entries, 3600)
                        cb(entries)
                    }
                })
            }
        })
    } else {
        setTimeout(() => {
            cb(entries)
        }, 250)
    }
}

function fetchYTVideoSearchResults(terms, cb) {
    var key = 'yt-sr-v-'+terms, entries = Store.get(key)
    if(!Array.isArray(entries)){
        console.warn('@ duh', key)
        ytsr().getFilters(terms, function(err, filters) {
            if(err){
                console.warn('@ duh err', err)
                cb([])
                throw err;
            } else {
                filter = filters.get('Type').find(o => o.name === 'Video')
                var options = {
                    limit: 96,
                    nextpageRef: filter.ref
                }
                console.warn('@ duh')
                ytsr()(null, options, function(err, searchResults) {
                    if(err){
                        console.warn('@ duh', err)
                        cb([])
                        throw err;
                    } else {
                        console.warn(searchResults)
                        entries = searchResultsToEntries(searchResults, 'video')
                        Store.set(key, entries, 3600)
                        cb(entries)
                    }
                })
            }
        })
    } else {
        setTimeout(() => {
            cb(entries)
        }, 250)
    }
}
    
function goYTLiveSearch(searchTerm, _backTo, live){
    var c = (top || parent || window)
    if(c && c.ytLiveSearchPath){
        if(c.isMiniPlayerActive()){
            c.leaveMiniPlayer()
        }
        if(typeof(_backTo) != 'string'){
            _backTo = Menu.path;
        }
        console.warn('BACKTO', _backTo, ',', c.Menu.path, ',', c.searchPath)
        var callback = () => {
            console.warn('BACKTO')
            c.Menu.show()
            console.warn('BACKTO')
            if(searchTerm) {
                console.warn('BACKTO')
                var n = jQuery(c.document).find('.list input')
                console.log('AA', c.Menu.path, searchTerm)
                n.val(searchTerm).trigger('input')
                console.log('BB', n.length)
            }
            console.warn('BACKTO', JSON.stringify(_backTo))
            if(_backTo == c.ytLiveSearchPath) {
                Menu.setBackToHome()
            } else {
                Menu.setBackTo(_backTo)
            }
        }
        if(c.Menu.path == c.ytLiveSearchPath){
            console.warn('BACKTO')
            callback()
        } else {
            console.warn('BACKTO')
            c.Menu.go(c.ytLiveSearchPath, callback)
        }
    }
}
    
function goYTVideosSearch(searchTerm, _backTo, live){
    var c = (top || parent || window)
    if(c && c.ytVideosSearchPath){
        if(c.isMiniPlayerActive()){
            c.leaveMiniPlayer()
        }
        if(typeof(_backTo) != 'string'){
            _backTo = Menu.path;
        }
        console.warn('BACKTO', _backTo, ',', c.Menu.path, ',', c.searchPath)
        var callback = () => {
            console.warn('BACKTO')
            c.Menu.show()
            console.warn('BACKTO')
            if(searchTerm) {
                console.warn('BACKTO')
                var n = jQuery(c.document).find('.list input')
                console.log('AA', c.Menu.path, searchTerm)
                n.val(searchTerm).trigger('input')
                console.log('BB', n.length)
            }
            console.warn('BACKTO', JSON.stringify(_backTo))
            if(_backTo == c.ytVideosSearchPath) {
                Menu.setBackToHome()
            } else {
                Menu.setBackTo(_backTo)
            }
        }
        if(c.Menu.path == c.ytVideosSearchPath){
            console.warn('BACKTO')
            callback()
        } else {
            console.warn('BACKTO')
            c.Menu.go(c.ytVideosSearchPath, callback)
        }
    }
}

addFilter('videosMetaEntries', entries => {
    entries.push({name: 'Youtube', logo: 'fab fa-youtube', label: Lang.VIDEOS, class: 'entry-nosub', type: 'group', renderer: getYoutubeVideoEntries, entries: []})
    return entries
})

addFilter('liveMetaEntries', entries => {
    entries.push({name: 'Youtube', logo: 'fab fa-youtube', label: Lang.LIVE, class: 'entry-nosub', type: 'group', renderer: getYoutubeLiveEntries, entries: []})
    return entries
})

addFilter('toolsEntries', entries => {
    entries.unshift({name: 'Youtube', logo: 'fab fa-youtube', class: 'entry-nosub', type: 'group', renderer: getYoutubeEntries, entries: []})
    return entries
})

addFilter('sideloadAllow', url => {
    if(getDomain(url).match(new RegExp('((googlevideo|youtube)\.com|youtu\.be)', 'i'))){
        return false
    }
    return url
})

registerDialingAction('yt-live-search', 'fab fa-youtube', (terms) => {
    goYTLiveSearch(terms.toLowerCase())
})

registerDialingAction('yt-videos-search', 'fab fa-youtube', (terms) => {
    goYTVideosSearch(terms.toLowerCase())
})

addAction('appReady', () => {
    registerSearchEngine(ytName + ' - ' + Lang.LIVE, 'yt-live', fetchYTLiveSearchResults, true)
    registerSearchEngine(ytName + ' - ' + Lang.VIDEOS, 'yt-videos', fetchYTVideoSearchResults)
})
