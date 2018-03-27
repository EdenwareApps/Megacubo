
var menuTemplates = {
    'option': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'disabled': '<a href="[url]" onclick="return false;" class="entry entry-disabled entry-offline [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'input': '<a href="[url]" onclick="return false;" class="entry entry-input"><table class="entry-search"><tr><td><input type="text" style="background-image: url([logo]);" /></td><td class="entry-logo-c"></td></tr></table></a>', // entry-input-container entry-search-helper
    'check': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><i class="fas fa-toggle-off entry-logo-fa" aria-hidden="true"></i></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'stream': '<a href="[url]" onclick="return false;" class="entry entry-stream [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" data-lazy-src="[lazy-logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[format-name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'back': '<a href="[url]" onclick="return false;" class="entry entry-back [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" /></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'group': '<a href="[url]" onclick="return false;" class="entry entry-group [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>' // onerror="nextLogoForGroup(this)" 
};

var defaultIcons = {
    'option': 'fa-cog',
    'input': 'assets/icons/white/search-dark.png',
    'stream': 'assets/icons/white/default-stream.png',
    'back': 'fa-chevron-left',
    'check': 'fa-toggle-off',
    'group': 'assets/icons/white/default-group.png'
};

var loadingToActionDelay = 200; // prevent a loading message from not appearing by applying a delay before start any CPU intensive task
var searchPath = null;

function assumePath(name, path){
	if(!name){
		return '';
	}
    if(!path){
        path = listingPath;
    }
    // path = trimChar(path, '/');
    var n = path.lastIndexOf(name);
    //console.log(n, name, path);
    if(n != -1){
        path = path.substr(n + name.length + 1);
    }
    return path.length ? path + '/' + name : name;
}

