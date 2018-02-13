//import { clearInterval } from 'timers';

var fs = require('fs'), os = require('os'), async = require('async'), ffmpeg = require('fluent-ffmpeg'), peerflix;

var isPlaying = false;
var clapprPlayer = false;
var cpuCount = os.cpus().length;

ffmpeg.setFfmpegPath('ffmpeg/ffmpeg');

var PlaybackManager = (() => {
    var self = {
		events: [], 
		intents: [], 
		wasLoading: false, 
		activeIntent: false, 
        lastCommitTime: 0,
        intentTypesPriorityOrder: ['magnet', 'ts', 'direct', 'youtube', 'ffmpeg', 'frame'] // ts above direct to ensure
	};
    self.on = (action, callback) => { // register, commit
        action = action.split(' ');
        for(var i=0;i<action.length;i++){
            if(typeof(self.events[action[i]])=='undefined'){
                self.events[action[i]] = [];
            }
            self.events[action[i]].push(callback)
        }
    }
    self.trigger = (action, ...arguments) => {
        doAction(action, self.activeIntent, self);
        if(typeof(self.events[action])!='undefined'){
            var _args = Array.from(arguments);
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }
    self.data = () => {
        if(self.activeIntent){
            return self.activeIntent.entry;
        }
    }
    self.query = (filter) => { // object
        var results = [];
        for(var i=0; i<self.intents.length; i++){
            ok = true;
            for(var key in filter){
                if(!self.intents[i] || typeof(self.intents[i][key])=='undefined' || self.intents[i][key] != filter[key]){
                    ok = false;
                    break;
                }
            }
            if(ok){
                results.push(self.intents[i])
            }
        }
        return results;
    }
    self.play = () => {
        if(self.activeIntent){
            var r = self.activeIntent.play();
            self.trigger('play');
            return r;
        }
    }
    self.pause = () => {
        if(self.activeIntent){
            var r = self.activeIntent.pause();
            self.trigger('pause');
            return r;
        }
    }
    self.playing = () => {
        if(self.activeIntent){
            return self.activeIntent.playing()
        }
    }
    self.seek = (secs) => {
        if(self.activeIntent){
            var r = self.activeIntent.seek(secs);
            self.trigger('seek');
            return r;
        }
    }
    self.stop = () => {
        console.log('STOP');
        self.intents.forEach((intent, i) => {
            self.destroyIntent(intent)
        })
        console.log('STOPPED', self.intents);
        self.intents = [];
        self.activeIntent = false;
        if(self.wasLoading){
            self.wasLoading = false;
            console.log('load-out')
            self.trigger('load-out');
        }
        self.trigger('stop');
        NativeStop();
        console.log('STOP OK');
    }
    self.getURL = () => {
        if(self.activeIntent){
            return self.activeIntent.entry.originalUrl || self.activeIntent.entry.url;
        }
    }
    self.runFitter = () => { // frames only
        console.log('PlaybackManager.runFitter()');
        var aliveIntents = self.query({type: 'frame'});
        for(var i=0; i<aliveIntents.length; i++){
            aliveIntents[i].runFitter()
        }
    }
    self.isLoading = (fetch) => {
        var loadingIntents;
        if(typeof(fetch)=='string'){
            loadingIntents = self.query({originalUrl: fetch, ended: false, error: false});
            return loadingIntents.length > 0;
        }
        var is = false, urls = [];
        //console.log('LOADING', self, traceback());
        loadingIntents = self.query({started: false, ended: false, error: false, sideload: false});
        if(fetch === true){
            for(var i=0; i<loadingIntents.length; i++){
                urls.push(loadingIntents[i].entry.url)
            }
            is = urls.length ? urls : [];
        } else {
            is = loadingIntents.length > 0;
        }
        if(self.wasLoading != is){
            console.log('LOADCHANGE');
            self.wasLoading = !!is;
            console.log(is ? 'load-in' : 'load-out')
            self.trigger(is ? 'load-in' : 'load-out')
        }
        return is;
    }
    self.resetIntentsKeys = () => {
        self.intents = self.intents.filter(function (item) {
            return item !== undefined;
        });
    }
    self.cancelLoading = () => {
        console.log('CANCEL LOADING', self.log());
        for(var i=0; i<self.intents.length; i++){
            if(self.intents[i] != self.activeIntent){
                self.destroyIntent(self.intents[i])
            }
        }
        self.resetIntentsKeys();
        console.log('CANCEL LOADING OK', self.log())
    }
    self.log = () => {
        var _log = '', state, error;
        for(var i=0; i<self.intents.length; i++){
            state = 'unknown';
            error = self.intents[i].ended || self.intents[i].error;
            if(!error && self.intents[i].started){
                state = 'started';
            } else {
                if(!error){
                    state = 'loading';
                } else if(self.intents[i].ended){
                    state = 'ended';
                } else {
                    state = 'error';
                }
            }
            if(self.intents[i] == self.activeIntent){
                state += ' active';
            }
            if(self.intents[i].sideload){
                state = 'sideload '+state;
            }
            _log += self.intents[i].entry.url;
            if(self.intents[i].entry.url != self.intents[i].entry.originalUrl){
                _log += " (from "+self.intents[i].entry.originalUrl+")";
            }
            _log += " ("+self.intents[i].type+", "+state+")\r\n";
        }
        return _log;
    }
    self.hasURL = (url) => {
        for(var i=0; i<self.intents.length; i++){
            if(self.intents[i].entry.url == url || self.intents[i].entry.originalUrl == url){
                return true;
                break;
            }
        }
    }
    self.destroyIntent = (intent) => {
        console.log('DESTROYING', intent);
        try {
            intent.destroy();
        } catch(e) {
            console.error('INTENT DESTROY FAILURE', e)
        }
        var i = self.intents.indexOf(intent);
        if(i != -1){
            delete self.intents[i];
            self.resetIntentsKeys()
        }
    }
    self.checkIntents = () => {
        var concurrent, isNewer, activeIntent = false, loading = false, intents = self.query({started: true, error: false, ended: false});
        for(var i=0; i<intents.length; i++){
            if(intents[i] != self.activeIntent){
                if(activeIntent){ // which of these started intents has higher priority
                    var a = self.intentTypesPriorityOrder.indexOf(activeIntent.type);
                    var b = self.intentTypesPriorityOrder.indexOf(intents[i].type);
                    var c = intents[i].entry.originalUrl.indexOf('#nofit') != -1;
                    isNewer = (b == a) ? (activeIntent.ctime < intents[i].ctime) : (b < a);
                    if(c || isNewer){ // new intent has higher priority than the activeIntent
                        self.destroyIntent(activeIntent);
                        console.log('COMMITING DISCARD', intent, self.activeIntent, a, b);                        
                    } else { // keep current activeIntent
                        continue;
                    }
                }
                activeIntent = intents[i];
            }
        }
        if(activeIntent && activeIntent != self.activeIntent){
            self.commitIntent(activeIntent);
            self.trigger('load-out')
        } else if(!intents.length && self.activeIntent) {
            self.activeIntent = false;
            self.stop()
        }
        var was = self.wasLoading, isLoading = self.isLoading();
        if(isLoading){
            setTimeout(self.checkIntents.bind(this), 2000)
        }
        //console.log('ACTIVE', activeIntent, was, isLoading, intents);
    }
    self.registerIntent = (intent) => {
        console.log('REGISTER INTENT', intent, traceback());
        if(self.intents.indexOf(intent)==-1){
            self.intents.push(intent)
        }
        intent.on('start', self.checkIntents.bind(this));
        intent.on('error', self.checkIntents.bind(this));
        intent.on('ended', () => {
            console.log('INTENT ENDED');
            setTimeout(PlaybackManager.checkIntents.bind(PlaybackManager), 1000)
        });
        self.checkIntents();
        self.trigger('register', intent)      
        if(intent.ended){
            intent.trigger('ended')
        } else if(intent.error){
            intent.trigger('error')
        }
    }
    self.commitIntent = (intent) => {
        var concurrent;
        if(self.activeIntent != intent){
            console.log('COMMITING', intent, self.activeIntent, traceback());
            if(self.activeIntent){
                concurrent = ((intent.entry.originalUrl||intent.entry.url) == (self.activeIntent.entry.originalUrl||self.activeIntent.entry.url));
                if(concurrent){ // both are intents from the same stream, decide for one of them
                    var a = self.intentTypesPriorityOrder.indexOf(intent.type);
                    var b = self.intentTypesPriorityOrder.indexOf(self.activeIntent.type);
                    var c = self.activeIntent.entry.originalUrl.indexOf('#nofit') != -1;
                    if(c || b <= a){ // new concurrent intent has lower (or equal) priority than the active intent
                        self.destroyIntent(intent);
                        console.log('COMMITING DISCARD', intent, self.activeIntent, a, b);
                        return false; // keep the current activeIntent
                    }
                }
            }
            var allow = true;
            allow = intent.filter('pre-commit', allow, intent, self.activeIntent);
            if(allow === false){
                console.log('COMMITING DISALLOWED');
                self.destroyIntent(intent);
                return false; // commiting canceled, keep the current activeIntent
            }
            // From here, the intent is already confirmed, so destroy any non-concurrent (different channel) intents and concurrent intents with lower or equal priority
            for(var i=0; i<self.intents.length; i++){
                if(self.intents[i] != intent){
                    var active = (self.activeIntent == self.intents[i]);
                    concurrent = (
                        intent.entry.originalUrl == 
                        self.intents[i].entry.originalUrl
                    );
                    if(active){
                        self.trigger('uncommit', self.activeIntent, intent)
                    }
                    if(concurrent){
                        var a = self.intentTypesPriorityOrder.indexOf(intent.type);
                        var b = self.intentTypesPriorityOrder.indexOf(self.intents[i].type);
                        if(a <= b){ // keep the current intent
                            self.destroyIntent(self.intents[i])    
                        }
                    } else {
                        self.destroyIntent(self.intents[i])
                    }
                }
            }
            console.log('COMMITING ACTIVE', intent);
            if(self.intents.indexOf(intent)==-1){
                self.registerIntent(intent);
            }
            self.activeIntent = intent;
            console.log('COMMITING AA', intent);
            try {
                intent.commit()
            } catch(e) {
                console.error(e)
            }
            console.log('COMMITING BB', intent);
            self.trigger('commit', intent, intent.entry);
            setTimeout(self.initRatio, 100);
            console.log('COMMITING OK', self.intents);
        } else {
            console.log('COMMITING - Already committed.')
        }
        self.lastCommitTime = time()
    }
    self.getVideoSize = () => {
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
            if(v){
                return {width: v.videoWidth, height: v.videoHeight}
            }
        }
        return {width: 1920, height: 1080}; // some fallback value
    }    
    self.initRatio = () => {
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
            if(v){
                var w = v.videoWidth || 1920, h = v.videoHeight || 1080, r = w / h;
                var scaleModesInt = scaleModes.map(scaleModeAsInt);
                var c = closest(r, scaleModesInt), k = scaleModesInt.indexOf(c);
                self.setRatio(scaleModes[k])
            }
        }
    }  
    self.getRatio = () => {
        return Config.get('aspect-ratio') || '16:9';
    }
    self.setRatio = (ratio) => {
        if(typeof(ratio)!='string'){
            ratio = self.getRatio();
        } else {
            Config.set('aspect-ratio', ratio)
        }
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
            if(v){
                console.log(typeof(ratio), ratio);
                ratio = scaleModeAsInt(ratio);                
				var w, h, ww = v.ownerDocument.body.offsetWidth, wh = v.ownerDocument.body.offsetHeight, wratio = ww / wh;
				if(wratio >= ratio){
					h = wh;
                    w = wh * ratio;
				} else {
					w = ww;
					h = ww / ratio;
				}
                console.log('RATIO', w, h, ww, wh, wratio, ratio);
                v.style.setProperty("width", w+"px", "important");
                v.style.setProperty("height", h+"px", "important");
                v.style.setProperty("min-width", w+"px", "important");
                v.style.setProperty("min-height", h+"px", "important");
                v.style.setProperty("top", ((wh - h) / 2)+"px", "important");
                v.style.setProperty("left", ((ww - w) / 2)+"px", "important");
                v.style.setProperty("objectFit", "fill", "important");
            }
        }
    }
    window.addEventListener('resize', self.setRatio);
    return self;
})();

