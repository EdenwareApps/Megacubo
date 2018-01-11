
function readSourcesToIndex(callback){
    window.channelsIndex = window.channelsIndex || {};
    var sources = getSources(), activeSrc = getActiveSource(), fetchCallback = (content, parsed, url) => {
        window.channelsIndex[url] = parsed;
        //console.log(parsed);
        if(typeof(window.index)=='object' && url == activeSrc){
            var entries = window.channelsIndex[url];
            if(!entries.length){
                entries.push({name: Lang.EMPTY, logo:'fa-files-o', type: 'option'})
            }
            if(sources.length > 1){
                entries.push({name: Lang.OTHER_PACKAGES, logo: 'fa-plus-square', type: 'group', entries: [], renderer: () => {
                    return getPackagesEntries(true, true)
                }})
            }
            window.index = writeIndexPathEntries(Lang.CHANNELS, entries);
            var locale = getLocale(false, true), length = getSourceMeta(url, 'length') || 0;
            window.index[0].label = Number(length).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase();
            if(typeof(callback)=='function'){
                callback()
            }
        }
    }
    if(!sources.length || !activeSrc){
        fetchCallback('', [], '')
    } else {
        fetchAndParseIPTVListFromAddr(activeSrc, fetchCallback)
        for(var i in sources){
            if(sources[i][1] != activeSrc){
                fetchAndParseIPTVListFromAddr(sources[i][1], fetchCallback)
            }
        }
    }
}

// mergeEntriesWithNoCollision([{name:'1',type:'group', entries:[1,2,3]}], [{name:'1',type:'group', entries:[4,5,6]}])
function mergeEntriesWithNoCollision(leveledIndex, leveledEntries){
    var ok;
    if(leveledIndex instanceof Array && leveledEntries instanceof Array){
        for(var j=0;j<leveledEntries.length;j++){
            ok = false;
            for(var i=0;i<leveledIndex.length;i++){
                if(leveledIndex[i].type==leveledEntries[j].type && leveledIndex[i].name==leveledEntries[j].name){
                    //console.log('LEVELING', leveledIndex[i], leveledEntries[j])
                    leveledIndex[i].entries = mergeEntriesWithNoCollision(leveledIndex[i].entries, leveledEntries[j].entries);
                    ok = true;
                    break;
                }
            }
            if(!ok){
                //console.log('NOMATCH FOR '+leveledEntries[j].name, leveledIndex, leveledEntries[j]);
                leveledIndex.push(leveledEntries[j]);
                //console.log('noMATCH' , JSON.stringify(leveledIndex).substr(0, 128));
            }
        }
    }
    return leveledIndex;
}

function buildPathStructure(path, group){ // group is entry object of type "group" to be put as last location, create the intermediaries
    var groupEntryTemplate = {name: '', path: '', type: 'group', label: '', entries: []};
    path = path.replace(new RegExp('\\+'), '/');
    var paths = path.split('/');
    var structure = group;
    for(var i=(paths.length - 2);i>=0;i--){
        //console.log(structure);
        var entry = groupEntryTemplate;
        entry.entries = [Object.assign({}, structure)];
        entry.name = paths[i];
        entry.label = '';
        entry.path = paths.slice(0, i + 1).join('/');
        structure = entry;
    }
    return [structure];
}

function entryInsertAtPath(_index, groupname, group){ // group is entry object of type "group" to be put as last location, create the intermediaries, groupname is like a path
    var structure = buildPathStructure(groupname, group);
    
    //console.log('AFTER '+groupname, group, structure);
    //console.log('RRR');
    //findCircularRefs([structure]);
    //console.log('SSS');

    _index = mergeEntriesWithNoCollision(_index, structure);
    
    //console.log('XXX');
    //findCircularRefs(_index);
    //console.log('ZZZ');

    return _index;
}

