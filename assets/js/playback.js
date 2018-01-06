
var fs = require('fs'), os = require('os'), async = require('async'), ffmpeg = require('fluent-ffmpeg'), peerflix;

var isPlaying = false;
var clapprPlayer = false;
var cpuCount = os.cpus().length;

ffmpeg.setFfmpegPath('ffmpeg/ffmpeg');

var PlaybackManager = {
    events: [],
    intents: [],
    wasLoading: false,
    activeIntent: false,
    lastCommitTime: 0,
    on: function (action, callback){ // register, commit
        if(typeof(this.events[action])=='undefined'){
            this.events[action] = [];
        }
        this.events[action].push(callback)
    },
    trigger: function (action){
        doAction(action, this.activeIntent, this);
        if(typeof(this.events[action])!='undefined'){
            var _args = Array.from(arguments).slice(1);
            for(var i=0; i<this.events[action].length; i++){
                this.events[action][i].apply(null, _args)
            }
        }
    },
    data: function (){
        if(this.activeIntent){
            return this.activeIntent.entry;
        }
    },
    checkIntents: function (){
        var activeIntent = this.activeIntent, loading = false, intents = this.query({started: true, error: false, ended: false});
        for(var i=0; i<intents.length; i++){
            if(intents[i] != activeIntent){
                if(!activeIntent || intents[i].ctime > activeIntent.ctime){
                    activeIntent = intents[i];
                }
            }
        }
        if(activeIntent){
            if(activeIntent && activeIntent != this.activeIntent){
                this.commitIntent(activeIntent);
                this.trigger('load-out')
            } else if(!intents.length && this.activeIntent) {
                this.activeIntent = false;
                this.stop()
            }
        }
        var was = this.wasLoading, isLoading = this.isLoading();
        if(isLoading){
            setTimeout(this.checkIntents.bind(this), 2000)
        }
        //console.log('ACTIVE', activeIntent, was, isLoading, intents);
    },
    registerIntent: function (intent){
        console.log('REGISTER INTENT', intent, traceback());
        if(this.intents.indexOf(intent)==-1){
            this.intents.push(intent)
        }
        intent.on('start', this.checkIntents.bind(this));
        intent.on('error', this.checkIntents.bind(this));
        intent.on('ended', function (){
            console.log('INTENT ENDED');
            setTimeout(PlaybackManager.checkIntents.bind(PlaybackManager), 1000)
        });
        this.checkIntents();
        this.trigger('register', intent)      
        if(intent.ended){
            intent.trigger('ended')
        } else if(intent.error){
            intent.trigger('error')
        }
    },
    query: function (filter){ // object
        var results = [];
        for(var i=0; i<this.intents.length; i++){
            ok = true;
            for(var key in filter){
                if(!this.intents[i] || typeof(this.intents[i][key])=='undefined' || this.intents[i][key] != filter[key]){
                    ok = false;
                    break;
                }
            }
            if(ok){
                results.push(this.intents[i])
            }
        }
        return results;
    },
    play: function (){
        if(this.activeIntent){
            var r = this.activeIntent.play();
            this.trigger('play');
            return r;
        }
    },
    pause: function (){
        if(this.activeIntent){
            var r = this.activeIntent.pause();
            this.trigger('pause');
            return r;
        }
    },
    playing: function (){
        if(this.activeIntent){
            return this.activeIntent.playing()
        }
    },
    seek: function (secs){
        if(this.activeIntent){
            var r = this.activeIntent.seek(secs);
            this.trigger('seek');
            return r;
        }
    },
    stop: function (){
        for(var i=0; i<this.intents.length; i++){
            try{
                this.intents[i].destroy()
            } catch(e) {}
        }
        this.intents = [];
        this.activeIntent = false;
        if(this.wasLoading){
            this.wasLoading = false;
            console.log('load-out')
            this.trigger('load-out');
        }
        this.trigger('stop')
    },
    getURL: function (){
        if(this.activeIntent){
            return this.activeIntent.entry.originalUrl || this.activeIntent.entry.url;
        }
    },
    runFitter: function (){ // frames only
        console.log('PlaybackManager.runFitter()');
        var aliveIntents = this.query({type: 'frame'});
        for(var i=0; i<aliveIntents.length; i++){
            aliveIntents[i].runFitter()
        }
    },
    isLoading: function (fetch){
        var loadingIntents;
        if(typeof(fetch)=='string'){
            loadingIntents = this.query({originalUrl: fetch, ended: false, error: false});
            return loadingIntents.length > 0;
        }
        var is = false, urls = [];
        loadingIntents = this.query({started: false, ended: false, error: false, sideload: false});
        if(fetch === true){
            for(var i=0; i<loadingIntents.length; i++){
                urls.push(loadingIntents[i].entry.url)
            }
            is = urls.length ? urls : [];
        } else {
            is = loadingIntents.length > 0;
        }
        if(this.wasLoading != is){
            console.log('LOADCHANGE');
            this.wasLoading = !!is;
            console.log(is ? 'load-in' : 'load-out')
            this.trigger(is ? 'load-in' : 'load-out')
        }
        return is;
    },
    log: function (){
        var _log = '', state;
        for(var i=0; i<this.intents.length; i++){
            state = 'unknown';
            if(this.intents[i].started){
                state = 'started';
            } else {
                if(!this.intents[i].ended && !this.intents[i].error){
                    state = 'loading';
                } else if(this.intents[i].ended){
                    state = 'ended';
                } else {
                    state = 'error';
                }
            }
            if(this.intents[i] == this.activeIntent){
                state += ' active';
            }
            if(this.intents[i].sideload){
                state = 'sideload '+state;
            }
            _log += this.intents[i].entry.url;
            if(this.intents[i].entry.url != this.intents[i].entry.originalUrl){
                _log += " (from "+this.intents[i].entry.originalUrl+")";
            }
            _log += " ("+this.intents[i].type+", "+state+")\r\n";
        }
        return _log;
    },
    hasURL: function (url){
        for(var i=0; i<this.intents.length; i++){
            if(this.intents[i].entry.url == url || this.intents[i].entry.originalUrl == url){
                return true;
                break;
            }
        }
    },
    commitIntent: function (intent){
        var intentTypesPriorityOrder = ['magnet', 'direct', 'ffmpeg', 'frame'];
        console.log('COMMITING', intent, this.activeIntent, traceback());
        if(this.activeIntent != intent){
            if(this.activeIntent){
                if(this.activeIntent.entry.originalUrl == intent.entry.originalUrl){ // both are intents from the same stream, decide for one of them
                    var a = intentTypesPriorityOrder.indexOf(intent.entry.type);
                    var b = intentTypesPriorityOrder.indexOf(this.activeIntent.entry.type);
                    if(b <= a){
                        console.log('COMMITING DISCARD');
                        return false; // keep the current activeIntent
                    }
                }
            }
            var allow = true;
            allow = intent.filter('pre-commit', allow, intent, this.activeIntent);
            if(allow === false){
                console.log('COMMITING DISALLOWED');
                console.log('DESTROYING', this.intents[i]);
                try {
                    intent.destroy();
                } catch(e) {
                    console.log('INTENT DESTROY FAILURE', e)
                }
                var i = this.intents.indexOf(intent);
                if(i != -1){
                    delete this.intents[i];
                }
                return false; // commiting canceled, keep the current activeIntent
            }
            for(var i=0; i<this.intents.length; i++){
                if(this.intents[i] != intent){
                    if(!this.activeIntent || this.intents[i].ctime <= this.activeIntent.ctime){
                        // expired, discard it!
                        try{
                            console.log('DESTROYING', this.intents[i]);
                            var active = (this.activeIntent == this.intents[i]);
                            this.intents[i].destroy();
                            if(active){
                                this.trigger('uncommit', this.activeIntent, intent)
                            }
                        }catch(e){
                            console.log('INTENT DESTROY FAILURE', e)
                        }
                        delete this.intents[i];
                    }
                }
            }
            console.log('ACTIVE', intent);
            if(this.intents.indexOf(intent)==-1){
                this.registerIntent(intent);
            }
            this.activeIntent = intent;
            intent.commit();
            this.trigger('commit', intent, intent.entry)
            console.log('OK', this.intents);
        } else {
            console.log('Already committed.')
        }
        this.intents = this.intents.filter(function (item) {
            return item !== undefined;
        });
        this.lastCommitTime = time()
    }
}

