
var gui = require('nw.gui'), win = gui.Window.get();

var History = (function (){
    var key = 'history', _this = {}, limit = 48;
    var fullHistory = Store.get(key);
    if(fullHistory === null){
        fullHistory = [];
    }
    _this.get = function (index){
        if(typeof(index)=='number'){
            return fullHistory[index] || false;
        }
        return fullHistory.slice(0)
    };
    _this.add = function (entry){
        if(typeof(entry.originalUrl)=='string'){
            entry.url = entry.originalUrl; // ignore the runtime changes in URL
        }
        if(typeof(entry.type)!='undefined'){
            delete entry.type;
        }
        for(var i in fullHistory){
            if(fullHistory[i].url == entry.url){
                delete fullHistory[i];
            }
        }
        fullHistory.push(entry);
        fullHistory = fullHistory.reverse().filter(function (item) {
            return item !== undefined;
        }).slice(0, limit);
        Store.set(key, fullHistory);
    };
    _this.clear = function (){
        fullHistory = [];
        Store.set(key, fullHistory);
    };
    return _this;
})();

var RecordingHistory = (function (){
    var key = 'recording', _this = {}, limit = 48;
    var fullRecordingHistory = Store.get(key);
    if(fullRecordingHistory === null){
        fullRecordingHistory = [];
    }
    _this.get = function (index){
        if(typeof(key)=='number'){
            return fullRecordingHistory[key] || false;
        }
        return fullRecordingHistory.slice(0)
    };
    _this.sync = function (){
        for(var i in fullRecordingHistory){
            if(!fullRecordingHistory[i] || !fs.existsSync(fullRecordingHistory[i].url)){
                delete fullRecordingHistory[i];
            }
        }
        fullRecordingHistory = fullRecordingHistory.filter(function (item) {
            return item !== undefined;
        }).slice(0, limit);
    };
    _this.removeByURL = function (url){
        for(var i in fullRecordingHistory){
            if(fullRecordingHistory[i].url == url || !fs.existsSync(fullRecordingHistory[i].url)){
                delete fullRecordingHistory[i];
            }
        }
        _this.sync()
    };
    _this.add = function (entry){
        _this.removeByURL(entry.url);
        fullRecordingHistory.unshift(entry);
        _this.sync();
        Store.set(key, fullRecordingHistory);
    };
    _this.clear = function (){
        fullRecordingHistory = [];
        Store.set(key, fullRecordingHistory);
    };
    return _this;
})();

var Bookmarks = (function (){
    var key = 'bookmarks', _this = {};
    var fullBookmarks = Store.get(key);
    if(fullBookmarks === null){
        fullBookmarks = [];
    }
    _this.get = function (index){
        if(typeof(key)=='number'){
            return fullBookmarks[key] || false;
        }
        return fullBookmarks;
    }
    _this.is = function (entry){
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == entry.url){
                return true;
            }
        }
    }
    _this.add = function (entry){
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == entry.url){
                delete fullBookmarks[i];
            }
        }
        fullBookmarks.push(entry);
        fullBookmarks = fullBookmarks.reverse().filter(function (item) {
            return item !== undefined;
        });
        Store.set(key, fullBookmarks);
    }
    _this.remove = function (entry){
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == entry.url){
                delete fullBookmarks[i];
            }
        }
        fullBookmarks = fullBookmarks.reverse().filter(function (item) {
            return item !== undefined;
        });
        Store.set(key, fullBookmarks);
    }
    _this.clear = function (){
        fullBookmarks = [];
        Store.set(key, fullBookmarks);
    };
    return _this;
})();

function addFav(s){
    if(!s && areControlsActive()){
        s = selectedEntry();
        if(s && s.type!='stream'){
            s = false;
        }
    }
    if(!s){
        s = currentStream()
    }
    if(s && !Bookmarks.is(s)){
        Bookmarks.add(s);
        notify(Lang.FAV_ADDED.format(s.name), 'fa-star', 'normal')
    }
}

function removeFav(s){
    if(!s && areControlsActive()){
        s = selectedEntry();
        if(s && s.type!='stream'){
            s = false;
        }
    }
    if(!s){
        s = currentStream()
    }
    if(s && Bookmarks.is(s)){
        Bookmarks.remove(s);
        notify(Lang.FAV_REMOVED.format(s.name), 'fa-star', 'normal')
    }
}

