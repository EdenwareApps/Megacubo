
var menuTemplates = {};

menuTemplates['option'] = `
    <a href="[url]" role="button" onclick="return false;" class="entry entry-option [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
        <table>
            <tr>
                <td class="entry-logo-c">
                    <span class="entry-logo">
                        <span class="entry-logo-img-c">
                            <img src="[logo]" onerror="this.onerror=null;this.src=\'[default-logo]\';" />
                        </span>
                    </span>
                </td>
                <td>
                    <span class="entry-flags">
                        <span></span>
                    </span>
                    <span class="entry-name">[format-name]</span>
                </td>
            </tr>
        </table>
    </a>
`;

menuTemplates['back'] = `
<a href="[url]" role="button" onclick="return false;" class="entry entry-option [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
	<table>
		<tr>
            <td class="entry-logo-c">
                <span class="entry-logo">
                    <span class="entry-logo-img-c">
                        <img src="[logo]" onerror="this.onerror=null;this.src=\'[default-logo]\';" />
                    </span>
                </span>
			</td>
			<td>
                <span class="entry-flags">
                    <span></span>
                </span>
                <span class="entry-name">[format-name]</span>
			</td>
		</tr>
	</table>
</a>
`;

menuTemplates['disabled'] = `
<a href="[url]" role="button" onclick="return false;" class="entry entry-disable entry-offline [class]" aria-hidden="true">
    <table>
        <tr>
            <td class="entry-logo-c">
                <span class="entry-logo">
                    <img src="[logo]" title="[name] - [group]" onerror="this.onerror=null;this.src=\'[default-logo]\';" />
                </span>
            </td>
            <td>
                <span class="entry-flags">
                    <span></span>
                </span>
                <span class="entry-name">[format-name]</span>
            </td>
        </tr>
    </table>
</a>
`;

menuTemplates['input'] = `
<a href="[url]" draggable="false" role="button" onclick="return false;" class="entry entry-input [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
    <table class="entry-search">
        <tr>
            <td>
                <span class="entry-input-logo">
                    <img src="[logo]" onerror="this.onerror=null;this.src=\'[default-logo]\';" />
                </span>
                <input type="text" placeholder="[label]" />
            </td>
            <td class="entry-logo-c"></td>
        </tr>
    </table>
</a>
`;

menuTemplates['check'] = `
<a href="[url]" role="button" onclick="return false;" class="entry entry-option [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
    <table>
        <tr>
            <td class="entry-logo-c">
                <span class="entry-logo">
                    <i class="fas fa-toggle-off entry-logo-fa" aria-hidden="true"></i>
                </span>
            </td>
            <td>
                <span class="entry-flags">
                    <span></span>
                </span>
                <span class="entry-name">[format-name]</span>
            </td>
        </tr>
    </table>
</a>
`;

menuTemplates['stream'] = `
<a href="[url]" role="button" onclick="return false;" class="entry entry-stream [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
    <table>
        <tr>
            <td class="entry-logo-c">
                <span class="entry-logo">
                    <span class="entry-logo-img-c">
                        <img src="[logo]" onerror="lazyLoad(this, [\'[auto-logo]\', \'[default-logo]\'])" title="[name] - [group]" alt="[name]" />
                    </span>
                </span>
            </td>
            <td>
                <span class="entry-flags">
                    <span></span>
                </span>
                <span class="entry-name">[format-name]</span>
            </td>
        </tr>
    </table>
</a>
`;

menuTemplates['group'] = `
<a href="[url]" role="button" onclick="return false;" class="entry entry-group [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
    <table>
        <tr>
            <td class="entry-logo-c">
                <span class="entry-logo">
                    <span class="entry-logo-img-c">
                        <img src="[logo]" onerror="lazyLoad(this, [\'[auto-logo]\', \'[default-logo]\'])" title="[name] - [group]" alt="[name]" />
                    </span>
                </span>
            </td>
            <td>
                <span class="entry-flags">
                    <span></span>
                </span>
                <span class="entry-name">[format-name]</span>
            </td>
        </tr>
    </table>
</a>
`;

menuTemplates['slider'] = `
<a href="[url]" role="button" onclick="return false;" class="entry entry-slider [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
    <table>
        <tr>
            <td class="entry-logo-c">
                <span class="entry-logo">
                    <img src="[logo]" onerror="this.onerror=null;this.src=\'[default-logo]\';" />
                </span>
            </td>
            <td>
                <span class="entry-name">[format-name] <span class="entry-label"></span></span>
                <span class="entry-slider-container">
                    <input type="range" />
                    <span class="entry-slider-value">[value]</span>
                </span>
            </td>
        </tr>
    </table>
</a>
`;

var defaultIcons = {
    'option': 'fa-cog',
    'slider': 'fa-cog',
    'input': 'fa-keyboard',
    'stream': 'fa-play fa-xs',
    'check': 'fa-toggle-off',
    'group': 'fa-folder-open'
};

var loadingToActionDelay = 50; // prevent a loading message from not appearing by applying a delay before start any CPU intensive task
var searchPath = null;

