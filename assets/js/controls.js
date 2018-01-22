
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
        entry = Object.assign({}, entry);
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
        if(entry.originalUrl != entry.url){
            entry.url = entry.originalUrl;
        }
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
        notify(Lang.FAV_ADDED.format(s.name), 'fa-star', 'normal');
        refreshListingIfMatch(Lang.BOOKMARKS)
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
        notify(Lang.FAV_REMOVED.format(s.name), 'fa-star', 'normal');
        refreshListingIfMatch(Lang.BOOKMARKS)
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
        registerSource(url)
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
    return "https://www.google.com.br/search?safe=off&tbs=qdr:m&q="+q+"&oq="+q;
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

function fetchIPTVListFromAddr(addr, callback, errorCallback){
    if(!addr.match(new RegExp('^(//|https?://)', 'i'))){
        fs.readFile(addr, (err, content) => {
            content = extractM3U8List(content);
            callback(String(content), addr)
        });
        return;
    }
    var key = 'iptv-content-' + addr, fallbackKey = 'fb-' + key;
    var content = DB.get(key);
    if(!content){
        console.log('No cache, fetching...');
        var internalCallback = function (content){
            content = extractM3U8List(content);
            DB.set(key, content, IPTVListCacheTTL);
            DB.set(fallbackKey, content, IPTVListFallbackCacheTTL);
            callback(content, addr)
        }
        miniget(addr, function (err, object, response){
            if(response && response.indexOf('#EXT')!=-1){
                internalCallback(response)
            } else {
                errorCallback(response, addr)
            }
        });
        content = DB.get(fallbackKey);
    }
    if(content){
        console.log('List cache used.');
        callback(content, addr);
    }
}

function fetchAndParseIPTVListFromAddr(addr, _callback, _errorCallback, isRemote){
    fetchIPTVListFromAddr(addr, function (content, addr, isRemote){
        var parsed = parseIPTVListToIndex(content, addr, isRemote);
        _callback(content, parsed, addr, isRemote);
    }, (response) => {
        _errorCallback(response, addr)
    });
}

var IPTVListCacheTTL = 1800, IPTVListFallbackCacheTTL = DB.maximumExpiral;
function getIPTVListContent(callback, lastTriedAddr, silent) {
    console.log('Getting list... '+lastTriedAddr+' ('+(silent?'Y':'N')+')');
    getIPTVListAddr(function (addr){
        if(!addr){
            console.log('No addr? '+JSON.stringify(addr)+' ('+(silent?'Y':'N')+')');
            if(!silent){
                askForSource(Lang.ASK_IPTV_LIST_FIRST.format(Lang.FIND_LISTS), (url) => {
                    notify(Lang.PROCESSING, 'fa-spin fa-circle-o-notch', 'wait');
                    checkStreamType(url, function (url, type){
                        if(type == 'list'){
                            notify(Lang.LIST_ADDED, 'fa-info', 'normal');
                            registerSource(url);
                            top.modalClose()
                        } else {
                            notify(Lang.INVALID_URL_MSG, 'fa-exclamation-circle', 'normal')
                        }
                    })
                    return false;
                }, null, true);
                jQuery(top.document).find('.prompt-close').remove()
            }
            return;
        }
        fetchAndParseIPTVListFromAddr(addr, callback);
    }, lastTriedAddr);
}

var parseIPTVListRgxGroup = new RegExp('group\-title *= *["\']*([^,"\']*)', 'i');
var parseIPTVListRgxLogo = new RegExp('tvg\-logo *= *["\']*([^"\']+//[^"\']+)', 'i');
var parseIPTVListRgxName = new RegExp(',([^,]*)$', 'i');

function playEntry(stream){
    collectListQueue(stream);
    top.PlaybackManager.cancelLoading();
    if((typeof(stream.source)=='undefined' || !stream.source) && !Store.get('unshare-lists')){
        stream.source = getActiveSource();
        stream.source_nam = getSourceMeta(stream.source, 'name');
        stream.source_len = getSourceMeta(stream.source, 'length');
        if(isNaN(parseInt(stream.source_len))){
            stream.source_len = -1; // -1 = unknown
        }
    }
    top.createPlayIntent(stream, {manual: true}, function (intent){
        updateStreamEntriesFlags()
    })
}

