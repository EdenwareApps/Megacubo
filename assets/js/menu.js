
var menuTemplates = {
    'option': '<a href="[url]" role="button" onclick="return false;" class="entry entry-option [class]" title="[name] [label]" aria-label="[name] [label]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[format-label]</span></td></tr></table></a>',
    'disabled': '<a href="[url]" role="button" onclick="return false;" class="entry entry-disabled entry-offline [class]" aria-hidden="true"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[format-label]</span></td></tr></table></a>',
    'input': '<a href="[url]" role="button" onclick="return false;" class="entry entry-input [class]" title="[name] [label]" aria-label="[name] [label]"><table class="entry-search"><tr><td><input type="text" style="background-image: url([logo]);" /></td><td class="entry-logo-c"></td></tr></table></a>', // entry-input-container entry-search-helper
    'check': '<a href="[url]" role="button" onclick="return false;" class="entry entry-option [class]" title="[name] [label]" aria-label="[name] [label]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><i class="fas fa-toggle-off entry-logo-fa" aria-hidden="true"></i></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'stream': '<a href="[url]" role="button" onclick="return false;" class="entry entry-stream [class]" title="[name] [label]" aria-label="[name] [label]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><span class="entry-logo-img-c"><img src="[logo]" onerror="lazyLoad(this, [\'[auto-logo]\', \'[default-logo]\'])" title="[name] - [group]" alt="[name]" /></span></span></td><td><span class="entry-name">[format-name]</span><span class="entry-label">[format-label]</span></td></tr></table></a>',
    'group': '<a href="[url]" role="button" onclick="return false;" class="entry entry-group [class]" title="[name] [label]" aria-label="[name] [label]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><span class="entry-logo-img-c"><img src="[logo]" onerror="lazyLoad(this, [\'[auto-logo]\', \'[default-logo]\'])" title="[name] - [group]" alt="[name]" /></span></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[format-label]</span></td></tr></table></a>', // onerror="nextLogoForGroup(this)" 
    'slider': '<a href="[url]" role="button" onclick="return false;" class="entry entry-slider [class]" title="[name] [label]" aria-label="[name] [label]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label"><input type="range" /></span></td></tr></table></a>'
};

var defaultIcons = {
    'option': 'fa-cog',
    'slider': 'fa-cog',
    'input': 'assets/icons/white/search-dark.png',
    'stream': 'assets/icons/white/default-stream.png',
    'check': 'fa-toggle-off',
    'group': 'assets/icons/white/default-group.png'
};

var loadingToActionDelay = 200; // prevent a loading message from not appearing by applying a delay before start any CPU intensive task
var searchPath = null;

function assumePath(name, path){
    if(typeof(path)=='undefined'){
        path = typeof(Menu.vpath)=='string' ? Menu.vpath : Menu.path;
    }
    if(!name){
		return path;
    }
    if(!path.length){
        return name;
    }
    // path = trimChar(path, '/');
    var n = path.lastIndexOf(name);
    //console.log(n, name, path);
    if(n != -1){
        if(n == 0){
            return name;
        } else if(n >= (path.length - (name.length + 1))){
            return path;
        }
        path = path.substr(n + name.length + 1);
    }
    return path + '/' + name;
}

function updateRootEntry(name, data){
    for(var i=0; i<index.length; i++){
        if(index[i].name == name){
            for(var key in data){
                index[i][key] = data[key];
            }
            if(!Menu.path){
                Menu.refresh()
            }
            break;
        }
    }
}

function getLoadingEntry(txt){
    if(!txt) txt = Lang.LOADING;
    return {
        type: 'option',
        name: txt,
        label: '',
        logo: 'fa-circle-notch fa-spin',
        class: 'entry-loading'
    }
}

function isLoadingEntryRendered(){
    return !!jQuery('.entry-loading').length;
}

function handleEntryInputChecking(element, docheck) {
    element.css('opacity', docheck ? 1 : 0.75).find('svg, i:eq(0)').replaceWith('<i class="fas ' + ( docheck ? 'fa-toggle-on' : 'fa-toggle-off') + ' entry-logo-fa" aria-hidden="true"></i>')
}

function selectedEntry(){
    if(document.activeElement){
        return jQuery(document.activeElement).data('entry-data');
    }
}

function renameSelectedEntry(){
    var element = jQuery(document.activeElement);
    if(element && element.length && element.is('a')){
        var entry = element.data('entry-data');
        if(typeof(entry.rename)=='function'){
            var name = element.find('.entry-name');
            var input = jQuery('<input type="text" class="entry-name" />');
            input.val(name.text());
            name.replaceWith(input);
            input.trigger('focus').trigger('select');
            setTimeout(() => {
                input.trigger('focus').trigger('select').on('blur', function (){
                    var newName = input.val();
                    if(newName && newName != name.text()){
                        name.text(newName);
                        entry.rename(newName, entry)
                    }
                    input.replaceWith(name);
                    element.trigger('focus')
                }).on('keyup', function(e){
                    if(e.keyCode == 13){
                        jQuery(this).trigger("blur");
                    }
                })
            }, 400)
        }
    }
}

function writeIndexPathEntries(path, entries, _index){
    var debug = false, name = String(getRootFolderFromStr(path));
    if(typeof(_index)=='undefined'){
        _index = Menu.index;
    }
    if(debug){
        console.log('SEARCH '+name+' (from '+path+') in...', _index, entries)
    }
    for(var k in _index){
        if(debug){
            console.log(name)
        }
        if(typeof(_index[k]['name'])=='string' && _index[k]['name']==name){
            if(debug){
                console.log('KEY '+k+', '+name+', '+path)
            }
            if(name == path){
                if(debug){
                    console.log('OK '+k+', '+name+', '+path)
                }
                _index[k].entries = entries;
            } else {
                if(debug){
                    console.log('ENTER '+k+', '+name+', '+path, ltrimPathBar(stripRootFolderFromStr(path)), _index[k].entries, _index[k])
                }
                if(!jQuery.isArray(_index[k].entries)){
                    _index[k].entries = [];
                }
                _index[k].entries = writeIndexPathEntries(ltrimPathBar(stripRootFolderFromStr(path)), entries, _index[k].entries)
            }
            break;
        }
    }
    return _index;
}

function readIndexSubEntries(_index, name){
    for(var k in _index){
        if(['string', 'object'].indexOf(typeof(_index[k]['name']))!=-1 && _index[k]['name']==name){
            return _index[k].entries || [];
        }
    }
    return [];
}

function readIndexPath(path){
    var sub = Menu.index;
    if(!path) return Menu.index;
    paths = path.split('/')
    for(var i=0;i<paths.length;i++){
        if(jQuery.isArray(sub)){
            sub = readIndexSubEntries(sub, paths[i]) || [];
        } else {
            sub = sub[paths[i]] || [];
        }
        //console.log(paths[i], sub);
        if(jQuery.isArray(sub)){
            if(!sub.length){
                break;
            }
        } else {
            if(!Object.keys(sub).length){
                break;
            }
        }
    }
    return sub;
}

var effectFadeTime = 100;
function listEnterEffect(callback){
    jQuery('.list > div').animate({marginLeft:'-10%', opacity: 0.01}, effectFadeTime, function (){callback();jQuery(this).css({marginLeft:0,opacity: 1})});
}

function listBackEffect(callback){
    jQuery('.list > div').animate({opacity: 0.01}, effectFadeTime, function (){callback();jQuery(this).css({opacity: 1})});
}

function about(){
    var arch = process.arch == 'ia32' ? 'x86' : 'x64';
    if(currentVersion > installedVersion){
        var txt = gui.App.manifest.window.title+' v'+gui.App.manifest.version+' (< v'+currentVersion+') '+arch+"\n\n";
        txt = applyFilters('about', txt);
        txt = trimChar(txt, "\n") + "\n\n" + Lang.NEW_VERSION_AVAILABLE;
        if(confirm(txt)){
            gui.Shell.openExternal('https://megacubo.tv/online/?version='+gui.App.manifest.version)
        }
    } else {
        var txt = gui.App.manifest.window.title+' v'+gui.App.manifest.version+' '+arch+"\nhttps://megacubo.tv\n\n";
        txt = applyFilters('about', txt);
        txt = trimChar(txt, "\n");
        alert(txt)
    }
}

var sideWidgetEntries = [], searchSuggestions = [];

function getSearchSuggestions(){
    var url = 'http://app.megacubo.net/stats/data/searching.'+getLocale(true)+'.json';
    fetchEntries(url, (suggestions) => {
        var entries = [];
        if(suggestions && suggestions.length){
            searchSuggestions = suggestions;
            sideWidgetEntries = [];
            suggestions.forEach((suggest, i) => {
                suggestions[i].search_term = suggestions[i].search_term.trim();
                if(parentalControlAllow(suggest.search_term)){
                    var t = Lang.SEARCH + ': ' + suggest.search_term, c = ucWords(suggest.search_term), s = encodeURIComponent(c), entry = {name: c, logo: 'http://app.megacubo.net/logos/'+encodeURIComponent(s)+'.png', type: 'stream', label: Lang.MOST_SEARCHED, url: 'mega://play|'+s};
                    entries.push({name: '#'+suggest.search_term, logo: 'fa-search', type: 'option', class: 'entry-suggest', label: Lang.SEARCH, callback: () => {goSearch(suggest.search_term)}})
                    sideWidgetEntries.push(entry);
                    var a = jQuery('<a href="#" title="'+t+'" aria-label="'+t+'">'+suggest.search_term+'</a>&nbsp;');
                    a.data('entry-data', entry).on('mousedown', (event) => {
                        var entry = jQuery(event.currentTarget).data('entry-data');
                        // goSearch(entry.name.toLowerCase())
                        playEntry(entry)
                    }).on('click', (event) => {
                        event.preventDefault()
                    })
                }
            });
            //console.warn('INPUT', basename(Menu.path), basename(searchPath), Menu.path, searchPath, lastSearchTerm, lastSearchTerm.length);
            if(basename(Menu.path) == basename(searchPath) && jQuery('.entry-search input').val().length <= 2){
                jQuery('.entry-suggest').remove();
                Menu.list(entries, searchPath)
            }
        }
    })
}

function getSearchSuggestionsTerms(){
    var s = [];    
    if(searchSuggestions && searchSuggestions.length){
        searchSuggestions.forEach((suggest, i) => {
            s.push(searchSuggestions[i].search_term)
        })
    }
    return s;
}

function renderRemoteSources(name){
    var path = assumePath(name, Menu.path), failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle faclr-red', 'normal');
        Menu.back()
    }
    setTimeout(() => {
        getRemoteSources((entries) => {
            var sources = getSourcesURLs();
            console.log('RENTRIES', entries);
            if(entries.length){
                entries = entries.filter((entry) => {
                    return (sources.indexOf(entry.url) == -1)
                });
                entries = entries.map((entry) => {
                    if(!entry.name){
                        entry.name = getNameFromSourceURL(entry.url)
                    }
                    entry.type = "group";
                    if(!entry.label){
                        entry.label = '';
                    }
                    entry.label = entry.label.format(Lang.USER, Lang.USERS);
                    entry.renderer = (data) => {
                        return loadSource(data.url, data.name)
                    }
                    return entry;
                });
                //index = writeIndexPathEntries(Menu.path, entries);
                //Menu.go(Menu.path);
                Menu.asyncResult(path, entries);
                setTimeout(markActiveSource, 250) // wait rendering
            } else {
                failed()
            }
        })
    }, 150);
    return [getLoadingEntry()];
}

function fetchEntries(url, callback){
    console.log('FETCH', url);
    var key = 'remote-entries-'+url, fbkey = key + '-fb', doFetch = false, data = Store.get(key);
    if(!jQuery.isArray(data)){
        doFetch = true;
        data = Store.get(fbkey) // fallback
        if(!jQuery.isArray(data)){
            data = []
        }
    }
    if(typeof(callback)=='function'){
        if(doFetch){
            jQuery.getJSON(url, (ndata) => {
                if(jQuery.isArray(ndata) && ndata.length){
                    for(var i=0; i<ndata.length; i++){
                        ndata[i].name = fixUTF8(ndata[i].name)
                    }
                    Store.set(key, ndata, 60);
                    Store.set(fbkey, ndata, 30 * (24 * 3600)); // fallback
                    callback(ndata)
                } else {
                    callback(data)
                }
            }).fail(function (jqXHR, textStatus, errorThrown) {
                console.warn('XMLHTTP failed', url, jqXHR, textStatus, errorThrown);
                callback(data)
            })
        } else {
            callback(data)
        }
    }
    return data;
}

function fetchAndRenderEntries(url, name, filter, callback){
    var path = assumePath(name);
    var fetchPath = path;
    console.log('FETCH', url, name, path, fetchPath, Menu.path, Menu.vpath);
    setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
        fetchEntries(url, (options) => {
            console.log('FETCH 2', Menu.path, name, fetchPath, path);
            if(options.length){
                console.log(options);
                if(typeof(filter)=='function'){
                    options = options.map(filter)
                }
                console.log(options, name, path);
                if(typeof(callback)=='function'){
                    var hr = callback(options);
                    if(jQuery.isArray(hr)){
                        options = hr;
                    }
                }
                Menu.asyncResult(fetchPath, options);
            } else {
                notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle faclr-red', 'normal');
                Menu.asyncResult(fetchPath, -1);
            }
        })
    }, loadingToActionDelay);
    return [getLoadingEntry()];
}

