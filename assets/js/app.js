
var os = require('os'), mkdirp = require('mkdirp'), async = require('async'), jWin = jQuery(window), jB = jQuery('body'), lastOnTop, castManager;
var isSDKBuild = (window.navigator.plugins.namedItem('Native Client') !== null);
var clipboard = gui.Clipboard.get();

//gui.App.setCrashDumpDir(process.cwd());

var miniPlayerRightMargin = 18;

function enterMiniPlayer(){
    miniPlayerActive = true;   
    var ratio = PlaybackManager.getRatio();
    var h = screen.availHeight / 3, w = scaleModeAsInt(PlaybackManager.getRatio()) * h;
    window.resizeTo(w, h);
    window.moveTo(screen.availWidth - w - miniPlayerRightMargin, screen.availWidth - h);
    doAction('miniplayer-on')
}

function leaveMiniPlayer(){
    setFullScreen(false);
    win.setAlwaysOnTop(false);
    doAction('miniplayer-off')
}

addAction('miniplayer-on', () => {
    sound('menu', 9);
    console.log('MP-ON', traceback(), appShown, time());
    jB.add(getFrame('overlay').document.body).addClass('miniplayer');
    win.setAlwaysOnTop(true);
    win.setShowInTaskbar(false);
    // console.log('MP-ON');
    fixMaximizeButton();
    // console.log('MP-ON');
});

addAction('miniplayer-off', () => {
    sound('menu', 9);
    console.log('MP-OFF');
    jB.removeClass('miniplayer');
    //console.log('MP-OFF');
    win.setAlwaysOnTop(false);
    //console.log('MP-OFF');
    win.setShowInTaskbar(true);
    //console.log('MP-OFF');
    fixMaximizeButton();
    //console.log('MP-OFF');
    setTimeout(() => {
        if(!isFullScreen() && !isMiniPlayerActive()){
            showControls()
        }
    }, 500)
})

function toggleMiniPlayer(){
    if(miniPlayerActive){
        leaveMiniPlayer()
    } else {
        enterMiniPlayer()
    }
}

function toggleFullScreen(){
    setFullScreen(!isFullScreen());
}

var useKioskForFullScreen = false;
function escapePressed(){
    //win.leaveKioskMode();
    //win.leaveFullscreen();
    if(isFullScreen()){
        setFullScreen(false)
    } else {
        stop()
    }
}

function backSpacePressed(){
    if(!isMiniPlayerActive()){
        console.warn(document.URL, document.body, Menu);
        if(Menu.path){
            console.warn(document.URL, document.body, Menu);
            Menu.back()
        } else {
            if(areControlsActive() && !isStopped()){
                hideControls()
            } else {
                showControls()
            }
        }
    }
}

function isMaximized(){
    if(win.x > 0 || win.y > 0) return false;
    var w = top || window, widthMargin = 6, heightMargin = 6;
    return (w.outerWidth >= (screen.availWidth - widthMargin) && w.outerHeight >= (screen.availHeight - heightMargin));
}

var leftWindowDiff = 0, leftWindowDiffTimer = 0;
nw.Window.open('blank.html', {frame: false, transparent: true}, function (pop){
    pop.maximize();
    pop.hide();
    leftWindowDiffTimer = setInterval(() => {
        if(pop.x <= 0){
            clearInterval(leftWindowDiffTimer);
            pop.window.opener.leftWindowDiff = pop.x;
            pop.close()
        }
    })
});

function maximizeWindow(){
    win.setMaximumSize(0, 0);
    showRestoreButton();
    win.x = win.y = leftWindowDiff;
    setTimeout(() => {
        win.width = screen.availWidth + (leftWindowDiff * -2);
        win.height = screen.availHeight + (leftWindowDiff * -2);
        win.x = win.y = leftWindowDiff;
    }, 10)
}

function minimizeWindow(){
    if(top){
        if(isMiniPlayerActive()){
            win.minimize();
        } else {
            top.enterMiniPlayer();
        }
    }
}

var allowAfterExitPage = false;
setTimeout(() => { // avoid after exit page too soon as the program open
    allowAfterExitPage = true;
}, 10000);

function afterExitURL(){
    return "http://app.megacubo.net/out.php?ver={0}&inf={1}".format(installedVersion, verinf());
}

function afterExitPage(){
    if(allowAfterExitPage && installedVersion){
        var lastTime = Store.get('after-exit-time'), t = time();
        if(!lastTime || (t - lastTime) > (6 * 3600)){
            Store.set('after-exit-time', t);
            gui.Shell.openExternal(afterExitURL())
        }
    }
}

addAction('miniplayer-on', afterExitPage);
addAction('appUnload', afterExitPage);

function shutdown(){
    var cmd, secs = 7, exec = require("child_process").exec;
    if(process.platform === 'win32') {
        cmd = 'shutdown -s -f -t '+secs+' -c "Shutdown system in '+secs+'s"';
    } else {
        cmd = 'shutdown -h +'+secs+' "Shutdown system in '+secs+'s"';
    }
    return exec(cmd)
}

function fixMaximizeButton(){
    if(typeof(isMaximized)!='undefined'){
        if(isMaximized() || miniPlayerActive){
            showRestoreButton()
        } else {
            showMaximizeButton()
        }
    }
}

function setHardwareAcceleration(enable){
    var manifest = gui.App.manifest;    
    var enableFlags = [];
    var disableFlags = ['--disable-gpu', '--force-cpu-draw'];
    enableFlags.concat(disableFlags).forEach((flag) => {
        manifest['chromium-args'] = manifest['chromium-args'].replace(flag, '')
    });
    (enable?enableFlags:disableFlags).forEach((flag) => {
        manifest['chromium-args'] = manifest['chromium-args'] += ' '+flag;
    });
    manifest['main'] = basename(manifest['main']);
    fs.writeFile('package.json', JSON.stringify(manifest, null, 4), () => {})
}

function showMaximizeButton(){
    var e = document.querySelector('.nw-cf-maximize');
    if(e){ // at fullscreen out or unminimize the maximize button was disappearing
        e.style.display = 'inline-block';
        document.querySelector('.nw-cf-restore').style.display = 'none';
    }
}

function showRestoreButton(){
    var e = document.querySelector('.nw-cf-restore');
    if(e){
        e.style.display = 'inline-block';
        document.querySelector('.nw-cf-maximize').style.display = 'none';
    }
}

function patchMaximizeButton(){
    
    var old_element = document.querySelector(".nw-cf-maximize");
    if(!old_element) return setTimeout(patchMaximizeButton, 250);
    var new_element = old_element.cloneNode(true);
    old_element.parentNode.replaceChild(new_element, old_element);
    new_element.addEventListener('click', maximizeWindow);
    
    old_element = document.querySelector(".nw-cf-restore");
    old_element.addEventListener('click', function (){
        setTimeout(fixMaximizeButton, 50);
        jQuery(window).trigger('restore')
    });
    
    patchMaximizeButton = function (){};
}

function playExternal(url){
    if(!url){
        if(areControlsActive()){
            var entry = selectedEntry();
            if(entry && entry.type=='stream'){
                url = entry.url;
            }
        }
        if(!url){
            var c = currentStream();
            if(typeof(c)!='object') return;
            url = c.url;
        }
    }
    if(isLocal(url)){
        //gui.Shell.showItemInFolder(url);
        gui.Shell.openItem(url);
    } else {
        if(isRTMP(url)) {
            url = 'https://play.megacubo.tv/rtmp-player.html?url='+encodeURIComponent(url);
        } else if(isM3U8(url)) {
            url = 'https://play.megacubo.tv/index.html?url='+encodeURIComponent(url);
        }
        gui.Shell.openExternal(url)
    }
    stop();
}

var playPauseNotification = notify('...', 'fa-check', 'forever');
playPauseNotification.hide();

function playPause(set){
    if(!PlaybackManager.activeIntent){
        return;
    }
    if(PlaybackManager.playing()){
        PlaybackManager.pause()
    } else {
        PlaybackManager.play()
    }
}

function playPauseNotifyContainers(){
    var sel = jQuery(document.body), o = getFrame('overlay');
    if(o && o.document && o.document.body){
        sel = sel.add(o.document.body)
    }
    if(typeof(PlaybackManager) != 'undefined' && PlaybackManager.activeIntent){
        if(PlaybackManager.activeIntent.type == 'frame'){
            if(PlaybackManager.activeIntent.fittedScope && PlaybackManager.activeIntent.fittedScope.document && PlaybackManager.activeIntent.fittedScope.document.body){
                sel = sel.add(PlaybackManager.activeIntent.fittedScope.document.body)
            }
        } else {
            var p = getFrame('player');
            if(p && p.document && p.document.body){
                sel = sel.add(p.document.body)
            }
        }
    }
    return sel;
}

function playPauseNotify(){
    if(!top) { // unloading raises "Cannot read property 'window' of null" sometimes
        return;
    }
    if(!PlaybackManager.activeIntent) {
        playPauseNotifyContainers().removeClass('playing').removeClass('paused');
        return;
    }
    var c = currentStream();
    if(c) {
        c = c.name;
    } else {
        c = Lang.PLAY;
    }
    //console.log('NOTIFY', traceback());
    if(PlaybackManager.playing()) {
        //console.log('NOTIFY1');
        playPauseNotifyContainers().removeClass('paused').addClass('playing');
        playPauseNotification.update(c, PlaybackManager.activeIntent.entry.logo || 'fa-play faclr-green', 4)
        //console.log('NOTIFY');
    } else {
        //console.log('NOTIFY2');
        playPauseNotifyContainers().removeClass('playing').addClass('paused');
        playPauseNotification.update(Lang.PAUSE, 'fa-pause', 'short')
        //console.log('NOTIFY');
    }
}

var decodeEntities = (() => {
    // this prevents any overhead from creating the object each time
    var element = document.createElement('div');

    // regular expression matching HTML entities
    var entity = new RegExp('&(?:#x[a-f0-9]+|#[0-9]+|[a-z0-9]+);?', 'gi');

    return (function (str) {
        // find and replace all the html entities
        str = (str||'').replace(entity, function(m) {
            element.innerHTML = m;
            return element.textContent;
        });

        // reset the value
        element.textContent = '';

        return str;
    });
})();

function getIntentFromURL(url){
    var urls, intent = false, frameIntents = PlaybackManager.query({type: 'frame'});
    if(url){
        url = url.split('#')[0];
        for(var i=0; i<frameIntents.length; i++){
            urls = getFrameURLs(frameIntents[i].frame);
            if(matchURLs(url, urls)){
                intent = frameIntents[i];
                break;
            }
        }
    }
    return intent;
}

function callSideload(url, referer) {
    if(getDomain(url).indexOf('127.0.0.1') == -1 && (!referer || getDomain(referer).indexOf('127.0.0.1') == -1)){
        var intent = false;
        if(referer){
            intent = getIntentFromURL(referer)
        }
        if(!intent){
            intent = getIntentFromURL(url)
        }
        if(intent){
            console.log('SIDELOADPLAY CALLING', url);
            intent.sideload(url)
        } else {
            console.warn('SIDELOADPLAY FAILURE, INTENT NOT FOUND', url, referer)
        }
    }
}

var requestIdReferersTable = {}, requestIdReferersTableLimit = 256, requestIdMap = {}, requestCtypeMap = {}, requestIdMapLimit = 256, minVideoContentLength = (10 * 1024);
var capturingFolder = 'stream/session';

if(fs.existsSync(capturingFolder)) {
    removeFolder(capturingFolder, false, () => {}) // just empty the folder
} else {
    mkdirp(capturingFolder)
}

function shouldCapture() {
    return hasAction('media-received');
}

