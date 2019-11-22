
var $win = jQuery(window), $body = jQuery('body'), isSDKBuild = (window.navigator.plugins.namedItem('Native Client') !== null), searchResultsLimit = 196

function debugAllow(def){
    return isSDKBuild && (typeof(def) == 'undefined' || def)
}

if(!debugAllow()){
    var fns = ['log', 'warn', 'info', 'debug', 'trace', 'clear']
    fns.forEach(fn => {
        window.console[fn] = () => {
            // ignore on non SDK
        }
    })
}

if(typeof(fs)=='undefined'){
    fs = top.fs || require("fs")
}

if(typeof(async)=='undefined'){
    async = top.async || require("async")
}

if(typeof(http)=='undefined'){
    http = top.http || require("http")
}

['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].forEach((key) => { // setTimeout doesn't works sometimes without it
    if(global[key]){
        window[key] = global[key].bind(global)
    }
})

// prevent default behavior from changing page on dropped file
window.ondragover = function(e) { 
    if(e){
        e.preventDefault()
    }
    console.log('dragover', window)
    if(top.dragTimer){
        clearTimeout(top.dragTimer);
    }
    if(top == window){
        var ov = document.querySelector('iframe#overlay');
        if(ov) ov.style.pointerEvents = 'all';
    } else {
        top.ondragover();
    }
    return false
}

window.ondragleave = window.ondrop = function(e) { 
    if(e){
        e.preventDefault(); 
    }
    console.log('dragleave', window);
    if(top.dragTimer){
        clearTimeout(top.dragTimer);
        top.dragTimer = setTimeout(() => {
            var ov = document.querySelector('iframe#overlay');
            if(ov){
                ov.style.pointerEvents = 'none';
            }
        }, 200);
    }
    return false;
};

window.onerror = (...arguments) => {
    console.error('ERROR', arguments, traceback())
    logErr(arguments)
    return true
}

var availableLanguageNames = {
    en: 'English',
    es: 'Español',
    pt: 'Português',
    it: 'Italiano'
}

Array.prototype.getUnique = function() {
    return this.length > 1 ? [...new Set( this )] : this
}

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    if(target.indexOf(search)!=-1){
        target = target.split(search).join(replacement);
    }
    return String(target);
}   

Function.prototype.delay = function (delay, context) {
    this.self = context;
    this.args = Array.prototype.slice.call(arguments, 2);
    return setTimeout(this, delay)
}

jQuery.ajaxSetup({ cache: false });

jQuery.fn.reverse = function() {
    return this.pushStack(this.get().reverse(), arguments);
} 

function loadScripts(arr, path, callback){
    if(typeof(async) != 'object'){
        async = require('async')
    }
    var i = 0, tasks = arr.map(() => {
        var scr = arr[i];
        i++;
        return (cb) => {
            console.warn('LOAD', (path||"") + scr, cb)
            loadScript((path||"") + scr, cb)
        }
    })
    if(typeof(callback) != 'function'){
        callback = jQuery.noop
    }
    async.parallelLimit(tasks, 1, callback)
}

function loadScript(__url, cb){
    let basenm = basename(__url), callback = () => {
        if(typeof(cb) == 'function'){
            cb()
        }
    }
    let next = (url) => {
        if(getExt(url) == 'bin'){
            //console.warn('LOADED', url);
            nw.Window.get().evalNWBin(null, url)
            callback()
        } else {
            var script = document.createElement("script")
            script.type = "text/javascript";
            script.onload = () => {
                //console.warn('LOADED', url);
                setTimeout(callback, 1)
            }
            script.onerror = () => {
                //console.warn('ERROR', url);
                setTimeout(callback, 1)
            }
            script.src = url;
            document.querySelector("head").appendChild(script)
        }
    }
    let check = (url) => {
        fs.exists(url, (exists) => {
            if(exists){
                next(url)
            } else {
                let ext = getExt(url)
                if(ext == 'js') {
                    check(url.replaceAll(basenm, basenm.replace('.js', '.bin')))
                } else {
                    console.error('loadScript failure for', __url)
                    callback()
                }
            }
        })
    }
    check(__url)
}