function fetchAndRenderWatchingEntries(name, filter, callback){
    //Menu.path = '/'+Lang.SEARCH;
    var path = assumePath(name);
    console.log('FETCH WATCHING', name, path);
    setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
        getWatchingData((options) => {
            if(options.length){
                console.log(options);
                if(typeof(filter)=='function'){
                    options = options.map(filter)
                }
                if(options.length && options[0].label.indexOf('ordm')==-1){
                    options.forEach((entry, i) => {
                        options[i].label = (i + 1)+'&ordm; &middot; '+options[i].label;
                        if(!options[i].logo){
                            options[i].logo = 'http://app.megacubo.net/logos/'+encodeURIComponent(options[i].name)+'.png';
                        }
                    })
                }
                console.log(options, name, path);
                Menu.asyncResult(path, options.slice(0, 48));
                if(typeof(callback)=='function'){
                    callback(options)
                }
            } else {
                notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle faclr-red', 'normal');
                Menu.asyncResult(path, -1);
            }
        })
    }, loadingToActionDelay);
    return [getLoadingEntry()];
}

function backEntry(label){
    var back = {
        name: Lang.BACK,
        type: 'option',
        class: 'entry-back entry-search-helper',
        logo: 'fa-chevron-left',
        callback: Menu.back
    };
    if(label){
        back.label = '<i class="fas fa-map-marker-alt"></i>&nbsp; '+label;
    }
    if(Config.get('hide-back-button')){
        back.class += ' entry-hide';
    }
    return back;
}

function backEntryRender(container, backPath, label){
    // console.warn('#####################################', backPath, traceback());
    Menu.container(true) // reset always for back button
    var back = backEntry(label);
    Menu.render([back], 1)
}

function getTabIndexOffset(){
    var container = Menu.container(false);
    var as = container.find('a');
    return as.length + 1;
}

function isStreamEntry(data){
    if(typeof(data.type)=='undefined' || !data.type){
        if(typeof(data.url)=='string' && data.url.match('(//|magnet:)')){
            data.type = 'stream';
        }
    }
    return (data.type == 'stream');
}

function setEntryFlag(el, flag, unique){
    if(unique){
        jQuery('.entry-status > span').html('')
    }
    if(flag){
        flag = '<i class="fa '+flag+'" aria-hidden="true"></i>';
    } else {
        flag = '';
    }
    jQuery(el).find('.entry-status > span').html(flag);
}

function findEntries(term){
    var fas;
    if(top){
        fas = jQuery('.entry'), term = decodeEntities(term).toLowerCase();
        fas = fas.filter(function (){
            var stub = jQuery(this).attr('href').toLowerCase();
            var h = decodeEntities(stub);
            if(h.indexOf(term) == -1){
                //console.log(stub, term);
                return false;
            }
            return true;
        });
    } else {
        fas = jQuery([]);
    }
    return fas;
}

function findEntriesByName(term, _strict){
    var fas;
    if(top){
        fas = jQuery('.entry');
        fas = fas.filter(function (){
            var h = decodeEntities(jQuery(this).find('.entry-name').html());
            if(_strict ? (h != term) : (h.indexOf(term) == -1)){
                //console.log(stub, term);
                return false;
            }
            return true;
        });
    } else {
        fas = jQuery([]);
    }
    return fas;
}

