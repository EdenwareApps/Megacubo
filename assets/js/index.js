
var os = require('os'), mkdirp = require('mkdirp'), jWin = jQuery(window), jB = jQuery('body'), lastOnTop, castManager;
var isSDKBuild = (window.navigator.plugins.namedItem('Native Client') !== null);
var clipboard = gui.Clipboard.get();

//gui.App.setCrashDumpDir(process.cwd());

function resetData(){
    removeFolder('torrent', false, function (){
        removeFolder('data', false, function (){
            nw.App.clearCache();
            top.location.reload()
        })
    })
}

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
    //restoreInitialSize();  
    setFullScreen(false);
    win.setAlwaysOnTop(false);
    doAction('miniplayer-off')
}

addAction('miniplayer-on', () => {
    //console.log('MP-ON');
    jB.addClass('miniplayer');
    win.setAlwaysOnTop(true);
    win.setShowInTaskbar(false);
    //console.log('MP-ON');
    fixMaximizeButton();
    PlaybackManager.play();
    afterExitPage()
    //console.log('MP-ON');
})

addAction('miniplayer-off', () => {
    //console.log('MP-OFF');
    jB.removeClass('miniplayer');
    //console.log('MP-OFF');
    win.setAlwaysOnTop(false);
    //console.log('MP-OFF');
    win.setShowInTaskbar(true);
    //console.log('MP-OFF');
    fixMaximizeButton();
    //console.log('MP-OFF');
})

function toggleMiniPlayer(){
    if(miniPlayerActive){
        leaveMiniPlayer()
    } else {
        enterMiniPlayer()
    }
}

function maximizeWindow(){
    maxPortViewSize(screen.availWidth + 15, screen.availHeight + 14);
    win.maximize();
    showRestoreButton();
}

function toggleFullScreen(){
    setFullScreen(!isFullScreen());
}

var useKioskForFullScreen = false;
function escapePressed(){
    //win.leaveKioskMode();
    //win.leaveFullscreen();
    //restoreInitialSize();
    if(isFullScreen()){
        setFullScreen(false)
    } else if(isMiniPlayerActive()) {
        leaveMiniPlayer()
    } else {
        stop()
    }
}

function isMaximized(){
    var w = top || window, widthMargin = 24, heightMargin = 72;
    return (w.outerWidth >= (screen.width - widthMargin) && w.outerHeight >= (screen.height - heightMargin));
}