function rand(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// First, checks if it isn't implemented yet.
if (!String.prototype.format) {
    String.prototype.format = function (){
        var args = arguments;
        return this.replace(/{(\d+)}/g, function(match, number) { 
        return typeof args[number] != 'undefined'
            ? args[number]
            : match
        })
    }
}

if (!Array.prototype.sortByProp) {
    Array.prototype.sortByProp = function (p, reverse) {
        if(this instanceof Array){ // this.slice is not a function
            return this.slice(0).sort((a,b) => {
                if(reverse) return (a[p] > b[p]) ? -1 : (a[p] < b[p]) ? 1 : 0;
                return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
            })
        }
        return this;
    }
}

(function($) {
    $.fn.outerHTML = function() {
        return $(this).clone().wrap('<div></div>').parent().html()
    }
    $.fn.label = function(val, tooltipDirection) {
        let j = $(this)
        if(!tooltipDirection){
            tooltipDirection = j.attr('data-balloon-pos')
        }
        return j.prop('title', val).attr('aria-label', val).attr('data-balloon', val).attr('data-balloon-pos', tooltipDirection || 'up-left')
    }
})(jQuery)

/*
Uint8Array.prototype.indexOfMulti = function (searchElements, fromIndex) {
    fromIndex = fromIndex || 0;


    var index = Array.prototype.indexOf.call(this, searchElements[0], fromIndex);
    if(searchElements.length === 1 || index === -1) {
        // Not found or no other elements to check
        return index;
    }

    for(var i = index, j = 0; j < searchElements.length && i < this.length; i++, j++) {
        if(this[i] !== searchElements[j]) {
            return this.indexOfMulti(searchElements, index + 1);
        }
    }

    return(i === index + searchElements.length) ? index : -1;
}

Uint8Array.prototype.indexOfMulti2 = function (search) {
    var result = -1, index, fromIndex = 0, scanCount = 0;
    console.log('indexOfMulti::start');
    for(var i=0; i < this.length; i++){
        index = this.indexOf(search[0], fromIndex);
        scanCount++;
        if(index != -1){
            //console.log('indexOfMulti::offset', index);
            result = index;
            fromIndex = index + 1;
            for(var j = 1; j < search.length; j++){
                index++;
                //console.log(search[j], this[index]);
                if(search[j] != this[index]){
                    result = -1;
                    //console.log('indexOfMulti::break', j);
                    break;
                }
            }
            if(result != -1){
                break;
            }
        } else {
            break;
        }
    }
    console.log('indexOfMulti::done', result, scanCount);
    return result;
}
*/

Uint8Array.prototype.indexOfMulti = function (search) {
    var result = -1, index, fromIndex = 0, scanCount = 0, rotateOffset = 0, maxCharRotation = parseInt(search.length / 2);
    console.log('indexOfMulti::start');
    for(var i=0; i < this.length; i++){
        index = this.indexOf(search[0 + rotateOffset], fromIndex);
        scanCount++;
        if(index != -1){
            //console.log('indexOfMulti::offset', index);
            result = index;
            fromIndex = index + 1;
            for(var j = 1 + rotateOffset; j < (search.length - rotateOffset); j++){
                index++;
                //console.log(search[j], this[index]);
                if(search[j] != this[index]){
                    result = -1;
                    //console.log('indexOfMulti::break', j);
                    rotateOffset++;
                    if(rotateOffset > maxCharRotation){
                        //console.log('indexOfMulti::rotate', rotateOffset);
                        rotateOffset = 0;
                    } else { 
                        fromIndex++; 
                    }
                    break;
                }
            }
            if(result != -1){
                break;
            }
        } else {
            break;
        }
    }
    console.log('indexOfMulti::done', result, scanCount);
    return result == -1 ? -1 : (result - rotateOffset);
}

function blobToBuffer (blob, cb) {
    if (typeof(Blob) === 'undefined' || !(typeof(blob) == 'object' && typeof(blob.constructor) != 'undefined' && blob.constructor.name == "Blob")) {
        return cb(new Error('first argument must be a Blob, received:', typeof(blob), JSON.stringify(blob)))
    }
    if (typeof cb !== 'function') {
        return cb(new Error('second argument must be a function'))
    }    
    var reader = new FileReader()    
    function onLoadEnd (e) {
        reader.removeEventListener('loadend', onLoadEnd, false)
        if (e.error) {
            cb(e.error)
        } else {
            cb(null, Buffer.from(reader.result))
        }
    }    
    reader.addEventListener('loadend', onLoadEnd, false)
    reader.readAsArrayBuffer(blob)
}

function concatTypedArrays(a, b) { // a, b TypedArray of same type
    var c = new (a.constructor)(a.length + b.length);
    c.set(a, 0);
    c.set(b, a.length);
    return c;
}

function concatBuffers(a, b) {
    return concatTypedArrays(
        new Uint8Array(a.buffer || a), 
        new Uint8Array(b.buffer || b)
    ).buffer;
}

function concatBytes(ui8a, bytes) {
    var b = new Uint8Array(bytes.length)
    bytes.forEach(function (byte, index) {
        b[index] = byte
    })
    var r = concatTypedArrays(ui8a, b)
    ui8a = null
    b = null
    return r
}

function tag(el){
    return (el&&el.tagName)?el.tagName.toLowerCase():''
}

function time(){
    return ((new Date()).getTime() / 1000)
}

/*
function fetchTimeout(url, _callback, ms, opts){
    let didTimeOut = false, callback = (response, type) => {
        if(typeof(_callback)=='function'){
            _callback(response, type)
            _callback = null
        }
    }
    return new Promise(function (resolve, reject) {
        const timeout = setTimeout(function() {
            didTimeOut = true
            reject(new Error('Request timed out'))
        }, ms)
        var contentType = false
        fetch(url, opts).then((response) => {
            contentType = response.headers.get("content-type")
            return response.text()
        }).then((response) => {
            // Clear the timeout as cleanup
            clearTimeout(timeout)
            if(!didTimeOut) {
                resolve(response)
                callback(response, contentType)
            }
        }).catch(function(err) {
            console.log('fetch failed! ', err)
            if(didTimeOut) return
            reject(err)
            callback(false, false)
        })
    }).catch(function(err) {
        // Error: response error, request timeout or runtime error
        console.log('promise error! ', url, err)
        callback(false, false)
    })
}
*/

function fetchTimeout(url, _callback, ms, opts){
    request({url, timeout: ms}, (error, response, body) => {
        let type = response ? (response.headers['content-type'] || '') : ''
        _callback(body || '', type)
    })
}

var absolutize = (url, base) => {
    if('string' !== typeof(url) || !url){
        return null; // wrong or empty url
    } else if(url.match(/^[a-z]+\:\/\//i)){ 
        return url; // url is absolute already 
    } else if(url.match(/^\/\//)){ 
        return 'http:'+url; // url is absolute already 
    } else if(url.match(/^[a-z]+\:/i)){ 
        return url; // data URI, mailto:, tel:, etc.
    } else if('string' !== typeof(base)){
        var a=document.createElement('a'); 
        a.href=url; // try to resolve url without base  
        if(!a.pathname){ 
            return null; // url not valid 
        }
        return 'http://'+url
    } else { 
        base = absolutize(base) // check base
        if(base === null){
            return null // wrong base
        }
    }
    var a=document.createElement('a')
    a.href=base;    
    if(url[0] == '/'){ 
        base = [] // rooted path
    } else{ 
        base = a.pathname.split('/') // relative path
        base.pop()
    }
    url=url.split('/');
    for(var i=0; i<url.length; ++i){
        if(url[i]==='.'){ // current directory
            continue;
        }
        if(url[i]==='..'){ // parent directory
            if('undefined'===typeof base.pop() || base.length===0){ 
                return null; // wrong url accessing non-existing parent directories
            }
        }
        else{ // child directory
            base.push(url[i]); 
        }
    }
    return a.protocol + '//' + a.hostname + (a.port && a.port != 80 ? ':' + a.port : '') + base.join('/');
}

function validateURL(value, placeholder) {
    return typeof(value) == 'string' && value != placeholder && value.length >= 13 && /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
}

function getHeaders(url, callback, timeoutSecs){
    var start = time(), timer = 0, currentURL = url
    if(typeof(callback)!='function'){
        callback = jQuery.noop
    }
    if(validateURL(url)){
        console.warn(url, traceback())
        if(typeof(timeoutSecs) != 'number'){
            timeoutSecs = 20;
        }
        var r = request({url, ttl: 0}), abort = () => {
            if(r.abort){
                r.abort()
            } else {
                r.end()
                r.removeAllListeners()
            }
        }
        console.warn(url, timeoutSecs)
        r.on('error', (response) => {
            abort()
            callback({}, url)
        })
        r.on('response', (response) => {
            console.log('UAAAAA', url, response, response.headers, requestJar.getCookieString(url), traceback())
            clearTimeout(timer)
            var headers = response.headers
            headers['status'] = response.statusCode
            abort()
            if(headers['location'] && headers['location'] != url && headers['location'] != currentURL){
                if(!headers['location'].match(new RegExp('^(//|https?://)'))){
                    headers['location'] = absolutize(headers['location'], currentURL)
                }
                currentURL = headers['location']
                var remainingTimeout = timeoutSecs - (time() - start)
                if(remainingTimeout && headers['location'] != url && headers['location'] != currentURL){
                    getHeaders(headers['location'], callback, remainingTimeout)
                } else {
                    callback(headers, url)
                }
            } else {
                callback(headers, url)
            }
        })
        console.warn(url, timeoutSecs)
        timer = setTimeout(() => {
            console.warn(url, timeoutSecs)
            abort()
            callback({}, url)
        }, timeoutSecs * 1000)
    } else {
        callback({}, url)
    }
}

function parseThousands(s){
    var locale = getLocale(false, true)
    return Number(String(s).replace(new RegExp('[^0-9]', 'g'), '')).toLocaleString(locale)
}

function basename(str, rqs){
    str = String(str), qs = ''
    let pos = str.indexOf('?')
    if(pos != -1){
        qs = str.slice(pos + 1)
        str = str.slice(0, pos)
    }
    str = str.replaceAll('\\', '/')
    pos = str.lastIndexOf('/')
    if(pos != -1){
        str = str.substring(pos + 1)
    }
    if(!rqs && qs){
        str += '?'+qs
    }
    return str
}

function dirname(str){
    _str = new String(str)
    pos = _str.replaceAll('\\', '/').lastIndexOf('/')
    if(!pos) return ''
    _str = _str.substring(0, pos)
    return _str
}

WPDK_FILTERS = {}, WPDK_ACTIONS = {}

_wpdk_add = function( type, tag, function_to_add, priority )
{
    var lists = ( 'filter' == type ) ? WPDK_FILTERS : WPDK_ACTIONS;

    // Defaults
    priority = ( priority || 10 );

    if( !( tag in lists ) ) {
        lists[ tag ] = [];
    }

    if( !( priority in lists[ tag ] ) ) {
        lists[ tag ][ priority ] = [];
    }

    lists[ tag ][ priority ].push( {
        func : function_to_add,
        pri  : priority
    } );

};

_wpdk_has = function( type, tag, fn)
{
    var lists = ( 'filter' == type ) ? WPDK_FILTERS : WPDK_ACTIONS;

    if(tag in lists) {
        for(var priority in lists[ tag ]){
            for(var i=0; i< lists[tag][priority].length; i++){
                if(lists[tag][priority][i] && (typeof(fn) != 'function' || lists[tag][priority][i].func == fn)){
                    return true;
                    break;
                }
            }
        }
    }

};

_wpdk_remove = function( type, tag, fn)
{
    var lists = ( 'filter' == type ) ? WPDK_FILTERS : WPDK_ACTIONS;		
    if(tag in lists) {
        if(typeof(fn) != 'function'){
            lists[tag] = [];
        } else {
            for(var priority in lists[ tag ]){
                for(var i=0; i< lists[tag][priority].length; i++){
                    if(lists[tag][priority][i] && lists[tag][priority][i].func == fn) {
                        lists[tag][priority].splice(i, 1);
                    }
                }
            }
        }
    }

}

_wpdk_do = function( type, args )
{
    var hook, lists = ( 'action' == type ) ? WPDK_ACTIONS : WPDK_FILTERS;
    var tag = args[ 0 ];

    if( !( tag in lists ) ) {
        return args[ 1 ];
    }

    // Remove the first argument
    [].shift.apply( args );

    for( var pri in lists[ tag ] ) {

        hook = lists[ tag ][ pri ];

        if( typeof hook !== 'undefined' ) {

            for( var f in hook ) {
                var func = hook[ f ].func, n;
        
                if( typeof func === "function" ) {
                    try {
                        if( 'filter' === type ) {
                            n = func.apply( null, args );
                            args[ 0 ] = n; // no error catched
                        }
                        else {
                            func.apply( null, args || []);
                        }
                    } catch(e) {
                        // alert('ACTION' + type + ' ' + e)
                        console.error('ACTION ERR', type, e, func.toString())
                    }
                }
            }
        }
    }

    if( 'filter' === type ) {
        return args[ 0 ]
    }

}

addFilter = function( tag, function_to_add, priority ) {
    _wpdk_add( 'filter', tag, function_to_add, priority )
}

hasFilter = function( tag, fn ) {
    return _wpdk_has( 'filter', tag, fn )
}

applyFilters = function( tag, value, varargs ) {
    return _wpdk_do( 'filter', arguments )
}

removeFilter = function( tag, fn ) {
    _wpdk_remove( 'filter', tag, fn )
}

addAction = function( tag, function_to_add, priority ) {
    _wpdk_add( 'action', tag, function_to_add, priority )
}

hasAction = function( tag, fn ) {
    return _wpdk_has( 'action', tag, fn )
}

doAction = function( tag ) {
    _wpdk_do( 'action', arguments )
}

removeAction = function( tag, fn ) {
    _wpdk_remove( 'action', tag, fn )
}

if(typeof(fs)=='undefined'){
    var fs = require("fs")
}

if(typeof(path)=='undefined'){
    var path = require("path")
}

if(top == window){

    var pos = nw.App.dataPath.lastIndexOf(nw.App.manifest.name);
    profilePath = nw.App.dataPath.substr(0, pos + nw.App.manifest.name.length);
    profilePath = path.normalize(profilePath);

    var Users = ((folder) => {
        var self = {
            folder: folder,
            logged: null
        };
        self.getSystemUser = () => {
            return process.env.USERNAME || process.env.USER || 'Default'
        }
        self.setLogged = (name) => {
            self.list = self.list.filter((n) => { return n != name; });
            self.list.unshift(name);
            self.logged = name;
            self.loggedFolder = self.folder + path.sep + name;
            localStorage.setItem('logged-user', name)
        }
        self.load = () => {
            if(!fs.existsSync(self.folder)){
                fs.mkdirSync(self.folder)
            }
            self.list = fs.readdirSync(self.folder).filter((name) => {
                return name != 'Store' && fs.statSync(self.folder + path.sep + name).isDirectory()
            });
            if(!self.list.length){
                let usr = self.getSystemUser();
                fs.mkdirSync(self.folder + path.sep + usr);
                self.logged = usr;
            }
            if(!self.logged){
                var lgd = localStorage.getItem('logged-user');
                if(lgd && self.list.indexOf(lgd) != -1){
                    self.setLogged(lgd);
                    return;
                } else {
                    self.logged = self.list[0];
                }
            }
            self.setLogged(self.logged)
        }
        self.logon = (name) => {
            if(self.list.indexOf(name) != -1){
                localStorage.setItem('logged-user', name);
                restartApp(false)
            }
        }
        self.load();
        return self;
    })(profilePath + path.sep + 'Users');

    var StorageController = require(path.resolve('modules/storage-controller'))
    var GStore = new StorageController(profilePath + path.sep + 'Store')
    var Store = new StorageController(profilePath + path.sep + 'Users' + path.sep + Users.logged + path.sep + 'Store')

    var Config = (() => {
        var self = {
            debug: false,
            loaded: false,
            file: Users.loggedFolder + path.sep + 'configure.json',
            defaults: {
                "abbreviate-counters": true,
                "adult-content-policy": "block",
                "autofit": false,
                "autoscroll": true,
                "bookmark-dialing": true,
                "connect-timeout": 10,
                "connecting-error-action": "search",
                "context-menu": {
                    "window": [
                        "HOME",
                        "OPENURLORLIST",
                        -1,
                        "SEARCH",
                        "BOOKMARKS",
                        "TOOLS",
                        "STREAM_URL",
                        -1,
                        "FULLSCREEN",
                        "MINIPLAYER",
                        -1,
                        "CHANGELANG",
                        "ABOUT",
                        "EXIT"
                    ]
                    },
                "dialing-action": "search",
                "gpu-rendering": true,
                "hotkeys": {
                    "Ctrl+T": "TOOLS",
                    "Ctrl+W": "STOP",
                    "Ctrl+Z": "UNDO",
                    "Ctrl+E": "STREAM_URL",
                    "F1": "HELP",
                    "Ctrl+I": "ABOUT",
                    "F3 Ctrl+F Ctrl+F3": "SEARCH",
                    "F5": "RELOAD",
                    "Alt+F5": "SOFTRELOAD",
                    "Space": "PLAYPAUSE",
                    "Ctrl+H": "HISTORY",
                    "Ctrl+U Ctrl+O": "OPENURLORLIST",
                    "Ctrl+V": "PASTEPLAY",
                    "Ctrl+L": "CHANGELANG",
                    "Ctrl+D Ctrl+S": "ADDFAV",
                    "Ctrl+Alt+D Ctrl+Alt+S": "REMOVEFAV",
                    "Ctrl+Shift+D Ctrl+Shift+S": "BOOKMARKS",
                    "Ctrl+Alt+R Ctrl+F5": "RESTARTAPP",
                    "Home": "HOME",
                    "Delete": "DELETE",
                    "Up Shift+Tab": "NAVUP",
                    "Down Tab": "NAVDOWN",
                    "Enter": "NAVENTER",
                    "Alt+Enter F11": "FULLSCREEN",
                    "Ctrl+Right": "SEEKFORWARD",
                    "Ctrl+Left": "SEEKREWIND",
                    "Left": "NAVLEFT",
                    "Right": "NAVRIGHT",
                    "Backspace": "BACKNOTINPUT",
                    "Ctrl+Backspace": "BACK",
                    "F4": "CHANGESCALE",
                    "Ctrl+M": "MINIPLAYER",
                    "Ctrl+Tab": "PLAYALTERNATE",
                    "Esc": "ESCAPE",
                    "Ctrl+G": "TVGUIDE",
                    "F2": "RENAME"
                },
                "initial-section": "",
                "initial-sections": ['featured', 'continue', 'live', 'videos', 'youtube'],
                "initial-sections-only": false,
                "min-buffer-secs-before-commit": 2,
                "override-locale": "", 
                "p2p": true,
                "play-while-tuning": true,
                "resolution-limit": "1280x720",
                "resume": false,
                "search-range-size": 0,
                "sources": [],
                "themes": {},
                "theme-current": "default",
                "tooltips": true,
                "transcode-fps": 0,
                "ts-joining-needle-size": 128, // KB
                "ts-joining-stack-size": 12, // MB
                "tune-timeout": 45,
                "tuning-ignore-webpages": true,
                "volume": 1.0,
                "warn-on-connection-errors": true
            }
        };
        self.data = Object.assign({}, self.defaults); // keep defaults object for reference
        for(var key in self.data){
            if(typeof(self.data[key]) != typeof(self.defaults[key])){
                console.error('Invalid key value for', key, self.data[key], 'is not of type ' + typeof(self.defaults[key]));
                self.data[key] = self.defaults[key];
            }
        }
        self.load = () => {
            if(!self.loaded  && fs.existsSync(self.file)){
                self.loaded = true
                var _data = fs.readFileSync(self.file, "utf8")
                if(_data){
                    if(Buffer.isBuffer(_data)){ // is buffer
                        _data = String(_data)
                    }
                    if(self.debug){
                        console.log('DATA', _data)
                    }
                    if(typeof(_data)=='string' && _data.length > 2){
                        _data = _data.replaceAll("\n", "");
                        //data = stripBOM(data.replace(new RegExp("([\r\n\t]| +)", "g"), "")); // with \n the array returns empty (?!)
                        _data = JSON.parse(_data);
                        if(typeof(_data)=='object'){
                            self.data = Object.assign(self.data, _data)
                        }
                    }
                }
            }
        }
        self.reload = () => {
            self.loaded = false
            self.load()
        }
        self.getAll = () => {
            self.load()
            var data = {};
            Object.keys(self.defaults).forEach((key) => {
                data[key] = self.data[key] || self.defaults[key];
            });
            //console.log('GET', key);
            return data;
        }
        self.get = (key) => {
            self.load()
            //console.log('DATAb', JSON.stringify(data))
            //console.log('GET', key, traceback());
            var t = typeof(self.data[key]);
            if(t == 'undefined'){
                self.data[key] = self.defaults[key];
                t = typeof(self.defaults[key]);
            }
            if(t == 'undefined'){
                return null;
            } else if(t == 'object') {
                if(Array.isArray(self.data[key])){ // avoid referencing
                    return self.data[key].slice(0)
                } else {
                    return Object.assign({}, self.data[key])
                }
            }
            return self.data[key];
        }
        self.set = (key, val) => {
            self.load()
            if(self.debug){
                console.log('SSSET', key, val, self.data)
            }
            self.data[key] = val;
            if(typeof(self.defaults[key]) == 'undefined'){
                self.defaults[key] = val;
            }
            if(fs.existsSync(self.file)){
                fs.truncateSync(self.file, 0)
            } else {
                console.warn(dirname(self.file))
                mkdirr(dirname(self.file))
            }
            var jso = JSON.stringify(Object.assign({}, self.data), null, 3);
            fs.writeFileSync(self.file, jso, "utf8")
            if(self.debug){
                console.log('SSSET', jso, self.data)
            }
        }
        return self;
    })()   
    
    var Theme = (() => {
        var self = {
            debug: false,
            active: 'default',
            dir: path.resolve('themes'),
            defaults: {
                "compability": 1.2, // increment to purge default theme
                "hide-logos": false,
                "background-image": "assets/images/wallpaper.png",
                "background-color": "#150055",
                "background-color-playing": "#020006",
                "background-opacity": 100,
                "font-color": "#FFFFFF",
                "font-family": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Oxygen-Sans, Ubuntu, Cantarell, \"Helvetica Neue\", sans-serif",
                "font-size": 13,
                "font-weight": 100,
                "hide-back-button": false,
                "hide-menu-auto": false,
                "highlight-opacity": 8,
                "icon-framing": "y",
                "icon-size": 20,
                "icon-rounding": 50,
                "inline-css": "",
                "logo": "default_icon.png",
                "logo-opacity": 75,
                "menu-entry-vertical-padding": 10,
                "menu-opacity": 100,
                "menu-inset-shadow": 1,
                "menu-margin": 0,
                "menu-uppercase": true,
                "menu-width": 34,
                "name": "default",
                "slide-menu-transitions": false,
                "tuning-background-animation": "spin-x"
            }
        }, loaded = false; // keep defaults object for reference
        self.assign = (data, target) => {
            var inline = false;
            if(!target || typeof(target) != 'object'){
                target = self.data;
                inline = true;
            }
            if(typeof(data)=='object' && (typeof(data.compability) == 'undefined' || data.compability >= self.defaults.compability)){
                self.keys.forEach(key => {
                    if(typeof(data[key]) != 'undefined'){
                        if(typeof(self.defaults[key]) == typeof(data[key])){
                            target[key] = data[key];
                        } else {
                            console.error('Invalid key value for', key, data[key], 'is not of type ' + typeof(data[key]))
                        }
                    }
                })
            } else {
                console.error('Theme incompatible', data.compability, '<', self.defaults.compability)
            }
            if(inline){
                self.data = target;
            }
            return target;
        }
        self.diff = (defaultData, currentData) => {
            var modData = {};
            Object.keys(defaultData).forEach((key) => {
                if(typeof(currentData[key]) != 'undefined' && defaultData[key] != currentData[key]){
                    modData[key] = currentData[key]
                }
            }) 
            return modData;
        }
        self.themes = (dataset, original) => {
            if(dataset && typeof(dataset) == 'object'){
                Config.set('themes', dataset)
            }
            var themes = {}, customizedThemes = original ? false : Config.get('themes');
            if(!customizedThemes){
                customizedThemes = {}
            }
            fs.readdirSync(self.dir).forEach(file => {
                if(file.indexOf('.json') != -1){
                    let def = Object.assign({}, self.defaults), data = String(fs.readFileSync(self.dir + path.sep + file))
                    if(data){
                        data = JSON.parse(data)
                        if(data){
                            data = Object.assign(def, data)
                            if(!original && typeof(customizedThemes[data.name]) !== 'undefined'){
                                data = self.assign(customizedThemes[data.name], data)   
                            }
                            themes[data.name] = data;
                        }
                    }
                }
            })
            return themes;
        }
        self.load = () => {
            loaded = true;
            self.active = Config.get('theme-current');
            var themes = self.themes();
            if(typeof(themes[self.active]) == 'undefined'){
                self.active = 'default';
                Config.set('theme-current', self.active)
            }
            if(typeof(themes[self.active]) != 'undefined'){
                self.assign(themes[self.active])
            }
        }
        self.getAll = () => {
            if(!loaded){
                self.load()
            }
            //console.log('GET', key);
            return self.data;
        }
        self.get = (key) => {
            if(!loaded){
                self.load()
            }
            if(self.debug){
                console.log('GET', key, traceback())
            }
            var t = typeof(self.data[key]);
            if(t == 'undefined'){
                self.data[key] = self.defaults[key];
                t = typeof(self.defaults[key]);
            }
            if(t == 'undefined'){
                return null;
            } else if(t == 'object') {
                if(Array.isArray(self.data[key])){ // avoid referencing
                    return self.data[key].slice(0)
                } else {
                    return Object.assign({}, self.data[key])
                }
            }
            return self.data[key];
        }
        self.set = (key, val) => {
            if(!loaded){
                self.load()
            }
            if(self.debug){
                console.log('SSSET', key, val, self.data)
            }
            var themes = Config.get('themes'), fullThemes = self.themes(false, true), atts = themes[self.active] || {};
            console.log('SSSET', key, val, themes, atts, self.active);
            atts[key] = val;
            console.log('SSSET', key, val, themes, atts);
            themes[self.active] = self.diff(fullThemes[self.active], atts);
            console.log('SSSET', themes);
            self.assign(atts);
            console.log('SSSET', self.data);
            if(self.debug){
                console.log('SSSET', themes[self.active][key] == val, themes[self.active][key])
            }
            self.themes(themes)
        }
        self.reset = (cb) => {
            if(!loaded){
                self.load()
            }
            var themes = Config.get('themes'), current = Config.get('theme-current');
            themes[current] = {};
            self.themes(themes);
            self.activate(current, cb)
        }
        self.activate = (name, cb) => {
            var themes = self.themes();
            if(typeof(themes[name]) != 'undefined'){
                self.active = name;
                Config.set('theme-current', name);
                self.assign(themes[name]);
                saveThemeImages();
                loadTheming(null, cb)
            } else cb()
        }
        self.data = {};
        self.keys = Object.keys(self.defaults).sort();
        self.assign(self.defaults);
        return self;
    })()   
} else {
    var Config = top.Config, Store = top.Store, GStore = top.GStore, Theme = top.Theme, Users = top.Users
}

function prepareFilename(file, keepAccents){
    file = file.replace(new RegExp('[\\\\/:*?\"<>|]'), 'g')
    if(!keepAccents){
        file = file.normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '').replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '')
    }
    return file;
}

function ucWords(str){
    return str.toLowerCase().replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]|\s[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, function(letter) {
        return letter.toUpperCase();
    })
}

