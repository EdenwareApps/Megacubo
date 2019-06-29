//import { clearTimeout } from 'timers';

var Lang = {}, os = require('os')
var customMediaTypes = [], customMediaEntries = []
var installedVersion = 0, availableVersion = 0, sharedLists = [], sharedListsGroups = false

const sharedDefaultSearchRangeSize = 36

var md5 = function (string) {
    function RotateLeft(lValue, iShiftBits) {
            return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits));
    } 
    function AddUnsigned(lX,lY) {
            var lX4,lY4,lX8,lY8,lResult;
            lX8 = (lX & 0x80000000);
            lY8 = (lY & 0x80000000);
            lX4 = (lX & 0x40000000);
            lY4 = (lY & 0x40000000);
            lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
            if (lX4 & lY4) {
                    return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
            }
            if (lX4 | lY4) {
                    if (lResult & 0x40000000) {
                            return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                    } else {
                            return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                    }
            } else {
                    return (lResult ^ lX8 ^ lY8);
            }
    } 
    function F(x,y,z) { return (x & y) | ((~x) & z); }
    function G(x,y,z) { return (x & z) | (y & (~z)); }
    function H(x,y,z) { return (x ^ y ^ z); }
    function I(x,y,z) { return (y ^ (x | (~z))); } 
    function FF(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
    }
    function GG(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
    }
    function HH(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
    }
    function II(a,b,c,d,x,s,ac) {
            a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
            return AddUnsigned(RotateLeft(a, s), b);
    }
    function ConvertToWordArray(string) {
            var lWordCount;
            var lMessageLength = string.length;
            var lNumberOfWords_temp1=lMessageLength + 8;
            var lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64;
            var lNumberOfWords = (lNumberOfWords_temp2+1)*16;
            var lWordArray=Array(lNumberOfWords-1);
            var lBytePosition = 0;
            var lByteCount = 0;
            while ( lByteCount < lMessageLength ) {
                    lWordCount = (lByteCount-(lByteCount % 4))/4;
                    lBytePosition = (lByteCount % 4)*8;
                    lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount)<<lBytePosition));
                    lByteCount++;
            }
            lWordCount = (lByteCount-(lByteCount % 4))/4;
            lBytePosition = (lByteCount % 4)*8;
            lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80<<lBytePosition);
            lWordArray[lNumberOfWords-2] = lMessageLength<<3;
            lWordArray[lNumberOfWords-1] = lMessageLength>>>29;
            return lWordArray;
    }
    function WordToHex(lValue) {
            var WordToHexValue="",WordToHexValue_temp="",lByte,lCount;
            for (lCount = 0;lCount<=3;lCount++) {
                    lByte = (lValue>>>(lCount*8)) & 255;
                    WordToHexValue_temp = "0" + lByte.toString(16);
                    WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
            }
            return WordToHexValue;
    }
    function Utf8Encode(string) {
            string = string.replace(/\r\n/g,"\n");
            var utftext = "";
 
            for (var n = 0; n < string.length; n++) {
 
                    var c = string.charCodeAt(n);
 
                    if (c < 128) {
                            utftext += String.fromCharCode(c);
                    }
                    else if((c > 127) && (c < 2048)) {
                            utftext += String.fromCharCode((c >> 6) | 192);
                            utftext += String.fromCharCode((c & 63) | 128);
                    }
                    else {
                            utftext += String.fromCharCode((c >> 12) | 224);
                            utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                            utftext += String.fromCharCode((c & 63) | 128);
                    }
 
            }
 
            return utftext;
    }
    var x=Array();
    var k,AA,BB,CC,DD,a,b,c,d;
    var S11=7, S12=12, S13=17, S14=22;
    var S21=5, S22=9 , S23=14, S24=20;
    var S31=4, S32=11, S33=16, S34=23;
    var S41=6, S42=10, S43=15, S44=21; 
    string = Utf8Encode(string); 
    x = ConvertToWordArray(string); 
    a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476; 
    for (k=0;k<x.length;k+=16) {
            AA=a; BB=b; CC=c; DD=d;
            a=FF(a,b,c,d,x[k+0], S11,0xD76AA478);
            d=FF(d,a,b,c,x[k+1], S12,0xE8C7B756);
            c=FF(c,d,a,b,x[k+2], S13,0x242070DB);
            b=FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
            a=FF(a,b,c,d,x[k+4], S11,0xF57C0FAF);
            d=FF(d,a,b,c,x[k+5], S12,0x4787C62A);
            c=FF(c,d,a,b,x[k+6], S13,0xA8304613);
            b=FF(b,c,d,a,x[k+7], S14,0xFD469501);
            a=FF(a,b,c,d,x[k+8], S11,0x698098D8);
            d=FF(d,a,b,c,x[k+9], S12,0x8B44F7AF);
            c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);
            b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
            a=FF(a,b,c,d,x[k+12],S11,0x6B901122);
            d=FF(d,a,b,c,x[k+13],S12,0xFD987193);
            c=FF(c,d,a,b,x[k+14],S13,0xA679438E);
            b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
            a=GG(a,b,c,d,x[k+1], S21,0xF61E2562);
            d=GG(d,a,b,c,x[k+6], S22,0xC040B340);
            c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);
            b=GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
            a=GG(a,b,c,d,x[k+5], S21,0xD62F105D);
            d=GG(d,a,b,c,x[k+10],S22,0x2441453);
            c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);
            b=GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
            a=GG(a,b,c,d,x[k+9], S21,0x21E1CDE6);
            d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);
            c=GG(c,d,a,b,x[k+3], S23,0xF4D50D87);
            b=GG(b,c,d,a,x[k+8], S24,0x455A14ED);
            a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);
            d=GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8);
            c=GG(c,d,a,b,x[k+7], S23,0x676F02D9);
            b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
            a=HH(a,b,c,d,x[k+5], S31,0xFFFA3942);
            d=HH(d,a,b,c,x[k+8], S32,0x8771F681);
            c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);
            b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
            a=HH(a,b,c,d,x[k+1], S31,0xA4BEEA44);
            d=HH(d,a,b,c,x[k+4], S32,0x4BDECFA9);
            c=HH(c,d,a,b,x[k+7], S33,0xF6BB4B60);
            b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
            a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);
            d=HH(d,a,b,c,x[k+0], S32,0xEAA127FA);
            c=HH(c,d,a,b,x[k+3], S33,0xD4EF3085);
            b=HH(b,c,d,a,x[k+6], S34,0x4881D05);
            a=HH(a,b,c,d,x[k+9], S31,0xD9D4D039);
            d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);
            c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);
            b=HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
            a=II(a,b,c,d,x[k+0], S41,0xF4292244);
            d=II(d,a,b,c,x[k+7], S42,0x432AFF97);
            c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);
            b=II(b,c,d,a,x[k+5], S44,0xFC93A039);
            a=II(a,b,c,d,x[k+12],S41,0x655B59C3);
            d=II(d,a,b,c,x[k+3], S42,0x8F0CCC92);
            c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);
            b=II(b,c,d,a,x[k+1], S44,0x85845DD1);
            a=II(a,b,c,d,x[k+8], S41,0x6FA87E4F);
            d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);
            c=II(c,d,a,b,x[k+6], S43,0xA3014314);
            b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
            a=II(a,b,c,d,x[k+4], S41,0xF7537E82);
            d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);
            c=II(c,d,a,b,x[k+2], S43,0x2AD7D2BB);
            b=II(b,c,d,a,x[k+9], S44,0xEB86D391);
            a=AddUnsigned(a,AA);
            b=AddUnsigned(b,BB);
            c=AddUnsigned(c,CC);
            d=AddUnsigned(d,DD);
            } 
        var temp = WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d); 
        return temp.toLowerCase();
}

