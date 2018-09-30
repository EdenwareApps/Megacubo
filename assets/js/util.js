//import { clearTimeout } from 'timers';

var http = require('http'), request = require('request'), Lang = {};

request = request.defaults({
    headers: {'User-Agent': navigator.userAgent} // without user-agent some hosts return 403
});

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
    var country = Countries.select(locale, 'country_'+locale.substr(0, 2)+',country_iso', 'locale', true); //getLocale();
    var q = "iptv list m3u8 {0} {1}".format(country, (new Date()).getFullYear());
    return q;
}

function getIPTVListSearchURL(){
    var q = getIPTVListSearchTerm();
    q = q.replaceAll(" ", "+");
    return "https://www.google.com/search?safe=off&tbs=qdr:m&q="+q+"&oq="+q;
}

function playPrevious(){ // PCH
    var i = 1, entry = History.get().slice(0, 10).filter((entry) => { 
        if(!i) { 
            return false; 
        } 
        if(!isLocal(entry.url)) { 
            i--; 
            return true; 
        }
    }).shift(); 
    if(entry){
        var c = currentStream();
        console.log('PLAYPREV', entry, traceback());
        if(c && entry.originalUrl == c.originalUrl){
            entry = History.get(1)
        }
        if(entry){
            playEntry(entry)
        }
    }
}