function validateIPTVListURL(url, placeholder){
    if(url && url.length >= 13 && url != placeholder){
        return url;
    }
    return false;
}

function getIPTVListAddr(callback, value) {
    var key = 'iptvlisturl', placeholder = 'http://[...].m3u8';
    if(value) placeholder = value;
    var def = getActiveSource();
    var url = validateIPTVListURL(def, placeholder);
    if(url){
        registerSource(url);
        if(url != def){
            setActiveSource(url);
        }
    }
    callback(url);
    //return 'http://pastebin.com/raw/TyG4tRKP';
    //  you find it at Google searching for \"iptv list m3u8 {0} {1}\".
}

function getIPTVListSearchTerm(){
    var locale = getDefaultLocale(false, false);
    var country = top.Countries.select(locale, 'country_'+locale.substr(0, 2)+',country_iso', 'locale', true); //getLocale();
    var q = "iptv list m3u8 {0} {1}".format(country, (new Date()).getFullYear());
    return q;
}

function getIPTVListSearchURL(){
    var q = getIPTVListSearchTerm();
    q = q.replaceAll(" ", "+");
    return "https://www.google.com.br/search?safe=off&q="+q+"&oq="+q;
}

function extractM3U8List(content){
    var e = (new RegExp('#EXTM3U[\s\t\r]*[\n]+', 'm')).exec(content);
    if(e && e.index){
        content = content.substr(e.index);
    }
    e = (new RegExp('</[A-Za-z]+>')).exec(content);
    if(e && e.index){
        content = content.substr(0, e.index);
    }
    return content;
}

function fetchIPTVListFromAddr(addr, callback){
    if(!addr.match(new RegExp('^(//|https?://)', 'i'))){
        fs.readFile(addr, (err, content) => {
            content = extractM3U8List(content);
            callback(String(content), addr)
        });
        return;
    }
    var key = 'iptv-content-' + addr, fallbackKey = 'fb-' + key;
    var content = DB.query(key);
    if(!content){
        console.log('No cache, fetching...');
        var internalCallbackError = function (){
            return;
        }
        var internalCallback = function (content){
            content = extractM3U8List(content);
            DB.insert(key, content, IPTVListCacheTTL);
            DB.insert(fallbackKey, content, IPTVListFallbackCacheTTL);
            callback(content, addr)
        }
        miniget(addr, function (err, object, response){
            if(response){
                internalCallback(response)
            } else {
                internalCallbackError(response)
            }
        });
        content = DB.query(fallbackKey);
    }
    if(content){
        console.log('List cache used.');
        callback(content, addr);
    }
}

function fetchAndParseIPTVListFromAddr(addr, _callback){
    fetchIPTVListFromAddr(addr, function (content, addr){
        var parsed = parseIPTVListToIndex(content, addr);
        _callback(content, parsed, addr);
    });
}

var IPTVListCacheTTL = 1800, IPTVListFallbackCacheTTL = DB.maximumExpiral;
function getIPTVListContent(callback, lastTriedAddr, silent) {
    console.log('Getting list... '+lastTriedAddr+' ('+(silent?'Y':'N')+')');
    getIPTVListAddr(function (addr){
        if(!addr){
            console.log('No addr? '+JSON.stringify(addr)+' ('+(silent?'Y':'N')+')');
            if(!silent){
                askForSource(Lang.ASK_IPTV_LIST_FIRST.format(Lang.WEB_SEARCH), function (url){
                    notify(Lang.PROCESSING, 'fa-spin fa-circle-o-notch', 'wait');
                    checkM3U8Type(url, function (url, type){
                        if(type == 'list'){
                            notify(Lang.PACKAGE_ADDED, 'fa-info', 'normal');
                            registerSource(url);
                            top.modalClose()
                        } else {
                            notify(Lang.IPTV_LIST_PARSE_ERROR, 'fa-exclamation-circle', 'normal')
                        }
                    })
                    return false;
                })
            }
            return;
        }
        fetchAndParseIPTVListFromAddr(addr, callback);
    }, lastTriedAddr);
}

