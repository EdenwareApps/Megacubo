
function createFrameIntent(entry, options){
    var self = createBaseIntent()
    self.type = 'frame';
    self.entry = entry;
    self.fittedElement = false;
    self.fittedScope = false;
    self.allowMediaSourcePausing = true;
    self.sideload = (() => {
        var iself = {
            complete: false,
            testers: [],
            URLs: [],
            minVideoSize: 50 * (1024 * 1024)
        }
        iself.add = (url) => {
            var debug = true, fine = 1
            if(iself.URLs.indexOf(url) == -1){
                var loadingIntents = self.playback.query({started: false, ended: false, error: false}) // disallow sideloading if there are other channel intents loading already
                loadingIntents.forEach((intent) => {
                    if(intent){
                        if(intent.entry.originalUrl != self.entry.originalUrl){
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
                        console.log('SIDELOAD DISALLOW', 'already loading', url, self, loadingIntents)
                        break;
                }
                return false;
            }
            iself.URLs.push(url)
            var icb = (intent) => {
                iself.cancel()
                if(intent){
                    if(iself.complete){
                        intent.destroy()
                    } else {
                        iself.complete = true
                        if(intent) {
                            console.log('SIDELOAD COMMIT', intent)
                            intent.shadow = false
                            intent.manual = true
                            intent.entry.originalUrl = self.entry.originalUrl || self.entry.url
                            var v = self.getVideo(), s = v ? (v.currentTime - 1) : 0
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
                            self.playback.intents.push(intent)
                            self.playback.commitIntent(intent)
                            self.destroy()
                        }
                    }
                }
            }
            var go = () => {
                var entry = Object.assign({}, self.entry), opts = {
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
                var types = preparePlayIntent(entry, opts).types.filter(s => { return s != 'frame' })
                var ret = createPlayIntent(entry, opts, (err, intent) => { 
                    if(intent){
                        iself.testers.push(intent) 
                    }
                }, types)
                if(debug){
                    console.log('SIDELOAD LOAD', entry, url, types, ret)
                }
            }
            if(isHTTP(url) && isVideo(url)){
                getHTTPInfo(url, (ct, cl, url, u, st) => {
                    if(cl > iself.minVideoSize){
                        go()
                    } else {
                        console.log('SIDELOAD DISALLOW', 'Bad video size', [ct, cl, url, u, st])
                    }
                })
            } else {
                go()
            }
        }
        iself.cancel = () => {
            iself.testers.forEach(intent => {
                if(intent && !intent.started){
                    try {
                        intent.destroy()
                    } catch(e) {
                        console.error('Intent destroy error', intent)
                    }
                }
            })
        }
        return iself
    })()

    self.run = () => {    
        if(isHTTP(self.entry.url)){
            self.runConfirm()
            self.ping((result) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, result)
                    if(self.validateStatusCode(result.status) && (!result.type || ['text/html'].indexOf(result.type) != -1)){
                        // OK
                    } else if(!self.started) {
                        console.error('Bad HTTP response for '+self.type, result);
                        self.error = status || 'invalid';
                        self.trigger('error')
                    }
                }
            })
        } else {
            console.error('Not HTTP(s)', self.entry.url);
            self.error = 'invalid';
            self.trigger('error')
        }
    }
    
    self.runConfirm = () => {
        if(self.frame){ // if thats no frame, its already destroyed
            var loadCallback = () => {
                //alert('self.frame.src');
                self.runFitter()
            } 
            // use onload (run again after navigates) + detectDOMLoad (fire earlier)
            self.frame.onload = loadCallback;
            setTimeout(() => {
                self.detectDOMLoad(loadCallback)
            }, 400);
            self.frame.src = self.entry.url; // after the onload hook setup
            if(self.entry.url.match(new RegExp('#(catalog|nosandbox|nofit)([^A-Za-z0-9]|$)'))){
                if(!self.shadow){
                    self.playback.setState('play')
                }
                self.started = true;
                self.trigger('start', self)
            }
        }
    }

    self.detectDOMLoad = (callback) => {
        var c = false;
        if(self && self.frame && !self.error && !self.ended && (c=self.allowFitter())){
            if(c.document){
                if(['interactive', 'complete'].indexOf(c.document.readyState) == -1){
                    c.document.onreadystatechange = () => {
                        self.detectDOMLoad(callback)
                    }
                } else {
                    callback()
                }
            } else {
                setTimeout(self.detectDOMLoad, 400)
            }
        }
    }
    
    self.allowFitter = () => {
        if(!self.ended && !self.error && self.entry.originalUrl.indexOf('#nofit') == -1){
            if(fitterEnabled && self && self.frame){
                var c = false;
                try {
                    c = self.frame.contentWindow;
                    if(!c.document){
                        c = false;
                    } else {
                        if(['chrome', 'chrome-extension', 'res'].indexOf(getProto(c.document.URL)) != -1){
                            console.error('Bad URL nav on frame', c.document.URL)
                            self.error = 'connect';
                            self.trigger('error')
                        }
                    }
                } catch(e) {
                    console.error(e)
                }
                if(c && (!self.fittedElement || !self.fittedScope  || !self.fittedScope.document || !self.fittedScope.document.querySelector('body').contains(self.fittedElement))){
                    return c;
                }
            }
        }
    }

    self.fitterCallback = (result) => {
        if(result && result.element && self.allowFitter()){
            console.log('fitterCallback', result);
            var video = result.element;
            if(video.tagName.toLowerCase() != 'video'){
                video = result.scope.document.querySelector('video')
            } 
            console.log('fitterCallback', video, video.duration);
            if(!video || video.duration >= Config.get('min-buffer-secs-before-commit')){
                console.log('runFitter SUCCESS', result);
                if(!self.shadow){
                    self.playback.setState('play')
                }
                self.fittedScope = result.scope;
                self.fittedScope.addEventListener('unload', () => {
                    if(!self.error && !self.ended){
                        self.video = false;
                        self.fittedElement = false;
                        setTimeout(self.runFitter, 2000)
                    }
                });
                self.fittedElement = result.element;
                self.video = false;
                self.on('getVideo', (v) => {
                    //console.error('ZOOOOOOOOOOOOOOO', v, self);
                    Fitter.outerFit(v, self.fittedScope);
                    setTimeout(() => {
                        if(self.playback.active && self.video){
                            Fitter.outerFit(self.video, self.fittedScope)
                        }
                    }, 400)
                }); 
                self.getVideo();
                self.started = true;
                self.trigger('start', self);
                console.log('runFitter SUCCESS', result);
                return true;
            }
        }
    }

    self.runFitter = () => {
        var interval = 3000;
        if(self.fitterTimer){
            clearTimeout(self.fitterTimer)
        }
        self.fitterTimer = setTimeout(() => {
            if(self.fitterTimer){
                clearTimeout(self.fitterTimer)
            }
            var c = self.allowFitter();
            if(c){
                console.log('intent.runFitter()', time(), self.fittedElement);
                Fitter.start(c, self);
                self.fitterTimer = setTimeout(self.runFitter, interval);
                console.log('intent.runFitter() OK')
            }
        }, 50);
        //console.log('intent.runFitter() -1', time());
        return self.started;
    }
      
    self.commit = () => {
        jQuery(document).find('iframe#sandbox').not(self.frame).remove();
        jQuery(self.frame).removeClass('hide').addClass('show').prop('id', 'sandbox');
        self.frame.id = 'sandbox';
        showPlayers(false, true);
        var w = self.fittedScope || self.frame.contentWindow || false;
        if(w){
            enableEventForwarding(w)
        }
    }

    self.play = () => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.video.currentSrc.indexOf('blob:')==-1){
                self.video.play()
            }
        }
    }

    self.pause = () => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.video.currentSrc.indexOf('blob:')==-1){
                self.video.pause()
            } else {
                notify(Lang.CANNOT_PAUSE, 'fa-exclamation-circle faclr-red', 'normal')
            }
        }
    }
    
    self.seek = (secs) => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.video.currentSrc.indexOf('blob:')==-1){
                self.video.currentTime += secs;
            }
        }
    }

    self.playing = () => {
        if(self.committed){
            if(self.getVideo()){
                return !self.video.paused;
            } else {
                return true;
            }
        }
    }

    self.getVideo = () => {
        if(self.committed){
            if(!self.video && self.fittedElement){
                if(self.fittedElement.tagName && self.fittedElement.tagName.toLowerCase()=='video'){
                    self.video = self.fittedElement;
                } else {
                    if(self.fittedElement.querySelector){
                        self.video = self.fittedElement.querySelector('video')
                    } else if(self.fittedScope && self.fittedScope.document) {
                        self.video = self.fittedScope.document.querySelector('video')
                    }
                }
                if(self.video){
                    console.log('PATCHING VIDEO', self.video, self.video.src, self.video.currentTime);
                    self.trigger('getVideo', self.video)
                    if(isHTTP(self.video.currentSrc)){
                        self.sideload.add(self.video.currentSrc)
                    }
                }
            }
            if(self.video){
                $body.removeClass('no-video').addClass('has-video')
            } else {
                $body.addClass('no-video').removeClass('has-video')
            }
        }
        return self.video;
    }

    self.on('error destroy', () => {
        console.log('ERROR TRIGGERED');
        if(self.sideload){
            self.sideload.cancel()
        }
        if(self.frame){
            self.frame.src = 'about:blank';
            jQuery(self.frame).remove();
            delete self.frame;
        }
    })

    self.on('commit', () => {
        document.querySelector('body').appendChild(self.frame);
    })
    
    self.frame = document.createElement('iframe')
    self.frame.className = "fit-screen hide"; 
    self.frame.nwdisable = true;
    self.frame.nwfaketop = true;
    self.frame.height = "100%";
    self.frame.setAttribute('allowFullScreen', '')    
    document.querySelector('body').appendChild(self.frame)

    if(options){
        self.apply(options)
    }

    document.body.appendChild(self.frame)

    return self;

}
