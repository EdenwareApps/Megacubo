

var ffmpeg = require('fluent-ffmpeg')

var isPending = false;
var cpuCount = require('os').cpus().length;
var segmentDuration = 2;
var fitterEnabled = true
var FFmpegPath = path.dirname(process.execPath)+path.sep+'ffmpeg'+path.sep+'ffmpeg'
ffmpeg.setFfmpegPath(FFmpegPath);

var Playback = (() => {
    var self = {
        ratio: '16:9',
        state: 'stop',
        ratioChecked: false,
		events: [], 
        intents: [], 
		wasLoading: false, 
        active: false, 
        lastVideoObserver: false,
        lastActive: false,
        lastCommitTime: 0,
        endpoint: null,
        allowTranscodeFPS: false, // in development
        intentTypesPriorityOrder: ['magnet', 'direct', 'youtube', 'ffmpeg', 'ts', 'frame']
    }
    self.notification = notify('...', 'fa-check', 'forever', true);
    self.notification.hide();
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
        if(self && self.events){
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
    }
    self.trigger = (action, ...arguments) => {
        doAction(action, self.active, self);
        if(typeof(self.events[action])!='undefined'){
            var _args = Array.from(arguments);
            for(var i=0; i<self.events[action].length; i++){
                self.events[action][i].apply(null, _args)
            }
        }
    }
    self.reportError = (err, type) => {
        if(self.active){
            self.active.reportError(err, type)
        }
    }
    self.data = () => {
        if(self.active){
            return self.active.entry;
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
    self.setStateContainers = () => {
        var sel = jQuery(document.body), o = getFrame('overlay');
        if(o && o.document && o.document.body){
            sel = sel.add(o.document.body)
        }
        if(self.active){
            if(self.active.type == 'frame'){
                if(self.active.fittedScope && self.active.fittedScope.document && self.active.fittedScope.document.body){
                    sel = sel.add(self.active.fittedScope.document.body)
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
    self.checkState = () => {
        if(!self.active){
            return 'stop'
        }
        var p = getFrame('player'), video = p.document.querySelector('video');
        if(video.paused) {
            return 'pause'
        } else {
            if(video.networkState === video.NETWORK_LOADING && video.readyState < video.HAVE_FUTURE_DATA){
                return 'load'
            } else {
                return 'play'
            }
        }
    }
    self.setState = (state) => {
        if(!state){
            state = self.checkState()
        }
        // console.warn('STATE', state)
        if(state != self.state){
            console.warn('STATECHANGE', state, traceback())
            switch(state){
                case 'play':
                    let wasPaused = self.state == 'paused';
                    var c = currentStream();
                    c = c ? c.name : Lang.PLAY;
                    self.setStateContainers().addClass('playing').removeClass('loading').removeClass('paused')
                    if(wasPaused){
                        self.notification.update(c, self.active.entry.logo || 'fa-play', 4)
                    }
                    break;
                case 'pause':
                    self.setStateContainers().addClass('paused').removeClass('loading').removeClass('playing')
                    self.notification.update(Lang.PAUSE, 'fa-pause', 'short')
                    break;
                case 'load':
                    self.setStateContainers().addClass('loading').removeClass('playing').removeClass('paused')
                    break;
                case 'stop':
                    self.setStateContainers().removeClass('playing').removeClass('paused').removeClass('loading')
                    break;
            }
            self.state = state;
            self.trigger('state-'+self.state)
        }
    }
    self.watching = (entry) => {
        var ret = 0;
        if(!entry){
            entry = self.active.entry
        }
        if(entry){
            watchingData.forEach(ntr => {
                if(
                    (ntr.name && ntr.name == entry.name) || 
                    (ntr.url && [entry.url, entry.originalUrl].indexOf(ntr.url) != -1) || 
                    (ntr.originalUrl && [entry.url, entry.originalUrl].indexOf(ntr.originalUrl) != -1)
                    ){
                    var n = ntr.label.match(new RegExp('( |^)([0-9]+) '))
                    if(n && n.length && parseInt(n[2]) > ret){
                        ret = parseInt(n[2])
                    }                    
                }
            })
        }
        return ret
    }
    self.transcode = (set) => {
        if(self.active){
            var entry = self.active.entry
            if(typeof(set) == 'boolean'){
                if(entry.transcode != set){
                    entry.transcode = set
                }
            }
            self.stop()
            self.play(entry)
        }
    }
    self.allowP2P = () => {
        if(self.active && Config.get('p2p') && !self.isLoading()){
            return self.watching() >= 2
        }
        return false;
    }
    self.connect = (dest, mimetype) => {
        self.endpoint = {src: dest, mimetype: mimetype, source: self.active.entry.source}
        showPlayers(true, false);
        if(!mimetype){
            mimetype = 'application/x-mpegURL';
        }
        console.log('CONNECT', self.endpoint)
        var p = getFrame('player')
        p.updateSource()
        p.ready(() => {
            var video = p.document.querySelector('video'), v = jQuery(video);
            if(v){
                self.bind(video, self.active)
            }
            leavePendingState()
        })
        setTimeout(() => {
            self.setRatio()
        }, 2000)
    }
    self.disconnect = () => {
        self.endpoint = {}
        var p = getFrame('player')
        if(p){
            p.stop()
        }
        showPlayers(false, false)
    }
    self.bind = (video, intent) => {
        if(!video || !video.ownerDocument){
            console.error("BAD INPUT", video)
            return;
        }
        var doc = video.ownerDocument;
        var jvideo = jQuery(video), scope = doc.defaultView;
        var nativeEvents = {
            'play': () => {
                if(self.active){
                    self.active.getVideo()
                    if(typeof(self.active.videoEvents['play'])=='function' && self.active.videoEvents['play']()){
                        return;
                    }
                    self.setState('play')
                }
            },
            'playing': () => {
                if(self.active){
                    if(typeof(self.active.videoEvents['playing'])=='function' && self.active.videoEvents['playing']()){
                        return;
                    }
                    self.setState('play')
                    if(reloadTimer){
                        clearTimeout(reloadTimer);
                        reloadTimer = 0;
                    }
                }
            },
            'canplaythrough': () => {
                self.setState('play')
                if(reloadTimer){
                    clearTimeout(reloadTimer);
                    reloadTimer = 0;
                }
            },
            'pause': () => {
                if(self.active){
                    if(typeof(self.active.videoEvents['pause'])=='function' && self.active.videoEvents['pause']()){
                        return;
                    }
                    self.setState('pause')
                    console.warn('PAUSE', traceback());
                    if(!seeking){
                        if(reloadTimer){
                            clearTimeout(reloadTimer);
                            reloadTimer = 0;
                        }
                    }
                }
            },
            'error': (data) => {
                if(self.active){
                    if(typeof(self.active.videoEvents['error'])=='function' && self.active.videoEvents['error']()){
                        return;
                    }            
                    console.error('Playback error.', data.originalEvent.path[0].error || data);
                    self.active.error = 'playback';
                    self.active.trigger('error')
                }
            },
            'ended': () => {
                if(self.active){
                    if(typeof(self.active.videoEvents['ended'])=='function' && self.active.videoEvents['ended']()){
                        return;
                    }            
                    console.error('Playback ended.');
                    self.active.ended = true;
                    self.active.trigger('ended')
                }
            },
            'buffering': () => {        
                if(self.active){
                    if(typeof(self.active.videoEvents['buffering'])=='function' && self.active.videoEvents['buffering']()){
                        return;
                    }    
                    self.setState('load')
                }
            },
            'waiting': () => {
                if(self.active){
                    if(typeof(self.active.videoEvents['waiting'])=='function' && self.active.videoEvents['waiting']()){
                        return;
                    }
                    self.setState('load')
                    /*
                    if(!seeking){
                        if(allowTimeoutReload){
                            if(!reloadTimer){
                                reloadTimer = setTimeout(() => {
                                    if(scope && scope.location && scope.location.reload){
                                        console.warn('Video loading timeout, reloading page.');
                                        scope.location.reload();
                                        setTimeout(() => {
                                            intent.fittedScope = false;
                                            intent.fittedElement = false;
                                            intent.video = false;
                                            intent.runFitter()
                                        }, 2000)
                                    }
                                }, reloadTimeout)
                            }
                        }
                    }
                    */
                }
            },
            'stalled': () => {
                if(self.active){
                    if(typeof(self.active.videoEvents['stalled'])=='function' && self.active.videoEvents['stalled']()){
                        return;
                    }
                    self.setState('load')
                }
            },
            'volumechange': () => {
                if(self.active){
                    console.warn("VOLUMECHANGE")
                    Store.set('volume', video.volume, true)
                    Store.set('muted', video.muted, true)
                    if(self.active){
                        var n = video.muted ? 0 : Math.round(video.volume * 100);
                        notificationVolume.update(
                            ((n > 1 ? (Lang.VOLUME + ': ' + n + '%') : ' &nbsp; ' + Lang.MUTE)), 
                            (n > 1 ? 'fa-volume-up' :  'fa-volume-off'), 
                            'short')
                    }
                }
            },
            'muted': () => {
                if(self.active){
                    Store.set('volume', video.volume, true)
                    Store.set('muted', video.muted, true)
                    if(self.active){
                        var n = video.muted ? 0 : Math.round(video.volume * 100);
                        notificationVolume.update(
                            ((n > 1 ? (Lang.VOLUME + ': ' + n + '%') : ' &nbsp; ' + Lang.MUTE)), 
                            (n > 1 ? 'fa-volume-up' :  'fa-volume-off'), 
                            'short')
                    }
                }
            },
            'wheel': (event) => {
                if(self.active){
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
                }
            },
            'timeupdate': () => {
                if(self.active){
                    self.setState('play')
                    setTimeout(() => {
                        if(self.active && typeof(self.active.ratioAdjusted) == 'undefined' && self.active.video && self.active.video.videoHeight){
                            self.active.ratioAdjusted = true
                            self.initRatio()
                        }
                    }, 250)
                }
            },
            'seeking': () => {
                seeking = true;
            },
            'seeked': () => {
                if(self.active){
                    seeking = false;
                    video.play()
                }
            },
            'click': (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            },
            'mousemove': (e) => {
                wasPaused = video.paused;
            },
            'mousedown': (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('FRAME VIDEO MOUSEDOWN');
                wasPaused = video.paused;
                mouseDownTime = time();
                console.log('PLAYING *', wasPaused, top);
                return false;
            },
            'mouseup': (e) => {
                if(time() < mouseDownTime + 3){
                    if(e.which == 1) {
                        if(wasPaused){
                            self.play()
                        } else {
                            self.pause()
                        }
                        console.log('PLAYING **', wasPaused, self.playing());
                        window.focus()
                    }
                }
                return false;
            },
            'webkitfullscreenchange': () => {
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
            }
        }
        video.volume = Store.get('volume') || 1;
        video.muted = Store.get('muted') || false;
        Controls.bind(video);
        self.setState(self.checkState())
        var seeking, fslock, paused, wasPaused, fstm = 0, player = jQuery(video), b = jQuery(doc.querySelector('body')), f = (e) => {
            e.preventDefault();
            e.stopPropagation();
            return false;
        };
        if(video.getAttribute('controls') !== null){
            video.removeAttribute('controls')
        }
        if(video.getAttribute('controlsList') !== null){
            video.removeAttribute('controlsList')
        }
        if(video.paused){
            video.play()
        }
        video.onclick = video.onmousedown = video.onmouseup = null;
        video.style.background = Theme.get('background-color-playing');
        applyCSSTemplate('assets/css/player.src.css', getPlayerScope())
        Object.keys(nativeEvents).forEach((event) => {
            jvideo.off(event, nativeEvents[event]).on(event, nativeEvents[event])
        })
        mouseDownTime = 0, allowTimeoutReload = (intent && intent.type == 'frame' && !isVideo(video.src)), reloadTimer = 0, reloadTimeout = 10000;
    }
    self.rebind = () => {
        let intent = self.active
        if(intent && typeof(intent.getVideo) == 'function'){
            var v = intent.getVideo()
            if(v) {
                self.unbind(intent)
                self.bind(v, intent)
            }
        }
    }
    self.unbind = (intent) => {
        if(intent && typeof(intent.getVideo) == 'function'){
            var v = intent.getVideo()
            if(v) {
                jQuery(v).off()
            }
        }
    }
    self.play = (entry) => {
        if(typeof(entry) == 'object' && typeof(entry.url) != 'undefined'){
            console.warn('prePlayEntryAllow')
            var allow = applyFilters('prePlayEntryAllow', true, entry)
            if(allow){
                if(!Config.get('play-while-tuning')){
                    self.stop()
                }
                self.cancelLoading()
                createPlayIntent(entry, {
                    manual: true,
                    commit: () => {
                        if(entry.origin && entry.origin.type == 'search'){
                            var add = {term: origin.term, type: origin.searchType}
                            var sugs = Store.get('search-history')
                            if(!jQuery.isArray(sugs)){
                                sugs = []
                            }
                            if(sugs.indexOf(add) == -1) {
                                sugs.push(add)
                                Store.set('search-history', sugs, true)
                            }
                        }
                    }
                })
                return true
            } else {
                console.error('prePlayEntryAllow DENY', 'No internet connection.')
                return false
            }
        } else {
            if(self.active){
                var r = self.active.play()
                self.trigger('play')
                return r;
            }
        }
    }
    self.pause = () => {
        if(self.active){
            var r = self.active.pause();
            self.trigger('pause');
            return r;
        }
    }
    self.playing = () => {
        if(self.active){
            return self.active.playing()
        }
    }
    self.seek = (secs) => {
        if(self.active){
            var r = self.active.seek(secs);
            self.trigger('seek');
            return r;
        }
    }
    self.fullStop = () => {
        console.log('STOP', traceback());
        self.intents.forEach((intent, i) => {
            self.destroyIntent(intent)
        })
        console.log('FULLY STOPPED', self.intents);
        self.intents = [];
        self.active = false;
        if(self.wasLoading){
            self.wasLoading = false;
            console.log('load-out')
            self.trigger('load-out');
        }
        self.trigger('stop');
        self.disconnect();
        console.log('STOP OK');
    }
    self.stop = () => {
        self.errors = {};
        console.log('STOP', traceback())
        if(self.active){
            console.log('STOPPED', self.intents);
            self.destroyIntent(self.active);
            self.active = false;
            self.trigger('stop')
        }
        self.disconnect()
        console.log('STOP OK')
    }
    self.url = () => {
        if(self.active){
            return self.active.entry.originalUrl || self.active.entry.url;
        }
    }
    self.isLoading = (fetch) => {
        var loadingIntents;
        if(typeof(fetch)=='string'){
            loadingIntents = self.query({originalUrl: fetch, ended: false, error: false, manual: true});
            return loadingIntents.length > 0;
        }
        var is = false, urls = [];
        loadingIntents = self.query({started: false, ended: false, error: false, manual: true});
        // console.log('LOADING', fetch, Object.assign({}, loadingIntents), traceback());
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
        if(self.intents.length){
            console.log('CANCEL LOADING', self.log());
            for(var i=0; i<self.intents.length; i++){
                if(self.intents[i] != self.active){
                    self.destroyIntent(self.intents[i])
                }
            }
            self.resetIntentsKeys();
            console.log('CANCEL LOADING OK', self.log())
        }
    }
    self.log = () => {
        var _log = '', url, state, error;
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
            if(self.intents[i] == self.active){
                state += ' active';
            }
            url = (self.intents[i].streamURL || self.intents[i].entry.url);
            _log += url;
            if(url != self.intents[i].entry.originalUrl){
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
        if(intent){
            console.log('DESTROYING', intent);
            intent.disabled = true;
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
    }
    self.checkIntents = () => {
        var concurrent, isNewer, actIntent = false, loading = false, intents = self.query({started: true, error: false, ended: false});
        for(var i=0; i<intents.length; i++){
            if(intents[i] != self.active){
                if(actIntent){ // which of these started intents has higher priority
                    var a = self.intentTypesPriorityOrder.indexOf(actIntent.type);
                    var b = self.intentTypesPriorityOrder.indexOf(intents[i].type);
                    var c = intents[i].entry.originalUrl.indexOf('#nofit') != -1;
                    isNewer = (b == a) ? (actIntent.ctime < intents[i].ctime) : (b < a);
                    if(c || isNewer){ // new intent has higher priority than the active
                        self.destroyIntent(actIntent);
                        console.log('COMMITING DISCARD', intents[i], self.active, a, b);                        
                    } else { // keep current active
                        continue;
                    }
                }
                actIntent = intents[i];
            }
        }
        // console.log('CHECK INTENTS', self.active, actIntent, intents);
        if(actIntent && actIntent != self.active){
            self.commitIntent(actIntent)
        } else if(!intents.length && self.active) {
            self.stop()
        }
        var was = self.wasLoading, isLoading = self.isLoading();
        if(isLoading){
            setTimeout(self.checkIntents.bind(this), 2000)
        }
        //console.log('ACTIVE', actIntent, was, isLoading, intents);
    }
    self.registerIntent = (intent) => {
        console.log('REGISTER INTENT', intent, traceback());
        if(self.intents.indexOf(intent)==-1){
            self.intents.push(intent)
        }
        intent.on('start', self.checkIntents.bind(this));
        intent.on('error', self.checkIntents.bind(this));
        intent.on('ended', () => {
            console.log('INTENT ENDED', traceback());
            setTimeout(self.checkIntents.bind(self), 1000)
        });
        console.log('REGISTER INTENT 2');
        self.checkIntents();
        self.trigger('register', intent)      
        if(intent.ended){
            intent.trigger('ended')
        } else if(intent.error){
            intent.trigger('error')
        }
        console.log('REGISTER INTENT 3');
    }
    self.commitIntent = (intent) => {
        var concurrent;
        if(intent && self.active != intent){
            console.log('COMMITING', intent, self.active, traceback());
            /*
            if(self.active){
                concurrent = ((intent.entry.originalUrl||intent.entry.url) == (self.active.entry.originalUrl||self.active.entry.url));
                if(concurrent){ // both are intents from the same stream, decide for one of them
                    var a = self.intentTypesPriorityOrder.indexOf(intent.type);
                    var b = self.intentTypesPriorityOrder.indexOf(self.active.type);
                    var c = self.active.entry.originalUrl.indexOf('#nofit') != -1;
                    if(c || b <= a){ // new concurrent intent has lower (or equal) priority than the active intent
                        self.destroyIntent(intent);
                        console.log('COMMITING DISCARD', intent, self.active, a, b);
                        return false; // keep the current active
                    }
                }
            }
            */
            var allow = true;
            allow = applyFilters('preCommitAllow', allow, intent, self.active);
            if(allow === false){
                console.log('COMMITING DISALLOWED');
                self.destroyIntent(intent);
                return false; // commiting canceled, keep the current active
            }

            var allow = true;
            allow = intent.filter('pre-commit', allow, intent, self.active);
            if(allow === false){
                console.log('COMMITING DISALLOWED *');
                self.destroyIntent(intent);
                return false; // commiting canceled, keep the current active
            }
            
            // From here, the intent is already confirmed, so destroy any non-concurrent (different channel) intents and concurrent intents with lower or equal priority
            self.disconnect();
            for(var i=0; i<self.intents.length; i++){
                if(self.intents[i] != intent){
                    var active = (self.active == self.intents[i]);
                    concurrent = (
                        intent.entry.originalUrl == 
                        self.intents[i].entry.originalUrl
                    );
                    if(active){
                        self.trigger('uncommit', self.active, intent)
                    }
                    if(concurrent){
                        var a = self.intentTypesPriorityOrder.indexOf(intent.type);
                        var b = self.intentTypesPriorityOrder.indexOf(self.intents[i].type);
                        if(a <= b){ // keep the current intent, discard this one
                            self.intents[i].committed = false;
                            self.destroyIntent(self.intents[i])    
                        }
                    } else {
                        self.intents[i].committed = false;
                        self.destroyIntent(self.intents[i])
                    }
                }
            }
            console.log('COMMITING ACTIVE', intent, self.intents);
            if(self.intents.indexOf(intent)==-1){
                self.registerIntent(intent);
            }
            self.lastActive = self.active = intent;
            self.active.shadow = false;
            self.active.committed = true;
            console.log('COMMITING AA', self.active);
            if(typeof(self.active.commit)=='function'){
                try {
                    self.active.commit()
                } catch(e) {
                    console.error(e)
                }
            }
            console.log('COMMITING BB', self.active);
            self.trigger('commit', self.active, self.active.entry)
            self.active.trigger('commit')
            console.log('COMMITING OK', self.intents);
            self.active.on('getVideo', (v) => {
                self.trigger('getVideo', v)
            })
            if(self.active.getVideo()){
                self.trigger('getVideo', self.active.video)
            }
            self.errors = {}
        } else {
            console.log('COMMITING - Already committed.')
        }
        self.lastCommitTime = time();
        self.trigger('load-out')
    }
    self.getVideo = () => {
        if(self.active){
            var v = self.active.getVideo()
            if(v){
                return v
            }
        }
    }   
    self.getVideoSize = () => {
        var v = self.getVideo()
        if(v){
            return {width: v.videoWidth, height: v.videoHeight}
        }
    }   
    self.bufferedSecs = () => {
        var v = self.getVideo()
        if(v && v.duration && v.networkState != v.NETWORK_LOADING && v.readyState >= v.HAVE_FUTURE_DATA){
            return v.duration - v.currentTime
        }
        return -1
    }
    self.initRatio = () => {
        var s = self.detectRatio();
        if(s){
            self.setRatio(s)
        }
    }  
    self.detectRatio = () => {
        if(self.active){
            var v = self.active.getVideo();
            if(v){
                var s = self.getVideoSize(), r = s.width / s.height;
                var scaleModesInt = scaleModes.map(scaleModeAsInt);
                var c = closest(r, scaleModesInt), k = scaleModesInt.indexOf(c);
                return scaleModes[k];
            }
        }
    }  
    self.getRatio = () => {
        return Config.get('aspect-ratio') || '16:9';
    }
    self.setRatio = (ratio) => {
        console.log('Set Ratio', traceback())
        var debug = debugAllow(true), oratio;
        if(typeof(ratio)!='string'){
            ratio = self.getRatio();
        } else {
            Config.set('aspect-ratio', ratio)
        }
        self.ratio = oratio = ratio;
        if(self.active){
            var v = self.active.getVideo()
            if(v){
                if(debug){
                    console.log(typeof(ratio), ratio)
                }
                ratio = scaleModeAsInt(ratio);
				var w, h, ww = jQuery('#player').width(), wh = jQuery('#player').height(), wratio = ww / wh;
				if(wratio >= ratio){
					h = wh;
                    w = wh * ratio;
				} else {
					w = ww;
					h = ww / ratio;
				}
                if(debug){
                    console.log('RATIO', w, h, ww, wh, wratio, ratio)
                }
                v.style.setProperty("objectFit", "fill", "important");
                v.style.setProperty("width", Math.ceil(w)+"px", "important");
                v.style.setProperty("height", Math.ceil(h)+"px", "important");
                v.style.setProperty("min-width", Math.ceil(w)+"px", "important");
                v.style.setProperty("min-height", Math.ceil(h)+"px", "important");
                v.style.setProperty("top", Math.floor((wh - h) / 2)+"px", "important");
                v.style.setProperty("left", Math.floor((ww - w) / 2)+"px", "important")
            } else {
                if(debug){
                    console.log('Video element not found.')
                }
            }
        } else {
            if(debug){
                console.log('No active intent.')
            }
        }
        self.trigger('setRatio', oratio)
    }
    self.on('stop', () => {       
        self.setState('stop')
    })
    return self;
})()

function preparePlayIntent(entry, options, ignoreCurrentPlaying){
    if(!options) options = {};
    var shadow = (typeof(options.shadow)!='undefined' && options.shadow);
    var initTime = time(), FFmpegIntentsLimit = 8, types = [];
    var currentPlaybackType = '', currentPlaybackTypePriotity = -1;
    var allowWebPages = typeof(entry.allowWebPages) == 'undefined' ? (!Config.get('ignore-webpage-streams')) : entry.allowWebPages;
    var forceTranscode = Config.get('transcode-policy') == 'always';
    entry.url = String(entry.url); // Parameter "url" must be a string, not object
    entry.originalUrl = entry.originalUrl ? String(entry.originalUrl) : entry.url;
    entry.name = String(entry.name);
    entry.logo = String(entry.logo);
    if(entry.logo == 'undefined'){
        entry.logo = '';
    }
    if(!ignoreCurrentPlaying && !shadow && Playback.active && Playback.active.entry.originalUrl == (entry.originalUrl || entry.url) && Playback.active.entry.name == entry.name){
        currentPlaybackType = Playback.active.type;
        currentPlaybackTypePriotity = Playback.intentTypesPriorityOrder.indexOf(currentPlaybackType); // less is higher
    }
    console.log('CHECK INTENT', currentPlaybackType, currentPlaybackTypePriotity, entry, options, traceback());
    if(typeof(entry.originalUrl) == 'undefined'){
        entry.originalUrl = entry.url;
    }
    console.log(entry.url);
    if(isMegaURL(entry.url)){ // mega://
        if(options.shadow){
            return {types: types, entry: entry};
        }
        console.log('isMega');
        var data = parseMegaURL(entry.url);
        if(!data){
            return {types: types, entry: entry};
        }
        console.log('PARTS', data);
        if(data.type == 'link'){
            entry.url = data.url;
        } else if(data.type == 'play') {
            return {types: types, entry: entry};
        }
    }
    if(getExt(entry.url)=='mega'){ // .mega
        entry = megaFileToEntry(entry.url);
        if(!entry){
            return {types: types, entry: entry};
        }
    }

    var customType = false;
    Object.values(customMediaTypes).forEach((atts) => {
        //console.log('CREATEPLAYINTENT', atts);
        if(atts.check && atts.check(entry.url, entry)){
            var f = 'create'+ucWords(atts.type)+'Intent';
            console.log('CREATEPLAYINTENT', f);
            if(typeof(window[f]) == 'function'){
                customType = atts.type;
            }
        }
    })

    if(customType) {
        console.log('CREATEPLAYINTENT FOR ' + customType.toUpperCase(), entry.url);
        types.push(customType)
    } else if(isRTMP(entry.url) || isRTSP(entry.url)){
        console.log('CREATEPLAYINTENT FOR RTMP/RTSP', entry.url);
        if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            types.push('ffmpeg')
        }
    } else if(isRemoteTS(entry.url)){ // before isHTML5Video()
        // these TS can be >20MB and even infinite (realtime), so it wont run as HTML5, FFMPEG is a better approach so
        console.log('CREATEPLAYINTENT FOR TS', entry.url);
        types.push('ts')
    } else if(!forceTranscode && (isHTML5Video(entry.url) || isM3U8(entry.url))){
        console.log('CREATEPLAYINTENT FOR HTML5/M3U8', entry.url);
        if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('direct') < currentPlaybackTypePriotity){
            types.push('direct')
        }
    } else if(isMedia(entry.url)){
        console.log('CREATEPLAYINTENT FOR MEDIA', entry.url);
        if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            types.push('ffmpeg')
        }
    } else if(['html', 'htm'].indexOf(getExt(entry.url))!=-1) {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url)
        if(allowWebPages){
            if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
                types.push('frame')
            }
        }
    } else  {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url);
        if(allowWebPages){
            if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
                types.push('frame')
            }
        }
        if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            if(Playback.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
                types.push('ffmpeg') // not sure, so we'll race the possible intents
            }
        }
    }
    return {types: types, entry: entry};
}