function ucFirst(str){
    return str.toLowerCase().replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, function(letter) {
        return letter.toUpperCase();
    })
}

function ucNameFix(name){
    if(name == name.toLowerCase()){
        return ucWords(name)
    }
    return name;
}

function sliceObject(object, s, e){
    var ret = {};
    if(object){
        var keys = Object.keys(object).slice(s, e);
        for(var i=0; i<keys.length; i++){
            ret[keys[i]] = object[keys[i]];
        }
    }
    return ret;
}

function getLocalJSON(file, cb){
    fs.readFile(path.resolve(file), (err, content) => {
        if( err ) {
            cb('File not found.', false)
        } else {
            content = String(content).replaceAll(String.fromCharCode(160), '') // remove invisible chars, those breaks JSON.parse()
            try {
                var parsed = JSON.parse(content)
            } catch(e) {
                console.error(file, e, typeof(content), content)
            }
            if(typeof(parsed) == 'undefined'){
                cb('Parsing error.', false)
            } else {
                cb(null, parsed)
            }
        }
    })
}

function seekRewind(){
    if(top && top.Playback && top.Playback.active){
        notify(Lang.REWIND, 'fa-backward', 'short');
        top.Playback.seek(-4)
    }
}

function seekForward(){
    if(top && top.Playback && top.Playback.active){
        notify(Lang.FORWARD, 'fa-forward', 'short');
        top.Playback.seek(4)
    }
}

function getPreviousStream(entry, cb){
    if(!entry){
        entry = (Playback.active||Playback.lastActive)
        if(entry && entry.entry){
            entry = entry.entry
        } else {
            return cb(false)
        }
    }
    search(entries => {
        let oi = 0
        entries.some((e, i) => {
            if(e.name == entry.name){
                oi = i - 1
                if(typeof(entries[oi]) == 'undefined'){
                    oi = 0
                }
            }
        })        
        if(typeof(entries[oi]) != 'undefined'){
            cb(entries[oi])
        } else {
            cb(false)
        }
    }, 'video', entry.group, true, false)
}

function getNextStream(entry, cb){
    if(!entry){
        entry = (Playback.active||Playback.lastActive)
        if(entry && entry.entry){
            entry = entry.entry
        } else {
            return cb(false)
        }
    }
    search(entries => {
        let oi = 0
        entries.some((e, i) => {
            if(e.name == entry.name){
                oi = i + 1
                if(typeof(entries[oi]) == 'undefined'){
                    oi = 0
                }
            }
        })        
        if(typeof(entries[oi]) != 'undefined'){
            cb(entries[oi])
        } else {
            cb(false)
        }
    }, 'video', entry.group, true, false)
}

function goHome(){
    stop();
    var c = (top || parent);
    if(c){
        c.Menu.go('');
        if(c.isMiniPlayerActive()){
            c.leaveMiniPlayer()
        }
    }
}

function goExport(){
    if(Playback.active){
        let opts = [
            ['<i class="fas fa-check-circle" aria-hidden="true"></i> OK', () => {}]
        ]
        modalPrompt(Lang.STREAM_URL, opts, Playback.active.entry.url, Playback.active.entry.url, true, () => { return true })
    } else {
        notify(Lang.START_PLAYBACK_FIRST, 'fa-exclamation-triangle faclr-red', 'normal')
    }
}

function restartApp(){
    if(ipc && ipc.server.server.listening){        
        if(!ipcIsClosing){
            ipcIsClosing = true
            ipcSrvClose(() => {
                ipc = false
                restartApp()
            })
        }
        return
    }
    doAction('appUnload')
    var delay = 3, templates = {
        // win32: ['restartApp.cmd', "@echo off\r\nping 127.0.0.1 -n {0} > nul\r\n{1} {2}"], 
        win32: ['restartApp.cmd', "@echo off\r\ntimeout /T {0} > nul\r\n{1} {2}"], 
        linux: ['restartApp.sh', "sleep {0}\r\n{1} {2}"]
    }, cmd = templates[process.platform]
    cmd[0] = GStore.folder + path.sep + cmd[0]
    cmd[1] = cmd[1].format(delay, process.execPath, nw.App.argv.join(' '))
    fs.writeFileSync(cmd[0], cmd[1], {flag: 'w'})
    require('child_process').spawn(cmd[0], [], {
        detached: true,
        windowsHide: true
    })
    process.abort(0)
}

function bufferize(buffer) {
    if(buffer.constructor.name == 'ArrayBuffer'){
        buffer = Buffer.from(buffer)
    } else if(typeof(buffer)=='object' && typeof(buffer.base64Encoded)!='undefined'){
        if(buffer.base64Encoded){
            buffer = Buffer.from(buffer.body, 'base64')
        } else {
            buffer = buffer.body
        }
    }  
    return buffer
}

function toTitleCase(str)
{
    return str.replace(/\w\S*/g, function(txt){
        return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
    });
}

function parseQueryString(url) {
    var queryString = url;
    if(url.indexOf('?') != -1){
        queryString = url.split('?')[1]
    }
    var params = {}, queries, temp, i, l;
    // Split into key/value pairs
    queries = queryString.split("&");
    // Convert the array of strings into an object
    for ( i = 0, l = queries.length; i < l; i++ ) {
        temp = queries[i].split('=');
        params[temp[0]] = (temp.length > 1) ? decodeURIComponent(temp[1]) : '';
    }
    return params;
};