function createPlayIntent(entry, options, callback){
    console.log('CREATE INTENT', entry, options, traceback());
    if(!options) options = {};
    var shadow = (typeof(options.shadow)!='undefined' && options.shadow);
    var initTime = time(), FFmpegIntentsLimit = 8, intents = [];
    var currentPlaybackType = '', currentPlaybackTypePriotity = -1;
    entry.url = String(entry.url); // Parameter "url" must be a string, not object
    entry.name = String(entry.name);
    entry.logo = String(entry.logo);
    if(!shadow && PlaybackManager.activeIntent && PlaybackManager.activeIntent.entry.originalUrl == (entry.originalUrl || entry.url)){
        currentPlaybackType = PlaybackManager.activeIntent.type;
        currentPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(currentPlaybackType); // less is higher
    }
    var internalCallback = (intent) => {
        console.log('_INTENT', intent, intents);
        if(intent){
            if(!shadow){
                PlaybackManager.registerIntent(intent);
            }
            if(callback){
                callback(intent) // before run() to allow setup any event callbacks
            }
            //console.log('INTERNAL', intent, traceback());
            intent.run();
            return intent;
        } else {
            console.log('Error: NO INTENT', intent, entry.url);
        }
    }
    if(typeof(entry.originalUrl) == 'undefined'){
        entry.originalUrl = entry.url;
    }
    if(isTS(entry.url)){
        // these TS can be >20MB and even infinite (realtime), so it wont run as HTML5, FFMPEG is a better approach so
        console.log('CREATEPLAYINTENT FOR TS', entry.url);
        intents.push(createTSFFmpegIntent(entry, options))
    } else if(isMagnet(entry.url)){
        console.log('CREATEPLAYINTENT FOR MAGNET', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['magnet'] < currentPlaybackTypePriotity){
            intents.push(createMagnetIntent(entry, options))
        }
    } else if(isRTMP(entry.url) || isRTSP(entry.url)){
        console.log('CREATEPLAYINTENT FOR RTMP/RTSP', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            intents.push(createFFmpegIntent(entry, options))
        }
    } else if(isHTML5Video(entry.url) || isM3U8(entry.url)){
        console.log('CREATEPLAYINTENT FOR HTML5/M3U8', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['direct'] < currentPlaybackTypePriotity){
            intents.push(createDirectIntent(entry, options))
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            if(PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                intents.push(createFFmpegIntent(entry, options))
            }
        }
    } else if(isMedia(entry.url)){
        console.log('CREATEPLAYINTENT FOR MEDIA', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            intents.push(createFFmpegIntent(entry, options))
        }
    } else if(isYT(entry.url)){
        console.log('CREATEPLAYINTENT FOR YT', entry.url);
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(entry.url);
        if(id){
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['youtube'] < currentPlaybackTypePriotity){
                intents.push(createYoutubeIntent(entry, options))
            }
        } else {
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['frame'] < currentPlaybackTypePriotity){
                intents.push(createFrameIntent(entry, options))
            }
        }
    } else  {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['frame'] < currentPlaybackTypePriotity){
            if(!options || !options.sideload){
                intents.push(createFrameIntent(entry, options))
            }
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['direct'] < currentPlaybackTypePriotity){
            intents.push(createDirectIntent(entry, options)) // not sure, so we'll race the possible intents
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            if(PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                intents.push(createFFmpegIntent(entry, options)) // not sure, so we'll race the possible intents
            }
        }
    }
    intents.forEach((intent, index) => {
        internalCallback(intent)
    })
    return intents;
}