function bindWebRequest(){
    
    var debug = false;

    function requestIdToKey(rid){
        return String(rid).replace('.', '');
    }

    chrome.downloads.onCreated.addListener((item) => {
        chrome.downloads.cancel(item.id);
        if(item.state == "complete"){
            chrome.downloads.removeFile(item.id)
        }
    });

    chrome.webRequest.onBeforeRequest.addListener(
        (details) => { 
            if(details.initiator){
                if(details.initiator.substr(0, 7) == 'chrome-'){ //chrome-extension://
                    return {};
                } else {
                    if(details.url.match(new RegExp('#(nosandbox|nofit|catalog|off)'))){
                        return {};
                    } else if(intent = getIntentFromURL(details.initiator)){
                        if(intent.entry.url.match(new RegExp('#(nosandbox|nofit|catalog|off)'))){
                            return {};
                        }
                    }
                }
            }
            console.log("Canceling: " + details.url, details);
            return {cancel: true};
        }, { urls: ["<all_urls>"], types:["image"] }, ['blocking']
    );

    if(typeof(blocked_domains)=='object' && jQuery.isArray(blocked_domains) && blocked_domains.length){
        chrome.webRequest.onBeforeRequest.addListener(
            (details) => {
                if(debug){
                    console.log("blocking:", details);
                }
                /*
                if(typeof(details['frameId'])!='undefined' && details.frameId && details.type=='sub_frame'){
                    return {redirectUrl: top.document.URL.replace('index.', 'block.')};
                }
                */
                return {cancel: true};
            },
            {urls: blocked_domains},
            ["blocking"]
        );
    }

    chrome.webRequest.onBeforeSendHeaders.addListener(
        function(details) {
            if(debug){
                console.log('BeforeSendHeaders', details.url);
                console.log(details);
            }
            var rid = requestIdToKey(details.requestId);
            //requestCtypeMap = sliceObject(requestCtypeMap, requestIdMapLimit * -1);
            requestIdMap = sliceObject(requestIdMap, requestIdMapLimit * -1);
            requestIdMap[rid] = details.url;
            if(details.url.substr(0, 4)=='http'){
                for(var i=0;i<details.requestHeaders.length;i++){
                    if(debug){
                        console.log(details.requestHeaders[i].name);
                    }
                    if(["X-Frame-Options"].indexOf(details.requestHeaders[i].name) != -1){
                        delete details.requestHeaders[i];
                        details.requestHeaders = details.requestHeaders.filter(function (item) {
                            return item !== undefined;
                        });
                    } else if(["Referer", "Origin"].indexOf(details.requestHeaders[i].name) != -1){
                        requestIdReferersTable = sliceObject(requestIdReferersTable, requestIdReferersTableLimit * -1);
                        requestIdReferersTable[rid] = details.requestHeaders[i].value;
                        if(debug){
                            console.log('BeforeRequest', details.url, details.requestId, requestIdReferersTable[rid]);
                            //details.requestHeaders.push({name:"dummyHeader",value:"1"});
                        }
                    }
                }
                if(requestIdReferersTable[rid] && isM3U8(details.url)){
                    callSideload(details.url, requestIdReferersTable[rid])
                }
            }
            return {requestHeaders: details.requestHeaders};
        }, {urls: ["<all_urls>"]}, ["requestHeaders", "blocking"]
    );

    chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
            var headers = details.responseHeaders, rid = requestIdToKey(details.requestId);
            if(debug){
                console.log('onHeadersReceived', details.url, requestIdReferersTable[rid], details);
            }
            if(details.url.substr(0, 4)=='http'){ // if is HTTP, comes from a frame intent
                var ctype = '', isVideo = false, isAudio = false, isM3U8 = false, isDocument = false, isPartial = (details.statusCode == 206), contentLength = 0;
                var referer = requestIdReferersTable[rid] || details.initiator || '';
                var origin = (details.initiator || details.url).match(new RegExp('[a-z]+?://[^?#/]+')); // (referer || 
                if(origin){
                    origin = origin[0];
                } else {
                    origin = 'same-origin';
                }
                for(var i=0; i < headers.length; i++){
                    let n = headers[i].name.toLowerCase();
                    if (['x-frame-options', 'content-security-policy', 'x-xss-protection', 'x-content-type-options'].indexOf(n) != -1) {
                        headers.splice(i, 1);
                        i = 0;
                        continue; // no problem to skip the next checkings
                    } else if(['access-control-allow-origin'].indexOf(n) != -1){
                        headers[i].value = origin;
                    }
                    if((!isPartial || !contentLength) && ["content-length"].indexOf(n) != -1){
                        contentLength = headers[i].value;
                    } else if(["content-range"].indexOf(n) != -1){
                        if(headers[i].value.indexOf('/')!=-1){
                            var l = parseInt(headers[i].value.split('/')[1].trim());
                            if(l > 0){
                                contentLength = l;
                            }
                        }
                    } else if(["content-type"].indexOf(n) != -1){
                        ctype = headers[i].value;
                    }
                }
                requestCtypeMap[details.url] = ctype;
                headers.push({name: 'X-Content-Type-Options', value: 'no-sniff'});
                //headers.push({name: 'X-Frame-Options', value: 'ALLOW-FROM '+origin}); // not supported for Chrome
                isVideo = ctype.match(new RegExp('(video/(mp4|MP2T)|mpeg)', 'i'));
                isM3U8 = ctype.toLowerCase().indexOf('mpegurl') != -1;
                isDocument = ctype.indexOf('/html') != -1;
                isAudio = ctype.indexOf('audio/') != -1;
                if(debug){
                    console.log('onHeadersReceived 2', details.url, origin, details, ctype, isVideo, isM3U8, isDocument, isAudio);
                }
                if(details.frameId){ // comes from a frame
                    if(isM3U8 || (isVideo && contentLength > minVideoContentLength)){
                        if(getExt(details.url)!='ts'){ // from a frame, not a TS
                            callSideload(details.url, referer)
                        }
                    }
                }
            } else {
                //console.warn('SKIPPED', details)
            }
            return {responseHeaders: headers};
        }, {urls: ["<all_urls>"]}, ["blocking", "responseHeaders"]
    );

    function chromeDebuggerEventHandler(debuggeeId, message, params) {
        var rid = requestIdToKey(params.requestId);
        if(message == "Network.responseReceived" && params.response){
            requestIdMap[rid] = params.response.url;
        }
        if(shouldCapture() && message == 'Network.loadingFinished') { 
            var shouldSave = ['ts'].indexOf(getExt(requestIdMap[rid])) != -1;
            if(!shouldSave){
                //console.warn('OOOOOOOOOOOOO', requestCtypeMap, requestIdMap[rid], typeof(requestCtypeMap[requestIdMap[rid]]));
                if(typeof(requestCtypeMap[requestIdMap[rid]])!='undefined'){
                    if(requestCtypeMap[requestIdMap[rid]].match(new RegExp('(video\/)', 'i'))){
                        shouldSave = true;
                    }
                }
            }
            if(debug){
                console.log('FINISHED', params, requestIdMap[rid], shouldSave);
            }
            if(typeof(requestIdMap[rid])!='undefined' && shouldSave){
                if(requestIdMap[rid].substr(0, 7)=='chrome-'){ // chrome-extension://dfaejjeepofbfhghijpmopheigokobfp/
                    var local = requestIdMap[rid].replace(new RegExp('chrome\-extension://[^/]+/'), '');
                    if(debug){
                        console.log('LOCAL', requestIdMap[rid], local);
                    }
                    doAction('media-save', requestIdMap[rid], local, 'path');
                } else {
                    if(debug){
                        console.log('REMOTE', requestIdMap[rid], local);
                    }
                    chrome.debugger.sendCommand({
                        tabId: debuggeeId.tabId
                    }, "Network.getResponseBody", {
                        "requestId": params.requestId
                    }, function(response) {
                        if(typeof(response)!='undefined') {
                            doAction('media-save', requestIdMap[rid], bufferize(response), 'content');
                            response = null;
                        }
                    })
                }
            }
        }
    }

    chrome.tabs.getCurrent(function(currentTab) {
        chrome.debugger.attach({ //debug at current tab
            tabId: currentTab.id
        }, "1.0", function () {    
            chrome.debugger.sendCommand({ tabId: currentTab.id }, "Network.enable");  //first enable the Network
            chrome.debugger.onEvent.addListener(chromeDebuggerEventHandler);  
            if(!isSDKBuild){
                try{
                    win.closeDevTools()
                }catch(e){}
            }
        })
        addAction('appUnload', () => {
            if(currentTab && currentTab.id){
                chrome.debugger.detach({ // is this the right way?!
                    tabId: currentTab.id
                })
            }
        })
    })
}

function getFrameURLs(frame){
    var urls = [];
    if(frame){
        urls.push(frame.src);
        if(frame.contentWindow){
            try {
                var url = frame.contentWindow.document.URL;
                if(url){
                    if(urls.indexOf(url) == -1){
                        urls.push(url)
                    }
                    var frames = frame.contentWindow.document.querySelectorAll('iframe, frame');
                    for(var i=0; i<frames.length; i++){
                        let nurls = getFrameURLs(frames[i]);
                        nurls.forEach((url) => {
                            if(urls.indexOf(url) == -1){
                                urls.push(url)
                            }
                        })
                    }
                }
            } catch(e) {

            }
        }
    }
    return urls;
}

function matchURLs(url, urls){
    url = removeQueryString(url);
    for(var i=0; i<urls.length; i++){
        if(urls[i].indexOf(url)!==-1){
            return true;
            break;
        }
    }
}

function matchFrameURLs(url, frame){
    var urls = getFrameURLs(frame);
    return matchURLs(url, urls)
}

function saveAs(file, callback){
    var _callback = (file) => {
        isWritable(dirname(file), (err, writable) => {
            if(writable){
                callback(file)
            } else {
                alert(Lang.FOLDER_NOT_WRITABLE);
                saveAs(file, callback)
            }
        })
    }
    if(isFullScreen() && file){
        return _callback(file)
    }
    if(!file) file = '';
    jQuery('<input id="saveas" type="file" nwsaveas />').
        prop('nwsaveas', basename(file)).
        prop('nwworkingdir', dirname(file)).
        one('change', function (){
            var chosenFile = this.value;
            if(!chosenFile){
                chosenFile = file;
            }
            _callback(chosenFile)
        }).
        trigger('click')
} 

function pickColor(callback, defaultColor){
    jQuery('#pick-color').remove();
    jQuery('<input type="color" id="pick-color" />').
        hide().
        val(defaultColor).
        appendTo('body').
        on('change', (e) => {
            var chosenColor = e.target.value;
            if(!chosenColor){
                chosenColor = '';
            }
            callback(chosenColor)
        }).trigger('click')
}

function moveFile(from, to, callback){
    if(from == to){
        callback(to)
    } else {
        copyFile(from, to, function (err){
            if (err){
                fs.unlink(to);
                if(callback){
                    callback(from)
                }
            } else {
                fs.unlink(from, function (){
                    if(callback){
                        callback(to)
                    }
                })
            }
        })
    }
}

function makeModal(content){
    jQuery(top.document).find('body').addClass('modal');
    jQuery(content).appendTo(jQuery('#modal-overlay > div > div').html(''));
    jQuery('#modal-overlay').show()
}

function modalClose(){
    jQuery(top.document).find('body').removeClass('modal');
    jQuery('#modal-overlay').hide()
}

function modalConfirm(question, answers, closeable){
    var a = [];
    answers.forEach((answer) => {
        a.push(jQuery('<button class="button">'+answer[0]+'</button>').on('click', answer[1]))
    });
    var b = jQuery('<div class="prompt prompt-'+a.length+'-columns">'+
                '<span class="prompt-header">'+nl2br(question)+'</span>'+
                '<span class="prompt-footer"></span></div>');
    b.find('.prompt-footer').append(a);
    makeModal(b, closeable);
    top.focus()
}

function modalPrompt(question, answers, placeholder, value, notCloseable){    
    sound('warn', 16);
    var a = [];
    answers.forEach((answer) => {
        a.push(jQuery('<button class="button">' + answer[0] + '</button>').on('click', answer[1]))
    });
    var b = jQuery('<div class="prompt prompt-' + a.length + '-columns">'+
        (notCloseable ? '' : '<span class="prompt-close"><a href="javascript:modalClose();void(0)"><i class="fas fa-times-circle" aria-hidden="true"></i></a></span>')+
        '<span class="prompt-header">' + nl2br(question) + '</span>' +
        '<input type="text" />' +
        '<span class="prompt-footer"></span></div>');

    b.find('.prompt-footer').append(a);
    var t = b.find('input');
    if(placeholder){
        t.prop('placeholder', placeholder)
    }
    if(value){
        t.val(value)
    }
    makeModal(b);
    if(t.length == 1){
        t.on('blur', function (){
            jQuery(this).trigger('focus')
        })
        t.keyup(function(event) {
            if (event.keyCode === 13) {
                a.pop().click()
            } else if (event.keyCode === 27 && !notCloseable) {
                modalClose()
            }
        });
    }
    top.focus();
    setTimeout(function (){
        var n = t.get(0);
        n.focus();
        n.select()
    }, 400)
}

function modalPromptVal(){
    return jQuery('.prompt').find('input, textarea').val().trim() || '';
}

function shouldOpenSandboxURL(url, callback){
    jQuery.get(url, function (response){
        console.log(url, response.length);
        var m = response.match(new RegExp('(\.m3u8|rtmp:|jwplayer|flowplayer|Clappr|<video)', 'i'));
        if(m){
            console.log('POPUP ALLOWED', url);
            console.log(m);
            callback(url)
        }
    })
}

function testEntry(stream, success, error, returnSucceededIntent, callback){
    var resolved = false, intents = [];
    if(isMagnet(stream.url) || isMega(stream.url) || isYT(stream.url)){
        success();
        return intents;
    }
    var checkr = () => {
        if(resolved) return;
        var worked = false, complete = 0, succeededIntent = null;
        for(var i=0; i<intents.length; i++){
            if(!intents[i]) continue;
            if(intents[i].started || intents[i].ended || intents[i].error){
                complete++;
            }
            if(!worked && intents[i].started && !intents[i].ended && !intents[i].error){
                if(returnSucceededIntent){
                    intents[i].shadow = false;
                    intents[i].manual = true;
                    succeededIntent = intents[i];
                }
                worked = true;
            }
        }
        console.warn('CHECKR', intents, complete, worked);
        if(worked || complete == intents.length){
            resolved = true;
            for(var i=0; i<intents.length; i++){ // ready
                if(intents[i].shadow && (!succeededIntent || (intents[i].entry.url != succeededIntent.entry.url))){
                    intents[i].destroy()
                }
            }   
            (worked ? success : error)(succeededIntent)
        }
    }
    createPlayIntent(stream, {shadow: true, manual: false, start: checkr, error: checkr, ended: checkr}, (err, intent) => {
        if(intent){
            intents.push(intent)
        }
    })
}

var inFullScreen = false;

function isFullScreen(){
    return ( win && win.width >= screen.width && win.height >= screen.height) || !!(win.isKioskMode || win.isFulscreen)
}

function maxPortViewSize(width, height){
    return;
    if(process.platform === 'win32' && parseFloat(os.release(), 10) > 6.1 && width && height) {
        // win.setMaximumSize(Math.round(width), Math.round(height));
        // win.setMaximumSize(screen.width, screen.height);
    }
}

var enableSetFullScreenWindowResizing = false;

function setFullScreen(enter){
    console.warn('setFullscreen()', enter);
    if(!enter){
        inFullScreen = miniPlayerActive = false;
        doAction('miniplayer-off');
        win.leaveKioskMode(); // bugfix, was remembering to enter fullscreen irreversibly
        win.leaveFullscreen();
        if(enableSetFullScreenWindowResizing){
            var s = initialSize();
            if(document.readyState.indexOf('in')==-1){
                maxPortViewSize(screen.availWidth + 15, screen.availHeight + 14);
            } else {
                maxPortViewSize(s.width, s.height);						
            }
            centralizedResizeWindow(s.width, s.height, false)
        }
        // console.log('SIZE', s.width, s.height);
        if(typeof(window['fixMaximizeButton'])=='function'){
            fixMaximizeButton()
        }
    } else {
        inFullScreen = true;
        maxPortViewSize(screen.width + 1, screen.height + 1);
        if(useKioskForFullScreen){
            win.enterKioskMode() // bugfix, was remembering to enter fullscreen irreversibly
        } else {
            win.enterFullscreen()
        }
        notify(Lang.EXIT_FULLSCREEN_HINT, 'fa-info-circle', 'normal');
        hideControls()
    }
    var f = function (){
        var _fs = isFullScreen();
        win.setAlwaysOnTop(_fs || miniPlayerActive);
        win.requestAttention(_fs);
        if(_fs) {
            win.blur();
            win.focus()
        }
    };
    setTimeout(f, 500);
    setTimeout(f, 1000);
    setTimeout(f, 2000);
    win.show()
}

function restoreInitialSize(){
    console.warn('restoreInitialSize()');
    jQuery('body').add(getFrame('overlay').document.body).removeClass('miniplayer');
    setFullScreen(false)
}

function centralizeWindow(w, h){
    console.warn('centralizeWindow()');
    var x = Math.round((screen.availWidth - (w || window.outerWidth)) / 2);
    var y = Math.round((screen.availHeight - (h || window.outerHeight)) / 2);
    //window.moveTo(x, y)
    win.x = x;
    win.y = y;
    console.log('POS', x, y);
}

function verinf(){
    return applyFilters('verinf', '')
}

function sendStats(action, data){
    if(!data){
        data = {};
    }
    data.uiLocale = getLocale(false, false);
    data.arch = (process.arch == 'ia32') ? 32 : 64;
    data.ver = installedVersion || 0;
    data.verinf = verinf();
    if(data.source && !isListSharingActive() && getSourcesURLs().indexOf(data.source) != -1){
        console.warn('Source URL not shareable.');
        data.source = '';
    }
    var postData = jQuery.param(data);
    var options = {
        hostname: 'app.megacubo.net',
        port: 80,
        path: '/stats/'+action,
        family: 4, // https://github.com/nodejs/node/issues/5436
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Cache-Control': 'no-cache'
        }
    }
    console.log('sendStats', options, postData, traceback());
    var req = http.request(options, function (res){
        res.setEncoding('utf8');
        var data = '';
        res.on('data', function (d){
            data += d;
        });
        res.on('end', function (){
            console.log('sendStats('+action+')', data);
        });
    });    
    req.on('error', (e) => {
        console.log('Houve um erro', e);
    });
    req.write(postData);
    req.end()
}

