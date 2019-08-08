
const PLAYBACK_FRAME_AUTO_COMMIT_FLAGS_REGEX = new RegExp('#(catalog|nosandbox|nofit|off)([^A-Za-z0-9]|$)')

class PlaybackHtmlIntentSideloadHelper { 
    constructor(intent){
        this.intent = intent
        this.debug = debugAllow(true)
        this.complete = false
        this.testers = []
        this.URLs = []
        this.minVideoSize = 50 * (1024 * 1024)
    }
    add(url){
        var fine = 1
        url = applyFilters('sideloadAllow', url)
        if(!url){
            console.warn('SIDELOAD DISALLOW', 'due to filter')
            return
        }
        if(this.intent.streamType != 'all' && getMediaType({url}) != this.intent.streamType){
            console.warn('SIDELOAD DISALLOW', 'wrong stream type')
            return
        }
        if(this.URLs.indexOf(url) == -1){
            var loadingIntents = this.intent.playback.query({started: false, ended: false, error: false}) // disallow sideloading if there are other channel intents loading already
            loadingIntents.forEach((intent) => {
                if(intent){
                    if(intent.entry.originalUrl != this.intent.entry.originalUrl){
                        fine = -1;
                    } else if(intent.entry.url == url) {
                        fine = -2;
                    }
                }
            }) 
        }
        if(fine < 0){
            switch(fine){
                case -1:
                    console.log('SIDELOAD DISALLOW', 'other channel is loading')
                    break;
                case -2:
                    console.log('SIDELOAD DISALLOW', 'already loading', url, this.intent, loadingIntents)
                    break;
            }
            return false;
        }
        this.URLs.push(url)
        var icb = (intent) => {
            this.cancel()
            if(intent){
                if(this.complete){
                    intent.destroy()
                } else {
                    this.complete = true
                    if(intent) {
                        console.log('SIDELOAD COMMIT', intent)
                        intent.shadow = false
                        intent.manual = true
                        intent.entry.originalUrl = this.intent.entry.originalUrl || this.intent.entry.url
                        var v = this.intent.getVideo(), s = v ? (v.currentTime - 1) : 0
                        if(s && s < 60){
                            v = intent.getVideo()
                            var update = (video) => {
                                console.log('SIDELOAD TIME', v, s)
                                video.currentTime = s
                            }
                            if(v){
                                update(v)
                            } else {
                                intent.on('getVideo', update)
                            }
                        }
                        this.intent.playback.intents.push(intent)
                        this.intent.playback.commitIntent(intent)
                        this.intent.destroy()
                    }
                }
            }
        }
        var go = () => {
            var entry = Object.assign({}, this.intent.entry), opts = {
                start: (e) => {
                    console.error('Sideload started', e)
                    icb(e)
                },
                error: (e) => {
                    console.error('Sideload error', e)
                    icb(false)
                },
                ended: (e) => {
                    console.error('Sideload ended', e)
                    icb(false)
                },
                allowWebPages: false,
                manual: false, 
                shadow: true
            }
            entry.url = url;
            this.intent.playback.prepareIntent(entry, opts, false, data => {
                let types = data.types.filter(s => { return s != 'html' })
                this.intent.playback.createIntent(entry, opts, (err, intent) => { 
                    if(intent){
                        this.testers.push(intent) 
                    }
                }, types)
                if(this.debug){
                    console.log('SIDELOAD LOAD', entry, url, types)
                }
            })
        }
        if(isHTTP(url) && isVideo(url)){
            getHTTPInfo(url, (ct, cl, url, u, st) => {
                if(cl > this.minVideoSize){
                    go()
                } else {
                    console.log('SIDELOAD DISALLOW', 'Bad video size', [ct, cl, url, u, st])
                }
            })
        } else {
            go()
        }
    }
    cancel(){
        this.testers.forEach(intent => {
            if(intent && !intent.started){
                try {
                    intent.destroy()
                } catch(e) {
                    console.error('Intent destroy error', intent)
                }
            }
        })
    }
}