function assumePath(name, _path){
    if(typeof(_path)!='string'){
        _path = typeof(Menu.vpath)=='string' ? Menu.vpath : Menu.path;
    }
    if(!name){
		return _path;
    }
    if(!_path.length){
        return name;
    }
    // _path = trimChar(_path, '/');
    var n = _path.lastIndexOf(name);
    //console.log(n, name, _path);
    if(n != -1){
        if(n == 0){
            return name;
        } else if(n >= (_path.length - (name.length + 1))){
            return _path;
        }
        _path = _path.substr(n + name.length + 1);
    }
    return _path + '/' + name;
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

function isLoadingEntryRendered(){
    return !!jQuery('.entry-loading').length;
}

function handleEntryInputChecking(element, docheck) {
    element.css('opacity', docheck ? 1 : 0.75).find('svg, i:eq(0)').replaceWith('<i class="fas ' + ( docheck ? 'fa-toggle-on' : 'fa-toggle-off') + ' entry-logo-fa" aria-hidden="true"></i>')
}

function writeIndexPathEntries(path, entries, _index){
    var debug = debugAllow(false), name = String(getRootFolderFromStr(path));
    if(typeof(_index)=='undefined'){
        _index = Menu.entries;
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
                if(!Array.isArray(_index[k].entries)){
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
    var sub = Menu.entries;
    if(!path) return Menu.entries;
    paths = path.split('/')
    for(var i=0;i<paths.length;i++){
        if(Array.isArray(sub)){
            sub = readIndexSubEntries(sub, paths[i]) || [];
        } else {
            sub = sub[paths[i]] || [];
        }
        //console.log(paths[i], sub);
        if(Array.isArray(sub)){
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

var effectRevealDelay = 50, effectContainer = jQuery('.list > div'), effectDuration = 75;

function listEnterEffect(callback){
    var from = 0, to = -50;
    jQuery({y: from}).animate({y: to}, {
        duration: effectDuration,
        easing: "swing",
        step: function(val) {
            var o = (100 - (Math.abs(val) / ((Math.abs(to) - from) / 100))) / 100;
            console.warn('VAL', val, o);
            effectContainer.css({
                transform: "translate("+val+"px, "+(val/20)+"px)",
                opacity: o
            }) 
        },
        done: function(){
            callback();
            setTimeout(() => {
                effectContainer.css({transform: "none", opacity: 1})
            }, effectRevealDelay)
        }
    })
}

function listBackEffect(callback){
    var from = 0, to = 50;
    jQuery({y: from}).animate({y: to}, {
        duration: effectDuration,
        easing: "swing",
        step: function(val) {
            var o = (100 - (Math.abs(val) / ((Math.abs(to) - from) / 100))) / 100;
            effectContainer.css({
                transform: "translate("+val+"px, "+(val/20)+"px)",
                opacity: o
            }) 
        },
        done: function(){
            callback();
            setTimeout(() => {
                effectContainer.css({transform: "none", opacity: 1})
            }, effectRevealDelay)
        }
    })
}

function about(){
    sound('warn', 16);
    var name = appName(), arch = process.arch == 'ia32' ? 'x86' : 'x64';
    name += ' (' + applyFilters('appLicense', 'free') +')'
    if(currentVersion && (currentVersion > installedVersion)){
        var txt = name + ' v'+nw.App.manifest.version+' (< v'+currentVersion+') '+arch+"\n\n";
        txt = applyFilters('about', txt);
        txt = trimChar(txt, "\n") + "\n\n" + Lang.NEW_VERSION_AVAILABLE;
        if(confirm(txt)){
            nw.Shell.openExternal(appDownloadUrl())
        }
    } else {
        var txt = name + ' v'+nw.App.manifest.version+' '+arch+"\nhttps://megacubo.tv\n\n";
        txt = applyFilters('about', txt);
        txt = trimChar(txt, "\n");
        alert(txt)
    }
}

var searchSuggestions = [];

function getSearchSuggestions(){
    var url = 'http://app.megacubo.net/stats/data/searching.'+getLocale(true)+'.json';
    fetchEntries(url, (suggestions) => {
        var entries = [];
        if(suggestions && suggestions.length){
            searchSuggestions = removeSearchSuggestionsTermsAliases(suggestions)
            suggestions.forEach((suggest, i) => {
                suggestions[i].search_term = suggestions[i].search_term.trim()
                if(parentalControlAllow(suggest.search_term)){
                    var t = Lang.SEARCH + ': ' + suggest.search_term, c = ucWords(suggest.search_term), s = encodeURIComponent(c), entry = {name: c, logo: 'http://app.megacubo.net/logos/'+encodeURIComponent(s)+'.png', type: 'stream', label: Lang.MOST_SEARCHED, url: 'mega://play|'+s};
                    entries.push({
                        name: suggest.search_term, 
                        defaultLogo: defaultIcons['stream'], 
                        logo: 'http://app.megacubo.net/logos/{0}.png'.format(encodeURIComponent(suggest.search_term)), 
                        type: 'option', 
                        class: 'entry-suggest', 
                        label: Lang.SEARCH, 
                        callback: (data, element) => {
                            goSearch(suggest.search_term)
                            if(element){
                                setEntryFlag(element, 'fa-mega spin-x-alt')
                            }
                        }
                    })
                    var a = jQuery('<a href="#" title="'+t+'" aria-label="'+t+'">'+suggest.search_term+'</a>&nbsp;');
                    a.data('entry-data', entry).on('click', (event) => {
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

function getSearchSuggestionsTerms(removeAliases){
    var s = []
    if(searchSuggestions && searchSuggestions.length){
        searchSuggestions.forEach((suggest, i) => {
            s.push(searchSuggestions[i].search_term)
        })
        if(removeAliases){
            s = removeSearchSuggestionsTermsAliases(s)
        }
    }
    return s;
}

function removeSearchSuggestionsTermsAliases(s){
    if(s.length){
        let aliases = {}, cnts = {}
        s.forEach((k, i) => {
            if(typeof(s[i].cnt) != 'number'){
                s[i].cnt = parseInt(s[i].cnt)
            }
            s.forEach(t => {
                if(t.search_term != k.search_term && k.search_term == t.search_term.substr(0, k.search_term.length)){
                    aliases[k.search_term] = t.search_term
                    s[i].cnt += parseInt(t.cnt)
                }
            })
        })
        aliases = Object.values(aliases)
        s = s.filter(k => {
            return aliases.indexOf(k.search_term) == -1
        })
    }
    return s
}

function _removeSearchSuggestionsTermsAliases(s){
    if(s.length){
        let aliases = {}
        s.forEach(k => {
            s.forEach(t => {
                if(typeof(t) == 'string' && t != k && k == t.substr(0, k.length)){
                    aliases[k] = t 
                }
            })
        })
        aliases = Object.values(aliases)
        s = s.filter(k => {
            return typeof(k) != 'string' && aliases.indexOf(k) == -1
        })
    }
    return s
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
                    var n = parseInt(entry.label.split(' ')[0].replace(new RegExp('[^0-9]', 'g'), ''));
                    entry.label = parseCounter(n) + ' ' + (n == 1 ? Lang.USER : Lang.USERS);
                    entry.renderer = (data, element, isVirtual) => {
                        return loadSource(data.url, data.name, null, null, isVirtual)
                    }
                    return entry
                })
                // index = writeIndexPathEntries(Menu.path, entries);
                // Menu.go(Menu.path);
                Menu.asyncResult(path, entries);
                setTimeout(markActiveSource, 250) // wait rendering
            } else {
                failed()
            }
        })
    }, 150);
    return [Menu.loadingEntry()];
}

function fetchAndRenderEntries(url, name, filter, callback){
    var path
    if(name.indexOf('/') == -1){
        path = assumePath(name)
    } else {
        path = name
        name = basename(path)
    }
    var fetchPath = path;
    console.log('FETCHNRENDER', url, name, path, fetchPath, Menu.path, Menu.vpath, traceback());
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
                    if(Array.isArray(hr)){
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
    return [Menu.loadingEntry()];
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
        jQuery('.entry-flags > span').html('')
    }
    if(flag){
        if(flag.indexOf('fa-mega') == -1){
            flag = '<i class="fa '+flag+'" aria-hidden="true"></i>'
        } else {
            flag = '<i class="'+flag+'" aria-hidden="true"></i>'
        }
    } else {
        flag = ''
    }
    jQuery(el).find('.entry-flags > span').html(flag)
}

function setActiveEntry(data, flag, notUnique){
    if(!notUnique){
        jQuery('.entry-flags > span').html('')
    }
    if(!flag){
        flag = 'fa-check-circle';
    }
    var ok, index = -1, es = Menu.getEntries(true, true);
    for(var i = 0; i < es.length; i++){
        ok = true;
        for(var k in data){
            if(typeof(es[i][k])=='undefined' || es[i][k] != data[k]){
                ok = false;
                break;
            }
        }
        if(ok){
            index = i;
        }
    }
    if(index > -1){
        setEntryFlag(Menu.getEntries(false, true).eq(index), flag, true)
    }
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
    var fas = jQuery('.entry-flags i.fa'), term = decodeEntities(term);
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

function lettersToRange(a, b){
    if(a == b) return a;
    return a+'-'+b;
}

function getAutoLogo(entry){
    if(entry.mediaType != 'live'){
        return false
    }
    return 'http://app.megacubo.net/logos/'+encodeURIComponent(entry.name)+'.png'
}

Menu = (() => {
    var self = {};
    self.initialized = false;
    self.window = jQuery(window);
    self.body = jQuery('body');
    self.debug = debugAllow(true);
    self.path = '';
    self.vpath = false;
    self.entries = [];
    self.events = {};
    self.rendering = false;
    self.lastListScrollTop = 0;
    self.subMenuSizeLimit = 0;
    self._container = false;
    self._containerParent = false;
    self.currentPlayState = false;
    self.currentRecordingState = false;
    self.asyncResults = {};
    self.scrollCache = {};
    self.scrollContainerCache = false;
    self.triggeringCache = {};
    self.appOverTimer = 0;
    self.appOverState = true;
    self.appOverBindState = false;
    self.caching = {}
    self.pages = {}
    self.cache = (path, value) => {
        if(basename(path) != Lang.SEARCH){
            if(value && value instanceof jQuery && typeof(self.caching[path]) == 'undefined'){
                let p = path.length
                Object.keys(self.caching).forEach(t => {
                    if(t != path.substr(0, t.length)){
                        self.caching[t].remove()
                        delete self.caching[t]
                    }
                })
                self.caching[path] = value.clone(true)
            }
            if(typeof(self.caching[path]) != 'undefined' && self.caching[path]){
                return self.caching[path].clone(true)
            }
        }
        return false
    }
    self.on = (action, callback) => { // register, commit
        action = action.split(' ')
        for(var i=0;i<action.length;i++){
            if(typeof(self.events[action[i]])=='undefined'){
                self.events[action[i]] = []
            }
            self.events[action[i]].push(callback)
        }
    }
    self.off = (action, callback) => { // register, commit
        if(self && self.events){
            if(action){
                action = action.split(' ')
            } else {
                action = Object.keys(self.events)
            }
            for(var i=0;i<action.length;i++){
                if(typeof(self.events[action[i]])!='undefined'){
                    if(callback){
                        var p = self.events[action[i]].indexOf(callback)
                        if(p != -1){
                            delete self.events[action[i]][p];
                        }
                    } else {
                        self.events[action[i]] = [];
                    }
                }
            }
        }
    }
    self.triggerEvent = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(self && self.events && Array.isArray(self.events[action])){
            console.log(action, traceback());
            console.log(self.events[action]);
            console.log(self.events[action].length);
            for(var i=0; self && self.events[action] && i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }
    self.scrollContainer = () => {
        if(!self.scrollContainerCache || !self.scrollContainerCache.length){
            self.scrollContainerCache = jQuery('#menu div.list > div > div').eq(0);
        }
        return self.scrollContainerCache;
    }
    self.asyncResult = (path, _entries, silent) => {
        if(typeof(_entries)=='undefined'){
            return (typeof(self.asyncResults[path])=='undefined' ? false : self.asyncResults[path])
        }
        if(!Array.isArray(_entries)){
            _entries = [self.emptyEntry()]
        }
        var entries = _entries.slice(0);
        if(typeof(entries.toArray) == 'function'){
            entries = entries.toArray()
        }
        if(self.debug){
            console.log('ASYNCRESULT', path, self.path)
        }
        self.asyncResults[path] = entries;
        if(path != searchPath){
            self.pages[path] = entries.slice(0)
            if(!self.pages[path].length || !self.pages[path][0].class || self.pages[path][0].class.indexOf('entry-back') == -1){
                self.pages[path].unshift(self.backEntry(basename(path)))
            }
        }
        if(silent !== true && path == self.path){
            if(self.debug){
                console.log('ASYNCRESULT', entries, path, self.path)
            }
            var container = self.container(true);
            self.renderBackEntry(container, dirname(path), basename(path))
            if(Array.isArray(entries)){
                if(!entries.length){
                    entries.push(self.emptyEntry())
                }
                self.list(entries, path)
            } else if(entries === -1) {
                self.back()
            }
        }
    }
    self.containerParent = () => {
        if(!self._containerParent){
            self._containerParent = jQuery('#menu div.list')
        }
        return self._containerParent
    }
    self.container = (reset) => {
        if(!self._container){
            self._container = self.containerParent().find('div > div').eq(0)
        }
        if(reset){
            if(self.debug){
                console.log('container reset')
            }
            self.body.removeClass('submenu')
            self.containerParent().prop('scrollTop', 0)
            self._container.empty()
            lastTabIndex = 1
        }
        return self._container;
    }
    self.isVisible = () => {
        return self.body.hasClass('show-menu')
    }
    self.isHiding = () => {
        return self.controlsHiding || false
    }
    self.show = () => {
        if(!self.isVisible()){
            sound('menu', 9)
            var b = self.body, o = getFrame('overlay')
            if(o && o.document && o.document.body){
                b = b.add(o.document.body)
            }
            b.addClass('show-menu')
            doAction('menuShow')
        } else {
            console.log('DD')
        }
    }
    self.hide = () => {
        //console.log('EE', traceback())
        if(self.isVisible()){
            sound('menu', 9);
            //console.log('HH')
            self.controlsHiding = true;
            self.body.add(getFrame('overlay').document.body).removeClass('isdialing show-menu paused');
            var controlsActiveElement = document.activeElement;
            //console.log('HIDE', controlsActiveElement)
            if(controlsActiveElement && controlsActiveElement.tagName.toLowerCase()=='input'){
                //console.log('HIDE UNFOCUS', controlsActiveElement)
                Pointer.focusPrevious()
            }
            setTimeout(() => {
                self.controlsHiding = false;
            }, 600);
            doAction('menuHide')
        }
    }
    self.toggle = () => {
        self[self.isVisible()?'hide':'show']()
    }
    self.autoHide = (state, force) => {
        if(state && (force === true || true || Playback.active)){
            self.body.addClass('auto-hide');
            if(!self.appOverBindState){
                self.appOverBindState = true;
                jQuery('div#menu-left-border').css({
                    'height': '100%',
                    'top': 0
                });
                jQuery('#menu-trigger, #menu-toggle').hide()
            }
        } else {
            self.body.removeClass('auto-hide');
            if(self.appOverBindState){
                self.appOverBindState = false;
                jQuery('div#menu-left-border').css({
                    'height': 'calc(100% - 33px)',
                    'top': '33px'
                });
                jQuery('#menu-trigger, #menu-toggle').show()
            }
        }
    }
    self.renameSelected = () => {
        var element = Pointer.selected(true, true);
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
    self.backEntry = (label) => {
        var back = {
            name: Lang.BACK,
            type: 'back',
            class: 'entry-back',
            logo: 'fa-chevron-left',
            callback: self.back
        };
        if(label){
            back.label = '<i class="fas fa-map-marker-alt"></i>&nbsp; '+label;
        }
        if(Theme.get('hide-back-button')){
            back.class += ' entry-hide';
        }
        return back;
    }
    self.renderBackEntry = (container, backPath, label) => {
        if(self.debug){
            console.warn('renderBackEntry', backPath, traceback())
        }
        self.container(true); // reset always for back button
        var back = self.backEntry(label);
        self.render([back], 1)
    }
    self.emptyEntry = (txt, icon) => {
        return {
            name: txt || Lang.EMPTY, 
            logo: icon || 'fa-sticky-note', 
            type: 'option'
        }
    }
    self.loadingEntry = (txt) => {
        if(!txt) txt = Lang.LOADING;
        return {
            type: 'option',
            name: txt,
            label: '',
            logo: 'fa-mega spin-x-alt',
            class: 'entry-loading'
        }
    }
    self.renderLoadingEntry = () => {
        if(self.debug){
            console.warn('renderLoadingEntry', traceback())
        }
        self.renderBackEntry();
        var loader = self.loadingEntry();
        self.render([loader])
    }
    self.loaded = () => {
        jQuery('.entry-loading').remove()
    }
    self.setBackTo = (path) => {
        if(path != self.path) {
            var c = (top || parent);
            console.warn('SETBACK TO', path, traceback());
            jQuery(c.document).find('.entry-back').off('mousedown click').on('click', () => {
                self.go(path, null, () => {
                    if(path){
                        self.go('')
                    }
                })
            })
        }
    }
    self.setBackToHome = () => {
        self.setBackTo('')
    }
    self.refresh = (ifmatch, _cb) => {
        var cb = () => {
            if(typeof(_cb) == 'function'){
                _cb()
                _cb = null;
            }
        }
        if(typeof(ifmatch) != 'string' || self.path.indexOf(ifmatch) != -1){
            var lst = self.containerParent(), top = lst.prop('scrollTop'), inSearch = (self.path.indexOf(Lang.SEARCH) != -1)
            var previouslySelected = Pointer.selected(true, false)
            previouslySelected = previouslySelected ? previouslySelected.data('entry-data') : false;
            if(inSearch){
                self.containerParent().find('input').trigger('input')
            } else {
                var scrl = self.saveScroll(true)
                var cur = self.path;
                console.warn('no triggerer', scrl, cur)
                if(cur){
                    self.back(() => {
                        self.getEntries().each((i, element) => {
                            var data = jQuery(element).data('entry-data')
                            if(data && data.name == basename(cur) && data.type == 'group'){
                                console.warn('retrigger', data, traceback())
                                self.trigger(data, element, () => {
                                    self.restoreScroll(scrl)
                                    cb()
                                })
                            }
                        })
                    })
                } else {
                    self.path = '-';                    
                    self.go(cur, () => {
                        self.restoreScroll(scrl)
                        if(self.debug){
                            console.log('after refresh', self.container().html())
                        }
                        cb()
                    })
                }
                return;
            }
        }
        cb()
    }
    self.triggerer = (path, entry) => {
        if(entry){
            self.triggeringCache[path] = entry;
        }
        return self.triggeringCache[path] || false;
    }
    self.trigger = (data, element, _cb, animEnded) => {
        self.rendering = true;
        var slide = Theme.get('slide-menu-transitions')
        if(animEnded !== true){
            console.warn('ANIM', data);
            if(data.type == 'back'){
                sound('click-out', 3);
                if(slide){
                    listBackEffect(jQuery.noop);
                    self.trigger(data, element, _cb, true);
                    return
                }
            } else if(data.type == 'group') {
                sound('click-in', 4);
                if(slide){
                    listEnterEffect(() => {
                        self.trigger(data, element, _cb, true)
                    })
                    return
                }
            } else if(data.type == 'stream') {
                sound('warn', 16) // no return, no effect
            }
        }
        self.triggerEvent('trigger', data, element)
        var cb = () => {
            if(typeof(_cb)=='function'){
                _cb()
            }
        }
        // console.log('TRIGGER', data, element, traceback());
        if(data.type == 'input' || (typeof(data.class)=='string' && data.class.indexOf('entry-disable')!=-1)){
            self.rendering = false;
            return cb()
        }
        if(data.type == 'group'){ // prior to dealing with the back entry
            self.lastListScrollTop = jQuery('.list').scrollTop()
        }
        if(data.type == 'back'){
            //console.log(data.path);
            /*
            var newPath = dirname(self.path);
            // console.log('BACK', newPath);
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
            */
            self.back();
            self.rendering = false;
            cb();
            return true;
        }
        self.saveScroll(true);  
        if(typeof(data.path)=='undefined'){
            data.path = self.path;
        }
        var entries = null, listDirectly = false, npath = assumePath(data.name, data.path);
        console.log('TRIGGER DATA 1', data, data.path, self.path, data.name, npath);
        if(Array.isArray(data.entries)){
            listDirectly = true;
            entries = data.entries;
        }
        if(typeof(data.renderer)=='function'){
            entries = data.renderer(data, element, false);
            console.log('TRIGGER DATA 1.5', entries);
            if(entries === -1){
                self.rendering = false;
                return cb()
            } else if(!Array.isArray(entries)){
                console.log('!! RENDERER DIDNT RETURNED A ARRAY', entries, data.path);
            }
        }
        //console.log('TRIGGER DATA', npath, data, data.path, entries);
        if(data.type == 'group'){
            var ok = false;
            self.triggerer(npath, data);
            console.log('TRIGGER DATA 2', data.path, npath, entries);
            if(Array.isArray(entries)){
                if(entries.length == 1 && entries[0].class && entries[0].class.indexOf('entry-loading') != -1){
                    let dat = self.renderEntry(entries[0], element.tabIndexOffset, false)
                    jQuery(element).replaceWith(dat.html)
                    self.path = npath
                    ok = true
                } else {
                    entries = applyFilters('internalFilterEntries', entries, npath);
                    //console.error('XXXXXXXX', entries, data, self.path && entries.length <= self.subMenuSizeLimit);
                    if(entries.length <= self.subMenuSizeLimit && (!data.class || (data.class.indexOf('entry-nosub') == -1 && data.class.indexOf('entry-compact') == -1))){
                        //console.error('XXXXXXXX', entries, data);
                        if(!element){
                            var es = self.queryElements(self.getEntries(false, false), {name: data.name, type: data.type});
                            if(es.length){
                                element = es.get(0)
                            }
                        }
                        var issub, issubsub, insub = false, insubsub = false, offset = -1
                        if(element){
                            issub = element.className && element.className.indexOf('entry-sub') != -1
                            issubsub = element.className && element.className.indexOf('entry-sub-sub') != -1
                        } else {
                            issub = issubsub = false
                        }
                        self.container().find('a.entry').show().each((i, entry) => {
                            if(offset == -1 && entry.className && entry.className.indexOf('entry-sub') != -1){
                                insub = true
                                offset = i
                                console.warn('SUBMENU', offset)
                                if(entry.className.indexOf('entry-sub-sub') != -1){
                                    insubsub = true
                                }
                            }
                        })
                        if(offset == -1){
                            self.getEntries(true, false).every((entry, i) => {
                                if(entry.class && entry.class.indexOf('entry-loading') != -1){
                                    //offset = -1;
                                    //return false;
                                }
                                if(entry.name == data.name){
                                    offset = i;
                                    console.warn('SUBMENU', offset)
                                }
                                return offset == -1;
                            })
                        }
                        console.warn('SUBMENU', entries.length, data, offset, insub, insubsub, issub, issubsub);
                        if(offset != -1 && !insubsub){
                            ok = true;
                            var pas = self.container().find('a.entry')
                            pas.filter('.entry-sub').remove()
                            var nentries = entries.slice(0)
                            nentries.unshift(self.backEntry(data.name)) // do not alter entries
                            self.list(nentries, npath, offset ? offset - 1 : 0, true)
                            var rv = self.container().find('a.entry').not(pas)
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
                            })
                            self.fitSubMenuScroll()
                        }
                    }
                } 
                if(!ok){
                    self.renderBackEntry(self.container(true), dirname(npath), data.name);
                    //self.path = ltrimPathBar(npath);
                    if(Array.isArray(entries)){
                        console.log('TRIGGER DATA 3', data.name, data.path, npath, entries);
                        self.list(entries, npath)
                    }
                }
            }
        }
        self.rendering = false;
        var t = typeof(data.callback);
        //console.log('CALLBACK', t, data);
        if(t == 'function'){
            setTimeout(() => {
                data.callback(data, element)
            }, 150)
        } else if(isStreamEntry(data)) {
            //console.log('PLAY', data);
            playEntry(data)
        }
        return cb()
    }
    self.adjustBodyClass = (inHome, force) => {
        if(!self.vpath || force === true){
            if(inHome && !self.path){
                if(self.debug){
                    console.warn('INHOME', traceback(), inHome, self.path)
                }
                self.adjustBodyClassDirectly(true)
            } else {
                self.adjustBodyClassDirectly(false)
            }
        }
    }
    self.adjustBodyClassDirectly = (inHome) => {
        if(self.debug){
            console.warn('INHOME', traceback(), inHome, self.path)
        }
        if(inHome){
            if(self.debug){
                console.warn('INHOME', traceback(), inHome, self.path)
            }
            self.body.addClass('home').removeClass('submenu')
        } else {
            self.body.removeClass('home')
        }
        doAction('Menu.adjustBodyClass', inHome)
        if(self.debug){
            console.warn('INHOME OK')
        }
    }
    self.getEntries = (getData, visibleOnly, noBackEntry) => {
        var c = self.container(), e = c.find('a.entry'+(visibleOnly?':visible':'')+(noBackEntry?':not(.entry-back)':'')), f = e.filter('.entry-sub');
        if(f.length){
            e = f
        }
        return getData ? e.toArray().map((e) => {
            return jQuery(e).data('entry-data')
        }) : e
    }
    self.list = (entries, path, at, sub) => {
        var cached, container = self.container(false)
        if(!entries){
            entries = applyFilters('homeEntries', self.entries.slice(0)) || []
        }
        if(self.path && self.path == dirname(path)){
            let cs = container.children().not('.entry-loading')
            if(cs.length > 1 && cs.filter('.entry-back').length){
                self.cache(self.path, cs)
            }
        }
        self.saveScroll()
        var lst = self.containerParent()
        if(self.debug){
            console.log('Menu.list PREFILTER', at, entries, path, traceback())
        }
        var tabIndexOffset = getTabIndexOffset()
        entries = applyFilters('allowEntries', entries, path)
        entries = applyFilters('internalFilterEntries', entries, path)
        entries = applyFilters('filterEntries', entries, path)
        if(self.debug){
            console.log('Menu.list POSFILTER', entries, path, traceback())
        }
        for(var i=0; i<entries.length; i++){
            entries[i].path = path
        }
        self.path = path
        if(path != searchPath){
            self.pages[self.path] = entries.slice(0)
            if(!self.pages[self.path].length || !self.pages[self.path][0].class || self.pages[self.path][0].class.indexOf('entry-back') == -1){
                self.pages[self.path].unshift(self.backEntry(basename(self.path)))
            }
        }
        Object.keys(self.pages).forEach(k => {
            if(self.path.indexOf[k] == -1){
                self.pages[k] = undefined
            }
        })
        if(self.debug){
            console.log('menuList', container.html().substr(0, 1024))
        }
        self.render(entries, tabIndexOffset, at, sub)
        if(self.debug){
            console.log('menuList', container.find('a').length, container.html().substr(0, 1024))
        }
        if(sub && typeof(at)=='number'){            
            self.body.addClass('submenu')
        } else {     
            self.body.removeClass('submenu')
            updateStreamEntriesFlags()
        }   
        if(self.debug){
            console.log('menuList', container.find('a').length, container.html().substr(0, 1024))
        }
        var lps = 7
        lst.find('.marquee:not(.marquee-adjusted)').each((i, e) => {
            jQuery(e).addClass('marquee-adjusted').find('*:eq(0)').css('animation-duration', parseInt(e.innerText.length / lps)+'s')
        })
        if(self.debug){
            console.log('menuList', container.find('a').length, container.html().substr(0, 1024))
        }        
        self.triggerEvent('list', entries, path, at)
        return entries
    }
    self.renderIcon = (entry, fallbacks) => {
        var html, autoLogo = getAutoLogo(entry), logo = entry.logo || (entry.type == 'stream' ? autoLogo : false) || defaultIcons[entry.type || 'option'];
        var logoColor = typeof(entry.logoColor) == 'undefined' ? '' : 'color: '+entry.logoColor+';';
        if(logo.indexOf('fa-mega') != -1){
            html = '<i class="'+logo+' entry-logo-fa" style="'+logoColor+'" aria-hidden="true"></i>'
        } else if(logo.match(new RegExp('(^fa-| fa-)'))){
            if(logo.substr(0, 3) == 'fa-'){
                logo = 'fas ' + logo;
            }
            html = '<i class="'+logo+' entry-logo-fa" style="'+logoColor+'" aria-hidden="true"></i>'
        } else {
            // html = '<img src="'+logo+'" onerror="this.onerror=null;this.src=\''+defaultLogo+'\';" />'
            html = '<img src="'+logo+'" onerror=\'lazyLoad(this, '+JSON.stringify(fallbacks)+')\' />';
        }
        return html;
    }
    self.renderEntry = (entry, tabIndexOffset, isCompact) => {
        if(entry == null || typeof(entry)!='object'){
            if(self.debug){
                console.log('BAD BAD ENTRY', entry, typeof(entry))
            }
            return
        }
        if(!entry.type){
            if(!entry.url || entry.url.substr(0, 10)=='javascript'){
                entry.type = 'option'
            } else {
                entry.type = 'stream'
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
        if(typeof(menuTemplates[entry.type])=='undefined'){
            if(self.debug){
                console.log('BAD BAD ENTRY', entry)
            }
            return
        }
        var label = entry.label || ''
        if(typeof(entry.labeler) == 'function'){
            label = entry.labeler(entry)
        }
        var cleanLabel = stripHTML(label || entry.group || '').replaceAll('"', '&amp;quot;');
        var cleanName = displayPrepareName(entry.name, false, entry.prepend || '', entry.append || '', true);

        var html = menuTemplates[entry.type], atts = {};
        html = html.replace('<a ', '<a tabindex="'+tabIndexOffset+'" ').replace('<input ', '<input tabindex="'+tabIndexOffset+'" ');
        html = html.replaceAll('[name-n-label]', cleanName + (cleanLabel ? ' - ' + cleanLabel : ''));
        html = html.replaceAll('[name]', cleanName);
        html = html.replaceAll('[label]', cleanLabel);           
        html = html.replaceAll('[format-label]', (label || entry.group || ''));
        
        if(html.indexOf('[format-name]')!=-1){
            var minLengthToMarquee = 32, n = entry.rawname ? parseM3U8NameTags(entry.rawname) : entry.name
            var fhtml = displayPrepareName(n, label || entry.group || '', entry.prepend || '', entry.append || '')
            if(entry.url && isMegaURL(entry.url)){
                fhtml = '<i class="fas fa-satellite-dish"></i> ' + fhtml
            }
            if(String(entry.name + entry.label).length >= minLengthToMarquee){
                fhtml = '<span>' + fhtml + '</span>';
                html = html.replace('entry-name', 'entry-name marquee')
            }
            html = html.replaceAll('[format-name]', fhtml)
        }

        var fallbacks = [entry.logo];
        if(typeof(entry.defaultLogo) != 'undefined'){
            fallbacks.push(entry.defaultLogo)
        } 
        fallbacks.push(defaultIcons[entry.type]);

        var icon = self.renderIcon(entry, fallbacks);
        
        html = html.replace(new RegExp('<img[^>]+>', 'mi'), icon);

        if(icon.toLowerCase().indexOf('<img') == -1){
            html = html.replaceAll('entry-logo-img-c', 'entry-logo-fa-c')
        }

        html = html.replaceAll('[group]', entry.group && entry.group != 'undefined' ? entry.group : '');
        html = html.replaceAll('[class]', entry.class || '');
        html = html.replaceAll('[url]', entry.url || entry.originalUrl || ' ');
        html = html.replaceAll('[value]', typeof(entry.mask)!='undefined' ? entry.mask.format(entry.value) : entry.value);

        if(!isCompact && entry.class && entry.class.indexOf('entry-compact') != -1){
            isCompact = true
            html = '<div class="menu-footer">' + html
        }

        atts.data = entry;
        if(entry.type != 'disabled'){
            atts.click = (event) => {
                var me = jQuery(event.currentTarget);
                var data = me.data('entry-data');
                if(data.type == 'check') {
                    var checked = typeof(data.checked)!='undefined' && data.checked(data);
                    checked = !checked;
                    handleEntryInputChecking(me, checked);
                    if(typeof(data.check)=='function') data.check(checked, data, event.currentTarget);
                    sound('switch', 12);
                    //console.warn('OK?', data, checked, data.check);
                } else {
                    self.trigger(data, event.currentTarget)
                }
            }
            if(entry.type == 'check') {
                atts.checked = typeof(entry.checked)!='undefined' && entry.checked(entry)
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
        if(['input', 'slider'].indexOf(entry.type) == -1){
            atts.dragstart = (event) => {
                var data = jQuery(event.target).data('entry-data');
                if(data){
                    const f = nw.App.dataPath + path.sep + prepareFilename(data.name, false) + '.m3u'
                    fs.writeFileSync(f, "Generating, open again in some seconds...", "utf-8")
                    ListMan.exportEntriesAsM3U([data], false, txt => {
                        fs.writeFileSync(f, txt, "utf-8")
                    })
                    var file = new File(f, '')
                    event.originalEvent.dataTransfer.setData('DownloadURL', file.type + ':' + file.name + ':' + file.path)
                }
            }
        } else {
            if(typeof(entry['value'])!='undefined'){
                if(typeof(entry.getValue) == 'function'){
                    entry['value'] = entry.getValue(entry);
                }
                atts.value = entry['value'];
            }
            if(entry['change']){
                atts.input = (event) => {
                    self.body.trigger('wake');
                    var n = event.currentTarget.getElementsByTagName('input')[0], v = n.value;
                    if(n.type == 'range'){
                        v = parseInt(entry.range.start + (parseInt(v) * ((entry.range.end - entry.range.start) / 100)));
                        event.currentTarget.querySelector('span.entry-slider-value').innerText = typeof(entry.mask)!='undefined' ? entry.mask.format(v) : v;
                    }
                    entry.value = v;
                    entry['change'](entry, event.currentTarget, v)
                }
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
                    Pointer.focus(jQuery(e), true)
                }, 200)
            }
        }
        atts.mouseleave = (event) => {
            clearTimeout(listEntryFocusOnMouseEnterTimer)
        }
        return {html, atts, isCompact}
    }
    self.render = (entries, tabIndexOffset, at, sub) => { // render entries
        if(self.debug){
            console.log('render', entries)
        }
        if(typeof(at) != 'number' || at < 0){
            at = false;
        }
        if(typeof(tabIndexOffset)!='number'){
            tabIndexOffset = getTabIndexOffset()
        }
        entries = applyFilters('renderEntries', entries, self.path);
        var isCompact = false, allEvents = [], allHTML = '';
        entries.forEach((entry, i) => { // append
            let dat = self.renderEntry(entry, tabIndexOffset, isCompact)
            if(typeof(dat) == 'object' && dat){
                allHTML += dat.html
                allEvents.push(dat.atts)
                isCompact = dat.isCompact
                tabIndexOffset++
            }
        })
        if(self.debug){
            console.log('render', at, allHTML)   
        }
        if(isCompact){
            allHTML += '</div>';
        }
        var ri = allEvents.length, rv = null;
        if(sub && typeof(at)=='number'){
            //console.warn('AAAAAAAAAAAAA', at);
            self.saveScroll();
            var as = self.container().find('a.entry'), eq = as.eq(at)
            if(eq.length){
                as.filter('.entry-sub').not(eq).remove()
                as.show().slice(at, at + allEvents.length).hide()
                eq.after(allHTML)
                rv = self.container().find('a.entry').not(as).reverse()
            } else {
                self.container().append(allHTML)
                rv = self.container().find('a').reverse()
            }
        } else {
            self.container().append(allHTML)
            rv = self.container().find('a').reverse()
        }
        if(self.debug){
            console.log('render', self.container().html(), sub, at)  
            console.log('render', allHTML)  
        }
        rv.each((i, element) => {
            ri--
            if(ri >= 0){
                for(var key in allEvents[ri]){
                    if(self.debug){
                        console.log('render ev', key)  
                    }
                    switch(key){
                        case 'data': 
                            jQuery(element).data('entry-data', allEvents[ri][key]);
                            break;
                        case 'change': 
                            jQuery(element).find('input').on('input', () => {
                                var data = jQuery(this).data('entry-data');
                                self.body.trigger('wake');
                                allEvents[ri][key](data, this, this.value)
                            })
                            break;
                        case 'placeholder': 
                            jQuery(element).find('input').prop('placeholder', allEvents[ri][key]);
                            break;
                        case 'value': 
                            var v = allEvents[ri][key], n = jQuery(element).find('input');
                            if(n.attr('type') == 'range'){
                                var entry = jQuery(element).data('entry-data');
                                v = parseInt((v - entry.range.start) / ((entry.range.end - entry.range.start) / 100))
                            }
                            n.val(v);
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
        if(self.debug){
            console.log('render', self.container().html())  
        }
        self.triggerEvent('render', typeof(at)!='number' || at === 0)
        if(self.debug){
            console.log('render', self.container().html())  
        }
    }
    self.fitSubMenuScroll = () => {
        var subs = self.getEntries(false, true, false)
        if(subs.length){
            var first = subs.first(), last = subs.last();
            var subHeight = (last.offset().top + last.outerHeight()) - first.offset().top, y = self.scrollContainer().scrollTop() + first.position().top;
            if(self.scrollContainer().scrollTop() > y){
                self.scrollContainer().scrollTop(y)
            } else {
                y = ((last.position().top + last.outerHeight()) - self.scrollContainer().outerHeight()) - self.scrollContainer().scrollTop();
                if(y > self.scrollContainer().scrollTop()){
                    self.scrollContainer().scrollTop(y)
                }
            }
        }
    }
    self.saveScroll = (force) => {
        var p = self.path || '_', c = self.scrollContainer(), l = c.scrollTop();
        if(typeof(self.scrollCache[p])=='undefined'){
            self.scrollCache[p] = {offset: 0, data: false}
        }
        if(l || force === true){
            var s = self.selectedData();
            self.scrollCache[p].offset = l;
            self.scrollCache[p].data = s || (typeof(self.scrollCache[p].data) != 'undefined' ? self.scrollCache[p].data : false);
            return self.scrollCache[p];
        }
    }
    self.restoreScroll = (data, cb) => {
        var ok = false;
        var _path = self.path;
        var p = self.scrollContainer(), pt = self.path || '_', insub = self.body.find('.entry-sub').length // use it instead of self.body.hasClass('submenu') to prevent error on entering ALL_LISTS
        if(!data || typeof(data) != 'object'){
            data = self.scrollCache[pt]
        }
        if(self.debug){
            console.warn('RESTORE SCROLL', data, insub)
        }
        if(data){
            if(data.data){
                self.getEntries(false, true).each((i, element) => {
                    if(!ok){
                        var j = jQuery(element), entry = j.data('entry-data');
                        if(entry && entry.name == data.data.name){
                            if(self.debug){
                                console.warn('RESTORE SCROLL', data, p.scrollTop())
                            }
                            Pointer.focus(j, false);
                            ok = true;
                        }
                    }
                })
            } else if(typeof(data.offset)=='number' && !insub) {
                p.scrollTop(data.offset);
                if(self.debug){
                    console.warn('RESTORE SCROLL', data, p.scrollTop())
                }
                Pointer.focus(jQuery('a.entry:not(.entry-back):visible:in-viewport:eq(0)'), false);
                ok = true;
            }
        }
        self.adjustBodyClass(insub ? self.path.indexOf('/') == -1 : (!_path))
        if(!ok){
            if(self.debug){
                console.warn('RESTORE SCROLL', p.scrollTop())
            }
            Pointer.focus(false, true);
            ok = true;
        }
        if(insub){
            if(self.debug){
                console.warn('RESTORE SCROLL', self.path, p.scrollTop(), self.body.hasClass('submenu'))
            }
            self.fitSubMenuScroll()
        }
        if(typeof(cb) == 'function'){
            cb(!ok, data)
        }
    }
    self.triggerKey = (type) => {
        var s = Pointer.selected(true, false);
        if(s) {
            s.trigger(type)
        }
    }
    self.back = (cb) => {   
        self.vpath = false;
        self.body.removeClass('submenu'); 
        var redraw, container = self.container(), subs = container.find('a.entry-sub')
        if(self.debug){
            console.log('BACK', subs.length, self.path, traceback())
        }
        var r = self.path, _cb = () => {
            if(r == self.path){
                Pointer.focus(false)
            }
            if(typeof(cb) == 'function'){
                cb()
            }
            if(redraw){
                container.hide()
                setTimeout(() => { container.show() }, 50)
            }
        }
        if(subs.length){  
            var subsub = subs.filter('a.entry-sub-sub')
            self.path = dirname(self.path)
            self.adjustBodyClass(self.path.indexOf('/') == -1)
            r = container.find('a.entry:not(:visible)').eq(1);
            if(!r.length){
                r = container.find('a.entry:not(.entry-back)').eq(0)
            }
            subs.remove()
            container.find('a.entry').show()
            stylizer(' ', 'entry-sub-css', window)
            //console.warn('SHOULD REDRAW', subsub, subsub.length)
            if(subsub && subsub.length){
                subsub.remove()
                var es = self.queryElements(self.getEntries(false, false), {name: basename(self.path), type: 'group'})
                if(es && es.length){
                    es.eq(0).trigger('click')
                    _cb()
                } else {
                    self.go(self.path, _cb)
                }
                return
            } else {
                redraw = true // avoid messy drawing chrome bug
            }
            //console.warn('WWWW', r);
            _cb()
        } else {
            self.go(dirname(self.path), _cb)
        }
    }
    self.enter = () => {
        var e = Pointer.selected(true, false);
        if(e){
            e.trigger('click')
        }
    }
    self.playState = (state) => {
        if(self.currentPlayState != state){
            self.currentPlayState = state;
            var refresh = false, es = self.getEntries(true, false);
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
            var refresh = false, es = self.getEntries(true, false);
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
    self.mergeEntries = (_entries, nentries) => {
        var entries = _entries.slice(0);
        nentries.forEach((nentry) => {
            var ok = false;
            entries.forEach((entry) => {
                if(!ok && entry.name == nentry.name){
                    ok = true;
                }
            });
            if(!ok){
                entries.push(nentry)
            }
        });
        return entries;
    }
    self.go = (fullPath, _cb, failureCb) => {
        if(self.debug){
            console.log('GO', fullPath)
        }
        self.vpath = false;
        var timeout = 10000, ms = 50, container = self.container(true), retries = timeout / ms, cb = (worked) => {
            if(worked === false){
                if(typeof(failureCb) == 'function'){
                    failureCb()
                }
            } else {
                if(typeof(_cb) == 'function'){
                    _cb()
                }
            }
        }
        if(!fullPath){ // just to reset entries in view
            self.path = ''
            self.list(null, self.path)
            return cb(true)
        }
        if(fullPath === self.path){
            return cb(true)
        }
        if(typeof(self.pages[fullPath]) != 'undefined'){
            self.path = fullPath
            console.warn('GO CACHED', fullPath)
            self.list(self.pages[fullPath], self.path)
            return cb(true)
        }
        if(dirname(fullPath) == self.path){
            var es = self.query(self.getEntries(true, false), {name: basename(fullPath), type: 'group'})
            if(es.length){
                return self.trigger(es[0], null, cb)
            }
        }
        if(cs = self.cache(fullPath)){
            container.empty()
            container.append(cs)
            self.path = fullPath
            return cb(true)
        }
        self.path = ''
        var path = fullPath.split('/')
        var cumulatedPath = ''
        var scan = (entries, next) => {
            if(self.debug){
                console.warn('NTRIES', entries, next, cumulatedPath)
            }
            for(var i=0; i<entries.length; i++){
                if(entries[i] && entries[i].name == next){
                    var nentries = read(entries[i], cumulatedPath, basename(fullPath) != next)
                    nentries = applyFilters('internalFilterEntries', nentries, cumulatedPath)
                    if(self.debug){
                        console.warn('OPENED', nentries,  entries[i].name, next, fullPath, path)
                    }
                    if(next == basename(fullPath)){
                        cb(true)
                    }
                    return nentries
                }
            } 
        }
        var open = (_entries, next) => {
            var r, loading = false, entries = _entries;
            entries.forEach((entry) => {
                if(!loading && entry && entry.class && entry.class.indexOf('entry-loading') == -1){
                    loading = true;
                }
            })
            if(self.debug) {
                console.warn('OPEN', next,  'IN', entries, cumulatedPath)
            }
            var nentries = scan(entries, next)
            if(self.debug) {
                console.warn('NTR', nentries)
            }
            if(!nentries && loading){
                var r = self.asyncResult(cumulatedPath)
                if(self.debug) {
                    console.warn('NTR', r)
                }
                if(Array.isArray(r) && r.length){
                    nentries = scan(r, next)
                    if(self.debug) {
                        console.warn('NTR', nentries)
                    }
                } 
            } 
            if(Array.isArray(nentries)){
                return nentries;
            }
            if(r === -1 || !loading) { 
                if(self.debug) {
                    console.warn('ARE WE CANCELLING?!')
                }
                return
            }
        }
        var read = (entry, path) => { // , isVirtual
            var nentries = []
            isVirtual = false
            console.log('RENDERR', path, entry, isVirtual)
            if(typeof(entry.renderer)=='function'){
                if(self.debug){
                    console.log('RENDERING', self.path, path)
                }
                if(!nentries || !nentries.length){
                    nentries = entry.renderer(entry, null, isVirtual)
                    console.log('RENDERR', path, nentries, isVirtual)
                }
            } else {
                if(typeof(entry.entries) != 'undefined'){
                    nentries = entry.entries;
                }
                if(typeof(entry.callback) == 'function'){
                    entry.callback(entry)
                }
            }
            var r = self.asyncResult(path)
            if(r){
                nentries = self.mergeEntries(nentries, r)
            } 
            nentries = applyFilters('internalFilterEntries', nentries)
            return nentries
        }
        var enter = (entries, next) => {
            if(self.debug){
                console.log('enter(next=', next, ')', cumulatedPath, entries, path)
            }
            if(entries.length){
                if(typeof(entries[0]) == 'undefined'){
                    entries = entries.slice()
                }
                if(self.debug){
                    console.log('BOOO', entries)
                }
                if(entries[0].class != 'entry-loading') {
                    if(next){ 
                        if(self.debug){
                            console.log('enter(next=', next, ')')
                        }
                        var nentries = open(entries, next)
                        if(nentries){
                            entries = nentries
                            var next = path.shift()
                            if(next){
                                self.vpath = cumulatedPath = assumePath(next, cumulatedPath)
                                if(self.debug){
                                    console.log('cumulatedPath', cumulatedPath, next)
                                }
                            }
                            return enter(nentries, next)
                        }
                        if(self.debug){
                            console.log('open failed for', next, 'IN', entries, 'result:', nentries, fullPath, '-', path, '-', cumulatedPath)
                        }
                        cb(false)
                    } else {
                        self.vpath = false;
                        self.path = fullPath;
                        if(self.debug){
                            console.log('NO NEXT', self.path, path, entries)
                        }
                        self.container(true) // just to reset entries in view
                        self.renderBackEntry(container, dirname(fullPath), basename(fullPath));
                        self.list(entries, fullPath);
                        if(self.debug){
                            console.warn('listed successfully', entries, container.html().substr(0, 1024))
                        }
                        cb(true);
                        if(self.debug){
                            console.warn('listed successfully 2', entries, container.html().substr(0, 1024))
                        }
                    }
                } else {
                    if(retries){
                        if(self.debug){
                            console.log('retry')
                        }
                        retries--;
                        setTimeout(() => {
                            var n = next ? dirname(cumulatedPath) : cumulatedPath;
                            if(self.debug){
                                console.log('WAITING FOR', n, 'IN', self.asyncResults)
                            }
                            var r = n ? self.asyncResult(n) : index;
                            if(Array.isArray(r)){
                                entries = r;
                            } else if(r === -1){
                                return; // cancel
                            }
                            enter(entries, next) 
                        }, ms)
                    } else {
                        self.vpath = false;
                        if(self.debug){
                            console.log('give it up!')
                        }
                        cb(true)
                    }
                }
            }
        }
        cumulatedPath = path.shift();
        enter(applyFilters('internalFilterEntries', self.entries), cumulatedPath)
    }
    self.queryElements = (entries, atts) => {
        var results = [], attLen = Object.keys(atts).length
        entries.each((i, e) => {
            var entry = jQuery(entries[i]).data('entry-data'), hits = 0;
            if(entry){
                for(var key in atts){
                    if(typeof(entry[key])=='undefined'){
                        break
                    } else if(typeof(entry[key])=='function'){
                        if(entry[key](entry) == atts[key]){
                            hits++
                        } else {
                            break
                        }
                    } else if(entry[key] == atts[key]){
                        hits++
                    } else {
                        break
                    }
                }
                if(hits == attLen){
                    results.push(entries[i])
                }
            } else {
                if(self.debug){
                    console.warn('ENTRY WITH NO DATA?', entries[i], entry)
                }
            }
        });
        return jQuery(results);
    }
    self.query = (entries, atts, remove) => {
        var results = [], attLen = Object.keys(atts).length;
        entries.forEach((e, i) => {
            if(e){
                var hits = 0;
                for(var key in atts){
                    //console.log('GG', e, key);
                    if(typeof(e[key])=='undefined'){
                        break;
                    } else if(typeof(e[key])=='function'){
                        if(e[key](e) == atts[key]){
                            hits++;
                        }
                    } else {
                        if(e[key] == atts[key]){
                            hits++;
                        } else {
                            break;
                        }
                    }
                    if(hits == attLen){
                        results.push(e);
                        if(remove){
                            entries[i] = null;
                        }
                    }
                }     
            }   
        });
        if(remove){
            return entries.filter((item) => {
                return item && typeof(item)=='object';
            }) // reset
        }
        return results;
    }
    self.insertByAtts = (entries, atts, insEntry, insertAfter) => {
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
            } 
            if(hits == attLen){
                j = parseInt(i);
                //console.warn('IINNNSSEERRTTT', j, i, entry);
                break;
            }       
        }
        if(j !== null){
            if(insertAfter){
                j += 1;
            }
            entries = self.query(entries, insEntry, true);
            entries.splice(j, 0, insEntry);
            //console.warn('IINNNSSEERRTTT', entries, insEntry, j);
            return entries.slice(0) // reset
        }
        //console.warn('IINNNSSEERRTTT', j);
        return entries;
    }
    self.insert = (entries, name, entry, insertAfter, replace) => {
        var cleanup, j = null;
        entries = entries.slice(0)
        for(var i in entries) {
            if(entry['name'] == entries[i].name) {
                if(!replace){
                    return entries;
                    break;
                }
                delete entries[i];
                cleanup = true;
            } 
        }
        if(cleanup){
            entries = entries.filter((entry) => {
                return typeof(entry) == 'object' && entry;
            }).slice(0)
        }
        for(var i in entries) {
            if(entries[i]['name'] == name) {
                j = parseInt(i)
            }
        }
        if(j !== null){
            if(insertAfter){
                j += 1;
            }
            if(j >= entries.length){
                j = entries.length - 1;
            }
            entries.splice(j, 0, entry);
            entries = entries.slice(0)
        } else {
            entries.push(entry)
        }
        return entries;
    }
    self.setup = (entries) => {
        self.entries = entries;    
    }
    self.init = (callback) => {
        self.path = ltrimPathBar(Store.get('Menu.path')) || '', pos = self.path.indexOf(Lang.MY_LISTS);
        if(pos == -1 || pos > 3){
            self.path = '';
        }
        self.window.on('unload', function (){
            Store.set('Menu.path', self.path, true)
        })

        self.container().on('mousedown', (event) => {
            //console.warn(event);
            if(jQuery(event.target).is('div') && jQuery('.entry-sub').length){
                self.back()
            }
        })

        self.window.on('appover', () => { 
            clearTimeout(self.appOverTimer);
            self.appOverTimer = setTimeout(() => {
                self.appOverState = true;
                if(self.appOverBindState){
                    self.show()
                }
            }, 400)
        })

        self.window.on('appout', () => { 
            clearTimeout(self.appOverTimer);
            self.appOverTimer = setTimeout(() => {
                self.appOverState = false;
                if(self.appOverBindState){
                    if(Playback.active) { 
                        self.hide() 
                    }
                } 
            }, 400)
        })
        
        Playback.on('commit', () => {
            if(self.appOverBindState){
                self.autoHide(Theme.get('hide-menu-auto'), true);
                if(!self.appOverState){
                    self.hide()
                }
            }
        })
        
        Playback.on('stop', () => {
            self.autoHide(Theme.get('hide-menu-auto'))
            self.show()
        }); // keep this comma

        //console.warn('UPPPPDATE', self.subMenuSizeLimit);
        (() => {
            //console.warn('UPPPPDATE', self.subMenuSizeLimit);
            var timer, icTimer, scrUp = jQuery('#menu-scrolling-up'), scrDw = jQuery('#menu-scrolling-down'), eh = 0, h = 0, interval = 200, initialDelay = 500, container = self.scrollContainer();
            var update = () => {
                var e = jQuery('.entry:visible');
                if(e.length){
                    nh = e.outerHeight();
                    if(nh){
                        eh = nh;
                    }
                    nh = container.innerHeight();
                    if(nh){
                        h = nh;
                    }
                    if(h && eh){
                        self.subMenuSizeLimit = Math.floor(h / eh) - 1
                    }
                }
                if(!self.subMenuSizeLimit) {
                    setTimeout(update, 1000)
                }
            }
            var adjustScrollIcons = (up, dw) => {
                clearTimeout(icTimer);
                if(!self.path){
                    up = dw = false;
                }
                if(up || dw){
                    var es = self.getEntries(false, true);
                    if(up){
                        if(es.first().is(':in-viewport')){
                            up = false;
                        }
                    }
                    if(dw){
                        if(es.last().is(':in-viewport')){
                            dw = false;
                        }
                    }
                }
                if(dw){
                    scrDw.show();			
                    scrUp.hide()
                } else if(up) {
                    scrDw.hide();			
                    scrUp.show()
                } else {
                    return scrDw.add(scrUp).hide() // return here
                }
                icTimer = setTimeout(() => {
                    adjustScrollIcons(false, false)
                }, initialDelay)
            }
            var clearTimer = () => {                
                if(timer){
                    clearTimeout(timer);
                    clearInterval(timer);
                    timer = 0;
                }
            }
            self.on('render', clearTimer);
            jQuery('#menu').on('mousemove', (e) => {
                var areaSize = 0.1, x = e.pageX, y = e.pageY - container.offset().top;
                clearTimer();
                if(!eh){
                    update()
                }
                if(y > (h * (1 - areaSize)) && x <= (win.width - 32)){
                    timer = setTimeout(() => {
                        timer = setInterval(() => {
                            if(!self.rendering && !self.body.hasClass('submenu')){
                                //console.log('DOWN', eh, x, win.width - 32);
                                adjustScrollIcons(false, true);
                                container.scrollTop(container.scrollTop() + eh)
                            }
                        }, interval)
                    }, initialDelay)
                } else if(y < (h * areaSize)){
                    timer = setTimeout(() => {
                        timer = setInterval(() => {
                            if(!self.rendering && !self.body.hasClass('submenu')){
                                //console.log('UP', eh);	
                                adjustScrollIcons(true, false);
                                container.scrollTop(container.scrollTop() - eh)
                            }
                        }, interval)
                    }, initialDelay)
                }
            }).on('mouseleave', () => {
                clearTimer();
                adjustScrollIcons(false, false)
            });
            self.window.on('load resize', update);
            addAction('afterLoadTheming', update);
            update()
        })()
        var cb = () => {
            overlayedMenu(Theme.get('menu-opacity') <= 99);
            setHasMenuMargin(Theme.get('menu-margin') >= 1);
            self.autoHide(Theme.get('hide-menu-auto'))
        }
        addAction('afterLoadTheming', cb);
        cb()
        self.initialized = true;
        self.go('', callback)
    }
    self.selectedData = () => {
        var s = Pointer.selected(true, true);
        return s ? s.data('entry-data') : false;
    }
    self.on('render', (firstRender) => {
        if(firstRender){
            self.restoreScroll()
        }
    })
    return self;
})()

function lazyLoad(element, srcs){
    //console.warn('LAZYLOAD');
    var src,j = jQuery(element), iterator = j.data('lazy-load-iterator');
    srcs = srcs.filter((s, i) => { 
        return !!s;
    });
    if(typeof(iterator) != 'number'){
        iterator = 0;
    }
    console.warn('LAZYLOAD', element.tagName, element.src || element, srcs, iterator);
    if(typeof(srcs[iterator]) != 'undefined'){
        src = srcs[iterator];
    } else {
        console.warn('LAZYLOAD END', element.tagName, element.src || element, srcs, iterator);
        element.onerror = null;
        src = defaultIcons['stream'];
    }
    iterator++;
    if(src.match(new RegExp('(^fa-| fa-)'))){
        if(src.substr(0, 3) == 'fa-'){
            src = 'fas ' + src;
        }
        j.replaceWith('<i class="'+src+' entry-logo-fa" aria-hidden="true"></i>').data('lazy-load-iterator', iterator)
    } else {
        element.src = src;
        j.data('lazy-load-iterator', iterator)
    }
    //console.warn('LAZYLOAD');
}

function getTuningEntry(){
    var mega = 'mega://play|'+Menu.path.replaceAll('/', '-'), type = 'all', t = Tuning.get(mega, type), n = t && !t.suspended ? ('{0} {1}%').format(Lang.TESTING, parseInt(t.status)) : Lang.TEST_THEM_ALL
    return {type: 'option', name: n, label: '', logo: 'fa-magic', class: 'entry-tuning', callback: () => {
        if(Tuning.get(mega, type)){
            Tuning.destroy(mega, type)
            updateTuningOptionsStatus(-1)
        } else {
            if(navigator.onLine){
                updateTuningOptionsStatus(0)
                tuneNFlag(mega, type, () => {
                    t = null
                    updateTuningOptionsStatus(-1)
                    updateStreamEntriesFlags()
                }, (percent, complete, total) => {
                    if(!t){
                        t = Tuning.get(mega, type)
                    }
                    if(t && !t.suspended){
                        updateTuningOptionsStatus(percent)
                    } else {
                        updateTuningOptionsStatus(-1)
                    }
                    updateStreamEntriesFlags()
                })
            } else {
                console.error('tuning DENY', 'No internet connection.')
            }
        }
    }}
}

var showLogos = !Theme.get('hide-logos');  
jQuery(() => {    
    addFilter('allowEntries', (entries, path) => {
        // console.log('XPREFILTERED', entries);
        var nentries = []
        for(var i=0; i<entries.length; i++){
            // entry properties are randomly(?!) coming as buffers instead of strings, treat it until we discover the reason
            if(!entries[i]) continue;
            if(['undefined', 'string'].indexOf(typeof(entries[i].name))==-1){
                entries[i].name = String(entries[i].name)
            }
            if(['undefined', 'string', 'function'].indexOf(typeof(entries[i].label))==-1){
                entries[i].label = String(entries[i].label)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].group))==-1){
                entries[i].group = String(entries[i].group)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].url))==-1){
                entries[i].url = String(entries[i].url)
            }
            let type = typeof(entries[i].type)=='string' ? entries[i].type : 'stream';
            // console.log('XCURFILTERED', type, entries[i], parentalControlAllow(entries[i]));
            if(['stream', 'group'].indexOf(type)!=-1 && !parentalControlAllow(entries[i])){
                // console.log('PARENTAL CONTROL BLOCKED', entries[i]);
                continue
            }
            nentries.push(entries[i]) // not a stream entry
        }         
        // console.log('XPOSFILTERED', entries);
        return nentries
    });
    addFilter('internalFilterEntries', (entries, path) => {
        console.log('FILTERING', entries, traceback())
        return entries.map((opt) => {
            if(opt && opt.url && !opt.renderer && isMegaURL(opt.url)){
                if(typeof(opt.mediaType) == 'undefined'){
                    //opt.mediaType = getMediaType(opt)
                }
                opt = adjustMainCategoriesEntry(opt, 'all')
            }
            return opt
        })
    })
    addFilter('filterEntries', (entries, path) => {
        console.log('PREFILTERED', entries, path);
        var hasStreams = false, hasVisibleStreams = false, firstStreamOrGroupEntryOffset = -1, nentries = [];
        for(var i=0; i<entries.length; i++){
            // entry properties are randomly(?!) coming as buffers instead of strings, treat it until we discover the reason
            if(!entries[i]) continue;
            if(['undefined', 'string'].indexOf(typeof(entries[i].name))==-1){
                entries[i].name = String(entries[i].name)
            }
            if(['undefined', 'string', 'function'].indexOf(typeof(entries[i].label))==-1){
                entries[i].label = String(entries[i].label)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].group))==-1){
                entries[i].group = String(entries[i].group)
            }
            if(['undefined', 'string'].indexOf(typeof(entries[i].url))==-1){
                entries[i].url = String(entries[i].url)
            }
            let type = typeof(entries[i].type) == 'string' ? entries[i].type : (typeof(entries[i].url) == 'string' ? 'stream' : 'option')
            if(type == 'stream' && !entries[i].url){
                console.error('BAD BAD ENTRY', entries[i])
            }
            let nm = type == 'stream' && entries[i].url && !entries[i].url.match(new RegExp('^(magnet|mega):', 'i'))
            if(nm && !hasStreams){
                hasStreams = true;
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
        var ac = (hasStreams && firstStreamOrGroupEntryOffset != -1 && allowTuningEntry(path, nentries))
        if(Menu.path == searchPath || ac) {
            //console.warn(nentries, Menu.query(nentries, {name: Lang.SEARCH_OPTIONS}), Menu.query(nentries, {name: Lang.SEARCH_OPTIONS}).length);
            nentries = Menu.query(nentries, {name: Lang.SEARCH_OPTIONS}, true)
            if(!Menu.query(Menu.getEntries(true), {name: Lang.SEARCH_OPTIONS}).length){
                //console.log('HEREEE!', Menu.path, searchPath, Menu.path == searchPath, lastSearchTerm);
                let aopt = getTuningEntry()
                if(Menu.path == searchPath){
                    //console.log('HEREEE!', aopt, Menu.path);
                    var opts = {name: Lang.SEARCH_OPTIONS, label: Lang.SEARCH, type: 'group', logo: 'fa-cog', 
                        callback: () => {
                            Menu.setBackTo(searchPath)
                            setTimeout(() => {
                                if(basename(Menu.path) == Lang.SEARCH_OPTIONS){
                                    Menu.setBackTo(searchPath)
                                }
                            }, 200)
                        },
                        entries: [
                            {name: Lang.SEARCH_FOR, type: 'group', logo: 'fa-search', renderer: () => { 
                                return Object.values(searchEngines).map(engine => {
                                    return {
                                        name: engine.name,
                                        slug: engine.slug,
                                        logo: 'fa-search',
                                        type: 'option',
                                        callback: (data) => {
                                            goSearch(null, data.slug)
                                        }
                                    }
                                })
                            }},
                            {name: Lang.SECURITY, type: 'option', logo: 'fa-shield-alt', callback: () => { 
                                Menu.go(secPath);
                                Menu.setBackTo(searchPath)
                            }},
                            {name: Lang.TUNE, type: 'option', logo: 'fa-broadcast-tower', callback: () => { 
                                Menu.go(tunePath);
                                Menu.setBackTo(searchPath)
                            }}
                        ]
                    };
                    if(ac){
                        nentries.splice(firstStreamOrGroupEntryOffset, 0, aopt)
                    }
                    nentries.splice(firstStreamOrGroupEntryOffset, 0, opts)
                } else if(ac) {
                    nentries = Menu.query(nentries, {name: aopt.name}, true);
                    nentries.splice(firstStreamOrGroupEntryOffset, 0, aopt)
                }
            }
        }
        if(hasStreams && !hasVisibleStreams){ // has stream entries, but them're blocked by the parental control
            nentries.push(Menu.emptyEntry())
        } else {
            jQuery('.entry-empty').remove()
        }
        // console.log('FILTERED', nentries, entries);
        return nentries;
    })
    addFilter('filterEntries', listManJoinDuplicates)
})