function sendStatsPrepareEntry(stream){
    if(!stream || typeof(stream)!='object'){
        stream = {};
    }
    if(typeof(stream.source)!='undefined' && stream.source){
        stream.source_nam = getSourceMeta(stream.source, 'name');
        stream.source_len = getSourceMeta(stream.source, 'length');
        if(isNaN(parseInt(stream.source_len))){
            stream.source_len = -1; // -1 = unknown
        }
    }
    return stream;
}

var autoCleanHintShown = false;
patchMaximizeButton();

jQuery(() => {
    gui.Window.get().on('close', closeApp);
    jQuery("#menu-trigger-icon").on('mousedown mouseup', (e) => {
        showControls();
        e.preventDefault(); // don't pause on clicking
        e.stopPropagation()
    })
});

win.on('new-win-policy', function(frame, url, policy) {
    if(url.substr(0, 19) != 'chrome-extension://'){
        policy.ignore(); // IGNORE = BLOCK
        console.log('POPUP BLOCKED', frame, url, policy);    
        // CHECK AFTER IF IT'S A RELEVANT POPUP
        setTimeout(() => {
            shouldOpenSandboxURL(url, function (url){
                document.querySelector('iframe#sandbox').src = url;
            })
        }, 0)
    } else {
        policy.forceNewWindow();
        setNewWindowManifest({show: false})
    }
})

win.on('restore', () => {
    fixMaximizeButton() // maximize icon disappearing on unminimize
})

win.on('close', () => {
    precloseApp();
    closeApp(true); // force parameter needed to avoid looping
    //gui.App.closeAllWindows();
    //nw.App.quit();
    //process.exit()
})

var preClosingWindow = false, closingWindow = false;

function killCrashpad(){    
    var ps = require('ps-node');
    ps.lookup({
        command: 'megacubo',
        arguments: 'crashpad'
    }, (err, resultList ) => {
        if (err) {
            throw new Error( err );
        }    
        resultList.forEach(( process ) => {
            if( process ){
                console.log( 'PID', process.pid );
                ps.kill(process.pid, ( err ) => {
                    if (err) {
                    throw new Error( err );
                    } else {
                        console.log( 'Crashpad unloaded!', process.pid );
                    }
                });
            }
        });
    })
}

addAction('appUnload', killCrashpad);

function precloseApp(){
    if(!preClosingWindow){
        doAction('appUnload');
        preClosingWindow = true;
        fixLocalStateFile();
        console.warn('precloseApp()');
        stop();    
        /*
        */
    }
}

jQuery(window).on('beforeunload unload', precloseApp);

function closeApp(force){
    var doClose = (force === true || applyFilters('closeApp', true));
    if(doClose){
        precloseApp();
        if(!closingWindow && force !== true){
            console.warn('CASE A');
            closingWindow = true;
            win.close()
        } else {
            console.warn('CASE B');
            win.close(true)
        }
    }
}

var $tray = false;

function showInTray() {
    if(!$tray){
        doAction('beforeTray');
        var nm = applyFilters('appTrayTitle', appName());
        $tray = new nw.Tray({
            title: nm, 
            icon: 'default_icon.png', 
            click: () => {
                restoreFromTray()
            }
        });
        $tray.on('click', restoreFromTray);
        var menu = new nw.Menu();
        menu.append(new nw.MenuItem({
            label: nm,
            click: restoreFromTray
        }));
        menu.append(new nw.MenuItem({
            label: Lang.CLOSE,
            click: () => {
                removeFromTray();
                closeApp(true)
            }
        }));
        $tray.menu = menu;
        $tray.tooltip = gui.App.manifest.window.title;
    }
}

function closeToTray(keepPlayback) {
    if(!$tray || isMiniPlayerActive){
        if(keepPlayback !== true){
            PlaybackManager.fullStop()
        }
        if(!$tray){
            showInTray()
        }
        win.hide()
    }
}

function removeFromTray(){
    if($tray){
        $tray.remove();
        $tray = false;
        win.setShowInTaskbar(true)
    }
}

function restoreFromTray(){
    win.show();
    if($tray){
        removeFromTray()
    }
    if(isMiniPlayerActive){
        setFullScreen(false)
    }
}

gui.App.on('open', restoreFromTray);
nw.App.on('open', restoreFromTray);

addAction('miniplayer-on', showInTray);
addAction('miniplayer-off', removeFromTray);
addAction('appUnload', removeFromTray);

function fixLocalStateFile(){
    var file = gui.App.dataPath;
    if(basename(file)=='Default'){
        file = dirname(file)
    }
    file += '\\Local State';
    console.log('fixLocalStateFile()', file);
    if(fs.existsSync(file)){
        var content = fs.readFileSync(file);
        console.log('fixLocalStateFile()', content);
        if(content){
            var j = JSON.parse(content);
            if(j && typeof(j['profile'])!='undefined'){
                j['profile']['info_cache'] = {};
                content = JSON.stringify(j);
                if(content){
                    console.log('fixLocalStateFile() SUCCESS');
                    fs.writeFileSync(file, content)
                } else {
                    console.log('fixLocalStateFile() ERR');
                    fs.unlink(file)
                }
            } else {
                console.log('fixLocalStateFile() ERR');
                fs.unlink(file)
            }
        }
    }
    console.log('fixLocalStateFile() OK');
}

function minimizeCallback() {
    console.log('Window is minimized');
    if(isMiniPlayerActive()){
        removeFromTray()
    } else {
        restoreInitialSize();
        enterMiniPlayer()
    }
}

function updateControlBarPos(scope, player){
    if(scope && scope.document && scope.document.documentElement){
        var controlBarHeight = 36, controlBarMargin = 0,  t = (
            jQuery(scope.document).height() - 
            player.offset().top
        ) - (controlBarHeight + (controlBarMargin * 2));
        var rule = ' video::-webkit-media-controls-panel { ';
        if(controlBarMargin){
            rule += ' width: calc(100% - '+(controlBarMargin * 2)+'px); margin: '+controlBarMargin+'px; border-radius: 3px;';
        } else {
            rule += ' width: 100%; margin: 0; border-radius: 0; ';
        }
        rule += 'top: '+t+'px; } ';
        if(!scope.__lastControlBarPosRule || scope.__lastControlBarPosRule != rule){
            scope.__lastControlBarPosRule = rule;
            stylizer(rule, 'video-control-bar-pos', scope);
        }
    }
}

function logoLoad(image, name){
    var entries = fetchSharedListsSearchResults(null, 'live', name, true, true);
    var check = () => {
        var entry = entries.shift();
        checkImage(entry.logo, () => {
            image.src = entry.logo;
        }, check)
    }
    check()
}