function createPlayIntentAsync(entry, options, callback){
    console.log('CREATE INTENT', entry, traceback());
    var initTime = time();
    var internalCallback = function (intent){
        if(intent){
            PlaybackManager.registerIntent(intent);
            if(callback){
                callback(intent) // before run() to allow setup any event callbacks
            }
            intent.run()
        } else {
            console.log('Error: NO INTENT', intent, entry.url);
        }
    }
    if(typeof(entry.originalUrl) == 'undefined'){
        entry.originalUrl = entry.url;
    }
    if(isMagnet(entry.url)){
        internalCallback(createMagnetIntent(entry, options))
    } else if(isRTMP(entry.url)){
        internalCallback(createFFmpegIntent(entry, options))
    } else if(isHTML5Video(entry.url)){
        console.log('AAA');
        internalCallback(createDirectIntent(entry, options))
    } else if(isMedia(entry.url)){
        internalCallback(createFFmpegIntent(entry, options))
    } else  {
        console.log('BBB');
        if(!options || !options.sideload){
            internalCallback(createFrameIntent(entry, options))
        }
        internalCallback(createDirectIntent(entry, options)); // not sure, so we'll race the possible intents
        /*
        jQuery.ajax({
            url: entry.url,
            type: 'GET',
            timeout: 10000,
            success: function(res, status, xhr){
                if(initTime < PlaybackManager.lastCommitTime) return;
                var mimetype = xhr.getResponseHeader('Content-Type');
                if(!mimetype){
                    mimetype = (res.indexOf('<html>')==-1)?'video/mp4':'text/html';
                }
                console.log('MIMETYPE = '+mimetype);
                if(mimetype.indexOf('text')!=-1){
                    internalCallback(createFrameIntent(entry, options))
                }
            },
            error: function(XMLHttpRequest, textStatus, errorThrown) { 
                console.log("XMLHTTP error: " + textStatus+", " + errorThrown)
            }   
        })
        */
    }
}

