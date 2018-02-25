
var menuTemplates = {
    'option': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'disabled': '<a href="[url]" onclick="return false;" class="entry entry-disabled entry-offline [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'input': '<a href="[url]" onclick="return false;" class="entry entry-input"><table class="entry-search"><tr><td><input type="text" style="background-image: url([logo]);" /></td><td class="entry-logo-c"></td></tr></table></a>', // entry-input-container entry-search-helper
    'check': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><i class="fas fa-toggle-off entry-logo-fa" aria-hidden="true"></i></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'stream': '<a href="[url]" onclick="return false;" class="entry entry-stream [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" data-lazy-src="[lazy-logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[format-name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'back': '<a href="[url]" onclick="return false;" class="entry entry-back [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" /></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'group': '<a href="[url]" onclick="return false;" class="entry entry-group [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>' // onerror="nextLogoForGroup(this)" 
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
    if(path.indexOf(name)!=-1){
        path = path.trim('/').split('/');
        if(path.length > 1 && path[path.length - 2] == name){
            path[path.length - 2] = false;
            path[path.length - 1] = false;
        } else if(path.length > 0 && path[path.length - 1] == name){
            path[path.length - 1] = false;
        }
        path = path.filter(function (item) {
            return item !== undefined && item !== null && item !== false;
        }).join('/')
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

function listEntryRender(entry, container, tabIndexOffset){
    //console.log(entry);
    if(entry == null || typeof(entry)!='object'){
        console.log('BAD BAD ENTRY', entry, typeof(entry));
        return;
    }
    if(typeof(tabIndexOffset)!='number'){
        tabIndexOffset = getTabIndexOffset()
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
    var html = menuTemplates[entry.type];
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
    html = html.replaceAll('[url]', entry.url||'javascript:;');
    console.log(html, entry);
    var jEntry = jQuery(html).data('entry-data', entry).appendTo(container);
    if(entry.type != 'disabled'){
        jEntry.on('mousedown', function (){
            var data = jQuery(this).data('entry-data');
            triggerEntry(data, this)
        });
        jEntry.on('contextmenu', function (event){
            event.preventDefault();
            renameSelectedEntry();
            return false;
        })
    }
    var actions = ['delete', 'rename'];
    for(var i=0;i<actions.length;i++){
        if(entry[actions[i]]){
            jEntry.on(actions[i], function (event){
                entry[event.type](entry, this);
            });
        }
    }
    if(entry.type == 'input'){
        if(entry['change']){
            jEntry.find('input').on('input', function(){
                jQuery('body').trigger('wake');
                entry['change'](entry, this, this.value);
            })
        }
        if(entry['value']){
            jEntry.find('input').val(entry['value'])
        }
        if(entry['placeholder']){
            jEntry.find('input').prop('placeholder', entry['placeholder'])
        }
        jEntry.on('focus', function (){
            this.querySelector('input').focus()
        })
    } else if(entry.type == 'check') {
        var checked = typeof(entry.checked)!='undefined' && entry.checked();
        var handleChecking = function (element, docheck){
            element.css('opacity', docheck ? 1 : 0.75).find('svg, i:eq(0)').replaceWith('<i class="fas '+(docheck?'fa-toggle-on':'fa-toggle-off')+' entry-logo-fa" aria-hidden="true"></i>');
        }, checkCallback = entry.check || false;
        handleChecking(jEntry, checked);
        jEntry.on('mousedown', function (){
            checked = !checked;
            handleChecking(jEntry, checked);
            if(checkCallback) checkCallback(checked)
        })
    }
    jEntry.on('mouseenter', function (){
        clearTimeout(listEntryFocusOnMouseEnterTimer);
        var e = this;
        listEntryFocusOnMouseEnterTimer = setTimeout(function (){
            focusEntryItem(jQuery(e), true)
        }, 600);
    })
    return jEntry;
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
        console.log('SEARCH '+name+', '+path, entries)
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
                    console.log('ENTER '+k+', '+name+', '+path)
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
        $container.css('vertical-align', 'middle').html('');
        lastTabIndex = 1;
    }
    return $container;
}

function listEntries(entries, path){
    var lst = jQuery('.list'), top = lst.prop('scrollTop'), inSearch = (listingPath.indexOf(Lang.SEARCH) != -1);
    console.log('LISTENTRIES', entries, path, traceback());
    var container = getListContainer(false);
    var tabIndexOffset = getTabIndexOffset();
    entries = applyFilters('filterEntries', entries, path);
    console.log('LISTENTRIES', entries, path, traceback());
    for(var i=0;i<entries.length;i++){
        entries[i].path = path;
        listEntryRender(entries[i], container, tabIndexOffset);
        tabIndexOffset++;
        console.log('LISTENTRIES', entries[i], container.html().substr(0, 24));
    }
    console.log('LISTENTRIES', container.html());
    var rescroll = () => {
        lst.prop('scrollTop', top);
        if(top && lst.prop('scrollTop')<top && lst.height() > top){
            setTimeout(rescroll, 33)
        }
    }
    setTimeout(rescroll, 0);
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
            triggerEntry(entry)
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
            console.error(jqXHR, textStatus, errorThrown);
            callback(data)
        })
    } else {
        callback(data)
    }
}