var tb = jQuery(top.document).find('body');
function prepareVideoObject(videoElement, intent){ // intent is empty for native player
    if(!videoElement || !videoElement.ownerDocument){
        return;
    }
    var doc = videoElement.ownerDocument, ps = doc.getElementById('player-status');
    if(!ps){
        var scope = doc.defaultView;
        var seeking, fslock, paused, wasPaused, fstm = 0, player = jQuery(videoElement), b = jQuery(doc.querySelector('body')), f = (e) => {
            e.preventDefault();
            e.stopPropagation();
            top.delayedPlayPauseNotify();
            return false;
        };
        if(videoElement.getAttribute('controls') !== null){
            videoElement.removeAttribute('controls')
        }
        videoElement.setAttribute('controls', 'controls');
        if(videoElement.getAttribute('controlsList') !== null){
            videoElement.removeAttribute('controlsList')
        }
        videoElement.setAttribute('controlsList', 'nodownload');
        if(videoElement.paused){
            videoElement.play()
        }
        videoElement.onclick = videoElement.onmousedown = videoElement.onmouseup = null;
        videoElement.style.background = '#000';
        var videoObserver, timer = 0, ignoreResizing, f = () => {
            //console.warn('UPDATE', scope, player);
            if(top && scope && scope.clearTimeout && player){
                scope.clearTimeout(timer);
                timer = scope.setTimeout(() => {
                    videoObserver.disconnect(); // ensure prevent looping
                    scope.clearTimeout(timer);
                    updateControlBarPos(scope, player);
                    videoObserver.observe(videoElement)
                }, 200)
            }
        }
        fs.readFile('assets/css/player.src.css', (err, content) => {
            if(content){
                console.log('Applying CSS...');
                stylizer(parseTheming(content), 'player-css', scope);
                console.log('Applied CSS.');
            }
        });
        videoObserver = new ResizeObserver(f);
        videoObserver.observe(videoElement);
        jQuery(scope).on('load resize', f);
        var mouseDownTime = 0, allowTimeoutReload = (intent && intent.type == 'frame' && !isVideo(videoElement.src)), reloadTimer = 0, reloadTimeout = 10000;
        videoElement.volume = Config.get('volume');
        jQuery(videoElement).
            on('wheel', (event) => {
                if(event.ctrlKey){
                    if(event.originalEvent.deltaY < 0){
                        changeScaleMode(true)
                    } else {
                        changeScaleMode(false)
                    }
                } else {
                    if(event.originalEvent.deltaY < 0){
                        seekForward()// wheeled up
                    } else {
                        seekRewind()
                    }
                }
            }).
            on('waiting', (event) => {
                if(!seeking){
                    if(PlaybackManager.activeIntent){
                        b.add(tb).addClass('loading').removeClass('paused')
                    }
                    if(allowTimeoutReload){
                        if(!reloadTimer){
                            reloadTimer = setTimeout(() => {
                                if(scope && scope.location && scope.location.reload){
                                    console.warn('Video loading timeout, reloading page.');
                                    scope.location.reload();
                                    setTimeout(() => {
                                        intent.fittedScope = false;
                                        intent.fittedElement = false;
                                        intent.videoElement = false;
                                        intent.runFitter()
                                    }, 2000)
                                }
                            }, reloadTimeout)
                        }
                    }
                }
            }).
            on('canplaythrough playing', (event) => {
                if(reloadTimer){
                    clearTimeout(reloadTimer);
                    reloadTimer = 0;
                }
                if(PlaybackManager.activeIntent){
                    b.add(tb).removeClass('loading paused')
                }
            }).
            on('seeking', () => {
                seeking = true;
                b.add(tb).removeClass('loading paused')
            }).
            on('seeked', () => {
                seeking = false;
                videoElement.play()
            }).
            on('play', f).
            on('pause', () => {
                if(!seeking){
                    if(reloadTimer){
                        clearTimeout(reloadTimer);
                        reloadTimer = 0;
                    }
                    b.add(tb).removeClass('loading').addClass('paused')
                }
            }).
            on('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }).
            on('dblclick', (e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleControls();
                return false;
            }).
            on('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }).
            on('mousemove', (e) => {
                wasPaused = videoElement.paused;
            }).
            on('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('FRAME VIDEO MOUSEDOWN');
                wasPaused = videoElement.paused;
                mouseDownTime = time();
                console.log('PLAYING *', wasPaused, top);
                return false;
            }).
            on('mouseup', (e) => {
                if(time() < mouseDownTime + 3){
                    switch (e.which) {
                        case 1:
                            if(wasPaused){
                                top.PlaybackManager.play()
                            } else {
                                top.PlaybackManager.pause()
                            }
                            console.log('PLAYING **', wasPaused, PlaybackManager.playing());
                            delayedPlayPauseNotify();
                            window.focus();
                            break;
                        default:
                        case 2:
                        case 3:
                            changeScaleMode();
                            break;
                    }
                }
                return false;
            }).
            on("webkitfullscreenchange", () => {
                var e = doc.webkitFullscreenElement, i = !inFullScreen;
                if(!fslock){
                    fslock = true;
                    clearTimeout(fstm);
                    console.log('FSFS', i, e);
                    doc.webkitCancelFullScreen();
                    if(i){
                        setFullScreen(true)
                    } else {
                        setFullScreen(false)
                    }              
                    fstm = scope.setTimeout(() => {
                        fslock = false;
                    }, 1000)    
                }
            }).
            on('dblclick', hideControls).
            on('volumechange', () => {
                Config.set('volume', videoElement.volume)
            });
    }
}

var themeSettingsKeys = ["background", "bg", "bgcolor", "fgcolor", "font-size", "logo", "name", "menu-transparency", "tuning-background-animation"];

function exportTheme(file, cb) {
    fs.writeFile(file, JSON.stringify(Theme.data, null, 2), cb)
}

function importTheme(file, cb) {
	fs.readFile(file, (err, content) => {
		var data = JSON.parse(content);
		if(typeof(data)=='object' && data != null){
			for(var key in data){
                if(Theme.keys.indexOf(key) != -1){
                    Theme.set(key, data[key])
                }
            }
            saveThemeImages();
            if(typeof(cb) == 'function'){
                cb()
            }
		}
	})
}

function saveThemeImages() {
    var l = Theme.get('logo');
    if(l) {
        base64ToFile(l, 'default_icon.png')
    }
    var l = Theme.get('background');
    if(l) {
        base64ToFile(l, 'assets/images/wallpaper.png')
    }
}

function resetTheme(cb){
    doAction('resetTheme');
    // Theme.reset();
    importTheme('themes/default.json', () => {
        loadTheming({}, cb)
    })
}

function exportConfig(file, cb){
	fs.writeFile(file, JSON.stringify(Config.getAll(), null, 2), cb)
}

function importConfig(file, cb){
	fs.readFile(file, (err, content) => {
		var data = JSON.parse(content);
		if(typeof(data)=='object' && data != null){
			for(var key in data){
				Config.set(key, data[key])
            }
            if(typeof(cb) == 'function'){
                cb()
            }
		}
	})
}

function resetConfig(){
    if(confirm(Lang.RESET_CONFIRM)){
        resetTheme(() => {
            doAction('resetConfig');
            removeFolder('torrent', false, function (){
                removeFolder(Store.folder(false), false, function (){
                    nw.App.clearCache();
                    top.location.reload()
                })
            })
        })
    }
}

function chameleonize(base64, cb){    
    getImageColorsForTheming(base64, (colors) => {
        Theme.set('bg', "linear-gradient(to top, #000004 0%, "+colors.darkestColor+" 75%)");
        Theme.set('bgcolor', colors.darkestColor);
        Theme.set('fgcolor', colors.lightestColor);
        loadTheming(null, cb)
    })
}

function getImageColorsForTheming(file, cb){
    if(typeof(ColorThief) == 'undefined'){
        ColorThief = require('@codemotion/color-thief')
    }
    let s = new Image(), white = '#FFFFFF', black = '#000000';
    s.onload = () => {
        let colors = (new ColorThief()).getPalette(s, 18), lightColors = [], darkColors = [];
        if(jQuery.isArray(colors)) {
            colors.forEach((color) => {
                let hex = rgbToHex.apply(null, color), lvl = getColorLightLevel(hex);
                if(lvl <= 50){
                    darkColors.push(hex)
                } else if(lvl >= 50) {
                    lightColors.push(hex)
                }
            })
        }
        let darkestColor = arrayMin(darkColors),  lightestColor = arrayMax(lightColors);
        if(darkColors.indexOf(black) == -1){
            darkColors.push(black);
            if(!darkestColor) darkestColor = black;
        }
        if(lightColors.indexOf(white) == -1){
            lightColors.push(white);
            if(!lightestColor) lightestColor = white;
        }
        cb({
            darkColors: darkColors.getUnique(),
            lightColors: lightColors.getUnique(),
            darkestColor: darkestColor,
            lightestColor: lightestColor
        })
    }
    s.onerror = () => {
        cb({
            darkColors: [black],
            lightColors: [white],
            darkestColor: black,
            lightestColor: white
        })
    }
    s.crossOrigin = 'anonymous';
    s.src = file;
}

function applyLogoImage(file){    
    if(file){
        copyFile(file, 'default_icon.png');
        fileToBase64(file, (err, b64) => {
            var done = () => {
                Menu.go('', () => {
                    var path = Lang.OPTIONS+'/'+Lang.APPEARANCE;
                    setTimeout(() => {
                        Menu.go(path, setBackToHome)
                    }, 100)
                })
            };
            if(!err) {
                Theme.set("logo", b64);
                loadTheming()
            }
            done()
        })
    }
}

function applyBackgroundImage(file){  
    if(file){
        copyFile(file, 'assets/images/wallpaper.png');
        fileToBase64(file, (err, b64) => {
            var done = () => {
                Menu.go('', () => {
                    var path = Lang.OPTIONS+'/'+Lang.APPEARANCE;
                    setTimeout(() => {
                        Menu.go(path, setBackToHome)
                    }, 100)
                })
            };
            if(!err) {
                Theme.set("background", b64);
                loadTheming()
            }
            done()
        })
    }
}

function base64ToFile(b64, file, cb) {
    var base64Data = b64.replace(/^data:(image|video)\/(jpe?g|png|mp4|webm);base64,/, "");
    fs.writeFile(file, base64Data, 'base64', (err) => {
        if(err){
            console.error(err)
        }
        if(typeof(cb) == 'function') {
            cb()
        }
    })
}

function fileToBase64(file, cb){    
    fs.exists(file, (exists) => {
        if(exists) {
            fs.readFile(file, (err, content) => {
                if(err) {
                    cb('Failed to read file', '')
                } else {
                    var type = '', fragment = String(content).substr(0, 256);
                    switch(getExt(file)){
                        case 'png':
                            type = 'image/png';
                            break;
                        case 'jpg':
                        case 'jpeg':
                            type = 'image/jpeg';
                            break;
                        case 'mp4':
                            type = 'video/mp4';
                            break;
                        case 'webm':
                            type = 'video/webm';
                            break;
                    }
                    if(type){
                        cb(null, 'data:'+type+';base64,'+content.toString('base64'))
                    } else {
                        cb('Invalid format.', '');
                        console.warn(fragment)
                    }
                }
            })
        } else {
            cb('Failed to read file', '')
        }
    })
}

var packageQueue = Store.get('packageQueue') || [];
var packageQueueCurrent = Store.get('packageQueueCurrent') || 0;

var isOver, mouseOutGraceTime = 4000, miniPlayerMouseOutTimer = 0, miniPlayerMouseHoverDelay = 0, _b = jQuery('body');
var mouseMoveTimeout = () => {
    clearTimeout(miniPlayerMouseOutTimer);
    miniPlayerMouseOutTimer = setTimeout(() => {
        isOver = false;
        if(miniPlayerActive){
            _b.addClass('frameless') 
        }
        _b.off('mousemove', mouseMoveTimeout);
        playPauseNotifyContainers().removeClass('over')
    }, mouseOutGraceTime)
}
var miniPlayerMouseOut = () => {
    if(!isOver){
        if(miniPlayerActive){
            _b.addClass('frameless');
            _b.off('mousemove', mouseMoveTimeout)
        }
        playPauseNotifyContainers().removeClass('over')
    }
}

function createMouseObserverForControls(win){
    if(!win || !win.document){
        console.error('Bad observe', win, win.document, traceback())
        return;
    }
    if(!win.document.documentElement){
        console.log('Delaying observe creation...', win);
        setTimeout(() => {
            createMouseObserverForControls(win)
        }, 1000);
        return;
    }
    var x = 0, y = 0, showing = false, margin = 6, v = false, t = 0, ht = 0, jw = jQuery(win), tb = jQuery(document).find('body');
    try {
        var w = jw.width();
        var h = jw.height();
        var b = jw.find('body');
        jQuery(win.document).on('mousemove', (e) => {
            if(isOver) return;
            x = e.pageX;
            y = e.pageY;
            if(typeof(menuTriggerIconTrigger)!='undefined'){
                clearTimeout(menuTriggerIconTrigger)
            }
            isOver = true;
            playPauseNotifyContainers().addClass('over');
            menuTriggerIconTrigger = setTimeout(() => {
                isOver = false;
                playPauseNotifyContainers().removeClass('over')
            }, mouseOutGraceTime) // idle time before hide
        })
        var frames = win.document.querySelectorAll('iframe, frame');
        for(var i=0; i<frames.length; i++){
            if(frames[i].offsetWidth >= (w - 40)){
                createMouseObserverForControls(frames[i].contentWindow)
            }
        }
        setupKeyboardForwarding(win.document)
    } catch(e) {
        console.error(e)
    }
}

function ptbTryOther(){
    jQuery('.try-other')[(PlaybackManager.activeIntent && playingStreamKeyword(PlaybackManager.activeIntent))?'show':'hide']()
}

jQuery('body').on('mouseenter mousemove', () => {
    isOver = true;
    if(!top.isFullScreen()){
        _b.removeClass('frameless')
    }
    playPauseNotifyContainers().addClass('over');
    if(miniPlayerActive){
        _b.on('mousemove', mouseMoveTimeout)
    }
    fixMaximizeButton();
    mouseMoveTimeout()
}).on('mouseleave', () => {
    isOver = false;
    clearTimeout(miniPlayerMouseHoverDelay);
    miniPlayerMouseHoverDelay = setTimeout(miniPlayerMouseOut, 200)
})

jQuery(window).on('restore', restoreInitialSize);
jQuery(window).on('unload', function (){
    Store.set('packageQueue', packageQueue);
    Store.set('packageQueueCurrent', packageQueueCurrent)
})

function applyResolutionLimit(x, y){
    console.warn('RESIZERR', x, y);
    if(typeof(x) != 'number' || typeof(y)!='number'){
        x = win.width, y = win.height;
    }
    console.warn('RESIZERR', x, y);
    let css, res = Config.get("resolution-limit");
    if(res){
        res = res.match(new RegExp('^([0-9]{3,4})x([0-9]{3,4})$'))
    }
    if(!jQuery.isArray(res)){
        res = ['1280x720', 1280, 720]
    }
    var pch = y / (x / 100);
    res[2] = pch * (res[1] / 100);
    var s = x / res[1];
    console.warn('RESIZERR', s, pch, res[1], res[2]);
    if(x >= res[1] || y >= res[2]) {
        css = " \
    html { \
    width: "+res[1]+"px; \
    height: "+res[2]+"px; \
    transform: scale("+s+"); \
    transform-origin: 0 0; \
    } \
";
        console.warn('RESIZERR', css);
        stylizer(css, 'res-limit', window)
    } else {
        stylizer('', 'res-limit', window)
    }
}

jQuery(() => {
    PlaybackManager.on('commit', ptbTryOther);
    PlaybackManager.on('commit', leavePendingState);
    var jDoc = jQuery(document), els = jDoc.add('html, body');
    var r = () => {
        var nonMiniPlayerMinWidth = 400, miniPlayerTriggerHeight = (screen.height / 2), width = jWin.width(), height = jWin.height(), showInTaskbar = ( height > miniPlayerTriggerHeight && width > nonMiniPlayerMinWidth), onTop = ( !showInTaskbar || isFullScreen());
        if(miniPlayerTriggerHeight < 380){
            miniPlayerTriggerHeight = 380;
        }
        // console.log('QQQQQQQQ', height + ' < ( '+screen.height+' / 3) )', onTop, showInTaskbar);
        if(!appShown || onTop !== lastOnTop){
            lastOnTop = onTop;
            console.log('SET ' + JSON.stringify(onTop));
            setTimeout(() => {
                var b = jQuery('body');
                if(onTop){
                    b.addClass('frameless');
                } else {
                    b.removeClass('frameless');
                }
                if(showInTaskbar){
                    miniPlayerActive = false;
                    doAction('miniplayer-off')
                } else {
                    miniPlayerActive = true;
                    doAction('miniplayer-on')
                }
            }, 50)
        }    
        win.setAlwaysOnTop(!!onTop)  
    }
    jDoc.on('shown', () => {
        setTimeout(() => {
            jWin.on('resize load', r);
            r()
        }, 2000);
        r()
    });
    var recordingJournal = [], recordingJournalLimit = 8;
    addAction('media-save', (url, content, type) => { // prepare and remove dups from recording journal
        if(shouldCapture()){
            var length, filePath = null;
            console.log('recording, media received', typeof(content));
            if(typeof(content)=='object' && typeof(content.base64Encoded)!='undefined' && content.base64Encoded){ // from chrome.debugger
                console.log('recording, media received', typeof(content));
                if(['frame', 'ts'].indexOf(PlaybackManager.activeIntent.type) == -1){ // only in frame intent we receive from chrome.debugger now
                    console.log('recording, media received', typeof(content));
                    return;
                }
                content = new Buffer(content.body, 'base64');
                length = content.byteLength; 
            } else if(type == 'path'){ // so content is a path, not a buffer
                filePath = content;
                length = fs.statSync(filePath).size; 
            } else {
                length = (typeof(content)=='string') ? content.length : content.byteLength; 
            }
            if(!length) { // discard empty media
                console.warn('Empty media skipped.');
                return;
            }
            for(var key in recordingJournal){
                if(length && recordingJournal[key] == length){
                    console.log('Duplicated media skipped.');
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    return;
                }
            }
            var ext = getExt(url);
            if(['ts', 'mpg', 'webm', 'ogv', 'mpeg', 'mp4'].indexOf(ext) == -1){
                ext = 'mp4';
            }
            var file = capturingFolder + '/' + time() + '.' + ext;
            recordingJournal[file] = length;
            recordingJournal = sliceObject(recordingJournal, recordingJournalLimit * -1);
            var cb = (err) => {
                if(err){
                    console.error('Failed to save media.')
                }
                doAction('media-received', url, file, length)
            }
            if(type == 'path'){ // so content is a path, not a buffer
                copyFile(filePath, file, cb)
            } else {    
                fs.writeFile(file, content, {encoding: 'binary', flag: 'w'}, cb)
            }
            console.log('Media processed.', url, file, length)
        }
    })    

    var player = document.getElementById('player'), playerSizeUpdated = (() => {
        var lastSize, controls = jQuery('#controls'), timer = 0;
        return () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                var s = player.offsetWidth+'x'+player.offsetHeight;
                //console.log('player size updated?', s, lastSize);
                if(s != lastSize){
                    lastSize = s;
                    videoObserver.disconnect();
                    //console.log('player size updated', player.offsetWidth, player.offsetHeight);
                    if(PlaybackManager.activeIntent){
                        PlaybackManager.setRatio()
                    }
                    //console.log('player size reobserve', player.offsetWidth, player.offsetHeight);
                    videoObserver.observe(player)
                }
            }, 50)
        }
    })(), videoObserver = new ResizeObserver(playerSizeUpdated);
    videoObserver.observe(player);

    jQuery(document).on('scroll', () => {
        document.documentElement.scrollTop = document.documentElement.scrollLeft = 0; 
    })
});

function loadAddons(loadcb){
    jQuery(document).on('lngload', () => {
        var folder = path.resolve('addons');
        fs.exists('addons', (exists) => {
            if(exists){
                console.log('Loading addons from '+folder);
                fs.readdir(folder, (err, files) => {
                    if (err) {
                        console.error('Error reading directory ' + folder)
                    } else {
                        files.forEach((file) => {
                            file = folder+path.sep+file+path.sep+file;
                            var lng = folder+path.sep+file+path.sep+'lang';
                            try {
                                if(fs.existsSync(file + '.js')) {
                                    console.log('LOAD JS '+file + '.js');
                                    jQuery.getScript(file + '.js')  
                                } else if(fs.existsSync(file + '.bin')) {
                                    console.log('LOAD BIN '+file + '.bin');
                                    win.evalNWBin(null, file + '.bin')
                                } else {
                                    console.error('Addon without main file', file);
                                    return;
                                }
                                fs.exists(lng, (exists) => {
                                    if(exists){
                                        loadLanguage(userLocales, lng)
                                    }
                                })
                            } catch(e) {
                                console.error(e)
                            }
                        })
                    }
                    loadcb()
                })
            } else {
                loadcb()
            }
        })
    })
}

function loadLanguage(locales, folder, callback){
    var localeMask = path.resolve(folder) + path.sep + "{0}.json", locale = locales.shift(), next = () => {
        if(locales.length){
            loadLanguage(locales, folder, callback)
        } else {
            if(typeof(callback)=='function'){
                callback()
            }
        }
    };
    jQuery.getJSON(localeMask.format(locale), (data) => {
        Lang = Object.assign(data, Lang);
        next()
    }).fail(function (jqXHR, textStatus, errorThrown) {
        console.error(jqXHR, textStatus, errorThrown);
        next()
    })
}

function initSearchIndex(cb) {
    sharedListsSearchCaching = false;
    sharedListsSearchWordsIndex = {};
    sharedListsSearchWordsIndexStrict = {};
    addAction('search-index-ready', cb);
    addAction('search-index-ready', () => {
        removeAction('search-index-ready')
    });
    gui.Window.open('indexer.html', {show: false})
}

function addEntriesToSearchIndex(_entries, listURL, strict){
    var b, bs, s = [], ss = [], sep = ' _|_ ';
    var entries = _entries.filter((entry) => {
        return entry && !isMega(entry.url);
    });
    for(var i=0; i<entries.length; i++){
        b = bs = entries[i].name;
        b += ' ' + entries[i].group;
        if(b.indexOf(sep) != -1){
            b = b.replaceAll(sep, '');
            if(bs.indexOf(sep) != -1){
                bs = bs.replaceAll(sep, '')
            }
        }
        ss.push(bs);
        s.push(b)
    }
    s = s.join(sep).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(sep);
    ss = ss.join(sep).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(sep);
    for(var i=0; i<entries.length; i++){
        entries[i].mediaType = -1;
        entries[i].source = entries[i].source || listURL;
        s[i].split(' ').forEach((t) => {
            if(t.length > 1){
                if(typeof(sharedListsSearchWordsIndex[t])=='undefined'){
                    sharedListsSearchWordsIndex[t] = {items: [entries[i]]};
                } else {
                    sharedListsSearchWordsIndex[t].items.push(entries[i])
                }
            }
        });
        ss[i].split(' ').forEach((t) => {
            if(t.length > 1){
                if(typeof(sharedListsSearchWordsIndexStrict[t])=='undefined'){
                    sharedListsSearchWordsIndexStrict[t] = {items: [entries[i]]};
                } else {
                    sharedListsSearchWordsIndexStrict[t].items.push(entries[i])
                }
            }
        })
    }
}

enableSetFullScreenWindowResizing = true;
    
applyResolutionLimit();
win.on('resize', applyResolutionLimit);