var onlineUsersCount = "";
function updateOnlineUsersCount(){
    var callback = (n) => {
        var locale = getLocale(false, true);
        onlineUsersCount = Number(n).toLocaleString(locale) + ' ' + ( n==1 ? Lang.USER : Lang.USERS );
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

function playResume(){
    if(!Config.get('resume')){
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
                    if(!PlaybackManager.query({error: false, ended: false}).length){
                        i++;
                        if(i <= entries.length){
                            createPlayIntent(entries[i], events);
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
        if(!PlaybackManager.query({error: false, ended: false}).length){
            console.log(i);
            console.log(entries[i]);
            createPlayIntent(entries[i], events)
        }
    } else {
        console.log('History empty.');
    }
}

var streamStateCache = Store.get('stream_state_caches') || {}, streamStateCacheTTL = (7 * (24 * 3600));

function streamCacheNormalizeURL(url){
    url = String(url);
    if(url.indexOf('%') != -1){
        var n;  
        try {
        	n = decodeURIComponent(url)
        } catch(e) {
    	    //console.warn(e, url)
        }
        if(n){
            url = n;
        }
    }
    if(url.indexOf('&amp;') != -1 && top && decodeEntities){
        url = decodeEntities(url);
    }
    if(url.indexOf(':80/') != -1){
        url.replace(':80/', '/')
    }
    return url.replace(':80/', '/')
}

function getStreamStateCache(_url, ttl){
    var url = streamCacheNormalizeURL((_url && typeof(_url) == 'object') ? _url.url : _url);
    if(typeof(streamStateCache[url])=='object' && streamStateCache[url] && typeof(streamStateCache[url].time)!='undefined' && time() < (streamStateCache[url].time + (ttl || streamStateCacheTTL))){
        return streamStateCache[url].state;
    }
    return null;
}

function setStreamStateCache(entry, state, commit){
    var urls = [entry.url];
    if(entry.originalUrl && !isMega(entry.originalUrl)){
        urls.push(entry.originalUrl)
    }
    urls.forEach((url) => {
        streamStateCache[streamCacheNormalizeURL(url)] = {'state': state, 'time': time()};
    });
    if(commit){
        saveStreamStateCache()
    }
}

function saveStreamStateCache(){
    Store.set('stream_state_caches', streamStateCache)
}

addAction('appUnload', saveStreamStateCache);

function playEntry(stream){
    var allow = true;
    allow = applyFilters('prePlayEntryAllow', allow, stream);
    if(allow){
        if(!Config.get('play-while-tuning')){
            stop();
        }
        collectListQueue(stream);
        stream.prependName = '';
        stream.allowWebPages = true;
        PlaybackManager.cancelLoading();
        createPlayIntent(stream, {manual: true});
        updateStreamEntriesFlags()
    } else {
        console.warn('prePlayEntryAllow DENY', stream)
    }
}

function updateStreamEntriesFlags(){

    // offline streams
    var activeurls = [];
    if(stream = currentStream()){
        activeurls.push(stream.url);
        if(stream.originalUrl){
            activeurls.push(stream.originalUrl)
        }
    }

    // pending entries
    var loadingurls = PlaybackManager.isLoading(true);
    if(typeof(isPending)=='string'){
        loadingurls.push(isPending)
    }
    console.log(loadingurls, isPending);

    var doSort = allowAutoClean(Menu.path);

    var fas = jQuery('.entry-stream'), autoCleaning = jQuery('.entry-autoclean').filter((i, e) => { 
        return e.innerHTML.indexOf('% ') != -1; 
    }).length, firstStreamOffset = false;
    fas = fas.each((i, element) => {
        if(doSort){
            let state = getStreamStateCache(element.href);
            if(state === false){
                // is offline?
                let e = jQuery(element), n = e.find('.entry-label');
                n.find('.stream-state').remove();
                n.prepend('<span class="stream-state"><i class="fas fa-thumbs-down faclr-red" style="font-size: 90%;position: relative;top: 0px;"></i> </span>');
                e.addClass('entry-offline')
            } else if(state === true) {
                let e = jQuery(element), n = e.find('.entry-label');
                n.find('.stream-state').remove();
                n.prepend('<span class="stream-state"><i class="fas fa-thumbs-up faclr-green" style="font-size: 90%;position: relative;top: -1px;"></i></span> ');
                e.removeClass('entry-offline');
            } else if(autoCleaning) {
                let e = jQuery(element), n = e.find('.entry-label');
                n.find('.stream-state').remove();
                n.prepend('<span class="stream-state"><i class="fas fa-clock" style="color: #eee;font-size: 90%;position: relative;top: -1px;"></i></span> ');
                e.removeClass('entry-offline');
            }
        }
        if(activeurls.indexOf(element.href)!=-1){
            setEntryFlag(element, 'fa-play-circle faclr-green')
        } else if(loadingurls.indexOf(element.href)!=-1){
            setEntryFlag(element, 'fa-circle-notch fa-spin')
        } else {
            setEntryFlag(element, '')
        }
    });
    if(doSort){
        sortEntriesByState(fas)
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
    var r = false, sources = Config.get(key) || [];
    for(var i=0; i<sources.length; i++){
        if(!jQuery.isArray(sources[i])){
            delete sources[i];
            r = true;
        }
    }
    if(r){
        sources = sources.filter(function (item) {
            return item !== undefined && item !== null && item !== false;
        })
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
    return (url[0].split('.')[0]+' '+url[url.length - 1]).replaceAll('?', ' ');
}

function getNameFromSourceURLAsync(url, callback){
    request(url, (err, object, response) => {
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
    var debug = false, domain = getDomain(url), tsM3u8Regex = new RegExp('\.(ts|m3u8?)([^A-Za-z0-9]|$)');
    if(['http', 'https', false].indexOf(getProto(url)) == -1){ // any other protocol like rtsp, rtmp...
        return callback(url, 'stream')
    }
    if(getExt(url)=='m3u'){
        return callback(url, 'list')
    }
    if(isMagnet(url) || isVideo(url) || isTS(url)){
        return callback(url, 'stream')
    }
    if(!isValidPath(url)){
        return callback(url, 'error')
    }
    var doCheck = function (response){
        var type = 'stream';
        if(response){
            if(response.indexOf('#EXT')!=-1){ // is m3u8
                response = String(response);
                response = ListMan.extract(response)
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
                if(parser.manifest && parser.manifest.segments){
                    for(var i=0;i<parser.manifest.segments.length;i++){
                        u = parser.manifest.segments[i].uri;
                        if(!u.match(tsM3u8Regex)){ // other format present, like mp4
                            return callback(url, 'list');
                            break;
                        }
                    }
                }
            }
        }
        callback(url, type)
    }
    if(url.match(new RegExp('^https?:'))){
        var timeout = 15000, fetchOptions = {redirect: 'follow', method: 'HEAD'};
        fetchTimeout(url, (r, ct) => {
            if(ct){
                if(ct && ct.indexOf('video')!=-1){
                    callback(url, 'stream')
                } else { // no valid content-type, fetch the whole content to check better
                    timeout = 30000, fetchOptions = {redirect: 'follow'};
                    fetchTimeout(url, (r) => {
                        if(r){
                            doCheck(r)
                        } else {
                            console.error('checkStreamType error', r);
                            callback(url, 'stream')
                        }
                    }, timeout, fetchOptions)
                }
            } else {
                console.error('checkStreamType error', r);
                callback(url, 'error')
            }
        }, timeout, fetchOptions)
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
    askForSource(Lang.PASTE_URL_HINT, (val) => {
        var url = val;
        console.log('CHECK', url);
        var n = notify(Lang.PROCESSING, 'fa-spin fa-circle-notch', 'wait');
        checkStreamType(url, (url, type) => {
            console.log('CHECK CALLBACK', url, type);
            n.close();
            if(type=='stream' && (isValidPath(url) || isMagnet(url))){
                playCustomURL(url, true)
            } else if(type=='list'){
                registerSource(url)
            } else {
                notify(Lang.INVALID_URL_MSG, 'fa-exclamation-circle faclr-red', 'normal')
            }
        });
        return true;
    })
}

function registerSource(url, name, silent, norefresh){
    var chknam, key = 'sources';
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            notify(Lang.LIST_ALREADY_ADDED, 'fa-exclamation-circle faclr-red', 'normal');
            return false;
            break;
        }
    }
    if(!name){
        chknam = true;
        name = getNameFromSourceURL(url);
    }
    sources.push([name, url]);
    Config.set(key, sources);
    if(!silent){
        notify(Lang.LIST_ADDED, 'fa-star faclr-green', 'normal');
    }
    setActiveSource(url);
    if(!norefresh){
        Menu.refresh()
    }
    if(chknam){
        getNameFromSourceURLAsync(url, (newName, url, content) => {
            if(newName != name){
                setSourceName(url, newName);
                if(!norefresh){
                    Menu.refresh()
                }
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
    Config.set(key, sources);
    return true;
}

function setSourceMeta(url, key, val){
    var sources = getSources();
    for(var i in sources){
        if(sources[i][1] == url){
            var obj = sources[i][2] || {};
            obj[key] = val;
            sources[i][2] = obj;
            Config.set('sources', sources)
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
    var sources = Config.get(key);
    if(typeof(sources)!='object'){
        sources = [];
    }
    for(var i in sources){
        if(!jQuery.isArray(sources[i]) || sources[i][1] == url){
            delete sources[i];
        }
    }
    sources = sources.filter(function (item) {
        return item !== undefined;
    });
    Config.set(key, sources);
    notify(Lang.LIST_REMOVED, 'fa-trash faclr-green', 'normal')
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
    var sources = Config.get(skey);
    if(!jQuery.isArray(sources)){
        sources = [];
    }
    var entry = [getNameFromSourceURL(url), url];
    for(var i=0;i<sources.length; i++){
        if(!jQuery.isArray(sources[i])){
            delete sources[i];
        } else if(entry[1] == sources[i][1]){
            entry[0] = sources[i][0];
            delete sources[i];
        }
    }
    console.log('SETACTIVE', entry);
    sources.unshift(entry);
    Config.set(skey, sources);
    markActiveSource()
}

function priorizeEntries(entries, filter){
    var goodEntries = [], badEntries = [], neutralEntries = [];
    entries.forEach((entry) => {
        var s = filter(entry);
        if(s === true){
            goodEntries.push(entry)
        } else if(s === false){
            badEntries.push(entry)
        } else {
            neutralEntries.push(entry)
        }
    });
    return goodEntries.concat(neutralEntries).concat(badEntries)
}

function sortEntriesStateKey(entry, historyData, watchingData){
    if(entry.type == 'group'){
        return '1-0-0-0-0';
    } else if(entry.type != 'stream'){
        return '0-0-0-0-0';
    }
    var state = entry ? getStreamStateCache(entry) : null, inHistory = false, inWatching = false;
    for(var i=0; i<historyData.length; i++){
        if(historyData[i].url == entry.url){
            inHistory = true;
            break;
        }
    }
    if(!inHistory){
        for(var i=0; i<watchingData.length; i++){
            if(watchingData[i].url && watchingData[i].url == entry.url){
                inWatching = true;
                break;
            }
        }
    }
    return '2-'+((state === true) ? 0 : (state === false ? 2 : 1)) + '-' + (inHistory ? 0 : (inWatching ? 1: 2)) + '-' + ((isLive(entry.url)||isRemoteTS(entry.url)) ? 0 : (isVideo(entry.url)?2:1)) + '-' + (entry.name || '').toLowerCase();
}

function sortEntriesByState(entries){
    var historyData = History.get(), watchingData = getWatchingData();
    if(entries instanceof jQuery){
        entries.each((i, o) => {
            let j = jQuery(o);
            if(j.length){
                entry = j.data('entry-data');
                if(entry){
                    j.data('sortkey', sortEntriesStateKey(entry, historyData, watchingData))
                }
            }
        });
        var p = entries.eq(0).prev(), type = 'after'; 
        if(!p.length){
            p = entries.eq(0).parent();
            type = 'prepend';
        }
        entries.detach().sort((a, b) => {
            var c = jQuery(a).data('sortkey');
            var d = jQuery(b).data('sortkey');
            return c > d ? 1 : -1;
        });   
        if(type == 'after'){
            entries.insertAfter(p)
        } else {
            p.prepend(entries)
        }
    } else {
        if(entries.sortBy){
            for(var i=0; i<entries.length; i++){
                if(entries[i]){
                    entries[i].sortkey = sortEntriesStateKey(entries[i], historyData, watchingData)
                }
            }
            return entries.sortBy('sortkey')
        }
    }
    return entries;
}

function deferEntriesByURLs(entries, urls){
    entries.sort((x, y) => {
        var a = urls.indexOf(x.url);
        var b = urls.indexOf(y.url);
        return a - b;
    });
    return entries;
}

var installedVersion = 0, availableVersion = 0, sharedLists = [], sharedListsSearchWordsIndex = {}, sharedListsSearchWordsIndexStrict = {};

function isListSharingActive(){
    return !!Config.get('search-range-size');
}

function fetchSharedLists(callback){
    if(sharedLists.length){
        callback(sharedLists)
    } else {
        if(isListSharingActive()){
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

function fetchEntries(url, callback){
    console.log('FETCH', url, traceback());
    var key = 'remote-entries-'+url, fbkey = key + '-fb', doFetch = false, data = Store.get(key);
    if(!jQuery.isArray(data)){
        doFetch = true;
        data = Store.get(fbkey); // fallback
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
                if(typeof(callback)=='function'){
                    callback(ndata)
                }
            } else {
                if(typeof(callback)=='function'){
                    callback(data)
                }
            }
        }).fail(function (jqXHR, textStatus, errorThrown) {
            console.warn('XMLHTTP failed', url, jqXHR, textStatus, errorThrown);
            if(typeof(callback)=='function'){
                callback(data)
            }
        })
    } else {
        if(typeof(callback)=='function'){
            callback(data)
        }
    }
    return data;
}

var uiSounds = [];

function soundSetup(tag, vol){
    uiSounds[tag] = new buzz.sound("assets/sounds/"+tag, {
        formats: [ "mp3" ],
        volume: vol
    })
}

function sound(tag, vol){
    if(appShown){
        if(!vol){
            vol = 100;
        }
        if(typeof(uiSounds[tag]) == 'undefined'){
            soundSetup(tag, vol)
        }
        uiSounds[tag].stop().play();
        if(vol && uiSounds[tag].getVolume() != vol){ // lazily for sooner playback
            uiSounds[tag].setVolume(vol)
        }
    }
}