function findActiveEntries(term){
    var fas = jQuery('.entry-status i.fa'), term = decodeEntities(term);
    fas = fas.map(function (){
        return jQuery(this).parents('.entry').get(0);
    });
    fas = fas.filter(function (){
        var h = decodeEntities(this.outerHTML);
        if(h.indexOf(term) == -1){
            return false;
        }
        return true;
    });
    return fas;
}

function removeLoadingFlags(){
    var fa = 'fa-circle-notch', entries = findActiveEntries(fa);
    for(var i=0;i<entries.length;i++){
        console.log('pSET-'+i);
        setEntryFlag(entries[i], '');
    }
}

function markActiveSource(){
    var source = getActiveSource();
    if(source){
        var fa = 'fa-check-square', entries = findActiveEntries(fa);
        for(var i=0;i<entries.length;i++){
            console.log('pSET-'+i);
            setEntryFlag(entries[i], '');
        }
        var entries = findEntries(source);
        if(entries.length){
            console.log('SET-'+i);
            setEntryFlag(entries[0], fa, true)
        }
    }
}

var languageLabelMask = "LANG: {0}";

function markActiveLocale(){
    var locale = languageLabelMask.format(getLocale(false, true).toUpperCase());
    var slocale = languageLabelMask.format(getLocale(true, true).toUpperCase());
    var fa = 'fa-check-square', entries = findActiveEntries(fa);
    for(var i=0;i<entries.length;i++){
        console.log('pSET-'+i);
        setEntryFlag(entries[i], '');
    }
    var entries = findEntriesByName(locale).add(findEntriesByName(slocale));
    for(var i=0;i<entries.length;i++){
        console.log('SET-'+i);
        setEntryFlag(entries[i], fa);
        break;
    }
}

var searchKeypressTimer = 0, searchResultsLimit = 128, lastSearchTerm = Store.get('last-search-term');

function setupSearch(term, type, name){
    Menu.path = assumePath(name);
    var container = Menu.container(true);
    backEntryRender(container, dirname(Menu.path), name);
    if(term){
        lastSearchTerm = term;
    } else {
        if(PlaybackManager.activeIntent){
            var url = PlaybackManager.activeIntent.entry.originalUrl;
            if(isMega(url)){
                var data = parseMegaURL(url);
                if(data && data.type=='play'){
                    term = data.name;
                    lastSearchTerm = term;
                }
            }
        }
    }
    var entry = {
        type: 'input',
        name: Lang.SEARCH,
        change: (entry, element, val) => {
            var np = container.find('a.entry-input');
            clearTimeout(searchKeypressTimer);
            container.find('a.entry-stream, a.entry-loading, a.entry-autoclean').remove();
            if(val){
                lastSearchTerm = val;
                Store.set('last-search-term', val);
                Menu.list([getLoadingEntry()], Menu.path)
            } else {
                Menu.list([], Menu.path); // just to update the body class
            }
            focusEntryItem(np);
            np.find('input').get(0).focus();
            var callback = (r) => {
                //console.log('QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ!!');
                container.find('a.entry-stream, a.entry-loading, a.entry-autoclean, a.entry-group, a.entry-suggest, a.entry-option:not(.entry-back)').remove();
                console.log('QQQ', r, val, type, Menu.path);
                if(type == 'live'){
                    r = r.filter((entry) => {
                        return entry.mediaType == 'live';
                    }).concat(r.filter((entry) => {
                        return entry.mediaType != 'live';
                    }))
                }
                Menu.list(r, Menu.path);
                focusEntryItem(np);
                np.find('input').get(0).focus();
            }
            searchKeypressTimer = setTimeout(() => {
                clearTimeout(searchKeypressTimer);
                var parentalControlAllowed = parentalControlAllow(val, true);
                if(showAdultContent || parentalControlAllowed){
                    var r;
                    switch(type){
                        case "live":
                            if(val.length){
                                fetchSharedListsSearchResults(callback, null, val, true);
                            }
                           break;
                        case "magnet":
                            if(val.length){
                                fetchMagnetSearchResults(callback);
                            }
                            break;
                        case "video":
                            if(val.length){
                                fetchVideoSearchResults(callback);
                            }
                            break;
                        case "prn":
                            fetchPRNSearchResults(callback);
                            break;
                    }
                } else {
                    callback([])
                }
                //console.warn('INPUT2', val, np.find('input').val());
                if(val.length > 2){
                    sendStats('search', {query: val, type: type})
                } else {
                    getSearchSuggestions()
                }
            }, 600);
        },
        value: term,
        placeholder: Lang.SEARCH_PLACEHOLDER
    };   
    Menu.render([entry]);
    jQuery('a.entry input').trigger('focus').trigger('input');
}

function fetchSearchResults(){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    var r = [];
    if(q.length > 1){
        for(var list in channelsIndex){
            for(var url in channelsIndex[list]){
                if(r.length >= 20) break;
                if(channelsIndex[list][url].name.toLowerCase().indexOf(q)!=-1){
                    r.push(channelsIndex[list][url]);
                }
            }
        }
    }
    return r;
}

function fetchVideoSearchResults(_cb, terms){
    if(typeof(terms)!='string'){
        terms = jQuery('.list > div > div').find('input').val().toLowerCase()
    }
    if(terms.length > 1){
        fetchSharedListsSearchResults((nentries) => {
            _cb(nentries)
        }, 'video')
    } else {
        _cb([])
    }
}

var btdb = false;
function fetchMagnetSearchResults(cb){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    if(q.length > 1){
        setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
            if(!btdb){
                btdb = require('btdb-search')
            }
            btdb.search(q+' mp4 aac').then(function (data) {
                data = data.sort((a, b) => {return (parseInt(a.popularity) < parseInt(b.popularity)) ? 1 : ((parseInt(b.popularity) < parseInt(a.popularity)) ? -1 : 0)}).slice(0);
                var entries = [];
                for(var i=0; i<data.length; i++){
                    entries.push({
                        type: 'stream',
                        url: data[i].magnet,
                        name: data[i].name,
                        logo: 'fa-magnet',
                        label: data[i].size+' &middot; Pop: '+data[i].popularity
                    })
                }
                cb(entries);
            })
        }, loadingToActionDelay);
    }
}

var pnsr = false, formatPRNURL = (url) => {
    return 'https://pt.pornhub.com/embed/'+url.split('=')[1];
}

function fetchPRNSearchResults(cb){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    if(!pnsr){
        pnsr = require('pornsearch').default;
    }
    var callback = (videos) => {
        console.log('PN', videos);
        if(jQuery.isArray(videos)){
            var entries = [];
            for(var i=0; i<videos.length; i++){
                //console.log(search_results.items[i]);
                entries.push({
                    type: 'stream',
                    url: formatPRNURL(videos[i].url),
                    name: videos[i].title + ' | XXX',
                    logo: videos[i].thumb,
                    label: videos[i].duration
                })
            }
            cb(entries)
        }
    };
    var Searcher = new pnsr(q);
    Searcher.videos().then(callback).catch(() => {
        callback([])
    })
}

var sharedLists = [], sharedListsSearchWordsIndex = {};

function fetchSharedLists(callback){
    if(sharedLists.length){
        callback(sharedLists)
    } else {
        if(Config.get('search-other-users-lists')){
            var url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json';
            fetchEntries(url, (entries) => {
                sharedLists = jQuery.unique(entries.map((entry) => { return entry.url; }).concat(callback));
                callback(sharedLists)
            })
        } else {
            callback(getSourcesURLs())
        }
    }
}

var buildenSharedListsSearchIndex = -1;