jQuery(document).one('appload', () => {

    soundSetup('warn', 16); // reload it

    var p = getFrame('player'), o = getFrame('overlay');

    p.init();

    createMouseObserverForControls(p);
    createMouseObserverForControls(o);
    createMouseObserverForControls(window);

    setTimeout(() => {
        if(!PlaybackManager.intents.length){
            playResume()
        }
    }, 1000)
    
    Menu.setup();
    if(Menu.path){
        var l = false;
        try{
            l = readIndexPath(Menu.path)
        }catch(e){
            console.error(e)
        }
        if(!l || !l.length){
            Menu.path = '';
        }
    } else {
        Menu.path = '';
    }

    Menu.go(Menu.path, () => {
        var waitToRenderDelay = 1000, t = (top || window.parent); 
        setTimeout(() => { 
            jQuery(document).trigger('show');
            showControls();
            appShown = time();
            jQuery('#controls').show();
            jQuery('body').removeClass('frameless');
            jQuery(document).trigger('shown');
            setTimeout(() => {             
                var bg = jQuery('#background');
                bg.removeClass('loading')
            }, 500)
        }, waitToRenderDelay)
    });
    setTimeout(() => {}, 0); // tricky?!
    //console.log(jQuery('.list').html())

    handleOpenArguments(gui.App.argv)

})

function getFileBitrate(file, cb, length){
    var next = () => {
        getFFmpegMediaInfo(file, (nfo) => {
            var dat = nfo.match(new RegExp('[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{2}'));
            if(dat){
                var secs = hmsClockToSeconds(dat[0])
                // console.warn('NFO', dat[0], secs, length, length / secs);
                if(secs){
                    cb(null, parseInt(length / secs), file)
                } else {
                    cb('Failed to get duration for '+file, 0, file)
                }
            } else {
                cb('FFmpeg unable to process '+file, 0, file)
            }
        })
    }
    if(length){
        next()
    } else {
        fs.stat(file, (err, stat) => {
            if(err) { 
                cb('File not found or empty.', 0, file)
            } else {
                length = stat.size;
                next()
            }
        })
    }
}

var currentBitrate = 0, averageStreamingBandwidthData;

function averageStreamingBandwidth(data){
    if(!jQuery.isArray(averageStreamingBandwidthData)){
        averageStreamingBandwidthData = Store.get('aver-bandwidth-data') || [];
    }
    if(!averageStreamingBandwidthData.length){
        return 0.5; // default
    } else {
        var sum = averageStreamingBandwidthData.reduce((a, b) => a + b, 0);
        var ret = (sum / averageStreamingBandwidthData.length) / 1000000;
        if(ret < 0.1) {
            ret = 0.1;
        } else if(ret > 2) {
            ret = 2;
        }
        return ret;
    }
}

function averageStreamingBandwidthCollectSample(url, file, length) {
    removeAction('media-received', averageStreamingBandwidthCollectSample); // once per commit
    getFileBitrate(file, (err, bitrate, file) => {
        if(err){
            console.error('Bitrate collect error', file)
        } else {
            if(!jQuery.isArray(averageStreamingBandwidthData)){
                averageStreamingBandwidthData = Store.get('aver-bandwidth-data') || [];
            }
            averageStreamingBandwidthData.push(bitrate);
            Store.set('aver-bandwidth-data', averageStreamingBandwidthData);
        }
    }, length);
}

PlaybackManager.on('stop', () => {
    currentBitrate = 0;
});

PlaybackManager.on('commit', () => {
    addAction('media-received', averageStreamingBandwidthCollectSample)
});

addFilter('about', (txt) => {
    txt += Lang.DOWNLOAD_SPEED+': '+window.navigator.connection.downlink.toFixed(1)+"MBps\n";
    if(currentBitrate){
        txt += Lang.BITRATE+': '+currentBitrate.toFixed(1)+"MBps\n";    
    } else {
        txt += Lang.AVERAGE_BITRATE+': '+averageStreamingBandwidth().toFixed(1)+"MBps\n";   
    }
    return txt;
});

function tuningConcurrency(){
    var downlink = window.navigator.connection.downlink || 5;
    var ret = Math.round(downlink / averageStreamingBandwidth());
    if(ret < 1){
        ret = 1;
    } else if(ret > 36) {
        ret = 36;
    }
    return ret;
}

function updateAutoCleanOptionsStatus(txt, inactive) {
    var _as = jQuery('a.entry-autoclean');
    if(_as.length){
        _as.find('.entry-name').html(txt);
        _as.find('.entry-label').html(inactive ? Lang.AUTO_TUNING : '<font class="faclr-red">'+Lang.CLICK_AGAIN_TO_CANCEL+'</font>');
    }
}

var autoCleanDomainConcurrencyLimit = 2, autoCleanDomainConcurrency = {}, autoCleanEntriesQueue = [], closingAutoCleanEntriesQueue = [], autoCleanEntriesStatus = '', autoCleanLastMegaURL = '', autoCleanReturnedURLs = [];

function autoCleanEntries(entries, success, failure, cancelCb, returnSucceededIntent, cancelOnFirstSuccess, megaUrl, name) {
    cancelOnFirstSuccess = true;
    if(autoCleanEntriesCancel()){
        updateAutoCleanOptionsStatus(Lang.TEST_THEM_ALL, true)
    }
    var succeeded = false, testedMap = [], readyIterator = 0, debug = false;
    if(!jQuery.isArray(entries)){
        var arr = [];
        jQuery('a.entry-stream').each((i, o) => {
            var e = jQuery(o).data('entry-data');
            if(e){
                arr.push(e)
            }
        });
        entries = sortEntriesByState(arr);
    }
    if(!entries.length){
        if(typeof(failure)=='function'){
            setTimeout(() => {
                failure()
            }, 150)
        }
        return false;
    }
    entries = entries.filter((entry) => { return parentalControlAllow(entry, true) });
    entries = deferEntriesByURLs(entries, autoCleanReturnedURLs);
    if(!name && entries.length){
        name = basename(Menu.path)
    }
    if(debug){
        console.log('autoCleanSort', entries, entries.map((entry) => {return entry.sortkey+' ('+entry.url+')'}).join(", \r\n"))
    }
    autoCleanDomainConcurrency = {};
    var controller, iterator = 0, entriesLength = entries.length, pcs;
    autoCleanEntriesStatus = pcs = Lang.TUNING+' '+ucNameFix(name)+' ('+Lang.X_OF_Y.format(readyIterator, entriesLength)+')';
    updateAutoCleanOptionsStatus(autoCleanEntriesStatus);
    controller = {
        testers: [],
        cancelled: false,
        id: time(),
        cancel: () => {
            if(!controller.cancelled){
                if(debug){
                    console.warn('Autoclean cancel', tasks.length, controller.id)
                }
                console.log('cancelling', controller.testers);
                controller.cancelled = true;
                controller.testers.forEach((intent, i) => {
                    if(intent.shadow){ // not returned onsuccess
                        try {
                            intent.destroy()
                        } catch(e) {
                            console.error(e)
                        }
                    }
                });
                autoCleanEntriesStatus = '';
                updateAutoCleanOptionsStatus(Lang.TEST_THEM_ALL, true);
                if(!succeeded && typeof(cancelCb)=='function'){
                    cancelCb()
                }
                autoCleanEntriesRunning() // purge invalid controllers on ac queue
            }
        }
    }
    var tasks = Array(entriesLength).fill((callback) => {
        if(controller.cancelled){
            callback();
            return;
        }
        var entry, domain;        
        var select = () => {
            if(!controller.cancelled){
                if(!entry){
                    for(var i=0; i < entries.length; i++){
                        if(testedMap.indexOf(i) == -1){
                            domain = getDomain(entries[i].url);
                            if(typeof(autoCleanDomainConcurrency[domain]) == 'undefined'){
                                autoCleanDomainConcurrency[domain] = 0;
                            }
                            if(autoCleanDomainConcurrency[domain] >= autoCleanDomainConcurrencyLimit){
                                //console.warn('AutoClean domain throttled: '+domain);
                                continue;
                            } else {
                                testedMap.push(i);
                                entry = entries[i];
                                break;
                            }
                        }
                    }
                }
                if(entry){
                    if((entry.type && entry.type != 'stream') || isMagnet(entry.url) || isMega(entry.url)){
                        readyIterator++;
                        if(debug){
                            console.warn('Autoclean entry ignored', entry)
                        }
                        return callback() // why should we test?
                    }
                    if(debug){
                        console.log('Autoclean processing', entry.name, entry.url, entry, entries, controller.id)
                    }
                    process()
                } else {
                    setTimeout(select, 1000)
                }
            }
        }
        var process = () => {
            if(!controller.cancelled){
                autoCleanDomainConcurrency[domain]++;
                var sm = entry.originalUrl && isMega(entry.originalUrl), originalUrl = entry.originalUrl && !sm ? entry.originalUrl : entry.url;
                pcs = ucNameFix(name) + ' ('+Lang.X_OF_Y.format(readyIterator, entries.length)+')';
                try {
                    if(!megaUrl && sm){
                        megaUrl = entry.originalUrl;
                    }
                    testEntry(entry, (succeededIntent) => {
                        if(controller.cancelled){
                            if(succeededIntent){
                                succeededIntent.destroy()
                            }
                            if(autoCleanDomainConcurrency[domain]){
                                autoCleanDomainConcurrency[domain]--;
                            }
                            return callback()
                        } else {
                            if(debug){
                                console.warn('Autoclean entry testing success', returnSucceededIntent, succeededIntent, entry, megaUrl, succeeded, controller.cancelled)
                            }
                            readyIterator++;
                            if(!succeeded){
                                succeeded = true;
                                if(megaUrl){
                                    entry.originalUrl = megaUrl;
                                }
                                if(megaUrl != autoCleanLastMegaURL){
                                    autoCleanLastMegaURL = megaUrl || '';
                                    autoCleanReturnedURLs = [];
                                }
                                if(autoCleanReturnedURLs.indexOf(entry.url) == -1){
                                    autoCleanReturnedURLs.push(entry.url)
                                }
                                if(succeededIntent){
                                    succeededIntent.shadow = false;
                                    if(megaUrl){
                                        succeededIntent.entry.originalUrl = megaUrl;
                                    }
                                }
                                if(returnSucceededIntent){
                                    if(cancelOnFirstSuccess){
                                        controller.cancel()
                                        if(debug){
                                            console.warn('Autoclean, cancelling after first success', entry.name, entry.url, succeeded, controller.cancelled, controller.id)
                                        }
                                    }
                                }
                                if(typeof(success)=='function'){
                                    console.warn('Autoclean success callback', megaUrl, entry, succeededIntent)
                                    success(entry, controller, succeededIntent)
                                }
                            }
                            if(cancelOnFirstSuccess){
                                if(returnSucceededIntent){
                                    autoCleanEntriesStatus = Lang.TEST_THEM_ALL;
                                } else {
                                    autoCleanEntriesStatus = Lang.TRY_OTHER_STREAM;
                                }
                            } else {
                                autoCleanEntriesStatus = Lang.TUNING+' '+pcs;
                            }
                            updateAutoCleanOptionsStatus(autoCleanEntriesStatus);
                            setStreamStateCache(entry, true);
                            updateStreamEntriesFlags();
                            sendStats('alive', sendStatsPrepareEntry(entry));
                            if(autoCleanDomainConcurrency[domain]){
                                autoCleanDomainConcurrency[domain]--;
                            }
                            callback()
                        }
                    }, () => {
                        if(controller.cancelled){
                            if(autoCleanDomainConcurrency[domain]){
                                autoCleanDomainConcurrency[domain]--;
                            }
                            return callback()
                        } else {
                            if(debug){
                                console.warn('Autoclean entry testing failure', entry.name, entry.url, succeeded, controller.cancelled, controller.id)
                            }
                            readyIterator++;
                            autoCleanEntriesStatus = Lang.TUNING+' '+pcs;
                            updateAutoCleanOptionsStatus(autoCleanEntriesStatus);
                            if(!succeeded){
                                enterPendingState(pcs, Lang.TUNING)
                            }
                            setStreamStateCache(entry, false);
                            updateStreamEntriesFlags();
                            if(autoCleanDomainConcurrency[domain]) {
                                autoCleanDomainConcurrency[domain]--;
                            }
                            callback();
                            if(debug){
                                console.warn('Autoclean reporting failure to server')
                            }
                            sendStats('error', sendStatsPrepareEntry(entry))
                        }
                    }, returnSucceededIntent, (intent) => {
                        console.log('ACE G', intent, entry);
                        controller.testers.push(intent)
                    });
                } catch(e) {
                    console.error('ACE ERROR CATCHED', e)
                }
            }
        }
        select()
    });
    console.log('Autoclean testers', controller.testers);
    autoCleanEntriesQueue.push(controller);
    setTimeout(() => {
        async.parallelLimit(tasks, tuningConcurrency(), (err, results) => {
            console.warn('Autoclean done', tasks.length);
            if(!controller.cancelled){
                controller.cancel();
                if(!succeeded && typeof(failure)=='function'){
                    setTimeout(failure, 150)
                }
                autoCleanEntriesStatus = Lang.AUTO_TUNING+' 100%';
                updateAutoCleanOptionsStatus(autoCleanEntriesStatus)
            }
        })
    }, 100);
    return controller;
}

function tune(entries, name, originalUrl, cb){ // entries can be a string search term
    console.log('TUNE ENTRIES', entries);
    var nentries;
    if(typeof(entries)=='string'){
        if(!name){
            name = entries;
        }
        nentries = fetchSharedListsSearchResults(null, 'live', entries, true, true);
        if(nentries.length == 1 && nentries[0].type=='option'){ // search index not ready
            return setTimeout(() => {
                tune(entries, name, originalUrl, cb)
            }, 500)
        }
        entries = nentries;
    }
    var failure = (msg) => {
        cb(msg, false, false)
    }
    console.log('TUNE ENTRIES', entries);
    if(!entries.length){
        return failure(Lang.PLAY_STREAM_FAILURE.format(name))
    }
    if(!name){
        name = entries[0].name;
    }
    // parse mega:// entries
    var expands = {};
    entries.forEach((entry, i) => {
        if(isMega(entry.url)){ // mega://
            console.log('isMega');
            var data = parseMegaURL(entry.url);
            if(data){
                // console.log('PARTS', data);
                if(data.type == 'link'){
                    entries[i].url = data.url;
                } else if(data.type == 'play') {
                    nentries = fetchSharedListsSearchResults(null, 'live', data.name, true, true);
                    if(nentries.length && (typeof(nentries[0].type) == 'undefined' || nentries[0].type !='option')){
                        expands[i] = nentries;
                    }
                }
            } else {
                console.error('Bad mega:// URL', entry)
            }
            if(typeof(expands[i]) == 'undefined'){
                expands[i] = [];
            }
        }
    });
    if(Object.keys(expands).length){
        nentries = [];
        for(var i=0; i<entries.length; i++){
            if(typeof(expands[i]) != 'undefined'){
                nentries = nentries.concat(expands[i])
            } else {
                nentries.push(entries[i])
            }
        }
        expands = null;
        entries = nentries;
        nentries = null;
    }
    console.log('TUNE ENTRIES 2', entries);
    if(autoCleanEntriesRunning()){
        autoCleanEntriesCancel()
    }
    var hr = autoCleanEntries(entries, (entry, controller, succeededIntent) => {
        controller.cancel();
        console.log('tune SUCCESS', succeededIntent, entry);
        if(succeededIntent) {
            succeededIntent.manual = true;
            succeededIntent.shadow = false;
            succeededIntent.entry = entry;
            cb(null, entry, succeededIntent)
        } else {
            cb(null, entry, false)
        }
    }, () => {
        console.warn('tune FAILED');
        failure(Lang.PLAY_STREAM_FAILURE.format(name))
    }, () => {
        // CANCELLED
    }, true, true, originalUrl, name);
    if(hr){
        console.log('tuning OK');
    } else {
        console.warn('tuning FAILED');
        failure(Lang.PLAY_STREAM_FAILURE.format(name))
    }
    return hr;
}