function createFrameIntent(entry, options){

    var self = {};
    self.type = 'frame';
    self.top = top; // reference for listeners
    self.sideload = false;
    self.loaded = false;
    self.started = false;
    self.error = false;
    self.ended = false;
    self.attached = false;
    self.videoElement = false;
    self.fittedElement = false;
    self.fittedScope = false;
    self.entry = entry;
    self.events = {};
    self.ctime = ((new Date()).getTime()/1000);
    self.committed = false;
    
    self.frame = document.createElement('iframe');
    self.frame.onload = function (){
        self.loaded = true;
    }

    self.frame.className = "fit-screen hide"; 
    self.frame.nwdisable = true;
    self.frame.nwfaketop = true;
    self.frame.height = "100%";

    self.on = function (action, callback){
        if(typeof(self.events[action])=='undefined'){
            self.events[action] = [];
        }
        self.events[action].push(callback)
    }

    self.trigger = function (action){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = function (action){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                if(!_args[0]){
                    break;
                }
                _args[0] = self.events[action][i].apply(null, _args)
            }
        }
        return _args[0];
    }

    self.play = function (){
        if(self.getVideo()){
            self.videoElement.play()
        }
    }

    self.pause = function (){
        if(self.getVideo()){
            self.videoElement.pause()
        }
    }
    
    self.seek = function (secs){
        if(self.getVideo()){
            self.videoElement.currentTime += secs;
        }
    }

    self.playing = function (){
        if(self.committed){
            if(self.getVideo()){
                return !self.videoElement.paused;
            } else {
                return true;
            }
        }
    }
    
    self.run = function (){
        self.frame.src = self.entry.url;
        if(self.entry.originalUrl.match(new RegExp('#(catalog|nosandbox|nofit)([^A-Za-z0-9]|$)'))){
            self.started = true;
            self.trigger('start');
        }
    }

    self.runFitter = function (){
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
      
    self.commit = function (){
        jQuery(top.window.document).find('#sandbox').remove();
        jQuery(self.frame).removeClass('hide').addClass('show').prop('id', 'sandbox');
        self.frame.id = 'sandbox';
        self.committed = true;
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

    self.destroy = function (){
        jQuery(self.frame).prop('src', 'about:blank').remove();
        delete self.frame;
        self.ended = true;
        self.attached = self.videoElement = false;        
    }
    
    self.getVideo = function (){
        if(self.fittedScope && (!self.videoElement || !self.videoElement.parentNode)){
            self.videoElement = self.fittedScope.document.querySelector('video');
        }
        return self.videoElement;
    }
    
    self.patchVideo = function (){
        if(self.getVideo()){
            var f = function (e){
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
                    var playing = self.top.PlaybackManager.playing();
                    console.log('PLAYING *', playing, self.top);
                    if(playing){
                        self.top.PlaybackManager.pause()
                    } else {
                        self.top.PlaybackManager.play()
                    }
                    console.log('PLAYING **', self.top.PlaybackManager.playing());
                    console.log('OK', playing, self.top);
                    self.top.delayedPlayPauseNotify();
                    return false;
                });
        }
    }

    if(options){
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else {
                self[key] = options[key];
            }
        }
    }

    document.body.appendChild(self.frame);

    return self;

}