function buildSharedListsSearchIndex(callback){
    if(buildenSharedListsSearchIndex === -1){
        buildenSharedListsSearchIndex = 0;
        fetchSharedLists((urls) => {
            var listsCountLimit = Config.get('search-range');
            if(typeof(listsCountLimit)!='number' || listsCountLimit < 5){
                listsCountLimit = 18; // default
            }
            if(urls.length > listsCountLimit){
                urls = urls.slice(0, listsCountLimit)
            }
            var iterator = 0, completeIterator = 0, tasks = Array(urls.length).fill((asyncCallback) => {
                var done = false, url = urls[iterator];
                iterator++;
                if(!buildenSharedListsSearchIndex && iterator >= 8){
                    buildenSharedListsSearchIndex = true;
                    jQuery(window).trigger('search-index-ready')
                }
                ListMan.parse(url, (entries) => {
                    var b, s = [], sep = ' _|_ ';
                    for(var i=0; i<entries.length; i++){
                        b = (entries[i].name + ' ' + entries[i].group);
                        if(b.indexOf(sep) != -1){
                            b = b.replaceAll(sep, '')
                        }
                        s.push(b)
                    }
                    s = s.join(sep).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(sep);
                    for(var i=0; i<entries.length; i++){
                        //console.log('entry', entries[i]);
                        entries[i].mediaType = -1;
                        entries[i].source = url;
                        s[i].split(' ').forEach((t) => {
                            if(t.length > 1){
                                if(typeof(sharedListsSearchWordsIndex[t])=='undefined'){
                                    sharedListsSearchWordsIndex[t] = {items: [entries[i]]};
                                } else {
                                    sharedListsSearchWordsIndex[t].items.push(entries[i])
                                }
                            }
                        })
                    }
                    completeIterator++;
                    if(!done){
                        done = true;
                        asyncCallback()
                    }
                }, 7.5, true)            
            });
            if(typeof(async) == 'undefined'){
                async = require('async')
            }
            async.parallelLimit(tasks, 20, (err, results) => {
                if(!buildenSharedListsSearchIndex){
                    buildenSharedListsSearchIndex = true;
                    jQuery(window).trigger('search-index-ready')
                }
            })
        })
    } else if(callback) {
        jQuery(window).off('search-index-ready', callback).on('search-index-ready', callback)
    }
}

buildSharedListsSearchIndex();

function getStreamBasicType(entry){
    var b = entry.name+' '+entry.group;
    return isRadio(b) ? 'radio' : ((entry.url.indexOf('mp4') != -1 || entry.url.indexOf('youtube.com') != -1) ? 'video' : 'live');
}