function tuneNPlay(entries, name, originalUrl, _cb){ // entries can be a string search term
    if(!name){
        if(typeof(entries)=='string'){
            name = entries;
        } else {
            name = entries[0].name;
        }
    }
    var failure = () => {
        leavePendingState();
        notify(Lang.NONE_STREAM_WORKED.format(name), 'fa-exclamation-circle faclr-red', 'normal')
    }
    if(!Config.get('play-while-tuning') && PlaybackManager.activeIntent){
        stop(false, true)
    }    
    enterPendingState(ucNameFix(decodeURIComponent(name) || name)+' ('+Lang.X_OF_Y.format(0, entries.length)+')', Lang.TUNING, originalUrl);
    var hr = tune(entries, name, originalUrl, (err, entry, succeededIntent) => {
        leavePendingState();
        if(typeof(_cb)=='function'){
            _cb(err, entry, succeededIntent)
        }
        if(err){
            console.warn('tune() failure', entry, succeededIntent, err);
            failure()
        } else {
            console.warn('tune() success', entry, succeededIntent);
            enterPendingState((decodeURIComponent(entry.name) || entry.name), Lang.CONNECTING, originalUrl);
            if(succeededIntent) {
                PlaybackManager.commitIntent(succeededIntent)
            } else {
                playEntry(entry)
            }
        }
    });
    if(hr === false){
        failure()
    } else {
        console.log('tuneNPlay() OK')
    }
    return hr !== false;
}

function autoCleanEntriesRunning(){
    for(var i=0; i<autoCleanEntriesQueue.length; i++){
        if(autoCleanEntriesQueue[i] && autoCleanEntriesQueue[i].cancelled){
            closingAutoCleanEntriesQueue.push(autoCleanEntriesQueue[i])
            autoCleanEntriesQueue[i] = null;
        }
    }
    autoCleanEntriesQueue = autoCleanEntriesQueue.filter((item) => {
        return !!item
    });
    return !!autoCleanEntriesQueue.length;
}

function autoCleanEntriesCancel(){
    var cancelled = false;
    if(autoCleanEntriesQueue.length){
        console.warn('AUTOCLEAN CANCEL', autoCleanEntriesQueue, traceback());
        closingAutoCleanEntriesQueue = closingAutoCleanEntriesQueue.concat(autoCleanEntriesQueue);
        autoCleanEntriesQueue = [];
        for(var i=0; i<closingAutoCleanEntriesQueue.length; i++){
            console.log(closingAutoCleanEntriesQueue[i]);
            if(closingAutoCleanEntriesQueue[i]){
                closingAutoCleanEntriesQueue[i].cancel()
            }
        }
        autoCleanEntriesStatus = '';
    }
    return cancelled;
}

function setFontSizeCallback(data){
    Theme.set('font-size', data.fontSize);
    loadTheming();    
    setActiveEntry({fontSize: Theme.get('font-size')})
}

function setIconSizeCallback(data){
    Theme.set('iconsize', data.iconSize);
    loadTheming();    
    setActiveEntry({iconSize: Theme.get('iconsize')})
}

function setBackgroundAnimationCallback(data){
    Theme.set('tuning-background-animation', data.animation);
    loadTheming();
    setActiveEntry({animation: data.animation})
}

function areControlsIdle(){
    return jQuery('body').hasClass('idle')
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

var showAdultContent = Config.get('show-adult-content');
function parentalControlAllow(entry, ignoreSetting){
    if(showAdultContent && !ignoreSetting){
        return true;
    }
    var terms = parentalControlTerms();
    if(typeof(entry)=='string'){
        return !hasTerms(entry, terms);
    }
    if(entry && typeof(entry.type)=='string' && ['group', 'stream'].indexOf(entry.type)==-1){
        return true;
    }
    if(terms.length){
        if(typeof(entry.name)=='string' && hasTerms(entry.name, terms)){
            return false;
        }
        //if(typeof(entry.url)=='string' && hasTerms(entry.url, terms)){
        //    return false;
        //}
        if(typeof(entry.label)=='string' && hasTerms(entry.label, terms)){
            return false;
        }
        if(typeof(entry.group)=='string' && hasTerms(entry.group, terms)){
            return false;
        }
    }
    return true;
}

function toggleControls(){
    if(areControlsActive()){
        hideControls()
    } else {
        showControls()
    }
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

function pickLogoFromEntries(entries, type){
    if(!type){
        type = 'stream';
    }
    var rgx = new RegExp('( |fa\-)');
    for(var i in entries){
        if(entries[i].logo && !entries[i].logo.match(rgx)){
            return entries[i].logo;
        }
    }
    return defaultIcons[type];
}

function switchPlayingStream(intent, cb){
    if(!intent){
        intent = (PlaybackManager.activeIntent || PlaybackManager.lastActiveIntent || false);
    }
    if(intent && [PlaybackManager.activeIntent, PlaybackManager.lastActiveIntent].indexOf(intent) != -1){
        var entry = typeof(intent.entry) != 'undefined' ? intent.entry : intent;
        var term = playingStreamKeyword(entry);
        if(term){
            stop(false, true);
            var megaUrl = 'mega://play|' + term;
            entries = fetchSharedListsSearchResults(null, 'live', term, true, true);
            if(entries.length){
                entries = entries.filter((e) => {
                    return (e.url != entry.url && e.url != intent.originalUrl);
                })
            }
            if(entries.length){
                if([PlaybackManager.activeIntent, PlaybackManager.lastActiveIntent].indexOf(intent) != -1){
                    tuneNPlay(entries, term, megaUrl, cb);
                    return true;
                }
            }
        }
    }
}

function playingStreamKeyword(entry){
    if(typeof(entry.entry)!='undefined'){
        entry = entry.entry;
    }
    if(entry){
        var megaUrl = entry.originalUrl;
        if(isMega(megaUrl)){
            var parts = parseMegaURL(megaUrl);
            if(parts && parts.name){
                return parts.name;
            }
        }
        return searchTermFromEntry(entry);
    }
    return false;
}

function searchTermFromEntry(entry){
    var term = false;
    searchSuggestions.forEach((t) => {
        if(typeof(entry.name)=='string' && entry.name.toLowerCase().indexOf(t.search_term)!=-1){
			if(!term || term.length < t.search_term.length){
            	term = t.search_term;
            }
        }
    });
    return term;
}

function adjustMainCategoriesEntry(entry){
    entry.type = 'group';
    entry.renderer = (data) => {
        var entries = fetchSharedListsSearchResults(null, 'live', data.name, true, true);
        // console.warn('ZZZZZZZZZZ', data, entries);
        if(!entries.length){
            sound('static', 16);
            notify(Lang.PLAY_STREAM_FAILURE.format(data.name), 'fa-exclamation-circle faclr-red', 'normal');
            return -1;
        }
        entries = listManJoinDuplicates(entries);
        var sbname = Lang.CHOOSE_STREAM+' ('+entries.length+')', megaUrl = 'mega://play|' + encodeURIComponent(data.name);
        var isPlaying = PlaybackManager.activeIntent && PlaybackManager.activeIntent.entry.originalUrl.toLowerCase() == megaUrl.toLowerCase();
        var logo = showLogos ? entry.logo || pickLogoFromEntries(entries) : '';
        var metaEntries = [
            {type: 'stream', class: 'entry-vary-play-state', name: data.name, logo: logo, 
                label: isPlaying ? '<i class="fas fa-random"></i>&nbsp; '+Lang.TRY_OTHER_STREAM : '<i class="fas fa-play-circle"></i>&nbsp; '+Lang.AUTO_TUNING, 
                url: megaUrl, callback: () => {
                tuneNPlay(entries, data.name, megaUrl)
            }},
            {type: 'group', label: Lang.MANUAL_TUNING, name: sbname, logo: 'fa-list', path: assumePath(sbname), entries: [], renderer: () => {
                entries = entries.map((entry) => { 
                    entry.originalUrl = megaUrl;
                    if(!entry.logo){
                        entry.logo = logo;
                    }
                    return entry; 
                });
                return entries;
            }}
        ];
        if(isPlaying){
            metaEntries = applyFilters('playingMetaEntries', metaEntries);
            metaEntries.push({name: Lang.WINDOW, logo:'fa-window-maximize', type: 'group', renderer: () => { return getWindowModeEntries(true) }, entries: []})
        }
        var bookmarking = {name: data.name, type: 'stream', label: data.group || '', url: megaUrl};
        if(Bookmarks.is(bookmarking)){
            metaEntries.push({
                type: 'option',
                logo: 'fa-star-half',
                name: Lang.REMOVE_FROM.format(Lang.BOOKMARKS),
                callback: () => {
                    removeFav(bookmarking);
                    Menu.refresh()
                }
            })
        } else {
            metaEntries.push({
                type: 'option',
                logo: 'fa-star',
                name: Lang.ADD_TO.format(Lang.BOOKMARKS),
                callback: () => {
                    addFav(bookmarking);
                    Menu.refresh()
                }
            })
        }
        if(isPlaying){
            metaEntries.push({
                name: Lang.SHARE, 
                logo: 'fa-heart', 
                type: 'group', 
                entries: [
                    {name: Lang.SHARE+': Facebook', logo: 'fab fa-facebook', type: 'option', callback: goShareFB},
                    {name: Lang.SHARE+': Twitter', logo: 'fab fa-twitter', type: 'option', callback: goShareTW}
                ]
            })
        }
        return metaEntries;
    }
    if(!showLogos || !entry.logo){
        entry.logo = defaultIcons['stream'];
    }
    return entry;
}

function getMainCategoriesEntries(){
    var category, optionName = Lang.CHANNELS, cb = (entries) => {
        entries.unshift({name: 'Youtube', allowWebPages: true, logo: 'fab fa-youtube', label: '', type: 'option', callback: () => {
            playEntry({
                name: 'Youtube',
                url: 'http://youtube.com/tv#nosandbox#nofit'
            })
        }});
        entries = applyFilters('mainCategoriesEntries', entries);
        entries.unshift({name: Lang.IPTV_LISTS, label: Lang.MY_LISTS, logo:'fa-list', type: 'group', entries: [], renderer: (data, element, isVirtual) => {
            return getListsEntries(false, false, isVirtual)
        }});
        entries.unshift({name: Lang.BEEN_WATCHED, logo: 'fa-users', label: onlineUsersCount, type: 'group', renderer: getWatchingEntries, entries: []});
        return entries;
    };
    return fetchAndRenderEntries("http://app.megacubo.net/stats/data/categories."+getLocale(true)+".json", optionName, (category) => {
        category.renderer = (data) => {
            var catStations =  data.entries.filter((station) => {
                return !!fetchSharedListsSearchResults(null, 'live', station.name, true, true).length;
            });
            return catStations.length ? catStations : [{name: Lang.EMPTY, logo:'fa-file', type: 'option'}];
        }
        category.entries = category.entries.map(adjustMainCategoriesEntry);
        return category;
    }, cb)
}

var timerTimer = 0, timerData = 0;
function timer(){
    if(timerData){
        clearTimeout(timerData['timer']);
        timerData = 0;
        return false;
    }
    var opts = [];
    [5, 15, 30, 45].forEach((m) => {
        opts.push({name: Lang.AFTER_X_MINUTES.format(m), value: m, label: Lang.TIMER, logo:'fa-clock', type: 'group', entries: [], renderer: timerChooseAction});
    });
    [1, 2, 3].forEach((h) => {
        opts.push({name: Lang.AFTER_X_HOURS.format(h), value: h * 60, label: Lang.TIMER, logo:'fa-clock', type: 'group', entries: [], renderer: timerChooseAction});
    });
    return opts;
}

function timerChooseAction(data){
    console.warn('TIMER', data);
    var opts = [
        {name: Lang.STOP, type: 'option', logo: 'fa-stop', value: [data.value, 1], callback: timerChosen},
        {name: Lang.CLOSE, type: 'option', logo: 'fa-times-circle', value: [data.value, 2], callback: timerChosen},
        {name: Lang.SHUTDOWN, type: 'option', logo: 'fa-power-off', value: [data.value, 3], callback: timerChosen}
    ];
    return opts;
}

var timerLabel = false;

function timerChosen(data){
    var t = time();
    timerData = {minutes: data.value[0], action: data.value[1], start: t, end: t + (data.value[0] * 60)};
    timerData['timer'] = setTimeout(() => {
        console.warn('TIMER DEST', timerData);
        switch(timerData.action){
            case 1:
                stop();
                break;
            case 2:
                stop();
                closeApp();
                break;
            case 3:
                stop();
                closeApp();
                shutdown();
                break;
        };
        timerData = 0;
        timerWatch() // reset then
    }, timerData.minutes * 60000);
    Menu.go(Lang.OPTIONS, timerWatch)
}

function timerWatch(){
    if(!timerLabel){
        var t = jQuery('.entry-timer');
        timerLabel = [t, t.length ? t.find('.entry-label') : false];    
    }
    if(timerData){
        if(timerLabel[0].length){
            var d = timeFormat(timerData.end - time());
            timerLabel[1].html('<i class="fas fa-clock"></i> '+d+' &middot; '+Lang.STOP);
        }
        setTimeout(timerWatch, 1000)
    } else {
        timerLabel[1].html('<i class="fas fa-stop"></i> '+timeFormat(0));
        setTimeout(() => {
            timerLabel[1].html('')    
        }, 1000)
    }
}

function timeFormat(secs){
    var sec_num = parseInt(secs, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);
    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

var gui = require('nw.gui'), win = gui.Window.get(), offLabel = ' (off)';
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
        let nentry = Object.assign({}, entry);
        nentry.class = '';
        if(typeof(nentry.originalUrl)=='string'){
            nentry.url = nentry.originalUrl; // ignore the runtime changes in URL
        }
        if(typeof(nentry.type)!='undefined'){
            delete nentry.type;
        }
        if(nentry.logo.indexOf('//') == -1){
            nentry.logo = defaultIcons['stream'];
        }
        for(var i in fullHistory){
            if(fullHistory[i].url == nentry.url){
                delete fullHistory[i];
            }
        }
        fullHistory = fullHistory.filter((item) => {
            return !!item
        });
        fullHistory.unshift(nentry);
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
            if(fullBookmarks[i].url == entry.url || (entry.originalUrl && fullBookmarks[i].url == entry.originalUrl)){
                return true;
            }
        }
    }
    _this.add = function (entry){
        let nentry = Object.assign({}, entry);
        if(nentry.originalUrl && nentry.originalUrl != nentry.url){
            nentry.url = nentry.originalUrl;
        }
        for(var i in fullBookmarks){
            if(fullBookmarks[i].url == nentry.url){
                delete fullBookmarks[i];
            }
        }
        fullBookmarks.push(nentry);
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
        notify(Lang.FAV_ADDED.format(s.name), 'fa-star faclr-green', 'normal')
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
        notify(Lang.FAV_REMOVED.format(s.name), 'fa-star faclr-green', 'normal')
    }
}