function createDirectIntent(entry, options){

    var self = {};
    self.type = 'direct';
    self.sideload = false;
    self.loaded = false;
    self.started = false;
    self.error = false;
    self.ended = false;
    self.attached = false;
    self.videoElement = false;
    self.controller = false;
    self.entry = entry;
    self.events = {};
    self.prx = false;
    self.prxurl = false;
    self.mimetype = '';
    self.ctime = ((new Date()).getTime()/1000);
    
    self.on = function (action, callback){
        if(typeof(self.events[action])=='undefined'){
            self.events[action] = [];
        }
        self.events[action].push(callback)
    }

    self.trigger = function (action){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = function (action, defaultVal){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                if(!_args[0]){
                    break;
                }
                _args[0] = self.events[action][i].apply(null, _args)
            }
        }
        return _args[0];
    }

    self.play = function (){
        if(self.getVideo()){
            self.videoElement.play()
        }
    }

    self.pause = function (){
        if(self.getVideo()){
            self.videoElement.pause()
        }
    }
    
    self.seek = function (secs){
        if(self.getVideo()){
            self.videoElement.currentTime += secs;
        }
    }
    
    self.playing = function (){
        if(self.getVideo()){
            return !self.videoElement.paused;
        }
    }
    
    self.getVideo = function (){
        if(!self.videoElement || !self.videoElement.parentNode){
            self.videoElement = getFrame('player').videoElement();
        }
        return self.videoElement;
    }

    self.commit = function (){
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.prxurl, self.mimetype, 
            function (){ // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            function (){ // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            function (){ // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        self.controller = getFrame('player').player;
        self.videoElement = getFrame('player').videoElement();
        self.attached = true;
    }
    
    self.run = function (){
        self.prxurl = self.entry.url;
        if(self.prxurl.match(new RegExp('(https?://).*m3u8'))){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
            self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';
        } else {
            self.mimetype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        }
        var p = getFrame('player');
        if(!p || !p.test){
            throw 'No iframe#player found.';
        }
        getFrame('player').test(self.prxurl, self.mimetype, () => {
            console.log('Test succeeded. '+self.prxurl);
            self.started = true;
            self.trigger('start')
        }, function (){
            console.log('Test Failed. '+self.prxurl);
            self.error = true;
            self.trigger('error')
        });
    }

    self.destroy = function (){
        NativeStop();
        self.events = [];
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    if(options){
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else {
                self[key] = options[key];
            }
        }
    }

    return self;

}

