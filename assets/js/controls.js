//import { clearTimeout } from 'timers';


var gui = require('nw.gui'), win = gui.Window.get();

var History = (function (){
    var key = 'history', _this = {}, limit = 48;
    var fullHistory = Store.get(key);
    if(fullHistory === null){
        fullHistory = [];
    }
    _this.get = function (index){
        if(typeof(index)=='number'){
            if(typeof(fullHistory[index])!='undefined'){
                return Object.assign({}, fullHistory[index]);
            }
            return false;
        }
        return fullHistory.slice(0)
    };
    _this.add = function (entry){
        console.log('HISTORY ADD', entry);
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
        fullHistory = fullHistory.filter((item) => {
            return !!item
        });
        fullHistory.unshift(entry);
        fullHistory = fullHistory.slice(0, limit);
        console.log('HISTORY ADDED', fullHistory);
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

function sendStatsPrepareEntry(stream){
    if(stream){
        stream.uiLocale = getLocale(false, false);
        stream.ver = 0;
        if(typeof(stream.source)!='undefined' && stream.source){
            stream.source_nam = getSourceMeta(stream.source, 'name');
            stream.source_len = getSourceMeta(stream.source, 'length');
            if(isNaN(parseInt(stream.source_len))){
                stream.source_len = -1; // -1 = unknown
            }
        }
    }
    return stream;
}

function playEntry(stream){
    collectListQueue(stream);
    stream.name = stream.name.replace(Lang.FEATURED+': ', '');
    top.PlaybackManager.cancelLoading();
    top.createPlayIntent(stream, {manual: true}, function (intent){
        updateStreamEntriesFlags()
    })
}

function playPrevious(){ // PCH
    var entry = History.get(0);
    var c = currentStream();
    if(entry){
        console.log('PLAYPREV', entry);
        if(c && entry.originalUrl == c.originalUrl){
            entry = History.get(1)
        }
        if(entry){
            playEntry(entry)
        }
    }
}

function testEntry(stream, success, error){
    if(isMagnet(stream.url) || isYT(stream.url)){
        return success()
    }
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

jQuery(document).on('lngload', () => {
    updateOnlineUsersCount();
    setInterval(updateOnlineUsersCount, 600000)
});

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

function getOfflineStreams(){
    var ostreams = Store.get('offline_streams');
    if(!jQuery.isArray(ostreams)){
        ostreams = [];
    }
    return ostreams;
}

function getOfflineStreamsURLs(){
    return getOfflineStreams().map((stream) => {
        return stream.url;
    });
}

function registerOfflineStream(stream, updateListing){
    console.log(stream);
    if(typeof(stream.originalUrl)!='undefined' && stream.originalUrl){
        stream.url = stream.originalUrl;
    }
    var ostreams = Store.get('offline_streams');
    if(!jQuery.isArray(ostreams)){
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
    if(updateListing){
        if(jQuery('.list').html().indexOf(stream.url)!=-1){
            refreshListing()
        }
    }
}

function unregisterOfflineStream(stream, updateListing){
    if(typeof(stream.originalUrl)!='undefined' && stream.originalUrl){
        stream.url = stream.originalUrl;
    }
    var ostreams = Store.get('offline_streams');
    if(!jQuery.isArray(ostreams)){
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
    if(updateListing){
        if(jQuery('.list').html().indexOf(stream.url)!=-1){
            refreshListing()
        }
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
        e.querySelector('a').title = Lang.RESTORE;
    }
    if(top){
        top.PlaybackManager.setRatio()
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
                } else if (ct && ct.toLowerCase().indexOf('mpegurl')!=-1){
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
    askForSource(Lang.PASTE_URL_HINT, function (val){
        var url = val;
        console.log('CHECK', url);
        var n = notify(Lang.PROCESSING, 'fa-spin fa-circle-o-notch', 'wait');
        checkStreamType(url, function (url, type){
            console.log('CHECK CALLBACK', url, type);
            n.close();
            if(type=='stream' && (isValidPath(url) || isMagnet(url))){
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

function registerSource(url, name, silent){
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
    Config.set(key, sources);
    if(!silent){
        notify(Lang.LIST_ADDED, 'fa-star', 'normal');
    }
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
            Config.set('sources', sources);
            if(key == 'length' && url == getActiveSource()){
                var locale = getLocale(false, true);
                updateRootEntry(Lang.IPTV_LISTS, {label: Number(val).toLocaleString(locale)+' '+Lang.STREAMS.toLowerCase()});
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
    markActiveSource();
    readSourcesToIndex()
}

var autoCleanEntriesQueue = [];

function autoCleanEntries(){
    var entries = jQuery('a.entry-stream').map((i, o) => {
        return jQuery(o).data('entry-data')
    });
    if(!entries.length){
        return;
    }
    var sn = notify(Lang.CAN_BE_SLOW, 'fa-coffee', 'forever');
    var n = notify(Lang.AUTOCLEAN+' 0%', 'fa-spin fa-circle-o-notch', 'forever');
    jQuery('a.entry-autoclean .entry-name').html(Lang.AUTOCLEAN+' 0%');
    var iterator = 0, cancel = false, readyIterator = 0, testers = [], tasks = Array(entries.length).fill((callback) => {
        if(cancel) return;
        var entry = entries[iterator];
        iterator++;
        console.log('ACAC', entry, entries);
        try{
            testers = testers.concat(
            testEntry(entry, () => {
                readyIterator++;
                n.update(Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'%', 'fa-spin fa-circle-o-notch');
                jQuery('a.entry-autoclean .entry-name').html(Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'%');
                unregisterOfflineStream(entry);
                callback(null, true);
                top.sendStats('alive', sendStatsPrepareEntry(entry))
            }, () => {
                readyIterator++;
                n.update(Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'%', 'fa-spin fa-circle-o-notch');
                jQuery('a.entry-autoclean .entry-name').html(Lang.AUTOCLEAN+' '+parseInt(readyIterator / (entries.length / 100))+'%');
                registerOfflineStream(entry);
                callback(null, false);
                refreshListing();
                top.sendStats('error', sendStatsPrepareEntry(entry))
            })
        )
    }catch(e){console.error(e)}
        console.log('ACAC2', testers);
    });
    if(typeof(async) == 'undefined'){
        async = require('async')
    }
    async.parallelLimit(tasks, 4, (err, results) => {
        sn.close();
        if(!cancel){
            jQuery('a.entry-autoclean .entry-name').html(Lang.AUTOCLEAN+' 100%');
            n.update(Lang.AUTOCLEAN+' 100%', 'fa-check', 'normal')
        }
    });
    var controller = {
        cancel: () => {
            console.log('cancelling');
            cancel = true;
            console.log(testers);
            testers.forEach((intent, i) => {
                intent.off();
                intent.destroy()
            });
            sn.close();
            jQuery('a.entry-autoclean .entry-name').html(Lang.TEST_THEM_ALL+' (F5)');
            n.update(Lang.AUTOCLEAN, 'fa-times-circle', 'short')
        }
    }
    autoCleanEntriesQueue.push(controller);
    return controller;
}

function autoCleanEntriesCancel(){
    console.log(autoCleanEntriesQueue);
    for(var i=0; i<autoCleanEntriesQueue.length; i++){
        console.log(autoCleanEntriesQueue[i]);
        if(autoCleanEntriesQueue[i]){
            console.log(autoCleanEntriesQueue[i]);
            autoCleanEntriesQueue[i].cancel();
            delete autoCleanEntriesQueue[i]
        }
    }
    autoCleanEntriesQueue = autoCleanEntriesQueue.filter(function (item) {
        return item !== undefined;
    });
}

function areControlsIdle(){
    return jQuery('body').hasClass('idle')
}

function defaultParentalControlTerms(){
    var terms = Config.get('default-parental-control-terms');
    if(typeof(terms)!='string'){
        terms = 'adult,erotic,erótic,sex,porn';
    }
    return terms.toLowerCase().split(',').filter((term) => {
        return term.length >= 2;
    })
}

function userParentalControlTerms(){
    var sepAliases = ['|', ' '];
    var terms = Config.get('parental-control-terms');
    if(typeof(terms)!='string'){
        terms = '';
    }
    sepAliases.forEach((sep) => {
        terms = terms.replaceAll(sep, ',')
    });
    return terms.toLowerCase().split(',').filter((term) => {
        return term.length >= 2;
    })
}

function parentalControlTerms(){
    return userParentalControlTerms().concat(defaultParentalControlTerms())
}

var showAdultContent = Config.get('show-adult-content');
function parentalControlAllow(entry){
    if(showAdultContent){
        return true;
    }
    if(entry && typeof(entry.type)=='string' && ['group', 'stream'].indexOf(entry.type)==-1){
        return true;
    }
    var terms = parentalControlTerms();
    if(terms.length){
        if(typeof(entry.name)=='string' && hasTerms(entry.name, terms)){
            return false;
        }
        if(typeof(entry.url)=='string' && hasTerms(entry.url, terms)){
            return false;
        }
        if(typeof(entry.label)=='string' && hasTerms(entry.label, terms)){
            return false;
        }
        if(typeof(entry.group)=='string' && hasTerms(entry.group, terms)){
            return false;
        }
    }
    return true;
}

function parentalControlMatchPalette(colors){
    // 78 13 0
    // 232 214 212
    // dentro dessa range com oscilação máxima entre o RGB de 78 pontos e com o vermelho sempre maior e o azul menor
    var r, g, b, skinHits = 0;
    for(var i=0; i<colors.length; i++){
        r = colors[i][0];
        g = colors[i][1];
        b = colors[i][2];
        if(r > 75 && r > g && g > b){
            if(Math.abs(r - b) < 100 && Math.abs(r - g) > 12){
                skinHits++;
            }
        }
    }
    // console.log('SKINHITS', skinHits, colors.length, Math.ceil(colors.length / 3));
    return skinHits >= 3;
}

/*
var colorThief = false;
function parentalControlAllowImage(image){ // fa-ban
    if(!colorThief){
        var o = getFrame('overlay');
        if(!o) return true;
        colorThief = new (o.ColorThief)();
    }
    var colors = colorThief.getPalette(image, 16);
    if(!jQuery.isArray(colors) || colors.length < 10){
        return false;
    }
    return !parentalControlMatchPalette(colors)
}

function parentalControlAllowImageURL(url, callback){ // fa-ban
    var m = new Image();
    m.onload = () => {
        callback(parentalControlAllowImage(m), url)
    }
    m.onerror = () => {
        callback(true, url)
    }
    m.src = url;
}
*/

function hasTerms(stack, needles){
    if(stack.length > 2){
        stack = stack.toLowerCase();
        for(var i=0; i<needles.length; i++){
            if(needles[i].length && stack.indexOf(needles[i])!=-1){
                return true;
            }
        }
    }
    return false;
}

var tb = jQuery(top.document).find('body'), c = tb.find('iframe#controls'), d = jQuery('div#controls');
var lastTabIndex = 1, controlsTriggerTimer = 0;

jQuery(function (){
    var t = 0, x, b = jQuery(top.document).find('body'), onfocusout = () => {
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
                        b.addClass('isovercontrols') // istyping 
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
    });
    var w = jQuery(window).width();  
    jQuery(window).on('resize', () => {
        w = jQuery(window).width()
    }).on('mousemove', (e) => {
        if(t){
            console.log('HIDECANCEL', x, t);
            clearTimeout(t);
            t = 0;
        }
        x = e.pageX;
        if(top.showHideDelay){
            clearTimeout(top.showHideDelay);
            top.showHideDelay = 0;
        }
        if(top.automaticallyPaused && x >= (w - 6)){
            if(top.showHideDelay){
                clearTimeout(top.showHideDelay);
                top.showHideDelay = 0;
            }
            console.log('MOUSEOUTHIDE', x, w);
            t = setTimeout(() => {
                if(top.showHideDelay){
                    clearTimeout(top.showHideDelay);
                    top.showHideDelay = 0;
                }
                console.log('HIDENOW', x, w);
                top.PlaybackManager.play();
                hideControls()
            }, 600)
        }
    })
})

jQuery(window).one('unload', function (){
    top.sendStats('die')
})

jQuery(document).one('show', () => {
    jQuery.getJSON('http://app.megacubo.net/configure.json?'+time(), function (data){
        if(!data || !data.version) return;
        var currentVersion = data.version;
        if(typeof(data.adultTerms)!='undefined'){
            Config.set('default-parental-control-terms', String(data.adultTerms), 30 * (24 * 3600))
        }
        getManifest(function (data){
            console.log('VERSION', data.version, currentVersion);
            top.currentVersion = data.version;
            jQuery('#help').attr('title', 'Megacubo v'+top.currentVersion);
            if(data.version < currentVersion){
                jQuery('#help').html('<i class="fa fa-bell" aria-hidden="true"></i>').css('color', '#ff6c00');
                if(confirm(Lang.NEW_VERSION_AVAILABLE)){
                    gui.Shell.openExternal('https://megacubo.tv/online/?version='+data.version);
                }
            }
        })
    })
})

/*
var Worker = require("tiny-worker");

function bgParseList(url, callback, timeout, skipFilters){
    if(!timeout){
        timeout = 30;
    }
    var bgParseWorker = new Worker("./assets/js/bg-parse.js");
    bgParseWorker.onmessage = function(e) {
        if(typeof(e.data)=='object' && typeof(e.data.entries)=='object'){
            callback(e.data.entries, e.data.url);
            bgParseWorker.terminate()
        } else {
            console.log('WRKMSG', e.data)
        }
    }
    ListMan.read(url, (content) => { // fetch (fetchTimeout) wont work in a Worker
        bgParseWorker.postMessage({content: content, url: url, Lang: Lang, skipFilters: skipFilters})
    }, timeout)
}
*/

var listingPath = ltrimPathBar(Store.get('listingPath')) || '', autoCleanHintShown = false, pos = listingPath.indexOf(Lang.MY_LISTS);
if(pos == -1 || pos > 3){
    listingPath = '';
}
jQuery(window).on('unload', function (){
    Store.set('listingPath', listingPath)
})

jQuery(document).one('lngload', function (){
    window.index = [
        {name: Lang.WHAT_TO_WATCH, label: Lang.SEARCH, logo:'assets/icons/white/tv.png', type: 'group', entries: [
            {name: Lang.FIND_CHANNELS + ' (F3)', label: Lang.ALL_LISTS, logo:'fa-search fa-shake', url:'javascript:;', type: 'option', callback: function (){setupSearch(false, 'complete', Lang.FIND_CHANNELS + ' (F3)')}},
            {name: Lang.FIND_VIDEOS, label: Lang.FIND_VIDEOS, logo:'fa-film', url:'javascript:;', type: 'option', callback: function (){setupSearch(false, 'video', Lang.FIND_VIDEOS)}},
            {name: Lang.MAGNET_SEARCH, label: Lang.MAGNET_SEARCH, logo:'fa-magnet', url:'javascript:;', type: 'option', callback: function (){setupSearch(false, 'magnet', Lang.MAGNET_SEARCH)}},
        ]},
        {name: Lang.IPTV_LISTS, label: Lang.PROCESSING, logo:'fa-list', url:'javascript:;', type: 'group', entries: [getLoadingEntry()]},
        {name: Lang.OPTIONS, logo:'assets/icons/white/settings.png', url:'javascript:;', type: 'group', entries: [
            {name: Lang.OPEN_URL+' (Ctrl+U)', logo:'fa-link', type: 'option', callback: () => {playCustomURL()}},
            {name: Lang.WINDOW, logo:'fa-window-maximize', type: 'group', renderer: getWindowModeEntries, entries: []},
            {name: Lang.LANGUAGE, logo:'fa-globe', type: 'group', renderer: getLanguageEntries, callback: markActiveLocale, entries: []},
            {name: Lang.PARENTAL_CONTROL, logo: 'assets/icons/white/parental-control.png', type: 'group', renderer: getParentalControlEntries, entries: []},
            {name: Lang.SEARCH_RANGE, logo: 'fa-search', type: 'group', renderer: getSearchRangeEntries, entries: [], callback: () => {
                var entries = jQuery('a.entry-option'), range = Config.get('search-range') || 18;
                entries.each((i) => {
                    var el = entries.eq(i);
                    if(el.data('entry-data').value == range){
                        setEntryFlag(el, 'fa-check-circle')
                    }
                })
            }},
            {name: Lang.RESUME_PLAYBACK, type: 'check', check: (checked) => {Config.set('resume',checked)}, checked: () => {return Config.get('resume')}},
            /*
            {name: Lang.FORCE_FFMPEG, type: 'check', check: (checked) => {Config.set('force-transcode',checked)}, checked: () => {return Config.get('force-transcode')}},
            */
            {name: Lang.HIDE_BUTTON_OPT.format(Lang.BACK, 'Backspace'), type: 'check', check: (checked) => {Config.set('hide-back-button',checked)}, checked: () => {return Config.get('hide-back-button')}},
            {name: Lang.RESET_DATA, logo:'fa-trash', type: 'option', renderer: top.resetData, entries: []},
        ]}
    ];
    
    console.log(getSources());
    if(!getSources().length){
        registerSource(communityList(), Lang.COMMUNITY_LIST, true);
    }

    readSourcesToIndex();
    setTimeout(() => {
        if(!top.PlaybackManager.intents.length){
            playResume()
        }
    }, 1000)
    
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
        jQuery(document).trigger('show');
        if(top){
            top.restoreInitialSize();
            top.jQuery(top.document).trigger('show');
            if(top.splash){
                // top.splash.hide();
                top.splash.close()
            };
        }
    }, 2000)
})