function maximizeOrRestore(){
    if(top){
        if(isMiniPlayerActive()){
            top.leaveMiniPlayer();
        } else {
            if(isMaximized()){
                win.unmaximize();
            } else {
                win.hide();
                win.maximize();
                win.show();
            }
        }
    }
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

function afterExitPage(){
    if(allowAfterExitPage && installedVersion){
        var lastTime = Store.get('after-exit-time'), t = time();
        if(!lastTime || (t - lastTime) > (24 * 3600)){
            Store.set('after-exit-time', t);
            var url = Config.get("after-exit-url").format(installedVersion);
            gui.Shell.openExternal(url)
        }
    }
}

function shutdown(){
    var cmd, secs = 7, exec = require("child_process").exec;
    if(process.platform === 'win32') {
        cmd = 'shutdown -s -f -t '+secs+' -c "Shutdown system in '+secs+'s"';
    } else {
        cmd = 'shutdown -h +'+secs+' "Shutdown system in '+secs+'s"';
    }
    return exec(cmd)
}

function closeWindow(){
    if(miniPlayerActive){
        leaveMiniPlayer();
    } else {
        afterExitPage();
        window.close();
        /*
            gui.App.crashBrowser();
            gui.App.crashRenderer();
            process.exit();
            gui.App.quit();
            window.top.close(); // Not fixed at 2018? https://github.com/nwjs/nw.js/issues/984 so ensure to close the window
            gui.App.closeAllWindows(); // breaks duplicate feature
            process.kill(process.pid * -1, 'SIGKILL')
        */
    }
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
    getManifest(function (manifest){
        var enableFlags = ['--disable-gpu-blacklist'];
        var disableFlags = ['--disable-gpu', '--force-cpu-draw'];
        enableFlags.concat(disableFlags).forEach((flag) => {
            manifest['chromium-args'] = manifest['chromium-args'].replace(flag, '')
        });
        (enable?enableFlags:disableFlags).forEach((flag) => {
            manifest['chromium-args'] = manifest['chromium-args'] += ' '+flag;
        });
        fs.writeFile('package.json', JSON.stringify(manifest, null, 4))
    })
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
    if(PlaybackManager.activeIntent){
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
    if(!top){ // unloading raises "Cannot read property 'window' of null" sometimes
        return;
    }
    if(!PlaybackManager.activeIntent){
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
    if(PlaybackManager.playing()){
        //console.log('NOTIFY1');
        playPauseNotifyContainers().removeClass('paused').addClass('playing');
        notify(c, PlaybackManager.activeIntent.entry.logo || 'fa-play', 4)
        //console.log('NOTIFY');
    } else {
        //console.log('NOTIFY2');
        playPauseNotifyContainers().removeClass('playing').addClass('paused');
        notify(Lang.PAUSE, 'fa-pause', 'short')
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

function callSideload(url, referer){
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

var requestIdReferersTable = {}, requestIdReferersTableLimit = 256, isRecording = false, requestIdMap = {}, requestCtypeMap = {}, requestIdMapLimit = 256, minVideoContentLength = (10 * 1024);
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
        if(isRecording && message == 'Network.loadingFinished') { 
            var shouldSave = ['ts'].indexOf(getExt(requestIdMap[rid])) != -1;
            if(!shouldSave){
                //console.warn('OOOOOOOOOOOOO', requestCtypeMap, requestIdMap[rid], typeof(requestCtypeMap[requestIdMap[rid]]));
                if(typeof(requestCtypeMap[requestIdMap[rid]])!='undefined'){
                    if(requestCtypeMap[requestIdMap[rid]].match(new RegExp('(video|mpeg)', 'i'))){
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
                    doAction('media-received', requestIdMap[rid], local, 'path');
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
                            console.log('MEDIA RECEIVED');
                            doAction('media-received', requestIdMap[rid], response, 'content');
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
        jQuery(window).on('beforeunload unload', function (){
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

function startRecording(){
    if(isRecording === false){
        let folder = 'recordings/session';
        fs.mkdir(folder, function(err){
            removeFolder(folder, false, () => { // just empty the folder
                var url = PlaybackManager.getURL();
                if(isMagnet(url)){
                    folder = 'torrent/torrent-stream/'+PlaybackManager.activeIntent.peerflix.torrent.infoHash+'/'+PlaybackManager.activeIntent.peerflix.torrent.name;
                    gui.Shell.showItemInFolder(absolutize(folder))
                } else if(!isLive(url) && isVideo(url)){
                    gui.Shell.openExternal('http://play.megacubo.tv/mp4-player?url='+encodeURIComponent(url))
                } else {
                    isRecording = {folder: folder}; // recording now
                    doAction('recording-start', folder)
                }
            })
        })
    }
}

function stopRecording(){
    if(isRecording !== false){
        var name, stream = currentStream();
        if(stream){
            name = stream.name;
        } else {
            name = 'Unknown';
        }
        console.log('Saving recording: 1');
        name += " "+dateStamp();
        var data = isRecording, outputFile = dirname(data.folder) + '/'+prepareFilename(name)+'.mp4';
        isRecording = false;
        doAction('recording-stop', data);        
        doAction('recording-save-start', data);
        console.log('Saving recording: 2', data);
        fs.readdir(data.folder, function (err, files){
            console.log('Saving recording: 3', err, files);
            if(!files || !files.length){
                console.log('Error while saving file list.', data.folder);
                //gui.Shell.openExternal(absolutize(data.folder));
                doAction('recording-save-failure', data, 1)
            } else {
                console.log('Saving recording: 4', files);
                var failure = (err) => {
                    console.log('Error while saving file list.', err);
                    //gui.Shell.openExternal(absolutize(data.folder));
                    doAction('recording-save-failure', data, 2)
                }
                var success = (output) => {
                    console.log('Saving record success.', output);
                    Recordings.sync();
                    removeFolder(data.folder);
                    doAction('recording-save-end', output, data);
                    if(!isFullScreen()){
                        gui.Shell.showItemInFolder(absolutize(output))
                    }
                    console.log('Saving recording: 7');
                }
                var callback = (err, output) => {
                    console.log('Saving recording: 6', err, output);
                    if(err){
                        if(files.length > 1){
                            console.log('Join failure, removing last segment.');
                            files.pop();
                            goJoin(files)
                        } else {
                            console.log('Saving recording failure.');
                            failure(err)
                        }
                    } else {
                        console.log('Saving recording success.');
                        success(output)
                    }
                }
                var goJoin = (files) => {
                    console.log('Saving recording: 5', files);
                    filterWorkingVideos(files, data.folder, (_files) => {
                        joinFiles(_files, data.folder, outputFile, callback)
                    })       
                }
                goJoin(files)
            }
        })
    }
}

function filterWorkingVideos(files, path, cb){
    var workingFiles = [], iterator = 0;
    if(!async){
        async = require('async');
    }
    var tasks = Array(files.length).fill((callback) => {
        var file = files[iterator];
        iterator++;
        getFFmpegMediaInfo(path+'/'+file, (info) => {
            if(info && info.indexOf('Stream #0') != -1){
                workingFiles.push(file)
            }
            callback()
        })
    });
    async.parallelLimit(tasks, 3, (err, results) => {
        cb(workingFiles)
    })
}    

function joinFiles(files, folder, outputFile, callback){
    console.log('JOIN', files, callback);
    if(files.length){
        var list = '', listFile = folder+'/list.txt', hits = [];
        for(var i=0; i<files.length; i++){
            if(['ts', 'mp4'].indexOf(getExt(files[i]))!=-1){
                hits.push(folder+'/'+files[i]);
                list += "file "+files[i]+"\r\n";
            }
        }
        console.log(list, listFile, files);
        fs.writeFile(listFile, list, function (err){
            if(err){
                callback('Failed to write temp list on disk.')
            } else {
                var joinedFile = folder + '/joined.ts', lastStep = function (){
                    var saver = ffmpeg({source: joinedFile}).
                    videoCodec('copy').
                    audioCodec('aac').
                    inputOptions('-y').
                    addOption('-bsf:a aac_adtstoasc').
                    format('mp4').
                    output(outputFile).
                    on('start', function(commandLine) {
                        console.log('Spawned FFmpeg with command: ' + commandLine)
                    }).
                    on('error', function (err){
                        console.log('Error while saving output file.', outputFile, err);
                        callback(null, joinedFile)
                    }).
                    on('end', function (){
                        callback(null, outputFile)
                    }).run()
                }
                if(!hits.length){
                    callback('Bad segments.')
                } else if(hits.length > 1){
                        var joiner = ffmpeg({source: listFile}).
                        videoCodec('copy').
                        audioCodec('aac').
                        inputOptions('-y').
                        inputOptions('-safe 0').
                        inputOptions('-f concat').
                        addOption('-c copy').
                        output(joinedFile).
                        on('start', function (commandLine) {
                            console.log('Spawned FFmpeg with command: ' + commandLine)
                        }).
                        on('error', function (err){
                            console.error(err);
                            callback('Failed to generate joined file.')
                        }).
                        on('end', lastStep).run()
                } else {
                    joinedFile = hits[0];
                    lastStep()
                }
            }
        })
    } else {
        callback('Empty file list.')
    }
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

function modalConfirm(question, answers, callback){
    var a = [];
    for(var k in answers){
        a.push(jQuery('<span class="button">'+answers[k][0]+'</span>').on('click', answers[k][1]))
    }
    var b = jQuery('<div class="prompt prompt-'+a.length+'-columns">'+
                '<span class="prompt-header">'+nl2br(question)+'</span>'+
                '<span class="prompt-footer"></span></div>');
    b.find('.prompt-footer').append(a);
    makeModal(b);
    top.focus()
}

function modalPrompt(question, answers, placeholder, value){
    var a = [];
    console.warn(answers);
    answers.forEach((answer) => {
        a.push(jQuery('<span class="button">'+answer[0]+'</span>').on('click', answer[1]))
    });
    var b = jQuery('<div class="prompt prompt-'+a.length+'-columns">'+
                '<span class="prompt-close"><a href="javascript:modalClose();void(0)"><i class="fas fa-times-circle" aria-hidden="true"></i></a></span>'+
                '<span class="prompt-header">'+nl2br(question)+'</span>'+
                '<input type="text" />'+
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
            } else if (event.keyCode === 27) {
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

function testEntry(stream, success, error, returnSucceededIntent){
    var resolved = false, intents = [];
    if(isMagnet(stream.url) || isMega(stream.url) || isYT(stream.url)){
        success();
        return intents;
    }
    var checkr = () => {
        if(resolved) return;
        var worked = false, complete = 0, succeededIntent = null;
        for(var i=0; i<intents.length; i++){
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
    intents = createPlayIntent(stream, {maxTimeout: 20, shadow: true, manual: false, start: checkr, error: checkr, ended: checkr});
    return intents;
}

function isFullScreen(){
    return !!(win.isKioskMode || win.isFulscreen)
}

function maxPortViewSize(width, height){
    if(process.platform === 'win32' && parseFloat(os.release(), 10) > 6.1 && width && height) {
        //win.setMaximumSize(Math.round(width), Math.round(height));
        // win.setMaximumSize(screen.width, screen.height);
    }
}

var enableSetFullScreenWindowResizing = false;

function setFullScreen(enter){
    console.warn('setFulllscreen()', enter);
    if(!enter){
        miniPlayerActive = false;
        doAction('miniplayer-off');
        win.leaveKioskMode(); // bugfix, was remembering to enter fullscreen irreversibly
        win.leaveFullscreen()
        if(enableSetFullScreenWindowResizing){
            var s = initialSize();
            if(document.readyState.indexOf('in')==-1){
                maxPortViewSize(screen.availWidth + 15, screen.availHeight + 14);
            } else {
                maxPortViewSize(s.width, s.height);						
            }
            centralizedResizeWindow(s.width, s.height, false)
        }
        console.log('SIZE', s.width, s.height);
        if(typeof(window['fixMaximizeButton'])=='function'){
            fixMaximizeButton()
        }
    } else {
        maxPortViewSize(screen.width + 1, screen.height + 1);
        if(useKioskForFullScreen){
            win.enterKioskMode() // bugfix, was remembering to enter fullscreen irreversibly
        } else {
            win.enterFullscreen()
        }
        notify(Lang.EXIT_FULLSCREEN_HINT, 'fa-info-circle', 'normal')
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

function initialSize(){
    console.warn('initialSize()', traceback());
    var recommendedWidth = 1006, margin = 20, maxWidth = (screen.availWidth - (margin * 2));
    if(maxWidth < recommendedWidth){
        recommendedWidth = maxWidth;
    }
    return {width: Math.round(recommendedWidth), height: Math.round((recommendedWidth / 16) * 9)};
}

function restoreInitialSize(){
    console.warn('restoreInitialSize()');
    jQuery('body').removeClass('miniplayer');
    setFullScreen(Config.get('start-in-fullscreen'))
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

function sendStats(action, data){
    var postData = data ? jQuery.param(data) : '';
    var options = {
        hostname: 'app.megacubo.net',
        port: 80,
        path: '/stats/'+action,
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
        }
    }
    if(typeof(http)=='undefined'){
        http = require('http')
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

var autoCleanHintShown = false;
patchMaximizeButton();

jQuery(() => {
    gui.Window.get().on('close', closeWindow);
    jQuery("#menu-trigger-icon").on('mousedown mouseup', (e) => {
        showControls();
        e.preventDefault(); // don't pause on clicking
        e.stopPropagation()
    })
});

win.on('new-win-policy', function(frame, url, policy) {
    policy.ignore(); // IGNORE = BLOCK
    console.log('POPUP BLOCKED', frame, url, policy);    
    // CHECK AFTER IF IT'S A RELEVANT POPUP
    setTimeout(() => {
        shouldOpenSandboxURL(url, function (url){
            document.querySelector('iframe#sandbox').src = url;
        })
    }, 0)
})

win.on('restore', () => {
    fixMaximizeButton() // maximize icon disappearing on unminimize
})

win.on('close', () => {
    stop();
    //gui.App.closeAllWindows();
    win.close(true);
    //nw.App.quit();
    //process.exit()
})

function minimizeCallback() {
    console.log('Window is minimized');
    if((PlaybackManager.activeIntent || inPendingState()) && !miniPlayerActive){
        restoreInitialSize();
        enterMiniPlayer()
    } else {
        win.setShowInTaskbar(true)
    }
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
    var entries = fetchSharedListsSearchResults(null, 'live', name, false);
    var check = () => {
        var entry = entries.shift();
        checkImage(entry.logo, () => {
            image.src = entry.logo;
        }, check)
    }
    check()
}

function playerRecordingButton(){
    return document.querySelector('#ptb-record')
}

addAction('recording-start', () => {
    var b = playerRecordingButton();
    if(b){
        b.title = Lang.STOP_RECORDING;
        b.getElementsByTagName('span')[0].innerHTML = Lang.STOP_RECORDING;
    }
});

addAction('recording-save-start', () => {
    var b = playerRecordingButton();
    if(b){
        b.title = Lang.SAVING_RECORDING;
        b.getElementsByTagName('span')[0].innerHTML = Lang.SAVING_RECORDING;
    }
});

addAction('recording-save-end', () => {
    var b = playerRecordingButton();
    if(b){
        b.title = Lang.START_RECORDING;
        b.getElementsByTagName('span')[0].innerHTML = Lang.START_RECORDING;
    }
});

addAction('recording-save-failure', () => {
    var b = playerRecordingButton();
    if(b){
        b.title = Lang.START_RECORDING;
        b.getElementsByTagName('span')[0].innerHTML = Lang.START_RECORDING;
    }
});

var tb = jQuery(top.document).find('body');
function prepareVideoObject(videoElement, intent){ // intent is empty for native player
    if(!videoElement || !videoElement.ownerDocument){
        return;
    }
    var doc = videoElement.ownerDocument, ps = doc.getElementById('player-status');
    if(!ps){
        var scope = doc.defaultView;
        var seeking, paused, wasPaused, player = jQuery(videoElement), b = jQuery(doc.querySelector('body')), f = (e) => {
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
        fs.readFile('assets/css/player.css', (err, content) => {
            if(content){
                console.log('Applying CSS...');
                stylizer(content, 'player-css', scope);
                console.log('Applied CSS.');
            }
        });
        videoObserver = new ResizeObserver(f);
        videoObserver.observe(videoElement);
        jQuery(scope).on('load resize', f);
        var mouseDownTime = 0, allowTimeoutReload = (intent && intent.type == 'frame' && !isVideo(videoElement.src)), reloadTimer = 0, reloadTimeout = 10000;
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
                    b.addClass('loading').removeClass('paused');
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
                b.removeClass('loading paused')
            }).
            on('seeking', () => {
                seeking = true;
                b.removeClass('loading paused')
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
                    b.removeClass('loading').addClass('paused')
                }
            }).
            on('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
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
            })
    }
}

function handleOpenArguments(cmd){
    console.log('OPEN', cmd);
    // minimist module was giving error: notFlags.forEach is not a function
    // do it raw for now and better another day
    if(typeof(cmd)=='string'){
        restoreInitialSize();
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

nw.App.on('open', handleOpenArguments)

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
    if(!win || !win.document || !window.document.documentElement){
        console.error('Bad observe', win, win.document);
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
    } catch(e) {
        console.error(e)
    }
}

function ptbTryOther(){
    console.warn('PTBPTBPTB');
    jQuery('.try-other')[playingStreamKeyword()?'show':'hide']()
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

jQuery(() => {
    PlaybackManager.on('commit', ptbTryOther);
    var els = jQuery(document).add('html, body');
    jWin.on('load resize', function (){
        var nonMiniPlayerMinWidth = 400, miniPlayerTriggerHeight = (screen.height / 3), width = jWin.width(), height = jWin.height(), showInTaskbar = ( height > miniPlayerTriggerHeight && width > nonMiniPlayerMinWidth), onTop = ( !showInTaskbar || isFullScreen());
        if(miniPlayerTriggerHeight < 380){
            miniPlayerTriggerHeight = 380;
        }
        console.log( height + ' < ( '+screen.height+' / 3) )', onTop, showInTaskbar);
        if(onTop !== lastOnTop){
            lastOnTop = onTop;
            console.log('SET ' + JSON.stringify(onTop));
            setTimeout(function (){
                win.setAlwaysOnTop(!!onTop);
                var b = jQuery('body');
                if(onTop || isFullScreen()){
                    b.addClass('frameless');
                } else {
                    b.removeClass('frameless');
                }
                if(showInTaskbar){
                    doAction('miniplayer-off')
                } else {
                    doAction('miniplayer-on')
                }
                miniPlayerActive = !showInTaskbar;
            }, 50)
        }        
    });
    addAction('uncommit', function (prevIntent, nextIntent){
        if(!nextIntent.isSideload){
            stopRecording()
        }
    });
    var recordingJournal = [], recordingJournalLimit = 8;
    addAction('media-received', (url, content, type) => {
        if(isRecording !== false){
            console.log('recording, media received');
            if(type == 'path'){ // so content is a path, not a buffer
                content = fs.readFileSync(content, 'binary')
            }
            console.log('recording, media received', typeof(content));
            if(typeof(content)=='object' && typeof(content.base64Encoded)!='undefined' && content.base64Encoded){
                console.log('recording, media received', typeof(content));
                if(['frame', 'ts'].indexOf(PlaybackManager.activeIntent.type)==-1){ // only in frame intent we receive from chrome.debugger now
                    console.log('recording, media received', typeof(content));
                    return;
                }
                console.log('recording, media received', typeof(content));
                content = new Buffer(content.body, 'base64')
                console.log('recording, media received', typeof(content));
            }
            console.log('recording, media received');
            var length = (typeof(content)=='string') ? content.length : content.byteLength; 
            if(!length){
                console.log('recording');
                console.warn('Empty media skipped.');
                return;
            }
            console.log('recording, media received');
            for(var key in recordingJournal){
                if(length && recordingJournal[key] == length){
                    console.log('Duplicated media skipped.');
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    return;
                }
            }
            console.log('recording, media received');
            var ext = getExt(url);
            if(['ts', 'mpg', 'webm', 'ogv', 'mpeg', 'mp4'].indexOf(ext) == -1){
                ext = 'mp4';
            }
            var file = isRecording.folder+'/'+time()+'.'+ext;
            recordingJournal[file] = length;
            recordingJournal = sliceObject(recordingJournal, recordingJournalLimit * -1);
            console.log('recording, media received');
            fs.writeFile(file, content, {encoding: 'binary', flag: 'w'}, function (err){
                if(err){
                    console.error('WRITE ERROR', file, err)
                }
            })
            console.log('recording, media received');
        }
    })    

    
    addAction('recording-start', function (){
        recordingNotification.update(Lang.RECORDING_STARTED, 'fa-download', 'normal');
        Menu.recordingState(true)
    })
    addAction('recording-save-start', function (){
        recordingNotification.update(Lang.SAVING_RECORDING, 'fa-spin fa-circle-notch', 'forever');
        Menu.recordingState('saving')
    })
    addAction('recording-save-end', function (){
        recordingNotification.update(Lang.RECORDING_SAVED, 'fa-check', 'normal');
        Menu.recordingState(false)
    })    
    addAction('recording-save-failure', function (data, reason){
        var t = reason == 1 ? Lang.RECORDING_TOO_SHORT : Lang.RECORDING_SAVE_ERROR;
        recordingNotification.update(t, 'fa-exclamation-circle', 'normal');
        Menu.recordingState(false)
    })
    var player = document.getElementById('player'), playerSizeUpdated = (() => {
        var lastSize, htmlElement = jQuery('html'), controls = jQuery('#controls'), timer = 0;
        return () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                var s = player.offsetWidth+'x'+player.offsetHeight;
                //console.log('player size updated?', s, lastSize);
                if(s != lastSize){
                    lastSize = s;
                    videoObserver.disconnect();
                    //console.log('player size updated', player.offsetWidth, player.offsetHeight);
                    htmlElement.css('background-position-x', (!miniPlayerActive && areControlsActive()) ? (((controls.width() / 2) * -1)  + 12) : 0);
                    if(PlaybackManager.activeIntent){
                        PlaybackManager.setRatio()
                    }
                    //console.log('player size reobserve', player.offsetWidth, player.offsetHeight);
                    videoObserver.observe(player)
                }
            }, 200)
        }
    })(), videoObserver = new ResizeObserver(playerSizeUpdated);
    videoObserver.observe(player);

    jQuery(document).on('scroll', () => {
        document.documentElement.scrollTop = document.documentElement.scrollLeft = 0; 
    })
})

function nextBotReview(data){
    prepareRequest();
    //console.warn('BBBBBBBBBBBBBBBBBBB', data);
    request({
        url: 'http://app.megacubo.net/stats/bot/review-gateway.php',
        method: 'POST',
        json: data || {}
    }, (error, response, stream) => {
        //console.warn('BBBBBBBBBBBBBBBBBBB', stream, error);
        if(!error && stream && typeof(stream)=='object' && stream['stream_url']){
            console.log('nextBotReview #1', stream);
            var entry = {url: stream['stream_url'], name: stream['stream_name']};
            testEntry(entry, () => {
                var mem = Math.round(process.memoryUsage().rss / 1024 / 1024), dt = new Date(), date = dt.getHours()+':'+dt.getMinutes()+':'+dt.getSeconds();
                var prevState = stream['stream_status'];
                stream['stream_status'] = 'ok';
                if(stream['stream_status'] != prevState){
                    console.warn('nextBotReview', prevState+' => '+stream['stream_status'], mem+'MB', date, entry, stream, jQuery.param(stream));
                } else {
                    console.log('nextBotReview', prevState+' => '+stream['stream_status'], mem+'MB', date, entry, stream, jQuery.param(stream));
                }
                nextBotReview(stream);
                if(mem > 1000){
                    restartApp()
                }
            }, () => {
                var mem = Math.round(process.memoryUsage().rss / 1024 / 1024), dt = new Date(), date = dt.getHours()+':'+dt.getMinutes()+':'+dt.getSeconds(); // process after the test
                var prevState = stream['stream_status'];
                stream['stream_status'] = 'off';
                if(stream['stream_status'] != prevState){
                    console.warn('nextBotReview', prevState+' => '+stream['stream_status'], date, mem+'MB', entry);
                } else {
                    console.log('nextBotReview', prevState+' => '+stream['stream_status'], date, mem+'MB', entry);
                }
                nextBotReview(stream)
                if(mem > 1000){
                    restartApp()
                }
            })
        } else {
            setTimeout(() => {nextBotReview()}, 2000)
        }
    })
}

var extractURLsRegex =/(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
function extractURLs(txt) {
    return txt.match(extractURLsRegex) || []
}

var botCrawlsURLs = false, botCrawledURLs = [];
function nextBotCrawl(){
    if(botCrawlsURLs === false){
        var txt = fs.readFileSync('crawl.txt');
        botCrawlsURLs = extractURLs(txt);
    }
    botCrawlsURLs.every((url) => {
        if(botCrawledURLs.indexOf(url) == -1){
            botCrawlURL(url, nextBotCrawl);
            return false;
        }
        return true;
    })
}

function botCrawlURL(url, next){
    if(!window['request']){
        request = prepareRequest()
    }
    testEntry({'url': url}, () => {
        request(url, (err, resp, html) => {
            if(!err){
                //
            }
            next()
        })       
    }, next)
}

//jQuery(window).on('load', () => { nextBotReview() })