function updateRootEntry(name, data){
    for(var i=0; i<index.length; i++){
        if(index[i].name == name){
            for(var key in data){
                index[i][key] = data[key];
            }
            if(!listingPath){
                refreshListing()
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

function listEntriesRender(entries, container, tabIndexOffset){
    //console.log(entry);
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
        var logo = entry.logo || defaultIcons[entry.type];
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
        if(logo.substr(0, 3)=="fa-"){
            html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="fas '+logo+' entry-logo-fa" aria-hidden="true"></i>')
        } else if(logo.indexOf(" fa-")!=-1){
            html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="'+logo+' entry-logo-fa" aria-hidden="true"></i>')
        } else {
            html = html.replaceAll('[logo]', logo);
            html = html.replaceAll('[lazy-logo]', originalLogo);
            html = html.replaceAll('[default-logo]', defaultIcons[entry.type])
        }
        html = html.replaceAll('[group]', entry.group || '');
        html = html.replaceAll('[label]', entry.label || entry.group || '');
        html = html.replaceAll('[class]', entry.class || '');
        html = html.replaceAll('[url]', entry.url || entry.originalUrl || 'javascript:;');
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
                    console.warn('OK?', data, checked, data.check);
                } else {
                    triggerEntry(data, event.currentTarget)
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
        if(entry.type == 'input'){
            if(entry['change']){
                atts.input = (event) => {
                    jQuery('body').trigger('wake');
                    entry['change'](entry, event.currentTarget, event.currentTarget.getElementsByTagName('input')[0].value);
                }
            }
            if(entry['value']){
                atts.value = entry['value'];
            }
            if(entry['placeholder']){
                atts.placeholder = entry['placeholder'];
            }
            atts.focus = (event) => {
                event.currentTarget.querySelector('input').focus()
            }
        }
        atts.mouseenter = (event) => {
            clearTimeout(listEntryFocusOnMouseEnterTimer);
            var e = event.currentTarget;
            listEntryFocusOnMouseEnterTimer = setTimeout(() => {
                focusEntryItem(jQuery(e), true)
            }, 600)
        }
        allEvents.push(atts);
        tabIndexOffset++;
    });
    container.append(allHTML);
    var ri = allEvents.length;
    container.find('a').reverse().each((i, element) => {
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
        _index = index;
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
    var sub = index;
    if(!path) return index;
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

var $container = false, $ccontainer = false;
function getListContainer(reset){
    if(!$container){
        $ccontainer = jQuery('#controls div.list');
        $container = $ccontainer.find('div > div').eq(0)
    }
    if(reset){
        $ccontainer.prop('scrollTop', 0);
        $container.html('');
        lastTabIndex = 1;
    }
    return $container;
}

function listEntries(entries, path){
    if(path){
        jQuery('body').removeClass('home')
    } else {
        jQuery('body').addClass('home')
    }
    var lst = jQuery('.list'), top = lst.prop('scrollTop');
    //console.log('LISTENTRIES PREFILTER', entries, path, traceback());
    var container = getListContainer(false);
    var tabIndexOffset = getTabIndexOffset();
    entries = applyFilters('filterEntries', entries, path);
    //console.log('LISTENTRIES POSFILTER', entries, path, traceback());
    for(var i=0; i<entries.length; i++){
        entries[i].path = path;
    }
    listEntriesRender(entries, container, tabIndexOffset);
    //console.log('LISTENTRIES', container.html().substr(0, 36));
    var rescroll = () => {
        lst.prop('scrollTop', top);
        if(top && lst.prop('scrollTop')<top && lst.height() > top){
            setTimeout(rescroll, 33)
        }
    }
    setTimeout(rescroll, 0);
    updateStreamEntriesFlags();
    var lps = 7;
    lst.find('.marquee:not(.marquee-adjusted)').each((i, e) => {
        jQuery(e).addClass('marquee-adjusted').find('*:eq(0)').css('animation-duration', parseInt(e.innerText.length / lps)+'s')
    });
    focusEntryItem(lst.find('a.entry:eq(0)'));
    window['lhr'] = jQuery('.list > div').html()
}

var lastParentEntry = 0;

function refreshListing(){
    var lst = jQuery('.list'), top = lst.prop('scrollTop'), inSearch = (listingPath.indexOf(Lang.SEARCH) != -1);
    if(inSearch){
        jQuery('.list input').trigger('input');
    } else {
        var entry = listingPath ? getPathTriggerer(listingPath) : false;
        if(entry) {
            console.warn('triggerer', listingPath, entry);
            triggerEntry(entry, null)
        } else {
            console.warn('no triggerer', listingPath);
            listEntriesByPathTriggering(listingPath)
        }
    }
    if(top){
        var rescroll = () => {
            lst.prop('scrollTop', top);
            if(top && lst.prop('scrollTop')<top && lst.height() > top){
                setTimeout(rescroll, 33)
            }
        }
        setTimeout(rescroll, inSearch ? 410 : 0) // wait search delay of 400ms
    }
}

function refreshListingIfMatch(needle){
    if(listingPath.indexOf(needle)!=-1){
        refreshListing()
    }
}

function getSearchSuggestions(){
    var url = 'http://app.megacubo.net/stats/data/searching.'+getLocale(true)+'.json';
    fetchEntries(url, (suggestions) => {
        var entries = [];
        suggestions.forEach((suggest) => {
            entries.push({name: '#'+suggest.search_term, logo: 'fa-search', type: 'option', class: 'entry-suggest', label: Lang.SEARCH, callback: () => {goSearch(suggest.search_term)}})
        });        
        //console.warn('INPUT', basename(listingPath), basename(searchPath), listingPath, searchPath, lastSearchTerm, lastSearchTerm.length);
        jQuery('.entry-suggest').remove();
        if(basename(listingPath) == basename(searchPath) && jQuery('.entry-search input').val().length <= 2){
            listEntries(entries, searchPath)
        }
    })
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

function fetchAndRenderEntries(url, name, filter, callback){
    var path = assumePath(name);
    var fetchPath = path;
    console.log('FETCH', url, name, path);
    var container = getListContainer(true);
    backEntryRender(container, dirname(path));
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle', 'normal');
        triggerBack()
    }
    setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
        fetchEntries(url, (options) => {
            console.log('FETCH 2', listingPath, fetchPath, path);
            if(fetchPath == listingPath){
                if(options.length){
                    console.log(options);
                    if(typeof(filter)=='function'){
                        options = options.map(filter)
                    }
                    jQuery('.entry:not(.entry-back)').remove();
                    console.log(options, name, path);
                    index = writeIndexPathEntries(path, options, index);
                    if(typeof(callback)=='function'){
                        var hr = callback(options);
                        if(jQuery.isArray(hr)){
                            options = hr;
                        }
                    }
                    listEntriesByPath(path);
                } else {
                    failed()
                }
            }
        })
    }, loadingToActionDelay);
    return [getLoadingEntry()];
}

function fetchAndRenderWatchingEntries(name, filter, callback){
    //listingPath = '/'+Lang.SEARCH;
    var path = assumePath(name);
    console.log('FETCH WATCHING', name, path);
    var container = getListContainer(true);
    backEntryRender(container, dirname(path));
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-exclamation-triangle', 'normal');
        triggerBack()
    }
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
                    })
                }
                jQuery('.entry:not(.entry-back)').remove();
                console.log(options, name, path);
                listEntries(options.slice(0, 48), path);
                if(typeof(callback)=='function'){
                    callback(options)
                }
            } else {
                failed()
            }
        })
    }, loadingToActionDelay);
    return [getLoadingEntry()];
}