var parseIPTVListRgxGroup = new RegExp('group\-title *= *["\']*([^,"\']*)', 'i');
var parseIPTVListRgxLogo = new RegExp('tvg\-logo *= *["\']*([^"\']+)', 'i');
var parseIPTVListRgxName = new RegExp(',([^,]*)$', 'i');

function playEntry(stream, element){
    collectPackageQueue(stream);
    top.createPlayIntentAsync(stream, {}, function (intent){
        intent.on('error', function (){
            notify(Lang.PLAY_STREAM_FAILURE.format(stream.name), 'fa-exclamation-circle', 'normal')
        })
        intent.on('ended', function (){
            notify(Lang.PLAY_STREAM_FAILURE.format(stream.name), 'fa-exclamation-circle', 'normal')
        })
        updateStreamEntriesFlags()
    })
}

function sideLoadPlay(url){
    console.log('SIDELOADPLAY', url);
    var frameIntents = top.PlaybackManager.query({type: 'frame', started: false});
    if(!frameIntents.length){
        frameIntents = top.PlaybackManager.query({type: 'frame'});
    }
    if(frameIntents.length){
        var urls = top.PlaybackManager.isLoading(true);
        if(urls.indexOf(url)==-1){
            var entry = frameIntents[0].entry;
            entry.url = url;
            console.log('SIDELOADPLAY OK', entry, urls);
            top.createFFmpegIntent(entry, {sideload: true})
        } else {
            console.log('SIDELOADPLAY SKIPPED');
        }
    } else {
        console.log('SIDELOADPLAY FAIL', url);
    }
}

function parseIPTVMeta(meta){
    // get logo, group and name
    var c = {};
    c.logo = parseIPTVMetaField(meta, parseIPTVListRgxLogo);
    c.group = parseIPTVMetaField(meta, parseIPTVListRgxGroup).replaceAll('\\', '/') || Lang.NOGROUP;
    c.label = basename(c.group);
    c.rawname = jQuery.trim(parseIPTVMetaField(meta, parseIPTVListRgxName));
    c.name = c.rawname.replace(new RegExp('\\[[^\\]]*\\]', 'g'), '').trim();
    c.type = 'stream';
    c.private = false;
    return c;
}

function parseIPTVMetaField(meta, rgx, index){
    if(typeof(index)!='number') index = 1;
    var r = meta.match(rgx);
    if(r && r.length > index) return r[index];
    return '';
}

var flatChannelsList = [];
function parseIPTVListToIndex(content, listUrl){
    var parsingStream = null, flatList = [], slist = content.split("\n"), entry;
    for(var i in slist){
        slist[i] = jQuery.trim(slist[i]);
        if(slist[i].length > 12){
            if(slist[i].substr(0, 3).indexOf('#')!=-1){
                parsingStream = parseIPTVMeta(slist[i])
                //console.log(slist[i]);
                //console.log(parsingStream);
            } else if(parsingStream) {
                parsingStream.url = jQuery.trim(slist[i]);
                if(
                    //getExt(parsingStream.url) != 'ts' && // should we allow this type here?
                    parsingStream.url.match(new RegExp('^(magnet:|//|[a-z]+://)', 'i')) && 
                    !parsingStream.url.match(new RegExp('^(//|https?://)(0\.0\.0\.0|127\.0\.0\.1| )')) // ignore bad stream urls
                ){
                    parsingStream.group = parsingStream.group.toUpperCase().replace(new RegExp('(^|[^A-Za-z0-9])N/A([^A-Za-z0-9]|$)', 'i'), '--');
                    flatList.push(parsingStream)
                }
                parsingStream = null;
            }
        }
    }

    //console.log('! flatList !', JSON.stringify(flatList));
    flatList.sort(function(a,b) {return (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0);} ); 
    flatList.sort(function(a,b) {return (a.group > b.group) ? 1 : ((b.group > a.group) ? -1 : 0);} ); 
    if(listUrl){
        window.flatChannelsList[listUrl] = flatList;
        setSourceMeta(listUrl, 'length', flatList.length)
    }
          
    //console.log('AA');
    var parsedGroups = {};
    for(var i=0;i<flatList.length;i++){
        if(typeof(parsedGroups[flatList[i].group])=='undefined'){
            parsedGroups[flatList[i].group] = [];
        }
        parsedGroups[flatList[i].group].push(flatList[i]);
    }
    if(listUrl){
        setSourceMeta(listUrl, 'groups', Object.keys(parsedGroups).length)
    }

    //console.log('BB');
    var locale = getLocale(false, true), groupedEntries = [];
    for(var k in parsedGroups){
        groupedEntries.push({name: basename(k), path: k, type: 'group', label: Number(parsedGroups[k].length).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase(), entries: parsedGroups[k]});
    }

    //console.log('CC', groupedEntries);
    var recursiveGroupedList = [];
    for(var i=0;i<groupedEntries.length;i++){
        var e = recursiveGroupedList;
        //console.log('DD', JSON.stringify(recursiveGroupedList).substr(0, 128));
        if(groupedEntries[i].path.indexOf('/')==-1){ // no path
            //console.log('EE', e);
            //console.log('FF', groupedEntries[i]);
            recursiveGroupedList.push(groupedEntries[i]);
            var f = recursiveGroupedList;
            //console.log('GG', f);
        } else {
            //console.log('HH', e);
            recursiveGroupedList = entryInsertAtPath(recursiveGroupedList, groupedEntries[i].path, groupedEntries[i]) // group is entry object of type "group" to be put as last location
        }
    }


    //console.log('! INDEX !', recursiveGroupedList);
    return recursiveGroupedList;
}

