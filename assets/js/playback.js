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
        intentTypesPriorityOrder: ['magnet', 'direct', 'ffmpeg', 'frame']
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
    self.checkIntents = () => {
        var activeIntent = self.activeIntent, loading = false, intents = self.query({started: true, error: false, ended: false});
        for(var i=0; i<intents.length; i++){
            if(intents[i] != activeIntent){
                if(!activeIntent || intents[i].ctime > activeIntent.ctime){
                    activeIntent = intents[i];
                }
            }
        }
        if(activeIntent){
            if(activeIntent && activeIntent != self.activeIntent){
                self.commitIntent(activeIntent);
                self.trigger('load-out')
            } else if(!intents.length && self.activeIntent) {
                self.activeIntent = false;
                self.stop()
            }
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
        for(var i=0; i<self.intents.length; i++){
            self.destroyIntent(self.intents[i])
        }
        self.intents = [];
        self.activeIntent = false;
        if(self.wasLoading){
            self.wasLoading = false;
            console.log('load-out')
            self.trigger('load-out');
        }
        self.trigger('stop');
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
        console.log('DESTROYING', self.intents[i]);
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
            self.trigger('commit', intent, intent.entry)
            console.log('COMMITING OK', self.intents);
        } else {
            console.log('COMMITING - Already committed.')
        }
        self.lastCommitTime = time()
    }
    return self;
})();

function createPlayIntentAsync(entry, options, callback){
    console.log('CREATE INTENT', entry, traceback());
    var initTime = time(), FFmpegIntentsLimit = 8;
    var currentPlaybackType = '', currentPlaybackTypePriotity = -1;
    if(PlaybackManager.activeIntent && PlaybackManager.activeIntent.entry.originalUrl == (entry.originalUrl || entry.url)){
        currentPlaybackType = PlaybackManager.activeIntent.type;
        currentPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(currentPlaybackType); // less is higher
    }
    var internalCallback = (intent) => {
        if(intent){
            PlaybackManager.registerIntent(intent);
            if(callback){
                callback(intent) // before run() to allow setup any event callbacks
            }
            //console.log('INTERNAL', intent, traceback());
            intent.run()
        } else {
            console.log('Error: NO INTENT', intent, entry.url);
        }
    }
    if(typeof(entry.originalUrl) == 'undefined'){
        entry.originalUrl = entry.url;
    }
    if(isMagnet(entry.url)){
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['magnet'] < currentPlaybackTypePriotity){
            internalCallback(createMagnetIntent(entry, options))
        }
    } else if(isRTMP(entry.url)){
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            internalCallback(createFFmpegIntent(entry, options))
        }
    } else if(isHTML5Video(entry.url) || isM3U8(entry.url)){
        console.log('AAA');
        var isTS = getExt(entry.url) == 'ts';
        if(!isTS && (currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['direct'] < currentPlaybackTypePriotity)){
            internalCallback(createDirectIntent(entry, options))
        }
        if(isTS || currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            if(isTS || PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                internalCallback(createFFmpegIntent(entry, options))
            }
        }
    } else if(isMedia(entry.url)){
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            internalCallback(createFFmpegIntent(entry, options))
        }
    } else  {
        console.log('BBB');
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['frame'] < currentPlaybackTypePriotity){
            if(!options || !options.sideload){
                internalCallback(createFrameIntent(entry, options))
            }
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['direct'] < currentPlaybackTypePriotity){
            internalCallback(createDirectIntent(entry, options)); // not sure, so we'll race the possible intents
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder['ffmpeg'] < currentPlaybackTypePriotity){
            if(PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                internalCallback(createFFmpegIntent(entry, options)); // not sure, so we'll race the possible intents
            }
        }
    }
}