function listEntriesByPath(path, append, nofx, cb){
    console.log(path);
    if(!nofx && listingPath.length != path.length){
        if(listingPath.length > path.length){
            listBackEffect(function (){
                listEntriesByPath(path, append, true)
            })
        } else {
            listEnterEffect(function (){
                listEntriesByPath(path, append, true)
            })
        }
        return;
    }
    console.log(path);
    listingPath = path = ltrimPathBar(path);
    var container = getListContainer(!append), entry;
    if(typeof(path)!='string'){
        path = '';
    }
    console.log(path);
    list = readIndexPath(path);
    console.log('DREADY3', path, list);
    if(!jQuery.isArray(list)){
        list = [list];
    }
    if(!append){
        if(path.length) {
            backEntryRender(container, dirname(path));
        }
    }
    listEntries(list, path, cb);
    if(!append){
        container.find('a:eq(0)').trigger('focus')
    }
    if(typeof(cb)=='function'){
        cb()
    }
}

function backEntryRender(container, backPath){
    //console.warn('#####################################', backPath, traceback());
    if(!container){
        container = getListContainer(true) // reset always for back button
    }
    var back = {
        name: Lang.BACK,
        path: backPath,
        type: 'back',
        class: 'entry-back entry-search-helper',
        delete: function (a, b){
            console.log('DELETE TEST', a, b)
        }
    };
    if(Config.get('hide-back-button')){
        back.class += ' entry-hide';
    }
    listEntriesRender([back], container, 1)
}

function getTabIndexOffset(){
    var container = getListContainer(false);
    var as = container.find('a');
    return as.length + 1;
}

function getPathTriggerer(path){
    var parentEntry = false, parentEntries = readIndexPath(dirname(path));
    for(var i=0; i<parentEntries.length; i++){
        if(parentEntries[i].name == basename(path)){
            parentEntry = parentEntries[i];
            break;
        }
    }
    return parentEntry;
}

var lastListScrollTop = 0;
function triggerEntry(data, element){
    console.log('TRIGGER', data, element);
    var isBack = false;
    if(data.type == 'group'){ // prior to dealing with the back entry
        lastListScrollTop = jQuery('.list').scrollTop()
    }
    if(data.type == 'back'){
        isBack = true;
        console.log(data.path);
        if(typeof(data.back)=='function'){
            var entry = data;
            setTimeout(function (){
                entry.back(entry, this)
            }, loadingToActionDelay)
        }
        var newPath = dirname(listingPath);
        listEntriesByPath(newPath);
        setTimeout(() => { // without this delay the callback was being triggered too quick.
            var triggerer = getPathTriggerer(newPath);
            // console.warn('BACK TRIGGER', triggerer, listingPath, newPath);
            if(listingPath == newPath && triggerer && typeof(triggerer.callback)=='function'){
                triggerer.callback();
            }
        }, loadingToActionDelay);
        return true;
    }
    if(typeof(data.path)=='undefined'){
        data.path = '';
    }
    var entries = null, listDirectly = false, npath = isBack ? data.path : assumePath(data.name, data.path);
    if(isBack){
        npath = listingPath + '/' + npath;
    }
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
        } else {
            console.log('WW', npath, entries);
            window.index = writeIndexPathEntries(npath, entries);
            if(entries.length && !readIndexPath(npath).length){
                listDirectly = true;
            }
        }
    }
    if(listDirectly && npath){
        console.log(npath, data.path, entries);
        var container = getListContainer(true);
        backEntryRender(container, dirname(npath));
        listingPath = ltrimPathBar(npath);
        listEntries(entries, npath)
    } else {
        if(data.type == 'group'){
            console.log(npath);
            listEntriesByPath(npath)
        } else if (data.type == 'back') { // parent entry not found
            listEntriesByPath(data.path)
        }
    }
    var t = typeof(data.callback);
    console.log('CALLBACK', t, data);
    if(t == 'function'){
        setTimeout(function (){
            data.callback(data, this)
        }, 150)
    } else if(isStreamEntry(data)) {
        console.log('PLAY', data);
        playEntry(data)
    }
    if(isBack){
        setTimeout(() => {
            if(lastListScrollTop && !jQuery('.list').scrollTop()){
                jQuery('.list').scrollTop(lastListScrollTop)
            }
        }, 250)
    }
}