function getPlayIntentTypes(entry, options){
    var data = preparePlayIntent(entry, options, true);
    return data.types.sort().join(',');
}

function pingSource(url) {
    console.warn('Source ping', url); // Print the error if one occurred
    request(url, function (error, response, body) {
        if(error){
            console.error('Source ping error', url, error); // Print the error if one occurred
        } else {
            console.warn('Source ping success', response.statusMessage); // Print the error if one occurred
        }
    })
}

function createPlayIntent(entry, options, subIntentCreateCallback, forceTypes) {
    console.log('CREATE INTENT', entry, options, traceback(), forceTypes);
    var shadow = (typeof(options.shadow)!='undefined' && options.shadow);
    var data, intents = [];
    console.log(entry.url);
    if(entry.source && isHTTP(entry.source)){
        pingSource(entry.source)
    }
    if(isMegaURL(entry.url)){ // mega://
        console.log('isMega');
        var megaUrl = entry.url, data = parseMegaURL(entry.url);
        if(!data){
            if(typeof(subIntentCreateCallback) == 'function'){
                subIntentCreateCallback('Bad mega:// URL', false)
            }
            return;
        }
        console.log('PARTS', data);
        if(data.type == 'link'){
            entry.url = data.url;
        } else if(data.type == 'play') {
            setTimeout(() => {
                if(shadow){
                    tune(data.name, null, entry.originalUrl, (err, entry, intent) => {
                        if(err){
                            if(typeof(subIntentCreateCallback) == 'function'){
                                subIntentCreateCallback(err, false)
                            }
                        } else if(intent) {
                            intent.entry.originalUrl = megaUrl;
                            if(typeof(subIntentCreateCallback) == 'function'){
                                subIntentCreateCallback(false, intent)
                            }
                        } else {
                            entry.originalUrl = megaUrl;
                            createPlayIntent(entry, options, subIntentCreateCallback)
                        }
                    }, data.mediaType)
                } else {
                    tuneNPlay(data.name, null, entry.originalUrl, (err, entry, intent) => {
                        if(err){
                            if(typeof(subIntentCreateCallback) == 'function'){
                                subIntentCreateCallback(err, false)
                            }
                        } else if(intent) {
                            intent.entry.originalUrl = megaUrl;
                            if(typeof(subIntentCreateCallback) == 'function'){
                                subIntentCreateCallback(false, intent)
                            }
                        } else {
                            entry.originalUrl = megaUrl;
                            createPlayIntent(entry, options, subIntentCreateCallback)
                        }
                    }, data.mediaType)
                }
            }, 200);
            return;
        }
    }
    if(jQuery.isArray(forceTypes)){
        data = {types: forceTypes}
    } else {
        data = preparePlayIntent(entry, options)
    }
    if(data.types.length){
        data.types.forEach((type) => {
            if(type == 'ffmpeg'){
                intents = intents.concat(createFFmpegIntent(entry, options))
            } else if(type == 'ts'){
                intents = intents.concat(createTSIntent(entry, options))
            } else {
                var n = "create"+ucWords(type)+"Intent";
                console.log(n, type, data.types);
                if(typeof(window[n])=='function'){
                    intents = intents.concat(window[n](entry, options))
                }
            }
        })
    }
    intents.forEach((intent, index) => {
        //console.log('_INTENT', intent, intents);
        if(intent){
            if(!shadow){
                Playback.registerIntent(intent);
            }
            if(typeof(subIntentCreateCallback)=='function'){
                subIntentCreateCallback(false, intent) // before run() to allow setup any event callbacks
            }
            //console.log('INTERNAL', intent, traceback());
            intent.run();
            return intent;
        } else {
            console.log('Error: NO INTENT', intent, entry.url);
        }
    });
    return intents.length ? intents : false;
}

