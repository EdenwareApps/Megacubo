
var menuTemplates = {};

menuTemplates['option'] = `
    <a href="[url]" role="button" onclick="return false;" class="entry entry-option [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
        <table>
            <tr>
                <td class="entry-logo-c">
                    <span class="entry-logo">
                        <span class="entry-logo-fa-c">
                            [logo-tag]
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
                    <span class="entry-logo-fa-c">
                        [logo-tag]
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
                    <span class="entry-logo-fa-c">
                        [logo-tag]
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

menuTemplates['input'] = `
<a href="[url]" draggable="false" role="button" onclick="return false;" class="entry entry-input [class]" title="[name-n-label]" aria-label="[name-n-label]" data-balloon="[name-n-label]" data-balloon-pos="up-left">
    <table class="entry-search">
        <tr>
            <td>
                <span class="entry-input-logo">
                    <span class="entry-logo-fa-c">
                        [logo-tag]
                    </span>
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
                    <span class="entry-logo-fa-c">
                        [logo-tag]
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
                    <span class="entry-logo-fa-c">
                        [logo-tag]
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
                    <span class="entry-logo-fa-c">
                        [logo-tag]
                    </span>
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
    'stream': 'far fa-play-circle',
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

function help(){
    nw.Shell.openExternal(nw.App.manifest.bugs)
}

var searchSuggestions = [], searchSuggestionsEntries = []