var m3u8Parser;

function getM3u8Parser(){
    if(!top.m3u8Parser){
        top.m3u8Parser = require('m3u8-parser');
    }
    return new top.m3u8Parser.Parser()
}    

function areFramesReady(callback){
    var ok = true;
    ['player', 'overlay'].forEach((name) => {
        var w = getFrame(name);
        if(!w || !w.document || ['loaded', 'complete'].indexOf(w.document.readyState)==-1){
            ok = false;
        } else {
            if(!w.top && window.top){
                w.top = window.top;
            }
        }
    });
    if(typeof(callback)=='function'){
        if(ok){
            callback()
        } else {
            setTimeout(() => {
                areFramesReady(callback)
            }, 250)
        }
    }
    return ok;
}

function statusCodeToMessage(code){
    var codes = {
        '200': 'OK',
        '201': 'Created',
        '202': 'Accepted',
        '203': 'Non-Authoritative Information',
        '204': 'No Content',
        '205': 'Reset Content',
        '206': 'Partial Content',
        '300': 'Multiple Choices',
        '301': 'Moved Permanently',
        '302': 'Found',
        '303': 'See Other',
        '304': 'Not Modified',
        '305': 'Use Proxy',
        '307': 'Temporary Redirect',
        '400': 'Bad Request',
        '401': 'Unauthorized',
        '402': 'Payment Required',
        '403': 'Forbidden',
        '404': 'Not Found',
        '405': 'Method Not Allowed',
        '406': 'Not Acceptable',
        '407': 'Proxy Authentication Required',
        '408': 'Request Timeout',
        '409': 'Conflict',
        '410': 'Gone',
        '411': 'Length Required',
        '412': 'Precondition Failed',
        '413': 'Request Entity Too Large',
        '414': 'Request-URI Too Long',
        '415': 'Unsupported Media Type',
        '416': 'Requested Range Not Satisfiable',
        '417': 'Expectation Failed',
        '500': 'Internal Server Error',
        '501': 'Not Implemented',
        '502': 'Bad Gateway',
        '503': 'Service Unavailable',
        '504': 'Gateway Timeout',
        '505': 'HTTP Version Not Supported'
    }
    if(typeof(codes[code])!='undefined'){
        return codes[String(code)];
    }
    return 'Unknown error';
}

var shortcuts = [];

function setupShortcuts(){ 
    if (document.URL.match(new RegExp('(detect\-keys|indexer|background_page)\.html'))) {
        return;
    }  else if (top != window) {
        setupEventForwarding(document)
    } else {
        var globalHotkeys = [
            {
                key : "MediaPrevTrack",
                active : () => {
                    getPreviousStream(null, (e) => {
                        if(e){
                            (top || parent).playEntry(e)
                        } else {
                            (top || parent).stop()
                            notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
                        }
                    })
                }
            },
            {
                key : "MediaNextTrack",
                active : () => {
                    getNextStream(null, (e) => {
                        if(e){
                            (top || parent).playEntry(e)
                        } else {
                            (top || parent).stop()
                            notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
                        }
                    })
                }
            },
            {
                key : "MediaPlayPause",
                active : () => {
                    top.playPause();
                }
            },
            {
                key : "MediaStop",
                active : () => {
                    stop()
                }
            }
        ];
        for(var i=0; i<globalHotkeys.length; i++){
            console.log('Registering hotkey: '+globalHotkeys[i].key);
            globalHotkeys[i].failed = function(msg) {
                // :(, fail to register the |key| or couldn't parse the |key|.
                console.warn(msg)
            }
            globalHotkeys[i] = new nw.Shortcut(globalHotkeys[i]);
            nw.App.registerGlobalHotKey(globalHotkeys[i]);
        }
        $win.on('beforeunload', () => {
            for(var i=0; i<globalHotkeys.length; i++){
                nw.App.unregisterGlobalHotKey(globalHotkeys[i]);
            }
            console.log('Hotkeys unregistered.')
        })
        loadScripts([
            'hotkeys-actions.js'
        ], 'assets/js/ui/', () => {
            var hotkeys = Config.get('hotkeys');
            if(hotkeys && typeof(hotkeys)=='object' && typeof(hotkeysActions)=='object'){
                var args = [];
                for(var key in hotkeys){
                    if(Array.isArray(hotkeysActions[hotkeys[key]])){
                        args = hotkeysActions[hotkeys[key]];
                        args.unshift(key);
                        shortcuts.push(createShortcut.apply(createShortcut, args));  
                    }
                }
                jQuery.Shortcuts.start()
            } else {
                console.error('Error loading hotkey\'s actions.')
            }
        })
    }
}

function getActionHotkey(action, nowrap) {
    if(typeof(hotkeysActions) != 'undefined' && typeof(hotkeysActions[action]) == 'string'){
        if(nowrap) {
            return hotkeysActions[action][0];
        }
        return ' (' + hotkeysActions[action][0] + ')';
    }
    return '';
}

function setPriority(priority, pid, cb){
    /*
    idle: 64 (or "idle")
    below normal: 16384 (or "below normal")
    normal: 32 (or "normal")
    above normal: 32768 (or "above normal")
    high priority: 128 (or "high priority")
    real time: 256 (or "realtime")
    */
    var callback = (err, output) => {
        if(err){
            console.error(err)
        }
        if(typeof(cb) == 'function'){
            cb(err, output)
        }
    }
    if(process.platform == 'win32'){
        require('child_process').exec('wmic process where processid='+(pid||process.pid)+' CALL setpriority "'+priority+'"', callback)
    } else {
        if(typeof(cb) =='function'){
            cb('Not win32', '')
        }
    }
}

function getHash(file, cb){
    if(typeof($crypto) == 'undefined'){
        $crypto = require('crypto') 
    }
    fs.exists(file, exists => {
        if(exists){
            fs.createReadStream(file).
                pipe($crypto.createHash('sha1').setEncoding('hex')).
                on('finish', function () { // no arrow function here
                    cb(this.read()) //the hash
                })
        } else {
            cb('')
        }
    })
}

function setupEventForwarding(fromDocument, to){
    var ctrlProp = '_keyboardForwarding';
    if(!to){
        to = top.document;
    }
    if(fromDocument != to){
        if(typeof(fromDocument[ctrlProp])=='undefined'){
            fromDocument[ctrlProp] = true;
            if(to.defaultView){
                ['contextmenu', 'keypress', 'keydown', 'keyup', 'mousemove', 'mouseover', 'mouseout', 'mousedown', 'mousemove', 'click'].forEach(eventName => {
                    fromDocument.addEventListener(eventName, (e) => {
                        let evt = new to.defaultView.Event(eventName, {
                            "bubbles": true, 
                            "cancelable": true
                        })
                        for(var propName in e){
                            if(typeof(e[propName]) != 'function'){
                                evt[propName] = e[propName]
                            }
                        }
                        to.defaultView.document.body.dispatchEvent(evt)                        
                        e.stopPropagation()
                        e.preventDefault()
                    }) 
                })
            } else {
                console.error('Event forwarding failure, no defaultView', to, to.defaultView)
            }
            console.log('Event forwarding from '+basename(fromDocument.URL, true))
        } else {
            console.log('Event already forwarding from '+basename(fromDocument.URL, true))
        }
    }
}

function centralizedResizeWindow(w, h, animate){
    var tw = window.top;
    if(tw){
        var t = (screen.availHeight - h) / 2, l = (screen.availWidth - w) / 2;
        if(animate){
            var initialTop = top.win.y;
            var initialLeft = top.win.x;
            var initialWidth = tw.outerWidth;
            var initialHeight = tw.outerHeight;
            jQuery({percent: 0}).animate({percent: 100}, {
                step: (percent) => { 
                    var width = initialWidth + (percent * ((w - initialWidth) / 100)), height = initialHeight + (percent * ((h - initialHeight) / 100));
                    var top = initialTop + (percent * ((t - initialTop) / 100)), left = initialLeft + (percent * ((l - initialLeft) / 100));
                    //console.log('resize', top, left, width, height);
                    tw.moveTo(left, top);
                    tw.resizeTo(width, height)
                }
            })
        } else {
            // console.log('resize', t, l, w, h);
            tw.resizeTo(w, h);
            tw.moveTo(l, t)
        }
    }
}

function trimChar(string, charToRemove) {
    while(string.charAt(0)==charToRemove) {
        string = string.substring(1);
    }
    while(string.charAt(string.length-1)==charToRemove) {
        string = string.substring(0,string.length-1);
    }
    return string;
}

var spawn;
function getMediaInfo(path, callback){
    if(!spawn){
        spawn = require('child_process').spawn
    }
    var data = '', debug = debugAllow(false)
    var child = spawn(FFmpegPath, [
        '-i', forwardSlashes(path)
    ])
    child.stdout.on('data', function(chunk) {
        data += String(chunk)
    })
    child.stderr.on('data', function(chunk) {
        data += String(chunk)
    })
    child.stderr.on('error', function(err) {
        console.error('getMediaInfo', err, data)
    })
    var timeout = setTimeout(() => {
        child.kill()
    }, 10000)
    child.on('close', (code) => {
        if(debug){
            console.log('getMediaInfo', path, fs.statSync(path), code, data)
        }
        clearTimeout(timeout)
        callback(data, code)
    })
}

function getDurationFromMediaInfo(nfo) {
    var dat = nfo.match(new RegExp('[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{2}'));
    return  dat ? hmsClockToSeconds(dat[0]) : 0;
}

function getCodecsFromMediaInfo(nfo) {
    var video = nfo.match(new RegExp("Video: ([^,\r\n]+)")), audio = nfo.match(new RegExp("Audio: ([^,\r\n]+)"))
    video = Array.isArray(video) ? video[1] : ''
    audio = Array.isArray(audio) ? audio[1] : ''
    return {video, audio}
}

function getFileBitrate(file, cb, length){
    var next = () => {
        getMediaInfo(file, (nfo) => {
            //console.warn('NFO', nfo);
            var codecs = getCodecsFromMediaInfo(nfo)
            var secs = getDurationFromMediaInfo(nfo)
            if(secs){
                //console.warn('NFO', secs, length, length / secs);
                if(secs){
                    cb(null, parseInt(length / secs), codecs)
                } else {
                    cb('Failed to get duration for '+file, 0, codecs)
                }
            } else {
                cb('FFmpeg unable to process '+file, 0, codecs)
            }
        })
    }
    if(length){
        next()
    } else {
        fs.stat(file, (err, stat) => {
            if(err) { 
                cb('File not found or empty.', 0, false)
            } else {
                length = stat.size;
                next()
            }
        })
    }
}

function hmsClockToSeconds(str) {
    var cs = str.split('.'), p = cs[0].split(':'), s = 0, m = 1;    
    while (p.length > 0) {
        s += m * parseInt(p.pop(), 10);
        m *= 60;
    }    
    if(cs.length > 1 && cs[1].length >= 2){
        s += parseInt(cs[1].substr(0, 2)) / 100;
    }
    return s;
}

function hmsSecondsToClock(secs) {
    var sec_num = parseInt(secs, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);    
    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

function createDateAsUTC(date) {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()));
}

function convertDateToUTC(date) { 
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()); 
}

function arrayMin(arr) {
    var len = arr.length, min = arr[0] || '';
    while (len--) {
        if (arr[len] < min) {
        min = arr[len];
        }
    }
    return min;
}
    
function arrayMax(arr) {
    var len = arr.length, max = arr[0] || '';
    while (len--) {
        if (arr[len] > max) {
        max = arr[len];
        }
    }
    return max;
}

var b = jQuery(top.document).find('body');

function wait(checker, callback){
    var r = checker();
    if(r){
        callback(r)
    } else {
        setTimeout(() => {
            wait(checker, callback)
        }, 250);
    }
}

function getDomain(u){
    if(u && u.indexOf('//')!=-1){
        var domain = u.split('//')[1].split('/')[0];
        if(domain == 'localhost' || domain.indexOf('.') != -1){
            return domain.split(':')[0]
        }
    }
    return ''
}

function getProto(u){
    var pos = u.indexOf('://');
    if(pos != -1){
        var proto = u.substr(0, pos).toLowerCase();
        return proto;
    }
    if(u.substr(0, 2)=='//'){
        return 'http';
    }
    return false;
}