var searchPath, bookmarksPath, langPath, optionsPath;

jQuery(document).on('lngload', () => {
    optionsPath = Lang.OPTIONS;
    searchPath = Lang.OPTIONS+'/'+Lang.SEARCH;
    searchVideoPath = Lang.OPTIONS+'/'+Lang.VIDEO_SEARCH;
    ytPath = Lang.CHANNELS+'/Youtube';
    bookmarksPath = Lang.BOOKMARKS;
    langPath = Lang.OPTIONS+'/'+Lang.LANGUAGE;
    tunePath = Lang.OPTIONS+'/'+Lang.TUNE;
    secPath = Lang.OPTIONS+'/'+Lang.SECURITY;
    getSearchSuggestions();
    updateOnlineUsersCount();
    setInterval(updateOnlineUsersCount, 600000)
});

var focusEntryItem, lastTabIndex = 1, controlsTriggerTimer = 0, isScrolling = false, scrollEnd, isWheeling = false, wheelEnd, handleMenuFocus, scrollDirection;

jQuery(function (){
    var t = 0, x, tb = jQuery(document).find('body'), c = tb.find('div#controls'), d = jQuery('div#controls'), b = jQuery('body'), l = jQuery(".list"), ld = l.find("div:eq(0)");

    focusEntryItem = (a, noscroll) => {
        if(a && a.length){
            // console.log(a.length, a.html());
            if(!noscroll){
                let y = a.offset();
                if(y){
                    y = y.top + l.scrollTop(), ah = a.height();
                    //console.log(a.html(), y);
                    l.scrollTop(y - ((l.height() - ah) / 2))
                }
            }   
            jQuery('.entry-focused').removeClass('entry-focused');
            var f = a.addClass('entry-focused').get(0);
            if(document.activeElement){
                // dirty hack to force input to lose focus
                if(document.activeElement.tagName.toLowerCase() == 'input'){
                    var t = document.activeElement;
                    t.style.visibility = 'hidden';
                    f.focus({preventScroll: true});
                    t.style.visibility = 'visible';
                }
            }
            f.focus({preventScroll: true});
            //console.warn('FOCUS', f, a)
        }
    }
        
    /* scrollstart|scrollend events */
    scrollEnd = () => {
        isScrolling = false;
        b.trigger("scrollend")
    }
    jQuery(".list").on("scroll", () => {
        if(isScrolling){
            clearTimeout(isScrolling)
        } else {
            b.trigger("scrollstart")
        }
        isScrolling = setTimeout(scrollEnd, 400)
    });

    /* wheelstart|wheelend events */
    wheelEnd = () => {
        isWheeling = false;
        b.trigger("wheelend")
    }
    jQuery(".list").on("wheel", () => {
        if(isWheeling){
            clearTimeout(isWheeling)
        } else {
            b.trigger("wheelstart")
        }
        isWheeling = setTimeout(wheelEnd, 400)
    });

    /* adjust focus to visible items always */
    var lastScrollY = 0;
    handleMenuFocus = () => {
        var newScrollY = l.scrollTop();
        scrollDirection = (lastScrollY > newScrollY) ? 'up' : 'down';
        lastScrollY = newScrollY;
        if(document.activeElement){
            var tag = document.activeElement.tagName.toLowerCase();
            if(['a', 'input'].indexOf(tag) != -1){ // focus a.entry or input (searching) only
                lastTabIndex = document.activeElement.tabIndex;
            } else if(!jQuery(document.activeElement).is(':in-viewport')) {
                Menu.focusNext()
            }
        }
    }   
    jQuery(window).on('resize', handleMenuFocus);

    console.log(b);
    b.on('scrollend', () => {
        var y = jQuery('.list').scrollTop();
        if(y >= 400){
            b.addClass('scrolled_400')
        } else {
            b.removeClass('scrolled_400')
        }
    })
    console.log(b);

    /* ignore focus handling while scrolling, with mouse or keyboard */
    (() => {
        var unlockDelay = 0;
        var lock = () => { 
            ld.css("pointer-events", "none") 
        }
        var unlock = () => { 
            ld.css("pointer-events", "all");
            handleMenuFocus()
        }
        var unlocker = () => { 
            clearTimeout(unlock);
            unlockDelay = setTimeout(unlock, 400)
        }
        b.on("wheelstart", lock).on("wheelend", unlocker).on("blur", "a", handleMenuFocus);
    })()
});

currentVersion = false;

jQuery(document).one('show', () => {
    jQuery.getJSON('http://app.megacubo.net/configure.json?'+time(), (data) => {
        if(!data || !data.version) return;
        currentVersion = data.version;
        if(typeof(data.adultTerms)!='undefined'){
            if(typeof(data.adultTerms) != 'string'){
                data.adultTerms = String(data.adultTerms)
            }   
            Config.set('default-parental-control-terms', fixUTF8(data.adultTerms), 30 * (24 * 3600))
        }
        console.log('VERSION', gui.App.manifest.version, currentVersion);
        installedVersion = gui.App.manifest.version;
        jQuery('#home-icons a, #list-icons a').each((i, element) => {
            var je = jQuery(element), key = je.attr('data-title-lng-key');
            if(key && Lang[key]){
                je.attr('aria-label', Lang[key]).prop('title', Lang[key])
            }
        }).on('click', (event) => {
            event.preventDefault();
            event.stopPropagation()
        });
        jQuery('#home-icons').show();
        jQuery('#controls-toggle').prop('title', Lang.SHOW_HIDE_MENU).attr('aria-label', Lang.SHOW_HIDE_MENU);
        if(installedVersion < currentVersion){
            availableVersion = currentVersion;
            if(confirm(Lang.NEW_VERSION_AVAILABLE)){
                gui.Shell.openExternal('https://megacubo.tv/online/?version='+gui.App.manifest.version);
            }
        }
    })
})

jQuery(window).one('unload', () => {
    sendStats('die')
})

jQuery(document).one('lngload', () => {
    Menu.index = [
        {name: Lang.CHANNELS, label: Lang.CATEGORIES, logo:'assets/icons/white/tv.png', class: 'entry-nosub', type: 'group', entries: [], renderer: getMainCategoriesEntries},
        {name: Lang.BOOKMARKS, logo:'fa-star', type: 'group', class: (Bookmarks.get().length) ? '' : 'entry-hide', renderer: getBookmarksEntries, entries: []},
        {name: Lang.OPTIONS, logo:'assets/icons/white/settings.png', callback: () => { timerLabel = false; }, type: 'group', entries: [
            {name: Lang.OPEN_URL+' (Ctrl+U)', logo:'fa-link', type: 'option', callback: () => {playCustomURL()}},
            {name: Lang.TIMER, logo:'fa-stopwatch', class: 'entry-timer', type: 'group', renderer: timer},
            {name: Lang.SEARCH, label: '', logo: 'fa-search', type: 'option', class: 'entry-hide', value: lastSearchTerm, callback: () => { 
                var term = lastSearchTerm, n = PlaybackManager.activeIntent;
                if(n && n.entry.originalUrl && isMega(n.entry.originalUrl)){
                    var data = parseMegaURL(n.entry.originalUrl);
                    if(data && data.type == 'play'){
                        term = data.name;
                    }
                }
                var searchLive = Config.get('search-live'), searchVOD = Config.get('search-vod');
                var searchType = searchLive ? (searchVOD ? 'all' : 'live') : 'video';
                setupSearch(term, searchType, Lang.SEARCH)
            }},
            {name: Lang.LANGUAGE, append: '(Ctrl+L)', logo:'fa-language', type: 'group', renderer: getLanguageEntries, callback: markActiveLocale, entries: []},
            {name: Lang.HISTORY, append: '(Ctrl+H)', logo:'fa-history', type: 'group', renderer: getHistoryEntries, entries: []},
            {name: Lang.WINDOW, logo:'fa-window-maximize', type: 'group', renderer: getWindowModeEntries, entries: []},
            {name: Lang.APPEARANCE, logo:'fa-palette', type: 'group', entries: [
                {
                    name: Lang.THEME,
                    type: 'group',
                    logo: 'fa-palette',
                    entries: [],
                    renderer: getThemeEntries
                },
                {
                    name: Lang.CUSTOMIZE_THEME,
                    type: 'group',
                    logo: 'fa-paint-brush',
                    entries: [
                        {
                            name: Lang.CHANGE_BACKGROUND_IMAGE, 
                            type: 'option',
                            logo: 'fa-image',
                            callback: () => {
                                openFileDialog((file) => {
                                    applyBackgroundImage(file)
                                }, ".jpeg,.jpg,.png,.webm,.mp4")
                            }
                        },            
                        {
                            name: Lang.CHANGE_LOGO_IMAGE, 
                            type: 'option',
                            logo: 'fa-image',
                            callback: () => {
                                openFileDialog((file) => {
                                    applyLogoImage(file)
                                }, ".png")
                            }
                        },
                        {
                            name: Lang.BACKGROUND_COLOR, 
                            type: 'group',
                            logo: 'fas fa-paint-roller',
                            entries: [getLoadingEntry()],
                            callback: () => {
                                let alreadyChosenColor = Theme.get('bgcolor'), curPath = Menu.path, wpfile = "assets/images/wallpaper.png";
                                getImageColorsForTheming(Theme.get('background') || wpfile, (colors) => {
                                    let alreadyChosenIndex = -1;
                                    console.warn('WOW', curPath, Menu.path, colors);
                                    var entries = colors.darkColors.concat(colors.lightColors).map((color, i) => {
                                        let _color = color;
                                        if(_color == alreadyChosenColor) {
                                            alreadyChosenIndex = i;
                                        }
                                        return {
                                            name: _color,
                                            type: 'option',
                                            logo: 'fas fa-circle',
                                            logoColor: _color,
                                            callback: (data, element) => {
                                                setEntryFlag(element, 'fa-check-circle', true);
                                                Theme.set('bg', "linear-gradient(to top, #000004 0%, "+_color+" 75%)");
                                                Theme.set('bgcolor', _color);
                                                loadTheming()
                                            }
                                        }
                                    });
                                    entries.push({
                                        name: Lang.OTHER_COLOR,
                                        type: 'option',
                                        logo: 'fa-palette',
                                        callback: (data, element) => {
                                            pickColor((_color) => {
                                                if(_color){
                                                    Theme.set('bg', "linear-gradient(to top, #000004 0%, "+_color+" 75%)");
                                                    Theme.set('bgcolor', _color);
                                                    loadTheming()
                                                }
                                            }, alreadyChosenColor)
                                        }
                                    });
                                    if(curPath == Menu.path){
                                        Menu.container(true);
                                        backEntryRender(Menu.container(true), dirname(curPath), basename(curPath));
                                        Menu.render(entries, curPath);
                                        if(alreadyChosenIndex != -1){
                                            setEntryFlag(Menu.entries(false, false).get(alreadyChosenIndex + 1), 'fa-check-circle', true)
                                        }
                                    }
                                })
                            }
                        },
                        {
                            name: Lang.FONT_COLOR, 
                            type: 'group',
                            logo: 'fa-paint-brush',
                            entries: [getLoadingEntry()],
                            callback: () => {
                                let alreadyChosenColor = Theme.get('fgcolor'), curPath = Menu.path, wpfile = "assets/images/wallpaper.png";
                                getImageColorsForTheming(wpfile, (colors) => {
                                    let alreadyChosenIndex = -1;
                                    console.warn('WOW', curPath, Menu.path, colors);
                                    var entries = colors.darkColors.concat(colors.lightColors).map((color, i) => {
                                        let _color = color;
                                        if(_color == alreadyChosenColor){
                                            alreadyChosenIndex = i;
                                        }
                                        return {
                                            name: _color,
                                            type: 'option',
                                            logo: 'fas fa-circle',
                                            logoColor: _color,
                                            callback: (data, element) => {
                                                setEntryFlag(element, 'fa-check-circle', true);
                                                Theme.set('fgcolor', _color);
                                                loadTheming()
                                            }
                                        }
                                    });
                                    entries.push({
                                        name: Lang.OTHER_COLOR,
                                        type: 'option',
                                        logo: 'fa-palette',
                                        callback: (data, element) => {
                                            pickColor((_color) => {
                                                if(_color){
                                                    Theme.set('fgcolor', _color);
                                                    loadTheming()
                                                }
                                            }, alreadyChosenColor)
                                        }
                                    });
                                    if(curPath == Menu.path){
                                        Menu.container(true);
                                        backEntryRender(Menu.container(true), dirname(curPath), basename(curPath));
                                        Menu.render(entries, curPath);
                                        if(alreadyChosenIndex != -1){
                                            setEntryFlag(Menu.entries(false, false).get(alreadyChosenIndex + 1), 'fa-check-circle', true)
                                        }
                                    }
                                })
                            }
                        },               
                        {
                            name: Lang.FONT_SIZE, 
                            type: 'group',
                            logo: 'fa-font',
                            entries: [
                                {name: Lang.VERY_SMALL, logo: 'fa-font', type: 'option', fontSize: 0.75, callback: setFontSizeCallback},
                                {name: Lang.SMALL, logo: 'fa-font', type: 'option', fontSize: 0.875, callback: setFontSizeCallback},
                                {name: Lang.NORMAL, logo: 'fa-font', type: 'option', fontSize: 1, callback: setFontSizeCallback},
                                {name: Lang.BIG, logo: 'fa-font', type: 'option', fontSize: 1.5, callback: setFontSizeCallback},
                                {name: Lang.VERY_BIG, logo: 'fa-font', type: 'option', fontSize: 1.75, callback: setFontSizeCallback}
                            ],
                            callback: () => {
                                setActiveEntry({fontSize: Theme.get('font-size')})
                            }
                        },                
                        {
                            name: Lang.ICON_SIZE, 
                            type: 'group',
                            logo: 'fa-th-large',
                            entries: [
                                {name: Lang.VERY_SMALL, logo: 'fa-th-large', type: 'option', iconSize: 24, callback: setIconSizeCallback},
                                {name: Lang.SMALL, logo: 'fa-th-large', type: 'option', iconSize: 30, callback: setIconSizeCallback},
                                {name: Lang.NORMAL, logo: 'fa-th-large', type: 'option', iconSize: 36, callback: setIconSizeCallback},
                                {name: Lang.BIG, logo: 'fa-th-large', type: 'option', iconSize: 50, callback: setIconSizeCallback},
                                {name: Lang.VERY_BIG, logo: 'fa-th-large', type: 'option', iconSize: 68, callback: setIconSizeCallback}
                            ],
                            callback: () => {
                                setActiveEntry({iconSize: Theme.get('iconsize')})
                            }
                        },
                        {
                            name: Lang.TRANSPARENT_MENU, 
                            type: 'slider', 
                            logo: 'fa-adjust', 
                            label: 'saturation', 
                            range: {start: 0, end: 100}, 
                            getValue: (data) => {
                                return Theme.get('menu-transparency')
                            },
                            value: Theme.get('menu-transparency'),
                            change:  (data, element, value) => {
                                Theme.set('menu-transparency', value);
                                clearTimeout(window['loadThemingApplyTimer']);
                                window['loadThemingApplyTimer'] = setTimeout(loadTheming, 400)
                            }
                        }, 
                    ]
                },
                {
                    name: Lang.HIDE_BUTTON_OPT.format(Lang.BACK, 'Backspace'), 
                    type: 'check', 
                    check: (checked) => {
                        Theme.set('hide-back-button',checked);
                        Menu.refresh()
                    }, 
                    checked: () => {return Theme.get('hide-back-button')}
                }, 
                {
                    name: Lang.ANIMATE_BACKGROUND_ON_TUNING, 
                    type: 'group', 
                    logo: 'fa-cog',
                    entries: [
                        {name: 'None', type: 'option', animation: 'none', callback: setBackgroundAnimationCallback},
                        {name: 'Spin X', type: 'option', animation: 'spin-x', callback: setBackgroundAnimationCallback}
                    ],
                    callback: () => {
                        setActiveEntry({animation: Config.get('tuning-background-animation')})
                    }
                }, 
                {name: Lang.EXPORT_THEME, logo:'fa-file-export', type: 'option', callback: () => {
                    saveAs('theme.json', (file) => {
                        if(file){
                            exportTheme(file, () => {})
                        }
                    })
                }},
                {name: Lang.IMPORT_THEME, logo:'fa-file-import', type: 'option', callback: () => {
                    openFileDialog((file) => {
                        importTheme(file, loadTheming)
                    }, '.json')
                }},
                {name: Lang.RESET_THEME, logo:'fa-trash', type: 'option', callback: resetTheme}
            ]},
            {name: Lang.SECURITY, logo: 'fa-shield-alt', type: 'group', entries: [
                {
                    name: Lang.HIDE_LOGOS,
                    type: 'check',
                    check: (checked) => {
                        Theme.set('hide-logos', checked);
                        showLogos = !checked;
                    }, 
                    checked: () => {
                        return Theme.get('hide-logos')
                    }
                },
                {
                    name: Lang.HIDE_ADULT_CONTENT,
                    type: 'check',
                    check: (checked) => {
                        Config.set('show-adult-content', !checked);
                        showAdultContent = !checked;
                        if(typeof(cb) == 'function'){
                            cb(showAdultContent)
                        }
                    }, 
                    checked: () => {
                        return !Config.get('show-adult-content')
                    }
                },
                {
                    type: 'input',
                    logo: 'assets/icons/white/shield.png',
                    change: function (entry, element, val){
                        Config.set('parental-control-terms', val)
                    },
                    value: userParentalControlTerms().join(','),
                    placeholder: Lang.FILTER_WORDS,
                    name: Lang.FILTER_WORDS
                }
            ]},
            {name: Lang.PLAYBACK, logo:'fa-play', type: 'group', entries: [
                {name: Lang.RESUME_PLAYBACK, type: 'check', check: (checked) => {
                    Config.set('resume',checked)
                }, checked: () => {
                    return Config.get('resume')
                }},
                {name: Lang.FORCE_TRANSCODE, type: 'check', check: (checked) => {
                    Config.set('force-transcode', checked)
                }, checked: () => {
                    return Config.get('force-transcode')
                }}
            ]},
            {name: Lang.TUNE, logo:'fa-broadcast-tower', type: 'group', entries: [
                {name: Lang.ALLOW_SIMILAR_TRANSMISSIONS, type: 'check', check: (checked) => {
                    Config.set('similar-transmissions', checked)
                }, checked: () => {return Config.get('similar-transmissions')}},
                {name: Lang.PLAY_WHILE_TUNING, type: 'check', check: (checked) => {
                    Config.set('play-while-tuning', checked)
                }, checked: () => {
                    return Config.get('play-while-tuning')
                }},
                {name: Lang.IGNORE_WEB_PAGES, type: 'check', check: (checked) => {
                    Config.set('ignore-webpage-streams', checked)
                }, checked: () => {
                    return Config.get('ignore-webpage-streams')
                }},
                {name: Lang.SEARCH_RANGE, logo: 'fa-search', type: 'group', renderer: getSearchRangeEntries, entries: [], callback: () => {
                    setActiveEntry({
                        value: Config.get('search-range-size')
                    })
                }},
                {name: Lang.SEARCH_LIVE, type: 'check', check: (checked) => {
                    Config.set('search-live', checked)
                }, checked: () => {
                    return Config.get('search-live')
                }},
                {name: Lang.SEARCH_VOD, type: 'check', check: (checked) => {
                    Config.set('search-vod', checked)
                }, checked: () => {
                    return Config.get('search-vod')
                }},
                {name: Lang.ADVANCED, logo:'fa-cogs', type: 'group', renderer: () => {
                    return [
                        {name: Lang.CONNECT_TIMEOUT, type: 'slider', logo: 'fa-plug', mask: '{0}s', value: Config.get('connect-timeout'), range: {start: 25, end: 120}, change: (data, element) => {
                            Config.set("connect-timeout", data.value)
                        }},
                        {name: Lang.MIN_BUFFER_BEFORE_COMMIT, type: 'slider', logo: 'fa-stopwatch', mask: '{0}s', value: Config.get('min-buffer-secs-before-commit'), range: {start: 2, end: 60}, change: (data, element) => {
                            Config.set("min-buffer-secs-before-commit", data.value)
                        }},
                        {name: Lang.RESET_CONFIG, type: 'option', logo: 'fa-undo', callback: () => {
                            Config.set("connect-timeout", Config.defaults["connect-timeout"]);
                            Config.set("min-buffer-secs-before-commit", Config.defaults["min-buffer-secs-before-commit"]);
                            Menu.refresh()
                        }}
                    ]
                }}
            ]},
            {name: Lang.EXPORT_IMPORT, logo:'fa-cogs', type: 'group', entries: [
                {name: Lang.EXPORT_CONFIG, logo:'fa-file-export', type: 'option', callback: () => {
                    saveAs('configure.json', (file) => {
                        if(file){
                            exportConfig(file, () => {})
                        }
                    })
                }},
                {name: Lang.IMPORT_CONFIG, logo:'fa-file-import', type: 'option', callback: () => {
                    openFileDialog((file) => {
                        importConfig(file, restartApp)
                    }, '.json')
                }},
                {name: Lang.RESET_CONFIG, logo:'fa-trash', type: 'option', callback: resetConfig}
            ]},
            {name: Lang.EXIT, logo:'fa-sign-out-alt', type: 'option', callback: closeApp}
        ]
    }];
});