function createBaseIntent(){

    var self = {};
    self.type = 'base';
    self.top = top; // reference for listeners
    self.sideload = false;
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

    self.trigger = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(self.events[action] instanceof Array){
            console.log(action);
            console.log(self.events[action]);
            console.log(self.events[action].length);
            for(var i=0; self.events[action] && i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(self.events[action] instanceof Array){
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
            self.controller.play()
        }
    }

    self.pause = () => {
        if(self.controller){
            self.controller.pause()
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
            self.timeout = setTimeout(() => {
                if(!self.committed && !self.started && !self.error && !self.ended){
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
    self.fittedElement = false;
    self.fittedScope = false;
    
    self.frame = document.createElement('iframe');
    self.frame.className = "fit-screen hide"; 
    self.frame.nwdisable = true;
    self.frame.nwfaketop = true;
    self.frame.height = "100%";
    self.frame.onload = () => {
        self.loaded = true;
    }
    
    self.run = () => {
        self.setTimeout(20);
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
                if(result){
                    self.started = true;
                    console.log('runFitter SUCCESS', result);
                    self.fittedElement = self.videoElement = result.element;
                    self.fittedScope = result.scope;
                    self.patchVideo();
                    self.trigger('start');
                }
            }
        }
        return self.started;
    }
      
    self.commit = () => {
        NativeStop();
        jQuery(top.window.document).find('#sandbox').remove();
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
        self.frame.src = 'about:blank';
        jQuery(self.frame).remove();
        delete self.frame;
        self.ended = true;
        self.attached = self.videoElement = false;        
    }


    self.play = () => {
        if(self.getVideo()){
            if(self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.play()
            } else {

            }
        }
    }

    self.pause = () => {
        if(self.getVideo()){
            if(self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.pause()
            } else {

            }
        }
    }
    
    self.seek = (secs) => {
        if(self.getVideo()){
            if(self.videoElement.currentSrc.indexOf('blob:')==-1){
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
            var paused, f = function (e){
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
            jQuery(self.videoElement).
                on('play', f).
                on('pause', f).
                on('click', function (e){
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }).
                on('mousedown', function (e){
                    e.preventDefault();
                    e.stopPropagation();
                    console.log('FRAME VIDEO MOUSEDOWN');
                    paused = !self.top.PlaybackManager.playing();
                    console.log('PLAYING *', paused, self.top);
                    return false;
                }).
                on('mouseup', function (e){
                    if(paused){
                        self.top.PlaybackManager.play()
                    } else {
                        self.top.PlaybackManager.pause()
                    }
                    paused = !self.top.PlaybackManager.playing();
                    console.log('PLAYING **', paused);
                    console.log('OK', paused, self.top);
                    self.top.delayedPlayPauseNotify();
                    return false;
                })
        }
    }

    if(options){
        self.apply(options)
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
    
    self.run = () => {
        self.setTimeout(15);
        self.prxurl = self.entry.url;
        if(self.prxurl.match(new RegExp('(https?://).*m3u8'))){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
            self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';
        } else {
            self.mimetype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        }
        var p = getFrame('testing-player');
        if(!p || !p.test){
            throw 'No iframe#testing-player found.';
        }
        console.log('Testing', self.prxurl, self.entry.url, self, traceback());
        p.test(self.prxurl, self.mimetype, () => {
            console.log('Test succeeded. '+self.prxurl);
            self.started = true;
            self.trigger('start')
        }, () => {
            console.log('Test Failed. '+self.prxurl);
            self.error = true;
            self.trigger('error')
        });
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
    self.transcode = !!entry['transcode'];
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.type = 'ffmpeg';
    self.entry = entry;
    self.folder = '';
    self.prxurl = false;
    self.prx = false;

    self.killFFmpeg = () => {
        if(self.instance){
            self.instance.kill();
            if (self.instance.file) {
                removeFolder(dirname(self.instance.file), true);
            }
            self.instance = false;
        }
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
        self.events = [];
        self.killFFmpeg();
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    self.run = () => {
        var uid = (new Date()).getTime();
        self.setTimeout(30);
        self.prxurl = self.entry.url;
        if(self.prxurl.match(new RegExp('(https?://).*m3u8'))){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        }
        self.instance = ffmpeg(self.prxurl).
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
            format('hls');
    
        if(self.transcode){
            self.instance.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast');
        }
    
        // setup event handlers
        self.instance.
        on('end', function() {
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

    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    self.on('error', self.killFFmpeg);
    self.on('ended', self.killFFmpeg);

    if(options){
        self.apply(options)
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
        
    self.commit = () => {
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
        jQuery('#player').removeClass('hide').addClass('show');
        self.committed = true;
        self.attached = true;
        self.controller = getFrame('player');
        self.videoElement = self.controller.videoElement();
        top.focus()
    }

    self.notifyStart = () => {
        if(!self.notify){
            self.notify = notify(Lang.TORRENT_SLOW_START, 'fa-magnet', 'sticky');
        } else {
            self.notify.text();
        }
    }
    
    self.run = () => {
        //self.setTimeout(15);
        self.notify = notify(Lang.TORRENT_SLOW_START, 'fa-magnet', 'sticky');
        console.log('run() called');
        self.waiting = true;
        if(self.endpoint){
            console.log('About to stream...');
            self.stream()
        }
    }

    self.destroy = () => {
        self.peerflix.destroy();
        self.events = [];
        self.instance.kill();
        if (self.instance.file) {
            removeFolder(dirname(self.instance.file), true);
        }
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    self.stream = () => {
        self.started = true;
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
        on('end', function() {
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

    if(!peerflix){
        peerflix = require('peerflix')
    }
    self.peerflix = peerflix(self.entry.url, {tmp:'torrent'});
    self.peerflix.server.on('listening', function() {
        self.endpoint = 'http://127.0.0.1:' +  self.peerflix.server.address().port + '/';
        self.stream()
    });

    var uid = (new Date()).getTime();
    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        self.apply(options)
    }
    
    return self;

}

//var videojs = require('video.js');
// ? global.videojs = window.videojs = videojs; // https://github.com/videojs/videojs-contrib-hls/issues/636
// ? videojs.Hls = require('videojs-contrib-hls');
// require('videojs-contrib-hls'); // gaving up of setup video.js with require :(

function NativePlayURL(dest, mimetype, started, ended, error) {
    showPlayers(true, false);
    if(!mimetype){
        mimetype = 'application/x-mpegURL';
    }
    console.log('WAITREADY');
    var pl = getFrame('player');
    pl.src(dest, mimetype);
    pl.player.ready(() => {
        var v = jQuery(pl.document.querySelector('video'));
        if(v){
            if(started){
                v.off('play').on('play', started)
            }
            if(error){
                v.off('error').on('error', error)
            }
            if(ended){
                v.off('ended').on('ended', ended)
            }
        }
        pl.play();
        leavePendingState()
    })
}

function NativeStop(dest) {
    var pl = getFrame('player');
    pl.stop()
}

var HLSProxyInstance;

function getHLSProxy(){
    if(!HLSProxyInstance){
        var debug = false, port = 0;
        if(typeof(http)=='undefined'){
            http = require('http')
        }
        HLSProxyInstance = http.createServer(function (_request, _response) {
            if(debug){
                console.log('request starting...');
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
            var fetchOpts = {
                redirect: 'follow'
            }
            var code = 200;
            if(getExt(url) == 'ts'){
                fetch(url, fetchOpts).then(function (res){
                    code = res.status;
                    headers['Content-Type'] = 'video/MP2T';
                    if(res.url && res.url != url) {
                        code = 302;
                        headers['Location'] = HLSProxyInstance.getURL(res.url);
                        return '';
                    }
                    return res.arrayBuffer();
                }).then(function (buffer){
                    if(debug){
                        console.log('responding', buffer);
                    }
                    buffer = Buffer.from(new Uint8Array(buffer));
                    response.writeHead(code, headers);
                    response.write(buffer, 'binary');
                    response.end();
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
                        if(content.indexOf('.ts')!=-1){
                            var entries = content.split('#EXTINF');
                            if(entries.length > 5){
                                content = [entries[0].replace(new RegExp('#EXT\-X\-MEDIA\-SEQUENCE[^\r\n]+[\r\n]+', 'mi'), '')].concat(entries.slice(-5)).join('#EXTINF');
                            }
                        }
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

var pendingStateTimer = 0;

function enterPendingState() {
	setTitleFlag('fa-circle-o-notch fa-spin');
    notify(Lang.LOADING, 'fa-circle-o-notch fa-spin', 'short');
}

function leavePendingState() {
	setTitleFlag('');
	getFrame('controls').removeLoadingFlags()
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
			setTimeout(function() {
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
                setTimeout(function() {
                    waitInstanceFileExistsTimeout(self, callback, timeout, startedAt);
                }, 250);
            }
        })
    }
}

function onIntentCommit(intent){
    setTitleData(intent.entry.name, intent.entry.logo);
    var c = getFrame('controls');
    if(c){
        var entries = c.findEntries(intent.entry.url);
        c.unregisterOfflineStream(intent.entry); // this already update entries flags
        c.History.add(intent.entry);
        c.updateStreamEntriesFlags()
    }
    notify(intent.entry.name, 'fa-play', 'short');
}

function unfocus(e){ // unfocus from sandbox frame to catch keypresses
    var target = e.srcElement;
    if(!target || typeof(target['tagName'])=='undefined' || ['input', 'textarea'].indexOf(target['tagName'].toLowerCase())==-1){
        //console.log(e);
        console.log('REFOCUS(*)');
        top.window.focus()
    }
}

function defaultFrameDragOver(e){
    e.preventDefault(); 
    top.window.ondragover(e);
    return false;
}

function patchFrameWindowEvents(frameWindow){    
    if(frameWindow && frameWindow.document && frameWindow.ondragover != defaultFrameDragOver){
        frameWindow.ondragover = defaultFrameDragOver;
        createMouseObserverForControls(frameWindow);
        frameWindow.document.addEventListener('mouseup', unfocus);
        frameWindow.document.addEventListener('click', function (e){
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
    var url = intent.entry.originalUrl;
    for(var i=0; i<PlaybackManager.intents.length; i++){
        if(PlaybackManager.intents[i].entry.originalUrl == url && !PlaybackManager.intents[i].error && !PlaybackManager.intents[i].ended){
            return false;
        }
    }
    return true;
}

PlaybackManager.on('play', delayedPlayPauseNotify);
PlaybackManager.on('pause', delayedPlayPauseNotify);
PlaybackManager.on('register', function (intent, entry){
    intent.on('error', () => {
        setTimeout(() => {
            if(shouldNotifyPlaybackError(intent)){ // don't alert user if has sideload intents
                notify(Lang.PLAY_STREAM_FAILURE.format(intent.entry.name), 'fa-exclamation-circle', 'normal');
                console.log('STREAM FAILED', intent.entry.originalUrl, PlaybackManager.log())
            }
        }, 200)
    })
})
PlaybackManager.on('commit', function (intent, entry){
    console.log('COMMIT TRIGGERED')
    onIntentCommit(intent);
    intent.on('error', () => {
        setTimeout(() => {
            if(shouldNotifyPlaybackError(intent)){ // don't alert user if has sideload intents
                notify(Lang.PLAY_STREAM_FAILURE.format(intent.entry.name), 'fa-exclamation-circle', 'normal');
                console.log('STREAM FAILED', intent.entry.originalUrl, PlaybackManager.log());
                sendStats('error', intent.entry)
            }
        }, 200)
    })
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
    sendStats('alive', entry)
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
PlaybackManager.on('load-in', enterPendingState);
PlaybackManager.on('load-out', leavePendingState);

jQuery(window).on('beforeunload', () => {
    removeFolder('stream', false);
    stop();
    unloadFrames()
});
