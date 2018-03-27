
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
        PlaybackManager.pause()
    } else {
        PlaybackManager.play()
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
    var c = currentStream();
    if(c) {
        c = c.name;
    } else {
        c = Lang.PLAY;
    }
    //console.log('NOTIFY', traceback());
    if(PlaybackManager.playing()){
        //console.log('NOTIFY1');
        jQuery([
            top.document.body,
            getFrame('controls').document.body,
            getFrame('overlay').document.body
        ]).removeClass('paused').addClass('playing');
        notify(c, 'fa-play', 'short')
        //console.log('NOTIFY');
    } else {
        //console.log('NOTIFY2');
        jQuery([
            top.document.body,
            getFrame('controls').document.body,
            getFrame('overlay').document.body
        ]).removeClass('playing').addClass('paused');
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

var requestIdReferersTable = {}, requestIdReferersTableLimit = 256, isRecording = false, requestIdMap = {}, requestIdMapLimit = 256;
function bindWebRequest(){
    
    var debug = false;
    chrome.webRequest.onAuthRequired.addListener(
        function (details) { 
            return { cancel: true }; 
        }, { urls: ["<all_urls>"] }, ['blocking']
    );

    if(typeof(blocked_domains)=='object' && jQuery.isArray(blocked_domains) && blocked_domains.length){
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
    }

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
            return {requestHeaders: details.requestHeaders};
        }, {urls: ["<all_urls>"]}, ["requestHeaders", "blocking"]
    );

    chrome.webRequest.onHeadersReceived.addListener(
        (details) => {
            if(debug){
                console.log('onHeadersReceived', details.url, requestIdReferersTable[details.requestId], details);
            }
            var headers = details.responseHeaders;
            if(details.url.substr(0, 4)=='http'){ // if is HTTP, comes from a frame intent
                var ctype = '', isVideo = false, isAudio = false, isM3U8 = false, isDocument = false, isPartial = (details.statusCode == 206), contentLength = 0;
                var referer = requestIdReferersTable[details.requestId] || '';
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
                headers.push({name: 'X-Content-Type-Options', value: 'no-sniff'});
                //headers.push({name: 'X-Frame-Options', value: 'ALLOW-FROM '+origin}); // not supported for Chrome
                isVideo = ctype.match(new RegExp('video/(mp4|MP2T)', 'i'));
                isM3U8 = ctype.toLowerCase().indexOf('mpegurl') != -1;
                isDocument = ctype.indexOf('/html') != -1;
                isAudio = ctype.indexOf('audio/') != -1;
                if(debug){
                    console.log(details.url, origin, details, ctype, isVideo, isM3U8, isDocument, isAudio);
                }
                if(details.frameId){ // comes from a frame
                    if(isM3U8 || (isVideo && contentLength > minVideoContentLength)){
                        if(getExt(details.url)!='ts'){ // from a frame, not a TS
                            var urls, frameIntents = top.PlaybackManager.query({type: 'frame'});
                            //console.log('SIDELOADPLAY INFO', details.url, referer, frameIntents);
                            if(referer){
                                var ok = false;
                                for(var i=0; i<frameIntents.length; i++){
                                    //console.log('SIDELOADPLAY NFO', frameIntents[i].frame);
                                    urls = getFrameURLs(frameIntents[i].frame);
                                    //console.log('SIDELOADPLAY INFO', urls, details.url, referer);
                                    if(debug){
                                        console.log('SIDELOADPLAY URLS', urls);
                                    }
                                    if(matchURLs(referer, urls) || matchURLs(details.url, urls)){
                                        ok = true;
                                        frameIntents[i].sideload(details.url)
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
                    }
                }
            } else {
                //console.warn('SKIPPED', details)
            }
            return {responseHeaders: headers};
        }, {urls: ["<all_urls>"]}, ["blocking", "responseHeaders"]
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
                gui.Shell.openExternal(absolutize(data.folder));
                doAction('recording-save-failure', data)
            } else {
                console.log('Saving recording: 4', files);
                var failure = (err) => {
                    console.log('Error while saving file list.', err);
                    gui.Shell.openExternal(absolutize(data.folder));
                    doAction('recording-save-failure', data)
                }
                var success = (output) => {
                    console.log('Saving record success.', output);
                    var c = getFrame('controls');
                    if(c){
                        c.Recordings.sync()
                    }
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
                    joinFiles(files, data.folder, outputFile, callback)
                }
                goJoin(files)
            }
        })
    }
}

function joinFiles(files, folder, outputFile, callback){
    console.log('JOIN', files, callback);
    if(files.length){
        var list = '', listFile = folder+'/list.txt', hits = [];
        for(var i=0; i<files.length; i++){
            if(getExt(files[i])=='ts'){
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
                        inputOptions('-y').
                        inputOptions('-safe 0').
                        inputOptions('-f concat').
                        addOption('-c copy').
                        output(joinedFile).
                        on('start', function (commandLine) {
                            console.log('Spawned FFmpeg with command: ' + commandLine)
                        }).
                        on('error', function (err){
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
    jQuery(win.document).on('mousemove', (e) => {
        if(top.isOver) return;
        x = e.pageX;
        y = e.pageY;
        if(typeof(top.menuTriggerIconTrigger)!='undefined'){
            clearTimeout(top.menuTriggerIconTrigger)
        }
        top.isOver = true;
        tb.addClass('over');
        top.menuTriggerIconTrigger = setTimeout(() => {
            top.isOver = false;
            tb.removeClass('over')
        }, 2000) // idle time before hide
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

function updateControlBarPos(scope, player){
    var controlBarHeight = 32, controlBarMargin = 12,  t = (jQuery(scope).height() - player.offset().top) - (controlBarHeight + (controlBarMargin * 2));
    var rule = ' video::-webkit-media-controls-panel { ';
    if(controlBarMargin){
        rule += ' width: calc(100% - '+(controlBarMargin * 2)+'px); margin: '+controlBarMargin+'px; border-radius: 3px;';
    } else {
        rule += ' width: 100%; margin: 0; border-radius: 0; ';
    }
    rule += 'top: '+t+'px; } #player-top-bar { top: '+ (b.hasClass('frameless') ? 16 : 4) +'px !important; } ';
    if(!scope.__lastControlBarPosRule || scope.__lastControlBarPosRule != rule){
        scope.__lastControlBarPosRule = rule;
        stylizer(rule, 'video-control-bar-pos', scope);
    }
}

var tb = jQuery(top.document).find('body');
function prepareVideoObject(videoElement){
    var doc = videoElement.ownerDocument;
    var scope = doc.defaultView;
    var paused, wasPaused, player = jQuery(videoElement), b = jQuery(doc.querySelector('body')), f = function (e){
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
    var timer = 0, ignoreResizing, f = () => {
        //console.warn('UPDATE', scope, player);
        if(top && scope && player && !ignoreResizing){
            scope.clearTimeout(timer);
            ignoreResizing = true; // prevent looping
            timer = scope.setTimeout(() => {
                //console.warn('UPDATE 2', scope, player);
                updateControlBarPos(scope, player);
                ignoreResizing = false;
            }, 200)
        }
    }
    if(!doc.getElementById('.player-status')){
        var pieces = [
            '<div id="player-status"><div class="fac fac-loading"><i class="fas fa-circle-notch fa-spin"></i></div><div class="fac fac-paused"><i class="fas fa-play"></i></div></div>'+
            '<div id="player-top-bar"><i class="fas fa-times-circle"></i></div>'
        ];
        jQuery(pieces.join(' ')).appendTo(b);
        var ptb = b.find("#player-top-bar");
        ptb.on('mousedown mouseup', (e) => {
            stop();
            e.preventDefault();
            e.stopPropagation();
        }).attr('title', Lang.STOP);
        var s =  doc.createElement('script');
        s.type = 'text/javascript'; 
        s.defer = 'defer'; s.async = 'async';
        doc.querySelector('head, body').appendChild(s);
        var url = dirname(document.URL)+'/assets/fa/js/fontawesome-all.js';
        setTimeout(() => {
            console.log('Loading FA', url);
            s.src = url;
            console.log('Loading FA OK ...?')
        }, 2000);
        fs.readFile('assets/css/player.css', (err, content) => {
            if(content){
                stylizer(content, 'player-css', scope)
            }
        })
    }
    new ResizeObserver(f).observe(videoElement);
    jQuery(scope).on('load resize', f);
    jQuery(videoElement).
        on('waiting', (event) => {
            b.addClass('loading').removeClass('paused')
        }).
        on('canplaythrough playing', (event) => {
            b.removeClass('loading paused')
        }).
        on('play', f).
        on('pause', () => {
            b.removeClass('loading').addClass('paused')
        }).
        on('click', function (e){
            e.preventDefault();
            e.stopPropagation();
            return false;
        }).
        on('mousemove', function (e){
            wasPaused = videoElement.paused;
        }).
        on('mousedown', function (e){
            e.preventDefault();
            e.stopPropagation();
            console.log('FRAME VIDEO MOUSEDOWN');
            wasPaused = videoElement.paused;
            console.log('PLAYING *', wasPaused, top);
            return false;
        }).
        on('mouseup', function (e){
            if(wasPaused){
                top.PlaybackManager.play()
            } else {
                top.PlaybackManager.pause()
            }
            console.log('PLAYING **', wasPaused, top.PlaybackManager.playing());
            top.delayedPlayPauseNotify();
            top.focus();
            return false;
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

var miniPlayerMouseOutTimer = 0, miniPlayerMouseHoverDelay = 0, _b = jQuery('body');
var mouseMoveTimeout = () => {
    clearTimeout(miniPlayerMouseOutTimer);
    miniPlayerMouseOutTimer = setTimeout(() => {
        isOver = false;
        if(miniPlayerActive){
            _b.addClass('frameless') 
        }
        _b.removeClass('over').off('mousemove', mouseMoveTimeout)
    }, 2000)
}
var miniPlayerMouseOut = () => {
    if(!isOver){
        if(miniPlayerActive){
            _b.addClass('frameless');
            _b.off('mousemove', mouseMoveTimeout)
        }
        _b.removeClass('over')
    }
}
jQuery('body').on('mouseenter mousemove', () => {
    isOver = true;
    if(!top.isFullScreen()){
        _b.removeClass('frameless')
    }
    _b.addClass('over');
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
    });
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
                var c = getFrame('controls');
                if(c){
                    c.showWindowHandle(onTop)
                }
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
            console.log('recording, media received', content);
            if(type == 'path'){ // so content is a path, not a buffer
                content = fs.readFileSync(content, 'binary')
            }
            console.log('recording, media received', content, typeof(content));
            if(typeof(content)=='object' && typeof(content.base64Encoded)!='undefined' && content.base64Encoded){
                console.log('recording, media received', content, typeof(content));
                if(['frame', 'ts'].indexOf(PlaybackManager.activeIntent.type)==-1){ // only in frame intent we receive from chrome.debugger now
                    console.log('recording, media received', content, typeof(content));
                    return;
                }
                console.log('recording, media received', content, typeof(content));
                content = new Buffer(content.body, 'base64')
                console.log('recording, media received', content, typeof(content));
            }
            console.log('recording, media received', content);
            var length = (typeof(content)=='string') ? content.length : content.byteLength; 
            if(!length){
                console.log('recording');
                console.warn('Empty media skipped.');
                return;
            }
            console.log('recording, media received', content);
            for(var key in recordingJournal){
                if(length && recordingJournal[key] == length){
                    console.log('Duplicated media skipped.');
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    // !!!!! TODO: Compare deeper if the files are really the same.
                    return;
                }
            }
            console.log('recording, media received', content);
            var file = isRecording.folder+'/'+time()+'.'+getExt(url);
            recordingJournal[file] = length;
            recordingJournal = sliceObject(recordingJournal, recordingJournalLimit * -1);
            console.log('recording, media received', content);
            fs.writeFile(file, content, {encoding: 'binary', flag: 'w'}, function (err){
                if(err){
                    console.error('WRITE ERROR', file, err)
                }
            })
            console.log('recording, media received', content);
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

    var playerSizeUpdated = (() => {
        var htmlElement = jQuery('html'), controls = jQuery('#controls'), timer;
        return () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                console.log('player size updated');
                PlaybackManager.setRatio();
                htmlElement.css('background-position-x', (!miniPlayerActive && areControlsActive()) ? (((controls.width() / 2) * -1)  + 12) : 0)
            }, 200);
        }
    })();

    var player = document.getElementById('player');
    new ResizeObserver(playerSizeUpdated).observe(player)
})