function playResume(){
    if(Store.get('no-resume')){
        return;
    }
    var entries = History.get();
    console.log(entries);
    if(entries.length){
        console.log('resume ...');
        var i = 0;
        var events = {
			start: function (){
				console.log('RESUME SUCCESS '+document.URL)
			},
			error: function (){
                console.log('RESUME ERROR '+document.URL);
                if(!top.PlaybackManager.playing()){
                    console.log('RESUME INTERRUPTED, ALREADY PLAYING');
                    return;
                }
				i++;
				if(i <= entries.length){
					top.createPlayIntentAsync(entries[i], events);
					return true;
				} else {
					console.log('No more history entries to resume.');
				}
			}
		};
        console.log(i);
        console.log(entries[i]);
        top.createPlayIntentAsync(entries[i], events)
    } else {
        console.log('History empty.');
    }
}

function revealChannelsLogo(){
    jQuery(document.querySelectorAll('div.list img[src*="base64"]')).not(':below-the-fold').each(function (){this.src=this.getAttribute('lazy-src')});
}

function registerOfflineStream(stream){
    console.log(stream);
    var ostreams = Store.get('offline_streams');
    if(typeof(ostreams)!='object') ostreams = [];
    for(var i in ostreams){
        if(ostreams[i].url == stream.url){
            setTimeout(updateStreamEntriesFlags, 1000);
            return;
            break;
        }
    }
    ostreams.push(stream);
    console.log(ostreams);
    Store.set('offline_streams', ostreams);
    setTimeout(updateStreamEntriesFlags, 1000);
}

function unregisterOfflineStream(stream){
    var ostreams = Store.get('offline_streams');
    if(!(ostreams instanceof Array)){
        ostreams = [];
    }
    for(var i in ostreams){
        if(ostreams[i].url == stream.url){
            delete ostreams[i];
        }
    }
    ostreams = ostreams.filter(function (item) {
        return item !== undefined;
    });
    Store.set('offline_streams', ostreams);
    setTimeout(updateStreamEntriesFlags, 1000);
}

function updateStreamEntriesFlags(){

    // offline streams
    var ostreams = Store.get('offline_streams'), urls = [];
    if(typeof(ostreams)=='object'){
        for(var i in ostreams){
            urls.push(ostreams[i].url);
        }
    }
    var fas = jQuery('.entry');
    fas = fas.filter(function (){
        return (urls.indexOf(this.href)!=-1);
    });
    jQuery('.entry-offline').removeClass('entry-offline');
    fas.addClass('entry-offline');

    // pending entries
    var urls = top.PlaybackManager.isLoading(true);
    var fas = jQuery('.entry');
    fas = fas.each(function (){
        if(urls.indexOf(this.href)!=-1){
            setEntryFlag(this, 'fa-circle-o-notch fa-spin')
        } else {
            setEntryFlag(this, '')
        }
    });

    // active entry
    if(stream = currentStream()){
        var fa = 'fa-play-circle', entries = findActiveEntries(fa);
        for(var i=0;i<entries.length;i++){
            console.log('pSET-'+i);
            setEntryFlag(entries[i], '');
        }
        if(typeof(stream.url)=='string'){
            var entries = findEntries(stream.url);
            for(var i=0;i<entries.length;i++){
                console.log('SET-'+i);
                setEntryFlag(entries[i], fa);
            }
        }
    }
}