function extractURLs(val){
    var urls = [], lines = val.split("\n");
    for(var i=0; i<lines.length; i++){
        if(lines[i].match(new RegExp('^(//|https?:)'))){
            urls.push(lines[i]);
        }
    }
    return urls;
}

function dateStamp(){
    var d = new Date();
    return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0" + d.getDate()).slice(-2) + " " + ("0" + d.getHours()).slice(-2) + "-" + ("0" + d.getMinutes()).slice(-2);
}

function nl2br (str) {
    var breakTag = '<br />';
    return (str + '').replace(/([^>\r\n]?)(\r\n|\n\r|\r|\n)/g, '$1' + breakTag + '$2');
}

function stripHTML(html){
    return html.replace(new RegExp('<\\/?[^>]+>', 'g'), ' ').replace(new RegExp('[ \r\n\t]+', 'g'), ' ').trim()
}

function fixUTF8(str) {
    return String(str)
    // U+20AC  0x80  € â‚¬   %E2 %82 %AC
    .replace(/â‚¬/g, '€')
    // U+201A  0x82  ‚ â€š   %E2 %80 %9A
    .replace(/â€š/g, '‚')
    // U+0192  0x83  ƒ Æ’  %C6 %92
    .replace(/Æ’/g, 'ƒ')
    // U+201E  0x84  „ â€ž   %E2 %80 %9E
    .replace(/â€ž/g, '„')
    // U+2026  0x85  … â€¦   %E2 %80 %A6
    .replace(/â€¦/g, '…')
    // U+2020  0x86  † â€  %E2 %80 %A0
    .replace(/â€\u00A0/g, '†')
    // U+2021  0x87  ‡ â€¡   %E2 %80 %A1
    .replace(/â€¡/g, '‡')
    // U+02C6  0x88  ˆ Ë†  %CB %86
    .replace(/Ë†/g, 'ˆ')
    // U+2030  0x89  ‰ â€°   %E2 %80 %B0
    .replace(/â€°/g, '‰')
    // U+0160  0x8A  Š Å   %C5 %A0
    .replace(/Å\u00A0/g, 'Š')
    // U+2039  0x8B  ‹ â€¹   %E2 %80 %B9
    .replace(/â€¹/g, '‹')
    // U+0152  0x8C  Œ Å’  %C5 %92
    .replace(/Å’/g, 'Œ')
    // U+017D  0x8E  Ž Å½  %C5 %BD
    .replace(/Å½/g, 'Ž')
    // U+2018  0x91  ‘ â€˜   %E2 %80 %98
    .replace(/â€˜/g, '‘')
    // U+2019  0x92  ’ â€™   %E2 %80 %99
    .replace(/â€™/g, '’')
    // U+201C  0x93  “ â€œ   %E2 %80 %9C
    .replace(/â€œ/g, '“')
    // U+201D  0x94  ” â€  %E2 %80 %9D
    .replace(/â€\u009D/g, '”')
    // U+2022  0x95  • â€¢   %E2 %80 %A2
    .replace(/â€¢/g, '•')
    // U+2013  0x96  – â€“   %E2 %80 %93
    .replace(/â€“/g, '–')
    // U+2014  0x97  — â€”   %E2 %80 %94
    .replace(/â€”/g, '—')
    // U+02DC  0x98  ˜ Ëœ  %CB %9C
    .replace(/Ëœ/g, '˜')
    // U+2122  0x99  ™ â„¢   %E2 %84 %A2
    .replace(/â„¢/g, '™')
    // U+0161  0x9A  š Å¡  %C5 %A1
    .replace(/Å¡/g, 'š')
    // U+203A  0x9B  › â€º   %E2 %80 %BA
    .replace(/â€º/g, '›')
    // U+0153  0x9C  œ Å“  %C5 %93
    .replace(/Å“/g, 'œ')
    // U+017E  0x9E  ž Å¾  %C5 %BE
    .replace(/Å¾/g, 'ž')
    // U+0178  0x9F  Ÿ Å¸  %C5 %B8
    .replace(/Å¸/g, 'Ÿ')
    // U+00A0  0xA0    Â   %C2 %A0
    .replace(/Â /g, ' ')
    // U+00A1  0xA1  ¡ Â¡  %C2 %A1
    .replace(/Â¡/g, '¡')
    // U+00A2  0xA2  ¢ Â¢  %C2 %A2
    .replace(/Â¢/g, '¢')
    // U+00A3  0xA3  £ Â£  %C2 %A3
    .replace(/Â£/g, '£')
    // U+00A4  0xA4  ¤ Â¤  %C2 %A4
    .replace(/Â¤/g, '¤')
    // U+00A5  0xA5  ¥ Â¥  %C2 %A5
    .replace(/Â¥/g, '¥')
    // U+00A6  0xA6  ¦ Â¦  %C2 %A6
    .replace(/Â¦/g, '¦')
    // U+00A7  0xA7  § Â§  %C2 %A7
    .replace(/Â§/g, '§')
    // U+00A8  0xA8  ¨ Â¨  %C2 %A8
    .replace(/Â¨/g, '¨')
    // U+00A9  0xA9  © Â©  %C2 %A9
    .replace(/Â©/g, '©')
    // U+00AA  0xAA  ª Âª  %C2 %AA
    .replace(/Âª/g, 'ª')
    // U+00AB  0xAB  « Â«  %C2 %AB
    .replace(/Â«/g, '«')
    // U+00AC  0xAC  ¬ Â¬  %C2 %AC
    .replace(/Â¬/g, '¬')
    // U+00AD  0xAD  ­ Â­  %C2 %AD
    .replace(/Â­/g, '­')
    // U+00AE  0xAE  ® Â®  %C2 %AE
    .replace(/Â®/g, '®')
    // U+00AF  0xAF  ¯ Â¯  %C2 %AF
    .replace(/Â¯/g, '¯')
    // U+00B0  0xB0  ° Â°  %C2 %B0
    .replace(/Â°/g, '°')
    // U+00B1  0xB1  ± Â±  %C2 %B1
    .replace(/Â±/g, '±')
    // U+00B2  0xB2  ² Â²  %C2 %B2
    .replace(/Â²/g, '²')
    // U+00B3  0xB3  ³ Â³  %C2 %B3
    .replace(/Â³/g, '³')
    // U+00B4  0xB4  ´ Â´  %C2 %B4
    .replace(/Â´/g, '´')
    // U+00B5  0xB5  µ Âµ  %C2 %B5
    .replace(/Âµ/g, 'µ')
    // U+00B6  0xB6  ¶ Â¶  %C2 %B6
    .replace(/Â¶/g, '¶')
    // U+00B7  0xB7  · Â·  %C2 %B7
    .replace(/Â·/g, '·')
    // U+00B8  0xB8  ¸ Â¸  %C2 %B8
    .replace(/Â¸/g, '¸')
    // U+00B9  0xB9  ¹ Â¹  %C2 %B9
    .replace(/Â¹/g, '¹')
    // U+00BA  0xBA  º Âº  %C2 %BA
    .replace(/Âº/g, 'º')
    // U+00BB  0xBB  » Â»  %C2 %BB
    .replace(/Â»/g, '»')
    // U+00BC  0xBC  ¼ Â¼  %C2 %BC
    .replace(/Â¼/g, '¼')
    // U+00BD  0xBD  ½ Â½  %C2 %BD
    .replace(/Â½/g, '½')
    // U+00BE  0xBE  ¾ Â¾  %C2 %BE
    .replace(/Â¾/g, '¾')
    // U+00BF  0xBF  ¿ Â¿  %C2 %BF
    .replace(/Â¿/g, '¿')
    // U+00C0  0xC0  À Ã€  %C3 %80
    .replace(/Ã€/g, 'À')
    // U+00C2  0xC2  Â Ã‚  %C3 %82
    .replace(/Ã‚/g, 'Â')
    // U+00C3  0xC3  Ã Ãƒ  %C3 %83
    .replace(/Ãƒ/g, 'Ã')
    // U+00C4  0xC4  Ä Ã„  %C3 %84
    .replace(/Ã„/g, 'Ä')
    // U+00C5  0xC5  Å Ã…  %C3 %85
    .replace(/Ã…/g, 'Å')
    // U+00C6  0xC6  Æ Ã†  %C3 %86
    .replace(/Ã†/g, 'Æ')
    // U+00C7  0xC7  Ç Ã‡  %C3 %87
    .replace(/Ã‡/g, 'Ç')
    // U+00C8  0xC8  È Ãˆ  %C3 %88
    .replace(/Ãˆ/g, 'È')
    // U+00C9  0xC9  É Ã‰  %C3 %89
    .replace(/Ã‰/g, 'É')
    // U+00CA  0xCA  Ê ÃŠ  %C3 %8A
    .replace(/ÃŠ/g, 'Ê')
    // U+00CB  0xCB  Ë Ã‹  %C3 %8B
    .replace(/Ã‹/g, 'Ë')
    // U+00CC  0xCC  Ì ÃŒ  %C3 %8C
    .replace(/ÃŒ/g, 'Ì')
    // U+00CD  0xCD  Í Ã   %C3 %8D
    .replace(/Ã\u008D/g, 'Í')
    // U+00CE  0xCE  Î ÃŽ  %C3 %8E
    .replace(/ÃŽ/g, 'Î')
    // U+00CF  0xCF  Ï Ã   %C3 %8F
    .replace(/Ã\u008F/g, 'Ï')
    // U+00D0  0xD0  Ð Ã   %C3 %90
    .replace(/Ã\u0090/g, 'Ð')
    // U+00D1  0xD1  Ñ Ã‘  %C3 %91
    .replace(/Ã‘/g, 'Ñ')
    // U+00D2  0xD2  Ò Ã’  %C3 %92
    .replace(/Ã’/g, 'Ò')
    // U+00D3  0xD3  Ó Ã“  %C3 %93
    .replace(/Ã“/g, 'Ó')
    // U+00D4  0xD4  Ô Ã”  %C3 %94
    .replace(/Ã”/g, 'Ô')
    // U+00D5  0xD5  Õ Ã•  %C3 %95
    .replace(/Ã•/g, 'Õ')
    // U+00D6  0xD6  Ö Ã–  %C3 %96
    .replace(/Ã–/g, 'Ö')
    // U+00D7  0xD7  × Ã—  %C3 %97
    .replace(/Ã—/g, '×')
    // U+00D8  0xD8  Ø Ã˜  %C3 %98
    .replace(/Ã˜/g, 'Ø')
    // U+00D9  0xD9  Ù Ã™  %C3 %99
    .replace(/Ã™/g, 'Ù')
    // U+00DA  0xDA  Ú Ãš  %C3 %9A
    .replace(/Ãš/g, 'Ú')
    // U+00DB  0xDB  Û Ã›  %C3 %9B
    .replace(/Ã›/g, 'Û')
    // U+00DC  0xDC  Ü Ãœ  %C3 %9C
    .replace(/Ãœ/g, 'Ü')
    // U+00DD  0xDD  Ý Ã   %C3 %9D
    .replace(/Ã\u009D/g, 'Ý')
    // U+00DE  0xDE  Þ Ãž  %C3 %9E
    .replace(/Ãž/g, 'Þ')
    // U+00DF  0xDF  ß ÃŸ  %C3 %9F
    .replace(/ÃŸ/g, 'ß')
    // U+00E0  0xE0  à Ã   %C3 %A0
    .replace(/Ã\u00A0/g, 'à')
    // U+00E1  0xE1  á Ã¡  %C3 %A1
    .replace(/Ã¡/g, 'á')
    // U+00E2  0xE2  â Ã¢  %C3 %A2
    .replace(/Ã¢/g, 'â')
    // U+00E3  0xE3  ã Ã£  %C3 %A3
    .replace(/Ã£/g, 'ã')
    // U+00E4  0xE4  ä Ã¤  %C3 %A4
    .replace(/Ã¤/g, 'ä')
    // U+00E5  0xE5  å Ã¥  %C3 %A5
    .replace(/Ã¥/g, 'å')
    // U+00E6  0xE6  æ Ã¦  %C3 %A6
    .replace(/Ã¦/g, 'æ')
    // U+00E7  0xE7  ç Ã§  %C3 %A7
    .replace(/Ã§/g, 'ç')
    // U+00E8  0xE8  è Ã¨  %C3 %A8
    .replace(/Ã¨/g, 'è')
    // U+00E9  0xE9  é Ã©  %C3 %A9
    .replace(/Ã©/g, 'é')
    // U+00EA  0xEA  ê Ãª  %C3 %AA
    .replace(/Ãª/g, 'ê')
    // U+00EB  0xEB  ë Ã«  %C3 %AB
    .replace(/Ã«/g, 'ë')
    // U+00EC  0xEC  ì Ã¬  %C3 %AC
    .replace(/Ã¬/g, 'ì')
    // U+00ED  0xED  í Ã­  %C3 %AD
    .replace(/Ã\u00AD/g, 'í')
    // U+00EE  0xEE  î Ã®  %C3 %AE
    .replace(/Ã®/g, 'î')
    // U+00EF  0xEF  ï Ã¯  %C3 %AF
    .replace(/Ã¯/g, 'ï')
    // U+00F0  0xF0  ð Ã°  %C3 %B0
    .replace(/Ã°/g, 'ð')
    // U+00F1  0xF1  ñ Ã±  %C3 %B1
    .replace(/Ã±/g, 'ñ')
    // U+00F2  0xF2  ò Ã²  %C3 %B2
    .replace(/Ã²/g, 'ò')
    // U+00F3  0xF3  ó Ã³  %C3 %B3
    .replace(/Ã³/g, 'ó')
    // U+00F4  0xF4  ô Ã´  %C3 %B4
    .replace(/Ã´/g, 'ô')
    // U+00F5  0xF5  õ Ãµ  %C3 %B5
    .replace(/Ãµ/g, 'õ')
    // U+00F6  0xF6  ö Ã¶  %C3 %B6
    .replace(/Ã¶/g, 'ö')
    // U+00F7  0xF7  ÷ Ã·  %C3 %B7
    .replace(/Ã·/g, '÷')
    // U+00F8  0xF8  ø Ã¸  %C3 %B8
    .replace(/Ã¸/g, 'ø')
    // U+00F9  0xF9  ù Ã¹  %C3 %B9
    .replace(/Ã¹/g, 'ù')
    // U+00FA  0xFA  ú Ãº  %C3 %BA
    .replace(/Ãº/g, 'ú')
    // U+00FB  0xFB  û Ã»  %C3 %BB
    .replace(/Ã»/g, 'û')
    // U+00FC  0xFC  ü Ã¼  %C3 %BC
    .replace(/Ã¼/g, 'ü')
    // U+00FD  0xFD  ý Ã½  %C3 %BD
    .replace(/Ã½/g, 'ý')
    // U+00FE  0xFE  þ Ã¾  %C3 %BE
    .replace(/Ã¾/g, 'þ')
    // U+00FF  0xFF  ÿ Ã¿  %C3 %BF
    .replace(/Ã¿/g, 'ÿ')
}

