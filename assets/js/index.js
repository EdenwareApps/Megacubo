
var os = require('os'), mkdirp = require('mkdirp'), jWin = jQuery(window), jB = jQuery('body'), lastOnTop, castManager;
var isSDKBuild = (window.navigator.plugins.namedItem('Native Client') !== null);
var currentVersion = 0, clipboard = gui.Clipboard.get();

//gui.App.setCrashDumpDir(process.cwd());

function resetData(){
    removeFolder('torrent', false, function (){
        removeFolder('data', false, function (){
            nw.App.clearCache();
            top.location.reload()
        })
    })
}

var miniPlayerRightMargin = 24;

function enterMiniPlayer(){
    miniPlayerActive = true;   
    var ratio = PlaybackManager.getRatio();
    var h = screen.availHeight / 4, w = scaleModeAsInt(PlaybackManager.getRatio()) * h;
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
    console.log('MP-ON');
    jB.addClass('miniplayer');
    win.setAlwaysOnTop(true);
    win.setShowInTaskbar(false);
    console.log('MP-ON');
    fixMaximizeButton();
    PlaybackManager.play();
    afterExitPage()
    console.log('MP-ON');
})

addAction('miniplayer-off', () => {
    console.log('MP-OFF');
    jB.removeClass('miniplayer');
    console.log('MP-OFF');
    win.setAlwaysOnTop(false);
    console.log('MP-OFF');
    win.setShowInTaskbar(true);
    console.log('MP-OFF');
    fixMaximizeButton();
    console.log('MP-OFF');
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
    setFullScreen(false);
    var c = getFrame('controls');
    if(c){
        c.autoCleanEntriesCancel()
    }
}

function isMaximized(){
    var w = top || window, widthMargin = 24, heightMargin = 72;
    return (w.outerWidth >= (screen.width - widthMargin) && w.outerHeight >= (screen.height - heightMargin));
}

function maximizeOrRestore(){
    if(top){
        if(top.miniPlayerActive){
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
        if(top.miniPlayerActive){
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
    if(allowAfterExitPage && currentVersion){
        var lastTime = Store.get('after-exit-time'), t = time();
        if(!lastTime || (t - lastTime) > (24 * 3600)){
            Store.set('after-exit-time', t);
            var url = Config.get("after-exit-url").format(currentVersion);
            gui.Shell.openExternal(url)
        }
    }
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
            var entry = getFrame('controls').selectedEntry();
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
        PlaybackManager.pause();
    } else {
        PlaybackManager.play();
    }
}

function playPauseNotify(){
    if(!top){ // unloading raises "Cannot read property 'window' of null" sometimes
        return;
    }
    if(!PlaybackManager.activeIntent){
        jQuery([
            top.document.body,
            getFrame('controls').document.body,
            getFrame('overlay').document.body
        ]).removeClass('playing').removeClass('paused');
        return;
    }
    if(PlaybackManager.activeIntent.type=='frame' && !PlaybackManager.activeIntent.videoElement){
        jQuery([
            top.document.body,
            getFrame('controls').document.body,
            getFrame('overlay').document.body
        ]).removeClass('playing').removeClass('paused');
        return;
    }
    var c = currentStream();
    if(c) {
        c = c.name;
    } else {
        c = Lang.PLAY;
    }
    console.log('NOTIFY');
    if(PlaybackManager.playing()){
        console.log('NOTIFY1');
        jQuery([
            top.document.body,
            getFrame('controls').document.body,
            getFrame('overlay').document.body
        ]).removeClass('paused').addClass('playing');
        notify(c, 'fa-play', 'short')
        console.log('NOTIFY');
    } else {
        console.log('NOTIFY2');
        jQuery([
            top.document.body,
            getFrame('controls').document.body,
            getFrame('overlay').document.body
        ]).removeClass('playing').addClass('paused');
        notify(Lang.PAUSE, 'fa-pause', 'short')
        console.log('NOTIFY');
    }
}

var decodeEntities = (() => {
    // this prevents any overhead from creating the object each time
    var element = document.createElement('div');

    // regular expression matching HTML entities
    var entity = new RegExp('&(?:#x[a-f0-9]+|#[0-9]+|[a-z0-9]+);?', 'gi');

    return (function (str) {
        // find and replace all the html entities
        str = str.replace(entity, function(m) {
            element.innerHTML = m;
            return element.textContent;
        });

        // reset the value
        element.textContent = '';

        return str;
    });
})();

var runFitterDelayTimer = 0, fitterTestedStreams = [], requestIdReferersTable = {}, requestIdReferersTableLimit = 256, isRecording = false, requestIdMap = {}, requestIdMapLimit = 256;
function bindWebRequest(){

    var debug = false;
    chrome.webRequest.onBeforeRequest.addListener(
        function(details) {
            if(debug){
                console.log("blocking:", details);
            }
            if(typeof(details['frameId'])!='undefined' && details.frameId && details.type=='sub_frame'){
                return {redirectUrl: top.document.URL.replace('index.', 'block.')};
            }
            return {cancel: true };
        },
        {urls: blocked_domains},
        ["blocking"]
    );

    chrome.webRequest.onBeforeSendHeaders.addListener(
        function(details) {
            if(debug){
                console.log('BeforeSendHeaders', details.url);
                console.log(details);
            }
            requestIdMap = sliceObject(requestIdMap, requestIdMapLimit * -1);
            requestIdMap[details.requestId] = details.url;
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
                        requestIdReferersTable[details.requestId] = details.requestHeaders[i].value;
                        if(debug){
                            console.log('BeforeRequest', details.url, details.requestId, requestIdReferersTable[details.requestId]);
                            //details.requestHeaders.push({name:"dummyHeader",value:"1"});
                        }
                    }
                }
            }
            if(isMedia(details.url) && (PlaybackManager.isLoading() || (PlaybackManager.activeIntent.type=='frame' && !PlaybackManager.activeIntent.videoElement))){
                if(debug){
                    console.log('Calling fitter delayed.');
                }
                clearTimeout(runFitterDelayTimer);
                runFitterDelayTimer = top.setTimeout(runFitter, 2000)
            }
            return {requestHeaders: details.requestHeaders};
        }, {urls: ["<all_urls>"]}, ["requestHeaders", "blocking"]
    );

    chrome.webRequest.onHeadersReceived.addListener(
        function(details) {
            if(debug){
                console.log('onHeadersReceived', details.url, requestIdReferersTable[details.requestId], details);
            }
            if(details.url.substr(0, 4)=='http'){ // if is HTTP, comes from a frame intent
                var ctype = '', isVideo = false, isAudio = false, isM3U8 = false, isDocument = false, isPartial = (details.statusCode == 206), contentLength = 0;
                for(var i=0; i < details.responseHeaders.length; i++){
                    var n = details.responseHeaders[i].name.toLowerCase();
                    if((!isPartial || !contentLength) && ["content-length"].indexOf(n) != -1){
                        contentLength = details.responseHeaders[i].value;
                    } else if(["content-range"].indexOf(n) != -1){
                        if(details.responseHeaders[i].value.indexOf('/')!=-1){
                            var l = parseInt(details.responseHeaders[i].value.split('/')[1].trim());
                            if(l > 0){
                                contentLength = l;
                            }
                        }
                    } else if(["content-type"].indexOf(n) != -1){
                        ctype = details.responseHeaders[i].value;
                    }
                }
                isVideo = ctype.match(new RegExp('video/(mp4|MP2T)', 'i'));
                isM3U8 = ctype.toLowerCase().indexOf('mpegurl') != -1;
                isDocument = ctype.indexOf('/html') != -1;
                isAudio = ctype.indexOf('audio/') != -1;
                if(debug){
                    console.log(details.url, details.statusCode, ctype, isVideo, isM3U8, isDocument, isAudio);
                }
                if(details.frameId){ // comes from a frame
                    if(isM3U8 || (isVideo && contentLength > minVideoContentLength)){
                        if(getExt(details.url)!='ts'){ // from a frame, not a TS
                            var frameIntents = top.PlaybackManager.query({type: 'frame'});
                            var urls, referer = requestIdReferersTable[details.requestId] || '';
                            if(referer){
                                var ok = false;
                                for(var i=0; i<frameIntents.length; i++){
                                    urls = getFrameURLs(frameIntents[i].frame);
                                    if(debug){
                                        console.log('SIDELOADPLAY URLS', urls);
                                    }
                                    if(matchURLs(referer, urls) || matchURLs(details.url, urls)){
                                        var c = getFrame('controls');
                                        if(c){
                                            ok = true;
                                            c.sideLoadPlay(details.url, frameIntents[i])
                                        }
                                    }
                                }
                                if(!ok){
                                    if(debug){
                                        console.log('SIDELOADPLAY FAILED, NO REFERER', details.url, referer, frameIntents)
                                    }
                                }
                            } else {
                                if(debug){
                                    console.log('M3U8 referer missing...');
                                }
                            }
                        }
                    } else if(PlaybackManager.isLoading() || (PlaybackManager.activeIntent.type=='frame' && !PlaybackManager.activeIntent.videoElement)){
                        if(isM3U8 || isVideo || isAudio){
                            if(debug){
                                console.log('Calling fitter now.');
                            }
                            clearTimeout(runFitterDelayTimer);
                            runFitter();
                        } else if(isDocument) {
                            if(debug){
                                console.log('Calling fitter delayed.');
                            }
                            clearTimeout(runFitterDelayTimer);
                            runFitterDelayTimer = setTimeout(runFitter, 2000);
                        }
                    }
                }
            }
            return {cancel: false};
        }, {urls: ["<all_urls>"]}, ["responseHeaders"]
    );

    function chromeDebuggerEventHandler(debuggeeId, message, params) {
        if(message == "Network.responseReceived" && params.response){
            requestIdMap[params.requestId] = params.response.url;
        }
        if(isRecording && message == 'Network.loadingFinished') { 
            if(debug){
                console.log('FINISHED', params, requestIdMap[params.requestId]);
            }
            if(typeof(requestIdMap[params.requestId])!='undefined' && ['ts'].indexOf(getExt(requestIdMap[params.requestId]))!=-1){
                if(requestIdMap[params.requestId].substr(0, 7)=='chrome-'){ // chrome-extension://dfaejjeepofbfhghijpmopheigokobfp/
                    var local = requestIdMap[params.requestId].replace(new RegExp('chrome\-extension://[^/]+/'), '');
                    if(debug){
                        console.log('LOCAL', requestIdMap[params.requestId], local);
                    }
                    doAction('media-received', requestIdMap[params.requestId], local, 'path');
                } else {
                    if(debug){
                        console.log('REMOTE', requestIdMap[params.requestId], local);
                    }
                    chrome.debugger.sendCommand({
                        tabId: debuggeeId.tabId
                    }, "Network.getResponseBody", {
                        "requestId": params.requestId
                    }, function(response) {
                        if(typeof(response)!='undefined') {
                            console.log('MEDIA RECEIVED');
                            doAction('media-received', requestIdMap[params.requestId], response, 'content');
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
            chrome.debugger.detach({ // is this the right way?!
                tabId: currentTab.id
            })
        })
    })

    /*
    PARAMS

frameId: "157092.106"
requestId: "157092.3843"
response: 
encodedDataLength: 102
fromDiskCache: false
headers: {Access-Control-Allow-Origin: "*", Connection: "keep-alive", Content-Length: "0"}
headersText:
"HTTP/1.1 204 No Content
↵Access-Control-Allow-Origin: *
↵Content-Length: 0
↵Connection: keep-alive
↵
↵"
mimeType: "text/plain"
protocol: "http/1.1"
remoteIPAddress: "54.164.98.102"
remotePort: 80
requestHeaders: {Accept: "*\/*", Accept-Encoding: "gzip, deflate", Accept-Language: "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7", Cache-Control: "max-age=0", Connection: "keep-alive", …}
requestHeadersText:
"POST /UW5QV0R+UTMkeQA7OGIdBCs7HBFkPBk+Fmc6PBFwGzZgNBFiDXYjLTVTZmZxYFtkcTQ4Cm1mYiIaMSMxIlNkZWI4ADY4eWRZZ3EybF9+ZnR/WWV5dHcaIDYjbF92CHlgW2Fkc2lZYWN9aVpm HTTP/1.1
↵Host: naenticle.info
↵Connection: keep-alive
↵Content-Length: 0
↵Cache-Control: max-age=0
↵Origin: http://pxstream.tv
↵User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.94 Safari/537.36
↵Content-Type: text/plain;charset=UTF-8
↵Accept: *\/*
↵Referer: http://pxstream.tv/embed/gv7e0zj2ruhx/
↵Accept-Encoding: gzip, deflate
↵Accept-Language: pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7
↵"
status: 204
statusText: "No Content"
timing: {connectEnd: -1, connectStart: -1, dnsEnd: -1, dnsStart: -1, proxyEnd: -1, …}
url: "http://naenticle.info/UW5QV0R+UTMkeQA7OGIdBCs7HBFkPBk+Fmc6PBFwGzZgNBFiDXYjLTVTZmZxYFtkcTQ4Cm1mYiIaMSMxIlNkZWI4ADY4eWRZZ3EybF9+ZnR/WWV5dHcaIDYjbF92CHlgW2Fkc2lZYWN9aVpm"
timestamp: 520361.307815
type: "Other"
*/

}

function getFrameURLs(frame){
    var urls = [];
    urls.push(frame.src);
    if(frame.contentWindow){
        urls.push(frame.contentWindow.document.URL);
        var frames = frame.contentWindow.document.querySelectorAll('iframe, frame');
        for(var i=0; i<frames.length; i++){
            urls = urls.concat(getFrameURLs(frames[i]))
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
                    doAction('recording-start', folder);
                    recordingNotification.update(Lang.RECORDING_STARTED, 'fa-download', 'normal')
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
        name += " "+dateStamp();
        var data = isRecording, originalOutputFile, outputFile = dirname(data.folder) + '/'+name+'.mp4';
        if(typeof(isRecording.capturingStream)!='undefined'){
            isRecording.capturingRequest.abort();
            isRecording.capturingStream.end();
            var _file = isRecording.capturingFile;
            isRecording = false;
            doAction('recording-stop', data);        
            doAction('recording-save-start', data);
            console.log('aaa');
            var nfile = _file+'.mp4';
            moveFile(_file, nfile);
            var fixer = ffmpeg({
                source: nfile
            }).
            inputOptions('-y').
            inputOptions('-err_detect ignore_err').
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
                console.log('Error while saving joined file.', nfile, outputFile, err);
                doAction('recording-save-failure', data)
            }).
            on('end', function (){
                originalOutputFile = outputFile;
                Recordings.sync();
                removeFolder(data.folder);
                doAction('recording-save-end', outputFile, data);
                if(!isFullScreen()){
                    gui.Shell.showItemInFolder(absolutize(outputFile))
                }
            }).run()
        } else {
            isRecording = false;
            doAction('recording-stop', data);        
            doAction('recording-save-start', data);
            fs.readdir(data.folder, function (err, files){
                if(err || !files.length){
                    console.log('Error while saving file list.', data.folder);
                    gui.Shell.openExternal(absolutize(data.folder));
                    doAction('recording-save-failure', data)
                } else {
                    var list = '', listFile = data.folder+'/list.txt';
                    for(var i=0; i<files.length; i++){
                        if(isVideo(files[i])){
                            list += "file "+files[i]+"\r\n";
                        }
                    }
                    fs.writeFile(listFile, list, function (err){
                        if(err){
                            console.log('Error while saving the list file.');
                            doAction('recording-save-failure', data)
                        } else {
                            var joinedFile = data.folder+'/joined.ts', joiner = ffmpeg({
                                source: listFile
                            }).
                            inputOptions('-y').
                            inputOptions('-safe 0').
                            inputOptions('-f concat').
                            addOption('-c copy').
                            output(joinedFile).
                            on('start', function(commandLine) {
                                console.log('Spawned FFmpeg with command: ' + commandLine)
                            }).
                            on('error', function (err){
                                console.log('Error while saving joined file.', joinedFile, err, data.folder);
                                gui.Shell.openExternal(absolutize(data.folder));
                                doAction('recording-save-failure', data);
                            }).
                            on('end', function (){
                                originalOutputFile = outputFile;
                                var saver = ffmpeg({
                                    source: joinedFile
                                }).
                                videoCodec('copy').
                                audioCodec('aac').
                                inputOptions('-y').
                                addOption('-bsf:a aac_adtstoasc').
                                format('mp4').
                                output(originalOutputFile).
                                on('start', function(commandLine) {
                                    console.log('Spawned FFmpeg with command: ' + commandLine)
                                }).
                                on('error', function (err){
                                    console.log('Error while saving output file.', outputFile, err);
                                    doAction('recording-save-failure', data)
                                }).
                                on('end', function (){
                                    originalOutputFile = outputFile;
                                    Recordings.sync();
                                    removeFolder(data.folder);
                                    doAction('recording-save-end', outputFile, data);
                                    if(!isFullScreen()){
                                        gui.Shell.showItemInFolder(absolutize(outputFile))
                                    }
                                }).run();
                            }).run();
                        }
                    })
                }
            })
        }
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
    for(var k in answers){
        a.push(jQuery('<span class="button">'+answers[k][0]+'</span>').on('click', answers[k][1]))
    }
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

function isFullScreen(){
    return !!(win.isKioskMode || win.isFulscreen)
}

function maxPortViewSize(width, height){
    if(process.platform === 'win32' && parseFloat(os.release(), 10) > 6.1 && width && height) {
        win.setMaximumSize(Math.round(width), Math.round(height));
    }
}

function setFullScreen(enter){
    if(!enter){
        miniPlayerActive = false;
        doAction('miniplayer-off');
        win.leaveKioskMode(); // bugfix, was remembering to enter fullscreen irreversibly
        win.leaveFullscreen()
        var s = initialSize();
        if(document.readyState.indexOf('in')==-1){
            maxPortViewSize(screen.availWidth + 15, screen.availHeight + 14);
        } else {
            maxPortViewSize(s.width, s.height);						
        }
        window.resizeTo(s.width, s.height);
        centralizeWindow(s.width, s.height);
        //win.setPosition('center'); // buggy sometimes
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
    var recommendedWidth = 1006, margin = 20, maxWidth = (screen.availWidth - (margin * 2));
    if(maxWidth < recommendedWidth){
        recommendedWidth = maxWidth;
    }
    return {width: Math.round(recommendedWidth), height: Math.round((recommendedWidth / 16) * 9)};
}

function restoreInitialSize(){
    jQuery('body').removeClass('miniplayer');
    setFullScreen(Config.get('start-in-fullscreen'))
}

function centralizeWindow(w, h){
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
    console.log(options);
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
    req.on('error', function (e){
        console.log('Houve um erro', e);
    });
    req.write(postData);
    req.end()
}

function createMouseObserverForControls(win){
    if(!win) return;
    var x = 0, y = 0, showing = false, margin = 6, v = false, t = 0, ht = 0, jw = jQuery(win), tb = jQuery(top.document).find('body');
    var w = jw.width();
    var h = jw.height();
    var b = jw.find('body');
    var update = () => {
        if(top){
            if(top.miniPlayerActive){
                var isOver = !(x < margin || y < margin || x > (w - margin) || y > (h - margin));
                if(isOver){
                    clearTimeout(ht);
                    if(!v){
                        clearTimeout(t);
                        t = setTimeout(() => {
                            tb.removeClass('frameless') 
                        }, 400)
                    }
                } else {
                    clearTimeout(ht);
                    clearTimeout(t);
                    ht = setTimeout(() => {
                        if(top.miniPlayerActive){
                            tb.addClass('frameless');
                            PlaybackManager.setRatio()
                        }
                    }, 3000)
                }
                console.log('MP', v, isOver)
                v = isOver;
                return;
            }
            if(top.showHideDelay){
                clearTimeout(top.showHideDelay);
                top.showHideDelay = 0;
            }
            var a = areControlsActive(), l = w * (a ? 0.6 : 0.8);
            if(a){
                if(l < (w - 600)){
                    l = w - 600;
                }
            } else {
                if(l < (w - 180)){
                    l = w - 180;
                }
            }
            var show = (x > l && y < (h * 0.33) && (x < (w - margin)));
            if(!show){
                var a = win.document.activeElement;
                if(0 && ['input', 'textarea'].indexOf(a.tagName.toLowerCase())!=-1){ // is typing in sandbox frame?
                    show = true;
                } else if(!PlaybackManager.playing() && !top.automaticallyPaused){ // is typing in sandbox frame?
                    show = true;
                }
            }
            //console.log(w, h, x, y, show);
            if(show){
                top.showHideDelay = setTimeout(() => {
                    tb.addClass('isovercontrols');
                    if(PlaybackManager.playing()){
                        top.automaticallyPaused = true;
                        top.PlaybackManager.pause()
                    }
                }, 400)
            } else {
                tb.removeClass('isovercontrols');
                if(top.automaticallyPaused){
                    top.automaticallyPaused = false;
                    top.PlaybackManager.play()
                }
            }
        }
    }
    jQuery(win.document).on('mousemove', (e) => {
        x = e.pageX;
        y = e.pageY;
        if(typeof(top.menuTriggerIconTrigger)!='undefined'){
            clearTimeout(top.menuTriggerIconTrigger)
        }
        if(typeof(top.mti) == 'undefined'){
            mti = jQuery(top.document).find("#menu-trigger-icon");
            mti.on('mouseenter', () => {
                top.automaticallyPaused = true;
                showControls()
            })
        }
        mti.show('fast');
        menuTriggerIconTrigger = setTimeout(() => {
            mti.hide('fast')
        }, 2000) // idle time before hide
        update()
    })
    jQuery(win).on('resize', (e) => {
        w = jQuery(window).width();
        h = jQuery(window).height();
        x = y = 0;
        update()
    })
    jQuery(win.document).on('mouseleave', (e) => {
        if(!e.target || e.target.nodeName.toLowerCase()=='html'){ // leaved the window
            x = y = 0;
            update()
        }
    })
    var frames = win.document.querySelectorAll('iframe, frame');
    for(var i=0; i<frames.length; i++){
        if(frames[i].offsetWidth >= (w - 40)){
            createMouseObserverForControls(frames[i].contentWindow)
        }
    }
}

patchMaximizeButton();

jQuery(() => {
    gui.Window.get().on('close', closeWindow)
});

process.on('unhandledRejection', function (reason, p){
    console.error(reason, 'Unhandled Rejection at Promise', p);
    logErr(reason, 'Unhandled Rejection at Promise', p);
    //process.exit(1);
});

process.on('uncaughtException', function (err){
    console.error('Uncaught Exception thrown', err);
    var msg = err.message || err.stack || err;
    logErr('Uncaught Exception thrown', err, msg);
    return true;
});

win.on('new-win-policy', function(frame, url, policy) {
    policy.ignore(); // IGNORE = BLOCK
    console.log('POPUP BLOCKED', frame, url, policy);
    
    // CHECK AFTER IF IT'S A RELEVANT POPUP
    setTimeout(() => {
        shouldOpenSandboxURL(url, function (url){
            top.document.querySelector('iframe#sandbox').src = url;
        })
    }, 0)
})

win.on('restore', () => {
    fixMaximizeButton() // maximize icon disappearing on unminimize
})

win.on('close', () => {
    stop();
    gui.App.closeAllWindows();
    win.close(true);
    nw.App.quit();
    process.exit()
})

win.on('minimize', function() {
    console.log('Window is minimized');
    if(PlaybackManager.activeIntent && !miniPlayerActive){
        restoreInitialSize();
        enterMiniPlayer()
    } else {
        win.setShowInTaskbar(true)
    }
})

function openMegaFile(file){
    fs.readFile(file, (err, content) => {
        if(!err && content){
            var parser = new DOMParser();
            var doc = parser.parseFromString(content, "application/xml");
            var url = jQuery(doc).find('stream').text();
            var name = jQuery(doc).find('stream').attr('name');
            var c = getFrame('controls');
            if(c){
                c.playEntry({
                    name: name,
                    url: url,
                    logo: c.defaultIcons['stream']
                })
            }
        }
    })
}

function handleOpenArguments(cmd){
    console.log('OPEN', cmd);
    // minimist module was giving error: notFlags.forEach is not a function
    // do it raw for now and better another day
    if(typeof(cmd)=='string'){
        if(getFrame('controls')){
            restoreInitialSize()
        } else {
            top.location.reload()
        }
        cmd = cmd.split(' ')
    }
    console.log('OPEN 2', cmd);
    for(var i=0; i<cmd.length; i++){
        var force = false;
        if(cmd[i].charAt(0)=='-'){
            continue;
        }
        cmd[i] = cmd[i].replaceAll("'", "").replaceAll('"', '');
        if(cmd[i].match(new RegExp('mega:', 'i'))){
            var parts = cmd[i].split(( cmd[i].indexOf('|')!=-1 ) ? '|' : '//');
            if(parts.length > 1){
                cmd[i] = atob(parts[1]);
                force = true;
            }
        }
        if(cmd[i]){
            console.log('OPEN 3', cmd[i], getExt(cmd[i]));
            if(getExt(cmd[i])=='mega'){
                openMegaFile(cmd[i]);
                break;
            } else if(force || cmd[i].match(new RegExp('(rt[ms]p[a-z]?:|mms[a-z]?:|magnet:|\.(m3u8?|mp4|flv))', 'i'))){
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
handleOpenArguments(gui.App.argv)

var packageQueue = Store.get('packageQueue') || [];
var packageQueueCurrent = Store.get('packageQueueCurrent') || 0;

/*
var miniPlayerMouseOutTimer = 0, miniPlayerMouseHoverDelay = 0, isMouseOver, _b = jQuery('body');
var mouseEnterTimeout = () => {
    clearTimeout(miniPlayerMouseOutTimer);
    miniPlayerMouseOutTimer = setTimeout(() => {
        if(miniPlayerActive){
            _b.addClass('frameless') 
        }
        _b.off('mousemove', mouseEnterTimeout)
    }, 2000)
}
jQuery('body').hover(
    () => {
        if(miniPlayerActive){
            isMouseOver = true;
            _b.removeClass('frameless').on('mousemove', mouseEnterTimeout);
            fixMaximizeButton();
        }
    }, 
    () => {
        if(miniPlayerActive){
            isMouseOver = false;
            clearTimeout(miniPlayerMouseHoverDelay);
            miniPlayerMouseHoverDelay = setTimeout(() => {
                if(miniPlayerActive && !isMouseOver){
                    _b.addClass('frameless').off('mousemove', mouseEnterTimeout)
                }
            }, 200)
        }
    }
)
*/

jQuery(window).on('restore', restoreInitialSize);
jQuery(window).on('unload', function (){
    Store.set('packageQueue', packageQueue);
    Store.set('packageQueueCurrent', packageQueueCurrent)
})

jQuery(function (){
    var els = jQuery(document).add('html, body');
    els.on('scroll', function (){
        els.scrollTop(0).scrollLeft(0)
    });
    jWin.find('body').on('click', function (){
        showControls()
    });
    jWin.on('load', function (){
        jQuery('#nw-custom-frame').on('mouseenter', function (){
            win.focus()
        }) // fix focus for hotkeys
        var commands = gui.App.argv;
        for (var i in commands) {
            if(commands[i].charAt(0)!='-'){
                playCustomURL(commands[i]);
                break;
            }
        }
    });
    jWin.on('load resize', function (){
        var miniPlayerTriggerHeight = (screen.height / 3), height = jWin.height(), showInTaskbar = !( height <= miniPlayerTriggerHeight ), onTop = ( !showInTaskbar || isFullScreen());
        console.log( height + ' < ( '+screen.height+' / 3) )', onTop, showInTaskbar);
        if(onTop !== lastOnTop){
            lastOnTop = onTop;
            console.log('SET ' + JSON.stringify(onTop));
            setTimeout(function (){
                win.setAlwaysOnTop(!!onTop);
                var b = jQuery('body');
                if(onTop){
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
                var c = getFrame('controls');
                if(c){
                    c.showWindowHandle(onTop)
                }
            }, 50)
        }
    }); 
    addAction('uncommit', function (prevIntent, nextIntent){
        if(!nextIntent.sideload){
            stopRecording()
        }
    });
    var recordingJournal = [], recordingJournalLimit = 8;
    addAction('media-received', function (url, content, type){
        if(isRecording !== false){
            if(type == 'path'){ // so content is a path, not a buffer
                content = fs.readFileSync(content, 'binary')
            }
            if(typeof(content)=='object' && typeof(content.base64Encoded)!='undefined' && content.base64Encoded){
                if(['frame'].indexOf(PlaybackManager.activeIntent.type)==-1){ // only in frame intent we receive from chrome.debugger now
                    return;
                }
                content = new Buffer(content.body, 'base64')
            }
            var length = (typeof(content)=='string') ? content.length : content.byteLength; 
            if(!length){
                console.log('recording');
                console.warn('Empty media skipped.');
                return;
            }
            for(var key in recordingJournal){
                if(length && recordingJournal[key] == length){
                    console.log('Duplicated media skipped.');
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    return;
                }
            }
            var file = isRecording.folder+'/'+time()+'.'+getExt(url);
            recordingJournal[file] = length;
            recordingJournal = sliceObject(recordingJournal, recordingJournalLimit * -1);
            fs.writeFile(file, content, {encoding: 'binary', flag: 'w'}, function (err){
                if(err){
                    console.error('WRITE ERROR', file, err)
                }
            })
        }
    })
    
    addAction('recording-save-start', function (){
        recordingNotification.update(Lang.SAVING_RECORDING, 'fa-spin fa-circle-notch', 'forever')
    })

    addAction('recording-save-end', function (){
        recordingNotification.update(Lang.RECORDING_SAVED, 'fa-check', 'normal')
    })
    
    addAction('recording-save-failure', function (){
        recordingNotification.update(Lang.RECORDING_SAVE_ERROR, 'fa-exclamation-circle', 'normal')
    })

})