function createBaseIntent(){

    var self = {};
    self.type = 'base';
    self.top = top; // reference for listeners
    self.sideload = false;
    self.shadow = false;
    self.loaded = false;
    self.started = false;
    self.error = false;
    self.ended = false;
    self.attached = false;
    self.videoElement = false;
    self.entry = {};
    self.events = {};
    self.ctime = time();
    self.committed = false;
    self.controller = false;

    self.on = (action, callback) => { // register, commit
        action = action.split(' ');
        for(var i=0;i<action.length;i++){
            if(typeof(self.events[action[i]])=='undefined'){
                self.events[action[i]] = [];
            }
            self.events[action[i]].push(callback)
        }
    }

    self.off = (action, callback) => { // register, commit
        if(action){
            action = action.split(' ')
        } else {
            action = Object.keys(self.events)
        }
        for(var i=0;i<action.length;i++){
            if(typeof(self.events[action[i]])!='undefined'){
                if(callback){
                    var p = self.events[action[i]].indexOf(callback)
                    if(p != -1){
                        delete self.events[action[i]][p];
                    }
                } else {
                    self.events[action[i]] = [];
                }
            }
        }
    }

    self.trigger = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(jQuery.isArray(self.events[action])){
            console.log(action, traceback());
            console.log(self.events[action]);
            console.log(self.events[action].length);
            for(var i=0; self.events[action] && i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(jQuery.isArray(self.events[action])){
            for(var i=0; self.events[action] && i<self.events[action].length; i++){
                if(!_args[0]){
                    break;
                }
                _args[0] = self.events[action][i].apply(null, _args)
            }
        }
        return _args[0];
    }

    self.play = () => {
        if(self.controller){
            self.controller.play();
            self.trigger('play')
        }
    }

    self.pause = () => {
        if(self.controller){
            self.controller.pause();
            self.trigger('pause')
        }
    }
    
    self.seek = (secs) => {
        if(self.controller){
            self.controller.seek(secs)
        }
    }

    self.playing = () => {
        if(self.committed){
            if(self.controller){
                return !self.controller.paused();
            } else {
                return true;
            }
        }
    }

    self.getVideo = () => {
        if(!self.videoElement || !self.videoElement.parentNode){
            self.videoElement = getFrame('player').videoElement();
        }
        if(self.videoElement){
            var mute = !self.committed;
            if(mute != self.committed.muted){
                self.committed.muted = mute;
            }
        }
        return self.videoElement;
    }

    self.apply = (options) => {
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else {
                self[key] = options[key];
            }
        }
    }

    self.timeout = 0;
    self.setTimeout = (secs) => {
        clearInterval(self.timeout);
        if(!self.committed && !self.error){
            var s = time();
            self.timeout = setTimeout(() => {
                if(!self.committed && !self.started && !self.error && !self.ended){
                    console.error('Connect timeout.', s, time() - s);
                    self.error = true;
                    self.trigger('error')
                }
            }, secs * 1000)
        }
    }

    return self;
}

function createFrameIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'frame';
    self.entry = entry;
    self.fitterTimer = 0;
    self.fittedElement = false;
    self.fittedScope = false;
    self.allowMediaSourcePausing = true;
    
    self.frame = document.createElement('iframe');
    self.frame.className = "fit-screen hide"; 
    self.frame.nwdisable = true;
    self.frame.nwfaketop = true;
    self.frame.height = "100%";
    self.frame.onload = () => {
        self.loaded = true;
    }

    self.run = () => {    
        if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                console.log('Content-Type', self.entry.url, ct);
                if(!ct || ['text/html'].indexOf(ct.toLowerCase()) != -1){
                    self.runConfirm()
                } else {
                    console.log('Bad content-type: '+ct);
                    self.error = true;
                    self.trigger('error')
                }
            })        
        } else {
            console.log('Not HTTP(s)');
            self.error = true;
            self.trigger('error')
        }
    }
    
    self.runConfirm = () => {
        self.setTimeout(30);
        self.frame.src = self.entry.url;
        if(self.entry.originalUrl.match(new RegExp('#(catalog|nosandbox|nofit)([^A-Za-z0-9]|$)'))){
            self.started = true;
            self.trigger('start');
        }
    }

    self.runFitter = () => {
        console.log('intent.runFitter()');
        if(!self.entry.originalUrl.match(new RegExp('#nofit'))){
            if(!self.videoElement || !self.videoElement.parentNode){
                var result = Fitter.start(self.frame.contentWindow);
                console.log('intent.runFitter()', result);
                if(result && result.element){
                    self.started = true;
                    console.log('runFitter SUCCESS', result);
                    self.fittedElement = result.element;
                    self.fittedScope = result.scope;
                    if(self.fittedElement.tagName && self.fittedElement.tagName.toLowerCase()=='video'){
                        self.videoElement = self.fittedElement;
                    } else {
                        if(self.fittedElement.querySelector){
                            self.videoElement = self.fittedElement.querySelector('video')
                        } else {
                            self.videoElement = self.fittedScope.document.querySelector('video')
                        }
                    }
                    self.patchVideo();
                    self.trigger('start');
                    clearInterval(self.fitterTimer)
                }
            }
        }
        return self.started;
    }
      
    self.commit = () => {
        NativeStop();
        jQuery(top.document).find('#sandbox').remove();
        jQuery(self.frame).removeClass('hide').addClass('show').prop('id', 'sandbox');
        self.committed = true;
        self.frame.id = 'sandbox';
        self.frame.onload = () => {
            patchFrameWindowEvents(self.frame.contentWindow)
        }
        if(self.frame.contentWindow){
            patchFrameWindowEvents(self.frame.contentWindow)
            setTimeout(() => {
                if(self.frame && self.frame.contentWindow){ // stills available?
                    patchFrameWindowEvents(self.frame.contentWindow)
                }
            }, 2000)
        }
    }

    self.destroy = () => {
        if(self.frame){
            self.frame.src = 'about:blank';
            jQuery(self.frame).remove();
            delete self.frame;
        }
        clearInterval(self.fitterTimer);
        self.ended = true;
        self.attached = self.videoElement = false;        
    }

    self.play = () => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.play()
            }
        }
    }

    self.pause = () => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.pause()
            } else {
                notify(Lang.CANNOT_PAUSE, 'fa-warning', 'normal')
            }
        }
    }
    
    self.seek = (secs) => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.currentTime += secs;
            } else {

            }
        }
    }

    self.playing = () => {
        if(self.committed){
            if(self.getVideo()){
                return !self.videoElement.paused;
            } else {
                return true;
            }
        }
    }

    self.getVideo = () => {
        if(self.fittedScope && (!self.videoElement || !self.videoElement.parentNode)){
            self.videoElement = self.fittedScope.document.querySelector('video');
        }
        if(self.videoElement){
            var mute = !self.committed;
            if(mute != self.committed.muted){
                self.committed.muted = mute;
            }
        }
        return self.videoElement;
    }
    
    self.patchVideo = () => {
        if(self.getVideo()){
            var paused, wasPaused, f = function (e){
                console.log(self);
                e.preventDefault();
                e.stopPropagation();
                self.top.delayedPlayPauseNotify();
                return false;
            };
            if(self.videoElement.paused){
                self.videoElement.play()
            }
            self.videoElement.onclick = self.videoElement.onmousedown = self.videoElement.onmouseup = null;
            self.videoElement.style.background = '#000';
            self.videoElement.muted = false;
            jQuery(self.videoElement).
                on('play', f).
                on('pause', f).
                on('click', function (e){
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }).
                on('mousemove', function (e){
                    paused = self.videoElement.paused;
                }).
                on('mousedown', function (e){
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('FRAME VIDEO MOUSEDOWN');
                    wasPaused = paused;
                    console.log('PLAYING *', wasPaused, self.top);
                    return false;
                }).
                on('mouseup', function (e){
                    if(wasPaused){
                        self.top.PlaybackManager.play()
                    } else {
                        self.top.PlaybackManager.pause()
                    }
                    console.log('PLAYING **', wasPaused, self.top.PlaybackManager.playing());
                    self.top.delayedPlayPauseNotify();
                    self.top.focus();
                    return false;
                })
        }
    }

    if(options){
        self.apply(options);
        self.fitterTimer = setInterval(self.runFitter, 3000)
    }

    document.body.appendChild(self.frame);

    return self;

}

function createDirectIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'direct';
    self.controller = false;
    self.entry = entry;
    self.prx = false;
    self.prxurl = false;
    self.mimetype = '';
        
    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.prxurl, self.mimetype, 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        self.committed = true;
        self.controller = getFrame('player');
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }
    
    self.runConfirm = (ct) => {
        self.setTimeout(15);
        self.prxurl = self.entry.url;
        self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';
        var isTS = (getExt(self.prxurl) == 'ts');
        if(isTS){
            self.prxurl = getTSWrapper().getURL(self.prxurl)
        } else if(self.prxurl.match(new RegExp('(https?://).*m3u8'))){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        } else {
            self.mimetype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        }
        var p = getFrame('testing-player');
        if(!p || !p.test){
            throw 'No iframe#testing-player found.';
        }
        console.log('Testing', self.prxurl, self.entry.url, self.mimetype, self, traceback());
        p.test(self.prxurl, self.mimetype, () => {
            console.log('Test succeeded. '+self.prxurl);
            self.started = true;
            self.trigger('start')
        }, () => {
            console.log('Test Failed. '+self.prxurl);
            self.error = true;
            self.trigger('error')
        })
    }

    self.run = () => {    
        if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                console.log('Content-Type', self.entry.url, ct);
                if(!ct || [
                    'audio/x-mpegurl', 
                    'video/x-mpegurl', 
                    'application/x-mpegurl', 
                    'video/mp2t', 
                    'application/vnd.apple.mpegurl', 
                    'video/mp4', 
                    'audio/mp4', 
                    'video/x-m4v', 
                    'video/m4v',
                    'audio/aac',
                    'application/x-winamp-playlist', 
                    'audio/mpegurl', 
                    'audio/mpeg-url', 
                    'audio/playlist', 
                    'audio/scpls', 
                    'audio/x-scpls'
                    ].indexOf(ct.toLowerCase()) != -1){
                    self.runConfirm(ct)
                } else {
                    console.log('Bad content-type: '+ct);
                    self.error = true;
                    self.trigger('error')
                }
            })        
        } else {
            console.log('Not HTTP(s)');
            self.error = true;
            self.trigger('error')
        }
    }

    self.destroy = () => {
        self.events = [];
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    if(options){
        self.apply(options)
    }

    return self;

}

function createFFmpegIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ffmpeg';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.prxurl = false;
    self.prx = false;
    self.transcode = false;
    self.videoCodec = 'copy';

    self.killFFmpeg = () => {
        console.log('DESTROY 1.5');
        if(self.instance){
            console.log('DESTROY 3');
            self.instance.kill('SIGKILL');
            if (self.instance.file) {
                removeFolder(dirname(self.instance.file), true);
            }
            self.instance = false;
        }
        console.log('DESTROY 4');
    }

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.instance.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        self.committed = true;
        self.controller = getFrame('player');
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }

    self.destroy = () => {
        console.log('DESTROY 1');
        self.events = [];
        self.killFFmpeg();
        console.log('DESTROY 2');
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    self.callFFmpeg = () => {
        var uid = (new Date()).getTime(), isTS = (getExt(self.entry.url) == 'ts');
        self.setTimeout(60);
        self.prxurl = self.entry.url;
    
        if(['m3u', 'm3u8'].indexOf(getExt(self.prxurl))!=-1 && self.proxify){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        }

        self.instance = ffmpeg(self.prxurl).
            addOption('-cpu-used -5').
            addOption('-deadline realtime').
            addOption('-threads ' + (cpuCount - 1)).
            inputOptions('-fflags +genpts').
            inputOptions('-stream_loop 999999').
            videoCodec(self.videoCodec).
            audioCodec('aac').
            addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-hls_time', segmentDuration).
            addOption('-hls_list_size', 0).
            addOption('-hls_flags', 'delete_segments').
            addOption('-copyts').
            addOption('-sn').
            format('hls');

        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.instance
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (!self.proxify){
                self.instance.inputOptions('-multiple_requests 1')
            }
            if (self.entry.url.indexOf('https') == 0) {
                self.instance.inputOptions('-tls_verify 0')
            }
        }

        if(self.transcode){
            self.instance.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast');
        }
    
        // setup event handlers
        self.instance.
        on('end', () => {
            console.log('file ended');
            if((time() - self.ctime) >= 10 && getExt(self.entry.url)=='ts'){
                console.log('file retry');
                delete self.instance;
                self.error = false;
                self.ended = false;
                self.run()
            }
        }).
        on('error', function(err) {
            console.log('an error happened: ' + err.message);
            self.error = true;
            self.trigger('error')
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command: ' + commandLine);
            // ok, but wait file creation to trigger "start"
        });
    
        self.instance.file = 'stream/' + uid + '/output.m3u8';
    
        top.mkdirp(dirname(self.instance.file));
    
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    console.log('M3U8 file created.');
                    self.started = true;
                    self.trigger('start')
                } else {
                    console.log('M3U8 file creation timeout.');
                    self.error = true;
                    self.trigger('error')
                }
            }
        }, 1800);
        self.instance.output(self.instance.file).run();
    }
    
    self.run = () => {
        if(self.entry.url.substr(0, 4)=='http'){
            getHTTPContentType(self.entry.url, (ct) => {
                console.log('Content-Type', self.entry.url, ct);
                self.transcode = (!ct || [
                    'audio/x-mpegurl', 
                    'video/x-mpegurl', 
                    'application/x-mpegurl', 
                    'video/mp2t', 
                    'application/vnd.apple.mpegurl', 
                    'video/mp4', 
                    'audio/mp4', 
                    'video/x-m4v', 
                    'video/m4v',
                    'audio/aac',
                    'application/x-winamp-playlist', 
                    'audio/mpegurl', 
                    'audio/mpeg-url', 
                    'audio/playlist', 
                    'audio/scpls', 
                    'audio/x-scpls',
                    'text/html'
                    ].indexOf(ct.toLowerCase()) == -1);
                //self.transcode = 1;
                self.videoCodec = self.transcode ? 'libx264' : 'copy';
                self.callFFmpeg()
            })        
        } else {
            self.callFFmpeg()
        }
    }

    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    self.on('error', self.killFFmpeg);
    self.on('ended', self.killFFmpeg);

    if(options){
        self.apply(options);
        console.log('ZZZZ', options, self);
    }

    return self;

}

function createTSFFmpegIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ts';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.prxurl = false;
    self.prx = false;
    self.transcode = false;
    self.videoCodec = 'copy';
    self.uid = 0;
    self.softErrors = [];
    self.tsDuration = 0;
    self.tsFetchStart = 0;
    
    var uid = (new Date()).getTime(), file = 'stream/' + uid + '/output.m3u8';

    self.getTSDuration = (callback) => {
        if(self.tsDuration){
            callback(self.tsDuration)
        } else {
            var tsfile = dirname(file)+'/output0.ts';
            getFFmpegMediaInfo(tsfile, (output) => {
                console.log(tsfile, output);
                if(output){
                    var match = output.match(new RegExp('Duration: ([0-9:]+)'));
                    if(match.length > 1 && match[1].length == 8){
                        var secs = hmsToSecondsOnly(match[1]);
                        if(secs){
                            self.tsDuration = secs;
                            return callback(secs)
                        }
                    }
                }
                callback(false)
            })
        }
    }

    self.fetchNext = () => {
        self.killFFmpeg(true); // kill actual instance, arguments[0] = true to keep files
        self.getTSDuration((duration) => {
            var nextFetchTime = self.tsFetchStart + duration;
            var remainingToNextFetch = nextFetchTime - time();
            if(remainingToNextFetch > 0){
                console.log('FETCHWAIT', remainingToNextFetch, time(), nextFetchTime);
                setTimeout(self.callFFmpeg, (remaining * -1) * 1000)
            } else {
                console.log('FETCHNOWAIT', remainingToNextFetch, time(), nextFetchTime);
                self.callFFmpeg()
            }
        })
    }

    self.killFFmpeg = (keepFiles) => {
        console.log('DESTROY 1.5');
        if(self.instance){
            console.log('DESTROY 3');
            self.instance.kill('SIGKILL');
            if (keepFiles !== true && self.instance.file) {
                console.log('DESTROY 3.5');
                removeFolder(dirname(self.instance.file), true);
            }
            self.instance = false;
        }
        console.log('DESTROY 4');
    }

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        var restartPlayback = () => {
            // https://github.com/videojs/video.js/issues/1805
            // the approach above did not worked fine, so we'll do a hard reset here
            var pl = getFrame('player'); 
            var err = pl.player.error(), code = err ? err.code : -1;
            var ttime, ntime = pl.player.currentTime();
            if(!ttime || (ntime && ntime > ttime)){
                ttime = ntime;
            }
            console.log('ERR', code);
            if(code === 2 || code === -1) {
                var tt = time();
                self.softErrors.push(tt);
                var _t = tt - 10;
                var recentErrorsCount = self.softErrors.filter((t) => {
                    return ((t > _t));
                }).length;
                console.log('ERRORCOUNT', recentErrorsCount);
                if(recentErrorsCount < 4){
                    /*
                    pl.location.reload();
                    setTimeout(() => {
                        self.videoElement = pl.videoElement();
                        jQuery(self.videoElement).on('pause', () => {
                            console.log('FORCE PLAY?');
                            restartPlayback()
                        })
                        pl.src(self.instance.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"');
                        pl.play(() => {
                            console.log('REPOINT', ttime);
                            jQuery(self.videoElement).one('play', () => {
                                console.log('FORCE PLAY');
                                pl.player.ready(() => {
                                    pl.player.currentTime(ttime - 2);
                                    PlaybackManager.setRatio();
                                    jQuery(self.videoElement).off('pause')
                                })
                            })
                        })
                    }, 2000);
                    */
                    pl.reset();
                    pl.player.off('ended');
                    pl.player.on('ended', () => {
                        console.log('PLAYER RESET 2');
                        pl.reset()
                    });
                    return true;
                }
            }
        }
        NativePlayURL(self.instance.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            () => { // started
                var pl = getFrame('player');
                self.videoElement = pl.videoElement();
                pl.player.off('ended');
                pl.player.on('ended', () => {
                    console.log('PLAYER RESET');
                    pl.reset()
                });
                playPauseNotify();
            },
            () => { // ended
                console.log('Playback ended, restart.'); // wait for FFMPEG chunks
                if(!restartPlayback()){
                    console.log('Restart failed.');
                    self.ended = true;
                    self.trigger('ended')
                }
            },
            () => { // error
                console.log('Player error.');
                if(!restartPlayback()){
                    console.log('Restart failed.');
                    self.error = true;
                    self.trigger('error')
                }
            });
        self.committed = true;
        self.controller = getFrame('player');
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }

    self.destroy = () => {
        console.log('DESTROY 1');
        self.events = [];
        self.killFFmpeg();
        console.log('DESTROY 2');
        self.ended = true;
        self.attached = self.videoElement = false;  
    }

    top.mkdirp(dirname(file));

    self.callFFmpeg = () => {
        //console.log('aa');
        self.setTimeout(60);
        self.tsFetchStart = time();
        self.instance = ffmpeg(self.prxurl).
            addOption('-cpu-used -5').
            addOption('-deadline realtime').
            addOption('-threads ' + (cpuCount - 1)).
            inputOptions('-fflags +genpts').
            inputOptions('-stream_loop 999999').
            videoCodec(self.videoCodec).
            audioCodec('aac').
            addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-hls_time', segmentDuration).
            addOption('-hls_list_size', 0).
            addOption('-hls_flags', 'delete_segments')

        //console.log('aa');
        var alreadyExists = fs.existsSync(file);
        if(alreadyExists) {
            self.instance.addOption('-hls_flags', 'append_list')
        }
        
        self.instance.addOption('-copyts').addOption('-sn').format('hls');

        //console.log('aa');
        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.instance
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (!self.proxify){
                self.instance.inputOptions('-multiple_requests 1')
            }
            if (self.entry.url.indexOf('https') == 0) {
                self.instance.inputOptions('-tls_verify 0')
            }
        }

        //console.log('aa');
        if(self.transcode){
            self.instance.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast');
        }
    
        // setup event handlers
        self.instance.
        on('end', () => {
            console.log('file ended'); // if it ended, it's not realtime, fallback to using it as chunks
            self.fetchNext()
        }).
        on('error', function(err) {
            console.log('an error happened: ' + err.message);
            var tt = time();
            self.softErrors.push(tt);
            var _t = tt - 10;
            var recentErrorsCount = self.softErrors.filter((t) => {
                return ((t > _t));
            }).length;
            console.log('ERRORCOUNT', recentErrorsCount);
            if(recentErrorsCount < 4 && err.message && err.message.match('(403 Forbidden|5XX Server Error|End of file)') && self.entry.source){
                console.log('reauth needed', self.entry.source); // if it ended, it's not realtime, fallback to using it as chunks
                getHeaders(self.entry.source, (h, u) => {
                    console.log('reauth OK', self.entry.source, u, h); // if it ended, it's not realtime, fallback to using it as chunks
                    self.fetchNext()
                });
            } else {
                self.error = true;
                self.trigger('error')
            }
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command: ' + commandLine);
            // ok, but wait file creation to trigger "start"
        });
    
        //console.log('aa');
        self.instance.file = file;
        if(!alreadyExists){
            waitInstanceFileExistsTimeout(self, function (exists) {
                if(!self.ended && !self.error){
                    if(exists){
                        console.log('M3U8 file created.');
                        self.started = true;
                        self.trigger('start')
                    } else {
                        console.log('M3U8 file creation timeout.');
                        self.error = true;
                        self.trigger('error')
                    }
                }
            }, 1800);
        }
        
        //console.log('aa');
        self.instance.output(file).run();
        //console.log('aa');
    }
    
    self.run = () => {
        self.prxurl = self.entry.url;
        self.callFFmpeg()
    }

    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    self.on('error', self.killFFmpeg);
    self.on('ended', self.killFFmpeg);

    if(options){
        self.apply(options);
        console.log('ZZZZ', options, self);
    }

    return self;

}