function createFFmpegIntent(entry, options){

    var self = {};
    self.transcode = !!entry['transcode'];
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.type = 'ffmpeg';
    self.sideload = false;
    self.loaded = false;
    self.started = false;
    self.error = false;
    self.ended = false;
    self.attached = false;
    self.videoElement = false;
    self.controller = false;
    self.entry = entry;
    self.events = {};
    self.ctime = ((new Date()).getTime()/1000);
    self.folder = '';
    self.prxurl = false;
    self.prx = false;
    
    self.on = function (action, callback){
        if(typeof(self.events[action])=='undefined'){
            self.events[action] = [];
        }
        self.events[action].push(callback)
    }
    
    self.trigger = function (action){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = function (action, defaultVal){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                if(!_args[0]){
                    break;
                }
                _args[0] = self.events[action][i].apply(null, _args)
            }
        }
        return _args[0];
    }

    self.play = function (){
        if(self.getVideo()){
            self.videoElement.play()
        }
    }

    self.pause = function (){
        if(self.getVideo()){
            self.videoElement.pause()
        }
    }
    
    self.seek = function (secs){
        if(self.getVideo()){
            self.videoElement.currentTime += secs;
        }
    }
    
    self.playing = function (){
        if(self.getVideo()){
            return !self.videoElement.paused;
        }
    }
    
    self.commit = function (){
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.instance.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            function (){ // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            function (){ // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            function (){ // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        self.videoElement = getFrame('player').videoElement();
        self.controller = getFrame('player').player;
        self.attached = true;
    }

    self.destroy = function (){
        NativeStop();
        self.events = [];
        self.instance.kill();
        if (self.instance.file) {
            removeFolder(dirname(self.instance.file), true);
        }
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    self.getVideo = function (){
        if(!self.videoElement || !self.videoElement.parentNode){
            self.videoElement = getFrame('player').videoElement();
        }
        return self.videoElement;
    }
    
    self.run = function (){
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

    var uid = (new Date()).getTime();
    var DVRTime = 3 * 3600; // secs
    var segmentDuration = 5; // secs

    if(options){
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else {
                self[key] = options[key];
            }
        }
    }

    return self;

}

function createMagnetIntent(entry, options){
    
    var self = {};
    self.transcode = !!entry['transcode'];
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.type = 'magnet';
    self.sideload = false;
    self.loaded = false;
    self.started = false;
    self.waiting = false;
    self.error = false;
    self.ended = false;
    self.attached = false;
    self.videoElement = false;
    self.controller = false;
    self.entry = entry;
    self.events = {};
    self.ctime = ((new Date()).getTime()/1000);
    self.folder = '';
    self.peerflix = false;
    
    self.on = function (action, callback){
        if(typeof(self.events[action])=='undefined'){
            self.events[action] = [];
        }
        self.events[action].push(callback)
    }
    
    self.trigger = function (action){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }

    self.filter = function (action, defaultVal){
        var _args = Array.from(arguments).slice(1);
        if(self.events[action] instanceof Array){
            for(var i=0; i<self.events[action].length; i++){
                if(!_args[0]){
                    break;
                }
                _args[0] = self.events[action][i].apply(null, _args)
            }
        }
        return _args[0];
    }

    self.play = function (){
        if(self.getVideo()){
            self.videoElement.play()
        }
    }

    self.pause = function (){
        if(self.getVideo()){
            self.videoElement.pause()
        }
    }
    
    self.seek = function (secs){
        if(self.getVideo()){
            self.videoElement.currentTime += secs;
        }
    }
    
    self.playing = function (){
        if(self.getVideo()){
            return !self.videoElement.paused;
        }
    }
        
    self.commit = function (){
        NativePlayURL(self.instance.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            function (){ // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            function (){ // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            function (){ // error
                console.log('Player error.');
                self.error = true;
                self.trigger('error')
            });
        jQuery('#player').removeClass('hide').addClass('show');
        self.attached = true;
        self.controller = getFrame('player').player;
        self.videoElement = getFrame('player').videoElement();
        top.focus()
    }
    
    self.run = function (){
        notify(Lang.TORRENT_SLOW_START, 'fa-magnet', 'long');
        console.log('run() called');
        self.waiting = true;
        if(self.endpoint){
            console.log('About to stream...');
            self.stream()
        }
    }

    self.destroy = function (){
        self.peerflix.destroy();
        NativeStop();
        self.events = [];
        self.instance.kill();
        if (self.instance.file) {
            removeFolder(dirname(self.instance.file), true);
        }
        self.ended = true;
        self.attached = self.videoElement = false;  
    }
    
    self.getVideo = function (){
        if(!self.videoElement || !self.videoElement.parentNode){
            self.videoElement = getFrame('player').videoElement();
        }
        return self.videoElement;
    }

    self.stream = function (){
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
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else {
                self[key] = options[key];
            }
        }
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
        var debug = false;
        if(typeof(http)=='undefined'){
            http = require('http')
        }
        var port = 0, HLSProxyInstance = http.createServer(function (_request, _response) {
            if(debug){
                console.log('request starting...');
            }
            var url = _request.url.split('#')[0], request = _request, response = _response;
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://');
            }
            if(url.charAt(0)=='/'){
                url = "http:/"+url;
            }
            if(debug){
                console.log('serving', url);
            }
            var headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
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
                }).catch(function (err){
                    if(debug){
                        console.log('error', err);
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
                }).catch(function (err){
                    if(debug){
                        console.log('error', err);
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
            return url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
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
	});
}

function onIntentCommited(intent){
    top.window.document.title = intent.entry.name;
    setTitleData(intent.entry.name, intent.entry.logo);
    var c = getFrame('controls');
    var entries = c.findEntries(intent.entry.url);
    c.unregisterOfflineStream(intent.entry); // this already update entries flags
    c.History.add(intent.entry);
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

function patchFrameWindowEvents(frameWindow){    
    createMouseObserverForControls(frameWindow);
    frameWindow.document.addEventListener('mouseup', unfocus);
    frameWindow.document.addEventListener('click', function (e){
        setTimeout(function (){unfocus(e)}, 400)
    });
    frameWindow.ondragover = function(e) { 
        e.preventDefault(); 
        top.window.ondragover(e);
        return false
    };
    frameWindow.ondrop = function(e) { e.preventDefault(); return false };
}

function unloadFrames(){
    Array.from(document.getElementsByTagName('iframe')).forEach((frame) => {
        frame.src = 'about:blank';
    })
}

function delayedPlayPauseNotify(){
    setTimeout(function (){
        playPauseNotify()
    }, 250)
    setTimeout(function (){
        playPauseNotify()
    }, 1000)
}

function shouldNotifyPlaybackError(intent){
    var url = intent.entry.originalUrl;
    for(var i=0; i<PlaybackManager.intents.length; i++){
        if(PlaybackManager.intents[i].entry.originalUrl == url && !PlaybackManager.intents[i].error && PlaybackManager.intents[i].type != intent.entry.type){
            return false;
        }
    }
    return true;
}

PlaybackManager.on('play', delayedPlayPauseNotify);
PlaybackManager.on('pause', delayedPlayPauseNotify);
PlaybackManager.on('register', function (intent, entry){
    intent.on('error', function (){
        setTimeout(function (){
            if(shouldNotifyPlaybackError(intent)){ // don't alert user if has sideload intents
                notify(Lang.PLAY_STREAM_FAILURE.format(intent.entry.name), 'fa-exclamation-circle', 'normal');
                console.log('STREAM FAILED', intent.entry.originalUrl, PlaybackManager.log())
            }
        }, 200)
    })
})
PlaybackManager.on('commit', function (intent, entry){
    intent.on('error', function (){
        setTimeout(function (){
            if(shouldNotifyPlaybackError(intent)){ // don't alert user if has sideload intents
                notify(Lang.PLAY_STREAM_FAILURE.format(intent.entry.name), 'fa-exclamation-circle', 'normal');
                console.log('STREAM FAILED', intent.entry.originalUrl, PlaybackManager.log())
            }
        }, 200)
    })
    intent.on('ended', function (){
        // end of stream, go next
        var next = getNextStream(), c = getFrame('controls');
        if(c && next){
            setTimeout(function (){
                c.playEntry(next)
            }, 1200)
        } else {
            stop()
        }
    })
    onIntentCommited(intent, entry);
    delayedPlayPauseNotify();
    sendStats('play', entry)
});
PlaybackManager.on('stop', function (){
    delayedPlayPauseNotify();
    setTimeout(function (){
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

jQuery(window).on('beforeunload', function (){
    stop();
    unloadFrames()
});

jQuery(window).on('unload', function (){
    stop();
    unloadFrames();
    removeFolder('stream', false)
});
