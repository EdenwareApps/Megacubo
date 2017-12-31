var gui = require('nw.gui');
    
setTimeout = global.setTimeout.bind(global);
clearTimeout = global.clearTimeout.bind(global);

// prevent default behavior from changing page on dropped file
window.ondragover = function(e) { 
    if(e){
        e.preventDefault();
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
    setTimeout(function (){
        var ov = document.querySelector('iframe#overlay');
        if(ov) ov.style.pointerEvents = 'none';
    }, 200);
    return false;
};

window.onerror = function (){
    console.log('ERROR', arguments);
    top.logErr(arguments);
    return true;
}

if(typeof(require)!='undefined'){

    var fs = require("fs"), Store = (function (){
        var dir = 'data/', _this = {};
        fs.stat(dir, function(err, stat){
            if(err !== null) {
                fs.mkdir(dir);
            }
        });
        var resolve = function (key){
            return dir+key+'.json';
        };
        var prepareKey = function (key){
            return key.replace(new RegExp('[^A-Za-z0-9\._-]', 'g'), '');
        };
        _this.get = function (key){
            var _json = localStorage.getItem(prepareKey(key));
            if(_json === null){
                var f = resolve(key); 
                if(fs.existsSync(f)){
                    _json = fs.readFileSync(f, "utf8");
                }
            }
            if(_json !== null){
                try {
                    var r = JSON.parse(_json);
                    return r;
                } catch(e){};
            }
            return null;
        };
        _this.set = function (key, val){
            val = JSON.stringify(val);
            //console.log('WRITE '+key+' '+val);
            localStorage.setItem(prepareKey(key), val);
            fs.writeFile(resolve(key), val, "utf8");
        };
        return _this;
    })();

    var DB = (function (){

        var _this = this;

        _this.maximumExpiral = 30 * (24 * 3600);

        _this.insert = function (key, jsonData, expirationSec){
            if (typeof(localStorage) == "undefined") { return false; }
            key = _this.prepare(key);
            var expirationMS = expirationSec * 1000;
            var record = {value: JSON.stringify(jsonData), expires: new Date().getTime() + expirationMS}
            localStorage.setItem(key, JSON.stringify(record));
            return jsonData;
        };

        _this.query = function(key){
            if (typeof(localStorage) == "undefined") { return false; }
            key = _this.prepare(key);
            var v = localStorage.getItem(key);
            if(!v) return false;
            var record = JSON.parse(v);
            if (!record){return false;}
            return (new Date().getTime() < record.expires && JSON.parse(record.value));
        };

        _this.prepare = function (key){
            return key.replace(new RegExp('[^A-Za-z0-9\._-]', 'g'), '');
        };

        var toRemove = [], currentDate = new Date().getTime();
        for (var i = 0, j = localStorage.length; i < j; i++) {
            var key = localStorage.key(i), current = localStorage.getItem(key);
            if (current && /^\{(.*?)\}$/.test(current)) {
                current = JSON.parse(current);
                if (current.expires && current.expires <= currentDate) {
                    toRemove.push(key);
                }
            }
        }
        // Remove itens que já passaram do tempo
        // Se remover no primeiro loop isto poderia afetar a ordem,
        // pois quando se remove um item geralmente o objeto ou array são reordenados
        for (var i = toRemove.length - 1; i >= 0; i--) {
            localStorage.removeItem(toRemove[i]);
        }

        return _this;
    })();

    /*
    DB.insert('test', 'ok', 5);
    alert(DB.query('test'));
    setTimeout(function (){
        alert(DB.query('test'));
        alert(DB.prepare('test_&¨%#&try'));
    }, 6000);

    jQuery(function (){
        Store.set('test', [3, 2]);
        console.log(Store.get('test'));
    });
    */

    String.prototype.replaceAll = function(search, replacement) {
        var target = this;
        return target.split(search).join(replacement);
    };

    // First, checks if it isn't implemented yet.
    if (!String.prototype.format) {
        String.prototype.format = function() {
            var args = arguments;
            return this.replace(/{(\d+)}/g, function(match, number) { 
            return typeof args[number] != 'undefined'
                ? args[number]
                : match
            })
        }
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

    var currentScaleMode = 0, scaleModes = ['contain', 'cover', 'fill'];
    function changeScaleMode(){
        if(top.PlaybackManager.activeIntent){
            var v = top.PlaybackManager.activeIntent.videoElement;
            if(v){
                currentScaleMode++;
                if(currentScaleMode >= scaleModes.length){
                    currentScaleMode = 0;
                }
                v.style.objectFit = scaleModes[currentScaleMode];
                notify('Scale mode: '+scaleModes[currentScaleMode], 'fa-expand', 'short')
            }
        }
    }
    
    function seekRewind(){
        notify(Lang.REWIND, 'fa-backward', 'short');
        top.PlaybackManager.seek(-10)
    }

    function seekForward(){
        notify(Lang.FORWARD, 'fa-forward', 'short');
        top.PlaybackManager.seek(10)
    }
    
    window.packageQueue = [], window.packageQueueCurrent = 0;
    
    function collectPackageQueue(ref){
        var container = getListContainer(false);
        var as = container.find('a.entry-stream');
        window.packageQueue = [];
        for(var i=0; i<as.length; i++){
            var s = as.eq(i).data('entry-data');
            if(s.url == ref.url){
                window.packageQueueCurrent = i;
            }
            window.packageQueue.push(s)
        }
    }
    
    function getPreviousStream(){
        if(window.packageQueue.length > 1){
            var i = window.packageQueueCurrent - 1;
            if(i < 0){
                i = window.packageQueue.length - 1;
            }
            return window.packageQueue[i];
        }
    }

    function getNextStream(){
        if(window.packageQueue.length > 1){
            var i = window.packageQueueCurrent + 1;
            if(i >= window.packageQueue.length){
                i = 0;
            }
            return window.packageQueue[i];
        }
    }

    function help(){
        getManifest(function (data){
            gui.Shell.openExternal('https://megacubo.tv/online/2018/?version='+data.version);
        })
    }

    var minigetProvider, m3u8Parser;
    
    function miniget(){
        if(!top.minigetProvider){
            top.minigetProvider = require('miniget');
        }
        return top.minigetProvider.apply(window, arguments);
    }
    
    function getM3u8Parser(){
        if(!top.m3u8Parser){
            top.m3u8Parser = require('m3u8-parser');
        }
        return new top.m3u8Parser.Parser();
    }    

    function areFramesReady(callback){
        var ok = true;
        ['player', 'overlay', 'controls'].forEach((name) => {
            var w = getFrame(name);
            if(!w || !w.document || ['loaded', 'complete'].indexOf(w.document.readyState)==-1){
                ok = false;
            } else {
                if(!w.top){
                    w.top = window.top;
                }
            }
        })
        if(ok){
            callback()
        } else {
            setTimeout(() => {
                areFramesReady(callback)
            }, 250)
        }
    }

    var shortcuts = [];

    function setupShortcuts(){

        shortcuts.push(createShortcut("Ctrl+M", function (){
            top.toggleMiniPlayer()
        }));
        shortcuts.push(createShortcut("Ctrl+U", function (){
            addNewSource()
            //playCustomURL()
        }));
        shortcuts.push(createShortcut("Alt+Enter", function (){
            top.toggleFullScreen()
        }));
        shortcuts.push(createShortcut("Ctrl+Shift+D", function (){
            top.spawnOut()
        }));
        shortcuts.push(createShortcut("Ctrl+E", function (){
            top.playExternal()
        }));
        shortcuts.push(createShortcut("Ctrl+W", function (){
            stop()
        }));
        shortcuts.push(createShortcut("Ctrl+O", function (){
            openFileDialog(function (file){
                playCustomFile(file)
            })
        }));
        shortcuts.push(createShortcut("F1 Ctrl+I", help));
        shortcuts.push(createShortcut("F2", function (){
            getFrame('controls').renameSelectedEntry()
        }))
        shortcuts.push(createShortcut("F3 Ctrl+F", function (){
            var c = getFrame('controls');
            c.showControls();
            c.listEntriesByPath(Lang.SEARCH);
            setTimeout(function (){
                c.refreshListing();
                jQuery(c.document).find('.entry input').parent().get(0).focus()
            }, 150)
        }));
        shortcuts.push(createShortcut("F4", function (){
            changeScaleMode()
        }));
        shortcuts.push(createShortcut("F5", function (){
            top.location.reload()
        }));
        shortcuts.push(createShortcut("F9", function (){
            if(!top.isRecording){
                top.startRecording()
            } else {
                top.stopRecording()
            }
        }));
        shortcuts.push(createShortcut("F11", function (){
            top.toggleFullScreen()
        }));
        shortcuts.push(createShortcut("Esc", function (){
            top.escapePressed();
        }));
        shortcuts.push(createShortcut("Space", function (){
            top.playPause()
        }));
        shortcuts.push(createShortcut("Ctrl+D", function (){
            getFrame('controls').addFav()
        }));
        shortcuts.push(createShortcut("Ctrl+Shift+D", function (){
            getFrame('controls').removeFav()
        }));
        shortcuts.push(createShortcut("Home", function (){
            if(!areControlsActive()){
                showControls()
            }
            getFrame('controls').listEntriesByPath('/')
        }));
        shortcuts.push(createShortcut("Delete", function (){
            if(areControlsActive()){
                var c = getFrame('controls');
                c.triggerEntryAction('delete')
            } else {
                if(!areControlsHiding()){
                    stop();
                    notify(Lang.STOP, 'fa-stop', 'short')
                }
            }
        }));
        shortcuts.push(createShortcut("Up", function (){
            showControls();
            var c = getFrame('controls');
            c.focusPrevious()
        }, "hold", true));
        shortcuts.push(createShortcut("Down", function (){
            showControls();
            var c = getFrame('controls');
            c.focusNext()
        }, "hold", true));
        shortcuts.push(createShortcut("Right Enter", function (){
            if(areControlsActive()){
                var c = getFrame('controls');
                c.triggerEnter()
            } else {
                showControls()
            }
        }));
        shortcuts.push(createShortcut("Ctrl+Left", function (){
            var s = getPreviousStream();
            if(s){
                console.log(s);
                getFrame('controls').playEntry(s)
            }
        }));
        shortcuts.push(createShortcut("Ctrl+Right", function (){
            var s = getNextStream();
            if(s){
                console.log(s);
                getFrame('controls').playEntry(s)
            }
        }));
        shortcuts.push(createShortcut("Left Backspace", function (){
            if(areControlsActive()){
                var c = getFrame('controls');
                c.triggerBack()
            } else {
                seekRewind()
            }
        }, "hold"));
        shortcuts.push(createShortcut("Shift+Left", function (){
            seekRewind()
        }, "hold"));
        shortcuts.push(createShortcut("Shift+Right", function (){
            seekForward()
        }, "hold"));
        jQuery.Shortcuts.start();

        var globalHotkeys = [
            {
                key : "MediaPlayPause",
                active : function() {
                    top.playPause();
                }
            },
            {
                key : "MediaPrevTrack",
                active : function() {
                    // TODO, play previousChannel
                }
            },
            {
                key : "MediaStop",
                active : function() {
                    top.playPause(false);
                }
            },
        ];
        for(var i=0; i<globalHotkeys.length; i++){
            gui.App.registerGlobalHotKey(new gui.Shortcut(globalHotkeys[i]));
        }
    }
    
    var b = jQuery(top.document).find('body');
    
    var areControlsActive = function (){
        return b.hasClass('istyping') || b.hasClass('isovercontrols');
    }
    
    var areControlsHiding = function (){
        return top.controlsHiding || false;
    }
    
    function showControls(){
        if(!areControlsActive()){
            b.addClass('isovercontrols');
            console.log('CC')
        } else {
            console.log('DD')
        }
    }
    
    function hideControls(){
        //console.log('EE', traceback())

        if(!top || !top.PlaybackManager){
            return;
        }
        
        if(!isPlaying() && (top.PlaybackManager.activeIntent.type!='frame' || top.PlaybackManager.activeIntent.videoElement)){
            //console.log('FF')
            return showControls();
        }
        //console.log('GG')
        if(areControlsActive()){
            //console.log('HH')
            top.controlsHiding = true;
            var c = getFrame('controls');
            b.removeClass('istyping isovercontrols');
            var controlsActiveElement = c.document.activeElement;
            //console.log('HIDE', controlsActiveElement)
            if(controlsActiveElement && controlsActiveElement.tagName.toLowerCase()=='input'){
                //console.log('HIDE UNFOCUS', controlsActiveElement)
                c.focusPrevious()
            }
            setTimeout(function (){
                top.controlsHiding = false;
            }, 600)
        }
    }
    
    function wait(checker, callback){
        var r = checker();
        if(r){
            callback(r)
        } else {
            setTimeout(function (){
                wait(checker, callback)
            }, 250);
        }
    }
    
    function getDomain(u){
        if(u.indexOf('//')!=-1){
            var domain = u.split('//')[1].split('/')[0];
            if(domain.indexOf('.')!=-1){
                return domain;
            }
        }
        return '';
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
    
    function askForSource(question, callback, placeholder){
        top.modalPrompt(question, [
            ['<i class="fa fa-search" aria-hidden="true"></i> '+Lang.WEB_SEARCH, function (){
                nw.Shell.openExternal(getIPTVListSearchURL());
            }],
            ['<i class="fa fa-check-circle" aria-hidden="true"></i> OK', function (){
                // parse lines for names and urls and use registerSource(url, name) for each
                var v = top.modalPromptVal();
                if(v){
                    Store.set('last-ask-for-source-value', v);
                }
                if(callback(v)){
                    top.modalClose()
                }
            }]
        ], Lang.PASTE_URL_HINT, Store.get('last-ask-for-source-value'))
    }
        
    function playCustomURL(placeholder, direct){
        var url;
        if(placeholder && direct){
            url = placeholder;
        } else {
            if(!placeholder) placeholder = Store.get('lastCustomPlayURL');
            return top.askForSource(Lang.PASTE_URL_HINT, function (val){
                playCustomURL(val, true);
                return true;
            })            
        }
        if(url){
            Store.set('lastCustomPlayURL', url);
            var name = false;
            if(url.split('/').length > 2){
                name = 'Megacubo '+url.split('/')[2];
            } else if(isMagnet(url)){
                name = true;
                var match = url.match(new RegExp('dn=([^&]+)'));
                if(match){
                    name = decodeURIComponent(match[1])
                } else {
                    name = 'Magnet URL';
                }
            }
            if(name){
                console.log('lastCustomPlayURL', url, name);
                Store.set('lastCustomPlayURL', url);
                top.createPlayIntentAsync({url: url, name: name})
            }
        }
    }
    
    function playCustomFile(file){
        Store.set('lastCustomPlayFile', file);
        top.createPlayIntentAsync({url: file, name: basename(file)})
    }

    function createShortcut(key, callback, type, enableInInput){
        key = key.replaceAll(' ', ',');
        jQuery.Shortcuts.add({
            type: type ? type : 'down',
            mask: key,
            enableInInput: !!enableInInput,
            handler: function (){
                console.log(key+' pressed', document.URL)
                callback()
            }
        })
    }

    jQuery(setupShortcuts);    

    function stop(skipPlaybackManager){
        console.log('STOP', traceback());
        if(!skipPlaybackManager){
            top.PlaybackManager.stop();
        }
        showPlayers(false, false);
        setTitleData('Megacubo', 'default_icon.png');
        setTimeout(() => {
            if(!isPlaying()){
                getFrame('controls').showControls()
            }
        }, 400)
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
        var c = getFrame('controls');
        var stream = c.currentSandboxStreamArgs;
        console.log('isSandboxLoading', c.currentSandboxTimeoutTimer, top.document.querySelector('iframe#sandbox').src, stream);
        return c.currentSandboxTimeoutTimer && (top.document.querySelector('iframe#sandbox').src == stream[0].url);
    }
    
    function getManifest(callback){
        jQuery.get('/package.json', function (data){
            data = data.replace(new RegExp('/\\* .+ \\*/', 'gm'), '');
            data = JSON.parse(data);
            console.log(data);
            callback(data)
        })
    }
        
    function spawnOut(options, callback){
        getManifest(function (data){
            if(typeof(data)=='object'){
                data = data.window;
                var disallow = 'avoidthisparameter'.split('|');
                for(var k in data){
                    if(disallow.indexOf(k)!=-1){
                        delete data[k];
                    }
                }
                console.log(data);
            }
            nw.Window.open('/index.html', data, function (popWin){
                if(callback){
                    callback(popWin);
                }
            })
            stop()
        })
    }

    function time(){
        return ((new Date()).getTime()/1000);
    }

    function checkImage(url, load, error){
        if(typeof(window._testImageObject)=='undefined'){
            _testImageObject = new Image();
        }
        _testImageObject.onerror = error;
        _testImageObject.onload = load;
        _testImageObject.src = url;
        return _testImageObject;
    }

    function applyIcon(icon){
        var doc = top.document;
        var link = doc.querySelector("link[rel*='icon']") || doc.createElement('link');
        link.type = 'image/x-png';
        link.rel = 'shortcut icon';
        link.href = icon;
        doc.getElementsByTagName('head')[0].appendChild(link);
        doc.querySelector('.nw-cf-icon').style.backgroundImage = 'url("{0}")'.format(icon);
    }

    var notifyTimer = 0;
    function notify(str, fa, secs){
        if(!str) return;
        var c = '', o = getFrame('overlay');
        if(o){
            switch(secs){
                case 'short':
                    secs = 1;
                    break;
                case 'normal':
                    secs = 3;
                    break;
                case 'long':
                    secs = 7;
                    break;
                case 'wait':
                    secs = 120;
                    c += ' notify-wait';
                    break;
            }
            var a = jQuery(o.document.getElementById('notify-area'));
            a.find('.notify-row').filter(function (){
                return jQuery(this).find('div').text().trim() == str;
            }).add(a.find('.notify-wait')).remove();
            if(fa) fa = '<i class="fa {0}" aria-hidden="true"></i> '.format(fa);
            var n = jQuery('<div class="notify-row '+c+'"><div class="notify">' + fa + ' ' + str + '</div></div>');
            n.prependTo(a);
            top.setTimeout(function (){
                n.hide(400, function (){
                    jQuery(this).remove()
                })
            }, secs * 1000)
        }
    }

    function setTitleData(title, icon) {
        var defaultIcon= 'default_icon.png';
        applyIcon(icon);
        checkImage(icon, function (){}, function (){
            applyIcon(defaultIcon);
        });
        var doc = top.document;
        doc.title = title;
        doc.querySelector('.nw-cf-title').innerText = title;
    }

    function setTitleFlag(fa){
        var t = top.document.querySelector('.nw-cf-icon');
        if(t){
            if(fa){ // fa-circle-o-notch fa-spin
                t.style.backgroundPositionX = '50px';
                t.innerHTML = '<i class="fa {0}" aria-hidden="true"></i>'.format(fa);
            } else {
                t.style.backgroundPositionX = '0px';
                t.innerHTML = '';
            }
        }
    }
    
    function hasValidTitle(){
        var title = top.document.title;
        var stream = currentStream();
        var streamTitle = stream ? stream.name : '';
        return (title && title == streamTitle && title.indexOf('Megacubo')==-1);
    }
    
    function basename(str){
        _str = new String(str); 
        pos = _str.replaceAll('\\', '/').lastIndexOf('/');
        if(pos){
            _str = _str.substring(pos + 1); 
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
    
    function isM3U8(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('\.m3u8?([^A-Za-z0-9]|$)', 'i'));            
    }
    
    function isRTMP(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('^rtmp[a-z]?:', 'i'));            
    }
    
    function isMagnet(url){
        if(typeof(url)!='string') return false;
        return url.substr(0, 7)=='magnet:';            
    }
    
    function isRTSP(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('(^(rtsp|mms)[a-z]?:|\:[0-9]+\/)', 'i'));            
    }
    
    function isLocal(url){
        if(typeof(url)!='string') return false;
        return url.substr(0, 5)=='file:';
    }
    
    function isVideo(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('\.(wm[av]|avi|mp[34]|mk[av]|m4[av]|mov|flv|webm|flac|aac|ogg|ts)', 'i'));            
    }
    
    function isHTML5Video(url){
        if(typeof(url)!='string') return false;
        return url.match(new RegExp('\.(mp[34]|m4[av]|webm|aac|ogg|ts)', 'i'));            
    }
    
    function isLive(url){
        if(typeof(url)!='string') return false;
        return isM3U8(url)||isRTMP(url)||isRTSP(url);            
    }
    
    function isMedia(url){
        if(typeof(url)!='string') return false;
        return isLive(url)||isLocal(url)||isVideo(url);            
    }
    
    function isPlaying(){
        if(top.PlaybackManager){
            return top.PlaybackManager.playing();
        }
    }
    
    function getExt(url){
        return (''+url).split('?')[0].split('#')[0].split('.').pop().toLowerCase();        
    }
    
    function showPlayers(stream, sandbox){
        console.log('showPlayers('+stream+', '+sandbox+')');
        var doc = top.document || document;
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
            return top.document.getElementById(id).contentWindow.window;
        }        
    }

    function callFunctionInWindow(id, _functionName, _args){
        var w = getFrame(id);
        if(w && w[_functionName]){
            w[_functionName].apply(w, _args);
        } else {
            setTimeout(function (){
                callFunctionInWindow(id, _functionName, _args);
            }, 250);
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
        var lang = Store.get('overridden-locale');
        if(!lang || typeof(lang)!='string'){
            lang = getDefaultLocale(short, noUnderline);
        }
        if(!noUnderline){
            lang = lang.replace('-', '_');
        }
        lang = lang.substr(0, short ? 2 : 5);
        return lang;
    }
    
    function removeFolder(location, itself, next) {
        console.log(itself?'REMOVING':'CLEANING', location);
        if (!next) next = function() {};
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

    if ( typeof window.WPDK_FILTERS === 'undefined' ) {
        
        // List of filters
        window.WPDK_FILTERS = {};
        
        // List of actions
        window.WPDK_ACTIONS = {};
        
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
        window._wpdk_add = function( type, tag, function_to_add, priority )
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
        
        /**
         * Hook a function or method to a specific filter action.
         *
         * WPDK offers filter hooks to allow plugins to modify various types of internal data at runtime in a similar
         * way as php `add_filter()`
         *
         * The following example shows how a callback function is bound to a filter hook.
         * Note that $example is passed to the callback, (maybe) modified, then returned:
         *
         * <code>
         * function example_callback( example ) {
         * 	// Maybe modify $example in some way
         * 	return example;
         * }
         * add_filter( 'example_filter', example_callback );
         * </code>
         *
         * @param {string}   tag             The name of the filter to hook the function_to_add callback to.
         * @param {Function} function_to_add The callback to be run when the filter is applied.
         * @param {integer}  priority        Optional. Used to specify the order in which the functions
         *                                   associated with a particular action are executed. Default 10.
         *                                   Lower numbers correspond with earlier execution,
         *                                   and functions with the same priority are executed
         *                                   in the order in which they were added to the action.
         * @return {boolean}
         */
        window.wpdk_add_filter = function( tag, function_to_add, priority )
        {
            _wpdk_add( 'filter', tag, function_to_add, priority );
        };
        
        /**
         * Hooks a function on to a specific action.
         *
         * Actions are the hooks that the WPDK core launches at specific points during execution, or when specific
         * events occur. Plugins can specify that one or more of its Javascript functions are executed at these points,
         * using the Action API.
         *
         * @since 1.6.1
         *
         * @uses _wpdk_add() Adds an action. Parameter list and functionality are the same.
         *
         * @param {string}   tag             The name of the action to which the $function_to_add is hooked.
         * @param {Function} function_to_add The name of the function you wish to be called.
         * @param {integer}  priority        Optional. Used to specify the order in which the functions associated with a
         *                                   particular action are executed. Default 10.
         *                                   Lower numbers correspond with earlier execution, and functions with the same
         *                                   priority are executed in the order in which they were added to the action.
         *
         * @return bool Will always return true.
         */
        window.wpdk_add_action = function( tag, function_to_add, priority )
        {
            _wpdk_add( 'action', tag, function_to_add, priority );
        };
        
        /**
         * Do an action or apply filters.
         *
         * @param {string} type Type of "do" to do 'action' or 'filter'.
         * @param {Array} args Optional. Original list of arguments. This array could be empty for 'action'.
         * @returns {*}
         */
        window._wpdk_do = function( type, args )
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
                    func.apply( null, args );
                    }
                }
                }
            }
            }
        
            if( 'filter' === type ) {
            return args[ 0 ];
            }
        
        };
        
        /**
         * Call the functions added to a filter hook and the filtered value after all hooked functions are applied to it.
         *
         * The callback functions attached to filter hook $tag are invoked by calling this function. This function can be
         * used to create a new filter hook by simply calling this function with the name of the new hook specified using
         * the tag parameter.
         *
         * The function allows for additional arguments to be added and passed to hooks.
         * <code>
         * // Our filter callback function
         * function example_callback( my_string, arg1, arg2 ) {
         *	// (maybe) modify my_string
        *	return my_string;
        * }
        * wpdk_add_filter( 'example_filter', example_callback, 10 );
        *
        * // Apply the filters by calling the 'example_callback' function we
        * // "hooked" to 'example_filter' using the wpdk_add_filter() function above.
        * // - 'example_filter' is the filter hook tag
        * // - 'filter me' is the value being filtered
        * // - arg1 and arg2 are the additional arguments passed to the callback.
        *
        * var value = wpdk_apply_filters( 'example_filter', 'filter me', arg1, arg2 );
        * </code>
        *
        * @param {string} tag     The name of the filter hook.
        * @param {*}      value   The value on which the filters hooked to <tt>tag</tt> are applied on.
        * @param {...*}   varargs Optional. Additional variables passed to the functions hooked to <tt>tag</tt>.
        *
        * @return {*}
        */
        window.wpdk_apply_filters = function( tag, value, varargs )
        {
            return _wpdk_do( 'filter', arguments );
        };
        
        /**
         * Execute functions hooked on a specific action hook.
         *
         * This function invokes all functions attached to action hook tag. It is possible to create new action hooks by
         * simply calling this function, specifying the name of the new hook using the <tt>tag</tt> parameter.
         *
         * You can pass extra arguments to the hooks, much like you can with wpdk_apply_filters().
         *
         * @since 1.6.1
         *
         * @param {string} tag  The name of the action to be executed.
         * @param {...*}   args Optional. Additional arguments which are passed on to the functions hooked to the action.
         *                      Default empty.
         *
         */
        window.wpdk_do_action = function( tag, args )
        {
            _wpdk_do( 'action', arguments );
        };

        window.addAction = window.wpdk_add_action;
        window.addFilter = window.wpdk_add_filter;
        window.doAction = window.wpdk_do_action;
        window.applyFilters = window.wpdk_apply_filters;

    }
    
    function traceback() { 
        try { 
            var a = {}; 
            a.debug(); 
        } catch(ex) {
            return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
        };
    }
    
    var openFileDialogChooser = false;
    function openFileDialog(callback) {
        if(!openFileDialogChooser){ // JIT
            openFileDialogChooser = jQuery('<input type="file" />');
        }
        openFileDialogChooser.off('change');
        openFileDialogChooser.on('change', function(evt) {
            callback(openFileDialogChooser.val());
        });    
        openFileDialogChooser.trigger('click');  
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
        saveFileDialogChooser.on('change', function(evt) {
            callback(saveFileDialogChooser.val());
        });    
        saveFileDialogChooser.trigger('click')
    }

    //chooseFile(function (file){alert(file);window.ww=file});

    function loadLanguage(locales, callback){
        var localeMask = "lang/{0}.json", locale = locales.shift();
        jQuery.getJSON("lang/"+locale+".json", function( data ) {
            Lang = data;
            if(locale == 'en'){
                callback()
            } else {
                jQuery.getJSON("lang/en.json", function( data ) { // always load EN language as fallback for missing translations
                    Lang = Object.assign(data, Lang);
                    callback()
                })
            }
        }).fail(function (jqXHR, textStatus, errorThrown) {
            if(locales.length){
                loadLanguage(locales, callback)
            } else {
                console.error(jqXHR);
                console.error(textStatus);
                console.error(errorThrown);
            }
        })
    }

    var Lang = {};
    jQuery(() => {
        loadLanguage([getLocale(false), getLocale(true), 'en'], () => {            
            jQuery(() => {
                areFramesReady(() => {
                    jQuery(document).triggerHandler('lngload')
                })
            })
        })
    })
    
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