function extractInt(s, sep, def){
    let ss = s.split(sep || ' ').filter((n) => {
        return typeof(n) == 'number' ? true : n.match(new RegExp('^[0-9]+$'))
    })
    return ss.length ? parseInt(ss[0]) : def || 0
}

function hasTerms(stack, needles){
    if(stack.length > 2){
        stack = stack.toLowerCase()
        for(var i=0; i<needles.length; i++){
            if(needles[i].length && stack.indexOf(needles[i])!=-1){
                return true
            }
        }
    }
    return false
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
            GStore.set('usersonline', response, true);
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
    'audio': 0
}

var onlineUsersCount = Object.assign({}, mediaTypeStreamsCountTemplate), mediaTypeStreamsCount = Object.assign({}, mediaTypeStreamsCountTemplate);

var msi
function getMediaType(entry){
    if(!msi){
        msi = new (require(path.resolve('modules/m3u-indexer/media-stream-info')))()
    }
    return msi.mediaType(entry)
}

function getEngine(entry){
    let ret = ''
    Playback.intentTypesPriorityOrder.some(type => {
        if(Playback.engines[type].supports(entry)){
            ret = type
            return true
        }
    })
    return ret
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
    var c = Playback.active ? Playback.active.entry : (Playback.lastActive ? Playback.lastActive.entry : false)
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
        if(!Playback.active && !Playback.lastActive && !Playback.intents.length){
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
    })
    if(commit){
        saveStreamStateCache()
    }
}