function showWindowHandle(show){
    var e = document.getElementById('window-handle');
    if(e){
        e.style.display = show ? 'inline-block' : 'none';
        e.querySelector('a').title = Lang.RESTORE
    }
}

var listEntryFocusOnMouseEnterTimer = 0;

function parseM3U8ColorsTag(name){
    if(name){
        var match, matches = name.match(new RegExp('\\[/?color([^\\]]*)\\]', 'gi'));
        if(matches){
            for(var i=0; i<matches.length; i++){
                match = matches[i]; 
                if(match.toLowerCase().indexOf('[color ')!=-1){console.log(match)
                    try{
                        color = match.match(new RegExp(' ([^\\]]*)\\]', 'i'))[1];
                    } catch(e) {
                        color = '';
                    }
                    name = name.replaceAll(match, color ? '<font color="'+color+'">' : '')
                } else {console.log(match)
                    name = name.replaceAll(match, '</font>')
                }
            }
        }
    }
    return name;
}

function getSources(){
    var key = 'sources';
    var sources = Store.get(key) || [];
    for(var i=0; i<sources.length; i++){
        if(!(sources[i] instanceof Array)){
            delete sources[i];
            sources = sources.filter(function (item) {
                return item !== undefined && item !== null && item !== false;
            });
        }
    }
    return sources;
}

function getSourcesURLs(){
    var urls = [];
    var sources = getSources();
    for(var i=0; i<sources.length; i++){
        urls.push(sources[i][1])
    }
    return urls;
}

function getNameFromSource(url){
    url = url.replace(new RegExp('^[a-z]*://'), '').split('/');
    return url[0].split('.')[0]+' '+url[url.length - 1];
}

function checkM3U8Type(url, callback){
    var debug = true, domain = getDomain(url), absRegex = new RegExp('^(//|https?://)'), m3u8Regex = new RegExp('\.m3u8?([A-Za-z0-9]|$)'), tsRegex = new RegExp('\.ts([A-Za-z0-9]|$)');
    var doCheck = function (response){
        var type = 'stream';
        if(response){
            if(response.indexOf('#EXT')!=-1){ // is m3u8
                response = extractM3U8List(String(response));
                if(debug){
                    console.log(response);
                }
                var xscount = response.toUpperCase().split('EXT-X-STREAM-INF').length; // help distinguish a m3u8 alternate streams file from a segments list or a m3u8 with many different broadcasts
                var xncount = response.toUpperCase().split('#EXTINF:-1').length;
                var parser = getM3u8Parser();
                parser.push(response);
                parser.end();
                if(debug){
                    console.log('SEGMENT', parser.manifest);
                }
                var u, domain, tsDomains = [], m3u8Hits = 0, tsHits = 0;
                for(var i=0;i<parser.manifest.segments.length;i++){
                    u = parser.manifest.segments[i].uri;
                    if(debug){
                        console.log('SEGMENT', parser.manifest.segments[i]);
                    }
                    if(u.match(tsRegex)){
                        tsHits++;
                        var domain = getDomain(u); // get TS domains, we need to diff TS segments in a M3U8 stream from the senseless (?!) TS stream URLs
                        if(domain && tsDomains.indexOf(domain)==-1){
                            tsDomains.push(domain)
                        }
                    } else if(u.match(m3u8Regex)) {
                        m3u8Hits++;
                    }
                }
                if(xscount >= (tsHits + m3u8Hits)){ // todo: find a better logic
                    console.log(xscount, xncount, tsDomains, tsHits, m3u8Hits);
                }
                if(xscount >= (tsHits + m3u8Hits)){ // todo: find a better logic
                    type = 'stream';
                    console.log('Matched as stream.')
                } else if(xncount >= (tsHits / 2)){ // todo: find a better logic
                    type = 'list';
                    console.log('Matched as list.')
                } else {
                    if(tsDomains.length > 1){ // if has many TS domains, is a channel list
                        type = 'stream';
                        console.log('Matched as stream.')
                    } else if(tsHits > m3u8Hits){
                        type = 'stream';
                        console.log('Matched as stream.')
                    } else {
                        type = 'list';
                        console.log('Matched as list.')
                    }
                }
            }
        }
        callback(url, type)
    }
    if(url.match(new RegExp('^https?:'))){
        miniget(url, (err, object, response) => {
            if(err){
                throw err;
            }
            doCheck(response)
        })
    } else {
        fs.readFile(url, (err, response) => {
            if(err){
                throw err;
            }
            doCheck(response)
        })
    }
}