// LOAD FEATURED CHANNEL
jQuery(document).one('lngload', () => {
    setTimeout(() => {
        getWatchingData((entries) => {
            var entry = false;
            for(var i=0; i<entries.length; i++){
                if(isLive(entries[i].url)){
                    entry = Object.assign({}, entries[i]);
                    break;
                }
            }
            if(entry){
                var go = (iconExists) => {
                    if(!iconExists){
                        entry.logo = 'fa-fire';
                    }
                    console.log('GOING', Menu.index[0], Menu.index[0].type, Menu.index[0].name, entry.name, Menu.index[0].prependName, Lang.FEATURED+': ');
                    injectFeaturedOption(entry);
                    injectContinueOptions();
                    console.log('[INIT] Featured entry loaded.')
                }
                if(entry.logo && entry.logo.substr(0, 3)!='fa-'){
                    checkImage(entry.logo, () => {
                        go(true)
                    }, () => {
                        go(false)
                    })
                } else {
                    go(false)
                }
            } else {
                console.log('[INIT] Featured entry loaded.')
            }
        }, true)
    }, 100)
});


var requestIdReferersTable = [], minVideoContentLength = (50 * (1024 * 1024)), fitterEnabled = true;
function menuScrollUp(){
    jQuery('.list').stop().animate({scrollTop: 0}, 75, 'swing')
}

var userLocales = [getLocale(false), getLocale(true), 'en'].getUnique(), initialTasks = [], buildSearchIndexCallback = () => {};

function handleOpenArguments(cmd){
    console.log('OPEN', cmd);
    // minimist module was giving error: notFlags.forEach is not a function
    // do it raw for now and better another day
    if(typeof(cmd)=='string'){
        cmd = cmd.split(' ')
    }
    console.log('OPEN 2', cmd);
    for(var i=0; i<cmd.length; i++){
        var force = false;
        if(cmd[i].charAt(0)=='-'){
            continue;
        }
        cmd[i] = cmd[i].replaceAll("'", "").replaceAll('"', '');
        if(cmd[i]){
            console.log('OPEN 3', cmd[i], getExt(cmd[i]));
            if(getExt(cmd[i])=='mega'){
                openMegaFile(cmd[i]);
                break;
            } else if(force || cmd[i].match(new RegExp('(rt[ms]p[a-z]?:|mms[a-z]?:|mega:|magnet:|\.(m3u8?|mp4|flv))', 'i'))){
                cmd[i] = cmd[i].replaceAll("'", "").replaceAll('"', '');
                console.log('PLAY', cmd[i]);
                var o = getFrame('overlay');
                if(o){
                    o.processFile(cmd[i])
                }
                break;
            }
            console.log('OPEN 4', cmd[i]);
        }
    }
}

gui.App.on('open', function (argString) {
    handleOpenArguments(argString)
});

function init(){

    var completeIterator = 0;

    var updateProgress = (i) => {
        completeIterator += i;
        doAction('shared-lists-index-progress', completeIterator, initialTasks.length, completeIterator / (initialTasks.length / 100))
    }

    // LOAD CUSTOM FRAME
    initialTasks.push((llcb) => {
        updateProgress(0.5);
        jQuery(document).on('lngload', () => {
            var customFrameState = isFullScreen() ? 'fullscreen' : (isMaximized() ? 'maximized' : '');
            var nwcf = require(path.resolve('other_modules/nw-custom-frame'));
            nwcf.attach(window, {
                "size": 30, // You can specify the size in em,rem, etc...
                "frameIconSize": 21, // You can specify the size in em,rem, etc...
                "includeCSS": false, 
                "customFrameState": customFrameState,
                "locales": {
                    'en': {
                        "close": Lang.CLOSE,
                        "maximize": Lang.MAXIMIZE,
                        "restore": Lang.RESTORE,
                        "minimize": Lang.MINIMIZE
                    },
                    locale: {
                        "close": Lang.CLOSE,
                        "maximize": Lang.MAXIMIZE,
                        "restore": Lang.RESTORE,
                        "minimize": Lang.MINIMIZE
                    }
                },
            });
            updateProgress(0.5);
            console.log('[INIT] Custom frame loaded.');
            llcb()
        })
    });
    
    // ADJUST UI
    initialTasks.push((llcb) => {
        updateProgress(0.5);
        jQuery(document).on('lngload', () => {
            document.title = appName();
            jQuery('body').on('click', (e) => { 
                if(e.target.tagName.toLowerCase()=='body'){ // fallback for when #sandbox or #player has pointer-events: none
                    PlaybackManager.play()
                }
            });
            jQuery('#controls').removeClass('hide').addClass('show'); 
            var actions = {
                'RELOAD': goReload,
                'TRY_OTHER_STREAM': switchPlayingStream,
                'STOP': () => {
                    stop()
                }
            };
            jQuery("#player-top-bar a").each((i, element) => {
                var je = jQuery(element), key = je.attr('data-title-lng-key');
                if(key && Lang[key]){
                    je.attr('aria-label', Lang[key]).prop('title', Lang[key]).on('mousedown', actions[key]);
                    je.find('span').html(Lang[key])
                }
            }).on('click', (event) => {
                event.preventDefault();
                event.stopPropagation()
            });
            jQuery('div#drop-hint').html('<div><i class="fas fa-arrows-alt"></i> ' + wordWrapPhrase(Lang.DRAG_HERE, 3, "<br />")+'</div>');
            var statsAlive = () => {
                var s = sendStatsPrepareEntry(currentStream());
                sendStats('alive', s)
            }
            setInterval(statsAlive, 600000); // each 600 secs
            setTimeout(statsAlive, 5000);
            updateProgress(0.5);
            console.log('[INIT] UI adjusted (1).');
            llcb();
            jQuery(document).triggerHandler('beforeshow')
        });
    });
    
    // ADJUST UI 2
    initialTasks.push((llcb) => {
        updateProgress(0.5);
        jQuery(document).on('beforeshow', () => { // tricky hack to solve a font drawing bug
            console.error('one');
            var t = jQuery('.nw-cf-buttons'), is = t.find('i');
            is.each((i, el) => {
                el = jQuery(el);
                el.prop('className', el.prop('className').
                    replaceAll('nw-cf-icon-close', 'nw-cf-icon fas fa-times').
                    replaceAll('nw-cf-icon-restore', 'nw-cf-icon fas fa-window-restore').
                    replaceAll('nw-cf-icon-maximize', 'nw-cf-icon far fa-window-maximize').
                    replaceAll('nw-cf-icon-minimize', 'nw-cf-icon fas fa-window-minimize')
                )
            });
            var close = jQuery('.nw-cf-close');
            close.replaceWith(close.outerHTML()); // override closing behaviour
            jQuery('#menu-trigger-icon').prop('title', Lang.SHOW_HIDE_MENU).attr('aria-label', Lang.SHOW_HIDE_MENU);
            jQuery.getScript("assets/fa/js/all.js");
            jQuery('.nw-cf-close').on('click', closeApp);
            //win.on('minimize', minimizeCallback);
            jQuery('.nw-cf-btn.nw-cf-minimize').on('click', minimizeCallback);
            if(!Config.get('locale')){
                var locale = getLocale(true);
                if(locale == 'en'){
                    jQuery.getJSON('http://app.megacubo.net/get-lang', (data) => {
                        if(data.length == 2 && data != 'en') {
                            // unsure of language, ask user
                            goChangeLang()
                        } else {
                            Config.set('locale', 'en')
                        }
                    })
                }
            }
            updateProgress(0.5);
            console.log('[INIT] UI adjusted (2).');
            llcb()
        })
    });
    
    // LOAD MAIN LANGUAGE FILES
    initialTasks.push((llcb) => {
        updateProgress(0.5);
        loadLanguage(userLocales, 'lang', () => {
            updateProgress(0.5);
            console.log('[INIT] Lang loaded.');
            llcb();    
            jQuery(document).triggerHandler('lngload')
        })
    });

    // LOAD ADDONS
    initialTasks.push((cb) => {
        updateProgress(0.5);
        loadAddons(() => {
            console.log('[INIT] Addons loaded.');
            updateProgress(0.5);
            cb()
        })
    });

    // BIND WEBREQUEST
    initialTasks.push((cb) => {
        updateProgress(0.5);
        bindWebRequest();
        console.log('[INIT] WebRequest binded.');
        updateProgress(0.5);
        cb()
    });

    // INDEXER
    initialTasks.push((cb) => {
        updateProgress(0.5);
        initSearchIndex(() => {
            updateProgress(0.5);
            console.log('[INIT] Indexer done.');
            cb()
        });
        console.log('[INIT] Indexer called.');
    });

    async.parallel(initialTasks, (err, results) => {
        jQuery(document).triggerHandler('appload');
        console.log('[INIT] App loaded.');
        if (err) {
            throw err;
        }
    });
}