function getSearchSuggestions(){
    let allow = () => {
        return basename(Menu.path) == basename(searchPath) && jQuery('.entry-search input').val().length <= 2 && !jQuery('.entry-suggest').length
    }
    let done = (entries) => {
        if(allow()){
            jQuery('.entry-suggest').remove()
            Menu.list(entries, searchPath)
        }
    }
    let getEntries = (cb) => {
        if(searchSuggestionsEntries.length){
            cb(searchSuggestionsEntries)
        } else {
            getSuggestions(suggestions => {
                let entries = []
                suggestions.forEach((suggest, i) => {
                    suggestions[i].search_term = suggestions[i].search_term.trim()
                    if(parentalControlAllow(suggest.search_term)){
                        var t = Lang.SEARCH + ': ' + suggest.search_term, c = ucWords(suggest.search_term), s = encodeURIComponent(c), entry = {name: c, logo: 'http://app.megacubo.net/logos/'+encodeURIComponent(s)+'.png', type: 'stream', label: Lang.MOST_SEARCHED, url: 'mega://play|'+s};
                        entries.push({
                            name: suggest.search_term, 
                            logo: 'fa-search', 
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
                    }
                })
                searchSuggestionsEntries = entries
                cb(searchSuggestionsEntries)
            })
        }
    }
    let getSuggestions = (cb) => {
        if(searchSuggestions.length){
            cb(searchSuggestions)
        } else {
            var url = 'http://app.megacubo.net/stats/data/searching.'+getLocale(true)+'.json';
            fetchEntries(url, (suggestions) => {
                searchSuggestions = removeSearchSuggestionsTermsAliasesObject(suggestions)
                cb(searchSuggestions)
            })
        }
    }
    getEntries(done)
}

function getSearchSuggestionsTerms(){
    return searchSuggestions.map(s => s.search_term)
}

function removeSearchSuggestionsCheckNames(a, b){
    return (a != b && (a.substr(b.length * -1) == b || (a.indexOf(b) != -1 && a.length <= (b.length + 3))))
}

function removeSearchSuggestionsGetAliases(o){
    let aliases = {}
    if(o.length){
        s = o.slice(0)
        if(typeof(s[0]) == 'object'){
            s = s.map(t => {
                return t.search_term
            })
        }
        s.forEach((k, i) => {
            s.forEach(t => {
                if(removeSearchSuggestionsCheckNames(t, k)){
                    if(typeof(aliases[k]) == 'undefined'){
                        aliases[k] = []
                    }
                    aliases[k].push(t)
                }
            })
        })
    }
    return aliases
}

function removeSearchSuggestionsTermsAliases(s){
    if(s.length){
        let aliases = removeSearchSuggestionsGetAliases(s)
        s = s.filter(v => {
			let keep = true
        	Object.keys(aliases).some(k => {
				if(aliases[k].indexOf(v) != -1){
                    keep = false
					return true
				}
			})
			return keep
        })
    }
    return s
}

function removeSearchSuggestionsTermsAliasesObject(s){
    if(s.length){
        let aliases = removeSearchSuggestionsGetAliases(s), cnts = {}
        s = s.filter((o, i) => {
            let keep = true
            if(typeof(o.cnt) != 'number'){
                o.cnt = parseInt(o.cnt)
            }
        	Object.keys(aliases).some(k => {
				if(aliases[k].indexOf(o.search_term) != -1){
                    let rem = s.some((t, j) => {
                        if(t.search_term == k){
                            s[j].cnt = parseInt(s[j].cnt) + o.cnt
                            return true
                        }
                    })  
                    if(rem){
                        keep = false
                    }                  
				}
            })
            return keep
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

class VirtualMenu extends Events {
	constructor(opts){
        super()
		this.j = jQuery;
		this.window = this.j(window);
		this.body = this.j('body');
		this.initialized = false;
		this.debug = false;
		this.path = '';
		this.vpath = false;
		this.entries = [];
		this.events = {};
		this.rendering = false;
		this.lastListScrollTop = 0;
		this.subMenuSizeLimit = 0;
		this._container = false;
		this._containerParent = false;
		this.currentPlayState = false;
		this.currentRecordingState = false;
		this.asyncResults = {};
		this.scrollCache = {};
		this.scrollContainerCache = false;
		this.triggeringCache = {};
		this.appOverTimer = 0;
		this.appOverState = true;
		this.appOverBindState = false;
		this.caching = {}
		this.pages = {}
		Object.keys(opts).forEach(k => {
			this[k] = opts[k]
		})
		this.on('render', (firstRender) => {
			if(firstRender){
				this.restoreScroll()
			}
		})
	}
    cache(path, value){
        if(basename(path) != Lang.SEARCH){
            if(value && value instanceof this.j && typeof(this.caching[path]) == 'undefined'){
                let p = path.length
                Object.keys(this.caching).forEach(t => {
                    if(t != path.substr(0, t.length)){
                        this.caching[t].remove()
                        delete this.caching[t]
                    }
                })
                this.caching[path] = value.clone(true)
            }
            if(typeof(this.caching[path]) != 'undefined' && this.caching[path]){
                return this.caching[path].clone(true)
            }
        }
        return false
    }
    scrollContainer(){
        if(!this.scrollContainerCache || !this.scrollContainerCache.length){
            this.scrollContainerCache = this.j('#menu div.list > div > div').eq(0);
        }
        return this.scrollContainerCache;
    }
    asyncResult(path, _entries, silent){
        if(typeof(_entries)=='undefined'){
            return (typeof(this.asyncResults[path])=='undefined' ? false : this.asyncResults[path])
        }
        if(!Array.isArray(_entries)){
            _entries = [this.emptyEntry()]
        }
        var entries = _entries.slice(0);
        if(typeof(entries.toArray) == 'function'){
            entries = entries.toArray()
        }
        if(this.debug){
            console.log('ASYNCRESULT', path, this.path)
        }
        this.asyncResults[path] = entries;
        if(path != searchPath){
            this.pages[path] = entries.slice(0)
            if(!this.pages[path].length || !this.pages[path][0].class || this.pages[path][0].class.indexOf('entry-back') == -1){
                this.pages[path].unshift(this.backEntry(basename(path)))
            }
        }
        if(silent !== true && path == this.path){
            if(this.debug){
                console.log('ASYNCRESULT', entries, path, this.path)
            }
            var container = this.container(true);
            this.renderBackEntry(container, dirname(path), basename(path))
            if(Array.isArray(entries)){
                if(!entries.length){
                    entries.push(this.emptyEntry())
                }
                this.list(entries, path)
            } else if(entries === -1) {
                this.back()
            }
        }
    }
    containerParent(){
        if(!this._containerParent){
            this._containerParent = this.j('#menu div.list')
        }
        return this._containerParent
    }
    container(reset){
        if(!this._container){
            this._container = this.containerParent().find('div > div').eq(0)
        }
        if(reset){
            if(this.debug){
                console.log('container reset')
            }
            this.body.removeClass('submenu')
            this.containerParent().prop('scrollTop', 0)
            this._container.empty()
            lastTabIndex = 1
        }
        return this._container;
    }
    isVisible(){
        return this.body.hasClass('show-menu')
    }
    isHiding(){
        return this.controlsHiding || false
    }
    show(){
        if(!this.isVisible()){
            sound('menu', 9)
            var b = this.body, o = getFrame('overlay')
            if(o && o.document && o.document.body){
                b = b.add(o.document.body)
            }
            b.addClass('show-menu')
            doAction('menuShow')
        } else {
            console.log('DD')
        }
    }
    hide(){
        //console.log('EE', traceback())
        if(this.isVisible()){
            sound('menu', 9);
            //console.log('HH')
            this.controlsHiding = true;
            this.body.add(getFrame('overlay').document.body).removeClass('isdialing show-menu paused');
            var controlsActiveElement = document.activeElement;
            //console.log('HIDE', controlsActiveElement)
            if(controlsActiveElement && controlsActiveElement.tagName.toLowerCase()=='input'){
                //console.log('HIDE UNFOCUS', controlsActiveElement)
                Pointer.focusPrevious()
            }
            setTimeout(() => {
                this.controlsHiding = false;
            }, 600);
            doAction('menuHide')
        }
    }
    toggle(){
        this[this.isVisible()?'hide':'show']()
    }
    autoHide(state, force){
        if(state && (force === true || true || Playback.active)){
            this.body.addClass('auto-hide');
            if(!this.appOverBindState){
                this.appOverBindState = true;
                this.j('div#menu-left-border').css({
                    'height': '100%',
                    'top': 0
                });
                this.j('#menu-trigger, #menu-toggle').hide()
            }
        } else {
            this.body.removeClass('auto-hide');
            if(this.appOverBindState){
                this.appOverBindState = false;
                this.j('div#menu-left-border').css({
                    'height': 'calc(100% - 33px)',
                    'top': '33px'
                });
                this.j('#menu-trigger, #menu-toggle').show()
            }
        }
    }
    renameSelected(){
        var element = Pointer.selected(true, true);
        if(element && element.length && element.is('a')){
            var entry = element.data('entry-data');
            if(typeof(entry.rename)=='function'){
                var name = element.find('.entry-name');
                var input = this.j('<input type="text" class="entry-name" />');
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
                            this.j(this).trigger("blur");
                        }
                    })
                }, 400)
            }
        }
    }
    backEntry(label){
        var back = {
            name: Lang.BACK,
            type: 'back',
            class: 'entry-back',
            logo: 'fa-chevron-left',
            callback: this.back
        };
        if(label){
            back.label = '<i class="fas fa-map-marker-alt"></i>&nbsp; '+label;
        }
        if(Theme.get('hide-back-button')){
            back.class += ' entry-hide';
        }
        return back;
    }
    renderBackEntry(container, backPath, label){
        if(this.debug){
            console.warn('renderBackEntry', backPath, traceback())
        }
        this.container(true); // reset always for back button
        var back = this.backEntry(label);
        this.render([back], 1)
    }
    emptyEntry(txt, icon){
        return {
            name: txt || Lang.EMPTY, 
            logo: icon || 'fa-sticky-note', 
            type: 'option',
            class: 'entry-empty'
        }
    }
    loadingEntry(txt){
        if(!txt) txt = Lang.LOADING;
        return {
            type: 'option',
            name: txt,
            label: '',
            logo: 'fa-mega spin-x-alt',
            class: 'entry-loading'
        }
    }
    loaded(){
        this.j('.entry-loading').remove()
    }
    setBackTo(path){
        if(path != this.path) {
            var c = (top || parent);
            console.warn('SETBACK TO', path, traceback());
            this.j(c.document).find('.entry-back').off('mousedown click').on('click', () => {
                this.go(path, null, () => {
                    if(path){
                        this.go('')
                    }
                })
            })
        }
    }
    setBackToHome(){
        this.setBackTo('')
    }
    refresh(ifmatch, _cb){
        var cb = () => {
            if(typeof(_cb) == 'function'){
                _cb()
                _cb = null
            }
        }
        if(typeof(ifmatch) != 'string' || this.path.indexOf(ifmatch) != -1){
            var lst = this.containerParent(), top = lst.prop('scrollTop'), inSearch = (this.path.indexOf(Lang.SEARCH) != -1)
            var previouslySelected = Pointer.selected(true, false)
            previouslySelected = previouslySelected ? previouslySelected.data('entry-data') : false;
            if(inSearch){
                this.containerParent().find('input').trigger('input')
            } else {
                var scrl = this.saveScroll(true)
                var cur = this.path;
                console.warn('no triggerer', scrl, cur)
                if(cur){
                    this.back(() => {
                        this.getEntries().each((i, element) => {
                            var data = this.j(element).data('entry-data')
                            if(data && data.name == basename(cur) && data.type == 'group'){
                                console.warn('retrigger', data, traceback())
                                this.trigger(data, element, () => {
                                    this.restoreScroll(scrl)
                                    cb()
                                })
                            }
                        })
                    })
                } else {
                    this.path = '-';                    
                    this.go(cur, () => {
                        this.restoreScroll(scrl)
                        if(this.debug){
                            console.log('after refresh', this.container().html())
                        }
                        cb()
                    })
                }
                return;
            }
        }
        cb()
    }
    triggerer(path, entry){
        if(entry){
            this.triggeringCache[path] = entry;
        }
        return this.triggeringCache[path] || false;
    }
    trigger(data, element, _cb, animEnded){
        this.rendering = true;
        var slide = Theme.get('slide-menu-transitions')
        if(animEnded !== true){
            console.warn('ANIM', data);
            if(data.type == 'back'){
                sound('click-out', 3);
                if(slide){
                    listBackEffect(this.j.noop);
                    this.trigger(data, element, _cb, true);
                    return
                }
            } else if(data.type == 'group') {
                sound('click-in', 4);
                if(slide){
                    listEnterEffect(() => {
                        this.trigger(data, element, _cb, true)
                    })
                    return
                }
            } else if(data.type == 'stream') {
                sound('warn', 16) // no return, no effect
            }
        }
        this.emit('trigger', data, element)
        var cb = () => {
            if(typeof(_cb)=='function'){
                _cb()
            }
        }
        // console.log('TRIGGER', data, element, traceback());
        if(data.type == 'input' || (typeof(data.class)=='string' && data.class.indexOf('entry-disable')!=-1)){
            this.rendering = false;
            return cb()
        }
        if(data.type == 'group'){ // prior to dealing with the back entry
            this.lastListScrollTop = this.j('.list').scrollTop()
        }
        if(data.type == 'back'){
            //console.log(data.path);
            /*
            var newPath = dirname(this.path);
            // console.log('BACK', newPath);
            var triggerer = this.triggerer(newPath);
            this.go(newPath);
            setTimeout(() => { // without this delay the callback was being triggered too quick.
                // console.warn('BACK TRIGGER', triggerer, this.path, newPath);
                if(this.path == newPath && triggerer && typeof(triggerer.callback)=='function'){
                    triggerer.callback();
                }
                if(this.lastListScrollTop && !this.j('.list').scrollTop()){
                    this.j('.list').scrollTop(this.lastListScrollTop)
                }
            }, loadingToActionDelay);
            */
            this.back();
            this.rendering = false;
            cb();
            return true;
        }
        this.saveScroll(true);  
        if(typeof(data.path)=='undefined'){
            data.path = this.path;
        }
        var entries = null, listDirectly = false, npath = assumePath(data.name, data.path);
        console.log('TRIGGER DATA 1', data, data.path, this.path, data.name, npath);
        if(Array.isArray(data.entries)){
            listDirectly = true;
            entries = data.entries;
        }
        if(typeof(data.renderer)=='function'){
            entries = data.renderer(data, element, false);
            console.log('TRIGGER DATA 1.5', entries);
            if(entries === -1){
                this.rendering = false;
                return cb()
            } else if(!Array.isArray(entries)){
                console.log('!! RENDERER DIDNT RETURNED A ARRAY', entries, data.path);
            }
        }
        //console.log('TRIGGER DATA', npath, data, data.path, entries);
        if(data.type == 'group'){
            var ok = false;
            this.triggerer(npath, data);
            console.log('TRIGGER DATA 2', data.path, npath, entries);
            if(Array.isArray(entries)){
                if(entries.length == 1 && entries[0].class && entries[0].class.indexOf('entry-loading') != -1){
                    let dat = this.renderEntry(entries[0], element.tabIndexOffset, false)
                    this.j(element).replaceWith(dat.html)
                    this.path = npath
                    ok = true
                } else {
                    entries = applyFilters('internalFilterEntries', entries, npath);
                    //console.error('XXXXXXXX', entries, data, this.path && entries.length <= this.subMenuSizeLimit);
                    if(entries.length <= this.subMenuSizeLimit && (!data.class || (data.class.indexOf('entry-nosub') == -1 && data.class.indexOf('entry-compact') == -1))){
                        //console.error('XXXXXXXX', entries, data);
                        if(!element){
                            var es = this.queryElements(this.getEntries(false, false), {name: data.name, type: data.type});
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
                        this.container().find('a.entry').show().each((i, entry) => {
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
                            this.getEntries(true, false).every((entry, i) => {
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
                            var pas = this.container().find('a.entry')
                            pas.filter('.entry-sub').remove()
                            var nentries = entries.slice(0)
                            nentries.unshift(this.backEntry(data.name)) // do not alter entries
                            this.list(nentries, npath, offset ? offset - 1 : 0, true)
                            var rv = this.container().find('a.entry').not(pas)
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
                            this.fitSubMenuScroll()
                        }
                    }
                } 
                if(!ok){
                    this.renderBackEntry(this.container(true), dirname(npath), data.name);
                    //this.path = ltrimPathBar(npath);
                    if(Array.isArray(entries)){
                        console.log('TRIGGER DATA 3', data.name, data.path, npath, entries);
                        this.list(entries, npath)
                    }
                }
            }
        }
        this.rendering = false;
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
    adjustBodyClass(inHome, force){
        if(!this.vpath || force === true){
            if(inHome && !this.path){
                if(this.debug){
                    console.warn('INHOME', traceback(), inHome, this.path)
                }
                this.adjustBodyClassDirectly(true)
            } else {
                this.adjustBodyClassDirectly(false)
            }
        }
    }
    adjustBodyClassDirectly(inHome){
        if(this.debug){
            console.warn('INHOME', traceback(), inHome, this.path)
        }
        if(inHome){
            if(this.debug){
                console.warn('INHOME', traceback(), inHome, this.path)
            }
            this.body.addClass('home').removeClass('submenu')
        } else {
            this.body.removeClass('home')
        }
        doAction('Menu.adjustBodyClass', inHome)
        if(this.debug){
            console.warn('INHOME OK')
        }
    }
    getEntries(getData, visibleOnly, noBackEntry){
        var c = this.container(), e = c.find('a.entry'+(visibleOnly?':visible':'')+(noBackEntry?':not(.entry-back)':'')), f = e.filter('.entry-sub');
        if(f.length){
            e = f
        }
        return getData ? e.toArray().map((e) => {
            return this.j(e).data('entry-data')
        }) : e
    }
    list(entries, path, at, sub){
        var cached, container = this.container(false)
        if(!entries){
            entries = applyFilters('homeEntries', this.entries.slice(0)) || []
        }
        if(this.path && this.path == dirname(path)){
            let cs = container.children().not('.entry-loading')
            if(cs.length > 1 && cs.filter('.entry-back').length){
                this.cache(this.path, cs)
            }
        }
        this.saveScroll()
        var lst = this.containerParent()
        if(this.debug){
            console.log('Menu.list PREFILTER', at, entries, path, traceback())
        }
        var tabIndexOffset = getTabIndexOffset()
        entries = applyFilters('allowEntries', entries, path)
        entries = applyFilters('internalFilterEntries', entries, path)
        entries = applyFilters('filterEntries', entries, path)
        if(this.debug){
            console.log('Menu.list POSFILTER', entries, path, traceback())
        }
        for(var i=0; i<entries.length; i++){
            entries[i].path = path
        }
        this.path = path
        if(path != searchPath){
            this.pages[this.path] = entries.slice(0)
            if(!this.pages[this.path].length || !this.pages[this.path][0].class || this.pages[this.path][0].class.indexOf('entry-back') == -1){
                this.pages[this.path].unshift(this.backEntry(basename(this.path)))
            }
        }
        Object.keys(this.pages).forEach(k => {
            if(this.path.indexOf[k] == -1){
                this.pages[k] = undefined
            }
        })
        if(this.debug){
            console.log('menuList', container.html().substr(0, 1024))
        }
        this.render(entries, tabIndexOffset, at, sub)
        if(this.debug){
            console.log('menuList', container.find('a').length, container.html().substr(0, 1024))
        }
        if(sub && typeof(at)=='number'){            
            this.body.addClass('submenu')
        } else {     
            this.body.removeClass('submenu')
            updateStreamEntriesFlags()
        }   
        if(this.debug){
            console.log('menuList', container.find('a').length, container.html().substr(0, 1024))
        }
        var lps = 7
        lst.find('.marquee:not(.marquee-adjusted)').each((i, e) => {
            this.j(e).addClass('marquee-adjusted').find('*:eq(0)').css('animation-duration', parseInt(e.innerText.length / lps)+'s')
        })
        if(this.debug){
            console.log('menuList', container.find('a').length, container.html().substr(0, 1024))
        }        
        this.emit('list', entries, path, at)
        return entries
    }
    renderIcon(entry, fallbacks){
        var html, logo = defaultIcons[entry.type || 'option']
        if(entry.logo){
            if(entry.logo.indexOf('//') != -1){
                if(fallbacks.indexOf(entry.logo) == -1){
                    fallbacks.unshift(entry.logo)
                }
            } else if(entry.logo.indexOf('fa-') != -1){
                logo = entry.logo
            }
        }
        if(entry.logos){
            fallbacks = fallbacks.concat(entry.logos).getUnique()
        }
        var logoColor = typeof(entry.logoColor) == 'undefined' ? '' : 'color: '+entry.logoColor+';';
        if(logo.indexOf('fa-mega') != -1){
            html = '<i class="'+logo+' entry-logo-fa" style="'+logoColor+'" aria-hidden="true"></i>'
        } else {
            if(logo.substr(0, 3) == 'fa-'){
                logo = 'fas ' + logo
            }
            html = '<i class="'+logo+' entry-logo-fa" style="'+logoColor+'" aria-hidden="true"></i>'
        }
        return {html, fallbacks}
    }
    renderEntry(entry, tabIndexOffset, isCompact){
        if(entry == null || typeof(entry)!='object'){
            if(this.debug){
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
        if(entry.type == 'group' && entry.logos){
            entry.class = (entry.class || '') + ' entry-meta-stream'
        }
        //console.log('WWWWWWWWWWWWW', entry);
        if(typeof(menuTemplates[entry.type])=='undefined'){
            if(this.debug){
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

        var icon = this.renderIcon(entry, [])
        if(entry.type == 'stream' || (entry.type == 'group' && entry.class && entry.class.indexOf('entry-meta-stream') != -1)){
            entry.logos = icon.fallbacks
        }

        html = html.replace('[logo-tag]', icon.html)
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
                var me = this.j(event.currentTarget);
                var data = me.data('entry-data');
                if(data.type == 'check') {
                    var checked = typeof(data.checked)!='undefined' && data.checked(data);
                    checked = !checked;
                    handleEntryInputChecking(me, checked);
                    if(typeof(data.check)=='function') data.check(checked, data, event.currentTarget);
                    sound('switch', 12);
                    //console.warn('OK?', data, checked, data.check);
                } else {
                    this.trigger(data, event.currentTarget)
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
                var data = this.j(event.target).data('entry-data');
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
                    this.body.trigger('wake');
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
                    Pointer.focus(this.j(e), true)
                }, 200)
            }
        }
        atts.mouseleave = (event) => {
            clearTimeout(listEntryFocusOnMouseEnterTimer)
        }
        return {html, atts, isCompact}
    }
    render(entries, tabIndexOffset, at, sub){ // render entries
        if(this.debug){
            console.log('render', entries)
        }
        if(typeof(at) != 'number' || at < 0){
            at = false;
        }
        if(typeof(tabIndexOffset)!='number'){
            tabIndexOffset = getTabIndexOffset()
        }
        entries = applyFilters('renderEntries', entries, this.path);
        var isCompact = false, allEvents = [], allHTML = '';
        entries.forEach((entry, i) => { // append
            let dat = this.renderEntry(entry, tabIndexOffset, isCompact)
            if(typeof(dat) == 'object' && dat){
                allHTML += dat.html
                allEvents.push(dat.atts)
                isCompact = dat.isCompact
                tabIndexOffset++
            }
        })
        if(this.debug){
            console.log('render', at, allHTML)   
        }
        if(isCompact){
            allHTML += '</div>';
        }
        var ri = allEvents.length, rv = null;
        if(sub && typeof(at)=='number'){
            //console.warn('AAAAAAAAAAAAA', at);
            this.saveScroll();
            var as = this.container().find('a.entry'), eq = as.eq(at)
            if(eq.length){
                as.filter('.entry-sub').not(eq).remove()
                as.show().slice(at, at + allEvents.length).hide()
                eq.after(allHTML)
                rv = this.container().find('a.entry').not(as).reverse()
            } else {
                this.container().append(allHTML)
                rv = this.container().find('a').reverse()
            }
        } else {
            this.container().append(allHTML)
            rv = this.container().find('a').reverse()
        }
        if(this.debug){
            console.log('render', this.container().html(), sub, at)  
            console.log('render', allHTML)  
        }
        rv.each((i, element) => {
            ri--
            if(ri >= 0){
                for(var key in allEvents[ri]){
                    if(this.debug){
                        console.log('render ev', key)  
                    }
                    switch(key){
                        case 'data': 
                            this.j(element).data('entry-data', allEvents[ri][key]);
                            break;
                        case 'change': 
                            this.j(element).find('input').on('input', () => {
                                var data = this.j(this).data('entry-data');
                                this.body.trigger('wake');
                                allEvents[ri][key](data, this, this.value)
                            })
                            break;
                        case 'placeholder': 
                            this.j(element).find('input').prop('placeholder', allEvents[ri][key]);
                            break;
                        case 'value': 
                            var v = allEvents[ri][key], n = this.j(element).find('input');
                            if(n.attr('type') == 'range'){
                                var entry = this.j(element).data('entry-data');
                                v = parseInt((v - entry.range.start) / ((entry.range.end - entry.range.start) / 100))
                            }
                            n.val(v);
                            break;
                        case 'checked': 
                            handleEntryInputChecking(this.j(element), allEvents[ri][key]);
                            break;
                        default: 
                            this.j(element).on(key, allEvents[ri][key]);
                            break;
                    }
                }
            }
        })  
        if(this.debug){
            console.log('render', this.container().html())  
        }
        this.emit('render', typeof(at)!='number' || at === 0)
        if(this.debug){
            console.log('render', this.container().html())  
        }
        LogoFind.go()
    }
    fitSubMenuScroll(){
        var subs = this.getEntries(false, true, false)
        if(subs.length){
            var first = subs.first(), last = subs.last();
            var subHeight = (last.offset().top + last.outerHeight()) - first.offset().top, y = this.scrollContainer().scrollTop() + first.position().top;
            if(this.scrollContainer().scrollTop() > y){
                this.scrollContainer().scrollTop(y)
            } else {
                y = ((last.position().top + last.outerHeight()) - this.scrollContainer().outerHeight()) - this.scrollContainer().scrollTop();
                if(y > this.scrollContainer().scrollTop()){
                    this.scrollContainer().scrollTop(y)
                }
            }
        }
    }
    saveScroll(force){
        var p = this.path || '_', c = this.scrollContainer(), l = c.scrollTop();
        if(typeof(this.scrollCache[p])=='undefined'){
            this.scrollCache[p] = {offset: 0, data: false}
        }
        if(l || force === true){
            var s = this.selectedData();
            this.scrollCache[p].offset = l;
            this.scrollCache[p].data = s || (typeof(this.scrollCache[p].data) != 'undefined' ? this.scrollCache[p].data : false);
            return this.scrollCache[p];
        }
    }
    restoreScroll(data, cb){
        var ok = false;
        var _path = this.path;
        var p = this.scrollContainer(), pt = this.path || '_', insub = this.body.find('.entry-sub').length // use it instead of this.body.hasClass('submenu') to prevent error on entering ALL_LISTS
        if(!data || typeof(data) != 'object'){
            data = this.scrollCache[pt]
        }
        if(this.debug){
            console.warn('RESTORE SCROLL', data, insub)
        }
        if(data){
            if(data.data){
                this.getEntries(false, true).each((i, element) => {
                    if(!ok){
                        var j = this.j(element), entry = j.data('entry-data');
                        if(entry && entry.name == data.data.name){
                            if(this.debug){
                                console.warn('RESTORE SCROLL', data, p.scrollTop())
                            }
                            Pointer.focus(j, false);
                            ok = true;
                        }
                    }
                })
            } else if(typeof(data.offset)=='number' && !insub) {
                p.scrollTop(data.offset);
                if(this.debug){
                    console.warn('RESTORE SCROLL', data, p.scrollTop())
                }
                Pointer.focus(this.j('a.entry:not(.entry-back):visible:in-viewport:eq(0)'), false);
                ok = true;
            }
        }
        this.adjustBodyClass(insub ? this.path.indexOf('/') == -1 : (!_path))
        if(!ok){
            if(this.debug){
                console.warn('RESTORE SCROLL', p.scrollTop())
            }
            Pointer.focus(false, true);
            ok = true;
        }
        if(insub){
            if(this.debug){
                console.warn('RESTORE SCROLL', this.path, p.scrollTop(), this.body.hasClass('submenu'))
            }
            this.fitSubMenuScroll()
        }
        if(typeof(cb) == 'function'){
            cb(!ok, data)
        }
    }
    triggerKey(type){
        var s = Pointer.selected(true, false);
        if(s) {
            s.trigger(type)
        }
    }
    back(cb){   
        this.vpath = false;
        this.body.removeClass('submenu'); 
        var redraw, container = this.container(), subs = container.find('a.entry-sub')
        if(this.debug){
            console.log('BACK', subs.length, this.path, traceback())
        }
        var r = this.path, _cb = () => {
            if(r == this.path){
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
            this.path = dirname(this.path)
            this.adjustBodyClass(this.path.indexOf('/') == -1)
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
                var es = this.queryElements(this.getEntries(false, false), {name: basename(this.path), type: 'group'})
                if(es && es.length){
                    es.eq(0).trigger('click')
                    _cb()
                } else {
                    this.go(this.path, _cb)
                }
                return
            } else {
                redraw = true // avoid messy drawing chrome bug
            }
            //console.warn('WWWW', r);
            _cb()
        } else {
            this.go(dirname(this.path), _cb)
        }
    }
    enter(){
        var e = Pointer.selected(true, false);
        if(e){
            e.trigger('click')
        }
    }
    playState(state){
        if(this.currentPlayState != state){
            this.currentPlayState = state;
            var refresh = false, es = this.getEntries(true, false);
            es.forEach((e, i) => {
                if(!refresh && e.class && e.class.indexOf('entry-vary-play-state') !=-1){
                    refresh = true;
                }
            });
            if(refresh){
                this.refresh()
            }
        }
    }
    recordingState(state){
        if(this.currentRecordingState != state){
            this.currentRecordingState = state;
            var refresh = false, es = this.getEntries(true, false);
            es.forEach((e, i) => {
                if(!refresh && e.class && e.class.indexOf('entry-vary-recording-state') !=-1){
                    refresh = true;
                }
            });
            if(refresh){
                this.refresh()
            }
        }
    }
    mergeEntries(_entries, nentries){
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
    go(fullPath, _cb, failureCb){
        if(this.debug){
            console.log('GO', fullPath)
        }
        this.vpath = false;
        var cs, timeout = 10000, ms = 50, container = this.container(true), retries = timeout / ms, cb = (worked) => {
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
            this.path = ''
            this.list(null, this.path)
            return cb(true)
        }
        if(fullPath === this.path){
            return cb(true)
        }
        if(typeof(this.pages[fullPath]) != 'undefined'){
            this.path = fullPath
            console.warn('GO CACHED', fullPath)
            this.list(this.pages[fullPath], this.path)
            return cb(true)
        }
        if(dirname(fullPath) == this.path){
            var es = this.query(this.getEntries(true, false), {name: basename(fullPath), type: 'group'})
            if(es.length){
                return this.trigger(es[0], null, cb)
            }
        }
        if(cs = this.cache(fullPath)){
            container.empty()
            container.append(cs)
            this.path = fullPath
            if(this.debug){
                console.log('render', this.container().html())  
            }
            this.emit('render', typeof(at)!='number' || at === 0)
            LogoFind.go()
            return cb(true)
        }
        this.path = ''
        var path = fullPath.split('/')
        var cumulatedPath = ''
        var scan = (entries, next) => {
            if(this.debug){
                console.warn('NTRIES', entries, next, cumulatedPath)
            }
            for(var i=0; i<entries.length; i++){
                if(entries[i] && entries[i].name == next){
                    var nentries = read(entries[i], cumulatedPath, basename(fullPath) != next)
                    nentries = applyFilters('internalFilterEntries', nentries, cumulatedPath)
                    if(this.debug){
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
            if(this.debug) {
                console.warn('OPEN', next,  'IN', entries, cumulatedPath)
            }
            var nentries = scan(entries, next)
            if(this.debug) {
                console.warn('NTR', nentries)
            }
            if(!nentries && loading){
                var r = this.asyncResult(cumulatedPath)
                if(this.debug) {
                    console.warn('NTR', r)
                }
                if(Array.isArray(r) && r.length){
                    nentries = scan(r, next)
                    if(this.debug) {
                        console.warn('NTR', nentries)
                    }
                } 
            } 
            if(Array.isArray(nentries)){
                return nentries;
            }
            if(r === -1 || !loading) { 
                if(this.debug) {
                    console.warn('ARE WE CANCELLING?!')
                }
                return
            }
        }
        var read = (entry, path) => { // , isVirtual
            var nentries = [], isVirtual = false
            console.log('RENDERR', path, entry, isVirtual)
            if(typeof(entry.renderer)=='function'){
                if(this.debug){
                    console.log('RENDERING', this.path, path)
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
            var r = this.asyncResult(path)
            if(r){
                nentries = this.mergeEntries(nentries, r)
            } 
            nentries = applyFilters('internalFilterEntries', nentries)
            return nentries
        }
        var enter = (entries, next) => {
            if(this.debug){
                console.log('enter(next=', next, ')', cumulatedPath, entries, path)
            }
            if(entries.length){
                if(typeof(entries[0]) == 'undefined'){
                    entries = entries.slice()
                }
                if(this.debug){
                    console.log('BOOO', entries)
                }
                if(entries[0].class != 'entry-loading') {
                    if(next){ 
                        if(this.debug){
                            console.log('enter(next=', next, ')')
                        }
                        var nentries = open(entries, next)
                        if(nentries){
                            entries = nentries
                            var next = path.shift()
                            if(next){
                                this.vpath = cumulatedPath = assumePath(next, cumulatedPath)
                                if(this.debug){
                                    console.log('cumulatedPath', cumulatedPath, next)
                                }
                            }
                            return enter(nentries, next)
                        }
                        if(this.debug){
                            console.log('open failed for', next, 'IN', entries, 'result:', nentries, fullPath, '-', path, '-', cumulatedPath)
                        }
                        cb(false)
                    } else {
                        this.vpath = false;
                        this.path = fullPath;
                        if(this.debug){
                            console.log('NO NEXT', this.path, path, entries)
                        }
                        this.container(true) // just to reset entries in view
                        this.renderBackEntry(container, dirname(fullPath), basename(fullPath));
                        this.list(entries, fullPath);
                        if(this.debug){
                            console.warn('listed successfully', entries, container.html().substr(0, 1024))
                        }
                        cb(true);
                        if(this.debug){
                            console.warn('listed successfully 2', entries, container.html().substr(0, 1024))
                        }
                    }
                } else {
                    if(retries){
                        if(this.debug){
                            console.log('retry')
                        }
                        retries--;
                        setTimeout(() => {
                            var n = next ? dirname(cumulatedPath) : cumulatedPath;
                            if(this.debug){
                                console.log('WAITING FOR', n, 'IN', this.asyncResults)
                            }
                            var r = n ? this.asyncResult(n) : index;
                            if(Array.isArray(r)){
                                entries = r;
                            } else if(r === -1){
                                return; // cancel
                            }
                            enter(entries, next) 
                        }, ms)
                    } else {
                        this.vpath = false;
                        if(this.debug){
                            console.log('give it up!')
                        }
                        cb(true)
                    }
                }
            }
        }
        cumulatedPath = path.shift();
        enter(applyFilters('internalFilterEntries', this.entries), cumulatedPath)
    }
    queryElements(entries, atts){
        var results = [], attLen = Object.keys(atts).length
        entries.each((i, e) => {
            var entry = this.j(entries[i]).data('entry-data'), hits = 0;
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
                if(this.debug){
                    console.warn('ENTRY WITH NO DATA?', entries[i], entry)
                }
            }
        });
        return this.j(results);
    }
    query(entries, atts, remove){
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
    insertByAtts(entries, atts, insEntry, insertAfter){
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
            entries = this.query(entries, insEntry, true);
            entries.splice(j, 0, insEntry);
            //console.warn('IINNNSSEERRTTT', entries, insEntry, j);
            return entries.slice(0) // reset
        }
        //console.warn('IINNNSSEERRTTT', j);
        return entries;
    }
    insert(entries, name, entry, insertAfter, replace){
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
    setup(entries){
        this.entries = entries;    
    }
    init(callback){
        this.path = ltrimPathBar(Store.get('Menu.path')) || '', pos = this.path.indexOf(Lang.MY_LISTS);
        if(pos == -1 || pos > 3){
            this.path = '';
        }
        this.window.on('unload', function (){
            Store.set('Menu.path', this.path, true)
        })

        this.container().on('mousedown', (event) => {
            //console.warn(event);
            if(this.j(event.target).is('div') && this.j('.entry-sub').length){
                this.back()
            }
        })

        this.window.on('appover', () => { 
            clearTimeout(this.appOverTimer);
            this.appOverTimer = setTimeout(() => {
                this.appOverState = true;
                if(this.appOverBindState){
                    this.show()
                }
            }, 400)
        })

        this.window.on('appout', () => { 
            clearTimeout(this.appOverTimer);
            this.appOverTimer = setTimeout(() => {
                this.appOverState = false;
                if(this.appOverBindState){
                    if(Playback.active) { 
                        this.hide() 
                    }
                } 
            }, 400)
        })
        
        Playback.on('commit', () => {
            if(this.appOverBindState){
                this.autoHide(Theme.get('hide-menu-auto'), true);
                if(!this.appOverState){
                    this.hide()
                }
            }
        })
        
        Playback.on('stop', () => {
            this.autoHide(Theme.get('hide-menu-auto'))
            this.show()
        }); // keep this comma

        //console.warn('UPPPPDATE', this.subMenuSizeLimit);
        (() => {
            //console.warn('UPPPPDATE', this.subMenuSizeLimit);
            var timer, icTimer, scrUp = this.j('#menu-scrolling-up'), scrDw = this.j('#menu-scrolling-down'), eh = 0, h = 0, interval = 200, initialDelay = 500, container = this.scrollContainer();
            var update = () => {
                var nh, e = this.j('.entry:visible')
                if(e.length){
                    nh = e.outerHeight()
                    if(nh){
                        eh = nh;
                    }
                    nh = container.innerHeight()
                    if(nh){
                        h = nh;
                    }
                    if(h && eh){
                        this.subMenuSizeLimit = Math.floor(h / eh) - 1
                    }
                }
                if(!this.subMenuSizeLimit) {
                    setTimeout(update, 1000)
                }
            }
            var adjustScrollIcons = (up, dw) => {
                clearTimeout(icTimer);
                if(!this.path){
                    up = dw = false;
                }
                if(up || dw){
                    var es = this.getEntries(false, true);
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
            this.on('render', clearTimer);
            this.j('#menu').on('mousemove', (e) => {
                var areaSize = 0.1, x = e.pageX, y = e.pageY - container.offset().top;
                clearTimer();
                if(!eh){
                    update()
                }
                if(y > (h * (1 - areaSize)) && x <= (win.width - 32)){
                    timer = setTimeout(() => {
                        timer = setInterval(() => {
                            if(!this.rendering && !this.body.hasClass('submenu')){
                                //console.log('DOWN', eh, x, win.width - 32);
                                adjustScrollIcons(false, true);
                                container.scrollTop(container.scrollTop() + eh)
                            }
                        }, interval)
                    }, initialDelay)
                } else if(y < (h * areaSize)){
                    timer = setTimeout(() => {
                        timer = setInterval(() => {
                            if(!this.rendering && !this.body.hasClass('submenu')){
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
            this.window.on('load resize', update);
            addAction('afterLoadTheming', update);
            update()
        })()
        var cb = () => {
            overlayedMenu(Theme.get('menu-opacity') <= 99);
            setHasMenuMargin(Theme.get('menu-margin') >= 1);
            this.autoHide(Theme.get('hide-menu-auto'))
        }
        addAction('afterLoadTheming', cb);
        cb()
        this.initialized = true;
        this.go('', callback)
    }
    selectedData(){
        var s = Pointer.selected(true, true);
        return s ? s.data('entry-data') : false;
    }
}

const Menu = new VirtualMenu({j: jQuery, debug: debugAllow(false)})

function entriesViewportFilter(entries){
    let skip, ret = [], c = Menu.container(), start = c.scrollTop(), end = start + c.height()
    entries.filter((a, b) => {
        if(skip){
            return false
        }
		let element = typeof(a) == 'number' ? b : a
        let scrTop = element.offsetTop
        if(scrTop > start && scrTop < end) {
            ret.push(element)
        } else if(scrTop > end) {
            skip = true
        }
    })
    return ret
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
                    process.nextTick(updateStreamEntriesFlags)
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
                opt = adjustMainCategoriesEntry(opt, 'live')
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
        // var ac = (hasStreams && firstStreamOrGroupEntryOffset != -1 && allowTuningEntry(path, nentries))



        var ac = (hasStreams && firstStreamOrGroupEntryOffset != -1 && allowTuningEntry(path, nentries))
        if(ac) {
            let aopt = getTuningEntry()
            nentries = Menu.query(nentries, {name: aopt.name}, true);
            nentries.splice(firstStreamOrGroupEntryOffset, 0, aopt)
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