function createMagnetIntent(entry, options){
    
    var self = createBaseIntent();
    self.transcode = !!entry['transcode'];
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.type = 'magnet';
    self.entry = entry;
    self.folder = '';
    self.peerflix = false;
    self.endpoint = false;
    self.progressTimer = 0;
    self.unpaused = false;
        
    self.commit = () => {
        NativePlayURL(self.instance.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            () => { // started
                console.log('STARTS');
                if(!self.unpaused){
                    self.unpaused = true;
                    self.videoElement = getFrame('player').videoElement();
                    //playPauseNotify()
                    top.automaticallyPaused = true;
                    var o = getFrame('overlay');
                    if(o){
                        jQuery(o.document).one('mousemove', () => {
                            console.log('WAKENPLAY');
                            PlaybackManager.play()
                        })
                    }
                }
            },
            () => { // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            }, true);
        jQuery('#player').removeClass('hide').addClass('show');
        self.committed = true;
        self.attached = true;
        self.controller = getFrame('player');
        self.videoElement = self.controller.videoElement();
        self.on('play', self.hideStats);
        self.on('pause', self.showStats);
        top.focus()
    }

    self.showStats = () => {
        self.subNotify.show();
        self.notify.show()
    }

    self.hideStats = () => {
        self.subNotify.hide();
        self.notify.hide()
    }
    
    self.run = () => {
        //self.setTimeout(15);
        console.log('run() called');
        self.subNotify = notify(Lang.CAN_BE_SLOW, 'fa-coffee', 'wait');
        self.notify = notify(Lang.SEARCHING_PEERS, 'fa-magnet', 'wait');
        if(self.endpoint){
            console.log('About to stream...');
            self.stream()
        }
    }

    self.destroy = () => {
        if(self.notify){
            self.subNotify.close();
            self.notify.close()
        }
        clearInterval(self.progressTimer);
        self.peerflix.destroy();
        self.events = [];
        if(self.instance){
            self.instance.kill('SIGKILL');
            if (self.instance.file) {
                removeFolder(dirname(self.instance.file), true);
            }
        }
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    self.stream = () => {
        self.instance = ffmpeg(self.endpoint).
            addOption('-cpu-used -5').
            addOption('-deadline realtime').
            addOption('-threads ' + (cpuCount - 1)).
            inputOptions('-fflags +genpts').
            inputOptions('-stream_loop -1').
            videoCodec(self.videoCodec).
            audioCodec('aac').
            addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-hls_time', segmentDuration).
            addOption('-hls_list_size', 0).
            addOption('-hls_flags', 'delete_segments').
            addOption('-copyts').
            addOption('-sn').
            format('hls');
    
        if(self.transcode){
            self.instance.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast');
                //addOption('-g 15').
                //addOption('-cluster_size_limit 10M').
                //addOption('-cluster_time_limit 10K').
                //addOption('-movflags +faststart+frag_keyframe+empty_moov+default_base_moof').
                //addOption('-x264opts no-scenecut')
        }
    
        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.instance.inputOptions('-multiple_requests 1')
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (self.entry.url.indexOf('https') == 0) {
                self.instance.inputOptions('-tls_verify 0')
            }
        }
    
        // setup event handlers
        self.instance.
        on('end', () => {
            console.log('file ended');
        }).
        on('error', function(err) {
            console.log('an error happened: ' + err.message);
            self.error = true;
            self.trigger('error')
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command: ' + commandLine);
            // ok, but wait file creation to trigger "start"
        });    
        self.instance.file = 'stream/' + uid + '/output.m3u8';    
        top.mkdirp(dirname(self.instance.file));    
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    console.log('M3U8 file created.');
                    self.started = true;
                    self.trigger('start');
                    clearInterval(self.progressTimer)
                } else {
                    console.log('M3U8 file creation timeout.');
                    self.error = true;
                    self.trigger('error')
                }
            }
        }, 1800);
        self.instance.output(self.instance.file).run()
    }
    if(!peerflix){
        peerflix = require('peerflix')
    }
    self.peerflix = peerflix(self.entry.url, {tmp:'torrent'});
    self.peerflix.server.on('listening', () => {
        self.endpoint = 'http://127.0.0.1:' +  self.peerflix.server.address().port + '/';
        self.stream()
    });
    var minAmountToStart = 10000000;
    self.progressTimer = setInterval(() => {
        if(!self.peerflix.torrent){
            console.log('Something wrong with', self.entry)
        } else if(self.notify){
            var downloaded = 0;
            for (var i = 0; i < self.peerflix.torrent.pieces.length; i++) {
                if (self.peerflix.bitfield.get(i)){
                    downloaded++;
                }
            }      
            //var totalp = (downloaded / (self.peerflix.torrent.pieces.length / 100));
            var p = (downloaded * self.peerflix.torrent.pieceLength) / (minAmountToStart / 100);
            //console.log('QQQQQQQQQQQQQ', downloaded, self.peerflix.torrent.pieces.length, p);
            if(p >= 100){
                if(self.endpoint){
                    p = 100;
                } else {
                    p = 99;
                }
            }
            if(p > 0){
                self.subNotify.close()
            }
            self.notify.update(Lang.LOADING+' '+parseInt(p)+'% &middot; '+formatBytes(self.peerflix.swarm.downloadSpeed())+'/s', 'fa-magnet')
        }
    }, 1000);

    var uid = (new Date()).getTime();
    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options)
    }
    
    return self;

}

function createYoutubeIntent(entry, options){
    
    var self = createBaseIntent();
    self.transcode = !!entry['transcode'];
    self.videoCodec = 'copy';
    self.audioCodec = 'copy';
    self.type = 'youtube';
    self.entry = entry;
    self.folder = '';
    self.ytdl = false;
    self.endpoint = false;
    self.progressTimer = 0;
    self.ctype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        
    self.commit = () => {
        NativePlayURL(self.endpoint, self.ctype, 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            () => { // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        jQuery('#player').removeClass('hide').addClass('show');
        self.committed = true;
        self.attached = true;
        self.controller = getFrame('player');
        self.videoElement = self.controller.videoElement();
        top.focus()
    }
    
    self.run = () => {
        //self.setTimeout(15);
        console.log('run() called');
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(self.entry.url);
        console.log('run() id', id, self.entry.url);
        ytdl.getInfo(id, (err, info) => {
            if (err){
                self.error = true;
                self.trigger('error')
                throw err;
            } else {
                console.log('YT Info', info);
                for(var i=0;i<info.formats.length;i++){
                    if(info.formats[i].type.match('mp4.*,')){ // mp4 including audio
                        self.endpoint = info.formats[i].url;
                        self.ctype = info.formats[i].type;
                        self.started = true;
                        self.trigger('start');
                        return;
                        break;
                    }
                }
                console.error('no compatible formats', info);
                self.error = true;
                self.trigger('error')
            }
        })
    }

    self.destroy = () => {
        clearInterval(self.progressTimer);
        self.events = [];
        self.ended = true;
        self.attached = self.videoElement = false;  
    }

    var uid = (new Date()).getTime();
    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options)
    }
    
    return self;

}

var currentScaleMode = 0, scaleModes = ['16:9', '4:3', '16:10'];
function changeScaleMode(){
    if(top.PlaybackManager.activeIntent){
        var v = top.PlaybackManager.activeIntent.videoElement;
        if(v){
            currentScaleMode++;
            if(currentScaleMode >= scaleModes.length){
                currentScaleMode = 0;
            }
            top.PlaybackManager.setRatio(scaleModes[currentScaleMode]);
            notify('Scale: '+scaleModes[currentScaleMode], 'fa-expand', 'short')
        }
    }
}

function scaleModeAsInt(scaleMode){
    var n = scaleMode.split(':');
    return parseInt(n[0]) / parseInt(n[1])
}

//var videojs = require('video.js');
// ? global.videojs = window.videojs = videojs; // https://github.com/videojs/videojs-contrib-hls/issues/636
// ? videojs.Hls = require('videojs-contrib-hls');
// require('videojs-contrib-hls'); // gaving up of setup video.js with require :(