function testEntry(stream, success, error){
    var intents, checkr = () => {
        var worked = false;
        for(var i=0; i<intents.length; i++){
            if(intents[i].ended || intents[i].error){
                continue;
            } else if(!intents[i].started) {
                return; // not ready, just return for now...
                break;
            }
            worked = true;
        }
        for(var i=0; i<intents.length; i++){ // ready
            intents[i].destroy()
        }        
        (worked ? success : error)()
    }
    intents = top.createPlayIntent(stream, {shadow: true, start: checkr, error: checkr, ended: checkr})
    return intents;
}

var sideLoadTried = [];
jQuery(() => {
    top.PlaybackManager.on('commit stop', function (intent){
        if(!intent || !intent.sideload){
            sideLoadTried = [];
            console.log('RESET', intent)
        }
    })
});

function sideLoadPlay(url, originalIntent){
    var debug = true;
    if(debug){
        console.log('SIDELOADPLAY', url);
    }
    var frameIntents = originalIntent ? [originalIntent] : top.PlaybackManager.query({type: 'frame', error: false, ended: false});
    if(frameIntents.length){ // only allow sideload if there's at least one frame intent active
        var surl = removeQueryString(url);
        if(sideLoadTried.indexOf(surl) === -1){ // not already tried
            sideLoadTried.push(surl);
            var sameURLIntents = top.PlaybackManager.query({url: url});
            if(!sameURLIntents.length){
                var entry = frameIntents[0].entry;
                entry.url = url;
                if(debug){
                    console.log('SIDELOADPLAY OK', entry, surl)
                }
                top.createPlayIntent(entry, {sideload: true, 'pre-commit': function (allow, intent){
                    if(debug){
                        console.log('PRE-COMMIT')
                    }
                    if(top.PlaybackManager.activeIntent){ // frame is active, user hasn't changed the channel
                        if(debug){
                            console.log('PRE-COMMIT 1')
                        }

                        // !!!!!!! WAIT, IF THE ACTIVEINTENT IS FROM PREV CHANNEL AND USER CLICKED IN OTHER, WE SHOULD ALLOW IT HERE!
                        // !!!!!!! ACTUALLY, ONLY TWO PLAYING CHANNELS ARE ALLOWED, AS CLICKING AT ONE CANCEL ANOTHER INTENTS,
                        // !!!!!!! SO DEAL HERE WITH HE TWO POSSIBILITIES ONLY!
                        if(intent.entry.originalUrl == top.PlaybackManager.activeIntent.entry.originalUrl){ // this sideload intent is really derived from the current activeIntent
                            if(debug){
                                console.log('PRE-COMMIT 2')
                            }
                            return true;
                        }
                    }
                    if(debug){
                        console.log('PRE-COMMIT 3')
                    }
                    return false;
                }})
            } else {
                if(debug){
                    console.log('SIDELOADPLAY SKIPPED') // url already (side)loading
                }
            }
        } else {
            if(debug){
                console.log('SIDELOADPLAY SKIPPED *', sideLoadTried) // no frame intent
            }
        }
    } else {
        if(debug){
            console.log('SIDELOADPLAY SKIPPED **', top.PlaybackManager.log()) // no frame intent
        }
    }
}

function updateOnlineUsersCount(){
    var callback = (n) => {
        var locale = getLocale(false, true);
        updateRootEntry(Lang.BEEN_WATCHED, {label: Number(n).toLocaleString(locale) + ' ' + ( n==1 ? Lang.USER : Lang.USERS )})
    }
    jQuery.getJSON('http://app.megacubo.net/stats/data/usersonline.json', (response) => {
        if(!isNaN(parseInt(response))){
            Store.set('usersonline', response);
            callback(response)
        }
    });
    var n = Store.get('usersonline');
    if(n){
        callback(n)
    }
}