class PlaybackHtmlIntent extends PlaybackBaseIntent {  
    constructor(entry, options){
        super(entry, options)
        this.type = 'html';
        this.entry = entry;
        this.fittedElement = false;
        this.fittedScope = false;
        this.allowMediaSourcePausing = true;
        if(this.entry.originalUrl && isMegaURL(this.entry.originalUrl)){
            this.streamType = getMediaType(this.entry)
        } else {
            this.streamType = 'all'
        }
        this.on('unload', () => {
            this.sideloadCancel()
            if(this.frame){
                this.frame.src = 'about:blank';
                jQuery(this.frame).remove();
                delete this.frame;
            }
        })    
        this.on('commit', () => {
            document.querySelector('body').appendChild(this.frame);
        })        
        this.frame = document.createElement('iframe')
        this.frame.className = "fit-screen hide"; 
        this.frame.nwdisable = true;
        this.frame.nwfaketop = true;
        this.frame.height = "100%";
        this.frame.setAttribute('allowFullScreen', '')    
        document.querySelector('body').appendChild(this.frame)    
        if(options){
            this.apply(options)
        }    
        document.body.appendChild(this.frame)
        this.videoEvents = {
            'ended': [
                () => {
                    // this.retry()
                    console.error('Frame video element ended.')
                    return true
                }
            ]
        }
    }
    run(){    
        if(isHTTP(this.entry.url)){
            this.confirm()
            this.ping((result) => {
                if(!this.error && !this.ended && !this.destroyed){
                    console.log('Content-Type', this.entry.url, result)
                    if(this.validateStatusCode(result.status) && (!result.type || ['text/html'].indexOf(result.type) != -1)){
                        // OK
                    } else if(!this.started) {
                        console.error('Bad HTTP response for '+this.type, result);
                        this.fail(status || 'invalid')
                    }
                }
            })
        } else {
            console.error('Not HTTP(s)', this.entry.url);
            this.fail('invalid')
        }
    }    
    confirm(){
        if(this.frame){ // if thats no frame, its already destroyed
            var loadCallback = () => {
                //alert('this.frame.src');
                this.runFitter()
            } 
            // use onload (run again after navigates) + detectDOMLoad (fire earlier)
            this.frame.onload = loadCallback;
            setTimeout(() => {
                this.detectDOMLoad(loadCallback)
            }, 400);
            this.frame.src = this.entry.url; // after the onload hook setup
            if(this.entry.url.match(PLAYBACK_FRAME_AUTO_COMMIT_FLAGS_REGEX)){
                if(!this.shadow){
                    this.playback.setState('play')
                }
                this.start()
            }
        }
    }
    detectDOMLoad(callback){
        var c = false;
        if(this.frame && !this.error && !this.ended && !this.destroyed && (c=this.allowFitter())){
            if(c.document){
                if(['interactive', 'complete'].indexOf(c.document.readyState) == -1){
                    c.document.onreadystatechange = () => {
                        this.detectDOMLoad(callback)
                    }
                } else {
                    callback()
                }
            } else {
                setTimeout(this.detectDOMLoad, 400)
            }
        }
    }    
    allowFitter(){
        if(!this.ended && !this.error && !this.destroyed && this.entry.originalUrl.indexOf('#nofit') == -1){
            if(fitterEnabled && this.frame){
                var c = false;
                try {
                    c = this.frame.contentWindow;
                    if(!c.document){
                        c = false;
                    } else {
                        if(['chrome', 'chrome-extension', 'res'].indexOf(getProto(c.document.URL)) != -1){
                            console.error('Bad URL nav on frame', c.document.URL)
                            this.fail('connect')
                        }
                    }
                } catch(e) {
                    console.error(e)
                }
                if(c && (!this.fittedElement || !this.fittedScope  || !this.fittedScope.document || !this.fittedScope.document.querySelector('body').contains(this.fittedElement))){
                    return c
                }
            }
        }
    }
    fitterCallback(result){
        if(result && result.element && this.allowFitter && this.allowFitter()){
            console.log('fitterCallback', result);
            var video = result.element;
            if(video.tagName.toLowerCase() != 'video'){
                video = result.scope.document.querySelector('video')
            } 
            console.log('fitterCallback', video, video.duration);
            if(!video || video.duration >= Config.get('min-buffer-secs-before-commit')){
                console.log('runFitter SUCCESS', result);
                if(!this.shadow){
                    this.playback.setState('play')
                }
                this.fittedScope = result.scope;
                this.fittedScope.addEventListener('unload', () => {
                    if(!this.error && !this.ended && !this.destroyed){
                        this.video = false;
                        this.fittedElement = false;
                        setTimeout(this.runFitter, 2000)
                    }
                });
                this.fittedElement = result.element;
                this.video = false;
                this.on('getVideo', (v) => {
                    //console.error('ZOOOOOOOOOOOOOOO', v, this);
                    v.removeAttribute('style')
                    Fitter.outerFit(v, this.fittedScope)
                    setTimeout(() => {
                        if(this.playback.active && this.video){
                            Fitter.outerFit(this.video, this.fittedScope)
                        }
                    }, 400)
                }); 
                this.getVideo();
                this.start();
                console.log('runFitter SUCCESS', result);
                return true;
            }
        }
    }
    runFitter(){
        var interval = 3000
        if(this.fitterTimer){
            clearTimeout(this.fitterTimer)
        }
        console.log('intent.runFitter() -1', traceback())
        this.fitterTimer = setTimeout(() => {
            if(this.fitterTimer){
                clearTimeout(this.fitterTimer)
            }
            if(this.allowFitter){
                var c = this.allowFitter()
                if(c){
                    console.log('intent.runFitter()', time(), this.fittedElement)
                    Fitter.start(c, this)
                    this.fitterTimer = setTimeout(() => {
                        this.runFitter()
                    }, interval)
                    console.log('intent.runFitter() OK')
                }
            }
        }, 50)
        //console.log('intent.runFitter() -1', time())
        return this.started
    }      
    commit(){
        jQuery(document).find('iframe#sandbox').not(this.frame).remove();
        jQuery(this.frame).removeClass('hide').addClass('show').prop('id', 'sandbox');
        this.frame.id = 'sandbox';
        showPlayers(false, true);
        var w = this.fittedScope || this.frame.contentWindow || false;
        if(w){
            enableEventForwarding(w)
        }
    }
    play(){
        if(this.getVideo()){
            if(this.allowMediaSourcePausing || this.video.currentSrc.indexOf('blob:')==-1){
                this.video.play()
            }
        }
    }
    pause(){
        if(this.getVideo()){
            if(this.allowMediaSourcePausing || this.video.currentSrc.indexOf('blob:')==-1){
                this.video.pause()
            } else {
                notify(Lang.CANNOT_PAUSE, 'fa-exclamation-circle faclr-red', 'normal')
            }
        }
    }    
    seek(secs){
        if(this.getVideo()){
            if(this.allowMediaSourcePausing || this.video.currentSrc.indexOf('blob:')==-1){
                this.video.currentTime += secs;
            }
        }
    }
    playing(){
        if(this.committed){
            if(this.getVideo()){
                return !this.video.paused;
            } else {
                return true;
            }
        }
    }
    getVideo(){
        if(this.committed){
            if(!this.video && this.fittedElement){
                if(this.fittedElement.tagName && this.fittedElement.tagName.toLowerCase()=='video'){
                    this.video = this.fittedElement;
                } else {
                    if(this.fittedElement.querySelector){
                        this.video = this.fittedElement.querySelector('video')
                    } else if(this.fittedScope && this.fittedScope.document) {
                        this.video = this.fittedScope.document.querySelector('video')
                    }
                }
                if(this.video){
                    console.log('PATCHING VIDEO', this.video, this.video.src, this.video.currentTime);
                    this.emit('getVideo', this.video)
                    if(isHTTP(this.video.currentSrc)){
                        this.sideloadAdd(this.video.currentSrc)
                    }
                }
            }
            this.getVideoUpdateClass()
        }
        return this.video;
    }
    sideloadAdd(url){
        if(typeof(this.sideload) == 'undefined'){
            this.sideload = new PlaybackHtmlIntentSideloadHelper(this)
        }
        this.sideload.add(url)
    }
    sideloadCancel(){
        if(typeof(this.sideload) == 'undefined'){
            this.sideload = new PlaybackHtmlIntentSideloadHelper(this)
        }
        this.sideload.cancel()
    }
}

PlaybackHtmlIntent.supports = (entry) => {
    return isHTTP(entry.url) && entry.url.match(new RegExp('\\.html?($|\\?)', 'i'))
}

Playback.registerEngine('html', PlaybackHtmlIntent, 4)