function NativePlayURL(dest, mimetype, started, ended, error, paused) {
    showPlayers(true, false);
    if(!mimetype){
        mimetype = 'application/x-mpegURL';
    }
    console.log('WAITREADY');
    var pl = getFrame('player');
    pl.src(dest, mimetype);
    pl.player.ready(() => {
        var ap = false, v = jQuery(pl.document.querySelector('video'));
        if(v){
            if(started){
                console.log('STARTED', ap, paused);
                if(!ap && paused){
                    top.automaticallyPaused = ap = true;
                    setTimeout(() => {
                        //if(top.automaticallyPaused){
                            console.log('PAUSING', top.automaticallyPaused);
                            PlaybackManager.pause() // use PlaybackManager to trigger the notifies from createMagnetIntent
                        //}
                    }, 400)
                }
                v.off('play').on('play', started)
            }
            if(error){
                v.off('error').on('error', error)
            }
            if(ended){
                v.off('ended').on('ended', ended)
            }
        }
        leavePendingState()
    })
}

function NativeStop() {
    var pl = getFrame('player');
    pl.stop()
}

var TSWrapperInstance, TSWrapperCaching = {};

function getTSWrapper(){
    if(!TSWrapperInstance){
        var debug = true, proxify = false, port = 0, iterator = 0, prx = getHLSProxy();
        if(typeof(http)=='undefined'){
            http = require('http')
        }
        TSWrapperInstance = http.createServer(function (_request, _response) {
            if(debug){
                console.log('request starting...', _request);
            }
            var headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            }
            var url = _request.url.split('#')[0].replace('.m3u8', '.ts'), request = _request, response = _response;
            var originalUrl = url;
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://')
            }
            if(url.indexOf('crossdomain.xml')!=-1){
                headers['Content-Type']  = 'text/xml';
                response.writeHead(200, headers);
                response.write("<?xml version=\"1.0\"?>\r\n<!-- http://www.osmf.org/crossdomain.xml -->\r\n<!DOCTYPE cross-domain-policy SYSTEM \"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd\">\r\n<cross-domain-policy>\r\n<allow-access-from domain=\"*\" secure=\"false\"/>\r\n<allow-http-request-headers-from secure=\"false\" headers=\"*\" domain=\"*\"/>\r\n</cross-domain-policy>");
                response.end();
                return;
            }
            if(url.charAt(0)=='/'){
                url = "http:/"+url;
            }
            var code = 200;
            if(typeof(TSWrapperCaching[originalUrl])!='undefined' && (time() - TSWrapperCaching[originalUrl].time) <= 3){
                response.writeHead(code, headers);
                response.write(TSWrapperCaching[originalUrl], 'binary');
                response.end();
            }
            if(proxify){
                url = prx.getURL(url);
            }
            if(debug){
                console.log('serving', url, originalUrl)
            }
            if(url.indexOf('?')==-1){
                url += '?t='+time();
            }
            var buffer = "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:"+iterator+"\n#EXT-X-DISCONTINUITY-SEQUENCE:"+iterator+"\n#EXT-X-DISCONTINUITY\n#EXTINF:0,\n" + url;
            console.log('served', buffer);
            response.writeHead(200, headers);
            response.write(buffer, 'utf8');
            response.end();
            TSWrapperCaching[originalUrl] = {time: time(), content: buffer};
            TSWrapperCaching = sliceObject(TSWrapperCaching, -6);
            iterator++;
            buffer = null;
        }).listen(prx.address().port + 2);
        TSWrapperInstance.getURL = function (url){
            if(!port){
                port = TSWrapperInstance.address().port;
            }
            var match = url.match(new RegExp('127\\.0\\.0\\.1:([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+port+'/');
            } else {
                url = url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
            }
            url = url.replace('.ts', '.m3u8');
            return url;
        }
    }
    return TSWrapperInstance;
}

var HLSProxyInstance, HLSProxyCaching = {};

function getHLSProxy(){
    if(!HLSProxyInstance){
        var debug = true, port = 0;
        if(typeof(http)=='undefined'){
            http = require('http')
        }
        HLSProxyInstance = http.createServer(function (_request, _response) {
            if(debug){
                console.log('request starting...', _request);
            }
            var headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            }
            var url = _request.url.split('#')[0], request = _request, response = _response;
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://');
            }
            if(url.indexOf('crossdomain.xml')!=-1){
                headers['Content-Type']  = 'text/xml';
                response.writeHead(200, headers);
                response.write("<?xml version=\"1.0\"?>\r\n<!-- http://www.osmf.org/crossdomain.xml -->\r\n<!DOCTYPE cross-domain-policy SYSTEM \"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd\">\r\n<cross-domain-policy>\r\n<allow-access-from domain=\"*\" secure=\"false\"/>\r\n<allow-http-request-headers-from secure=\"false\" headers=\"*\" domain=\"*\"/>\r\n</cross-domain-policy>");
                response.end();
                return;
            }
            if(url.charAt(0)=='/'){
                url = "http:/"+url;
            }
            if(debug){
                console.log('serving', url);
            }
            var code = 200;
            if(HLSProxyCaching !== false && typeof(HLSProxyCaching[url])!='undefined' && (time() - HLSProxyCaching[url].time) <= 3){
                response.writeHead(code, headers);
                response.write(HLSProxyCaching[url], 'binary');
                response.end();
            }
            var fetchOpts = {
                redirect: 'follow'
            }
            if(getExt(url) == 'ts'){
                if(debug){
                    console.log('start fetching...')
                }
                fetch(url, fetchOpts).then(function (res){
                    code = res.status;
                    headers['Content-Type'] = 'video/MP2T';
                    if(debug){
                        console.log('received')
                    }
                    if(res.url && res.url != url) {
                        code = 302;
                        headers['Location'] = HLSProxyInstance.getURL(res.url);
                        if(debug){
                            console.log('location: '+headers['Location']);
                        }
                        return '';
                    }
                    if(debug){
                        console.log('response buffer')
                    }
                    setTimeout(() => null, 0); 
                    var v = res.arrayBuffer();
                    console.log(typeof(v), v)
                    return v;
                }).then(function (buffer){
                    if(debug){
                        console.log('responding', buffer);
                    }
                    buffer = Buffer.from(new Uint8Array(buffer));
                    if(HLSProxyCaching !== false){
                        HLSProxyCaching[url] = {time: time(), content: buffer};
                        HLSProxyCaching = sliceObject(HLSProxyCaching, -6)
                    }
                    response.writeHead(code, headers);
                    response.write(buffer, 'binary');
                    response.end();
                    if(debug){
                        console.log('fine.')
                    }
                    doAction('media-received', url, buffer);
                    buffer = null;
                }).catch(function (err){
                    if(debug){
                        console.error('error', err);
                    }
                    response.writeHead(404, { 
                        'Cache-Control': 'no-cache' 
                    });
                    response.end();
                })
            } else {
                fetch(url, fetchOpts).then(function (res){
                    code = res.status;
                    headers['Content-Type'] = 'application/x-mpegURL';
                    if(res.url && res.url != url) {
                        code = 302;
                        headers['Location'] = HLSProxyInstance.getURL(res.url);
                        return '';
                    }
                    for (var pair of res.headers.entries()) {
                        switch(pair[0]){
                            case 'content-type':
                                headers['Content-Type'] = pair[1];
                                break;
                            case 'content-length':
                                headers['Content-Length'] = pair[1];
                                break;
                        }
                    }
                    return res.text()
                }).then(function (content){
                    if(debug){
                        console.log('responding');
                    }
                    if(content.substr(0, 192).indexOf('#EXT')!=-1){ // really is m3u8
                        //if(content.indexOf('.ts')!=-1){
                            // stuff below was causing errors, dont remember why I've put that here
                            //var entries = content.split('#EXTINF');
                            //if(entries.length > 5){
                            //    content = [entries[0].replace(new RegExp('#EXT\-X\-MEDIA\-SEQUENCE[^\r\n]+[\r\n]+', 'mi'), '')].concat(entries.slice(-5)).join('#EXTINF');
                            //}
                        //}
                        var matches = content.match(new RegExp('https?://[^\r\n ]', 'gi'));
                        if(matches){
                            for(var i=0; i<matches.length; i++){
                                content = content.replaceAll(matches[i], HLSProxyInstance.getURL(matches[i]))
                            }
                        }
                    }
                    if(debug){
                        console.log('headers', headers);
                    }
                    response.writeHead(code, headers);
                    response.write(content);
                    response.end();
                    content = null;
                }).catch(function (err){
                    if(debug){
                        console.error('error', err);
                    }
                    response.writeHead(404, { 
                        'Cache-Control': 'no-cache' 
                    });
                    response.end();
                })
            }
        }).listen();
        HLSProxyInstance.getURL = function (url){
            if(!port){
                port = HLSProxyInstance.address().port;
            }
            var match = url.match(new RegExp('127\\.0\\.0\\.1:([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+port+'/');
            } else {
                url = url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
            }
            return url;
        }
    }
    return HLSProxyInstance;
}

