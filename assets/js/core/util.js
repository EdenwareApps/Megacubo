//import { clearTimeout } from 'timers';

var requestJar = request.jar(), Lang = {};
var customMediaTypes = [], customMediaEntries = [];
var installedVersion = 0, availableVersion = 0, sharedLists = [], sharedListsSearchWordsIndex = {}, sharedListsSearchWordsIndexStrict = {}, sharedListsGroups = false;

request = request.defaults({
    jar: requestJar,
    headers: {'User-Agent': navigator.userAgent} // without user-agent some hosts return 403
})

function extractInt(s, sep, def){
    let ss = s.split(sep || ' ').filter((n) => {
        return typeof(n) == 'number' ? true : n.match(new RegExp('^[0-9]+$'))
    })
    return ss.length ? parseInt(ss[0]) : def || 0
}

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

function defaultParentalControlTerms(){
    var terms = Config.get('default-parental-control-terms');
    if(typeof(terms)!='string'){
        terms = 'adult,erotic,erótic,sex,porn';
    }
    return fixUTF8(terms).toLowerCase().split(',').filter((term) => {
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

var adultContentPolicy = Config.get('adult-content-policy');
function parentalControlAllow(entry, ignoreSetting){
    var terms = parentalControlTerms()
    if(Buffer.isBuffer(entry)){
        entry = String(entry)
    }
    if(typeof(entry) == 'string'){
        entry = {
            parentalControlSafe: !hasTerms(entry, terms),
            name: entry
        }
    }
    if(typeof(entry.type) == 'undefined'){
        entry.type = 'stream'
    }
    if(['group', 'stream'].indexOf(entry.type) == -1){
        return true; // not applicable, return immediately
    }
    if(typeof(entry.parentalControlSafe) == 'undefined'){
        entry.parentalControlSafe = true;
        if(terms.length){
            if(typeof(entry.name)=='string' && hasTerms(entry.name, terms)){
                entry.parentalControlSafe = false;
            }
            //if(typeof(entry.url)=='string' && hasTerms(entry.url, terms)){
            //    entry.parentalControlSafe = false;
            //}
            if(typeof(entry.label)=='string' && hasTerms(entry.label, terms)){
                entry.parentalControlSafe = false;
            }
            if(typeof(entry.group)=='string' && hasTerms(entry.group, terms)){
                entry.parentalControlSafe = false;
            }
        }
    }
    if(ignoreSetting){
        return entry.parentalControlSafe;
    }
    switch(adultContentPolicy){
        case 'allow':
            return true; // allow any
            break;
        case 'block':
            return entry.parentalControlSafe; // block adult
            break;
    }
    return true; // allow as error fallback
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
    var country = Countries.select(locale, 'country_'+locale.substr(0, 2)+',country_iso', 'locale', true); //getLocale();
    var q = "iptv list m3u8 {0} {1}".format(country, (new Date()).getFullYear());
    return q;
}

function getIPTVListSearchURL(){
    var q = getIPTVListSearchTerm();
    q = q.replaceAll(" ", "+");
    return "https://www.google.com/search?safe=off&tbs=qdr:m&q="+q+"&oq="+q;
}

function updateOnlineUsersCount(){
    var callback = (n) => {
        onlineUsersCount['total'] = n;
        if(!Menu.path){
            Menu.refresh()
        }
    }
    jQuery.getJSON('http://app.megacubo.net/stats/data/usersonline.json', (response) => {
        if(!isNaN(parseInt(response))){
            GStore.set('usersonline', response);
            callback(response)
        }
    })
    var n = GStore.get('usersonline')
    if(n){
        callback(n)
    }
}

var mediaTypeStreamsCountTemplate = {
    'live': 0,
    'video': 0,
    'radio': 0
}

var onlineUsersCount = Object.assign({}, mediaTypeStreamsCountTemplate), mediaTypeStreamsCount = Object.assign({}, mediaTypeStreamsCountTemplate);

function updateMediaTypeStreamsCount(entries, wasEmpty){
    if(wasEmpty){
        mediaTypeStreamsCount = Object.assign({}, mediaTypeStreamsCountTemplate);
    }
    entries.forEach((entry) => {
        if(typeof(mediaTypeStreamsCount[entry.mediaType])=='undefined'){
            mediaTypeStreamsCount[entry.mediaType] = 0;
        }
        mediaTypeStreamsCount[entry.mediaType]++;
    })
}

addAction('addEntriesToSearchIndex', updateMediaTypeStreamsCount);

function addEntriesToSearchIndex(_entries, listURL){
    var b, bs, s = [], ss = [], sep = ' _|_ ';
    var entries = _entries.filter((entry) => {
        return entry && !isMegaURL(entry.url);
    })
    for(var i=0; i<entries.length; i++){
        b = bs = entries[i].name;
        if(typeof(entries[i].group) != 'undefined' && entries[i].group != 'undefined'){
            b += ' ' + entries[i].group
        }
        if(b == bs){
            bs = b = prepareSearchTerms(b)
        } else {
            b = prepareSearchTerms(b), bs = prepareSearchTerms(bs)
        }
        if(typeof(entries[i].mediaType) == 'undefined' || entries[i].mediaType == -1){
            entries[i].mediaType = getStreamBasicType(entries[i])
        }
        entries[i].source = entries[i].source || listURL;
        b.forEach((t) => {
            if(t.length > 1){
                if(typeof(sharedListsSearchWordsIndex[t])=='undefined'){
                    sharedListsSearchWordsIndex[t] = {entries: []}
                }
                sharedListsSearchWordsIndex[t].entries.push(entries[i])
            }
        })
        bs.forEach((t) => {
            if(t.length > 1){
                if(typeof(sharedListsSearchWordsIndexStrict[t])=='undefined'){
                    sharedListsSearchWordsIndexStrict[t] = {entries: []}
                }
                sharedListsSearchWordsIndexStrict[t].entries.push(entries[i])
            }
        })
    }
    doAction('addEntriesToSearchIndex', entries)
}

function getStreamBasicType(entry){
    if(entry.mediaType && entry.mediaType != -1){
        return entry.mediaType;
    }
    var b = entry.name;
    if(entry.group){
        b += ' '+entry.group;
    }
    
    var ret = false;
    Object.values(customMediaTypes).forEach((atts) => {
        if(atts.check && atts.check(entry.url, entry)){
            ret = atts.type;
        }
    });
    if(ret) return ret;

    if(isRadio(b)){
        return 'radio';
    } else if(entry.url && ((isHTML5Video(entry.url) && !isTS(entry.url)) || isYT(entry.url))) {
        return 'video';
    } else if(entry.url && (isLive(entry.url) ||isMegaURL(entry.url) || entry.url.match(new RegExp('(live|m3u|rtmp)', 'i')))) {
        return 'live';
    } else if(entry.url && entry.url.match(new RegExp('(video)', 'i'))) {
        return 'video';
    }
    // console.warn('UNSURE', entry.name, entry.url);
    return 'live';
}

function prepareSearchTerms(txt){
    var blacklist = ['tv'];
    return txt.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(' ').filter((kw) => {
        return kw.length >= 2 && blacklist.indexOf(kw) == -1;
    })
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

$win.on('load', () => {
    var width;
    var body = document.body || document.querySelector('body');
  
    var container = document.createElement('span');
    container.innerHTML = Array(100).join('wi');
    container.style.cssText = [
      'position:absolute',
      'width:auto',
      'font-size:128px',
      'left:-99999px'
    ].join(' !important;');
  
    var getWidth = function (fontFamily) {
      container.style.fontFamily = fontFamily;
  
      body.appendChild(container);
      width = container.clientWidth;
      body.removeChild(container);
  
      return width;
    };
  
    // Pre compute the widths of monospace, serif & sans-serif
    // to improve performance.
    var monoWidth  = getWidth('monospace');
    var serifWidth = getWidth('serif');
    var sansWidth  = getWidth('sans-serif');
  
    window.isFontAvailable = function (font) {
      return monoWidth !== getWidth(font + ',monospace') ||
        sansWidth !== getWidth(font + ',sans-serif') ||
        serifWidth !== getWidth(font + ',serif');
    };
});

function getFontList(){
    return [
        '-apple-system',
        'Arial',
        'BlinkMacSystemFont', 
        'Calibri',
        'Cantarell', 
        'Century Gothic',
        'Comic Sans',
        'Consolas',
        'Courier',
        'Dejavu Sans',
        'Dejavu Serif',
        'Georgia',
        'Gill Sans',
        'Helvetica',
        'Helvetica Neue', 
        'Impact',
        'Lucida Sans',
        'Myriad Pro',
        'Open Sans',
        'Oxygen-Sans', 
        'Palatino',
        'Roboto',
        'Segoe UI', 
        'sans-serif',
        'Tahoma',
        'Times New Roman',
        'Trebuchet',
        'Ubuntu', 
        'Verdana',
        'Zapfino'
    ].filter(isFontAvailable)
}

function isNumeric(chr){
    return !!String(chr).match(new RegExp('^[0-9]+$'))
}

function isXtraChar(chr){
    return (' @').indexOf(String(chr)) != -1;
}

function isLetter(chr){
    return String(chr).toLowerCase() != String(chr).toUpperCase()
}

function isNumberOrLetter(chr){
    return isNumeric(chr) || isXtraChar(chr) || isLetter(chr)
}

function playPrevious(){ // PCH
    var c = Playback.active ? Playback.active.entry : (Playback.lastActiveIntent ? Playback.lastActiveIntent.entry : false)
    History.get().some((entry) => {
        if(!isLocal(entry.url)) { 
            if(!c || (entry.url != c.url && (!c.originalUrl || !entry.originalUrl || entry.originalUrl != c.originalUrl))){
                playEntry(entry)
                return true;
            }
        }
    })
}

function playResume(){
    History.get().some((entry) => {
        if(!Playback.active && !Playback.lastActiveIntent && !Playback.intents.length){
            playEntry(entry)
            return true;
        }
    })
}

var streamStateCache = GStore.get('stream_state_caches') || {}, streamStateCacheTTL = (7 * (24 * 3600));

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
    if(entry.originalUrl && !isMegaURL(entry.originalUrl)){
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
    GStore.set('stream_state_caches', streamStateCache)
}

addAction('appUnload', saveStreamStateCache);

function playEntry(oentry){    
    console.warn('prePlayEntryAllow')
    if(navigator.onLine){
        var entry = Object.assign({}, oentry)
        entry.transcode = null;
        entry.prepend = '';
        entry.allowWebPages = true;
        if(Playback.play(entry)){
            collectListQueue(entry)
            updateStreamEntriesFlags()
        }
    } else {
        console.error('prePlayEntryAllow DENY', 'No internet connection.')
    }
}

function allowAutoClean(curPath, entries){
    // should append autoclean in this path?
    if(!curPath){
        return false;
    }
    var offerAutoClean = false, autoCleanAllowPaths = [Lang.LIVE, Lang.VIDEOS, Lang.MY_LISTS, Lang.SEARCH], ignorePaths = [Lang.BEEN_WATCHED, Lang.HISTORY, Lang.RECORDINGS, Lang.BOOKMARKS, 'Youtube'];
    if(jQuery.isArray(entries)){
        entries.some((entry) => {
            var type = getStreamBasicType(entry);
            if(type){
                if(['live', 'video', 'radio'].indexOf(type) != -1){
                    offerAutoClean = true;
                } else if(typeof(customMediaTypes[type]) != 'undefined' && customMediaTypes[type]['testable']) {
                    offerAutoClean = true;
                }
            }   
            return offerAutoClean; 
        })
    } else {  // no entries, check for path so
        autoCleanAllowPaths.forEach((path) => {
            if(curPath.length && curPath.indexOf(path) != -1){
                offerAutoClean = true;
            }
        })
    }
    if(offerAutoClean){
        ignorePaths.every((path) => {
            if(curPath.indexOf(path) != -1){
                offerAutoClean = false;
            }
            return offerAutoClean;
        })
    }
    return offerAutoClean;
}

function updateStreamEntriesFlags(){

    if(typeof(Menu) == 'undefined'){
        return;
    }

    // offline streams
    var activeurls = [];
    if(stream = currentStream()){
        activeurls.push(stream.url);
        if(stream.originalUrl){
            activeurls.push(stream.originalUrl)
        }
    }

    // pending entries
    var loadingurls = Playback.isLoading(true);
    if(typeof(isPending)=='string'){
        loadingurls.push(isPending)
    }
    console.log(loadingurls, isPending);

    var doSort = allowAutoClean(Menu.path);

    var fas = jQuery('.entry-stream'), autoCleaning = jQuery('.entry-autoclean').filter((i, e) => { 
        return e.innerHTML.indexOf('% ') != -1; 
    }).length, firstStreamOffset = false;
    fas.each((i, element) => {
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
            setEntryFlag(element, 'fa-play-circle')
        } else if(loadingurls.indexOf(element.href)!=-1){
            setEntryFlag(element, 'fa-circle-notch pulse-spin')
        } else {
            setEntryFlag(element, '')
        }
    })
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
        name = Lang.UNTITLED;
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
    if(hasCustomMediaType(url) || isVideo(url) || isTS(url)){
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

function binSerialize(buf, cb){
    require('zlib').deflate(JSON.stringify(buf), {level: 1}, (err, buf) => {
        if(err){
            cb(err)
        } else {
            cb(null, buf)
        }
    })
}

function binUnserialize(buf, cb){
    require('zlib').inflate(Buffer.from(buf), (err, buf) => {
        if(err){
            cb(err)
        } else {
            if(typeof(buf.toString) == 'function'){
                buf = buf.toString()
            }
            cb(null, JSON.parse(buf))
        }
    })
}
    
function askForSource(question, callback, onclose){
    if(typeof(onclose) != 'function'){
        onclose = jQuery.noop
    }
    if(isMiniPlayerActive()){
        leaveMiniPlayer()
    }
    var defaultValue = Store.get('last-ask-for-source-value');
    var cb = clipboard.get('text'), go = () => {
        // parse lines for names and urls and use registerSource(url, name) for each
        var v = modalPromptVal()
        if(v){
            if(v.substr(0, 2)=='//'){
                v = 'http:'+v;
            }
            Store.set('last-ask-for-source-value', v)
        }
        if(callback(v)){
            modalClose()
        }
    }
    if(cb.match(new RegExp('^(//|https?://)'))){
        defaultValue = cb;
    }
    var options = [
        ['<i class="fas fa-folder-open" aria-hidden="true"></i> '+Lang.OPEN_FILE, () => {
            openFileDialog((file) => {
                modalPromptInput().val(file)
                go()
            })
        }],
        ['<i class="fas fa-check-circle" aria-hidden="true"></i> OK', go]
    ];
    modalPrompt(question, options, Lang.PASTE_URL_HINT, defaultValue, true, onclose)
}
        
function playCustomURL(placeholder, direct){
    var url;
    if(placeholder && direct){
        url = placeholder;
    } else {
        if(!placeholder){
            placeholder = Store.get('lastCustomPlayURL')
        }
        return askForSource(Lang.PASTE_URL_HINT, (val) => {
            playCustomURL(val, true);
            return true;
        })            
    }
    if(url){
        if(url.substr(0, 2)=='//'){
            url = 'http:'+url;
        }
        Store.set('lastCustomPlayURL', url);
        var name = false;
        if(isValidPath(url)){
            name = 'Megacubo '+url.split('/')[2];
        }
        if(name){
            console.log('lastCustomPlayURL', url, name);
            Store.set('lastCustomPlayURL', url);
            var logo = '', c = (top || parent);                
            if(c){
                logo = c.defaultIcons['stream'];
            }
            top.createPlayIntent({url: url, allowWebPages: true, name: name, logo: logo}, {manual: true})
        }
    }
}

function playCustomFile(file){
    Store.set('lastCustomPlayFile', file);
    top.createPlayIntent({url: file, name: basename(file, true)}, {manual: true})
}

function addNewSource(cb, label, listsOnly){
    if(!label){
        label = Lang.PASTE_URL_HINT
    }
    if(typeof(cb) != 'function'){
        cb = jQuery.noop
    }
    askForSource(label, (val) => {
        var url = val;
        console.log('CHECK', url);
        var n = notify(Lang.PROCESSING, 'fa-spin fa-circle-notch', 'wait');
        checkStreamType(url, (url, type) => {
            console.log('CHECK CALLBACK', url, type);
            n.close();
            if(type == 'stream' && (isValidPath(url) || hasCustomMediaType(url))){
                if(!listsOnly){
                    playCustomURL(url, true)
                }
                cb(null, 'stream')
            } else if(type=='list'){
                registerSource(url)
                cb(null, 'list')
            } else {
                notify(Lang.INVALID_URL_MSG, 'fa-exclamation-circle faclr-red', 'normal')
                cb(Lang.INVALID_URL_MSG, '')
            }
        })
        return true
    }, () => {
        cb('Prompt closed', '')
    })
}

function untar(file, dest, cb, validator){
    require('tar').extract({
        gzip: true,
        file: file,
        cwd: dest
    }).then((e) => {
        if(typeof(validator) == 'function' && validator()){
            cb(e)
        } else if(process.platform == 'linux') {
            var log = '', child = require('child_process').spawn('tar', ['xzf', file, '-C', dest], {detached: true})
            child.stdout.on('data', function (data) {
                log += data;
            })
            child.stderr.on('data', function (data) {
                log += data;
            })
            child.on('close', function (code) {
                cb(log, code)
            })
        } else {
            cb(e)
        }
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
        name = getNameFromSourceURL(url)
    }
    name = basename(name)
    sources.push([name, url]);
    Config.set(key, sources);
    if(!silent){
        notify(Lang.LIST_ADDED, 'fa-star en', 'normal');
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
    var n = Number.MAX_SAFE_INTEGER, nl = String(n).length, score = String(n - (entry.score || 0));
    if(score.length - nl){
        score = "0".repeat(score.length - nl) + score;
    }
    return '2-'+
        ((state === true) ? 0 : (state === false ? 2 : 1)) + '-' + 
        (inHistory ? 0 : (inWatching ? 1: 2)) + '-' + 
        score + '-' + 
        ((isLive(entry.url)||isRemoteTS(entry.url)) ? 0 : (isVideo(entry.url)?2:1)) + '-' + 
        (entry.name || '').toLowerCase();
}

function sortEntriesByState(entries){
    var historyData = History.get(), watchingData = getWatchingData()
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
    } else if(jQuery.isArray(entries)) {
        if(entries.sortByProp){
            for(var i=0; i<entries.length; i++){
                if(entries[i]){
                    entries[i].sortkey = sortEntriesStateKey(entries[i], historyData, watchingData)
                }
            }
            return entries.sortByProp('sortkey')
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

function isListSharingActive(){
    var srs = Config.get('search-range-size');
    if(!srs && !getSources().length){
        srs = Config.defaults['search-range-size'];
        Config.set('search-range-size', srs)
    }
    return !!srs;
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

function fetchEntries(url, callback, update){
    console.log('FETCH', url, traceback());
    var key = 'remote-entries-'+url, fbkey = key + '-fb', doFetch = false, data = GStore.get(key);
    if(!jQuery.isArray(data) || update){
        doFetch = true;
        data = GStore.get(fbkey); // fallback
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
                GStore.set(key, ndata, 60);
                GStore.set(fbkey, ndata, 30 * (24 * 3600)); // fallback
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
    var v = Playback.getVideo()
    if(appShown && (!v || v.paused)){
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
