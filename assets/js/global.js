var gui = require('nw.gui'), Menu;
    
/*
try {
    import {setInterval, clearInterval} from 'timers';
} catch(e) {
    console.error(e)
}

*/

if(global.setTimeout){
    setTimeout = global.setTimeout.bind(global);
    clearTimeout = global.clearTimeout.bind(global);
}

// prevent default behavior from changing page on dropped file
window.ondragover = function(e) { 
    if(e){
        e.preventDefault();
    }
    console.log('dragover', window);
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
};

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
    console.error('ERROR', arguments);
    logErr(arguments);
    return true;
}

if(typeof(require)!='undefined'){
        
    var availableLanguageNames = {
        en: 'English',
        es: 'Español',
        pt: 'Português',
        it: 'Italiano'
    };

    if(typeof(fs)=='undefined'){
        var fs = require("fs");
    }

    if(typeof(async)=='undefined'){
        var async = require("async");
    }

    Array.prototype.getUnique = function() {
        return [...new Set( this )];
    }

	String.prototype.replaceAll = function(search, replacement) {
		var target = this;
		if(target.indexOf(search)!=-1){
			target = target.split(search).join(replacement);
		}
		return String(target);
    }

    jQuery.ajaxSetup({ cache: false });
    
    jQuery.fn.reverse = function() {
        return this.pushStack(this.get().reverse(), arguments);
    } 

    jQuery.getMultiScripts = function(arr, path, callback) {
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
        async.parallelLimit(tasks, 1, callback)
    }

    function loadScript(url, callback){
        var script = document.createElement("script")
        script.type = "text/javascript";
        script.onload = function (){
            //console.warn('LOADED', url);
            callback();
        }
        script.onerror = function (){
            //console.warn('ERROR', url);
            callback();
        }
        script.src = url;
        document.getElementsByTagName("head")[0].appendChild(script);
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

	if (!Array.prototype.sortBy) {
        Array.prototype.sortBy = function (p, reverse) {
            return this.slice(0).sort((a,b) => {
                if(reverse) return (a[p] > b[p]) ? -1 : (a[p] < b[p]) ? 1 : 0;
                return (a[p] > b[p]) ? 1 : (a[p] < b[p]) ? -1 : 0;
            });
        }
    }

    (function($) {
        $.fn.outerHTML = function() {
          return $(this).clone().wrap('<div></div>').parent().html();
        };
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
        if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
          throw new Error('first argument must be a Blob')
        }
        if (typeof cb !== 'function') {
          throw new Error('second argument must be a function')
        }
      
        var reader = new FileReader()
      
        function onLoadEnd (e) {
          reader.removeEventListener('loadend', onLoadEnd, false)
          if (e.error) cb(e.error)
          else cb(null, Buffer.from(reader.result))
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
        var b = new Uint8Array(bytes.length);
        bytes.forEach(function (byte, index) {
            b[index] = byte;
        });
        var r = concatTypedArrays(ui8a, b);
        ui8a = null;
        b = null;
        return r;
    }

    function tag(el){
        return (el&&el.tagName)?el.tagName.toLowerCase():'';
    }

    function toArrayBuffer(buf) {
        var ab = new ArrayBuffer(buf.length);
        var view = new Uint8Array(ab);
        for (var i = 0; i < buf.length; ++i) {
            view[i] = buf[i];
        }
        return ab;
    }
    
    function toBuffer(ab) {
        var buf = new Buffer(ab.byteLength);
        var view = new Uint8Array(ab);
        for (var i = 0; i < buf.length; ++i) {
            buf[i] = view[i];
        }
        return buf;
    }

	function time(){
		return ((new Date()).getTime()/1000);
	}

	function fetchTimeout(url, callback, ms, opts){
		let didTimeOut = false;
		return new Promise(function (resolve, reject) {
			const timeout = setTimeout(function() {
				didTimeOut = true;
				reject(new Error('Request timed out'));
			}, ms);
			var contentType = false;
			fetch(url, opts).then((response) => {
				contentType = response.headers.get("content-type");
				return response.text()
			}).then((response) => {
				// Clear the timeout as cleanup
				clearTimeout(timeout);
				if(!didTimeOut) {
					resolve(response);
					callback(response, contentType)
				}
			})
			.catch(function(err) {
				console.log('fetch failed! ', err);
				if(didTimeOut) return;
				reject(err);
				callback(false, false)
			});
		}).catch(function(err) {
			// Error: response error, request timeout or runtime error
			console.log('promise error! ', url, err);
			callback(false, false)
		})
    }
    
    var resolveURL=function resolve(url, base){
        if('string'!==typeof url || !url){
            return null; // wrong or empty url
        }
        else if(url.match(/^[a-z]+\:\/\//i)){ 
            return url; // url is absolute already 
        }
        else if(url.match(/^\/\//)){ 
            return 'http:'+url; // url is absolute already 
        }
        else if(url.match(/^[a-z]+\:/i)){ 
            return url; // data URI, mailto:, tel:, etc.
        }
        else if('string'!==typeof base){
            var a=document.createElement('a'); 
            a.href=url; // try to resolve url without base  
            if(!a.pathname){ 
                return null; // url not valid 
            }
            return 'http://'+url;
        }
        else{ 
            base=resolve(base); // check base
            if(base===null){
                return null; // wrong base
            }
        }
        var a=document.createElement('a'); 
        a.href=base;    
        if(url[0]==='/'){ 
            base=[]; // rooted path
        }
        else{ 
            base=a.pathname.split('/'); // relative path
            base.pop(); 
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
        return a.protocol+'//'+a.hostname+base.join('/');
    }

    var requestForever;

    function prepareRequestForever(){
        if(!requestForever){
            requestForever = require('request').forever();
            requestForever = requestForever.defaults({
                headers: {'User-Agent': navigator.userAgent} // without user-agent some hosts return 403
            })
        }
        return requestForever;
    }
    
    function validateUrl(value) {
        return /^(?:(?:(?:https?|ftp):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
    }

    function getHeaders(url, callback, timeoutSecs){
        var start = time(), timer = 0, currentURL = url;
        if(typeof(callback)!='function'){
            callback = () => {}
        }
        if(validateUrl(url)){
            //console.warn(url, traceback());
            if(!timeoutSecs){
                timeoutSecs = 10;
            }
            var r = request(url);
            r.on('error', (response) => {
                r.abort();
                callback({}, url)
            });
            r.on('response', (response) => {
                clearTimeout(timer);
                var headers = response.headers;
                headers['status'] = response.statusCode;
                r.abort();
                if(headers['location'] && headers['location'] != url && headers['location'] != currentURL){
                    if(!headers['location'].match(new RegExp('^(//|https?://)'))){
                        headers['location'] = resolveURL(headers['location'], currentURL); 
                    }
                    currentURL = headers['location'];
                    var remainingTimeout = timeoutSecs - (time() - start);
                    if(remainingTimeout && headers['location'] != url && headers['location'] != currentURL){
                        getHeaders(headers['location'], callback, remainingTimeout)
                    } else {
                        callback(headers, url)
                    }
                } else {
                    callback(headers, url)
                }
            });
            timer = setTimeout(() => {
                r.abort();
                callback({}, url)
            }, timeoutSecs * 1000)
        } else {
            callback({}, url)
        }
    }

	function basename(str, rqs){
		_str = new String(str); 
		pos = _str.replaceAll('\\', '/').lastIndexOf('/');
		if(pos != -1){
			_str = _str.substring(pos + 1); 
		}
		if(rqs){
			_str = removeQueryString(_str);
		}
		return _str;
	}

	function dirname(str){
		_str = new String(str); 
		pos = _str.replaceAll('\\', '/').lastIndexOf('/');
		if(!pos) return '';
		_str = _str.substring(0, pos); 
		return _str;
	}

	if ( typeof WPDK_FILTERS === 'undefined' ) {
		
		// List of filters
		WPDK_FILTERS = {};
		
		// List of actions
		WPDK_ACTIONS = {};
		
		/**
		 * Used to add an action or filter. Internal use only.
		 *
		 * @param {string}   type             Type of hook, 'action' or 'filter'.
		 * @param {string}   tag              Name of action or filter.
		 * @param {Function} function_to_add  Function hook.
		 * @param {integer}  priority         Priority.
		 *
		 * @since 1.6.1
		 */
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
		
		/**
		 * Do an action or apply filters.
		 *
		 * @param {string} type Type of "do" to do 'action' or 'filter'.
		 * @param {Array} args Optional. Original list of arguments. This array could be empty for 'action'.
		 * @returns {*}
		 */
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
				var func = hook[ f ].func;
		
				if( typeof func === "function" ) {
		
					if( 'filter' === type ) {
					args[ 0 ] = func.apply( null, args );
					}
					else {
					func.apply( null, args || []);
					}
				}
				}
			}
			}
		
			if( 'filter' === type ) {
			return args[ 0 ];
			}
		
        }
        
		addFilter = function( tag, function_to_add, priority ) {
			_wpdk_add( 'filter', tag, function_to_add, priority );
		}
        
		hasFilter = function( tag, fn ) {
			return _wpdk_has( 'filter', tag, fn );
        }
		
		applyFilters = function( tag, value, varargs ) {
			return _wpdk_do( 'filter', arguments );
		}
        
		removeFilter = function( tag, fn ) {
            _wpdk_remove( 'filter', tag, fn );
        }
		
		addAction = function( tag, function_to_add, priority ) {
			_wpdk_add( 'action', tag, function_to_add, priority );
        }
        
		hasAction = function( tag, fn ) {
			return _wpdk_has( 'action', tag, fn );
        }
		
		doAction = function( tag ) {
			_wpdk_do( 'action', arguments );
        }
        
		removeAction = function( tag, fn ) {
			_wpdk_remove( 'action', tag, fn );
        }

	}

	if(typeof(fs)=='undefined'){
		var fs = require("fs");
    }

	if(typeof(path)=='undefined'){
		var path = require("path");
    }
    
	if(top == window){
		var Store = (() => {
            var dir, self = {}, cache = {};
            self.folder = (addEndSlash) => {
                if(typeof(self.cachingFolder)=='undefined'){
                    var pos = gui.App.dataPath.lastIndexOf(gui.App.manifest.name);
                    self.cachingFolder = gui.App.dataPath.substr(0, pos + gui.App.manifest.name.length)+'/Cache';
                    self.cachingFolder = path.normalize(self.cachingFolder)
                }
                return self.cachingFolder + (addEndSlash ? path.sep : '');
            }  
            self.hash = function(txt) {
                var hash = 0;
                if (txt.length == 0) {
                    return hash;
                }
                for (var i = 0; i < txt.length; i++) {
                    var char = txt.charCodeAt(i);
                    hash = ((hash<<5)-hash)+char;
                    hash = hash & hash; // Convert to 32bit integer
                }
                return hash;
            },  
			self.resolve = (key) => {
				key = key.replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '').substr();
				return dir + key.substr(0, 128) + '.json';
			}
			self.get = (key) => {
				var f = self.resolve(key), _json = null, val = null; 
				if(typeof(cache[key])!='undefined'){
					return cache[key];
				}
				if(fs.existsSync(f)){
					_json = fs.readFileSync(f, "utf8");
					if(Buffer.isBuffer(_json)){ // is buffer
						_json = String(_json);
					}
					if(typeof(_json)=='string' && _json.length){
						try {
							var r = JSON.parse(_json);
							if(r != null && typeof(r)=='object' && (r.expires === null || r.expires >= time())){
								val = r.data;
							} else {
								//console.error('Expired', r.expires+' < '+time())
							}
						} catch(e){
							console.error(e, f)
						}
					} else {
						//console.error('Bad type', typeof(_json))
					}
				} else {
					//console.error('Not found', typeof(_json))
				}
				cache[key] = val;
				return val;
			}
			self.set = (key, val, expiration) => {
                var f = self.resolve(key);
                if(expiration === true){
                    expiration = 365 * (24 * 3600); // true = for one year
                } else if(expiration === false) {
                    expiration = 0; // false = session only
                }
				try {
					if(fs.existsSync(f)){
						fs.truncateSync(f, 0)
					}
					fs.writeFileSync(f, JSON.stringify({data: val, expires: time() + expiration}), "utf8")
				} catch(e){
					console.error(e)
                }
                fs.stat(f, (err, stat) => {
                    if(err) { 
                        console.error('Caching file not found or empty.', 0, f)
                    } else {
                        if(stat.size < (56 * 1024)){ // 56kb, less than a TS size
                            cache[key] = val;
                        }
                    }
                })
			}
            dir = self.folder(true); 
			fs.stat(dir, (err, stat) => {
				if(err !== null) {
					fs.mkdir(dir, (err) => {

                    })
				}
            });
			return self;
        })();        
        
		var Config = (() => {
            var self = {
                debug: false,
                file: Store.folder(true) + 'configure.json',
                defaults: {
                    "connect-timeout": 36,
                    "gpu-rendering": true,
                    "ignore-webpage-streams": false,
                    "min-buffer-secs-before-commit": 2,
                    "play-while-tuning": false,
                    "resolution-limit": "1280x720",
                    "resume": false,
                    "search-live": true,
                    "search-range-size": 18,
                    "search-vod": false,
                    "show-adult-content": false,
                    "similar-transmissions": true,
                    "sources": [],
                    "volume": 1.0
                }
            }, loaded = false;
            self.data = Object.assign({}, self.defaults); // keep defaults object for reference
            for(var key in self.data){
                if(typeof(self.data[key]) != typeof(self.defaults[key])){
                    console.error('Invalid key value for', key, self.data[key], 'is not of type ' + typeof(self.defaults[key]));
                    self.data[key] = self.defaults[key];
                }
            }
			self.load = () => {
				loaded = true;
				if(fs.existsSync(self.file)){
					var _data = fs.readFileSync(self.file, "utf8");
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
			self.getAll = () => {
				if(!loaded){
					self.load()
                }
                var data = {};
                Object.keys(self.defaults).forEach((key) => {
                    data[key] = self.data[key] || self.defaults[key];
                });
				//console.log('GET', key);
				return data;
			}
			self.get = (key) => {
				if(!loaded){
					self.load()
				}
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
					if(jQuery.isArray(self.data[key])){ // avoid referencing
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
				self.data[key] = val;
				if(fs.existsSync(self.file)){
					fs.truncateSync(self.file, 0)
				}
                var jso = JSON.stringify(self.data, null, 4);
				fs.writeFileSync(self.file, jso, "utf8");
				if(self.debug){
                    console.log('SSSET', jso, self.data)
                }
			}
			return self;
        })();
        
        
        
        var Theme = (() => {
            var self = {
                debug: false,
                file: Store.folder(true) + 'theme.json',
                defaults: {
                    "compability": 1.1, // increment to purge default theme
                    "hide-logos": false,
                    "background": "assets/images/wallpaper.png",
                    "bg": "linear-gradient(to top, #000004 0%, #150055 75%)",
                    "bgcolor": "#150055",
                    "bgcolor-playing": "#000000",
                    "fgcolor": "#FFFFFF",
                    "font-size": 0.94,
                    "hide-back-button": false,
                    "hide-menu-auto": false,
                    "icon-size": 24,
                    "logo": "default_icon.png",
                    "menu-entry-vertical-padding": 10,
                    "menu-transparency": 100,
                    "menu-margin": 0,
                    "menu-width": 34,
                    "name": "default",
                    "tuning-background-animation": "spin-x"
                }
            }, loaded = false;
            self.data = Object.assign({}, self.defaults); // keep defaults object for reference
            self.keys = Object.keys(self.defaults);
            for(var key in self.data){
                if(typeof(self.data[key]) != typeof(self.defaults[key])){
                    console.error('Invalid key value for', key, self.data[key], 'is not of type ' + typeof(self.defaults[key]));
                    self.data[key] = self.defaults[key];
                }
            }
            self.load = () => {
                loaded = true;
                if(fs.existsSync(self.file)){
                    var _data = fs.readFileSync(self.file, "utf8");
                    if(_data){
                        if(Buffer.isBuffer(_data)){ // is buffer
                            _data = String(_data)
                        }
                        if(self.debug){
                            console.log('DATA', _data)
                        }
                        if(typeof(_data)=='string' && _data.length > 2){
                            _data = _data.replaceAll("\n", "");
                            _data = JSON.parse(_data);
                            if(typeof(_data)=='object' && _data.compability >= self.defaults.compability){
                                self.data = Object.assign(self.data, _data)
                            }
                        }
                    }
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
                    console.log('DATA', JSON.stringify(data))
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
                    if(jQuery.isArray(self.data[key])){ // avoid referencing
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
                self.data[key] = val;
                if(fs.existsSync(self.file)){
                    fs.truncateSync(self.file, 0)
                }
                var jso = JSON.stringify(self.data, null, 4);
                fs.writeFileSync(self.file, jso, "utf8");
                if(self.debug){
                    console.log('SSSET', jso, self.data)
                }
            }
            self.reset = () => {
                if(!loaded){
                    self.load()
                }
                if(self.debug){
                    console.log('SSSET', key, val, self.data)
                }
                self.data = self.defaults;
                if(fs.existsSync(self.file)){
                    fs.truncateSync(self.file, 0)
                }
                var jso = JSON.stringify(self.data, null, 4);
                fs.writeFileSync(self.file, jso, "utf8");
                if(self.debug){
                    console.log('SSSET', jso, self.data)
                }
            }
            return self;
        })()
        
	} else {
		var Config = top.Config, Store = top.Store, Theme = top.Theme;
    }

    function prepareFilename(file){
        file = file.replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '');
        return file;
    }

    function ucWords(str){
        return str.toLowerCase().replace(/^[\u00C0-\u1FFF\u2C00-\uD7FF\w]|\s[\u00C0-\u1FFF\u2C00-\uD7FF\w]/g, function(letter) {
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

    function getJSON(file, cb){
        fs.readFile(path.resolve(file), (err, content) => {
            if( err ) {
                cb('File not found.', false)
            } else {
                cb(null, JSON.parse(content))
            }
        })
    }

    function findCircularRefs(o){
        var cache = [];
        JSON.stringify(o, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                if (cache.indexOf(value) !== -1) {
                    console.log('Circular reference found:', key, value);
                    return;
                }
                // Store value in our collection
                cache.push(value);
            }
            return value;
        });
        cache = null;
    }

    function seekRewind(){
        if(top && top.PlaybackManager && top.PlaybackManager.activeIntent){
            notify(Lang.REWIND, 'fa-backward', 'short');
            top.PlaybackManager.seek(-4)
        }
    }

    function seekForward(){
        if(top && top.PlaybackManager && top.PlaybackManager.activeIntent){
            notify(Lang.FORWARD, 'fa-forward', 'short');
            top.PlaybackManager.seek(4)
        }
    }

    function collectListQueue(ref){
        var container = Menu.container(false);
        var as = container.find('a.entry-stream');
        var queue = [], ok = false;
        for(var i=0; i<as.length; i++){
            var s = as.eq(i).data('entry-data');
            if(s.url == ref.url || (typeof(ref.originalUrl)!='undefined' && s.url == ref.originalUrl)){
                top.packageQueueCurrent = i;
                ok = true;
            }
            queue.push(s)
        }
        if(ok){
            top.packageQueue = queue;
        }
    }
    
    function getPreviousStream(){
        if(top.packageQueue.length > 1){
            var i = top.packageQueueCurrent - 1;
            if(i < 0){
                i = top.packageQueue.length - 1;
            }
            return top.packageQueue[i];
        }
    }

    function getNextStream(){
        if(top.packageQueue.length > 1){
            var i = top.packageQueueCurrent + 1;
            if(i >= top.packageQueue.length){
                i = 0;
            }
            return top.packageQueue[i];
        }
    }

    function help(){
        gui.Shell.openExternal('https://megacubo.tv/online/2018/?version='+gui.App.manifest.version)
    }

    function goHome(){
        stop();
        var c = (top || parent);
        if(c){
            c.Menu.go('')
        }
    }

    function restartApp(hard){
        doAction('beforeRestartApp');
        if(hard === true){
            setTimeout(() => { 
                chrome.runtime.reload()
                /*
                gui.Shell.openExternal(process.execPath);
                setTimeout(() => {
                    closeApp();
                    win.close(true)
                }, 0);
                */
            }, 250)
        } else {
            top.location.reload()
        }
    }

    function bufferize(buffer) {
        if(buffer instanceof ArrayBuffer){
            buffer = Buffer.from(buffer).toString('utf8')
        } else if(typeof(buffer)=='object' && typeof(buffer.base64Encoded)!='undefined'){
            if(buffer.base64Encoded){
                buffer = new Buffer(buffer.body, 'base64')
            } else {
                buffer = buffer.body
            }
        }  
        return buffer;
    }

    function goReload(){
        var c = (top || parent || window);
        if(c && c.PlaybackManager.activeIntent){
            var e = c.PlaybackManager.activeIntent.entry;
            c.isReloading = true;
            setTimeout(() => {
                c.isReloading = false;
            }, 1000);
            stop();
            c.playEntry(e)
        }
    }
    
    function goSearch(searchTerm, backTo){
        var c = (top || parent || window);
        if(c && c.searchPath){
            if(c.isMiniPlayerActive()){
                c.leaveMiniPlayer()
            }
            if(searchTerm){
                c.lastSearchTerm = searchTerm;
            }
            if(typeof(backTo) != 'string'){
                backTo = Menu.path;
            }
            var callback = () => {
                c.showMenu();
                if(searchTerm) {
                    var n = jQuery(c.document).find('.list input');
                    console.log('AA', c.Menu.path, searchTerm);
                    n.val(searchTerm).trigger('input');
                    console.log('BB', n.length);
                }
                setBackTo(oPath)
            }
            if(c.Menu.path == c.searchPath){
                callback()
            } else {
                c.Menu.go(c.searchPath, callback)
            }
        }
    }
    
    function goShare(what){
        var ewhat = encodeURIComponent(what), url = 'https://megacubo.tv/assistir/'+ewhat;
        url = 'https://www.addtoany.com/share#url='+encodeURIComponent(url)+'&title='+ewhat;
        gui.Shell.openExternal(url)
    }
    
    function goShareFB(){
        var n = PlaybackManager.activeIntent?PlaybackManager.activeIntent.entry.name:'...';
        var url = 'https://megacubo.tv', t = Lang.SHARE_FACEBOOK_MASK.format(n);
        url = 'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(url)+'&quote='+encodeURIComponent(t);
        gui.Shell.openExternal(url)
    }
    
    function goShareTW(){
        var n = PlaybackManager.activeIntent?PlaybackManager.activeIntent.entry.name:'...';
        var url = 'https://megacubo.tv', t = Lang.SHARE_TWITTER_MASK.format(n);
        url = 'https://twitter.com/share?url='+encodeURIComponent(url)+'&text='+encodeURIComponent(t);
        gui.Shell.openExternal(url)
    }

    function goBookmarks(){
        var c = (top || parent);
        if(c.bookmarksPath){
            c.Menu.go(c.bookmarksPath, setBackToHome)
        }
    }

    function goOptions(){
        var c = (top || parent);
        if(c.optionsPath){
            c.Menu.go(c.optionsPath, setBackToHome)
        }
    }

    function goChangeLang(){
        var c = (top || parent);
        if(c.langPath){
            c.Menu.go(c.langPath, setBackToHome)
        }
    }

    function setBackTo(path){
        var c = (top || parent);
        console.warn('SETBACK TO', path);
        jQuery(c.document).find('.entry-back').off('mousedown click').on('click', () => {Menu.go(path)})
    }

    function setBackToHome(){
        setBackTo('')
    }

    function goOpen(){
        var c = (top || parent);
        if(c){
            c.addNewSource()
        }
    }
    
    function toTitleCase(str)
    {
        return str.replace(/\w\S*/g, function(txt){
            return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
        });
    }

    var m3u8Parser;
    
    function getM3u8Parser(){
        if(!top.m3u8Parser){
            top.m3u8Parser = require('m3u8-parser');
        }
        return new top.m3u8Parser.Parser();
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
        if(opener && opener != global){
            setupKeyboardForwarding(document, opener.document)
        } else if (document.URL.indexOf('detect-keys.html') != -1) {
            return;
        }  else if (top != window) {
            setupKeyboardForwarding(document)
        } else {
            var globalHotkeys = [
                {
                    key : "MediaPrevTrack",
                    active : () => {
                        var s = getPreviousStream();
                        if(s){
                            console.log(s);
                            (top || parent).playEntry(s)
                        }
                    }
                },
                {
                    key : "MediaNextTrack",
                    active : () => {
                        var s = getNextStream();
                        if(s){
                            console.log(s);
                            (top || parent).playEntry(s)
                        }
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
                globalHotkeys[i] = new gui.Shortcut(globalHotkeys[i]);
                gui.App.registerGlobalHotKey(globalHotkeys[i]);
            }
            jQuery(window).on('beforeunload', () => {
                for(var i=0; i<globalHotkeys.length; i++){
                    nw.App.unregisterGlobalHotKey(globalHotkeys[i]);
                }
                console.log('Hotkeys unregistered.')
            });
            jQuery.getScript('assets/js/hotkeys-actions.js', () => {
                getJSON('hotkeys.json', (err, hotkeys) => {
                    if(hotkeys && typeof(hotkeys)=='object'){
                        var args = [];
                        for(var key in hotkeys){
                            if(jQuery.isArray(hotkeysActions[hotkeys[key]])){
                                args = hotkeysActions[hotkeys[key]];
                                args.unshift(key);
                                shortcuts.push(createShortcut.apply(createShortcut, args));  
                            }
                        }
                        jQuery.Shortcuts.start()
                    }
                })
            })
        }
    }

    function setupKeyboardForwarding(fromDocument, to){
        var ctrlProp = '_keyboardForwarding';
        if(!to){
            to = top.document;
        }
        if(fromDocument != to){
            if(typeof(fromDocument[ctrlProp])=='undefined'){
                fromDocument[ctrlProp] = true;
                fromDocument.addEventListener('keydown', (e) => {
                    console.log('KEYDOWN');
                    let evt = new to.defaultView.Event('keydown', {key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey, composed: true, charCode: e.charCode, keyCode: e.keyCode, which: e.which, bubbles: true, cancelable: true, which: e.keyCode});
                    evt.keyCode = e.keyCode;
                    evt.which = e.keyCode;
                    evt.altKey = e.altKey;
                    evt.ctrlKey = e.ctrlKey;
                    evt.metaKey = e.metaKey;
                    evt.shiftKey = e.shiftKey;
                    to.body.dispatchEvent(evt);
                    console.log('KEYDOWN OK', evt.ctrlKey, e.ctrlKey)    
                });
                fromDocument.addEventListener('keyup', (e) => {
                    console.log('KEYUP');  
                    let evt = new to.defaultView.Event('keyup', {key: e.key, code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey, composed: true, charCode: e.charCode, keyCode: e.keyCode, which: e.which, bubbles: true, cancelable: true, which: e.keyCode});
                    evt.keyCode = e.keyCode;
                    evt.which = e.keyCode;
                    evt.altKey = e.altKey;
                    evt.ctrlKey = e.ctrlKey;
                    evt.metaKey = e.metaKey;
                    evt.shiftKey = e.shiftKey;
                    to.defaultView.document.body.dispatchEvent(evt);
                    console.log('KEYUP OK')
                });
                console.log('Keyboard forwarding from '+basename(fromDocument.URL, true))
            } else {
                console.log('Keyboard already forwarding from '+basename(fromDocument.URL, true))
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
    function getFFmpegMediaInfo(path, callback){
        if(!spawn){
            spawn = require('child_process').spawn;
        }
        var data = '';
        var child = spawn(top.FFmpegPath, [
            '-i', path
        ]);
        child.stdout.on('data', function(chunk) {
            data += String(chunk)
        });
        child.stderr.on('data', function(chunk) {
            data += String(chunk)
        });
        var timeout = setTimeout(() => {
            child.kill()
        }, 10000);
        child.on('close', (code) => {
            clearTimeout(timeout);
            callback(data, code)
        });
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
    
    var isMenuVisible = () => {
        return b.hasClass('show-menu');
    }
    
    var isMenuHiding = () => {
        return top.controlsHiding || false;
    }
    
    function showMenu(){
        if(!isMenuVisible()){
            sound('menu', 9);
            b.add(getFrame('overlay').document.body).addClass('show-menu');
            doAction('showMenu')
        } else {
            console.log('DD')
        }
    }
    
    function hideMenu(){
        //console.log('EE', traceback())
        if(isMenuVisible()){
            sound('menu', 9);
            //console.log('HH')
            top.controlsHiding = true;
            var c = (top || parent);
            b.add(getFrame('overlay').document.body).removeClass('istyping show-menu paused');
            var controlsActiveElement = c.document.activeElement;
            //console.log('HIDE', controlsActiveElement)
            if(controlsActiveElement && controlsActiveElement.tagName.toLowerCase()=='input'){
                //console.log('HIDE UNFOCUS', controlsActiveElement)
                c.Menu.focusPrevious()
            }
            top.PlaybackManager.play();
            setTimeout(() => {
                top.controlsHiding = false;
            }, 600);
            doAction('hideMenu')
        }
    }
    
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
            if(domain.indexOf('.')!=-1){
                return domain;
            }
        }
        return '';
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

    function isMiniPlayerActive(){
        if(top && typeof(top.miniPlayerActive) != 'undefined'){
            return top.miniPlayerActive;
        }
    }
    
    function askForSource(question, callback, placeholder){
        if(top){
            if(isMiniPlayerActive()){
                top.leaveMiniPlayer()
            }
            var defaultValue = Store.get('last-ask-for-source-value');
            var cb = top.clipboard.get('text');
            if(cb.match(new RegExp('^(//|https?://)'))){
                defaultValue = cb;
            }
            var options = [
                ['<i class="fas fa-folder-open" aria-hidden="true"></i> '+Lang.OPEN_FILE, () => {
                    openFileDialog(function (file){
                        var o = getFrame('overlay');
                        if(o){
                            top.modalClose();
                            o.processFile(file)
                        }
                    })
                }],
                ['<i class="fas fa-search" aria-hidden="true"></i> '+Lang.FIND_LISTS, () => {
                    gui.Shell.openExternal(getIPTVListSearchURL())
                }],
                ['<i class="fas fa-check-circle" aria-hidden="true"></i> OK', () => {
                    // parse lines for names and urls and use registerSource(url, name) for each
                    var v = top.modalPromptVal();
                    if(v){
                        if(v.substr(0, 2)=='//'){
                            v = 'http:'+v;
                        }
                        Store.set('last-ask-for-source-value', v);
                    }
                    if(callback(v)){
                        top.modalClose()
                    }
                }]
            ];
            top.modalPrompt(question, options, Lang.PASTE_URL_HINT, defaultValue)
        }
    }

    var appNameCaching = false;
    function appName(){
        var title = appNameCaching || 'Megacubo';
        try {
            var t = gui.App.manifest.window.title;
            if(t){
                appNameCaching = title = t;
            }
        } catch(e) {}
        return applyFilters('appName', title)
    }

    function loadTheming(opts, _cb){
        var srcFile = 'assets/css/theme.src.css';
        fs.readFile(srcFile, (err, content) => {
            console.log('loadTheming');
            if(!err){
                let bgcolor = Theme.get('bgcolor'), bg = jQuery('#background');
                content = parseTheming(content, opts);
                stylizer(content, 'theming', window);
                redrawBackgroundImage();
                redrawLogoImage();
                if(getColorLightLevel(bgcolor) > 50){
                    document.documentElement.className += ' ui-light';                    
                } else {
                    document.documentElement.className = document.documentElement.className.replaceAll('ui-light', '');
                }
                if(Theme.get("menu-transparency") < 99){
                    bg.removeClass('fit-player').addClass('fit-screen').find('.background-logo-container').addClass('fit-player');
                    document.documentElement.className += ' ui-transparent-menu';                    
                } else {
                    bg.removeClass('fit-screen').addClass('fit-player').find('.background-logo-container').removeClass('fit-player');
                    document.documentElement.className = document.documentElement.className.replaceAll('ui-transparent-menu', '');
                }
                if(typeof(Menu)!='undefined'){
                    Menu.restoreScroll()
                }
                if(typeof(doAction) == 'function'){
                    try {
                        doAction('afterLoadTheming')
                    } catch(e) {
                        console.error(e)
                    }
                }
                if(typeof(_cb) == 'function'){
                    _cb()
                }
                if(typeof(updateMenuDimensions)=='function'){
                    updateMenuDimensions()
                }
            }
        });        
        var scope = (typeof(PlaybackManager) != 'undefined' && PlaybackManager.activeIntent) ? PlaybackManager.activeIntent.getVideo() : false;
        if(scope) {
            scope = scope.ownerDocument.defaultView;
        } else {
            scope = document.querySelector('iframe#player');
            scope = scope ? scope.contentWindow : false;
        }
        if(scope){
            fs.readFile('assets/css/player.src.css', (err, content) => {
                if(content){
                    console.log('Applying CSS...');
                    stylizer(parseTheming(content), 'player-css', scope);
                    console.log('Applied CSS.');
                }
            })
        }
    }

    var isFirstBackgroundDraw = true;
    function redrawBackgroundImage(){
        var bg = document.querySelector('#background');
        if(bg) {
            var defaultBackground = 'assets/images/wallpaper.png';
            var n, content = Theme.get('background'), rm = bg.querySelector('img.background-image, video.background-image');
            switch(content.substr(5, 5)){
                case 'image':
                    n = '<img class="background-image" src="' + content + '" />';
                    break;
                case 'video':
                    n = '<video class="background-image" loop autoplay muted src="' + content + '" />';
                    break;
                default:
                    n = '<img class="background-image" src="' + defaultBackground + '" />';
                    break;
            }
            if(n){
                if(rm){
                    bg.removeChild(rm)
                }
                jQuery(n).prependTo(bg)
            }
        }
    }

    var isFirstLogoDraw = true;
    function redrawLogoImage() {
        var bg = document.querySelector('#background');
        if(bg) {
            var defaultLogo = 'default_icon.png';
            var n, content = Theme.get('logo') || '', rm = bg.querySelector('.background-logo-container');
            switch(content.substr(5, 5)) {
                case 'image':
                    applyIcon(content);
                    n = '<div class="background-logo-container fit-player"><img class="background-logo" src="' + content + '" /></div>';
                    break;
                default:
                    applyIcon(defaultLogo);
                    n = '<div class="background-logo-container fit-player"><img class="background-logo" src="' + defaultLogo + '" /></div>';
                    break;
            }
            if(n) {
                if(rm) {
                    bg.removeChild(rm)
                }
                jQuery(n).prependTo(bg)
            }
        }
    }

    function parseTheming(content, opts){
        let maxPlayerStatusOpacity = 0.75, mt = Math.round(Theme.get('menu-transparency') * (255 / 100)), data = {
            'bg': Theme.get('bg') || 'linear-gradient(to top, #000004 0%, #01193c 75%)',
            'bgcolor-playing': Theme.get('bgcolor-playing'),
            'bgcolor': Theme.get('bgcolor'),
            'fgcolor': Theme.get('fgcolor'),
            'fontsize': Theme.get('font-size'),
            'icon-size': Theme.get('icon-size'),
            'bg-anim': 'bga-' + Theme.get('tuning-background-animation'),
            'theme': Theme.get('name'),
            'menu-entry-vertical-padding': Theme.get('menu-entry-vertical-padding') || 12,
            'menu-margin': Theme.get('menu-margin') / 100,
            'menu-transparency-hex': componentToHex(mt),
            'menu-width': (Theme.get('menu-width') || 34) + '%', // percent of window width
            'player-status-transparency-hex': mt > (255 * maxPlayerStatusOpacity) ? componentToHex(Math.round(255 * maxPlayerStatusOpacity)) : componentToHex(mt)
        };
        if(data.fontsize > 2){
            data.fontsize = 1;
        }
        if(typeof(opts) == 'object'){
            data = Object.assign(data, opts);
        } 
        content = String(content);
        Object.keys(data).forEach((key) => {
            if(content.indexOf('('+key) != -1){
                content = content.replace(new RegExp('\\('+key.replaceAll('-', '.{0,2}')+'\\)', 'g'), data[key]);
            }
        });
        return content;
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

    function getNameFromMagnet(url){
        var match = url.match(new RegExp('dn=([^&]+)'));
        if(match){
            return urldecode(match[1])
        }
        return 'Unknown Magnet';
    }
        
    function playCustomURL(placeholder, direct){
        var url;
        if(placeholder && direct){
            url = placeholder;
        } else {
            if(!placeholder){
                placeholder = Store.get('lastCustomPlayURL')
            }
            return top.askForSource(Lang.PASTE_URL_HINT, (val) => {
                playCustomURL(val+'#nosandbox', true);
                return true;
            })            
        }
        if(url){
            if(url.substr(0, 2)=='//'){
                url = 'http:'+url;
            }
            Store.set('lastCustomPlayURL', url);
            var name = false;
            if(isMagnet(url)){
                name = getNameFromMagnet(url);
            } else if(isValidPath(url)){
                name = 'Megacubo '+url.split('/')[2];
            }
            if(name){
                console.log('lastCustomPlayURL', url, name);
                Store.set('lastCustomPlayURL', url);
                var logo = '', c = (top || parent);                
                if(c){
                    logo = c.defaultIcons['stream'];
                }
                top.createPlayIntent({url: url+'#nosandbox', allowWebPages: true, name: name, logo: logo}, {manual: true})
            }
        }
    }
    
    function playCustomFile(file){
        Store.set('lastCustomPlayFile', file);
        top.createPlayIntent({url: file, name: basename(file, true)}, {manual: true})
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

    function isWritable(_path, cb){
        var isFolder = false;
        try{
            isFolder = fs.lstatSync(_path).isDirectory()
        } catch(e) {
            isFolder = false;
        }
        if(isFolder){
            var testFile = _path + path.sep + 'test.tmp';
            fs.writeFile(testFile, '1', (err) => {
                if (err){
                    cb(null, false)
                } else {
                    cb(null, true)
                }
                fs.unlink(testFile, () => {})
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
            cb = () => {}
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
            done(err);
        });
        var wr = fs.createWriteStream(target);
        wr.on("error", function(err) {
            done(err);
        });
        wr.on("close", function(ex) {
            done();
        });
        rd.pipe(wr)
    }

    function createShortcut(key, callback, type, enableInInput){
        key = key.replaceAll(' ', ',');
        jQuery.Shortcuts.add({
            type: type ? type : 'down',
            mask: key,
            enableInInput: !!enableInInput,
            handler: () => {
                console.log(key+' pressed', document.URL)
                callback.call(window.top)
            }
        })
    }

    jQuery(setupShortcuts); 

    function stop(skipPlaybackManager, isInternal){
        var c = (top || parent || window);
        console.log('STOP', traceback());
        c.autoCleanEntriesCancel();
        if(c.PlaybackManager.activeIntent || c.PlaybackManager.isLoading()){
            if(skipPlaybackManager !== true){
                c.PlaybackManager.fullStop();
            }
            showPlayers(false, false);
            c.doAction('stop')
        }
        jQuery('body').removeClass('playing loading paused');
        setTimeout(() => {
            if(c.updateStreamEntriesFlags){
                c.updateStreamEntriesFlags() // on unload => Uncaught TypeError: c.updateStreamEntriesFlags is not a function
            }
        }, 200);
        if(!c.isReloading && isInternal !== true){
            setTitleData(appName(), '');
            leavePendingState()
        }
    }
    
    function currentStream(){
        var ret = false;
        try {
            ret = top.PlaybackManager.activeIntent.entry;
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
        var data = gui.App.manifest.window;
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

    var imageCheckingCache = {};

    function checkImage(url, load, error){
        if(url.indexOf('/') == -1){
            error();
            return;
        }
        if(typeof(imageCheckingCache[url])=='boolean'){
            if(imageCheckingCache[url]){
                load()
            } else {
                error()
            }
            return;
        }
        var _testImageObject = new Image();
        _testImageObject.onerror = () => {
            delete _testImageObject;
            imageCheckingCache[url] = false;
            error()
        }
        _testImageObject.onload = () => {
            delete _testImageObject;
            imageCheckingCache[url] = true;
            load()
        }
        _testImageObject.src = url;
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
        var ret = '', sts = str.split(' '), wordsPerLine = Math.ceil(sts.length / count);
        for(var i=0; i<count; i++){
            if(i){
                ret += sep;
            }
            ret += sts.slice(i * wordsPerLine, (i * wordsPerLine) + wordsPerLine).join(' ');
        }
        return ret;
    }

    var notifyTimer = 0;
    function notifyParseTime(secs){
        var maxSecs = 200000;
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
                secs = maxSecs;
                break;
            case 'forever':
                secs = 30 * (24 * 3600);
                break;
        }
        if(secs > maxSecs){
            secs = maxSecs;
        }
        return secs;
    }

    function notifyRemove(str){
        var o = window.top || window.parent;
        if(o){
            console.log('notifyRemove', 'pending', traceback());
            var a = jQuery(o.document.getElementById('notify-area'));
            a.find('.notify-row').filter((i, o) => {
                return jQuery(o).find('div').text().trim().indexOf(str) != -1;
            }).hide()
        }
    }

    function setupNotify(){
        if(top.setupNotifyDone) return;
        top.setupNotifyDone = true;
        var observer = new top.MutationObserver((mutations) => {
            var delay = 10;
            var o = window.top || window.parent;
            if(o){
                var nrs = jQuery(o.document).find('div.notify-row:visible');
                var f = nrs.eq(0);
                if(!f.hasClass('notify-first')){
                    f.addClass('notify-first')
                }
                nrs.slice(1).filter('.notify-first').removeClass('notify-first')
            }
        });
        observer.observe(top.document.querySelector('#notify-area'), {attributes: true, childList: true, characterData: true, subtree:true})
    }

    var lastNotifyCall = null;
    function notify(str, fa, secs){
        if((str + fa) == lastNotifyCall){ // tricky, avoid doubled calls
            return;
        }
        setupNotify();
        lastNotifyCall = (str + fa);
        var o = window.top || window.parent;
        if(o && o.document){
            var _fa = fa, a = o.document.getElementById('notify-area');
            if(a){
                a = jQuery(a);
                if(!str) {
                    a.find('.notify-wait').hide();
                    return;
                }
                var c = '', timer;
                if(a){
                    if(secs == 'wait'){
                        c += ' notify-wait';
                    }
                    secs = notifyParseTime(secs);
                    var destroy = () => {
                        if(lastNotifyCall == (str + fa)){
                            lastNotifyCall = '';
                        }
                        n.animate({left: 40, opacity: 0.01}, 400, () => {
                            n.remove()
                        })
                    };
                    a.find('.notify-row').filter((i, o) => {
                        return jQuery(o).find('div').text().trim() == str;
                    }).remove();
                    if(_fa){
                        if(_fa.indexOf('/') != -1){
                            _fa = '<span class="notify-icon" style="background-image:url({0});"></span> '.format(fa.replaceAll('"', ''))
                        } else {
                            _fa = '<i class="fa {0} notify-icon" aria-hidden="true"></i> '.format(fa)
                        }
                    }
                    var n = jQuery('<div class="notify-row '+c+' notify-first" style="position: relative; left: 40px; opacity: 0.01;"><div class="notify">' + _fa + '<span class="notify-text">' + str + '</span></div></div>');
                    n.prependTo(a);
                    timer = top.setTimeout(destroy, secs * 1000);
                    n.animate({left: 0, opacity: 1}, 250);
                    var getElement = () => {
                        if(!(n && n.parent() && n.parent().parent())){
                            n = notify(str, fa, secs)
                        }
                        return n;
                    }
                    return {
                        update: (str, _fa, secs) => {
                            lastNotifyCall = (str + _fa);
                            n = getElement();
                            console.log('UPDATE NOTIFY', n);
                            n.hide();
                            if(_fa && str) {
                                if(_fa.indexOf('/') != -1){
                                    _fa = '<span class="notify-icon" style="background-image:url({0});"></span> '.format(_fa.replaceAll('"', ''))
                                } else {
                                    _fa = '<i class="fa {0} notify-icon" aria-hidden="true"></i> '.format(_fa)
                                }
                                n.find('.notify').html(_fa + ' <span class="notify-text">' + str + '</span>')
                            }
                            if(secs){
                                n.prependTo(a);
                                secs = notifyParseTime(secs);
                                clearTimeout(timer);
                                timer = top.setTimeout(destroy, secs * 1000)
                            }
                            n.show();
                            return n;
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

    var pendingStateTimer = 0, defaultTitle = '', pendingStateNotification;

    function inPendingState() {
        return top ? (top.isPending || false) : false;
    }

    function pendingStateFlags() {
        return [Lang.CONNECTING, Lang.TUNING]
    }

    function enterPendingState(title, notifyFlag, loadingUrl) {
        console.warn('enterPendingState', time(), top.isPending, loadingUrl || false, traceback(), PlaybackManager.log());
        var t = top || parent || window;
        t.isPending = loadingUrl || ((t.isPending && typeof(t.isPending)=='string') ? t.isPending : true);
        console.warn('enterPendingState', top.isPending);
        if(!notifyFlag){
            notifyFlag = Lang.CONNECTING;
        }
        if(!title){
            title = notifyFlag+'...';
        } else {
            title = notifyFlag + ' ' + title + '...';
        } 
        //setTitleFlag('fa-circle-notch fa-spin', title);
        if(!pendingStateNotification){
            //pendingStateNotification = notify(notifyFlag+'...', 'fa-circle-notch fa-spin', 'forever')
            pendingStateNotification = notify(title, 'fa-circle-notch fa-spin', 'forever')
        } else {
            //pendingStateNotification.update(notifyFlag+'...', 'fa-circle-notch fa-spin')
            pendingStateNotification.update(title, 'fa-circle-notch fa-spin')
        }
        t.updateStreamEntriesFlags();
        jQuery(t.document.querySelector('body')).addClass('tuning')
    }
    
    function leavePendingState() {
        console.warn('leavePendingState', time(), top.isPending);
        var t = top || parent || window;
        if(typeof(t.isPending) != 'undefined'){
            t.isPending = false;
            if(pendingStateNotification){
                pendingStateNotification.hide()
            }
            //setTitleFlag('', defaultTitle);
            t.updateStreamEntriesFlags()
        };
        jQuery(t.document.querySelector('body')).removeClass('tuning')
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

    function displayPrepareName(name, prepend, append){
        if(!name){
            name = 'Unknown';
        }
        if(prepend){
            if(name.indexOf('<span')!=-1){
                name = name.replace('>', '>'+prepend+' ');
            } else {
                name = prepend+' '+name;
            }
        }
        if(append){
            if(name.indexOf('<span')!=-1){
                name = replaceLast(name, '<', ' '+append+'<');
            } else {
                name = name+' '+append;
            }
        }
        name = name.replaceAll(' - ', ' · ').replaceAll(' | ', ' · ');
        return name;
    }

    function setTitleData(title, icon) {
        console.log('TITLE = '+title);
        title = displayPrepareName(urldecode(title));
        defaultTitle = title;
        if(top){
            var defaultIcon = 'default_icon.png';
            if(icon){
                applyIcon(icon);
                checkImage(icon, () => {}, () => {
                    applyIcon(defaultIcon);
                });
            } else {
                applyIcon(defaultIcon)
            }
            var doc = top.document;
            doc.title = title;
            var c = doc.querySelector('.nw-cf-title');
            if(c){
                c.innerText = title;
            }
            console.log('TITLE OK');
        }
    }

    function setTitleFlag(fa, title){
        if(top){
            title = displayPrepareName(urldecode(title));
            var doc = top.document, t = doc.querySelector('.nw-cf-icon'), c = doc.querySelector('.nw-cf-title');
            if(t){
                if(fa){ // fa-circle-notch fa-spin
                    t.innerHTML = '<i class="fa {0}" aria-hidden="true"></i>'.format(fa);
                    t.style.backgroundPositionX = '50px';
                    c.style.marginLeft = '0px';
                } else {
                    t.innerHTML = '';
                    t.style.backgroundPositionX = '0px';
                    c.style.marginLeft = '4px';
                }
                if(typeof(title)=='string'){
                    doc.title = title;
                    var c = doc.querySelector('.nw-cf-title');
                    if(c){
                        if(!defaultTitle){
                            defaultTitle = c.innerText;
                        }
                        c.innerText = title;
                    }
                }
            }
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

    function getColorLightLevel(hex){
        var rgb = hexToRgb(hex);
        if(!rgb) return 0;
        return (rgb.r + rgb.g + rgb.b ) / 7.64999;
    }

    function getHTTPInfo(url, callback){
        var timeout = 30;
        getHeaders(url, (h, u) => { 
            var cl = h['content-length'] || -1;
            var ct = h['content-type'] || '';
            var st = h['status'] || 0;
            if(ct){
                ct = ct.split(',')[0].split(';')[0];
            } else {
                ct = '';
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
            var url = jQuery(doc).find('stream').text().replaceAll('embed::', '').replaceAll('#off', '#nosandbox').replaceAll('#catalog', '#nofit#');
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
            var qs = objectifyQueryString(parts[1].split('?').pop().split('#')[0]);
            switch(parts[0]){
                case 'link':
                    return Object.assign({type: 'link', url: atob(parts[1]), name: 'Megacubo '+getDomain(parts[1])}, qs);
                    break;
                case 'play':
                    parts[1] = decodeURIComponent(parts[1]) || parts[1];
                    parts[1] = parts[1].split('?')[0].split('#')[0];                    
                    return Object.assign({type: 'play', link: '', name: parts[1]}, qs);
                    break;
            }
        }
        return false;
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
    
    function isM3U8(url){
        if(typeof(url)!='string') return false;
        return ['m3u8', 'm3u'].indexOf(getExt(url)) != -1;            
    }
    
    function isTS(url){
        if(typeof(url)!='string') return false;
        return isHTTP(url) && getExt(url) == 'ts';            
    }
    
    function isRemoteTS(url){
        if(typeof(url)!='string') return false;
        return isHTTP(url) && getExt(url) == 'ts';            
    }
    
    function isRTMP(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('^rtmp[a-z]?:', 'i'));            
    }
    
    function isHTTP(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('^https?:', 'i'));            
    }
    
    function isMagnet(url){
        if(typeof(url)!='string') return false;
        return url.substr(0, 7)=='magnet:';            
    }
    
    function isMega(url){
        if(typeof(url)!='string') return false;
        return url.substr(0, 5)=='mega:';            
    }

    function isYT(url){
        url = String(url);
        if(url.indexOf('youtube.com')==-1){
            return false;
        }
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(url);
        return typeof(id)=='string';
    }
    
    function isRTSP(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('(^(rtsp|mms)[a-z]?:)', 'i'));            
    }
    
    function isLocal(str){
        if(typeof(str)!='string'){
            return false;
        }
        if(str.match('[A-Z]:')){ // windows drive letter
            return true;
        }
        if(str.substr(0, 5)=='file:'){
            return true;
        }
        return fs.existsSync(str)
    }
    
    function isVideo(url){
        if(typeof(url)!='string') return false;
        return 'wma|wmv|avi|mp3|mp4|mka|mkv|m4a|m4v|mov|flv|webm|flac|aac|ogg'.split('|').indexOf(getExt(url)) != -1;            
    }
    
    function isHTML5Video(url){
        if(typeof(url)!='string') return false;
        return 'mp3|mp4|m4a|m4v|webm|aac|ogg|ts|mkv'.split('|').indexOf(getExt(url)) != -1;            
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
        if(top && top.PlaybackManager){
            return top.PlaybackManager.playing();
        }
    }
    
    function isStopped(){
        if(top && top.PlaybackManager){
            return !top.PlaybackManager.activeIntent;
        }
        return true;
    }
    
    function getExt(url){
        return (''+url).split('?')[0].split('#')[0].split('.').pop().toLowerCase();        
    }
    
    function showPlayers(stream, sandbox){
        console.log('showPlayers('+stream+', '+sandbox+')');
        if(top){
            var doc = top.document;
            var pstream = doc.getElementById('player');
            var psandbox = doc.getElementById('sandbox');
            if(sandbox){
                jQuery(psandbox).removeClass('hide').addClass('show');
            } else {
                jQuery(psandbox).removeClass('show').addClass('hide');
            }
            if(stream){
                jQuery(pstream).removeClass('hide').addClass('show');
            } else {
                jQuery(pstream).removeClass('show').addClass('hide');
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
            if(o){
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

    function absolutize(file){
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
        console.log(itself?'REMOVING':'CLEANING', location);
        if (!next) next = () => {};
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
    
    function traceback() { 
        try { 
            var a = {}; 
            a.debug(); 
        } catch(ex) {
            return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
        };
    }

    function logErr(){
        if(!fs){
            fs = require('fs')
        }
        if(!fs.existsSync('error.log')){
            fs.closeSync(fs.openSync('error.log', 'w')); // touch
        }
        return fs.appendFileSync('error.log', JSON.stringify(Array.from(arguments))+"\r\n"+traceback()+"\r\n\r\n");
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
    
}