function saveStreamStateCache(){
    GStore.set('stream_state_caches', streamStateCache, true)
}

addAction('appUnload', saveStreamStateCache);

function playEntry(oentry, opts, types, tuning, cb){    
    console.warn('prePlayEntryAllow')
    console.warn('TSPOOLPLAY', oentry, types, traceback())
    Playback.cancelLoading()
    if(navigator.onLine){
        var atts = {
            ended: (intent) => {
                if(!intent.started){
                    if(typeof(cb) == 'function'){
                        cb('playEntry() ended', intent)
                    }
                }
            },
            error: (intent) => {
                if(!intent.started){
                    if(typeof(cb) == 'function'){
                        cb('playEntry() error', intent)
                    }
                }
            },
            start: (intent) => {
                if(typeof(cb) == 'function'){
                    cb(null, intent)
                }
            }
        }
        opts = Object.assign({
            tuning: (tuning ? [tuning.originalUrl, tuning.type] : false), 
            manual: true
        }, opts || {})
        var entry = Object.assign({allowWebPages: true}, oentry)        
        entry.prepend = ''
        enterPendingState((decodeURIComponent(entry.name) || entry.name), Lang.CONNECTING, entry.originalUrl || '')
        Playback.createIntent(entry, opts, null, (err, intents, statusCode) => {
            if(err){
                notifyPlaybackStartError(entry, statusCode || err)
            } else {
                updateStreamEntriesFlags()
            }
        })
    } else {
        console.error('prePlayEntryAllow DENY', 'No internet connection.')
        updateInternetState()
    }
}

function allowAutoClean(curPath, entries){
    // should append autoclean in this path?
    if(!curPath){
        return false
    }
    var offerAutoClean = false, autoCleanAllowPaths = [Lang.LIVE, Lang.VIDEOS, Lang.MY_LISTS, Lang.SEARCH], ignorePaths = [Lang.BEEN_WATCHED, Lang.HISTORY, Lang.RECORDINGS, Lang.BOOKMARKS, 'Youtube']
    if(Array.isArray(entries)){
        entries.some((entry) => {
            var type = getMediaType(entry)
            if(type){
                if(['live', 'video', 'audio'].indexOf(type) != -1){
                    offerAutoClean = true
                } else if(typeof(customMediaTypes[type]) != 'undefined' && customMediaTypes[type]['testable']) {
                    offerAutoClean = true
                }
            }   
            return offerAutoClean 
        })
    } else {  // no entries, check for path so
        autoCleanAllowPaths.forEach((path) => {
            if(curPath.length && curPath.indexOf(path) != -1){
                offerAutoClean = true
            }
        })
    }
    if(offerAutoClean){
        ignorePaths.every((path) => {
            if(basename(curPath) == path){
                offerAutoClean = false
            }
            return offerAutoClean
        })
    }
    return offerAutoClean
}