var sharedListsSearchCaching = false;
function fetchSharedListsSearchResults(cb, type, term, matchAll){
    if(buildenSharedListsSearchIndex === true){
        var r = [], limit = 96;
        if(!term){
            var c = jQuery('.list > div > div input');
            if(c.length){
                term = c.val().toLowerCase()
            } else {
                term = ''
            }
        }
        if(term && term.length > 2){
            if(sharedListsSearchCaching && sharedListsSearchCaching.query == term && sharedListsSearchCaching.type == type){
                r = sharedListsSearchCaching.entries;
            } else {
                var blacklist = ['tv'], searchType = (type == 'video') ? 'video' : (isRadio(term) ? 'radio' : 'live'), maybe = [], already = {}, 
                terms = term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(' ').filter((kw) => {
                    return kw.length >= 2 && blacklist.indexOf(kw) == -1;
                });
                if(terms.length >= 1){
                    var resultHitMap = {}, resultEntryMap = {};
                    terms.forEach((_term) => {
                        var already = {}, _terms = [];
                        if(typeof(sharedListsSearchWordsIndex[_term]) != 'undefined'){
                            _terms.push(_term)
                        }
                        var l = _term.length, f = _term.charAt(0);
                        for(var k in sharedListsSearchWordsIndex){
                            if(k.length > l && k.charAt(0) == f && k.substr(0, l) == _term){
                                _terms.push(k)
                            }
                        }
                        _terms.forEach((t) => {
                            if(typeof(sharedListsSearchWordsIndex[t]) != 'undefined'){
                                sharedListsSearchWordsIndex[t].items.forEach((entry, i) => {
                                    if(entry.mediaType == -1){
                                        sharedListsSearchWordsIndex[t].items[i].mediaType = getStreamBasicType(entry);
                                    }
                                    if(entry.mediaType == searchType && typeof(already[entry.url])=='undefined'){
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
                    var max = Math.max.apply(null, Object.values(resultHitMap));
                    console.warn("GOLD", resultEntryMap, resultHitMap, terms);
                    Object.keys(resultHitMap).sort((a, b) => {return resultHitMap[b] - resultHitMap[a]}).forEach((url) => {
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
                    console.warn("GOLD", r, maybe);
                    if(r.length < limit && !matchAll){
                        r = r.concat(maybe.slice(0, limit - r.length))
                    }
                    sharedListsSearchCaching = {type: type, query: term, entries: r};                    
                }
            }
        }
        if(typeof(cb)=='function'){
            cb(r)
        }
        return r;
    } else {
        //console.log('SSSS');
        buildSharedListsSearchIndex(() => {
            jQuery('.entry-loading').remove();
            jQuery('.list input').trigger('input')
        });
        jQuery('.entry-loading').remove();
        return [getLoadingEntry(Lang.GENERATING_INDEX+'...')];
    }
}

function lettersToRange(a, b){
    if(a == b) return a;
    return a+'-'+b;
}

var Menu = (() => {
    var self = {};
    self.debug = true;
    self.path = '';
    self.vpath = false;
    self.lastListScrollTop = 0;
    self.subMenuSizeLimit = 6;
    self._container = false;
    self._containerParent = false;
    self.debugMenuFocus = true;
    self.currentPlayState = false;
    self.currentRecordingState = false;
    self.asyncResults = {};
    self.scrollTopCache = {};
    self.triggeringCache = {};
    self.asyncResult = (path, entries) => {
        if(typeof(entries)=='undefined'){
            return (typeof(self.asyncResults[path])=='undefined' ? false : self.asyncResults[path])
        }
        //console.log('ASYNCRESULT', entries, path);
        self.asyncResults[path] = entries;
        if(path == self.path){
            var container = self.container(true);
            backEntryRender(container, dirname(path), basename(path));
            if(jQuery.isArray(entries)){
                self.list(entries, path)
            } else if(entries === -1) {
                self.back()
            }
        }
    }
    self.containerParent = (reset) => {
        if(!self._containerParent){
            self._containerParent = jQuery('#controls div.list')
        }
        return self._containerParent;
    }
    self.container = (reset) => {
        if(!self._container){
            self._container = self.containerParent().find('div > div').eq(0)
        }
        if(reset){
            self.containerParent().prop('scrollTop', 0);
            self._container.html('');
            lastTabIndex = 1;
        }
        return self._container;
    }
    self.refresh = (ifmatch) => {
        if(typeof(ifmatch) != 'string' || self.path.indexOf(ifmatch) != -1){
            var lst = self.containerParent(), top = lst.prop('scrollTop'), inSearch = (self.path.indexOf(Lang.SEARCH) != -1);
            if(inSearch){
                self.containerParent().find('input').trigger('input');
            } else {
                self.saveScroll();
                var s = self.path;
                console.warn('no triggerer', s);
                if(s){
                    self.back()
                } else {
                    self.path = '-';                    
                }
                self.go(s);
                self.restoreScroll()
            }
        }
    }
    self.triggerer = (path, entry) => {
        if(entry){
            self.triggeringCache[path] = entry;
        }
        return self.triggeringCache[path] || false;
    }
    self.trigger = (data, element) => {
        console.log('TRIGGER', data, element, traceback());
        if(data.type == 'input' || (typeof(data.class)=='string' && data.class.indexOf('entry-disabled')!=-1)){
            return;
        }
        if(data.type == 'group'){ // prior to dealing with the back entry
            self.lastListScrollTop = jQuery('.list').scrollTop()
        }
        if(data.type == 'back'){
            console.log(data.path);
            if(typeof(data.back)=='function'){
                var entry = data;
                setTimeout(function (){
                    entry.back(entry, this)
                }, loadingToActionDelay)
            }
            var newPath = dirname(self.path);
            console.log('BACK', newPath);
            var triggerer = self.triggerer(newPath);
            self.go(newPath);
            setTimeout(() => { // without this delay the callback was being triggered too quick.
                // console.warn('BACK TRIGGER', triggerer, self.path, newPath);
                if(self.path == newPath && triggerer && typeof(triggerer.callback)=='function'){
                    triggerer.callback();
                }
                if(self.lastListScrollTop && !jQuery('.list').scrollTop()){
                    jQuery('.list').scrollTop(self.lastListScrollTop)
                }
            }, loadingToActionDelay);
            return true;
        }
        self.saveScroll();  
        if(typeof(data.path)=='undefined'){
            data.path = '';
        }
        var entries = null, listDirectly = false, npath = assumePath(data.name, data.path);
        if(jQuery.isArray(data.entries)){
            listDirectly = true;
            entries = data.entries;
        }
        if(typeof(data.renderer)=='function'){
            entries = data.renderer(data, element);
            if(entries === -1){
                return;
            } else if(!jQuery.isArray(entries)){
                console.log('!! RENDERER DIDNT RETURNED A ARRAY', entries, data.path);
            }
        }
        console.log('TRIGGER DATA', npath, data, data.path, entries);
        if(data.type == 'group'){
            entries = applyFilters('internalFilterEntries', entries, npath);
            self.triggerer(npath, data);
            console.log('TRIGGER DATA 2', entries);
            if(jQuery.isArray(entries)){
                var ok = false;
                //console.error('XXXXXXXX', entries, data, self.path && entries.length <= self.subMenuSizeLimit);
                if(entries.length <= self.subMenuSizeLimit && (!data.class || data.class.indexOf('nosub') == -1)){
                    //console.error('XXXXXXXX', entries, data);
                    if(!element){
                        var es = self.queryElements(self.entries(false, false), {name: data.name, type: data.type});
                        if(es.length){
                            element = es.get(0)
                        }
                    }
                    if(element){
                        var issub = element.className && element.className.indexOf('entry-sub') != -1;
                        var issubsub = element.className && element.className.indexOf('entry-sub-sub') != -1;
                    } else {
                        var issub = issubsub = false;
                    }
                    var insub = false, insubsub = false, offset = -1;
                    self.entries(false, false).show().each((i, entry) => {
                        if(offset == -1 && entry.className && entry.className.indexOf('entry-sub') != -1){
                            insub = true;
                            offset = i;
                            if(entry.className.indexOf('entry-sub-sub') != -1){
                                insubsub = true;
                            }
                        }
                    });
                    if(offset == -1){
                        self.entries(true, false).every((entry, i) => {
                            if(entry.class && entry.class.indexOf('entry-loading') != -1){
                                //offset = -1;
                                //return false;
                            }
                            if(entry.name == data.name){
                                offset = i;
                            }
                            return offset == -1;
                        })
                    }
                    //console.warn('UUUUUUUUU', entries.length, data, offset, insub, insubsub, issub, issubsub);
                    //console.error('XXXXXXXX', entries, data, offset, insub, insubsub);
                    if(offset != -1 && !insubsub){
                        ok = true;
                        jQuery('body').addClass('submenu');
                        var pas = self.container().find('a.entry');
                        pas.filter('.entry-sub').remove();
                        var nentries = entries.slice(0);
                        nentries.unshift(backEntry(data.name)); // do not alter entries
                        self.list(nentries, npath, offset ? offset - 1 : 0);
                        var rv = self.container().find('a.entry').not(pas);
                        //console.warn('RV', rv, offset);
                        rv.each((i, e) => {
                            //console.warn('PPPPPPPP', e, i);
                            if(!e.className) {
                                e.className = '';
                            }
                            e.className += ' entry-sub';
                            if(issub){
                                e.className += ' entry-sub-sub';
                            }
                            if(i == 0){
                                e.className += ' entry-sub-first';
                            } else if(i == (rv.length - 1)){
                                e.className += ' entry-sub-last';
                            }
                            return e;
                        });
                        self.restoreScroll()
                    }
                }
                if(!ok){
                    backEntryRender(self.container(true), dirname(npath), data.name);
                    //self.path = ltrimPathBar(npath);
                    if(jQuery.isArray(entries)){
                        self.list(entries, npath)
                    }
                }
            }
        }
        var t = typeof(data.callback);
        console.log('CALLBACK', t, data);
        if(t == 'function'){
            setTimeout(function (){
                data.callback(data, element)
            }, 150)
        } else if(isStreamEntry(data)) {
            console.log('PLAY', data);
            playEntry(data)
        }
    }
    self.adjustBodyClass = (inHome) => {
        if(inHome){
            jQuery('body').addClass('home')
        } else {
            jQuery('body').removeClass('home')
        }
    }
    self.entries = (getData, visibleOnly) => {
        var e = self.container().find('a.entry'+(visibleOnly?':visible':''));
        return getData ? e.toArray().map((e) => {
            return jQuery(e).data('entry-data')
        }) : e;
    }
    self.list = (entries, path, at) => {
        if(!entries){
            entries = self.index;
        }
        self.saveScroll();
        var lst = self.containerParent();
        //console.log('Menu.list OFFSET', at);
        //console.log('Menu.list PREFILTER', entries, path, traceback());
        var container = self.container(false);
        var tabIndexOffset = getTabIndexOffset();
        entries = applyFilters('filterEntries', entries, path);
        //console.log('Menu.list POSFILTER', entries, path, traceback());
        for(var i=0; i<entries.length; i++){
            entries[i].path = path;
        }
        self.path = path;
        self.render(entries, tabIndexOffset, at);
        //console.log('Menu.list', container.html().substr(0, 36));
        if(typeof(at)=='number'){
            jQuery('body').addClass('submenu')
        } else {
            updateStreamEntriesFlags();
            jQuery('body').removeClass('submenu')
        }
        var lps = 7;
        lst.find('.marquee:not(.marquee-adjusted)').each((i, e) => {
            jQuery(e).addClass('marquee-adjusted').find('*:eq(0)').css('animation-duration', parseInt(e.innerText.length / lps)+'s')
        });
        focusEntryItem(lst.find('a.entry:not(.entry-back):eq(0)'), true);
        return entries;
    }
    self.render = (entries, tabIndexOffset, at) => { // render entries
        //console.log(entry);
        if(typeof(at) != 'number' || at < 0){
            at = false;
        }
        if(typeof(tabIndexOffset)!='number'){
            tabIndexOffset = getTabIndexOffset()
        }
        var allEvents = [], allHTML = '';
        entries.forEach((entry, i) => {
            if(entry == null || typeof(entry)!='object'){
                console.log('BAD BAD ENTRY', entry, typeof(entry));
                return;
            }
            if(!entry.type){
                if(!entry.url || entry.url.substr(0, 10)=='javascript'){
                    entry.type = 'option';
                } else {
                    entry.type = 'stream';
                }
            }
            if(entry.offline === true){
                entry.class = (entry.class || '') + ' entry-offline';
            } else {
                if(entry.class && entry.class.indexOf('entry-offline')!=-1){
                    entry.class = entry.class.replace('entry-offline', '')
                }
            }
            //console.log('WWWWWWWWWWWWW', entry);
            var autoLogo = 'http://app.megacubo.net/logos/'+encodeURIComponent(entry.name)+'.png', logo = entry.logo || (entry.type=='stream'?autoLogo:false) || defaultIcons[entry.type];
            var originalLogo = entry.originalLogo || entry.logo || defaultIcons[entry.type];
            if(typeof(menuTemplates[entry.type])=='undefined'){
                console.log('BAD BAD ENTRY', entry);
                return;
            }
            var html = menuTemplates[entry.type], atts = {};
            html = html.replace('<a ', '<a tabindex="'+tabIndexOffset+'" ').replace('<input ', '<input tabindex="'+tabIndexOffset+'" ');
            html = html.replaceAll('[name]', displayPrepareName(entry.name, entry.prependName || '', entry.appendName || ''));
            if(html.indexOf('[format-name]')!=-1){
                var minLengthToMarquee = 36, n = entry.rawname ? parseM3U8NameTags(entry.rawname) : entry.name;
                if(entry.name.length >= minLengthToMarquee){
                    n = '<span>'+n+'</span>';
                    html = html.replace('entry-name', 'entry-name marquee')
                }
                html = html.replaceAll('[format-name]', displayPrepareName(n, entry.prependName || '', entry.appendName || ''));
            }
            var logoColor = typeof(entry.logoColor) == 'undefined' ? '' : 'color: '+entry.logoColor+';';
            if(logo.substr(0, 3)=="fa-"){
                html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="fas '+logo+' entry-logo-fa" style="'+logoColor+'" aria-hidden="true"></i>')
            } else if(logo.indexOf(" fa-")!=-1){
                html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="'+logo+' entry-logo-fa" style="'+logoColor+'" aria-hidden="true"></i>')
            } else {
                html = html.replaceAll('[logo]', logo);
                html = html.replaceAll('[auto-logo]', autoLogo);
                html = html.replaceAll('[default-logo]', defaultIcons[entry.type])
            }
            html = html.replaceAll('[group]', entry.group || '');
            html = html.replaceAll('[label]', (entry.label || entry.group || '').replace(new RegExp(' *<\\/?[^>]+> *', 'g'), ' ').replaceAll('"', '&amp;quot;'));
            html = html.replaceAll('[format-label]', (entry.label || entry.group || ''));
            html = html.replaceAll('[class]', entry.class || '');
            html = html.replaceAll('[url]', entry.url || entry.originalUrl || ' ');
            // console.log('#####################', html, entry);
            allHTML += html;
            atts.data = entry;
            if(entry.type != 'disabled'){
                atts.mousedown = (event) => {
                    var me = jQuery(event.currentTarget);
                    var data = me.data('entry-data');
                    if(data.type == 'check') {
                        var checked = typeof(data.checked)!='undefined' && data.checked();
                        checked = !checked;
                        var checkCallback = data.check || false;
                        handleEntryInputChecking(me, checked);
                        if(typeof(data.check)=='function') data.check(checked)
                        //console.warn('OK?', data, checked, data.check);
                    } else {
                        self.trigger(data, event.currentTarget)
                    }
                }
                if(entry.type == 'check') {
                    atts.checked = typeof(entry.checked)!='undefined' && entry.checked()
                }
            }
            var actions = ['delete', 'rename'];
            for(var i=0;i<actions.length;i++){
                if(entry[actions[i]]){
                    atts[actions[i]] = (event) => {
                        entry[event.type](entry, event.currentTarget);
                    }
                }
            }
            if(['input', 'slider'].indexOf(entry.type) != -1){
                if(entry['change']){
                    atts.input = (event) => {
                        jQuery('body').trigger('wake');
                        entry['change'](entry, event.currentTarget, event.currentTarget.getElementsByTagName('input')[0].value);
                    }
                }
                if(typeof(entry['value'])!='undefined'){
                    atts.value = entry['value'];
                }
                if(entry['placeholder']){
                    atts.placeholder = entry['placeholder'];
                }
                atts.focus = (event) => {
                    event.currentTarget.querySelector('input').focus()
                }
            }
            atts.mouseenter = atts.mouseover = (event) => {
                if(!isWheeling){
                    clearTimeout(listEntryFocusOnMouseEnterTimer);
                    var e = event.currentTarget;
                    listEntryFocusOnMouseEnterTimer = setTimeout(() => {
                        focusEntryItem(jQuery(e), true)
                    }, 200)
                }
            }
            atts.mouseleave = (event) => {
                clearTimeout(listEntryFocusOnMouseEnterTimer)
            }
            allEvents.push(atts);
            tabIndexOffset++;
        });
        var ri = allEvents.length, rv = null;
        if(typeof(at)=='number'){
            //console.warn('AAAAAAAAAAAAA', at);
            self.saveScroll();
            stylizer(' a.entry:not(.entry-sub) { opacity: 0.1 !important; pointer-events: none; } ', 'entry-sub-css', window);
            var as = self.container().find('a.entry');
            as.filter('.entry-sub').remove();
            as.show().slice(at, at + allEvents.length).hide();
            as.eq(at).after(allHTML);
            rv = self.container().find('a.entry').not(as).reverse();
            self.adjustBodyClass(false)
        } else {
            //console.warn('BBBBBBBBBBBBB', at);
            stylizer(' ', 'entry-sub-css', window);
            self.container().append(allHTML);
            rv = self.container().find('a').reverse();
            self.adjustBodyClass(!self.path)
        }
        //console.log('ERV', rv, rv.length, at);
        rv.each((i, element) => {
            ri--;
            if(ri >= 0){
                for(var key in allEvents[ri]){
                    switch(key){
                        case 'data': 
                            jQuery(element).data('entry-data', allEvents[ri][key]);
                            break;
                        case 'change': 
                            jQuery(element).find('input').on('input', () => {
                                var data = jQuery(this).data('entry-data');
                                jQuery('body').trigger('wake');
                                allEvents[ri][key](data, this, this.value);
                            });
                            break;
                        case 'placeholder': 
                            jQuery(element).find('input').prop('placeholder', allEvents[ri][key]);
                            break;
                        case 'value': 
                            jQuery(element).find('input').val(allEvents[ri][key]);
                            break;
                        case 'checked': 
                            handleEntryInputChecking(jQuery(element), allEvents[ri][key]);
                            break;
                        default: 
                            jQuery(element).on(key, allEvents[ri][key]);
                            break;
                    }
                }
            }
        })
    }
    self.saveScroll = () => {
        var c = self.container(), p = self.containerParent(), h = c.height();
        c.css({height: h + 'px'});
        p.css({opacity: 0.75});
        var l = p.scrollTop();
        if(l){
            self.scrollTopCache[self.path] = l;
        }
    }
    self.restoreScroll = () => {
        var c = self.container();
        if(!Menu.path){
            c.css('height', 'auto');
            return;
        }
        setTimeout(() => {
            var p = self.containerParent(), t = 0;
            if(typeof(self.scrollTopCache[self.path])!='undefined'){
                t = self.scrollTopCache[self.path];
            }
            c.css('height', 'auto');
            var rv = c.find('.entry-sub');
            if(rv.length) {
                var sl = rv.last();
                var ct = p.scrollTop();
                var ch = p.height();
                var tp = sl.prop('offsetTop') + sl.height() - ch + 18;
                focusEntryItem(rv.eq(1), true);
                if(t < tp){
                    t = tp;
                }
            }
            p.animate({opacity: 1}, 250).scrollTop(t)
            setTimeout(() => {
                p.scrollTop(t)
            }, 600)
        }, 200)
    }
    self.getFocus = () => {
        var f = jQuery('.entry-focused');
        if(!f.length || (f.hasClass('entry') && !f.is(':in-viewport'))){
            f = jQuery('a.entry:in-viewport').eq(scrollDirection == 'up' ? 0 : -1);
        }
        return f;
    }
    self.focusPrevious = () => {
        var insub = jQuery('.entry-sub').length, aq = 'a.entry';
        if(insub) aq += '.entry-sub';
        var e = self.getFocus(), p = e.prevAll(aq+':visible, button.nw-cf-btn:visible, a.option:visible').eq(0);
        if(self.debugMenuFocus){
            console.log('Menu.focusPrevious', e, p)
        }
        if(!p.length){
            if(e.attr('id') == 'controls-toggle'){
                p = jQuery('a.option:visible:eq(-1)')
            } else if(e.hasClass('entry')) {
                p = jQuery('.nw-cf-btn:eq(-1)')
            } else if(!insub && e.hasClass('option')) {
                p = jQuery(aq+':visible:eq(-1)')
            } else {
                p = jQuery('#controls-toggle')
            }      
            if(self.debugMenuFocus){
                console.log('Menu.focusPrevious', e, p)
            }
            if(!p.length){
                p = jQuery(aq+':not(.entry-back):visible:eq(-1)');
                if(self.debugMenuFocus){
                    console.log('Menu.focusPrevious', e, p)
                }
            }
        }
        focusEntryItem(p)
    }
    self.focusNext = () => {
        var insub = jQuery('.entry-sub').length, aq = 'a.entry';
        if(insub) aq += '.entry-sub';
        var e = self.getFocus(), nxt = e.nextAll(aq+':visible, button.nw-cf-btn:visible, a.option:visible').eq(0);
        if(self.debugMenuFocus){
            console.log('Menu.focusNext', e, nxt)
        }
        if(!nxt.length){
            if(e.attr('id') == 'controls-toggle'){
                nxt = jQuery('.nw-cf-btn:eq(0)')
            } else  if(e.hasClass('entry')){
                nxt = jQuery(insub ? '#controls-toggle' : 'a.option:visible:eq(0)')
            } else  if(e.hasClass('option')){
                nxt = jQuery('#controls-toggle')
            } else {
                nxt = jQuery(aq+':visible:eq(0)')
            }
            if(self.debugMenuFocus){
                console.log('Menu.focusNext', e, nxt)
            }
            if(!nxt.length){
                nxt = jQuery(aq+':not(.entry-back):visible:eq(0)');
                if(self.debugMenuFocus){
                    console.log('Menu.focusNext', e, nxt)
                }
            }
        }
        focusEntryItem(nxt)
    }
    self.triggerKey = (type) => {
        jQuery(document.activeElement).trigger(type);
    }
    self.back = () => {   
        self.vpath = false;
        jQuery('body').removeClass('submenu'); 
        var subs = self.container().find('a.entry-sub');
        if(subs.length){  
            var subsub = subs.filter('a.entry-sub-sub');
            self.path = dirname(self.path);
            self.adjustBodyClass(!self.path);
            var r = self.container().find('a.entry:not(:visible)').eq(1);
            if(!r.length){
                r = self.container().find('a.entry:not(.entry-back)').eq(0)
            }
            subs.remove();
            self.container().find('a.entry').show();
            stylizer(' ', 'entry-sub-css', window);
            if(subsub && subsub.length){
                subsub.remove();
                var es = self.queryElements(self.entries(false, false), {name: basename(self.path), type: 'group'});
                if(es && es.length){
                    es.eq(0).trigger('mousedown')
                } else {
                    self.go(self.path)
                }
                self.restoreScroll();
                return;
            }
            //console.warn('WWWW', r);
            focusEntryItem(r);
            self.restoreScroll()
        } else {
            self.go(dirname(self.path), self.restoreScroll)
        }
    }
    self.enter = () => {
        var e = document.activeElement;
        if(e){
            e = jQuery(e);
            if(e.is('button')){
                e.trigger('click')
            } else {
                e.trigger('mousedown')
            }
        }
    }
    self.playState = (state) => {
        if(self.currentPlayState != state){
            self.currentPlayState = state;
            var refresh = false, es = self.entries(true, false);
            es.forEach((e, i) => {
                if(!refresh && e.class && e.class.indexOf('entry-vary-play-state') !=-1){
                    refresh = true;
                }
            });
            if(refresh){
                self.refresh()
            }
        }
    }
    self.recordingState = (state) => {
        if(self.currentRecordingState != state){
            self.currentRecordingState = state;
            var refresh = false, es = self.entries(true, false);
            es.forEach((e, i) => {
                if(!refresh && e.class && e.class.indexOf('entry-vary-recording-state') !=-1){
                    refresh = true;
                }
            });
            if(refresh){
                self.refresh()
            }
        }
    }
    self.go = (fullPath, _cb) => {
        self.vpath = false;
        var timeout = 10000, ms = 50, retries = timeout / ms, cb = () => {
            if(typeof(_cb) == 'function'){
                _cb()
            }
        };
        if(!fullPath){
            var container = self.container(true); // just to reset entries in view
            self.path = '';
            self.list(null, self.path);
            return cb()
        }
        if(fullPath === self.path){
            return cb();
        }
        if(dirname(fullPath) == self.path){
            var es = self.query(Menu.entries(true, false), {name: basename(fullPath), type: 'group'});
            if(es.length){
                return self.trigger(es[0])
            }
        }
        self.path = '';
        var path = fullPath.split('/');
        var cumulatedPath = '';
        var open = (entries, next) => {
            if(entries.length < 3 && entries[0].class == 'entry-loading') {
                console.warn('CHECK FOR CACHE', cumulatedPath, entries[0]);
                var r = self.asyncResult(cumulatedPath);
                if(r){
                    entries = r;
                } else if(r === -1) { 
                    console.warn('ARE WE CANCELLING?!');
                    return;
                }
            }
            if(self.debug) console.warn('OPEN', next,  'IN', entries, cumulatedPath);
            for(var i=0; i<entries.length; i++){
                if(entries[i].name == next){
                    var nentries = read(entries[i]);
                    nentries = applyFilters('internalFilterEntries', nentries, cumulatedPath);
                    if(self.debug) console.warn('OPENED', nentries);
                    return nentries;
                }
            }
        }
        var read = (entry) => {
            var nentries = [];
            if(typeof(entry.renderer)=='function'){
                nentries = entry.renderer(entry)
            } else {
                if(typeof(entry.entries) != 'undefined'){
                    nentries = entry.entries;
                }
                if(typeof(entry.callback) == 'function'){
                    entry.callback()
                }
            }
            return nentries;
        }
        var enter = (entries, next) => {
            if(self.debug) console.log('enter(next=', next, ')', cumulatedPath, entries, path);
            if(entries.length){
                if(entries[0].class != 'entry-loading') {
                    if(next){ 
                        if(self.debug) console.log('enter(next=', next, ')');
                        var nentries = open(entries, next);
                        if(nentries){
                            entries = nentries;
                            var next = path.shift();
                            if(next){
                                self.vpath = cumulatedPath = assumePath(next, cumulatedPath);
                                if(self.debug) console.log('cumulatedPath', cumulatedPath, next);
                            }
                            return enter(nentries, next)
                        }
                        if(self.debug) console.log('open failed for', next, 'IN', entries)
                    } else {
                        self.vpath = false;
                        self.path = fullPath;
                        if(self.debug) console.log('NO NEXT', self.path, path, entries);
                        var container = self.container(true); // just to reset entries in view
                        backEntryRender(container, dirname(fullPath), basename(fullPath));
                        self.list(entries, fullPath);
                        if(self.debug){
                            console.warn('listed successfully', entries)
                        }
                        cb()
                        /*
                        if(!fullPath || entries.length >= self.subMenuSizeLimit){
                            self.list(entries, fullPath);
                            if(self.debug){
                                console.warn('listed successfully', entries)
                            }
                            cb()
                        } else {
                            var __cb = cb, __name = basename(fullPath);
                            if(self.debug){
                                console.warn('listing go', fullPath, dirname(fullPath), entries)
                            }
                            self.list(entries, fullPath);
                            self.go(dirname(fullPath), () => {
                                __cb();
                                jQuery('.entry-group').filter((i, e) => { 
                                    var d = jQuery(e).data('entry-data'); 
                                    return d && d.name == __name;
                                }).trigger('mousedown')
                            })
                        }
                        */
                    }
                } else {
                    if(retries){
                        if(self.debug) console.log('retry');
                        retries--;
                        setTimeout(() => {
                            var n = next ? dirname(cumulatedPath) : cumulatedPath;
                            if(self.debug) console.log('WAITING FOR', n, 'IN', self.asyncResults);
                            var r = n ? self.asyncResult(n) : index;
                            if(jQuery.isArray(r)){
                                entries = r;
                            } else if(r === -1){
                                return; // cancel
                            }
                            enter(entries, next) 
                        }, ms)
                    } else {
                        self.vpath = false;
                        if(self.debug) console.log('give it up!');
                        cb()
                    }
                }
            }
        }
        cumulatedPath = path.shift();
        enter(self.index, cumulatedPath)
    }
    self.queryElements = (entries, atts) => {
        var results = [], attLen = Object.keys(atts).length;
        entries.each((i, e) => {
            var entry = jQuery(entries[i]).data('entry-data'), hits = 0;
            if(entry){
                for(var key in atts){
                    if(typeof(entry[key])=='undefined'){
                        break;
                    } else if(typeof(entry[key])=='function'){
                        if(entry[key](entry) == atts[key]){
                            hits++;
                        } else {
                            break;
                        }
                    } else if(entry[key] == atts[key]){
                        hits++;
                    } else {
                        break;
                    }
                }
                if(hits == attLen){
                    results.push(entries[i])
                }
            } else {
                console.warn('ENTRY WITH NO DATA?', entries[i], entry)
            }
        });
        return jQuery(results);
    }
    self.query = (entries, atts, remove) => {
        var results = [], attLen = Object.keys(atts).length;
        entries.forEach((e, i) => {
            var entry = entries[i], hits = 0;
            for(var key in atts){
                if(typeof(entry[key])=='undefined'){
                    break;
                } else if(typeof(entry[key])=='function'){
                    if(entry[key](entry) == atts[key]){
                        hits++;
                    }
                } else {
                    if(entry[key] == atts[key]){
                        hits++;
                    } else {
                        break;
                    }
                }
                if(hits == attLen){
                    results.push(entry);
                    if(remove){
                        delete entries[i];
                    }
                }
            }        
        });
        if(remove){
            return entries.slice(0) // reset
        }
        return results;
    }
    self.insert = (entries, atts, insEntry, insertAfterInstead) => {
        var j = null, results = [], attLen = Object.keys(atts).length;
        for(var i in entries) {
            var entry = entries[i], hits = 0;
            for(var key in atts){
                if(typeof(entry[key])=='undefined'){
                    break;
                } else if(typeof(entry[key])=='function'){
                    if(entry[key](entry) == atts[key]){
                        hits++;
                    }
                } else {
                    if(entry[key] == atts[key]){
                        hits++;
                    } else {
                        break;
                    }
                }
                if(hits == attLen){
                    j = i;
                }
            }        
        }
        if(j !== null){
            if(insertAfterInstead){
                j += 2;
            }
            entries = Menu.query(entries, {name: insEntry.name}, true);
            entries.splice(j, 0, insEntry);
            return entries.slice(0) // reset
        }
        return entries;
    }
    self.setup = () => {
        self.path = ltrimPathBar(Store.get('Menu.path')) || '', pos = self.path.indexOf(Lang.MY_LISTS);
        if(pos == -1 || pos > 3){
            self.path = '';
        }
        jQuery(window).on('unload', function (){
            Store.set('Menu.path', self.path)
        });
        self.container().on('mousedown', (event) => {
            //console.warn(event);
            if(jQuery(event.target).is('div') && jQuery('.entry-sub').length){
                self.back()
            }
        })
    }
    return self;
})();

function goHistory(){
    Menu.go(Lang.OPTIONS+'/'+Lang.HISTORY);
    setBackToHome()
}

function lazyLoad(element, srcs){
    //console.warn('LAZYLOAD');
    var offset = srcs.indexOf(element.src);
    offset++;
    //console.warn('LAZYLOAD', offset);
    if(typeof(srcs[offset])!='undefined'){
        element.src = srcs[offset];
    } else {
        element.onerror = null;
        element.src = defaultIcons['stream'];
    }
    //console.warn('LAZYLOAD');
}

function allowAutoClean(curPath){
    // should append autoclean in this path?
    var offerAutoClean = false, autoCleanAllowPaths = [Lang.CHANNELS, Lang.MY_LISTS, Lang.SEARCH], ignorePaths = [Lang.BEEN_WATCHED, Lang.HISTORY, Lang.RECORDINGS, Lang.BOOKMARKS, Lang.MAGNET_SEARCH, 'Youtube'];
    autoCleanAllowPaths.forEach((path) => {
        if(curPath.indexOf(path) != -1){
            offerAutoClean = true;
        }
    });
    if(offerAutoClean){
        ignorePaths.forEach((path) => {
            if(curPath.indexOf(path) != -1){
                offerAutoClean = false;
            }
        })
    }
    return offerAutoClean;
}

var showLogos = !Config.get('hide-logos');  
jQuery(() => {    
    addFilter('filterEntries', (entries, path) => {
        //console.log('PREFILTERED', entries);
        var hasStreams = false, hasVisibleStreams = false, firstStreamOrGroupEntryOffset = -1, nentries = [];
        for(var i=0; i<entries.length; i++){
            // entry properties are randomly(?!) coming as buffers instead of strings, treat it until we discover the reason
            if(!entries[i]) continue;
            if(['undefined', 'string'].indexOf(typeof(entries[i].name))==-1){
                entries[i].name = String(entries[i].name)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].label))==-1){
                entries[i].label = String(entries[i].label)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].group))==-1){
                entries[i].group = String(entries[i].group)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].url))==-1){
                entries[i].url = String(entries[i].url)
            }
            let type = typeof(entries[i].type)=='string' ? entries[i].type : 'stream';
            let nm = type == 'stream' && !isMega(entries[i].url);
            if(nm && !hasStreams){
                hasStreams = true;
            }   
            if(['stream', 'group'].indexOf(type)!=-1 && !parentalControlAllow(entries[i])){
                console.log('PARENTAL CONTROL BLOCKED', entries[i]);
                continue;
            }
            if(['stream', 'group'].indexOf(type) != -1 && firstStreamOrGroupEntryOffset == -1){
                firstStreamOrGroupEntryOffset = nentries.length;
            }
            if(nm){
                if(!hasVisibleStreams){
                    hasVisibleStreams = true;
                }
                var entry = Object.assign({}, entries[i]); // do not modify the original
                if(!showLogos){
                    entry.logo = defaultIcons['stream'];
                }
                if(!entry.name && entry.label){
                    entry.name = entry.label; // try to fill empty names
                }
                nentries.push(entry) // not a stream entry
            } else {
                nentries.push(entries[i]) // not a stream entry
            }
        }                
        //console.log('POSFILTERED', entries);
        var ac = (hasStreams && firstStreamOrGroupEntryOffset != -1 && allowAutoClean(Menu.path));
        if(Menu.path == searchPath || ac) {
            console.warn(nentries, Menu.query(nentries, {name: Lang.OPTIONS}), Menu.query(nentries, {name: Lang.OPTIONS}).length);
            nentries = Menu.query(nentries, {name: Lang.OPTIONS}, true);
            if(!Menu.query(Menu.entries(true), {name: Lang.OPTIONS}).length){
                var n = (autoCleanEntriesRunning() && autoCleanEntriesStatus && autoCleanEntriesStatus.indexOf('100%')==-1) ? autoCleanEntriesStatus : Lang.TEST_THEM_ALL;
                var megaUrl = false;
                var aopt = {type: 'option', name: n, label: Lang.AUTO_TUNING, logo: 'fa-magic', class: 'entry-autoclean', callback: () => {
                    if(autoCleanEntriesRunning()){
                        autoCleanEntriesCancel()
                    } else {
                        autoCleanEntries(null, (entry, controller, succeededIntent) => {
                            console.warn('ACE SUCCES CB 2', entry, succeededIntent.ended, controller, succeededIntent);
                            if(succeededIntent){
                                PlaybackManager.stop();
                                PlaybackManager.commitIntent(succeededIntent)
                            }
                        }, () => {

                        }, () => {

                        }, true, true, megaUrl)
                    }
                }};
                if(Menu.path == searchPath){
                    megaUrl = 'mega://play|'+lastSearchTerm;
                    if(PlaybackManager.activeIntent && PlaybackManager.activeIntent.entry.originalUrl == megaUrl){
                        n = Lang.TRY_OTHER_STREAM;
                    }
                    var opts = {name: Lang.OPTIONS, label: Lang.SEARCH, type: 'group', logo: 'assets/icons/white/settings.png', entries: [
                        {name: Lang.VIDEO_SEARCH, label: '', logo: 'fa-film', type: 'option', value: lastSearchTerm, callback: () => { setupSearch(lastSearchTerm, 'video', Lang.VIDEO_SEARCH) }},
                        {name: Lang.MAGNET_SEARCH, label: '', logo: 'fa-magnet', type: 'option', value: lastSearchTerm, callback: () => { setupSearch(lastSearchTerm, 'magnet', Lang.MAGNET_SEARCH) }}
                    ]};
                    if(showAdultContent){
                        opts.entries.push({name: Lang.ADULT_SEARCH, label: '', logo: 'fa-fire', type: 'option', value: lastSearchTerm, callback: () => { setupSearch(lastSearchTerm, 'prn', Lang.ADULT_SEARCH) }})
                    }
                    opts.entries.push(searchRangeOption()),
                    opts.entries.push(
                        getParentalControlToggler(() => {
                            goSearch()
                        })
                    );
                    if(ac){
                        nentries.splice(firstStreamOrGroupEntryOffset, 0, aopt)
                    }
                    nentries.splice(firstStreamOrGroupEntryOffset, 0, opts)
                } else if(ac) {
                    nentries.splice(firstStreamOrGroupEntryOffset, 0, aopt)
                }
            }
        }
        if(hasStreams && !hasVisibleStreams){ // has stream entries, but them're blocked by the parental control
            nentries.push(getParentalControlToggler(() => {
                var path = Menu.path;
                Menu.back();
                setTimeout(() => {
                    Menu.go(path)
                }, 400)
            }));
            nentries.push({name: Lang.EMPTY, logo:'fa-file', type: 'option'})
        } else {
            jQuery('.entry-empty').remove()
        }
        console.log('FILTERED', nentries, entries);
        return nentries;
    });
    addFilter('filterEntries', listManJoinDuplicates);
})