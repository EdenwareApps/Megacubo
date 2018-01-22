
var menuTemplates = {
    'option': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'disabled': '<a href="[url]" onclick="return false;" class="entry entry-disabled entry-offline [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'input': '<a href="[url]" onclick="return false;" class="entry entry-input"><table class="entry-search"><tr><td><input type="text" style="background-image: url([logo]);" /></td><td class="entry-logo-c">...</td></tr></table></a>', // entry-input-container entry-search-helper
    'check': '<a href="[url]" onclick="return false;" class="entry entry-option [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><i class="fa fa-toggle-off fa-as-entry-logo" aria-hidden="true"></i></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'stream': '<a href="[url]" onclick="return false;" class="entry entry-stream [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[default-logo]" lazy-src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" /></span></td><td><span class="entry-name">[format-name]</span><span class="entry-label">[label]</span></td></tr></table></a>',
    'back': '<a href="[url]" onclick="return false;" class="entry entry-back [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" /></span></td><td><span class="entry-name">[name]</span></td></tr></table></a>',
    'group': '<a href="[url]" onclick="return false;" class="entry entry-group [class]"><table><tr><td class="entry-logo-c"><span class="entry-logo"><span class="entry-status"><span></span></span><img src="[logo]" title="[name] - [group]" onerror="nextLogoForGroup(this)" /></span></td><td><span class="entry-name">[name]</span><span class="entry-label">[label]</span></td></tr></table></a>'
};