function addNewSource(){
    askForSource(Lang.PASTE_URL_HINT, function (val){
        var url = val;
        console.log('CHECK', url);
        checkM3U8Type(url, function (url, type){
            console.log('CHECK CALLBACK', url, type);
            if(type=='stream'){
                playCustomURL(url, true)
            } else {
                registerSource(url)
            }
        });
        return true;
    })
}

function extractSources(val){
    var urls = extractURLs(val), hits = 0;
    for(var i=0; i<urls.length; i++){
        if(urls[i].match(new RegExp('.ts[^A-Za-z0-9]', 'i'))){
            continue; // skip .TS
        }
        registerSource(urls[i]);
        hits++;
    }
    if(hits){
        readSourcesToIndex()
    }
    return hits > 0;
}

function registerSource(url, name){
    var key = 'sources';
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            return false;
            break;
        }
    }
    if(!name){
        name = getNameFromSource(url);
    }
    sources.push([name, url]);
    Store.set(key, sources);
    notify(Lang.PACKAGE_ADDED, 'fa-star', 'normal');
    refreshListing();
    return true;
}

function setSourceName(url, name){
    var key = 'sources';
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            sources[i][0] = name;
            break;
        }
    }
    Store.set(key, sources);
    return true;
}

function setSourceMeta(url, key, val){
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            var obj = sources[i][2] || {};
            obj[key] = val;
            sources[i][2] = obj;
            Store.set('sources', sources);
        }
    }
}

function getSourceMeta(url, key){
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            var obj = sources[i][2] || {};
            return obj[key] || null;
        }
    }
}

function unRegisterSource(url){
    var key = 'sources';
    var sources = Store.get(key);
    if(typeof(sources)!='object'){
        sources = [];
    }
    for(var i in sources){
        if(!(sources[i] instanceof Array) || sources[i][1] == url){
            delete sources[i];
        }
    }
    sources = sources.filter(function (item) {
        return item !== undefined;
    });
    Store.set(key, sources);
    notify(Lang.PACKAGE_REMOVED, 'fa-trash', 'normal')
    return sources;
}

function getActiveSource(){
    var sources = getSourcesURLs();
    if(!sources.length){
        return false
    }
    return sources[0];
}

function setActiveSource(url, render){
    var skey = 'sources';
    var sources = Store.get(skey);
    var entry = [getNameFromSource(url), url];
    for(var i=0;i<sources.length; i++){
        if(!(sources[i] instanceof Array)){
            delete sources[i];
        } else if(entry[1] == sources[i][1]){
            entry[0] = sources[i][0];
            delete sources[i];
        }
    }
    console.log('SETACTIVE', entry);
    sources.unshift(entry);
    Store.set(skey, sources);
    markActiveSource();
    fetchAndParseIPTVListFromAddr(url, function (content, parsed, url){
        if(parsed.length){
            window.channelsIndex[url] = parsed;
        } else {
            window.channelsIndex[url] = [{name: Lang.EMPTY, logo:'fa-files-o', type: 'option'}]
        }
        console.log(parsed);
        if(typeof(window.index)=='object'){
            window.index = writeIndexPathEntries(Lang.CHANNELS, window.channelsIndex[url]);
            var locale = getLocale(false, true), length = getSourceMeta(url, 'length') || 0;
            window.index[0].label = Number(length).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase()
        }
    })
}

function areControlsIdle(){
    return jQuery('body').hasClass('idle')
}

var tb = jQuery(top.window.document).find('body'), c = tb.find('iframe#controls'), d = jQuery('div#controls');
var lastTabIndex = 1, controlsTriggerTimer = 0;