function kfmt(num, digits) {
    var si = [
        { value: 1, symbol: "" },
        { value: 1E3, symbol: "K" },
        { value: 1E6, symbol: "M" },
        { value: 1E9, symbol: "G" },
        { value: 1E12, symbol: "T" },
        { value: 1E15, symbol: "P" },
        { value: 1E18, symbol: "E" }
    ];
    var rx = /\.0+$|(\.[0-9]*[1-9])0+$/;
    var i;
    for (i = si.length - 1; i > 0; i--) {
        if (num >= si[i].value) {
        break;
        }
    }
    return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol;
}

function isMiniPlayerActive(){
    if(top && typeof(top.miniPlayerActive) != 'undefined'){
        return top.miniPlayerActive;
    }
}

var appNameCaching = false;
function appName(){
    var title = appNameCaching || 'Megacubo';
    try {
        var t = nw.App.manifest.window.title;
        if(t){
            appNameCaching = title = t;
        }
    } catch(e) {}
    return applyFilters('appName', title)
}

function stylizer(cssCode, id, scope){
    if(scope && scope.document){
        try {
            //console.log(cssCode);
            //console.warn('style creating');
            var s = scope.document.getElementById("stylize-"+id);
            if(!s){
                console.warn('style created');
                s = scope.document.createElement("style");
                s.type = "text/css";
                s.id = "stylize-"+id;
            }
            s.innerText = '';
            s.appendChild(scope.document.createTextNode(cssCode));
            scope.document.querySelector("head, body").appendChild(s)
            //console.warn('style created OK', scope, scope.document.URL, cssCode, s)
        } catch(e) {
            console.log('CSS Error', e, cssCode)
        }
    }
}

function isValidPath(url){ // poor checking for now
    if(url.indexOf('/') == -1 && url.indexOf('\\') == -1){
        return false;
    }
    return true;
}

function checkFilePermission(file, mask, cb){ // https://stackoverflow.com/questions/11775884/nodejs-file-permissions
    fs.stat(file, function (error, stats){
        if (error){
            cb (error, false);
        } else {
            var v = false;
            try {
                v = !!(mask & parseInt ((stats.mode & parseInt ("777", 8)).toString (8)[0]));
            } catch(e) {
                console.error(e)
            }
            cb (null, v)
        }
    })
}

function isDir(path){
    var isFolder = false;
    try{
        isFolder = fs.lstatSync(path).isDirectory()
    } catch(e) {
        isFolder = false;
    }
    return isFolder;
}

function isWritable(_path, cb){
    var isFolder = isDir(_path);
    if(isFolder){
        var testFile = _path + path.sep + 'test.tmp';
        fs.writeFile(testFile, '1', (err) => {
            if (err){
                cb(null, false)
            } else {
                cb(null, true)
            }
            fs.unlink(testFile, jQuery.noop)
        })
    } else {
        checkFilePermission(_path, 2, cb)
    }
}

function filesize(filename) {
    const stats = fs.statSync(filename);
    const fileSizeInBytes = stats.size;
    return fileSizeInBytes;
}

function copyFile(source, target, cb) {
    if(typeof(cb) != 'function') {
        cb = jQuery.noop
    }
    var cbCalled = false;
    var done = function (err) {
        if (!cbCalled) {
            if(typeof(err)=='undefined' && typeof(cb)=='function'){
                err = false;
            }
            cb(err);
            cbCalled = true;
        }
    }
    var rd = fs.createReadStream(source);
    rd.on("error", function(err) {
        done(err)
    })
    var wr = fs.createWriteStream(target);
    wr.on("error", function(err) {
        done(err)
    })
    wr.on("close", function(ex) {
        done()
    })
    rd.pipe(wr)
}

function createShortcut(key, callback, type, enableInInput){
    key = key.replaceAll(' ', ',');
    return jQuery.Shortcuts.add({
        type: type ? type : 'down',
        mask: key,
        enableInInput: !!enableInInput,
        handler: () => {
            console.log(key+' pressed', document.URL)
            callback.call(window.top)
        }
    })
}

addAction('appLoad', setupShortcuts)

function currentStream(){
    var ret = false;
    try {
        ret = top.Playback.active.entry;
    } catch(e) {

    }
    return ret;
}

function isSandboxLoading(){
    var c = (top || parent);
    var stream = c.currentSandboxStreamArgs;
    console.log('isSandboxLoading', c.currentSandboxTimeoutTimer, top.document.querySelector('iframe#sandbox').src, stream);
    return c.currentSandboxTimeoutTimer && (top.document.querySelector('iframe#sandbox').src == stream[0].url);
}

var installedVersion = 0;
function getManifest(callback){
    jQuery.get('package.json', function (data){
        if(typeof(data)=='string'){
            data = data.replace(new RegExp('/\\* .+ \\*/', 'gm'), '');
            data = JSON.parse(data.replaceAll("\n", ""))
        }
        console.log(data);
        if(data && data.version){
            installedVersion = data.version;
        }
        callback(data)
    })
}
    
function spawnOut(options, callback){
    var data = nw.App.manifest.window;
    var disallow = 'avoidthisparameter'.split('|');
    for(var k in data){
        if(disallow.indexOf(k)!=-1){
            delete data[k];
        }
    }
    nw.Window.open('/app.html', data, function (popWin){
        if(callback){
            callback(popWin)
        }
        popWin.closeDevTools()
    })
    stop()
}

var imageCheckingCache = {}

function checkImage(url, load, error, timeout){
    if(url.indexOf('/') == -1){
        return error()
    }
    if(typeof(imageCheckingCache[url])=='boolean'){
        return (imageCheckingCache[url]?load:error)()        
    }
    var solved
    if(!timeout){
        timeout = 30
    }
    setTimeout(() => {
        delete _testImageObject
        if(!solved){
            imageCheckingCache[url] = false
            solved = true
            error()
        }
    }, timeout * 1000)
    let _testImageObject = new Image()
    _testImageObject.onerror = () => {
        imageCheckingCache[url] = false
        delete _testImageObject
        if(!solved){
            solved = true
            error()
        }
    }
    _testImageObject.onload = () => {
        imageCheckingCache[url] = true
        delete _testImageObject
        if(!solved){
            solved = true
            load()
        }
    }
    _testImageObject.src = url
}

function applyIcon(icon){
    if(top){
        var doc = top.document;
        var link = doc.querySelector("link[rel*='icon']") || doc.createElement('link');
        link.type = 'image/x-png';
        link.rel = 'shortcut icon';
        link.href = icon;
        doc.getElementsByTagName('head')[0].appendChild(link);
        var c = doc.querySelector('.nw-cf-icon');
        if(c) {
            c.style.backgroundImage = 'url("{0}")'.format(icon)
        }
    }
}

function wordWrapPhrase(str, count, sep){
    var ret = '', sts = String(str).split(' '), wordsPerLine = Math.ceil(sts.length / count);
    for(var i=0; i<count; i++){
        if(i){
            ret += sep;
        }
        ret += sts.slice(i * wordsPerLine, (i * wordsPerLine) + wordsPerLine).join(' ');
    }
    return ret;
}

function copyRecursiveSync(src, dest) {
    var exists = fs.existsSync(src);
    var stats = exists && fs.statSync(src);
    var isDirectory = exists && stats.isDirectory();
    if (exists && isDirectory) {
        fs.mkdirSync(dest);
        fs.readdirSync(src).forEach(function(childItemName) {
        copyRecursiveSync(path.join(src, childItemName),
                            path.join(dest, childItemName))
        });
    } else {
        fs.linkSync(src, dest)
    }
}

parseURL = (() => {
    const parser = document.createElement("a");
    return (url) => {
        url = url.replace(/\s+/g, '');
        parser.href = url;
        const queries = parser.search
            .replace(/^\?/, "")
            .split("&")
            .map(item => item.split('='))
            .reduce((prev, curr) => ({
            ...prev,
            [curr[0]]: curr[1],
            }), {});            
        return {
            protocol: parser.protocol,
            host: parser.host,
            hostname: parser.hostname,
            port: parser.port,
            pathname: parser.pathname,
            path: parser.pathname,
            hash: parser.hash,
            queries
        }
    }
})()

var notifyTimer = 0, notifyDebug = false
function notifyParseTime(secs){
    switch(secs){
        case 'short':
            secs = 1;
            break;
        case 'normal':
            secs = 4;
            break;
        case 'long':
            secs = 7;
            break;
        case 'wait':
        case 'forever':
            secs = 0;
            break;
    }
    return secs;
}

function notifyRemove(str){
    var o = window.top || window.parent;
    if(o){
        if(notifyDebug){
            console.log('notifyRemove', 'pending', traceback())
        }
        var a = jQuery(o.document.getElementById('notify-area'));
        a.find('.notify-row').filter((i, o) => {
            return jQuery(o).find('div').text().trim().indexOf(str) != -1;
        }).hide()
    }
}

function setupNotify(){
    if(top == window && typeof(setupNotifyDone)=='undefined') {
        setupNotifyDone = true;
        var timer, atts = {attributes: true, childList: true, characterData: true, subtree:true}, na = jQuery('#notify-area'), jb = $body, observer = new MutationObserver((mutations) => {
            observer.disconnect(); // ensure prevent looping
            if(timer){
                clearTimeout(timer)
            }
            var delay = 10;
            var o = window.top || window.parent;
            if(o){
                var nrs = jQuery(o.document).find('div.notify-row:visible');
                var f = nrs.eq(0);
                if(!f.hasClass('notify-first')){
                    f.addClass('notify-first')
                }
                nrs.slice(1).filter('.notify-first').removeClass('notify-first');
                na[na.height() >= 20 ? 'show' : 'hide']()
            }
            var show = na.height() >= 20;
            na[show ? 'show' : 'hide']();
            jb[show ? 'addClass' : 'removeClass']('notify');
            observer.observe(na.get(0), atts)
        });
        observer.observe(na.get(0), atts)
    }
}