function waitFileExistsTimeout(file, callback, timeout, startedAt) {
    if(typeof(startedAt)=='undefined'){
        startedAt = time();
    }
	fs.stat(file, function(err, stat) {
		if (err == null) {
			callback(true);
		} else if((time() - startedAt) >= timeout) {
			callback(false);
        }
		else {
			setTimeout(() => {
				waitFileExistsTimeout(file, callback, timeout, startedAt);
			}, 250);
		}
	});
}

function waitInstanceFileExistsTimeout(self, callback, timeout, startedAt) {
    if(typeof(startedAt)=='undefined'){
        startedAt = time();
    }
    //console.log('WAIT', self);
    if(typeof(self.instance.file)=='string'){
        fs.stat(self.instance.file, function(err, stat) {
            if (err == null) {
                callback(true);
            } else if((time() - startedAt) >= timeout) {
                callback(false);
            } else if(self.ended || self.error) {
                console.log('waitInstanceFileExistsTimeout discarded.');
            }
            else {
                setTimeout(() => {
                    waitInstanceFileExistsTimeout(self, callback, timeout, startedAt);
                }, 250);
            }
        })
    }
}

function onIntentCommit(intent){
    console.log('ONINTENTCOMM');
    setTitleData(intent.entry.name, intent.entry.logo);
    var c = getFrame('controls');
    if(c){
        console.log('ONINTENTCOMM', intent.entry);
        var entries = c.findEntries(intent.entry.url);
        console.log('ONINTENTCOMM', intent.entry);
        c.unregisterOfflineStream(intent.entry, true); // this already update entries flags
        console.log('ONINTENTCOMM', intent.entry);
        c.History.add(intent.entry);
        console.log('ONINTENTCOMM', intent.entry, c.History);
        c.updateStreamEntriesFlags()
    }
    notify(intent.entry.name, 'fa-play', 'short');
}

function unfocus(e){ // unfocus from sandbox frame to catch keypresses
    var target = e.srcElement;
    if(!target || typeof(target['tagName'])=='undefined' || ['input', 'textarea'].indexOf(target['tagName'].toLowerCase())==-1){
        //console.log(e);
        console.log('REFOCUS(*)');
        top.focus()
    }
}

function defaultFrameDragOver(e){
    e.preventDefault(); 
    top.ondragover(e);
    return false;
}

function patchFrameWindowEvents(frameWindow){    
    if(frameWindow && frameWindow.document && frameWindow.ondragover != defaultFrameDragOver){
        frameWindow.ondragover = defaultFrameDragOver;
        createMouseObserverForControls(frameWindow);
        frameWindow.document.addEventListener('keydown', (e) => { // forward keyboard to top where the hotkeys are registered
            if(!e.target || !e.target.tagName || ['input', 'textarea'].indexOf(e.target.tagName.toLowerCase())==-1){ // skip text inputs
                var n = e.originalEvent;
                setTimeout(() => {
                    try {
                        top.document.dispatchEvent(n)  
                    } catch(e) {}
                }, 10)
            }
        });
        frameWindow.document.addEventListener('mouseup', unfocus);
        frameWindow.document.addEventListener('click', (e) => {
            setTimeout(() => {unfocus(e)}, 400)
        });
        frameWindow.ondrop = function(e) { e.preventDefault(); return false };
    }
}

function unloadFrames(){
    Array.from(document.getElementsByTagName('iframe')).forEach((frame) => {
        frame.src = 'about:blank';
    })
}

function delayedPlayPauseNotify(){
    setTimeout(() => {
        playPauseNotify()
    }, 250)
    setTimeout(() => {
        playPauseNotify()
    }, 1000)
}

function shouldNotifyPlaybackError(intent){
    console.log('SHOULD', intent);
    if(typeof(intent.manual)!='undefined' && intent.manual){
        var url = intent.entry.originalUrl;
        for(var i=0; i<PlaybackManager.intents.length; i++){
            if(PlaybackManager.intents[i].entry.originalUrl == url && !PlaybackManager.intents[i].error && !PlaybackManager.intents[i].ended){
                return false;
            }
        }
        return true;
    }
    return false;
}

PlaybackManager.on('play', delayedPlayPauseNotify);
PlaybackManager.on('pause', delayedPlayPauseNotify);
PlaybackManager.on('register', function (intent, entry){
    intent.on('error', () => {
        setTimeout(() => {
            if(shouldNotifyPlaybackError(intent)){ // don't alert user if has concurrent intents loading
                notify(Lang.PLAY_STREAM_FAILURE.format(intent.entry.name), 'fa-exclamation-circle', 'normal');
                console.log('STREAM FAILED', intent.entry.originalUrl, PlaybackManager.log());
                var c = getFrame('controls');
                if(c){
                    c.registerOfflineStream(intent.entry, true);
                    sendStats('error', c.sendStatsPrepareEntry(intent.entry))
                } else {
                    sendStats('error', intent.entry)
                }
            }
        }, 200)
    })
})
PlaybackManager.on('commit', function (intent, entry){
    console.log('COMMIT TRIGGERED');
    var c = getFrame('controls');
    if(c){
        c.unregisterOfflineStream(intent.entry, true);
    }
    onIntentCommit(intent);
    intent.on('ended', () => {
        // end of stream, go next
        var c = getFrame('controls');
        if(!isLive(intent.entry.url)){
            var next = getNextStream();
            if(c && next){
                setTimeout(() => {
                    c.playEntry(next)
                }, 1200)
            } else {
                stop()
            }
        }
    })
    delayedPlayPauseNotify();
    var c = getFrame('controls');
    if(c){
        sendStats('alive', c.sendStatsPrepareEntry(entry))
    } else {
        sendStats('alive', entry)
    }
    if(intent.type != 'magnet'){
        setTimeout(() => {
            PlaybackManager.play();
            hideControls()
        }, 1000)
    }
});
PlaybackManager.on('stop', () => {
    delayedPlayPauseNotify();
    setTimeout(() => {
        if(!PlaybackManager.intents.length){
            stop(true)
        }
        delayedPlayPauseNotify();
        var c = getFrame('controls');
        if(c){
            c.updateStreamEntriesFlags()
        }
    }, 1000);
    sendStats('stop')
});
PlaybackManager.on('load-in', () => {
    var title, intents = PlaybackManager.query({started: false, ended: false, error: false, sideload: false});
    if(intents.length){
        title = Lang.CONNECTING.replaceAll('.', '').trim()+': '+(decodeURIComponent(intents[0].entry.name)||intents[0].entry.name);
    } else {
        title = Lang.CONNECTING;
    }
    enterPendingState(title)
});
PlaybackManager.on('load-out', leavePendingState);

jQuery(window).on('beforeunload', () => {
    removeFolder('stream', false);
    stop();
    unloadFrames()
});