function fetchAndRenderEntries(url, name, filter, callback){
    //listingPath = '/'+Lang.SEARCH;
    var path = assumePath(name);
    console.log('FETCH', url, name, path);
    var container = getListContainer(true);
    backEntryRender(container, dirname(path));
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-warning', 'normal');
        triggerBack()
    }
    setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
        fetchEntries(url, (options) => {
            if(options.length){
                console.log(options);
                if(typeof(filter)=='function'){
                    options = options.map(filter)
                }
                jQuery('.entry:not(.entry-back)').remove();
                console.log(options, name, path);
                index = writeIndexPathEntries(path, options, index);
                listEntriesByPath(path);
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

function fetchAndRenderWatchingEntries(name, filter, callback){
    //listingPath = '/'+Lang.SEARCH;
    var path = assumePath(name);
    console.log('FETCH WATCHING', name, path);
    var container = getListContainer(true);
    backEntryRender(container, dirname(path));
    var failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-warning', 'normal');
        triggerBack()
    }
    setTimeout(() => { // avoid mess the loading entry returned, getting overridden by him
        getWatchingData((options) => {
            if(options.length){
                console.log(options);
                if(typeof(filter)=='function'){
                    options = options.map(filter)
                }
                jQuery('.entry:not(.entry-back)').remove();
                console.log(options, name, path);
                index = writeIndexPathEntries(path, options, index);
                listEntriesByPath(path);
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
    if(!append && path.indexOf(Lang.SEARCH+'/') != -1){
        return listEntriesByPathTriggering(path, cb)
    }
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
    if(listingPath.length < path.length){ // Entering
        lastParentEntry = listingPath;
    }
    console.log(path);
    listingPath = path = ltrimPathBar(path);
    var container = getListContainer(!append), entry;
    if(typeof(path)!='string'){
        path = '';
    }
    console.log(path);
    if(path){
        jQuery('body').removeClass('home')
    } else {
        jQuery('body').addClass('home')
    }
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
    updateStreamEntriesFlags();
    if(!append){
        container.find('a:eq(0)').trigger('focus')
    }
    if(typeof(cb)=='function'){
        cb()
    }
}

function backEntryRender(container, backPath){
    container.css('vertical-align', 'top');
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
    listEntryRender(back, container, 1)
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
            }, 150)
        }
        var parentEntry = getPathTriggerer(data.path);
        if(parentEntry){
            console.log('!! PARENT ENTRY FOUND', parentEntry, dirname(data.path));
            parentEntry.path = dirname(data.path);
            data = parentEntry;
        } else {
            console.log('!! PARENT ENTRY NOT FOUND', data.path, listingPath);
            //return listEntriesByPath(dirname(listingPath))
        }
    }
    if(typeof(data.path)=='undefined'){
        data.path = '';
    }
    var npath = ltrimPathBar(data.path+'/'+data.name);
    if(typeof(data.renderer)=='function'){
        var entries = data.renderer(data, element);
        if(!jQuery.isArray(entries)){
            console.log('!! RENDERER DIDNT RETURNS A ARRAY', entries, data.path);
        } else {
            console.log('WW', npath, entries);
            //console.log(window.index);
            window.index = writeIndexPathEntries(npath, entries);
            //console.log(window.index)
        }
    }
    if(data.type == 'group'){
        console.log(npath);
        listEntriesByPath(npath)
    } else if (data.type == 'back') { // parent entry not found
        console.log(data.path);
        listEntriesByPath(data.path)
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
            if(lastListScrollTop){
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
    }
    var entry = {
        type: 'input',
        change: function (entry, element, val){
            var np = container.find('a.entry-input');
            lastSearchTerm = val;
            Store.set('last-search-term', val);
            clearTimeout(searchKeypressTimer);
            container.find('a.entry-stream, a.entry-loading, a.entry-autoclean').remove();
            listEntries([getLoadingEntry()], listingPath);
            focusEntryItem(np);
            np.find('input').get(0).focus();
            searchKeypressTimer = setTimeout(() => {
                clearTimeout(searchKeypressTimer);
                var r;
                switch(type){
                    case "live":
                        if(val.length){
                            r = fetchSharedListsSearchResults();
                            r = r.filter((entry) => {
                                return !entry.isvideo;
                            }).concat(r.filter((entry) => {
                                return entry.isvideo;
                            }))
                        } else {
                            r = getWatchingData().filter((entry) => { return isLive(entry.url) });
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
                        } else {
                            r = getWatchingData().filter((entry) => { return isMagnet(entry.url) });
                        }
                        break;
                    case "video":
                        if(val.length){
                            r = fetchVideoSearchResults();
                        } else {
                            r = getWatchingData().filter((entry) => { return isVideo(entry.url) && !isMagnet(entry.url) });
                        }
                        break;
                    default:
                        r = []; //fetchSearchResults();
                        break;
                }
                r = orderEntriesByWatching(r);
                container.find('a.entry-stream, a.entry-loading, a.entry-autoclean').remove();
                console.log('QQQ', r, val, type, listingPath);
                listEntries(r, listingPath);
                focusEntryItem(np);
                np.find('input').get(0).focus();
                if(val.length > 2){
                    top.sendStats('search', {query: val, type: type})
                }
            }, 600);
        },
        value: lastSearchTerm,
        placeholder: Lang.SEARCH_PLACEHOLDER
    };    
    var element = listEntryRender(entry, container);
    if(element){
        element.find('input').trigger('focus').trigger('input')
    }
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
            btdb.search(q+' mp4').then(function (data) {
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
                entries = orderEntriesByWatching(entries);
                listEntries(entries, listingPath);
            });
            /*
             [{ magnet: 'magnet:?xt=urn:btih:8D2F56F13D1C52B866B26DE726716163A01D2BB6&dn=Lubuntu+12.10+from+LXDE+and+Ubuntu&tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80&tr=udp%3A%2F%2Fopen.demonii.com%3A1337&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce',
                name: 'Lubuntu 12.10 from LXDE and Ubuntu',
                size: '692.29 MB',
                popularity: '1099' }]
            */
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
                    console.log('HOORAY', entries);
                    sharedListsSearchIndex[url] = entries;
                    completeIterator++;
                    if(typeof(Lang.SEARCH)!='undefined' && listingPath.indexOf(Lang.SEARCH+'/'+Lang.COMPLETE_SEARCH)!=-1){ // do we still in the search view?
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
                var maybe = [], terms = term.split(' ').filter((s) => { return s.length > 2; });
                if(terms.length >= 1){ 
                    for(var list in sharedListsSearchIndex){
                        for(var n in sharedListsSearchIndex[list]){
                            if(r.length >= limit) break;
                            if(type && ['video', 'stream'].indexOf(type) != -1){
                                if(type =='video' && !sharedListsSearchIndex[list][n].isvideo){
                                    continue;
                                }
                                if(type =='stream' && sharedListsSearchIndex[list][n].isvideo){
                                    continue;
                                }
                            }
                            var hits = 0;
                            for(var i in terms){
                                if(sharedListsSearchIndex[list][n].searchTerms.indexOf(terms[i])!=-1){
                                    hits++;
                                }
                            }
                            if(hits){
                                sharedListsSearchIndex[list][n].source = list;
                                if(hits == terms.length){
                                    r.push(sharedListsSearchIndex[list][n]);
                                } else if(!matchAll) {
                                    maybe.push(sharedListsSearchIndex[list][n])
                                }
                            }
                        }
                    }
                    if(r.length < limit){
                        r = r.concat(maybe.slice(0, limit - r.length))
                    }
                    sharedListsSearchCaching = {type: type, query: term, entries: r};
                }
            }
        }
        return r;
    } else {
        console.log('SSSS');
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
        hideControls()
    }
}

function listEntriesByPathTriggering(path, cb){
    var c = getFrame('controls'), ms = 25, e = jQuery('.list > div').hide(), retries = 10;
    c.listEntriesByPath('');
    path = path.split('/');
    var nav = () => {
        if(path.length){ 
            if(e.find('.entry-loading').length){
                e.show();
                setTimeout(nav, ms)
            } else {
                var next = path.shift();
                if(next){
                    var ns = c.findEntriesByName(next, true);
                    if(ns.length){
                        ns.trigger('mousedown');
                        if(path.length){
                            setTimeout(nav, ms)
                        } else {
                            e.show();
                            if(typeof(cb)=='function'){
                                cb()
                            }
                        }
                    } else if(retries) {
                        path.unshift(next);
                        setTimeout(nav, ms)
                    } else {
                        e.show();
                        if(typeof(cb)=='function'){
                            cb()
                        }
                    }
                } else {
                    e.show();
                    if(typeof(cb)=='function'){
                        cb()
                    }
                }
            }
        } else {
            e.show();
            if(typeof(cb)=='function'){
                cb()
            }
        }
    }
    setTimeout(nav, ms)
}

function goHistory(){
    getFrame('controls').listEntriesByPathTriggering(Lang.BOOKMARKS_EXTRAS+'/'+Lang.HISTORY)
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

var showLogos = !Config.get('hide-logos');  
jQuery(() => {    
    addFilter('filterEntries', (entries, path) => {
        //console.log('PREFILTERED', entries);
        var hasLiveEntries = false, firstGroupEntryOffset = -1, firstStreamEntryOffset = -1, logosToCheck = [], nentries = [], offlineURLs = getOfflineStreamsURLs(), offline = [], forceClean = false, isStreamsListing = false;
        for(var i=0; i<entries.length; i++){
            // entry properties are randomly(?!) coming as buffers instead of strings, treat it until we discover the reason
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
            if(!parentalControlAllow(entries[i])){
                console.log('PARENTAL CONTROL BLOCKED', entries[i]);
                continue;
            }
            if(entries[i] && typeof(entries[i].type)=='string' && entries[i].type=='stream'){
                var entry = Object.assign({}, entries[i]); // do not modify the original
                if(!isStreamsListing){
                    isStreamsListing = true;
                }
                if(!showLogos){
                    entry.logo = defaultIcons['stream'];
                }
                if(!entry.name && entry.label){
                    entry.name = entry.label; // try to fill empty names
                }
                if(offlineURLs.indexOf(entry.url)!=-1){
                    entry.offline = true;
                    if(typeof(entry.label) != 'string'){
                        entry.label = '';
                    }
                    if(entry.label.indexOf(offLabel)==-1){
                        entry.label += offLabel;
                    }
                    offline.push(entry)
                } else {
                    entry.offline = false;
                    if(typeof(entry.label)!='undefined' && entry.label.indexOf(offLabel)!=-1){
                        entry.label = entry.label.replace(offLabel, '')
                    }
                    if(firstGroupEntryOffset == -1){
                        nentries.push(entry);
                        if(firstStreamEntryOffset == -1){
                            firstStreamEntryOffset = nentries.length - 1;
                        }
                    } else {
                        console.log('SPLICE', firstGroupEntryOffset, entry);
                        nentries.splice(firstGroupEntryOffset, 0, entry);
                        if(firstStreamEntryOffset == -1){
                            firstStreamEntryOffset = firstGroupEntryOffset;
                        }
                        firstGroupEntryOffset++;
                    }
                   if(!hasLiveEntries && listingPath){
                        if(isLive(entry.url)){
                            hasLiveEntries = true;
                        }
                    }
                }
            } else {
                nentries.push(entries[i]) // not a stream entry
                if(firstGroupEntryOffset == -1 && entries[i].type == 'group' && entries[i].entries && entries[i].entries.length){
                    firstGroupEntryOffset = nentries.length - 1;
                }
            }
        }
        //console.log('MIDFILTERED', entries);
        if(offline.length){
            nentries = nentries.filter(function (item) {
                return !!item;
            }).concat(offline)          
        }
                
        //console.log('POSFILTERED', entries);
        jQuery('.entry-empty').remove();
        if(!nentries.length){
            nentries.push({name: Lang.EMPTY, logo:'far fa-file', type: 'option', class: 'entry-empty'})
        } else if(hasLiveEntries && listingPath.indexOf(Lang.BEEN_WATCHED) == -1) {
            var n = (autoCleanEntriesStatus && autoCleanEntriesStatus.indexOf('100%')==-1) ? autoCleanEntriesStatus : Lang.TEST_THEM_ALL;
            nentries.splice(firstStreamEntryOffset, 0, {type: 'option', name: n, label: Lang.AUTOCLEAN, logo: 'fa-magic', class: 'entry-autoclean', callback: autoCleanEntries})
        }
        console.log('FILTERED', nentries, entries, offline);
        return nentries;
    });
    addFilter('filterEntries', listManJoinDuplicates);
})