var currentScaleMode = 0, scaleModes = ['21:9', '16:9', '16:10', '4:3', '9:16']
function changeScaleMode(reverse){
    if(Playback.active){
        var v = Playback.active.video;
        if(v){
            if(reverse === true){
                currentScaleMode++;
                if(currentScaleMode >= scaleModes.length){
                    currentScaleMode = 0;
                }
            } else {
                currentScaleMode--;
                if(currentScaleMode < 0){
                    currentScaleMode = scaleModes.length - 1;
                }
            }
            Playback.setRatio(scaleModes[currentScaleMode]);
            notify('Scale: '+scaleModes[currentScaleMode], 'fa-expand', 'short');
            if(miniPlayerActive){
                var ratio = scaleModeAsInt(scaleModes[currentScaleMode]), nwh = $body.height(), nww = Math.round(nwh * ratio);
                console.log('QQQ', nww, nwh, ratio);
                window.resizeTo(nww, nwh);
                window.moveTo(screen.availWidth - nww - miniPlayerRightMargin, screen.availWidth - nwh)
            }       
        }        
    }
}

function scaleModeAsInt(scaleMode){
    var n = scaleMode.split(':')
    return parseFloat(n[0]) / parseFloat(n[1])
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
	})
}

function waitInstanceFileExistsTimeout(self, callback, timeout, startedAt) {
    if(typeof(startedAt)=='undefined'){
        startedAt = time();
    }
    //console.log('WAIT', self);
    if(self && self.decoder && typeof(self.decoder.file)=='string'){
        fs.stat(self.decoder.file, function(err, stat) {
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
    onIntentTitle(intent);
    intent.on('rename', onIntentTitle);
    updateStreamEntriesFlags()
}

function onIntentTitle(intent){
    setTitleData(intent.entry.name, intent.entry.logo);
    setStreamStateCache(intent.entry, true); // this already update entries flags
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
    //e.preventDefault(); 
    top.ondragover(e);
    return false;
}

function enableEventForwarding(frameWindow){    
    if(frameWindow && frameWindow.document && frameWindow.ondragover !== defaultFrameDragOver){
        frameWindow.ondragover = defaultFrameDragOver;
        attachMouseObserver(frameWindow);
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

function shouldNotifyPlaybackError(intent){
    console.log('SHOULD', intent);
    if(intent.manual && !intent.shadow && (!intent.disabled || (Playback.lastActive && (intent.entry.url == Playback.lastActive.entry.url)))){
        var url = intent.entry.originalUrl;
        for(var i=0; i<Playback.intents.length; i++){
            if(Playback.intents[i].entry.originalUrl == url && Playback.intents[i].entry.name == intent.entry.name && Playback.intents[i] != intent && !Playback.intents[i].error && !Playback.intents[i].ended){
                console.log('SHOULD', false, Playback.intents[i], intent);
                return false;
            }
        }
        console.log('SHOULD', true);
        return true;
    }
    return false;
}

Playback.on('register', (intent, entry) => {
    intent.on('error', () => {
        //console.log('STREAM FAILED', Playback.log())
        setTimeout(() => {
            //console.log('STREAM FAILED', Playback.log());
            setStreamStateCache(intent.entry, false);
            sendStats('error', sendStatsPrepareEntry(intent.entry))
            if(!intent.shadow && shouldNotifyPlaybackError(intent)){ // don't alert user if has concurrent intents loading
                if(!Config.get('similar-transmissions') || !switchPlayingStream(intent)){
                    sound('static', 16);
                    var message = Lang.PLAY_STREAM_FAILURE.format(intent.entry.name);
                    if([404, 'connect', 'invalid'].indexOf(intent.error) != -1 || [404].indexOf(intent.statusCode) != -1) {
                        message += ' ' + Lang.PLAYBACK_OFFLINE_STREAM;
                    } else if(['p2p-disabled'].indexOf(intent.error) != -1 || [404].indexOf(intent.statusCode) != -1) {
                        message += ' ' + Lang.P2P_DISABLED;
                    } else if([500, 502, 504, 520].indexOf(intent.error) != -1 || [500, 502, 504, 520].indexOf(intent.statusCode) != -1) {
                        message += ' ' + Lang.PLAYBACK_OVERLOADED_SERVER;
                    } else if([401, 403].indexOf(intent.error) != -1 || [401, 403].indexOf(intent.statusCode) != -1) {
                        message += ' ' + Lang.PLAYBACK_PROTECTED_STREAM;
                    } else if(['timeout'].indexOf(intent.error) != -1) {
                        message += ' ' + Lang.PLAYBACK_TIMEOUT;
                    } else if(['playback', 'ffmpeg'].indexOf(intent.error) != -1) {
                        message += ' ' + Lang.PLAYBACK_ERROR;
                    } else if(typeof(intent.error) == 'number'){
                        message += ' ' + statusCodeToMessage(intent.error)
                    } else {
                        message += ' Unknown error.';
                    }
                    notify(message, intent.entry.logo || 'fa-exclamation-circle faclr-red', 'normal');
                    console.log('STREAM FAILED', message, intent.entry.originalUrl, Playback.log())
                }
            }
        }, 200)
    });
    intent.on('ended', () => {
        // end of stream, go next
        console.log('STREAM ENDED', Playback.log(), intent.shadow)
        if(!intent.shadow){
            console.log('STREAM ENDED', Playback.log(), intent.entry.url, isLive(intent.entry.url), intent.entry.originalUrl)
            if(!isVideo(intent.entry.url)){
                // if is live, the stream should not end, so connect to another broadcast
                if(isMegaURL(intent.entry.originalUrl)){ // mega://
                    console.log('isMega', intent.entry.originalUrl);
                    var data = parseMegaURL(intent.entry.originalUrl);
                    console.log('isMega', data);
                    if(data){
                        console.log('PARTS', data);
                        if(data.type == 'play') {
                            setTimeout(() => {
                                if(!autoCleanEntriesRunning()){
                                    tuneNPlay(data.name, null, intent.entry.originalUrl)
                                }
                            }, 1000)
                        }
                    }
                }
            } else  {
                var type = getPlayIntentTypes(intent.entry), next = getNextStream()
                console.log('STREAM ENDED', type, next)
                if(next){
                    var ntype = getPlayIntentTypes(next);
                    if(type == ntype){
                        setTimeout(() => {
                            playEntry(next)
                        }, 1000)
                    }
                }
            }
        }
    })
})

Playback.on('commit', (intent) => {
    console.log('COMMIT TRIGGERED');
    Menu.playState(true);
    setStreamStateCache(intent.entry, true);
    onIntentCommit(intent);
    sendStats('alive', sendStatsPrepareEntry(intent.entry));
    leavePendingState();    
    var terms = playingStreamKeyword(intent.entry), b = document.querySelector('.try-other');
    if(b) {
        jQuery(b)[terms ? 'show' : 'hide']()
    }
})

Playback.on('stop', () => {
    Menu.playState(false);
    if(!Playback.intents.length){
        stop(true)
    }
})

Playback.on('load-in', () => {
    var title = false, intents = Playback.query({started: false, ended: false, error: false});
    if(intents.length){
        title = (decodeURIComponent(intents[0].entry.name)||intents[0].entry.name);
    }
    if(!isPending){
        enterPendingState(title)
    }
})

Playback.on('load-out', () => {
    leavePendingState();
    updateStreamEntriesFlags()
})

var engagingTimer = 0, engageTime = 180;

Playback.on('commit', (intent) => {
    autoCleanEntriesCancel()
    clearTimeout(engagingTimer);
    engagingTimer = setTimeout(() => {
        if(Playback.active){
            sendStats('success', sendStatsPrepareEntry(Playback.active.entry));
            History.add(intent.entry)
        }
    }, engageTime * 1000)
})

Playback.on('stop', () => {
    clearTimeout(engagingTimer)
})

addAction('stop', () => {
    updateStreamEntriesFlags()
    sendStats('stop')
})

$win.on('beforeunload', () => {
    removeFolder('stream', false);
    stop();
    unloadFrames()
})