function updateStreamEntriesFlags(){
    if(typeof(Menu) == 'undefined'){
        return
    }
    // offline streams
    var activeurls = []
    if(stream = currentStream()){
        activeurls.push(stream.url)
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
        if(doSort && !isMegaURL(element.href)){
            let state = getStreamStateCache(element.href)
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
            setEntryFlag(element, 'fa-play')
        } else if(loadingurls.indexOf(element.href)!=-1){
            setEntryFlag(element, 'fa-mega spin-x-alt')
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
        if(!Array.isArray(sources[i])){
            delete sources[i];
            r = true;
        }
    }
    if(r){
        sources = sources.filter((item) => {
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
    if(content){
        var match = content.match(new RegExp('(iptv|pltv)\\-name *= *[\'"]([^\'"]+)'));
        if(match){
            return match[2]
        }
    }
}

function getNameFromSourceURL(url){
    url = url.replace(new RegExp('^[a-z]*://'), '').split('/');
    return (url[0].split('.')[0]+' '+url[url.length - 1]).replaceAll('?', ' ');
}

function getNameFromSourceURLAsync(url, callback){
    request({url, ttl: 6 * 3600}, (err, object, response) => {
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

function checkStreamTypeByContent(content, callback){
    if(content.match(new RegExp('(group\\-title|tvg\\-[a-z])'))){
        callback('list')
    } else {
        callback('stream')
    }
}

function checkStreamType(url, callback){
    var debug = debugAllow(false), domain = getDomain(url), tsM3u8Regex = new RegExp('\.(ts|m3u8?)([^A-Za-z0-9]|$)');
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
        response = String(response)
        response = ListMan.extract(response)
        if(response && response.indexOf('#EXT') != -1){ // is m3u(8)
            checkStreamTypeByContent(response, t => {
                callback(url, t || stream)
            })
        } else {
            callback(url, 'error')
        }
    }
    if(isHTTP(url)){
        var timeout = 15000, fetchOptions = {redirect: 'follow', method: 'HEAD'};
        fetchTimeout(url, (r, ct) => {
            if(ct){
                if(ct && ct.match(new RegExp('(video)'))){
                    callback('stream')
                } else { // no valid content-type, fetch the whole content to check better
                    timeout = 30000, fetchOptions = {redirect: 'follow', method: 'GET'}
                    fetchTimeout(url, (r) => {
                        console.error('checkStreamType', ct)
                        if(r){
                            doCheck(r)
                        } else {
                            console.error('checkStreamType error', r)
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
    
function askForSource(question, callback, onclose, notCloseable, keepOpened){
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
                v = 'http:'+v
            }
            Store.set('last-ask-for-source-value', v, true)
        }
        if(callback(v) && !keepOpened){
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
    ]
    modalPrompt(question, options, Lang.PASTE_URL_HINT, defaultValue, !notCloseable, onclose)
}
        
function playCustomURL(placeholder, direct, cb){
    var url
    if(placeholder && direct){
        url = placeholder;
    } else {
        if(!placeholder){
            placeholder = Store.get('lastCustomPlayURL')
        }
        return askForSource(Lang.PASTE_URL_HINT, (val) => {
            playCustomURL(val, true, cb)
            return true
        })            
    }
    if(url){
        if(url.substr(0, 2)=='//'){
            url = 'http:'+url;
        }
        Store.set('lastCustomPlayURL', url, true);
        var name = false;
        if(isValidPath(url)){
            name = 'Megacubo '+url.split('/')[2];
        }
        if(name){
            console.log('lastCustomPlayURL', url, name);
            Store.set('lastCustomPlayURL', url, true);
            var entry = {url: url, allowWebPages: true, name: name, logo: defaultIcons['stream']}
            playEntry(entry, null, null, null, cb)
        }
    }
}

function playCustomFile(file){
    Store.set('lastCustomPlayFile', file, true);
    Playback.createIntent({url: file, name: basename(file, true)}, {manual: true})
}

var addNewSourceNotification

function addNewSource(cb, label, allowStreams, notCloseable){
    if(!label){
        label = Lang.PASTE_URL_HINT
    }
    if(typeof(cb) != 'function'){
        cb = jQuery.noop
    }
    askForSource(label, (val) => {
        var url = val
        console.log('CHECK', url)
        if(!addNewSourceNotification){
            addNewSourceNotification = notify(Lang.PROCESSING, 'fa-spin fa-circle-notch', 'forever', true)
        } else {
            addNewSourceNotification.update(Lang.PROCESSING, 'fa-spin fa-circle-notch', 'forever')
        }
        checkStreamType(url, (url, type) => {
            console.log('CHECK CALLBACK', url, type, traceback())
            addNewSourceNotification.hide()
            modalClose(true)
            if(type == 'list'){
                registerSource(url)
                cb(null, 'list')
            } else if(allowStreams && (isValidPath(url) || hasCustomMediaType(url))){
                playCustomURL(url, true, (err, intent, statusCode) => {
                    if(err){
                        var message = getPlaybackErrorMessage(intent, statusCode || err)
                        notify(message, 'fa-exclamation-circle faclr-red', 'normal')
                    }
                })
                cb(null, 'stream')
            } else {
                addNewSourceNotification.update(Lang.INVALID_URL_MSG, 'fa-exclamation-circle faclr-red', 'normal')
                cb(Lang.INVALID_URL_MSG, '')
            }
        })
        return true
    }, () => {
        cb('Prompt closed', '')
    }, notCloseable, true)
}

function isFreePort(port, cb) {
    var server = http.createServer()
    server.listen(port, (err) => {
        server.once('close', () => {
            if(typeof(cb) == 'function'){
                cb(true)
                cb = null
            }
        })
        server.close()
    })
    server.on('error', (err) => {        
        if(typeof(cb) == 'function'){
            cb(true)
            cb = null
        }
    })
}

function findFreePort(cb, min, max) {
    if(typeof(min) != 'number'){
        min = 5000
    }
    if(typeof(max) != 'number'){
        max = 50000
    }
    var port = min
    if(port > max){
        return cb(new Error('No free port available.'))
    }
    min++;
    isFreePort(port, (available) => {
        if(available){
            cb(null, port)
        } else {
            findFreePort(cb, min, max)
        }
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
        if(!Array.isArray(sources[i]) || sources[i][1] == url){
            delete sources[i];
        }
    }
    sources = sources.filter((item) => {
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
    if(!Array.isArray(sources)){
        sources = [];
    }
    var entry = [getNameFromSourceURL(url), url];
    for(var i=0;i<sources.length; i++){
        if(!Array.isArray(sources[i])){
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
        return '1-0-0-0-0'
    } else if(entry.type != 'stream'){
        return '0-0-0-0-0'
    }
    var state = entry ? getStreamStateCache(entry) : null, inHistory = false, inWatching = false;
    for(var i=0; i<historyData.length; i++){
        if(historyData[i].url == entry.url){
            inHistory = true
            break
        }
    }
    if(!inHistory){
        for(var i=0; i<watchingData.length; i++){
            if(watchingData[i].url && watchingData[i].url == entry.url){
                inWatching = true
                break
            }
        }
    }
    var n = Number.MAX_SAFE_INTEGER, nl = String(n).length, score = String(n - (entry.score || 0))
    if(score.length - nl){
        score = "0".repeat(score.length - nl) + score
    }
    return '2-'+
        ((state === true) ? 0 : (state === false ? 2 : 1)) + '-' + 
        (inHistory ? 0 : (inWatching ? 1: 2)) + '-' + 
        score + '-' + 
        ((isLive(entry.url)||isRemoteTS(entry.url)) ? 0 : (isVideo(entry.url)?2:1)) + '-' + 
        (entry.name || '').toLowerCase()
}

function sortEntriesByState(entries){
    var isLiveOrAudio = false, historyData = History.get(), watchingData = getWatchingData()
    if(entries instanceof jQuery){
        var ct = Menu.container(), sentries = jQuery([]), pentries = jQuery([])
        entries.each((i, o) => {
            let j = jQuery(o)
            if(j.length){
                let entry = j.data('entry-data')
                if(entry && (!entry.type || entry.type == 'stream')){
                    if(!isLiveOrAudio && entry.mediaType && entry.mediaType != 'video'){
                        isLiveOrAudio = true
                    }
                    j.data('sortkey', sortEntriesStateKey(entry, historyData, watchingData))
                    sentries = sentries.add(j)
                    return
                }
            }
            pentries = pentries.add(j)
        })
        if(isLiveOrAudio && sentries.length > 8){
            sentries.detach().sort((a, b) => {
                var c = jQuery(a).data('sortkey')
                var d = jQuery(b).data('sortkey')
                return c > d ? 1 : (c < d ? -1 : 0)
            })
            if(pentries.length){
                sentries.insertAfter(pentries.last())
            } else {
                ct.append(sentries)
            }
        }
    } else if(Array.isArray(entries)) {
        if(entries.sortByProp){
            for(var i=0; i<entries.length; i++){
                if(entries[i]){
                    entries[i].sortkey = sortEntriesStateKey(entries[i], historyData, watchingData)
                    if(!isLiveOrAudio && entries[i].mediaType && entries[i].mediaType != 'video'){
                        isLiveOrAudio = true
                    }
                }
            }
            return isLiveOrAudio ? entries.sortByProp('sortkey') : entries
        }
    }
    return entries
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

function getAllSharedLists(callback){
    if(!isListSharingActive()){
        callback([])
    } else {
        const url = 'http://app.megacubo.net/stats/data/sources.'+getLocale(true)+'.json'
        fetchEntries(url, (entries) => {
            sharedLists = entries.map((entry) => { return entry.url }).getUnique()
            callback(sharedLists)
        })
    }
}

function getActiveLists(callback){
    const urls = getSourcesURLs()
    let shLimit = Config.get('search-range-size')
    if(typeof(shLimit) != 'number'){
        shLimit = sharedDefaultSearchRangeSize // fallback
    }
    shLimit -= urls.length
    if(typeof(shLimit) == 'number' && shLimit > 0){
        getAllSharedLists(shUrls => {
            if(shUrls.length > shLimit){
                shUrls = shUrls.slice(0, shLimit)
            }
            callback(urls.concat(shUrls).getUnique())
        })
    } else {
        callback(urls)
    }
}

function fetchEntries(url, callback, update){
    console.log('FETCH', url, traceback());
    var key = 'remote-entries-'+url, fbkey = key + '-fb', doFetch = false, data = GStore.get(key)
    if(!Array.isArray(data) || update){
        doFetch = true;
        data = GStore.get(fbkey); // fallback
        if(!Array.isArray(data)){
            data = []
        }
    }
    if(doFetch){
        jQuery.getJSON(url, (ndata) => {
            if(Array.isArray(ndata) && ndata.length){
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