function listEntryRender(entry, container, tabIndexOffset){
    //console.log(entry);
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
    var logo = entry.logo || defaultIcons[entry.type];
    var html = menuTemplates[entry.type];
    html = html.replace('<a ', '<a tabindex="'+tabIndexOffset+'" ').replace('<input ', '<input tabindex="'+tabIndexOffset+'" ');
    html = html.replaceAll('[name]', entry.name);
    if(html.indexOf('[format-name]')!=-1){
        html = html.replaceAll('[format-name]', parseM3U8ColorsTag(entry.rawname)||entry.name);
    }
    if(logo.substr(0, 3)=="fa-"){
        html = html.replace(new RegExp('<img[^>]+>', 'mi'), '<i class="fa '+logo+' fa-as-entry-logo" aria-hidden="true"></i>')
    } else {
        html = html.replaceAll('[logo]', logo);
        html = html.replaceAll('[default-logo]', defaultIcons[entry.type])
    }
    html = html.replaceAll('[group]', entry.group || '');
    html = html.replaceAll('[label]', entry.label || entry.group || '');
    html = html.replaceAll('[class]', entry.class || '');
    html = html.replaceAll('[url]', entry.url||'javascript:;');
    //console.log(html, entry);
    var jEntry = jQuery(html).data('entry-data', entry).appendTo(container);
    jEntry.on('click', function (){
        var data = jQuery(this).data('entry-data');
        triggerEntry(data, this)
    });
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
            });
        }
        jEntry.on('focus', function (){
            this.querySelector('input').focus()
        })
    } else if(entry.type == 'check') {
        var checked = typeof(entry.checked)!='undefined' && entry.checked;
        var handleChecking = function (element, docheck){
            element.find('i.fa').removeClass(docheck?'fa-toggle-off':'fa-toggle-on').addClass(docheck?'fa-toggle-on':'fa-toggle-off').css('opacity', docheck ? 1 : 0.5);
        }, checkCallback = entry.check || false;
        handleChecking(jEntry, checked);
        jEntry.on('click', function (){
            checked = !checked;
            handleChecking(jEntry, checked);
            if(checkCallback) checkCallback(checked)
        })
    }
    jEntry.on('mouseenter', function (){
        clearTimeout(listEntryFocusOnMouseEnterTimer);
        var e = this;
        listEntryFocusOnMouseEnterTimer = setTimeout(function (){
            e.focus()
        }, 250);
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
            input.trigger('focus').trigger('select').on('blur', function (){
                var newName = input.val();
                if(newName && newName!=name.text()){
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
        }
    }
}

function writeIndexPathEntries(path, entries, _index){
    if(path.charAt(0)=='/') path = path.substr(1);
    var name = getRootFolderFromStr(path);
    if(typeof(_index)=='undefined'){
        _index = index;
    }
    //alert('SEARCH '+name+', '+path);
    for(var k in _index){
        //console.log(name);
        if(typeof(_index[k]['name'])=='string' && _index[k]['name']==name){
            //alert('KEY '+k+', '+name+', '+path);
            if(name == path){
                _index[k].entries = entries;
            } else {
                _index[k].entries = writeIndexPathEntries(stripRootFolderFromStr(path), entries, _index[k].entries);
            }
        }
    }
    return _index;
}

function readIndexSubEntries(_index, name){
    for(var k in _index){
        if(typeof(_index[k]['name'])=='string' && _index[k]['name']==name){
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
        if(sub instanceof Array){
            sub = readIndexSubEntries(sub, paths[i]) || [];
        } else {
            sub = sub[paths[i]] || [];
        }
        //console.log(paths[i], sub);
        if(sub instanceof Array){
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

var menuTemplates = {
    'option': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'input': '<a href="[url]" onclick="return false;" class="entry entry-input"><table class="entry-search"><tr><td><input type="text" style="background-image: url([logo]);" /></td><td class="entry-logo-c">...</td></tr></table></a>', // entry-input-container entry-search-helper
    'check': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><i class="fa fa-toggle-off fa-as-entry-logo" aria-hidden="true"></i></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'stream': '<a href="[url]" onclick="return false;" class="entry entry-stream"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[default-logo]" lazy-src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[format-name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'back': '<a href="[url]" onclick="return false;" class="entry entry-back [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" /></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'group': '<a href="[url]" onclick="return false;" class="entry entry-group [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="nextLogo(this)" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>'
};

var defaultIcons = {
    'option': 'fa-cog',
    'input': 'assets/icons/white/search-dark.png',
    'stream': 'assets/icons/white/default-channel.png',
    'back': 'fa-chevron-left',
    'check': 'fa-toggle-off',
    'group': 'assets/icons/white/default-channel.png'
};

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
    var container = getListContainer(false);
    var tabIndexOffset = getTabIndexOffset();
    for(var i=0;i<entries.length;i++){
        entries[i].path = path;
        listEntryRender(entries[i], container, tabIndexOffset);
        tabIndexOffset++;
    }
    revealChannelsLogo();
}

var lastParentEntry = 0;

function refreshListing(){
    var entry = listingPath ? getPathTriggerer(listingPath) : false;
    if(entry) {
        triggerEntry(entry)
    } else {
        listEntriesByPath(listingPath)
    }
}

function refreshListingIfMatch(needle){
    if(listingPath.indexOf(needle)!=-1){
        refreshListing()
    }
}

function listEntriesByPath(path, append, nofx){
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
    listingPath = path;
    var container = getListContainer(!append), entry;
    if(!path) path = '';
    if(path.charAt(0)=='/') path = path.substr(1);
    console.log(path);
    if(path){
        jQuery('body').removeClass('home')
    } else {
        jQuery('body').addClass('home')
    }
    list = readIndexPath(path);
    console.log(list);
    if(!(list instanceof Array)){
        list = [list];
    }
    if(!append){
        if(path.length) {
            backEntryRender(container, dirname(path));
        }
    }
    listEntries(list, path);
    updateStreamEntriesFlags();
    if(!append){
        container.find('a:eq(0)').trigger('focus')
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

function triggerEntry(data, element){
    if(data.type == 'back'){
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
            console.log('!! PARENT ENTRY NOT FOUND', data.path);
        }
    }
    if(typeof(data.path)=='undefined'){
        data.path = '';
    }
    if(typeof(data.renderer)=='function'){
        var entries = data.renderer(data, element);
        if(!(entries instanceof Array)){
            console.log('!! RENDERER DIDNT RETURNS A ARRAY', entries, data.path);
        } else {
            console.log('WW', data.path+'/'+data.name, entries);
            window.index = writeIndexPathEntries(data.path+'/'+data.name, entries);
        }
    }
    if(data.type == 'group'){
        console.log(data.path+'/'+data.name);
        listEntriesByPath(data.path+'/'+data.name)
    } else if (data.type == 'back') {
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
    var fas = jQuery('.entry'), term = top.window.decodeEntities(term).toLowerCase(), isPath = (term.indexOf('//') != -1 || term.indexOf(':\\') != -1 || term.indexOf(':/') != -1);
    fas = fas.filter(function (){
        var stub = '';
        if(isPath){
            stub += jQuery(this).attr('href').toLowerCase();
        } else {
            stub += jQuery(this).find('.entry-name').html().toLowerCase();
        }
        var h = top.window.decodeEntities(stub);
        if(h.indexOf(term) == -1){
            //console.log(stub, term);
            return false;
        }
        return true;
    });
    return fas;
}

function findActiveEntries(term){
    var fas = jQuery('.entry-status i.fa'), term = top.window.decodeEntities(term);
    fas = fas.map(function (){
        return jQuery(this).parents('.entry').get(0);
    });
    fas = fas.filter(function (){
        var h = top.window.decodeEntities(this.outerHTML);
        if(h.indexOf(term) == -1){
            return false;
        }
        return true;
    });
    return fas;
}

function removeLoadingFlags(){
    var fa = 'fa-circle-o-notch', entries = findActiveEntries(fa);
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
    var entries = findEntries(locale).add(findEntries(slocale));
    for(var i=0;i<entries.length;i++){
        console.log('SET-'+i);
        setEntryFlag(entries[i], fa);
        break;
    }
}


var searchKeypressTimer = 0, lastSearchTerm = '';

function showSearchField(term){
    var container = getListContainer(true);
    backEntryRender(container, '/');
    var entry = {
        type: 'input',
        change: function (entry, element, val){
            if(val){
                lastSearchTerm = val;
            }
            clearTimeout(searchKeypressTimer);
            searchKeypressTimer = setTimeout(function (){
                clearTimeout(searchKeypressTimer);
                var r = fetchSearchResults();
                container.find('a.entry-stream').remove();
                listEntries(r, Lang.SEARCH);
            }, 400);
        }
    };    
    var element = listEntryRender(entry, container);
    if(lastSearchTerm){
        element.find('input').trigger('focus').val(lastSearchTerm).trigger('input');
    }
}

function fetchSearchResults(){
    var c = jQuery('.list > div > div');
    var q = c.find('input').val().toLowerCase();
    var r = [];
    if(q.length){
        for(var list in flatChannelsList){
            for(var i in flatChannelsList[list]){
                if(r.length >= 20) break;
                if(flatChannelsList[list][i].name.toLowerCase().indexOf(q)!=-1){
                    r.push(flatChannelsList[list][i]);
                }
            }
        }
    }
    return r;
}

function hideSearchField(){
    var c = jQuery('.list > div > div');
    c.html('');
    jQuery('.entry-search').remove(c);
    if(!c.find('a').length){
        listEntriesByPath();
    }
}

function focusPrevious(){
    var as = getListContainer().find('a');
    console.log(lastTabIndex, document.activeElement);
    var ni = (lastTabIndex <= 0) ? (as.length - 1) : (lastTabIndex - 2);
    as.eq(ni).trigger('focus')
    console.log(ni)
}

function focusNext(){
    var as = getListContainer().find('a');
    console.log(lastTabIndex, document.activeElement);
    var ni = (lastTabIndex >= as.length) ? 0 : lastTabIndex;
    as.eq(ni).trigger('focus')
    console.log(ni)
}

function triggerEntryAction(type){
    jQuery(document.activeElement).trigger(type);
}

function triggerEnter(){
    document.activeElement.click()
}

function triggerBack(){
    var b = getListContainer().find('.entry-back');
    if(b && b.length){
        b.trigger('click')
    } else {
        hideControls()
    }
}

var listingPath = Store.get('listingPath');
jQuery(window).on('unload', function (){
    Store.set('listingPath', listingPath)
})