function nextLogoForGroup(element){
    var entry = jQuery(element).parents('a.entry');
    var data = entry.data('entry-data');
    if(data){
        if(data.entries){
            var src = element.src, found;
            for(var i=0; i<data.entries.length; i++){
                if(element.src == data.entries[i].logo) {
                    found = true;
                } else if(found){
                    if(data.entries[i].logo && (data.entries[i].logo != defaultIcons['stream'])){
                        element.src = data.entries[i].logo;
                        return;
                        break;
                    }
                }
            }
        }
        element.src = defaultIcons[data.type || 'group'];
    } else {
        element.src = defaultIcons['group'];
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
function parseIPTVListToIndex(content, listUrl, isRemote){
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
    if(!isRemote && listUrl){
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
    if(!isRemote && listUrl){
        setSourceMeta(listUrl, 'groups', Object.keys(parsedGroups).length)
    }

    //console.log('BB', parsedGroups);
    var groupedEntries = [];
    for(var k in parsedGroups){
        groupedEntries.push({name: basename(k), path: k, type: 'group', label: '', entries: parsedGroups[k]});
    }

    //console.log('CC', groupedEntries);
    var recursivelyGroupedList = [];
    for(var i=0; i<groupedEntries.length; i++){
        if(groupedEntries[i].path.indexOf('/')!=-1){ // no path
            //console.log('HH', e);
            recursivelyGroupedList = entryInsertAtPath(recursivelyGroupedList, groupedEntries[i].path, groupedEntries[i])
        }
    }
    //console.log('! INDEX !', recursivelyGroupedList, groupedEntries);

    for(var i=0; i<groupedEntries.length; i++){
        if(groupedEntries[i].path.indexOf('/')==-1){ // no path
            //console.log('EE', e);
            //console.log('FF', groupedEntries[i]);
            
            //recursivelyGroupedList.push(groupedEntries[i])
            recursivelyGroupedList = mergeEntriesWithNoCollision(recursivelyGroupedList, [groupedEntries[i]]);
           
            //var f = recursivelyGroupedList;
            //console.log('GG', f);
        }
    }

    //console.log('! INDEX !', recursivelyGroupedList);
    recursivelyGroupedList = labelifyEntriesList(recursivelyGroupedList);
    recursivelyGroupedList = sortListRecursively(recursivelyGroupedList);

    //console.log('! INDEX !', recursivelyGroupedList);
    return recursivelyGroupedList;
}

function sortListRecursively(list){
    var result = [], entry;
    for (var i=0; i<list.length; i++){
        entry = Object.assign({}, list[i]);
        if(entry.type=='group'){
            if(entry.entries.length){
                if(entry.entries.length == 1){
                    entry = entry.entries[0];
                    entry.path = dirname(entry.path);
                } else {
                    entry.entries = sortListRecursively(entry.entries);
                    for (var j=0; j<entry.entries.length; j++){
                        if(entry.entries[j].logo){
                            entry.logo = entry.entries[j].logo;
                            break;
                        }
                    }
                }
            }
        }
        result.push(entry)
    }
    result.sort(function(a, b) {
        return (a.name > b.name) ? 1 : ((b.name > a.name) ? -1 : 0)
    }); 
    return result;
}

function labelifyEntriesList(list, locale){
    if(!locale){
        locale = getLocale(false, true)
    }
    var count;
    for (var i=0; i<list.length; i++){
        if(list[i].type=='group'){
            //entry.label = Number(entry.entries.length).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase();
            count = Number(list[i].entries.length);
            if(count == 1){
                list[i] = list[i].entries[0];
                list[i].path = dirname(list[i].path);
                list[i].group = dirname(list[i].group);
            } else {
                list[i].label = count+' '+Lang.STREAMS.toLowerCase();
                list[i].entries = labelifyEntriesList(list[i].entries, locale);
            }
        } else if(list[i].type=='stream') {
            list[i].label = basename(list[i].path || list[i].group);
        }
    }
    return list;
}

function playResume(){
    if(!Store.get('resume')){
        return;
    }
    var entries = History.get();
    console.log(entries);
    if(entries.length){
        console.log('resume...');
        var i = 0;
        var events = {
			start: function (){
				console.log('RESUME SUCCESS '+document.URL)
			},
			error: function (){
                console.log('RESUME ERROR '+document.URL);
                /*
                if(top){
                    if(!top.PlaybackManager.query({error: false, ended: false}).length){
                        i++;
                        if(i <= entries.length){
                            top.createPlayIntent(entries[i], events);
                            return true;
                        } else {
                            console.log('No more history entries to resume.');
                        }
                    } else {
                        console.log('RESUME INTERRUPTED, ALREADY PLAYING');
                        return;
                    }
                }
                */
			}
        };
        if(!top.PlaybackManager.query({error: false, ended: false}).length){
            console.log(i);
            console.log(entries[i]);
            top.createPlayIntent(entries[i], events)
        }
    } else {
        console.log('History empty.');
    }
}

function revealChannelsLogo(){
    //jQuery(document.querySelectorAll('div.list img[src*="base64"]')).not(':below-the-fold').each(function (){this.src=this.getAttribute('lazy-src')});
    jQuery(document.querySelectorAll('div.list img[lazy-src]')).not(':below-the-fold').each((i, item) => {
        var n = item.getAttribute('lazy-src');
        item.removeAttribute('lazy-src');        
        item.src = n;
    })
}

function getOfflineStreams(){
    var ostreams = Store.get('offline_streams');
    if(!(ostreams instanceof Array)) ostreams = [];
    return ostreams;
}

function getOfflineStreamsURLs(){
    return getOfflineStreams().map((stream) => {
        return stream.url;
    });
}

function registerOfflineStream(stream){
    console.log(stream);
    if(typeof(stream.originalUrl)!='undefined' && stream.originalUrl){
        stream.url = stream.originalUrl;
    }
    var ostreams = Store.get('offline_streams');
    if(!(ostreams instanceof Array)){
        ostreams = [];
    }
    for(var i in ostreams){
        if(ostreams[i].url == stream.url){
            setTimeout(updateStreamEntriesFlags, 1000);
            return;
            break;
        }
    }
    ostreams.push(stream);
    var limit = 8192;
    if(ostreams.length > limit){ // keep entries length in control
        ostreams = ostreams.slice(limit * -1)
    }
    console.log(ostreams);
    Store.set('offline_streams', ostreams);
    if(jQuery('.list').html().indexOf(stream.url)!=-1){
        refreshListing()
    }
}

function unregisterOfflineStream(stream){
    if(typeof(stream.originalUrl)!='undefined' && stream.originalUrl){
        stream.url = stream.originalUrl;
    }
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
    if(jQuery('.list').html().indexOf(stream.url)!=-1){
        refreshListing()
    }
}

function updateStreamEntriesFlags(){

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
            var entries = findEntries(stream.originalUrl);
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

function parseM3U8NameTags(name){
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
                } else {
                    //console.log(match)
                    name = name.replaceAll(match, '</font>')
                }
            }
        }
        name = name.replace(new RegExp('\\[[^\\]]*\\]', 'g'), '').trim();
    }
    if(!name) {
        name = 'Untitled';
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

function getNameFromSource(content){
    var match = content.match(new RegExp('(iptv|pltv)\\-name *= *[\'"]([^\'"]+)'));
    if(match){
        return match[2];
    }
}

function getNameFromSourceURL(url){
    url = url.replace(new RegExp('^[a-z]*://'), '').split('/');
    return url[0].split('.')[0]+' '+url[url.length - 1];
}

function getNameFromSourceURLAsync(url, callback){
    miniget(url, (err, object, response) => {
        var name = false;
        if(!err){
            name = getNameFromSource(response)
        }
        if(!name){
            name = getNameFromSourceURL(url)
        }
        callback(name, url, response)
    })
}

function checkStreamType(url, callback){
    var debug = true, domain = getDomain(url), tsM3u8Regex = new RegExp('\.(ts|m3u8?)([^A-Za-z0-9]|$)');
    if(['http', 'https', false].indexOf(getProto(url)) == -1){ // any other protocol like rtsp, rtmp...
        return callback(url, 'stream')
    }
    if(isMagnet(url) || isVideo(url)){
        return callback(url, 'stream')
    }
    if(!isValidPath(url)){
        return callback(url, 'error')
    }
    var doCheck = function (response){
        var type = 'stream';
        if(response){
            if(response.indexOf('#EXT')!=-1){ // is m3u8
                response = extractM3U8List(String(response));
                if(debug){
                    console.log(response);
                }
                var eis = response.toUpperCase().split('#EXTINF:').length - 1; // EXTINFs
                var eiNDs = (response.toUpperCase().split('#EXTINF:0').length + response.toUpperCase().split('#EXTINF:-1').length) - 2; // EXTINFs with no duration
                console.log('CHECKSTREAMTYPE', eis, eiNDs);
                if(eis && eiNDs >= eis){
                    return callback(url, 'list')
                }
                var parser = getM3u8Parser();
                parser.push(response);
                parser.end();
                /*
                if(debug){
                    console.log('SEGMENT', parser.manifest);
                }
                */
                var u;
                for(var i=0;i<parser.manifest.segments.length;i++){
                    u = parser.manifest.segments[i].uri;
                    if(!u.match(tsM3u8Regex)){ // other format present, like mp4
                        return callback(url, 'list');
                        break;
                    }
                }
            }
        }
        callback(url, type)
    }
    if(url.match(new RegExp('^https?:'))){
        miniget(url, (err, object, response) => {
            if(err){
                console.error('checkStreamType error', err);
                callback(url, 'error')
            } else {
                doCheck(response)
            }
        })
    } else {
        fs.readFile(url, (err, response) => {
            if(err){
                console.error('checkStreamType error', err);
                callback(url, 'error')
            } else {
                doCheck(response)
            }
        })
    }
}

function addNewSource(){
    askForSource(Lang.PASTE_URL_HINT, function (val){
        var url = val;
        console.log('CHECK', url);
        notify(Lang.PROCESSING, 'fa-spin fa-circle-o-notch', 'wait');
        checkStreamType(url, function (url, type){
            console.log('CHECK CALLBACK', url, type);
            notify(false);
            if(type=='stream' && isValidPath(url)){
                playCustomURL(url, true)
            } else if(type=='list'){
                registerSource(url)
            } else {
                notify(Lang.INVALID_URL_MSG, 'fa-exclamation-circle', 'normal')
            }
        });
        return true;
    })
}

function registerSource(url, name){
    var chknam, key = 'sources';
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            notify(Lang.LIST_ALREADY_ADDED, 'fa-warning', 'normal');
            return false;
            break;
        }
    }
    if(!name){
        chknam = true;
        name = getNameFromSourceURL(url);
    }
    sources.push([name, url]);
    Store.set(key, sources);
    notify(Lang.LIST_ADDED, 'fa-star', 'normal');
    setActiveSource(url);
    refreshListingIfMatch(Lang.LISTS);
    if(chknam){
        getNameFromSourceURLAsync(url, (newName, url, content) => {
            if(newName != name){
                setSourceName(url, newName);
                refreshListingIfMatch(Lang.LISTS)
            }
        })
    }
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
            if(key == 'length' && url == getActiveSource()){
                var locale = getLocale(false, true);
                updateRootEntry(Lang.CHANNELS, {label: Number(val).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase()});
                if(listingPath.length < 2){ // ishome
                    refreshListing()
                }
            }
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
    notify(Lang.LIST_REMOVED, 'fa-trash', 'normal')
    return sources;
}