function isStreamEntry(data){
    if(typeof(data.type)=='undefined' || !data.type){
        if(typeof(data.url)=='string' && data.url.match('(//|magnet:)')){
            data.type = 'stream';
        }
    }
    return (data.type == 'stream');
}

function setEntryFlag(el, flag){
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
        fas = jQuery('.entry'), term = top.decodeEntities(term).toLowerCase();
        fas = fas.filter(function (){
            var stub = jQuery(this).attr('href').toLowerCase();
            var h = top.decodeEntities(stub);
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
            var h = top.decodeEntities(jQuery(this).find('.entry-name').html());
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
    var fas = jQuery('.entry-status i.fa'), term = top.decodeEntities(term);
    fas = fas.map(function (){
        return jQuery(this).parents('.entry').get(0);
    });
    fas = fas.filter(function (){
        var h = top.decodeEntities(this.outerHTML);
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
        for(var i=0;i<entries.length;i++){
            console.log('SET-'+i);
            setEntryFlag(entries[i], fa);
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

var searchKeypressTimer = 0, lastSearchTerm = Store.get('last-search-term');

function setupSearch(term, type, name){
    listingPath = assumePath(name);
    var container = getListContainer(true);
    backEntryRender(container, dirname(listingPath));
    if(term){
        lastSearchTerm = term;
    } else {
        if(top.PlaybackManager.activeIntent){
            var url = top.PlaybackManager.activeIntent.entry.originalUrl;
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
        change: (entry, element, val) => {
            var np = container.find('a.entry-input');
            clearTimeout(searchKeypressTimer);
            container.find('a.entry-stream, a.entry-loading, a.entry-autoclean').remove();
            if(val){
                lastSearchTerm = val;
                Store.set('last-search-term', val);
                listEntries([getLoadingEntry()], listingPath)
            } else {
                listEntries([], listingPath); // just to update the body class
            }
            focusEntryItem(np);
            np.find('input').get(0).focus();
            searchKeypressTimer = setTimeout(() => {
                clearTimeout(searchKeypressTimer);
                var parentalControlAllowed = parentalControlAllow(val, true);
                if(showAdultContent || parentalControlAllowed){
                    var r;
                    switch(type){
                        case "live":
                            if(val.length){
                                r = fetchSharedListsSearchResults(null, val, true);
                                r = r.filter((entry) => {
                                    return !entry.isvideo;
                                }).concat(r.filter((entry) => {
                                    return entry.isvideo;
                                }))
                            }
                            break;
                        /*
                        case "prn":
                            r = fetchPRNSearchResults();
                            break;
                        */
                        case "magnet":
                            if(val.length){
                                r = fetchMagnetSearchResults();
                            }
                            break;
                        case "video":
                            if(val.length){
                                r = fetchVideoSearchResults();
                            }
                            break;
                    }
                }
                if(!r){
                    r = [];
                }
                if(!parentalControlAllowed){
                    r.unshift(getParentalControlToggler(() => {
                        jQuery('a.entry input').trigger('focus').trigger('input')
                    }))
                }
                container.find('a.entry-stream, a.entry-loading, a.entry-autoclean, a.entry-suggest, a.entry-option').remove();
                console.log('QQQ', r, val, type, listingPath);
                listEntries(r, listingPath);
                focusEntryItem(np);
                np.find('input').get(0).focus();
                console.warn('INPUT2', val, np.find('input').val());
                if(val.length > 2){
                    top.sendStats('search', {query: val, type: type})
                } else {
                    getSearchSuggestions()
                }
            }, 600);
        },
        value: term,
        placeholder: Lang.SEARCH_PLACEHOLDER
    };   
    listEntriesRender([entry], container);
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

var ytsr = false;
function fetchVideoSearchResults(){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    if(q.length > 1){
        var cb = (entries) => {
            if(listingPath.indexOf('/'+Lang.FIND_VIDEOS)==-1 || c.find('input').val().toLowerCase() != q){
                return;
            }
            var _entries = fetchSharedListsSearchResults('video');
            if(_entries.length > 1){
                entries = _entries.concat(entries)
            }
            var container = getListContainer(false);
            container.find('a.entry-stream, a.entry-loading').remove();
            listEntries(entries, listingPath);
        }
        setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
            if(!ytsr){
                ytsr = require('ytsr')
            }
            ytsr.get_filters(q, function(err, filters) {
                console.log(filters);
                if(!jQuery.isArray(filters)){
                    return cb([])
                }
                var filter = filters['type'].find((o) => {return o.name == 'Video'});
                var options = {
                    limit: 36,
                    nextpage_ref: filter.ref,
                }
                ytsr.search(null, options, function(err, search_results) {
                    if(err){
                        return cb([])
                    }
                    //console.log(search_results);
                    //console.log(search_results.items);
                    //console.log(search_results.items.length);
                    var entries = [];
                    for(var i=0; i<search_results.items.length; i++){
                        //console.log(search_results.items[i]);
                        entries.push({
                            type: 'stream',
                            url: search_results.items[i].link,
                            name: search_results.items[i].title,
                            logo: search_results.items[i].thumbnail,
                            label: search_results.items[i].author.name
                        })
                    }
                    cb(entries);
                    //console.log(entries);
                });
            })
        }, loadingToActionDelay);
        return [getLoadingEntry()];
    }
    return [];
}

var btdb = false;
function fetchMagnetSearchResults(){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    if(q.length > 1){
        setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
            if(!btdb){
                btdb = require('btdb-search')
            }
            btdb.search(q+' mp4 aac').then(function (data) {
                console.log(data);
                if(listingPath.indexOf('/'+Lang.MAGNET_SEARCH)==-1){
                    return;
                }
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
                var container = getListContainer(false);
                container.find('a.entry-stream, a.entry-loading').remove();
                listEntries(entries, listingPath);
            })
        }, loadingToActionDelay);
        return [getLoadingEntry()];
    }
    return [];
}

/*
var pnsr = false, formatPRNURL = (url) => {
    return 'https://pt.pornhub.com/embed/'+url.split('=')[1];
}
function fetchPRNSearchResults(){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    if(q.length > 1){
        setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
            if(!pnsr){
                pnsr = require('pornsearch').default;
            }
            var callback = (videos) => {
                console.log('PN', videos);
                if(listingPath.indexOf('/'+Lang.PRN_SEARCH)==-1){
                    return;
                }
                if(jQuery.isArray(videos)){
                    var entries = [];
                    for(var i=0; i<videos.length; i++){
                        //console.log(search_results.items[i]);
                        entries.push({
                            type: 'stream',
                            url: formatPRNURL(videos[i].url)+'#nosandbox',
                            name: videos[i].title + ' | XXX',
                            logo: videos[i].thumb,
                            label: videos[i].duration
                        })
                    }
                    var container = getListContainer(false);
                    container.find('a.entry-stream, a.entry-loading').remove();
                    listEntries(entries, listingPath)
                }
            };
            var Searcher = new pnsr(q);
            Searcher.videos().then(callback).catch(() => {
                callback([])
            })
        },loadingToActionDelay);
        return [getLoadingEntry()];
    }
    return [];
}
*/

var sharedLists = [], sharedListsSearchIndex = {};

function fetchSharedLists(callback){
    if(sharedLists.length){
        callback(sharedLists)
    } else {
        var url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json';
        fetchEntries(url, (entries) => {
            sharedLists = entries.map((entry) => { return entry.url; });
            callback(sharedLists)
        })
    }
}

var buildenSharedListsSearchIndex = -1;

function buildSharedListsSearchIndex(callback){
    if(buildenSharedListsSearchIndex === -1){
        buildenSharedListsSearchIndex = 0;
        fetchSharedLists((urls) => {
            var listsCountLimit, listsCountLimit = Config.get('search-range');
            if(typeof(listsCountLimit)!='number' || listsCountLimit < 5){
                listsCountLimit = 18; // default
            }
            urls = getSourcesURLs().concat(urls);
            if(urls.length > listsCountLimit){
                urls = urls.slice(0, listsCountLimit)
            }
            var iterator = 0, completeIterator = 0, tasks = Array(urls.length).fill((asyncCallback) => {
                var url = urls[iterator];
                iterator++;
                ListMan.parse(url, (entries) => {
                    for(var i=0; i<entries.length; i++){
                        //console.log('entry', entries[i]);
                        entries[i].isvideo = (entries[i].url.indexOf('mp4') != -1);
                        entries[i].searchTerms = Array.from(new Set((entries[i].name + ' ' + entries[i].group).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(" "))).join(" ");
                        //console.log('entry pk', entries[i], entries[i].searchTerms);
                    }
                    //console.log('HOORAY', entries);
                    sharedListsSearchIndex[url] = entries;
                    completeIterator++;
                    if(typeof(Lang.SEARCH)!='undefined' && listingPath.indexOf(Lang.SEARCH) != -1){ // do we still in the search view?
                        var e = jQuery('.entry-loading .entry-name');
                        if(e.length){
                            var p = completeIterator / (urls.length / 100);
                            e.text(Lang.GENERATING_INDEX+'... '+parseInt(p)+'%')
                        }
                    }
                    asyncCallback();
                }, 7.5, true)            
            });
            if(typeof(async) == 'undefined'){
                async = require('async')
            }
            async.parallelLimit(tasks, 20, (err, results) => {
                buildenSharedListsSearchIndex = true;
                jQuery(window).trigger('search-index-ready')
            })
        })
    } else if(callback) {
        jQuery(window).off('search-index-ready', callback).on('search-index-ready', callback)
    }
}

buildSharedListsSearchIndex();

var sharedListsSearchCaching = false;
function fetchSharedListsSearchResults(type, term, matchAll){
    if(buildenSharedListsSearchIndex === true){
        var r = [], limit = 64;
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
                var maybe = [], already = {}, terms = term.toLowerCase().split(' ').filter((s) => { return s.length >= 1; });
                if(terms.length >= 1){ 
                    //console.log(terms, matchAll);
                    for(var list in sharedListsSearchIndex){
                        for(var n in sharedListsSearchIndex[list]){
                            if(r.length >= limit) break;
                            if(!sharedListsSearchIndex[list][n].url || typeof(already[sharedListsSearchIndex[list][n].url]) != 'undefined'){
                                continue;
                            }
                            already[sharedListsSearchIndex[list][n].url] = 1;
                            if(type && ['video', 'stream'].indexOf(type) != -1){
                                if(type =='video' && !sharedListsSearchIndex[list][n].isvideo){
                                    continue;
                                }
                                if(type =='stream' && sharedListsSearchIndex[list][n].isvideo){
                                    continue;
                                }
                            }
                            var hits = 0;
                            for(var i=0;i<terms.length; i++){
                                //console.log(terms[i]);
                                if(sharedListsSearchIndex[list][n].searchTerms && sharedListsSearchIndex[list][n].searchTerms.indexOf(terms[i]) != -1){
                                    hits++;
                                }
                            }
                            if(hits){
                                //console.warn(sharedListsSearchIndex[list][n]);
                                sharedListsSearchIndex[list][n].source = list;
                                if(hits == terms.length){
                                    r.push(sharedListsSearchIndex[list][n]);
                                } else if(!matchAll) {
                                    maybe.push(sharedListsSearchIndex[list][n])
                                }
                            }
                        }
                    }
                    //console.log(r);
                    if(r.length < limit && !matchAll){
                        r = r.concat(maybe.slice(0, limit - r.length))
                    }
                    sharedListsSearchCaching = {type: type, query: term, entries: r};
                }
            }
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

var sharedListsGroups = false;
function fetchSharedListsGroups(type){
    if(buildenSharedListsSearchIndex === true){
        if(sharedListsGroups === false){
            sharedListsGroups = {video: [], live: []};
            let processedGroups = {video: [], live: []}, gtype;
            for(var list in sharedListsSearchIndex){
                for(var n in sharedListsSearchIndex[list]){
                    var g = sharedListsSearchIndex[list][n].group;
                    if(g && g.indexOf('/')==-1){
                        gtype = sharedListsSearchIndex[list][n].isvideo ? 'video' : 'live';
                        if(processedGroups[gtype].indexOf(g) == -1){
                            processedGroups[gtype].push(g);
                            g = g.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                            if(sharedListsGroups[gtype].indexOf(g) == -1){
                                sharedListsGroups[gtype].push(g)
                            }
                        }
                    }
                }
            }
            sharedListsGroups['video'].sort();
            sharedListsGroups['live'].sort();
        }
        switch(type){
            case 'video':
                return sharedListsGroups['video'];
                break;
            case 'live':
                return sharedListsGroups['live'];
                break;
            default:
                var r = sharedListsGroups['live'];
                r = r.concat(sharedListsGroups['video']);
                r = r.sort();
                return r;
        }
    } else {
        return [];
    }
}

function lettersToRange(a, b){
    if(a == b) return a;
    return a+'-'+b;
}

function sharedGroupsAsEntries(type){
    var groups = fetchSharedListsGroups(type);
    groups = groups.map((group) => {
        return {
            name: group,
            type: 'group',
            renderer: () => {
                return fetchSharedListsSearchResults(false, group, true)
            }
        }
    });
    var masterGroups = {}, firstChar;
    for(var i=0; i<groups.length; i++){
        firstChar = groups[i].name.toUpperCase().match(new RegExp('[A-Z0-9]'));
        firstChar = (firstChar && firstChar.length >= 1) ? firstChar[0] : '0';
        if(typeof(masterGroups[firstChar])=='undefined'){
            masterGroups[firstChar] = [];
        }
        masterGroups[firstChar].push(groups[i])
    }
    var masterGroupsParsed = [], parsingGroup = [], parsingGroupIndexStart = false, parsingGroupIndexEnd = false;
    for(var key in masterGroups){
        if(parsingGroupIndexStart === false){
            parsingGroupIndexStart = key;
        }
        if((parsingGroup.length + masterGroups[key].length) >= folderSizeLimit){
            masterGroupsParsed.push({
                name: lettersToRange(parsingGroupIndexStart, parsingGroupIndexEnd)+' ('+parsingGroup.length+')',
                type: 'group',
                entries: parsingGroup
            });
            parsingGroup = masterGroups[key];
            parsingGroupIndexStart = key;
        } else {
            parsingGroup = parsingGroup.concat(masterGroups[key])
        }
        parsingGroupIndexEnd = key;
    }
    if(parsingGroup.length){
        masterGroupsParsed.push({
            name: lettersToRange(parsingGroupIndexStart, parsingGroupIndexEnd)+' ('+parsingGroup.length+')',
            type: 'group',
            entries: parsingGroup
        })
    }
    return masterGroupsParsed;
}

function hideSearchField(){
    var c = jQuery('.list > div > div');
    c.html('');
    jQuery('.entry-search').remove(c);
    if(!c.find('a').length){
        listEntriesByPath();
    }
}

function getFocusedEntry(){
    var f = jQuery('body').find('a.entry-focused');
    if(!f.length || !f.is(':in-viewport')){
        f = jQuery('body').find('a.entry:in-viewport').eq(scrollDirection == 'up' ? 0 : -1);
    }
    return f;
}

function focusPrevious(){
    var e = getFocusedEntry(), p = e.prev('a.entry:visible, a.option:visible');
    if(!p.length){
        p = jQuery('body').find(e.hasClass('entry')?'a.option:visible':'a.entry:visible').eq(-1);
        if(!p.length){
            p = jQuery('body').find('a.entry:visible:eq(-1)')
        }
    }
    focusEntryItem(p)
}

function focusNext(){
    var e = getFocusedEntry(), p = e.next('a.entry:visible, a.option:visible');
    if(!p.length){
        p = jQuery('body').find(e.hasClass('entry')?'a.option:visible':'a.entry:visible').eq(0);
        if(!p.length){
            p = jQuery('body').find('a.entry:visible:eq(0)')
        }
    }
    focusEntryItem(p)
}

function triggerEntryAction(type){
    jQuery(document.activeElement).trigger(type);
}

function triggerEnter(){
    var e = document.activeElement;
    if(e){
        jQuery(e).trigger('mousedown')
    }
}

function triggerBack(){
    var b = getListContainer().find('.entry-back');
    if(b && b.length){
        b.trigger('mousedown')
    } else {
        seekRewind()
    }
}

function listEntriesByPathTriggering(fullPath, _cb){
    var debug = false, delay = 1000, ms = 50, retries = 10, cb = () => {
        if(typeof(_cb) == 'function'){
            _cb()
        }
    };
    if(!fullPath){
        return listEntriesByPath(fullPath, false, true, cb)
    }
    var path = fullPath.split('/');
    var cumulatedpath = fullPath.split('/');
    var enter = (entries, next) => {
        if(debug) console.log(entries, next, path);
        if(entries.length && entries[0].class != 'entry-loading') {
            if(next){ 
                if(debug) console.log('try', next);
                for(var i=0; i<entries.length; i++){
                    if(debug) console.warn('ping');
                    if(entries[i].name == next){
                        if(debug) console.warn('ping');
                        var nentries = []
                        if(typeof(entries[i].renderer)=='function'){
                            if(debug) console.warn('ping');
                            nentries = entries[i].renderer(entries[i])
                        } else {
                            if(debug) console.warn('ping');
                            if(typeof(entries[i].entries) != 'undefined'){
                                nentries = entries[i].entries;
                            }
                            if(debug) console.warn('ping');
                            if(typeof(entries[i].callback) == 'function'){
                                entries[i].callback()
                            }
                            if(debug) console.warn('ping');
                        }
                        if(debug) console.warn('ping', nentries);
                        return enter(nentries, path.shift())
                    }
                }
                if(debug) console.log('tried');
            } else {
                listingPath = fullPath;
                if(debug) console.log('no more', listingPath, path, entries);
                var container = getListContainer(true); // just to reset entries in view
                backEntryRender(container, dirname(fullPath));
                listEntries(entries, fullPath);
                if(debug) console.warn('listed', entries);
                cb()
            }
        } else {
            if(retries){
                if(debug) console.log('retry');
                retries--;
                setTimeout(() => {
                    enter(entries, next) 
                }, ms)
            } else {
                cb()
            }
        }
    }
    enter(index, path.shift())
}

function goHistory(){
    getFrame('controls').listEntriesByPathTriggering(Lang.EXTRAS+'/'+Lang.HISTORY)
}

function isListed(name, entries){
    if(!entries){
        entries = jQuery('a.entry').map((i, o) => {
            return jQuery(o).data('entry-data')
        })
    }
    if(typeof(entries.toArray)=='function'){
        entries = entries.toArray();
    }
    return entries.filter((e) => { 
        //console.log(e.name+' === '+name, e, this); 
        return e.name ==  name }).length;
}

function allowAutoClean(curPath){
    // should append autoclean in this path?
    var offerAutoClean = false, autoCleanAllowPaths = [Lang.CHANNELS, Lang.MY_LISTS, Lang.SEARCH], ignorePaths = [Lang.BEEN_WATCHED, Lang.HISTORY, Lang.RECORDINGS, Lang.BOOKMARKS];
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
        var firstStreamEntryOffset = -1, nentries = [];
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
            if(['stream', 'group'].indexOf(type)!=-1 && !parentalControlAllow(entries[i])){
                console.log('PARENTAL CONTROL BLOCKED', entries[i]);
                continue;
            }
            if(type=='stream' && !isMega(entries[i].url)){
                var entry = Object.assign({}, entries[i]); // do not modify the original
                if(!showLogos){
                    entry.logo = defaultIcons['stream'];
                }
                if(!entry.name && entry.label){
                    entry.name = entry.label; // try to fill empty names
                }
                if(firstStreamEntryOffset == -1){
                    firstStreamEntryOffset = nentries.length;
                }
                nentries.push(entry) // not a stream entry
            } else {
                nentries.push(entries[i]) // not a stream entry
            }
        }                
        //console.log('POSFILTERED', entries);
        if(firstStreamEntryOffset != -1 && allowAutoClean(listingPath)) {
            var n = (autoCleanEntriesRunning() && autoCleanEntriesStatus && autoCleanEntriesStatus.indexOf('100%')==-1) ? autoCleanEntriesStatus : Lang.TEST_THEM_ALL;
            nentries.splice(firstStreamEntryOffset, 0, {type: 'option', name: n, label: Lang.AUTOCLEAN, logo: 'fa-magic', class: 'entry-autoclean', callback: () => {
                if(autoCleanEntriesRunning()){
                    autoCleanEntriesCancel()
                } else {
                    autoCleanEntries();
                }
                refreshListing()
            }})
        }
        jQuery('.entry-empty').remove();
        console.log('FILTERED', nentries, entries);
        return nentries;
    });
    addFilter('filterEntries', listManJoinDuplicates);
})