var lastNotifyCall = null;
function notify(str, fa, secs, eternal){
    if((str + fa) == lastNotifyCall){ // tricky, avoid doubled calls
        return;
    }
    if(notifyDebug){
        console.log('[notify] NEW NOTIFY', str, fa, secs, eternal)
    }
    if(str == Lang.NOT_FOUND){
        console.error(str, traceback())
    }
    setupNotify();
    lastNotifyCall = (str + fa);
    var o = window.top || window.parent;
    if(o && o.document){
        if(notifyDebug){
            console.log('[notify] NEW NOTIFY', str, fa, secs, eternal)
        }
        var _fa = fa, a = o.document.getElementById('notify-area');
        if(a){
            if(notifyDebug){
                console.log('[notify] NEW NOTIFY', str, fa, secs, eternal)
            }
            a = jQuery(a);
            if(!str) {
                a.find('.notify-wait').hide();
                return;
            }
            var c = '', timer;
            if(a){
                if(notifyDebug){
                    console.log('[notify] NEW NOTIFY', str, fa, secs, eternal)
                }
                if(secs == 'wait'){
                    c += ' notify-wait';
                }
                secs = notifyParseTime(secs);
                if(notifyDebug){
                    console.log('[notify] NEW NOTIFY', str, fa, secs, eternal)
                }
                a.find('.notify-row').filter((i, o) => {
                    return jQuery(o).find('div').text().trim() == str;
                }).remove();
                var lastFA = _fa;
                if(_fa){
                    if(_fa.indexOf('/') != -1){
                        _fa = '<span class="notify-icon" style="background-image:url({0});"></span> '.format(fa.replaceAll('"', ''))
                    } else if(_fa.indexOf('fa-mega') != -1) {
                        _fa = '<i class="{0} notify-icon" style="display: inline-block !important;" aria-hidden="true"></i> '.format(fa)
                    } else {
                        _fa = '<i class="fa {0} notify-icon" aria-hidden="true"></i> '.format(fa)
                    }
                }
                var n = jQuery('<div class="notify-row '+c+' notify-first" style="position: relative; left: 40px; opacity: 0.01;"><div class="notify">' + _fa + '<span class="notify-text">' + str + '</span></div></div>');
                n.prependTo(a);
                var destroy = () => {
                    if(notifyDebug){
                        console.log('[notify] DESTROY', traceback())
                    }
                    if(lastNotifyCall == (str + fa)){
                        lastNotifyCall = '';
                    }
                    //console.log('DESTROY');
                    var ok, ms = 400, cb = () => {
                        if(!ok){
                            ok = true;
                            //console.log('DESTROY');
                            if(eternal){
                                //console.log('DESTROY');
                                top.nn = n;
                                n.hide()
                            } else {
                                n.remove()
                            }
                        }
                    }
                    n.stop().animate({left: 40, opacity: 0.01}, ms, cb);
                    setTimeout(cb, ms + 200);
                    //console.log('DESTROY')
                };
                var getElement = () => {
                    if(!(n && n.parent() && n.parent().parent())){
                        n = notify(str, fa, secs)
                    }
                    return n;
                }
                timer = 0
                if(secs){
                    timer = top.setTimeout(destroy, secs * 1000)
                }
                if(notifyDebug){
                    console.log('[notify] NEW NOTIFY', n.html(), secs, n.css('display'))
                }
                n.stop().animate({left: 0, opacity: 1}, 250);
                return {
                    element: () => {
                        return getElement()
                    },
                    update: (str, _fa, secs, keepHidden) => {
                        lastNotifyCall = (str + _fa);
                        n = getElement();
                        if(notifyDebug){
                            console.log('[notify] UPDATE NOTIFY', n, str, _fa, secs)
                        }
                        if(_fa && _fa != lastFA) {
                            lastFA = _fa;
                            if(_fa.indexOf('/') != -1){
                                _fa = '<span class="notify-icon" style="background-image:url({0});"></span> '.format(_fa.replaceAll('"', ''))
                            } else if(_fa.indexOf('fa-mega') != -1) {
                                _fa = '<i class="{0} notify-icon" style="display: inline-block !important;" aria-hidden="true"></i> '.format(_fa)
                            } else {
                                _fa = '<i class="fa {0} notify-icon" aria-hidden="true"></i> '.format(_fa)
                            }
                            n.find('.notify').find('.notify-icon').replaceWith(_fa)
                        }
                        if(str) {
                            n.find('.notify').find('.notify-text').html(str)
                        }
                        if(secs){
                            if(!n.get(0).parentNode){
                                n.prependTo(a)
                            }
                            secs = notifyParseTime(secs)
                            clearTimeout(timer)
                            timer = 0
                            if(secs){
                                if(notifyDebug){
                                    console.warn('[notify] NOTIFY TIMEOUT SETUP', secs * 1000)
                                }
                                timer = setTimeout(() => {
                                    if(notifyDebug){
                                        console.warn('[notify] NOTIFY TIMEOUT OK', secs * 1000)
                                    }
                                    destroy()
                                }, secs * 1000)
                            }
                            if(!n.is(":visible")){
                                n.show().animate({left: 0, opacity: 1}, 250)
                            }
                        }
                        return n
                    },
                    show: () => {
                        n = getElement();
                        n.show()
                    },
                    hide: () => {
                        if(lastNotifyCall == (str + fa)){
                            lastNotifyCall = '';
                        }
                        n = getElement();
                        n.hide()
                    },
                    close: () => {
                        clearTimeout(timer);
                        destroy()
                    }
                }
            }
        }
    }
}

function replaceLast(x, y, z){
    var a = x.split("");
    a[x.lastIndexOf(y)] = z;
    return a.join("");
}