function getActiveSource(){
    var sources = getSourcesURLs();
    if(!sources.length){
        return false
    }
    return sources[0];
}

function setActiveSource(url){
    var skey = 'sources';
    var sources = Store.get(skey);
    var entry = [getNameFromSourceURL(url), url];
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
    readSourcesToIndex()
}

function autoCleanEntries(){
    var entries = jQuery('a.entry-stream').map((i, o) => {
        return jQuery(o).data('entry-data')
    });
    var n = notify(Lang.AUTOCLEAN+' 0%', 'fa-spin fa-circle-o-notch', 'forever');
    var iterator = 0, readyIterator = 0, tasks = Array(entries.length).fill((callback) => {
        var entry = entries[iterator];
        iterator++;
        testEntry(entry, () => {
            readyIterator++;
            n.update(Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'%', 'fa-spin fa-circle-o-notch');
            unregisterOfflineStream(entry);
            callback(null, true);
            top.sendStats('alive', entry)
        }, () => {
            readyIterator++;
            n.update(Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'%', 'fa-spin fa-circle-o-notch');
            registerOfflineStream(entry);
            callback(null, false);
            refreshListing();
            top.sendStats('error', entry)
        })
    });
    if(typeof(async) == 'undefined'){
        async = require('async')
    }
    async.parallelLimit(tasks, 4, (err, results) => {
        n.update(Lang.AUTOCLEAN+' 100%', 'fa-check', 'normal');
    })
}