var defaultIcons = {
    'option': 'fa-cog',
    'input': 'assets/icons/white/search-dark.png',
    'stream': 'assets/icons/white/default-channel.png',
    'back': 'fa-chevron-left',
    'check': 'fa-toggle-off',
    'group': 'assets/icons/white/default-channel.png'
};

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
                entries.push({name: Lang.OTHER_LISTS, logo: 'fa-plus-square', type: 'group', entries: [], renderer: () => {
                    return getListsEntries(true, true)
                }})
            }
            window.index = writeIndexPathEntries(Lang.CHANNELS, entries);
            var locale = getLocale(false, true), length = getSourceMeta(url, 'length') || 0;
            updateRootEntry(Lang.CHANNELS, {label: Number(length).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase()});
            if(typeof(callback)=='function'){
                callback()
            }
            if(isLoadingEntryRendered()){
                refreshListingIfMatch(Lang.CHANNELS)
            }
        }
    }
    if(!Object.values(window.channelsIndex).length){ // first run on program open
        updateRootEntry(Lang.CHANNELS, {entries: [getLoadingEntry()]})
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

function getLoadingEntry(){
    return {
        type: 'option',
        name: Lang.PROCESSING,
        label: '',
        logo: 'fa-spin fa-circle-o-notch',
        class: 'entry-loading'
    }
}

function isLoadingEntryRendered(){
    return !!jQuery('.entry-loading').length;
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
    if(entry.offline === true){
        entry.class = (entry.class || '') + ' entry-offline';
    } else {
        if(entry.class && entry.class.indexOf('entry-offline')!=-1){
            entry.class = entry.class.replace('entry-offline', '')
        }
    }
    var logo = entry.logo || defaultIcons[entry.type];
    var html = menuTemplates[entry.type];
    html = html.replace('<a ', '<a tabindex="'+tabIndexOffset+'" ').replace('<input ', '<input tabindex="'+tabIndexOffset+'" ');
    html = html.replaceAll('[name]', entry.name);
    if(html.indexOf('[format-name]')!=-1){
        html = html.replaceAll('[format-name]', entry.rawname ? parseM3U8NameTags(entry.rawname) : entry.name);
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
    if(entry.type != 'disabled'){
        jEntry.on('click', function (){
            var data = jQuery(this).data('entry-data');
            triggerEntry(data, this)
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
        jEntry.on('focus', function (){
            this.querySelector('input').focus()
        })
    } else if(entry.type == 'check') {
        var checked = typeof(entry.checked)!='undefined' && entry.checked();
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
    var name = getRootFolderFromStr(path);
    if(typeof(_index)=='undefined'){
        _index = index;
    }
    console.log('SEARCH '+name+', '+path);
    for(var k in _index){
        console.log(name);
        if(typeof(_index[k]['name'])=='string' && _index[k]['name']==name){
            console.log('KEY '+k+', '+name+', '+path);
            if(name == path){
                console.log('OK '+k+', '+name+', '+path);
                _index[k].entries = entries;
            } else {
                console.log('ENTER '+k+', '+name+', '+path);
                _index[k].entries = writeIndexPathEntries(ltrimPathBar(stripRootFolderFromStr(path)), entries, _index[k].entries);
            }
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
    for(var i=0;i<entries.length;i++){
        entries[i].path = path;
        listEntryRender(entries[i], container, tabIndexOffset);
        tabIndexOffset++;
    }
    var rescroll = () => {
        lst.prop('scrollTop', top);
        if(top && lst.prop('scrollTop')<top && lst.height() > top){
            setTimeout(rescroll, 33)
        }
    }
    setTimeout(rescroll, 0)
    revealChannelsLogo();
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
            listEntriesByPath(listingPath)
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

function fetchEntries(url, name, filter){
    //listingPath = '/'+Lang.SEARCH;
    var path;
    console.log('FETCH', url, name);
    if(name){
        var pos = listingPath.indexOf('/'+name+'/');
        if(pos != -1){
            listingPath = listingPath.substr(0, pos)
        }
        if(name && name != basename(listingPath) && name != basename(dirname(listingPath))){
            listingPath = ltrimPathBar(listingPath + '/' + name)
        }
    }
    path = listingPath;
    console.log('FETCH2', url, name, path);
    var container = getListContainer(true);
    backEntryRender(container, '/');
    var key = 'remote-entries-'+url, doFetch = false, options = DB.get(key), failed = () => {
        notify(Lang.DATA_FETCHING_FAILURE, 'fa-warning', 'normal');
        triggerBack()
    }
    if(!(options instanceof Array)){
        doFetch = true;
        options = Store.get(key) // fallback
    }
    if(doFetch){
        if(!(options instanceof Array)){
            options = [];
        }
        console.log('JSON', url, path);
        jQuery.getJSON(url, (data) => {
            if(path == listingPath) { // user stills in the same view
                if((data instanceof Array) && data.length){
                    DB.set(key, data, 60);
                    Store.set(key, data); // fallback
                    jQuery('.entry:not(.entry-back)').remove();
                    if(filter){
                        data = data.map(filter)
                    }
                    index = writeIndexPathEntries(path, data, index);
                    listEntriesByPath(path)
                } else {
                    failed()
                }
            }
        }).fail(function (jqXHR, textStatus, errorThrown) {
            if(path == listingPath) { // user stills in the same view
                console.error(jqXHR);
                console.error(textStatus);
                console.error(errorThrown);
                failed()
            }
        })
    }   
    if(!options.length){
        options.push(getLoadingEntry()); 
    } else {
        if(filter){
            options = options.map(filter)
        }
    }
    return options;
}

function listEntriesByPath(path, append, nofx){
    if(!append && path.indexOf(Lang.SEARCH) != -1){
        return listEntriesByPathTriggering(path)
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
    listingPath = path = ltrimPathBar(path);
    var container = getListContainer(!append), entry;
    if(!path) path = '';
    console.log(path);
    if(path){
        jQuery('body').removeClass('home')
    } else {
        jQuery('body').addClass('home')
    }
    list = readIndexPath(path);
    console.log('DREADY3', path, list);
    if(!(list instanceof Array)){
        list = [list];
    }
    list = applyFilters('filterEntries', list);
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
    if(Store.get('hide-back-button')){
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

function triggerEntry(data, element){
    console.log('TRIGGER', data, element);
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
    var npath = ltrimPathBar(data.path+'/'+data.name);
    if(typeof(data.renderer)=='function'){
        var entries = data.renderer(data, element);
        if(!(entries instanceof Array)){
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


var searchKeypressTimer = 0, lastSearchTerm = Store.get('last-search-term');

function showSearchField(term){
    listingPath = Lang.SEARCH;
    var container = getListContainer(true);
    backEntryRender(container, '/');
    if(term){
        lastSearchTerm = term;
    }
    var entry = {
        type: 'input',
        change: function (entry, element, val){
            if(val){
                lastSearchTerm = val;
                Store.set('last-search-term', val);
            }
            clearTimeout(searchKeypressTimer);
            searchKeypressTimer = setTimeout(function (){
                clearTimeout(searchKeypressTimer);
                var r = fetchSearchResults();
                container.find('a.entry-stream').remove();
                listEntries(r, Lang.SEARCH);
            }, 400);
        },
        value: lastSearchTerm
    };    
    var element = listEntryRender(entry, container);
    element.find('input').trigger('focus').trigger('input');
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
    return applyFilters('filterEntries', r)
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

function listEntriesByPathTriggering(path){
    var c = getFrame('controls'), ms = 200;
    c.listEntriesByPath('');
    path = path.split('/');
    var nav = () => {
        if(path.length){
            var next = path.shift();
            c.findEntries(next).click();
            if(path.length){
                setTimeout(nav, ms)
            }
        }
    }
    setTimeout(nav, ms)
}

function goHistory(){
    getFrame('controls').listEntriesByPathTriggering(Lang.BOOKMARKS_EXTRAS+'/'+Lang.HISTORY)
}

jQuery(() => {
    addFilter('filterEntries', (entries) => {
        console.log('PREFILTERED', entries);
        var nentries = [], urls = getOfflineStreamsURLs(), offline = [], forceClean = false, isStreamsListing = false, offLabel = ' (OFF)';
        for(var i=0; i<entries.length; i++){
            if(!parentalControlAllow(entries[i])){
                continue;
            }
            if(entries[i].type && entries[i].type=='stream'){
                if(!isStreamsListing){
                    isStreamsListing = true;
                }
                if(urls.indexOf(entries[i].url)!=-1){
                    entries[i].offline = true;
                    if(entries[i].label.indexOf(offLabel)==-1){
                        entries[i].label += offLabel;
                    }
                    offline.push(entries[i])
                } else {
                    entries[i].offline = false;
                    if(typeof(entries[i].label)!='undefined' && entries[i].label.indexOf(offLabel)!=-1){
                        entries[i].label = entries[i].label.replace(offLabel, '')
                    }
                    nentries.push(entries[i])
                }
            } else {
                nentries.push(entries[i]) // not a stream entry
            }
        }
        if(offline.length){
            nentries = nentries.filter(function (item) {
                return !!item;
            }).concat(offline);            
        } else if(isStreamsListing) {
            if(!autoCleanHintShown){
                autoCleanHintShown = true;
                notify(Lang.AUTOCLEAN_HINT, 'fa-info-circle', 'normal')
            }
        }
        console.log('FILTERED', nentries, entries, offline);
        return nentries;
    })
})