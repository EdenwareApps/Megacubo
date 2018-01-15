//import { clearTimeout } from 'timers';

var os = require('os'), mkdirp = require('mkdirp'), jWin = jQuery(window), lastOnTop, castManager;
var isSDKBuild = (window.navigator.plugins.namedItem('Native Client') !== null);
var clipboard = gui.Clipboard.get();

//gui.App.setCrashDumpDir(process.cwd());

function resetData(){
    localStorage.clear();
    removeFolder('data', false, function (){
        removeFolder('torrent', false, function (){
            localStorage.clear();
            top.location.reload()
        })
    })
}

function enterMiniPlayer(){
    var w = 320, h = 240, rightMargin = 50;
    window.resizeTo(w, h);
    window.moveTo(screen.availWidth - w - rightMargin, screen.availWidth - h);
    miniPlayerActive = true
}

function leaveMiniPlayer(){
    restoreInitialSize();
}

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

function escapePressed(){
    win.leaveKioskMode();
    restoreInitialSize();
}

function isMaximized(){
    var w = top || window, widthMargin = 24, heightMargin = 72;
    return (w.outerWidth >= (screen.width - widthMargin) && w.outerHeight >= (screen.height - heightMargin));
}

function maximizeOrRestore(){
    if(top.window.miniPlayerActive){
        top.window.leaveMiniPlayer();
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

function minimizeWindow(){
    if(top.window.miniPlayerActive){
        win.minimize();
    } else {
        top.window.enterMiniPlayer();
    }
}

function closeWindow(){
    if(top.window.miniPlayerActive){
        top.window.leaveMiniPlayer();
    } else {
        top.window.close();
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

function goHome(){
    stop();
    var c = getFrame('controls');
    if(c){
        c.listEntriesByPath('/')
    }
}

var decodeEntities = (function() {
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
                    doAction('media-received', requestIdMap[params.requestId], local);
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
                            doAction('media-received', requestIdMap[params.requestId], response);
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

function registerRecording(file, replaceThisOne){
    var c = getFrame('controls');
    if(replaceThisOne){
        c.RecordingHistory.removeByURL(replaceThisOne)
    }
    c.RecordingHistory.add({
        type: 'stream',
        url: file,
        name: basename(file).replace('.'+getExt(file), '')
    });
    c.refreshListingIfMatch(Lang.RECORDINGS)
}

function startRecording(){
    if(isRecording === false){
        var folder = 'recordings/session';
        fs.mkdir(folder, function(err){
            removeFolder(folder, false, function (){ // just empty the folder
                isRecording = {folder: folder}; // recording now
                var url = PlaybackManager.getURL();
                if(url && !isLive(url) && isVideo(url)){
                    if(typeof(request)!='function'){
                        request = require('request')
                    }
                    isRecording.totalBytes = 0;
                    isRecording.receivedBytes = 0;
                    isRecording.capturingFile = folder+'/'+time()+'.tmp';
                    isRecording.capturingStream = fs.createWriteStream(isRecording.capturingFile, {'flags': 'w'});
                    isRecording.capturingStream.on('error', () => {
                        console.log('Stream write error', arguments)
                    });
                    isRecording.capturingRequest = request.
                        get(url).
                        on('response', function(data) {
                            isRecording.totalBytes = parseInt(data.headers['content-length'] || 0);
                        }).
                        on('data', function(chunk) {
                            isRecording.capturingStream.write(chunk, 'binary');
                            isRecording.receivedBytes += chunk.length;
                        }).
                        on('end', function() {
                            console.log('END');
                            isRecording.capturingStream.end()
                        }).
                        on('error', function(err) {
                            console.log("Error during HTTP request");
                            console.log(err);
                            isRecording.capturingStream.end();
                            stopRecording()
                        });
                }
            })
        })
        doAction('recording-start', folder);
        notify(Lang.RECORDING_STARTED, 'fa-download', 'normal');
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
            saveAs(outputFile, function (file){
                console.log('aaa1', file);
                if(file && file != outputFile){
                    outputFile = file;
                }
                console.log('aaa2', _file, outputFile);
                moveFile(_file, outputFile);
                console.log('aaa3', outputFile);
                registerRecording(outputFile);
                console.log('aaa4', outputFile);
                doAction('recording-save-end', outputFile, data)
                console.log('aaa5');
            })
        } else {
            isRecording = false;
            doAction('recording-stop', data);        
            doAction('recording-save-start', data);
            fs.readdir(data.folder, function (err, files){
                if(err || !files.length){
                    console.log('Error while saving file list.');
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
                            on('error', function (err){
                                console.log('Error while saving joined file.', joinedFile, err);
                                doAction('recording-save-failure', data)
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
                                    registerRecording(outputFile);
                                    saveAs(outputFile, function (file){
                                        if(file && file != outputFile){
                                            moveFile(outputFile, file)
                                            registerRecording(file, outputFile);
                                            outputFile = file;
                                        }
                                    });
                                    removeFolder(data.folder);
                                    doAction('recording-save-end', outputFile, data)
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
    jQuery(top.window.document).find('body').addClass('modal');
    jQuery(content).appendTo(jQuery('#modal-overlay > div > div').html(''));
    jQuery('#modal-overlay').show()
}

function modalClose(){
    jQuery(top.window.document).find('body').removeClass('modal');
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
    top.window.focus()
}

function modalPrompt(question, answers, placeholder, value){
    var a = [];
    for(var k in answers){
        a.push(jQuery('<span class="button">'+answers[k][0]+'</span>').on('click', answers[k][1]))
    }
    var b = jQuery('<div class="prompt prompt-'+a.length+'-columns">'+
                '<span class="prompt-close"><a href="javascript:modalClose();void(0)"><i class="fa fa-times-circle" aria-hidden="true"></i></a></span>'+
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
    top.window.focus();
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
    if(process.platform === 'win32' && parseFloat(os.release(), 10) > 6.1) {
        win.setMaximumSize(width, height);
    }
}

function setFullScreen(enter){
    if(!enter){
        miniPlayerActive = false;
        win.leaveKioskMode(); // bugfix, was remembering to enter fullscreen irreversibly
        var s = initialSize();
        window.resizeTo(s.width, s.height);
        if(document.readyState.indexOf('in')==-1){
            maxPortViewSize(screen.availWidth + 15, screen.availHeight + 14);
        } else {
            maxPortViewSize(s.width, s.height);						
        }
        centralizeWindow(s.width, s.height);
        //win.setPosition('center'); // buggy sometimes
        console.log('SIZE', s.width, s.height);
        if(typeof(window['fixMaximizeButton'])=='function'){
            fixMaximizeButton()
        }
    } else {
        maxPortViewSize(0, 0);
        win.enterKioskMode();
        notify(Lang.EXIT_FULLSCREEN_HINT, 'fa-info-circle', 'long')
    }
    var f = function (){
        var _fs = isFullScreen();
        win.setAlwaysOnTop(_fs);
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
    setFullScreen(Store.get('start-in-fullscreen'))
}

function centralizeWindow(w, h){
    var x = (screen.availWidth - (w || window.outerWidth)) / 2;
    var y = (screen.availHeight - (h || window.outerHeight)) / 2;
    window.moveTo(x, y)
    console.log('POS', x, y);
}

function logErr(){
    if(!fs.existsSync('error.log')){
        fs.closeSync(fs.openSync('error.log', 'w')); // touch
    }
    return fs.appendFileSync('error.log', JSON.stringify(Array.from(arguments))+"\r\n"+traceback()+"\r\n\r\n");
}

function sendStats(action, data){
    var postData = data ? jQuery.param(data) : '';
    var options = {
        hostname: 'app.megacubo.net',
        port: 80,
        path: '/stats-v2/'+action,
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
    req.end();
}

function createMouseObserverForControls(win){
    var x = 0, y = 0, showing = false, showHideDelay;
    var w = jQuery(window).width();
    var h = jQuery(window).height();
    var update = () => {
        clearTimeout(showHideDelay);
        var show = (x > (w * (areControlsActive()?0.75:0.9)) && y < (h * 0.8));
        if(!show){
            var a = win.document.activeElement;
            if(a && ['input', 'textarea'].indexOf(a.tagName.toLowerCase())!=-1){ // is typing in sandbox frame?
                show = true;
            }
        }
        //console.log(w, h, x, y, show);
        var b = jQuery(top.document).find('body');
        if(show){
            showHideDelay = setTimeout(() => {
                b.addClass('isovercontrols')
            }, 400)
        } else {
            b.removeClass('isovercontrols')
        }
    }
    jQuery(win.document).on('mousemove', (e) => {
        x = e.pageX;
        y = e.pageY;
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

process.on('unhandledRejection', function (reason, p){
    console.error(reason, 'Unhandled Rejection at Promise', p);
    top.logErr(reason, 'Unhandled Rejection at Promise', p);
    //process.exit(1);
});

process.on('uncaughtException', function (err){
    console.error('Uncaught Exception thrown', err);
    var msg = err.message || err.stack || err;
    top.logErr('Uncaught Exception thrown', err, msg);
    return true;
});

win.on('new-win-policy', function(frame, url, policy) {
    policy.ignore(); // IGNORE = BLOCK
    console.log('POPUP BLOCKED', frame, url, policy);
    
    // CHECK AFTER IF IT'S A RELEVANT POPUP
    setTimeout(() => {
        shouldOpenSandboxURL(url, function (url){
            top.window.document.querySelector('iframe#sandbox').src = url;
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
    for(var i=0; i<cmd.length; i++){
        var force = false;
        if(cmd[i].match(new RegExp('mega:', 'i'))){
            cmd[i] = cmd[i].replaceAll("'", "").replaceAll('"', '');
            var parts = cmd[i].split(( cmd[i].indexOf('|')!=-1 ) ? '|' : '//');
            if(parts.length > 1){
                cmd[i] = atob(parts[1]);
                force = true;
            }
        }
        if(cmd[i] && (force || cmd[i].match(new RegExp('(rt[ms]p[a-z]?:|mms[a-z]?:|\.(m3u8?|mp4|flv))', 'i')))){
            console.log('PLAY', cmd);
            cmd[i] = cmd[i].replaceAll("'", "").replaceAll('"', '')
            playCustomURL(cmd[i], true);
            break;
        }
    }
}

nw.App.on('open', handleOpenArguments)
handleOpenArguments(gui.App.argv)

var packageQueue = Store.get('packageQueue') || [];
var packageQueueCurrent = Store.get('packageQueueCurrent') || 0;

var miniPlayerMouseOutTimer = 0, miniPlayerMouseHoverDelay = 0, isMouseOver;
var mouseEnterTimeout = () => {
    clearTimeout(miniPlayerMouseOutTimer);
    miniPlayerMouseOutTimer = setTimeout(() => {
        if(miniPlayerActive){
            jQuery('body').addClass('frameless').off('mousemove', mouseEnterTimeout)
        }
    }, 3000)
}
jQuery('body').hover(
    () => {
        isMouseOver = true;
        if(miniPlayerActive && isMouseOver){
            jQuery('body').removeClass('frameless').on('mousemove', mouseEnterTimeout);
            fixMaximizeButton();
        }
    }, 
    () => {
        isMouseOver = false;
        clearTimeout(miniPlayerMouseHoverDelay);
        miniPlayerMouseHoverDelay = setTimeout(() => {
            if(miniPlayerActive && !isMouseOver){
                jQuery('body').addClass('frameless').off('mousemove', mouseEnterTimeout)
            }
        }, 400)
    }
)

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
        var miniPlayerTriggerWidth = ( screen.width / 3), width = jWin.width(), changeTaskbar = ( width < miniPlayerTriggerWidth ), onTop = !!( changeTaskbar || isFullScreen());
        console.log( width+' < ( '+screen.width+' / 3) )');
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
                win.setShowInTaskbar(!changeTaskbar); // hide for miniplayer only
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
    addAction('media-received', function (url, content){
        if(isRecording !== false){
            console.log('RECEIVED', url);
            var length = (typeof(content)=='string') ? filesize(content) : content.body.length; 
            if(!length){
                console.log('Empty media skipped.');
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
            if(typeof(content)=='string'){
                fs.copyFile(content, file, function (err){ // here content is the name of the source file
                    if(err){
                        console.log('WRITE ERROR', err)
                    }
                })
            } else {
                console.log('SAVE', file, content.body.length);
                if(content.base64Encoded){
                    fs.writeFile(file, new Buffer(content.body, 'base64'), {encoding: 'binary', flag: 'w'});
                } else {
                    fs.writeFile(file, new Buffer(content.body, 'binary'), {encoding: 'binary', flag: 'w'}, function (err){
                        if(err){
                            console.log('WRITE ERROR', err)
                        }
                    })
                }
            }
        }
    })
    
    addAction('recording-save-start', function (){
        notify(Lang.SAVING_RECORDING, 'fa-spin fa-circle-o-notch', 'wait')
    })

    addAction('recording-save-end', function (){
        notify(Lang.RECORDING_SAVED, 'fa-check', 'normal')
    })
    
    addAction('recording-save-failure', function (){
        notify(Lang.RECORDING_SAVE_ERROR, 'fa-exclamation-circle', 'normal')
    })

})