function areControlsIdle(){
    return jQuery('body').hasClass('idle')
}

function parentalControlTerms(){
    var sepAliases = ['|', ' '];
    var terms = Store.get('parental-control-terms') || '';
    sepAliases.forEach((sep) => {
        terms = terms.replaceAll(sep, ',')
    });
    return terms.toLowerCase().split(',').filter((term) => {
        return term.length >= 2;
    })
}

function parentalControlAllow(entry){
    var terms = parentalControlTerms();
    if(terms.length){
        if(typeof(entry.name)!='undefined' && hasTerms(entry.name, terms)){
            return false;
        }
        if(typeof(entry.url)!='undefined' && hasTerms(entry.url, terms)){
            return false;
        }
    }
    return true;
}

function hasTerms(stack, needles){
    stack = stack.toLowerCase();
    for(var i=0; i<needles.length; i++){
        if(needles[i].length && stack.indexOf(needles[i])!=-1){
            return true;
        }
    }
    return false;
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
    jQuery("body").on("blur", "a", () => {
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

jQuery(window).one('unload', function (){
    top.sendStats('die')
})
    
jQuery(document).one('show', () => {
    jQuery.getJSON('http://app.megacubo.net/configure.json?'+time(), function (data){
        var currentVersion = data.version;
        getManifest(function (data){
            console.log('VERSION', data.version, currentVersion)
            if(data.version < currentVersion){
                jQuery('#help').html('<i class="fa fa-bell" aria-hidden="true"></i>').css('color', '#ff6c00');
                if(confirm(Lang.NEW_VERSION_AVAILABLE)){
                    gui.Shell.openExternal('https://megacubo.tv/online/?version='+data.version);
                }
            }
        })
    })
})

var listingPath = ltrimPathBar(Store.get('listingPath')) || '', autoCleanHintShown = false, pos = listingPath.indexOf(Lang.CHANNELS);
if(pos == -1 || pos > 3){
    listingPath = '';
}
jQuery(window).on('unload', function (){
    Store.set('listingPath', listingPath)
})

jQuery(document).one('lngload', function (){
    window.index = [
        {name: Lang.CHANNELS, label: Lang.PROCESSING, logo:'assets/icons/white/tv.png', url:'javascript:;', type: 'group', entries: [getLoadingEntry()]},
        {name: Lang.SEARCH + ' (F3)', logo:'assets/icons/white/search.png', url:'javascript:;', type: 'option', callback: function (){showSearchField()}},
        {name: Lang.BEEN_WATCHED, logo: 'fa-users', label: '', type: 'group', renderer: getWatchingEntries, entries: []},
        {name: Lang.BOOKMARKS_EXTRAS, logo:'fa-star', type: 'group', renderer: getXtraEntries, entries: []},
        {name: Lang.OPTIONS, logo:'assets/icons/white/settings.png', url:'javascript:;', type: 'group', entries: [
            {name: Lang.MY_LISTS, logo:'fa-shopping-bag', type: 'group', renderer: getListsEntries, callback: markActiveSource, entries: []},
            {name: Lang.WINDOW, logo:'fa-window-maximize', type: 'group', renderer: getWindowModeEntries, entries: []},
            {name: Lang.LANGUAGE, logo:'fa-globe', type: 'group', renderer: getLanguageEntries, callback: markActiveLocale, entries: []},
            {name: Lang.RESET_DATA, logo:'fa-trash', type: 'option', renderer: top.resetData, entries: []},
            {name: Lang.RESUME_PLAYBACK, type: 'check', check: (checked) => {Store.set('resume',checked)}, checked: () => {return Store.get('resume')}},
            /* bad option? think more before make it available
            {name: Lang.FORCE_FFMPEG, type: 'check', check: (checked) => {Store.set('force-ffmpeg',checked)}, checked: () => {return Store.get('force-ffmpeg')}},
            */
            {name: Lang.HIDE_BUTTON_OPT.format(Lang.BACK, 'Backspace'), type: 'check', check: (checked) => {Store.set('hide-back-button',checked)}, checked: () => {return Store.get('hide-back-button')}},
            {name: Lang.PARENTAL_CONTROL, logo:'fa-shield', type: 'group', renderer: getParentalControlEntries, entries: [], callback: () => {
                notify(Lang.PARENTAL_CONTROL_FILTER_HINT, 'fa-shield', 'long')
            }}
        ]}
    ];
    updateOnlineUsersCount();
    setInterval(updateOnlineUsersCount, 600000);
    
    if(getSources().length){
        readSourcesToIndex();
        setTimeout(() => {
            if(!top.PlaybackManager.intents.length){
                playResume()
            }
        }, 1000)
    } else {
        getIPTVListContent(function (){ // trigger to ask user for IPTV list URL
            readSourcesToIndex();
        })
    }
    
    if(listingPath){
        var l = false;
        try{
            l = readIndexPath(listingPath)
        }catch(e){
            console.error(e)
        }
        if(!l || !l.length){
            listingPath = '';
        }
    } else {
        listingPath = '';
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

    setTimeout(function (){
        win.show();
        if(top){
            top.restoreInitialSize();
            if(top.splash){
                top.splash.hide()
            };
            jQuery(document).trigger('show')
        }
    }, 2000)
})