jQuery(function (){
    var b = jQuery(top.document).find('body'), onfocusout = () => {
        var as = jQuery(".list a:not(.entry-back)").eq(0); //(lastTabIndex < 2)?-1:0);
        if(areControlsActive()){
            as.trigger("focus")
        } else {
            jQuery('body').one('mousemove', function (){
                as.trigger("focus")
            })
        }
    }
    jQuery("body").on("blur", "a", function() {
        setTimeout(function (){
            if(document.activeElement){
                var tag = document.activeElement.tagName.toLowerCase();
                if(['a', 'input'].indexOf(tag)!=-1){
                    lastTabIndex = document.activeElement.tabIndex;
                    if(tag == 'input'){
                        b.addClass('istyping isovercontrols')
                    } else {
                        b.removeClass('istyping')
                    }
                } else {
                    onfocusout()
                }
            } else {
                b.removeClass('istyping')
                onfocusout()
            }
        }, 50);
    })
})

jQuery(window).on('unload', function (){
    top.sendStats('unreg')
})

jQuery(document).on('lngload', function (){
    window.index = [
        {name: Lang.CHANNELS, logo:'assets/icons/white/tv.png', url:'javascript:;', type: 'group', entries: []},
        {name: Lang.SEARCH, logo:'assets/icons/white/search.png', url:'javascript:;', type: 'option', callback: function (){showSearchField()}},
        {name: Lang.OPTIONS, logo:'assets/icons/white/settings.png', url:'javascript:;', type: 'group', entries: [
            {name: Lang.PACKAGES, logo:'fa-shopping-bag', type: 'group', renderer: getPackagesEntries, callback: markActiveSource, entries: []},
            {name: Lang.BOOKMARKS, logo:'fa-star', type: 'group', renderer: getBookmarksEntries, entries: []},
            {name: Lang.RECORDINGS, logo:'fa-download', type: 'group', renderer: getRecordingEntries, entries: []},
            {name: Lang.HISTORY, logo:'fa-history', type: 'group', renderer: getHistoryEntries, entries: []},
            {name: Lang.WINDOW, logo:'fa-window-maximize', type: 'group', renderer: getWindowModeEntries, entries: []},
            {name: Lang.LANGUAGE, logo:'fa-globe', type: 'group', renderer: getLanguageEntries, callback: markActiveLocale, entries: []},
            {name: Lang.RESET_DATA, logo:'fa-trash', type: 'option', renderer: top.resetData, entries: []},
            {name: Lang.RESUME_PLAYBACK, type: 'check', check: function (checked){Store.set('no-resume',!checked)}, checked: !Store.get('no-resume')}
        ]}
    ]
    
    if(getSources().length){
        readSourcesToIndex();
        playResume()
    } else {
        getIPTVListContent(function (){
            readSourcesToIndex();
        })
    }
    if(listingPath){
        var l = false;
        try{
            l = readIndexPath(listingPath)
        }catch(e){}
        if(!l || !l.length){
            listingPath = '/';
        }
    } else {
        listingPath = '/';
    }

    listEntriesByPath(listingPath);
    showControls();

    var lastScrollY = 0;
    jQuery('div.list').on('scroll resize', function (){
        revealChannelsLogo();
        var newScrollY = jQuery(this).scrollTop();
        var direction = (lastScrollY > newScrollY) ? 'up' : 'down';
        lastScrollY = newScrollY;
        if(!jQuery(document.activeElement).is(':in-viewport')){
            var as = jQuery(this).find('a:in-viewport');
            if(as && as.length){
                as.eq(direction ? 0 : -1).trigger('focus')
            }
        }
    })
    
    jQuery.getJSON('http://app.megacubo.net/configure.json?_=', function (data){
        var currentVersion = data.version;
        getManifest(function (data){
            console.log('VERSION', data.version, currentVersion)
            if(data.version < currentVersion){
                jQuery('#help').html('<i class="fa fa-bell" aria-hidden="true"></i>').css('color', '#ff6c00')
            }
        })
    });

    setTimeout(function (){
        win.show();
        if(top){
            top.restoreInitialSize();
            if(top.splash){
                top.splash.hide()
            }
        }
    }, 2000)
})