function formatBytes(bytes){
    var sizes = ['bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes == 0) return '0 bytes';
    var i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
    if (i == 0) return bytes + ' ' + sizes[i];
    return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function urldecode(t){
    t = t.replaceAll('+', ' ');
    try {
        var nt = decodeURIComponent(t.replaceAll('+', ' '));
        if(nt) {
            t = nt;
        }
    } catch(e) { }
    return t;
}   

function setHTTPHeaderInObject(header, headers){
    var lcnames = Object.keys(header).map((s) => { 
        return s.toLowerCase() 
    });
    for(var k in headers){
        var pos = lcnames.indexOf(k.toLowerCase());
        if(pos != -1){
            delete headers[lcnames[pos]];
        }
    }
    for(var k in header){
        headers[k] = header[k];
    }
    return headers;
}

function displayPrepareName(name, label, prepend, append, raw){
    if(!name){
        name = 'Unknown';
    }
    if(prepend){
        if(!raw && name.indexOf('<span')!=-1){
            name = name.replace('>', '>'+prepend+' ');
        } else {
            name = prepend+' '+name;
        }
    }
    if(append){
        if(!raw && name.indexOf('<span')!=-1){
            name = replaceLast(name, '<', ' '+append+'<');
        } else {
            name = name+' '+append;
        }
    }
    name = name.replaceAll(' - ', ' · ').replaceAll(' | ', ' · ').trim();
    if(raw){
        if(label){
            name += ' ' + label
        }
    } else {
        name += '<span class="entry-label">' + (label ? label.trim() : '') + '</span>'
    }
    return name.trim()
}

function setTitleData(title, icon) {
    console.log('TITLE = '+title)
    title = displayPrepareName(urldecode(title), '', '', '', true)
    defaultTitle = title
    if(top){
        var defaultIcon = 'default_icon.png';
        if(icon){
            applyIcon(icon)
            checkImage(icon, jQuery.noop, () => {
                applyIcon(defaultIcon)
            })
        } else {
            applyIcon(defaultIcon)
        }
        var doc = top.document
        doc.title = title
        var c = doc.querySelector('.nw-cf-title')
        if(c){
            c.innerText = title
        }
        console.log('TITLE OK')
    }
}

function componentToHex(c) {
    var hex = c.toString(16);
    return hex.length == 1 ? "0" + hex : hex;
}

function rgbToHex(r, g, b) {
    return "#" + componentToHex(r) + componentToHex(g) + componentToHex(b);
}

function hexToRgb(hex) {
    // Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
    var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
    hex = hex.replace(shorthandRegex, function(m, r, g, b) {
        return r + r + g + g + b + b;
    });

    var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function getColorLightLevelFromRGB(rgb){
    return (rgb.r + rgb.g + rgb.b ) / 7.64999;
}

function getColorLightLevel(hex){
    if(typeof(hex) == 'string') {
        hex = hexToRgb(hex);
    }
    if(!hex) return 0;
    return getColorLightLevelFromRGB(hex)
}

function getHTTPInfo(url, callback, retries){
    var timeout = 30
    if(typeof(retries) != 'number'){
        retries = 3
    }
    getHeaders(url, (h, u) => { 
        let delay = 5000, cl = h['content-length'] || -1, ct = h['content-type'] || '', st = h['status'] || 0
        if(retries && [0, 403, 502].indexOf(st) != -1){
            retries--
            return setTimeout(() => {
                getHTTPInfo(url, callback, retries)
            }, delay)
        }
        if(ct){
            ct = ct.split(',')[0].split(';')[0]
        } else {
            ct = ''
        }
        callback(ct, cl, url, u, st) // "u" is the final url, "url" the starter url
    }, timeout)
}

function hasValidTitle(){
    var title = top.document.title;
    var stream = currentStream();
    var streamTitle = stream ? stream.name : '';
    return (title && title == streamTitle && title.indexOf('Megacubo')==-1);
}

function ltrimPathBar(path){
    if(path && path.charAt(0)=='/'){
        path = path.substr(1)
    }
    return path || '';
}

function rtrimPathBar(path){
    var i = path && path.length ? path.length - 1 : 0;
    if(path && path.charAt(i)=='/'){
        path = path.substr(0, i)
    }
    return path || '';
}

function removeQueryString(url){
    return url.split('?')[0].split('#')[0];
}

function stripRootFolderFromStr(str){
    if(str.charAt(0)=='/') str = str.substr(1);
    var root = getRootFolderFromStr(str);
    str = str.substring(root.length + 1); 
    return str;
}

function getRootFolderFromStr(str){
    _str = new String(str).replaceAll('\\', '/'); 
    if(_str.charAt(0)=='/') _str = _str.substr(1);
    pos = _str.indexOf('/');
    if(pos == -1) return _str;
    _str = _str.substring(0, pos); 
    return _str;
}

function openMegaFile(file){
    var entry = megaFileToEntry(file);
    if(entry){
        var c = (top || parent);
        if(c){
            c.playEntry(entry)
        }
    }
}

function megaFileToEntry(file){
    var content = fs.readFileSync(file);
    if(content) {
        var c = (top || parent), parser = new DOMParser();
        var doc = parser.parseFromString(content, "application/xml");
        var url = jQuery(doc).find('stream').text().replaceAll('embed::', '').replaceAll('#off', '#nosandbox').replaceAll('#catalog', '#nofit');
        var name = jQuery(doc).find('stream').attr('name') || jQuery(doc).find('name').text();
        return {
            name: name,
            url: url,
            logo: c ? c.defaultIcons['stream'] : ''
        }
    }
    return false;
}

function objectifyQueryString(qs) {
    let _params = new URLSearchParams(qs);
    let query = Array.from(_params.keys()).reduce((sum, value)=>{
        return Object.assign({[value]: _params.get(value)}, sum)
    }, {});
    return query;
}

function parseMegaURL(url){
    var parts = url.split(( url.indexOf('|')!=-1 ) ? '|': '//');
    if(parts.length > 1){
        parts[0] = parts[0].split('/').pop();
        var qs = parts[1].split('?');
        qs = qs.length > 1 ? objectifyQueryString(qs[1].split('#')[0]) : {}
        switch(parts[0]){
            case 'link':
                return Object.assign({
                    name: 'Megacubo '+getDomain(parts[1]),
                    type: 'link', 
                    mediaType: 'all',
                    url: atob(parts[1])
                }, qs);
                break;
            case 'play':
                parts[1] = decodeURIComponent(parts[1]) || parts[1];
                parts[1] = parts[1].split('?')[0].split('#')[0].trim();
                if(parts[1].charAt(parts[1].length - 1) == '/'){
                    parts[1] = parts[1].substr(0, parts[1].length - 1)
                }
                return Object.assign({
                    name: parts[1],
                    type: 'play',
                    mediaType: 'all',
                    link: ''
                }, qs);
                break;
        }
    }
    return false;
}

function compareMegaURLs(url, url2){
    let a = parseMegaURL(url), b = parseMegaURL(url2)
    if(!a || !b){
        return false
    }
    return a.name == b.name
}

function isValidMegaURL(url){
    var data = parseMegaURL(url)
    if(data){
        if(data.type == 'play'){
            if(data.name.length > 2 ){
                return true;
            }
        } else if(data.type == 'link') {
            if(data.url.indexOf('/') != -1){
                return true;
            }
        }
    }
    return false;
}

function updateMegaURLQSAppend(url, qs){
    var q = [], p = url.split('?'), oqs = objectifyQueryString((p[1]||'').split('#')[0] || '');
    for(var k in qs){
        oqs[k] = qs[k];
    }
    for(var k in oqs){
        q.push(k+'='+encodeURIComponent(String(qs[k])));
    }
    return p[0]+'?'+q.join('&');
}

function forwardSlashes(file){
    return file.replaceAll('\\', '/').replaceAll('//', '/')
}

function isRadio(name){
    //console.log('NAME', name);
    var t = typeof(name);
    if(['string', 'object'].indexOf(t) != -1){
        if((t=='string' ? name : name.join(' ')).match(new RegExp('(r[aá&cute;]+dio|\\b(fm|am)\\b)', 'i'))){
            return true;
        }
    }
    return false;
}

function isM3U(url){
    if(typeof(url)!='string') return false;
    return ['m3u'].indexOf(getExt(url)) != -1;            
}

function isM3U8(url){
    if(typeof(url)!='string') return false;
    return ['m3u8'].indexOf(getExt(url)) != -1;            
}

function isTS(url){
    if(typeof(url)!='string') return false;
    return ['m2ts', 'ts'].indexOf(getExt(url)) != -1  
}

function isRemoteTS(url){
    if(typeof(url)!='string') return false;
    return isHTTP(url) && ['m2ts', 'ts'].indexOf(getExt(url)) != -1  
}

function isRTMP(url){
    if(typeof(url)!='string') return false;
    return url.match(new RegExp('^rtmp[a-z]?:', 'i'));            
}

function isHTTP(url){
    if(typeof(url)!='string') return false;
    return url.match(new RegExp('^https?:', 'i'));            
}

function isHTTPS(url){
    if(typeof(url)!='string') return false;
    return url.match(new RegExp('^https:', 'i'));            
}

function isMegaURL(url){
    if(typeof(url)!='string') return false;
    return url.substr(0, 5)=='mega:';            
}

function isYT(url){
    url = String(url);
    if(url.indexOf('youtube.com')==-1 && url.indexOf('youtu.be')==-1){
        return false;
    }
    if(typeof(ytdl)=='undefined'){
        ytdl = require('ytdl-core')
    }
    var id = ytdl.getURLVideoID(url);
    return typeof(id)=='string';
}

function hasYTDomain(url){
    var y = 'youtube.com';
    url = String(url);
    if(url.indexOf(y)==-1){
        return false;
    }
    var d = getDomain(url);
    if(d.substr(d.length - y.length) == y){
        return true;
    }
}

function isRTSP(url){
    if(typeof(url)!='string') return false;
    return url.match(new RegExp('(^(rtsp|mms)[a-z]?:)', 'i'));            
}

function isLocal(str){
    if(typeof(str) != 'string'){
        return false
    }
    if(str.match('[A-Z]:')){ // windows drive letter
        return true
    }
    if(str.substr(0, 5)=='file:'){
        return true
    }
    return fs.existsSync(str)
}

function isVideo(url){
    if(typeof(url)!='string') return false;
    return 'wma|wmv|avi|mp3|mp4|mka|mkv|m4a|m4v|mov|flv|webm|flac|aac|ogg'.split('|').indexOf(getExt(url)) != -1;            
}

function isHTML5Video(url){
    if(typeof(url)!='string') return false;
    return 'mp4|m4v|webm|ogv|ts|m2ts'.split('|').indexOf(getExt(url)) != -1;            
}

function isHTML5Audio(url){
    if(typeof(url)!='string') return false;
    return 'mp3|m4a|webm|aac|ogg|mka'.split('|').indexOf(getExt(url)) != -1;            
}

function isHTML5Media(url){
    return isHTML5Video(url) || isHTML5Audio(url)
}

function isLive(url){
    if(typeof(url)!='string') return false;
    return isM3U8(url)||isRTMP(url)||isRTSP(url)||isRemoteTS(url)
}

function isMedia(url){
    if(typeof(url)!='string') return false;
    return isLive(url)||isLocal(url)||isVideo(url)||isTS(url);            
}

function isPlaying(){
    if(top && top.Playback){
        return top.Playback.playing();
    }
}

function isStopped(){
    if(top && top.Playback){
        return !top.Playback.active;
    }
    return true;
}

function getExt(url){
    return String(url).split('?')[0].split('#')[0].split('.').pop().toLowerCase();        
}

function showPlayers(stream, sandbox){
    if(top){
        console.log('showPlayers('+stream+', '+sandbox+')', traceback())
        var doc = top.document;
        var pstream = doc.getElementById('player');
        var psandbox = doc.getElementById('sandbox');
        if(sandbox){
            jQuery(psandbox).removeClass('hide').addClass('show')
        } else {
            jQuery(psandbox).removeClass('show').addClass('hide')
        }
        if(stream){
            jQuery(pstream).removeClass('hide').addClass('show')
        } else {
            jQuery(pstream).removeClass('show').addClass('hide')
        }
    }
}

function isSandboxActive(){
    var doc = top.document;
    return (doc.getElementById('sandbox').className.indexOf('hide')==-1);
}

function isPlayerActive(){
    var doc = top.document;
    return (doc.getElementById('player').className.indexOf('hide')==-1);
}

function getFrame(id){
    if(top && top.document){
        var o = top.document.getElementById(id);
        if(o && o.contentWindow){
            return o.contentWindow.window;
        }
    }        
}

function getDefaultLocale(short, noUnderline){
    var lang = window.navigator.languages ? window.navigator.languages[0] : null;
    lang = lang || window.navigator.language || window.navigator.browserLanguage || window.navigator.userLanguage;
    if(!noUnderline){
        lang = lang.replace('-', '_');
    }
    lang = lang.substr(0, short ? 2 : 5);
    return lang;
}
    
function getLocale(short, noUnderline){
    var lang = Config.get('locale');
    if(!lang || typeof(lang)!='string'){
        lang = getDefaultLocale(short, noUnderline);
    }
    if(!noUnderline){
        lang = lang.replace('-', '_');
    }
    lang = lang.substr(0, short ? 2 : 5);
    return lang;
}

function localize(file){
    return path.join(process.cwd(), file)
}

function closest(num, arr) {
    var curr = arr[0];
    var diff = Math.abs (num - curr);
    for (var val = 0; val < arr.length; val++) {
        var newdiff = Math.abs (num - arr[val]);
        if (newdiff < diff) {
            diff = newdiff;
            curr = arr[val];
        }
    }
    return curr;
}

function removeFolder(location, itself, next) {
    location = path.resolve(location)
    console.log(itself?'REMOVING':'CLEANING', location);
    if (!next) next = jQuery.noop;
    fs.readdir(location, function(err, files) {
        async.each(files, function(file, cb) {
            file = location + '/' + file;
            fs.stat(file, function(err, stat) {
                if (err) {
                    return cb(err);
                }
                if (stat.isDirectory()) {
                    removeFolder(file, true, cb);
                }
                else {
                    fs.unlink(file, function(err) {
                        if (err) {
                            return cb(err);
                        }
                        return cb();
                    })
                }
            })
        }, function(err) {
            if(itself && !err){
                fs.rmdir(location, function(err) {
                    return next(err)
                })
            } else {
                return next(err)
            }
        })
    })
}

function mainPID(pid, cb){
    const file = Store.folder + path.sep + 'main.pid'
    if(typeof(pid) == 'number'){
        fs.writeFile(file, pid, () => {
            if(typeof(cb) == 'function'){
                cb(true)
            }
        })
    } else {
        fs.readFile(file, (err, r) => {
            r = parseInt(r)
            cb(r&&!isNaN(r)?r:false)
        })   
    }
}

function isPIDRunning(pid, cb){
    require('ps-node').lookup({
        command: 'megacubo'
    }, (err, resultList) => {
    	if (err && !(Array.isArray(resultList) && resultList.length)) {
	        cb(err, false, resultList)
	    } else {
            cb(null, resultList.some(r => { return r.pid == pid}))
        }
    })
}

function isMainPIDRunning(cb){
    mainPID(null, pid => {
        if(!pid){
            cb('PID not set')
        } else {
            isPIDRunning(pid, cb)
        }
    })
}

function traceback() { 
    try { 
        var a = {}
        a.debug()
    } catch(ex) {
        return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
    }
}

if(typeof(logErr) != 'function'){
    logErr = (...args) => {
        let log = '', a = Array.from(args)
        try {
            log += JSON.stringify(a, censor(a)) + "\r\n"
        } catch(e) { }
        log += traceback()+"\r\n\r\n"
        if(!fs){
            fs = require('fs')
        }
        if(fs.existsSync('error.log')){
            fs.appendFileSync('error.log', log)
        } else {
            fs.writeFileSync('error.log', log)
        }
    }
}

var openFileDialogChooser = false;
function openFileDialog(callback, accepts) {
    if(!openFileDialogChooser){ // JIT
        openFileDialogChooser = jQuery('<input type="file" />');
    }
    openFileDialogChooser.get(0).value = "";
    if(accepts){
        openFileDialogChooser.attr("accept", accepts)
    } else {
        openFileDialogChooser.removeAttr("accept")
    }
    openFileDialogChooser.off('change');
    openFileDialogChooser.on('change', function(evt) {
        callback(openFileDialogChooser.val());
    });    
    openFileDialogChooser.trigger('click');  
    return openFileDialogChooser;
}

var saveFileDialogChooser = false;
function saveFileDialog(callback, placeholder) {
    if(!saveFileDialogChooser){ // JIT
        saveFileDialogChooser = jQuery('<input type="file" nwsaveas />');
    }
    if(placeholder){
        saveFileDialogChooser.prop('nwsaveas', placeholder)
    }
    saveFileDialogChooser.off('change');
    saveFileDialogChooser.val('');
    saveFileDialogChooser.on('change', (evt) => {
        callback(saveFileDialogChooser.val());
    });    
    saveFileDialogChooser.trigger('click')
}

var saveFolderDialogChooser = false;
function saveFolderDialog(callback, placeholder) {
    if(!saveFolderDialogChooser){ // JIT
        saveFolderDialogChooser = jQuery('<input type="file" nwdirectory />');
    }
    if(placeholder){
        saveFolderDialogChooser.prop('nwdirectory', placeholder)
    }
    saveFolderDialogChooser.off('change');
    saveFolderDialogChooser.val('');
    saveFolderDialogChooser.on('change', (evt) => {
        callback(saveFolderDialogChooser.val());
    });    
    saveFolderDialogChooser.trigger('click')
}

//chooseFile(function (file){alert(file);window.ww=file});

function isYoutubeURL(source){
    if(typeof(source)=='string'){
        var parts = source.split('/');
        if(parts.length > 2){
            if(parts[2].match(new RegExp('youtube\.com|youtu\.be'))){
                return true;
            }
        }
    }
}

function isMagnetURL(source){
    if(typeof(source)=='string'){
        return source.substr(0, 7) == 'magnet:'
    }
}

console.log('request')

var dns = require('dns'), dnscache = require('dnscache')({
    enable: true,
    ttl: 3600,
    cachesize: 5000
})

if(window == top){
    const _request = require('request'), _crequest = require('cached-request')
    var requestJar = _request.jar()
    let defs = {
        jar: requestJar,
        headers: {'User-Agent': navigator.userAgent} // without user-agent some hosts return 403
    }
    let setup = r => {
        r = _crequest(r.defaults(defs))
        r.setValue('ttl', 3600)
        r.setCacheDirectory(GStore.folder + path.sep + 'request')
        return r
    }
    var requestForever = setup(_request.forever())
    var request = setup(_request)
} else {
    var request = top.request, requestJar = top.requestJar, requestForever = top.requestForever
}