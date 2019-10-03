

const Events = require('events'), ffmpeg = require('fluent-ffmpeg'), FFmpegPath = path.dirname(process.execPath) + path.sep + 'ffmpeg' + path.sep + 'ffmpeg'

var isPending = false;
var cpuCount = require('os').cpus().length
var fitterEnabled = true

ffmpeg.setFfmpegPath(FFmpegPath);

class PlaybackManager extends Events {
    constructor(){
        super()
		let defaults = {
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
			intentTypesPriorityOrder: []
		}
		Object.keys(defaults).forEach(key => {
			this[key] = defaults[key]
		})
		this.notification = notify('...', 'fa-check', 'forever', true)
		this.notification.hide()
		this.on('stop', () => {       
			this.setState('stop')
        })
        this.engines = {}
        this.enginesPriorities = {}
    }
    registerEngine(name, f, priority){
        this.engines[name] = f
        this.enginesPriorities[name] = priority
        this.intentTypesPriorityOrder = Object.keys(this.engines).sort((a, b) => {
            return this.enginesPriorities[a] - this.enginesPriorities[b]
        })
    }
    data(){
        if(this.active){
            return this.active.entry;
        }
    }
    player(){
        if(!this._player){
            this._player = getFrame('player')
        }
        return this._player
    }
    query(filter){ // object
        var results = [], ok
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
    }
    setStateContainers(){
        var sel = jQuery(document.body), o = getFrame('overlay');
        if(o && o.document && o.document.body){
            sel = sel.add(o.document.body)
        }
        if(this.active){
            if(this.active.type == 'html'){
                if(this.active.fittedScope && this.active.fittedScope.document && this.active.fittedScope.document.body){
                    sel = sel.add(this.active.fittedScope.document.body)
                }
            } else {
                var p = this.player()
                if(p && p.document && p.document.body){
                    sel = sel.add(p.document.body)
                }
            }
        }
        return sel;
    }
    stalled(video){
        if(this.active){
            if(!video){
                video = this.getVideo()
            }
            if(video){
                return video.readyState <= 2 && video.networkState == 2
            }
        }
        return false
    }
    checkState(){
        if(!this.active){
            return 'stop'
        }
        var video = this.getVideo()
        if(video.paused) {
            return 'pause'
        } else {
            if(this.stalled(video)){
                return 'load'
            } else {
                return 'play'
            }
        }
    }
    setState(state){
        if(typeof(state) != 'string'){
            state = this.checkState()
        }
        // console.warn('STATE', state)
        if(!this.active){
            state = 'stop'
        }
        if(state != this.state){
            console.warn('STATECHANGE', state, traceback())
            switch(state){
                case 'play':
                    let wasPaused = this.state == 'paused';
                    var c = currentStream();
                    c = c ? c.name : Lang.PLAY;
                    this.setStateContainers().addClass('playing').removeClass('loading').removeClass('paused')
                    if(wasPaused){
                        this.notification.update(c, this.active.entry.logo || 'fa-play', 4)
                    }
                    break;
                case 'pause':
                    this.setStateContainers().addClass('paused').removeClass('loading').removeClass('playing')
                    this.notification.update(Lang.PAUSE, 'fa-pause', 'short')
                    break;
                case 'load':
                    this.setStateContainers().addClass('loading').removeClass('playing').removeClass('paused')
                    break;
                case 'stop':
                    this.setStateContainers().removeClass('playing').removeClass('paused').removeClass('loading')
                    break;
            }
            this.state = state;
            this.emit('state-'+this.state)
        }
    }
    watching(entry){
        var ret = 0;
        if(!entry){
            entry = this.active.entry
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
    connect(dest, mimetype){
        this.endpoint = {src: dest, mimetype: mimetype, source: this.active.entry.source}
        showPlayers(true, false)
        if(!mimetype){
            mimetype = 'application/x-mpegURL'
        }
        if(Controls.seekSlider){
            Controls.seekSlider.val(0)
        }
        console.log('CONNECT', this.endpoint)
        var p = this.player()
        p.stop()
        p.updateSource()
        p.ready(() => {
            var video = p.document.querySelector('video')
            if(video){
                this.bind(video, this.active)
                if(video.paused && this.active.type != 'magnet'){
                    video.play()
                }
            }
        })
        setTimeout(() => {
            this.setRatio()
        }, 2000)
    }
    disconnect(){
        this.endpoint = {}
        var p = this.player()
        if(p){
            p.stop()
        }
        showPlayers(false, false)
    }
    bind(video, intent){
        if(!video || !video.ownerDocument){
            console.error("BAD INPUT", video)
            return;
        }
        var doc = video.ownerDocument;
        var jvideo = jQuery(video), scope = doc.defaultView;
        var triggerFilter = (type) => {
            if(typeof(this.active.videoEvents[type])!='undefined'){
                if(this.active.videoEvents[type].some(f => {
                    return f()
                })){
                    return true
                }
            }
        }
        var nativeEvents = {
            'play': () => {
                if(this.active){
                    this.active.getVideo()
                    if(triggerFilter('play')) return
                    this.setState('play')
                }
            },
            'playing': () => {
                if(this.active){
                    if(triggerFilter('playing')) return
                    this.setState('play')
                    if(this.reloadTimer){
                        clearTimeout(this.reloadTimer);
                        this.reloadTimer = 0;
                    }
                }
            },
            'canplaythrough': () => {
                this.setState('play')
                if(this.reloadTimer){
                    clearTimeout(this.reloadTimer);
                    this.reloadTimer = 0;
                }
            },
            'pause': () => {
                if(this.active){
                    if(triggerFilter('pause')) return
                    this.setState('pause')
                    console.warn('PAUSE', traceback());
                    if(!seeking){
                        if(this.reloadTimer){
                            clearTimeout(this.reloadTimer);
                            this.reloadTimer = 0;
                        }
                    }
                }
            },
            'error': (data) => {
                if(this.active){
                    if(triggerFilter('error')) return
                    let err, message = ''
                    try {
                        err = data.originalEvent.path[0].error
                        message = err.message
                    } catch (e) {}
                    console.error('Playback error.', err || data, video, message)
                    let c
                    if(message.indexOf('stream parsing failed') != -1 && [this.active.videoCodec, this.active.audioCodec].indexOf('copy') != -1){
                        this.active.videoCodec = 'libx264'
                        this.active.audioCodec = 'aac'
                        c = true
                    } else {
                        if(message.indexOf('Failed to send video') != -1 && this.active.videoCodec == 'copy'){
                            this.active.videoCodec = 'libx264'
                            this.active.videoCodecLock = true
                            c = true
                        }
                        if(message.indexOf('Failed to send audio') != -1 && this.active.audioCodec == 'copy'){
                            this.active.audioCodec = 'aac'
                            this.active.audioCodecLock = true
                            c = true
                        }
                    }
                    if(c){
                        this.active.restartDecoder()
                        this.active.resetTimeout()
                    }
                }
                /*
                if(0 && this.active){
                    if(typeof(this.active.videoEvents['error'])=='function' && this.active.videoEvents['error']()){
                        return
                    }     
                    console.error('Playback error.', data.originalEvent.path[0].error || data, video)
                    setTimeout(() => {
                        if(video && video.paused){
                            console.error('Playback error.', video.paused)
                            this.active.error = 'playback'
                            this.active.emit('error', this.active)
                        }
                    }, 200)
                }
                */
            },
            'ended': () => {
                if(this.active){
                    if(triggerFilter('ended')) return
                    console.error('Playback ended.')
                    this.active.ended = true
                    this.active.emit('end', this.active)
                }
            },
            'buffering': () => {        
                if(this.active){
                    if(triggerFilter('buffering')) return 
                    this.setState('load')
                }
            },
            'waiting': () => {
                if(this.active){
                    if(triggerFilter('waiting')) return
                    this.setState('load')
                    /*
                    if(!seeking){
                        if(this.allowTimeoutReload){
                            if(!this.reloadTimer){
                                this.reloadTimer = setTimeout(() => {
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
                                }, this.reloadTimeout)
                            }
                        }
                    }
                    */
                }
            },
            'stalled': () => {
                if(this.active){
                    if(triggerFilter('stalled')) return
                    this.setState('load')
                }
            },
            'volumechange': () => {
                if(this.active){
                    console.warn("VOLUMECHANGE")
                    Store.set('volume', video.volume, true)
                    Store.set('muted', video.muted, true)
                    if(this.active){
                        var n = video.muted ? 0 : Math.round(video.volume * 100);
                        notificationVolume.update(
                            ((n > 1 ? (Lang.VOLUME + ': ' + n + '%') : ' &nbsp; ' + Lang.MUTE)), 
                            (n > 1 ? 'fa-volume-up' :  'fa-volume-off'), 
                            'short')
                    }
                }
            },
            'muted': () => {
                if(this.active){
                    Store.set('volume', video.volume, true)
                    Store.set('muted', video.muted, true)
                    if(this.active){
                        var n = video.muted ? 0 : Math.round(video.volume * 100);
                        notificationVolume.update(
                            ((n > 1 ? (Lang.VOLUME + ': ' + n + '%') : ' &nbsp; ' + Lang.MUTE)), 
                            (n > 1 ? 'fa-volume-up' :  'fa-volume-off'), 
                            'short')
                    }
                }
            },
            'wheel': (event) => {
                if(this.active){
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
                if(this.active){
                    this.setState('play')
                    setTimeout(() => {
                        if(this.active && typeof(this.active.ratioAdjusted) == 'undefined' && this.active.video && this.active.video.videoHeight){
                            this.active.ratioAdjusted = true
                            this.initRatio()
                        }
                    }, 250)
                }
            },
            'seeking': () => {
                seeking = true;
            },
            'seeked': () => {
                if(this.active){
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
                this.mouseDownTime = time();
                console.log('PLAYING *', wasPaused, top);
                return false;
            },
            'mouseup': (e) => {
                if(time() < this.mouseDownTime + 3){
                    if(e.which == 1) {
                        if(wasPaused){
                            this.play()
                        } else {
                            this.pause()
                        }
                        console.log('PLAYING **', wasPaused, this.playing());
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
        video.volume = Store.get('volume') || 1
        video.muted = Store.get('muted') || false
        Controls.bind(video)
        this.setState(this.checkState())
        var seeking, fslock, paused, wasPaused, fstm = 0, player = jQuery(video), b = jQuery(doc.querySelector('body')), f = (e) => {
            e.preventDefault()
            e.stopPropagation()
            return false
        }
        if(video.getAttribute('controls') !== null){
            video.removeAttribute('controls')
        }
        if(video.getAttribute('controlsList') !== null){
            video.removeAttribute('controlsList')
        }
        if(video.paused){
            video.play()
        }
        video.onclick = video.onmousedown = video.onmouseup = null
        video.style.background = Theme.get('background-color-playing')
        applyCSSTemplate('assets/css/player.src.css', getPlayerScope())
        Object.keys(nativeEvents).forEach((event) => {
            jvideo.off(event, nativeEvents[event]).on(event, nativeEvents[event])
        })
        this.mouseDownTime = 0
        this.allowTimeoutReload = (intent && intent.type == 'html' && !isVideo(video.src))
        this.reloadTimer = 0
        this.reloadTimeout = 10000
    }
    rebind(){
        let intent = this.active
        if(intent && typeof(intent.getVideo) == 'function'){
            var v = intent.getVideo()
            if(v) {
                this.unbind(intent)
                this.bind(v, intent)
            }
        }
    }
    unbind(intent){
        if(intent && intent == this.active){
            Controls.unbind()
            var v = intent.getVideo()
            if(v) {
                jQuery(v).off()
            }
        }
    }
    play(entry, types, tuning, atts, cb){
        if(typeof(entry) == 'object' && typeof(entry.url) != 'undefined'){
            console.warn('prePlayEntryAllow')
            var allow = applyFilters('prePlayEntryAllow', true, entry)
            if(allow){
                if(!Config.get('play-while-tuning')){
                    this.stop()
                }
                this.cancelLoading()
                console.warn('prePlayEntryAllow', entry, types)
                atts = Object.assign(atts || {}, {
                    manual: true,
                    commit: (intent) => {
                        console.warn('prePlayEntryAllow COMMIT', entry, types)
                        if(tuning){
                            intent.tuning = [tuning.originalUrl, tuning.type]
                        }
                        if(entry.origin && entry.origin.type == 'search'){
                            var add = {term: origin.term, type: origin.searchType}
                            var sugs = Store.get('search-history')
                            if(!Array.isArray(sugs)){
                                sugs = []
                            }
                            if(sugs.indexOf(add) == -1) {
                                sugs.push(add)
                                Store.set('search-history', sugs, true)
                            }
                        }
                    }
                })
                this.createIntent(entry, atts, types, cb)
                return true
            } else {
                let err = 'No internet connection.'
                console.error('prePlayEntryAllow DENY', err)
                if(typeof(cb) == 'function'){
                    cb(err, [], 0)
                }
                return false
            }
        } else {
            if(this.active){
                var r = this.active.play()
                this.emit('play')
                if(typeof(cb) == 'function'){
                    cb(null, this.active, 200)
                }
                return r
            } else {
                if(typeof(cb) == 'function'){
                    cb('Not playing and no entry provided', null, 0)
                }
            }
        }
    }
    pause(){
        if(this.active){
            var r = this.active.pause();
            this.emit('pause');
            return r;
        }
    }
    playing(){
        if(this.active){
            return this.active.playing()
        }
    }
    seek(secs){
        if(this.active){
            var r = this.active.seek(secs);
            this.emit('seek');
            return r;
        }
    }
    stopAll(){ // stop playback and loading intents
        console.log('STOP', traceback());
        this.intents.forEach((intent, i) => {
            this.destroyIntent(intent)
        })
        console.log('FULLY STOPPED', this.intents);
        this.intents = [];
        this.active = false;
        if(this.wasLoading){
            this.wasLoading = false;
            console.log('load-out')
            this.emit('load-out');
        }
        this.stop();
        console.log('STOP OK');
    }
    stop(){ // stop playback
        this.errors = {}
        console.log('STOP', traceback())
        if(this.active){
            console.log('STOPPED', this.intents);
            this.destroyIntent(this.active);
            this.active = false;
            this.emit('stop')
        }
        this.disconnect()
        console.log('STOP OK')
    }
    url(){
        if(this.active){
            return this.active.entry.originalUrl || this.active.entry.url;
        }
    }
    isLoading(fetch){
        var loadingIntents
        if(typeof(fetch)=='string'){
            loadingIntents = this.query({originalUrl: fetch, ended: false, error: false, manual: true})
            return loadingIntents.length > 0
        }
        var is = false, urls = []
        loadingIntents = this.query({started: false, ended: false, error: false, manual: true});
        // console.log('LOADING', fetch, Object.assign({}, loadingIntents), traceback());
        if(fetch === true){
            for(var i=0; i<loadingIntents.length; i++){
                urls.push(loadingIntents[i].entry.url)
            }
            is = urls.length ? urls : []
        } else {
            is = loadingIntents.length > 0
        }
        if(this.wasLoading != is){
            console.log('LOADCHANGE')
            this.wasLoading = !!is
            console.log(is ? 'load-in' : 'load-out')
            this.emit(is ? 'load-in' : 'load-out')
        }
        return is
    }
    resetIntentsKeys(){
        this.intents = this.intents.filter((item) => {
            return item !== undefined
        })
    }
    cancelLoading(){
        if(this.intents.length){
            console.log('CANCEL LOADING', this.log());
            for(var i=0; i<this.intents.length; i++){
                if(this.intents[i] != this.active){
                    this.destroyIntent(this.intents[i])
                }
            }
            this.resetIntentsKeys()
            this.emit('load-out')
            console.log('CANCEL LOADING OK', this.log())
        }
    }
    log(){
        var _log = '', url, state, error;
        for(var i=0; i<this.intents.length; i++){
            state = 'unknown';
            error = this.intents[i].ended || this.intents[i].error;
            if(!error && this.intents[i].started){
                state = 'started';
            } else {
                if(!error){
                    state = 'loading';
                } else if(this.intents[i].ended){
                    state = 'ended';
                } else {
                    state = 'error';
                }
            }
            if(this.intents[i] == this.active){
                state += ' active';
            }
            url = (this.intents[i].streamURL || this.intents[i].entry.url);
            _log += url;
            if(url != this.intents[i].entry.originalUrl){
                _log += " (from "+this.intents[i].entry.originalUrl+")";
            }
            _log += " ("+this.intents[i].type+", "+state+")\r\n";
        }
        return _log;
    }
    hasURL(url){
        for(var i=0; i<this.intents.length; i++){
            if(this.intents[i].entry.url == url || this.intents[i].entry.originalUrl == url){
                return true;
                break;
            }
        }
    }
    destroyIntent(intent){
        if(intent && !intent.destroyed){
            console.log('DESTROYING', intent, traceback())
            try {
                intent.destroy()
            } catch(e) {
                console.error('INTENT DESTROY FAILURE', e)
            }
            var i = this.intents.indexOf(intent)
            if(i != -1){
                delete this.intents[i]
                this.resetIntentsKeys()
            }
            if(intent == this.active){
                this.active = null
                this.stop()
            }
        }
    }
    checkIntents(){
        var concurrent, isNewer, actIntent = false, loading = false, intents = this.query({started: true, error: false, ended: false});
        for(var i=0; i<intents.length; i++){
            if(intents[i] != this.active){
                if(actIntent){ // which of these started intents has higher priority
                    var a = this.intentTypesPriorityOrder.indexOf(actIntent.type);
                    var b = this.intentTypesPriorityOrder.indexOf(intents[i].type);
                    var c = intents[i].entry.originalUrl.indexOf('#nofit') != -1;
                    isNewer = (b == a) ? (actIntent.ctime < intents[i].ctime) : (b < a);
                    if(c || isNewer){ // new intent has higher priority than the active
                        this.destroyIntent(actIntent);
                        console.log('COMMITING DISCARD', intents[i], this.active, a, b);                        
                    } else { // keep current active
                        continue;
                    }
                }
                actIntent = intents[i];
            }
        }
        // console.log('CHECK INTENTS', this.active, actIntent, intents);
        if(actIntent && actIntent != this.active){
            let prevActIntent = this.active
            this.commitIntent(actIntent)
            this.destroyIntent(prevActIntent)
        } else if(!intents.length && this.active) {
            this.stop()
        }
        var was = this.wasLoading, is = this.isLoading()
        if(was != is){
            setTimeout(this.checkIntents.bind(this), 2000)
        }
        //console.log('ACTIVE', actIntent, was, isLoading, intents);
    }
    registerIntent(intent){
        console.log('REGISTER INTENT', intent, traceback());
        if(this.intents.indexOf(intent)==-1){
            this.intents.push(intent)
        }
        intent.on('start', this.checkIntents.bind(this));
        intent.on('error', this.checkIntents.bind(this));
        intent.on('end', () => {
            console.log('INTENT ENDED', traceback());
            setTimeout(this.checkIntents.bind(this), 1000)
        });
        console.log('REGISTER INTENT 2');
        this.checkIntents();
        this.emit('register', intent)      
        if(intent.ended){
            intent.emit('end', intent)
        } else if(intent.error){
            intent.emit('error', intent)
        }
        console.log('REGISTER INTENT 3');
    }
    commitIntent(intent){
        var concurrent;
        if(intent && this.active != intent){
            console.log('COMMITING', intent, this.active, traceback());
            /*
            if(this.active){
                concurrent = ((intent.entry.originalUrl||intent.entry.url) == (this.active.entry.originalUrl||this.active.entry.url));
                if(concurrent){ // both are intents from the same stream, decide for one of them
                    var a = this.intentTypesPriorityOrder.indexOf(intent.type);
                    var b = this.intentTypesPriorityOrder.indexOf(this.active.type);
                    var c = this.active.entry.originalUrl.indexOf('#nofit') != -1;
                    if(c || b <= a){ // new concurrent intent has lower (or equal) priority than the active intent
                        this.destroyIntent(intent);
                        console.log('COMMITING DISCARD', intent, this.active, a, b);
                        return false; // keep the current active
                    }
                }
            }
            */
            var allow = true;
            allow = applyFilters('preCommitAllow', allow, intent, this.active);
            if(allow === false){
                console.log('COMMITING DISALLOWED');
                this.destroyIntent(intent)
                return false // commiting canceled, keep the current active
            }

            var allow = true;
            allow = applyFilters('pre-commit', allow, intent, this.active)
            if(allow === false){
                console.log('COMMITING DISALLOWED *')
                this.destroyIntent(intent)
                return false // commiting canceled, keep the current active
            }
            
            // From here, the intent is already confirmed, so destroy any non-concurrent (different channel) intents and concurrent intents with lower or equal priority
            this.disconnect();
            for(var i=0; i<this.intents.length; i++){
                if(this.intents[i] != intent){
                    var active = (this.active == this.intents[i]);
                    concurrent = (
                        intent.entry.originalUrl == 
                        this.intents[i].entry.originalUrl
                    );
                    if(active){
                        this.emit('uncommit', this.active, intent)
                    }
                    if(concurrent){
                        var a = this.intentTypesPriorityOrder.indexOf(intent.type);
                        var b = this.intentTypesPriorityOrder.indexOf(this.intents[i].type);
                        if(a <= b){ // keep the current intent, discard this one
                            this.destroyIntent(this.intents[i])    
                        }
                    } else {
                        this.destroyIntent(this.intents[i])
                    }
                }
            }
            console.log('COMMITING ACTIVE', intent, this.intents);
            if(this.intents.indexOf(intent)==-1){
                this.registerIntent(intent);
            }
            this.lastActive = this.active = intent;
            this.active.shadow = false;
            this.active.committed = time();
            console.log('COMMITING AA', this.active);
            if(typeof(this.active.commit)=='function'){
                try {
                    this.active.commit()
                } catch(e) {
                    console.error(e)
                }
            }
            console.log('COMMITING BB', this.active)
            this.emit('commit', this.active, this.active.entry)
            this.active.emit('commit', this.active)
            console.log('COMMITING OK', this.intents)
            this.active.on('getVideo', (v) => {
                this.emit('getVideo', v)
            })
            if(this.active.getVideo()){
                this.emit('getVideo', this.active.video)
            }
            this.errors = {}
        } else {
            console.log('COMMITING - Already committed.')
        }
        this.lastCommitTime = time();
        this.emit('load-out')
    }
    getVideo(){
        if(this.active){
            var v = this.active.getVideo()
            if(v){
                return v
            }
        }
    }   
    getVideoSize(){
        var v = this.getVideo()
        if(v){
            return {width: v.videoWidth, height: v.videoHeight}
        }
    }   
    bufferedSecs(){
        var v = this.getVideo()
        if(v && v.duration && v.networkState != v.NETWORK_LOADING && v.readyState >= v.HAVE_FUTURE_DATA){
            return v.duration - v.currentTime
        }
        return -1
    }
    initRatio(){
        var s = this.detectRatio();
        if(s){
            this.setRatio(s)
        }
    }  
    detectRatio(){
        if(this.active){
            var v = this.active.getVideo();
            if(v){
                var s = this.getVideoSize(), r = s.width / s.height;
                var scaleModesInt = scaleModes.map(scaleModeAsInt);
                var c = closest(r, scaleModesInt), k = scaleModesInt.indexOf(c);
                return scaleModes[k];
            }
        }
    }  
    getRatio(){
        return Config.get('aspect-ratio') || '16:9';
    }
    setRatio(ratio){
        console.log('Set Ratio', traceback())
        var debug = debugAllow(false), oratio;
        if(typeof(ratio)!='string'){
            ratio = this.getRatio();
        } else {
            Config.set('aspect-ratio', ratio)
        }
        this.ratio = oratio = ratio;
        if(this.active){
            var v = this.active.getVideo()
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
        this.emit('setRatio', oratio)
    }
	prepareIntent(entry, options, ignoreCurrentPlaying, callback){
        if(!options) options = {}
        var allowedTypes = typeof(options.allowedTypes) != 'undefined' ? options.allowedTypes : false
        var shadow = (typeof(options.shadow)!='undefined' && options.shadow)
        var statusCode = 0, types = []
        var currentPlaybackType = '', currentPlaybackTypePriotity = -1
        var allowWebPages = typeof(entry.allowWebPages) == 'undefined' ? true : entry.allowWebPages
        var forceTranscode = typeof(entry.transcode) != 'undefined' && entry.transcode
        entry.url = String(entry.url) // Parameter "url" must be a string, not object
        entry.originalUrl = entry.originalUrl ? String(entry.originalUrl) : entry.url
        entry.name = String(entry.name)
        entry.logo = String(entry.logo)
        if(entry.logo == 'undefined'){
            entry.logo = ''
        }
        if(!ignoreCurrentPlaying && !shadow && Playback.active && Playback.active.entry.originalUrl == (entry.originalUrl || entry.url) && Playback.active.entry.name == entry.name){
            currentPlaybackType = Playback.active.type;
            currentPlaybackTypePriotity = Playback.intentTypesPriorityOrder.indexOf(currentPlaybackType); // less is higher
        }
        console.log('CHECK INTENT', allowedTypes, currentPlaybackType, currentPlaybackTypePriotity, entry, options, traceback());
        if(typeof(entry.originalUrl) == 'undefined'){
            entry.originalUrl = entry.url
        }
        console.log(entry.url)
        if(isMegaURL(entry.url)){ // mega://
            if(options.shadow){
                return callback({types: types, entry: entry, statusCode})
            }
            console.log('isMega');
            var data = parseMegaURL(entry.url)
            if(!data){
                return callback({types: types, entry: entry, statusCode})
            }
            console.log('PARTS', data)
            if(data.type == 'link'){
                entry.url = data.url
            } else if(data.type == 'play') {
                return callback({types: types, entry: entry, statusCode})
            }
        }
        if(getExt(entry.url)=='mega'){ // .mega
            entry = megaFileToEntry(entry.url)
            if(!entry){
                return callback({types: types, entry: entry, statusCode})
            }
        }
        var customType = false;
        Object.values(customMediaTypes).forEach((atts) => {
            if(atts.check && atts.check(entry.url, entry)){
                customType = atts.type
            }
        })
        if(customType) {
            if(!allowedTypes || allowedTypes.indexOf(customType) != -1){
                console.log('CREATEINTENT FOR ' + customType.toUpperCase(), entry.url)
                types.push(customType)
            }
        } else if(isRTMP(entry.url) || isRTSP(entry.url)){
            if(!allowedTypes || allowedTypes.indexOf('rtp') != -1){
                if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('rtp') < currentPlaybackTypePriotity){
                    console.log('CREATEINTENT FOR RTMP/RTSP', entry.url)
                    types.push('rtp')
                }
            }
        } else if(isRemoteTS(entry.url)){ // before isHTML5Video()
            // these TS can be >20MB and even infinite (realtime), so it wont run as HTML5, FFMPEG is a better approach so
            if(!allowedTypes || allowedTypes.indexOf('ts') != -1){
                console.log('CREATEINTENT FOR TS', entry.url);
                types.push('ts')
            }
        } else if(isM3U8(entry.url)){
            if(forceTranscode){
                if(!allowedTypes || allowedTypes.indexOf('transcode') != -1){
                    if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('transcode') < currentPlaybackTypePriotity){
                        console.log('CREATEINTENT FOR TRANSCODE', entry.url);
                        types.push('transcode')
                    }
                }
            } else {
                if(!allowedTypes || allowedTypes.indexOf('hls') != -1){
                    if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('hls') < currentPlaybackTypePriotity){
                        console.log('CREATEINTENT FOR M3U8', entry.url)
                        types.push('hls')
                    }
                }
            }
            
        } else if(isHTML5Media(entry.url)){
            if(forceTranscode){
                if(!allowedTypes || allowedTypes.indexOf('transcode') != -1){
                    if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('transcode') < currentPlaybackTypePriotity){
                        console.log('CREATEINTENT FOR TRANSCODE', entry.url);
                        types.push('transcode')
                    }
                }
            } else {
                if(!allowedTypes || allowedTypes.indexOf('mp4') != -1){
                    if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('mp4') < currentPlaybackTypePriotity){
                        console.log('CREATEINTENT FOR HTML5', entry.url)
                        types.push('mp4')
                    }
                }
            }
        } else if(isMedia(entry.url)){
            if(!allowedTypes || allowedTypes.indexOf('transcode') != -1){
                if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('transcode') < currentPlaybackTypePriotity){
                    console.log('CREATEINTENT FOR TRANSCODE', entry.url);
                    types.push('transcode')
                }
            }
        } else {
            return getHTTPInfo(entry.url, (ct, cl, url, u, st) => {
                console.log('CHECK INTENT', allowedTypes, ct, cl, url, u, st)
                statusCode = st
                if(st && st < 400){
                    let isHTML = ['html', 'htm'].indexOf(getExt(entry.url)) != -1
                    if(ct && ct.indexOf("text/html") != -1){
                        isHTML = true
                    }
                    if(isHTML) {
                        if(allowWebPages && (!allowedTypes || allowedTypes.indexOf('html') != -1)){
                            if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('html') < currentPlaybackTypePriotity){
                                console.log('CREATEINTENT FOR HTML', entry.url)
                                types.push('html')
                            }
                        }
                    } else  {
                        if(ct && ct.toLowerCase().indexOf("mp2t") != -1){
                            if(!allowedTypes || allowedTypes.indexOf('ts') != -1){
                                if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('ts') < currentPlaybackTypePriotity){
                                    console.log('CREATEINTENT FOR TS', entry.url, ct);
                                    types.push('ts')
                                }
                            }
                        } else if(!forceTranscode && ct && ct.toLowerCase().indexOf("mpegurl") != -1){
                            if(!allowedTypes || allowedTypes.indexOf('hls') != -1){
                                if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('hls') < currentPlaybackTypePriotity){
                                    console.log('CREATEINTENT FOR HLS', entry.url, ct);
                                    types.push('hls')
                                }
                            }
                        } else if(!forceTranscode && ct && ct.indexOf("video/mp4") != -1){
                            if(!allowedTypes || allowedTypes.indexOf('mp4') != -1){
                                if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('mp4') < currentPlaybackTypePriotity){
                                    console.log('CREATEINTENT FOR MP4', entry.url, ct);
                                    types.push('mp4')
                                }
                            }
                        } else {
                            if(!allowedTypes || allowedTypes.indexOf('transcode') != -1){
                                if(currentPlaybackTypePriotity == -1 || Playback.intentTypesPriorityOrder.indexOf('transcode') < currentPlaybackTypePriotity){
                                    console.log('CREATEINTENT FOR TRANSCODE', entry.url, ct);
                                    types.push('transcode') // not sure, so we'll race the possible intents
                                }
                            }
                        }
                    }
                }
                callback({types: types.getUnique(), entry: entry, statusCode})
            })
        }
        callback({types: types.getUnique(), entry: entry, statusCode})
    }    
    getIntentTypes(entry, options, callback){
        this.prepareIntent(entry, options, true, data => {
            callback(data.types.join(','))
        })
    }    
    createIntent(entry, options, forceTypes, _callback) {
        console.log('CREATE INTENT', entry, options, traceback(), forceTypes)
        var shadow = (typeof(options.shadow) != 'undefined' && options.shadow)
        var data, statusCode = 0, intents = []
        let callback = (e, i) => {
            if(typeof(_callback) == 'function'){
                _callback(e, i, statusCode)
                _callback = null
            }
        }
        console.log(entry.url);
        if(isMegaURL(entry.url)){ // mega://
            console.log('isMega')
            var megaUrl = entry.url, data = parseMegaURL(entry.url)
            if(!data){
                if(typeof(callback) == 'function'){
                    callback('Bad mega:// URL', [])
                }
                return
            }
            console.log('PARTS', data)
            if(data.type == 'link'){
                entry.url = data.url;
            } else if(data.type == 'play') {
                setTimeout(() => {
                    if(shadow){
                        tune(data.name, null, entry.originalUrl, (err, entry, intent) => {
                            if(err){
                                if(typeof(callback) == 'function'){
                                    callback(err, [])
                                }
                            } else if(intent && intent.entry) {
                                intent.entry.originalUrl = megaUrl
                                if(typeof(callback) == 'function'){
                                    callback(null, [intent])
                                }
                            } else {
                                entry.originalUrl = megaUrl
                                this.createIntent(entry, options, null, callback)
                            }
                        }, data.mediaType, true)
                    } else {
                        tuneNPlay(data.name, null, entry.originalUrl, (err, entry, intent) => {
                            if(err){
                                if(typeof(callback) == 'function'){
                                    callback(err, [])
                                }
                            } else if(intent.entry) {
                                try{
                                    intent.entry.originalUrl = megaUrl
                                }catch(e){
                                    console.error(e, intent, entry)
                                }
                                if(typeof(callback) == 'function'){
                                    callback(false, [intent])
                                }
                            } else {
                                entry.originalUrl = megaUrl
                                this.createIntent(entry, options, null, callback)
                            }
                        }, data.mediaType, true)
                    }
                }, 200)
                return
            }
        }
        let next = (data) => {
            console.log('CREATE INTENT RESULTS', data.types)
            if(data.statusCode){
                statusCode = data.statusCode
            }
            if(data.types.length){
                data.types = data.types.filter((type) => {
                    return !(typeof(options.allowedTypes) != 'undefined' && options.allowedTypes.indexOf(type) == -1)
                })
                console.log('TYPES', data.types, options.allowedTypes)
                data.types.forEach((type) => {
                    try{
                        intents.push(new this.engines[type](entry, options))
                    }catch(e){
                        console.error('ENGINE NOT FOUND', type, e)
                    }
                })
            }
            console.log('CREATED INTENTS', intents)
            if(intents.length){
                if(entry.source && isHTTP(entry.source)){
                    pingSource(entry.source)
                }
                intents.forEach((intent, index) => {
                    if(intent){
                        if(!shadow){
                            this.registerIntent(intent)
                        }
                        if(typeof(options.autorun) == 'undefined' || options.autorun === true){
                            intent.run()
                        }
                        return intent
                    } else {
                        console.log('Error: NO INTENT', intent, entry.url)
                    }
                })
                callback(null, intents)
            } else {
                callback('No compatible streams found.', [])
            }
        }
        if(Array.isArray(forceTypes)){
            next({types: forceTypes, entry})
        } else {
            this.prepareIntent(entry, options, false, next)
        }
    }
}

var Playback = new PlaybackManager()

function pingSource(url) {
    console.warn('Source ping', url) // Print the error if one occurred
    request({url, ttl: 60000}, (error, response, body) => {
        if(error){
            console.error('Source ping error', url, error) // Print the error if one occurred
        } else {
            console.warn('Source pinged', url, response.statusMessage) // Print the error if one occurred
        }
    })
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

function waitFileTimeout(file, callback, timeout, startedAt) {
    if(typeof(startedAt)=='undefined'){
        startedAt = time()
    }
    let check, cancelled, cancel = () => {
        cancelled = true
    }
    check = () => {
        if(cancelled){
            return
        }
        fs.stat(file, (err, stat) => {
            if(cancelled){
                return
            } else if (err == null) {
                callback(true)
            } else if((time() - startedAt) >= timeout) {
                callback(false)
            } else {
                setTimeout(check, 500)
            }
        })
    }
    check()
    return {cancel}
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
                process.nextTick(() => {
                    try {
                        top.document.dispatchEvent(n)  
                    } catch(e) {}
                })
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
    if(intent.manual && !intent.shadow && (!intent.destroyed || (Playback.lastActive && (intent.entry.url == Playback.lastActive.entry.url)))){
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

function notifyPlaybackStartError(entry, error){
    leavePendingState()
    setStreamStateCache(entry, false)
    sendStats('error', sendStatsPrepareEntry(entry))
    sound('static', 16)
    var message = getPlaybackErrorMessage(entry, error)
    notify(message, 'fa-exclamation-circle faclr-red', 'normal')
    console.log('STREAM FAILED', message, entry, Playback.log(), traceback())
}

function getPlaybackErrorMessage(intentOrEntry, error){
    console.warn('PLAYBACKERR', intentOrEntry, error)
    let entry = false
    if(intentOrEntry){
        if(typeof(intentOrEntry.entry) != 'undefined'){
            entry = intentOrEntry.entry
            if(intentOrEntry.error){
                error = intentOrEntry.error
            }
            if(intentOrEntry.statusCode && intentOrEntry.statusCode != 200){
                error = intentOrEntry.statusCode
            }
        } else if(typeof(intentOrEntry.url) != 'undefined'){
            entry = intentOrEntry
        }
    }
    var message = Lang.PLAY_STREAM_FAILURE.format(entry ? entry.name : '...')
    if(['p2p-disabled'].indexOf(error) != -1) {
        message += ' ' + Lang.P2P_DISABLED
    } else if([500, 502, 504, 520].indexOf(error) != -1) {
        message += ' ' + Lang.PLAYBACK_OVERLOADED_SERVER
    } else if([401, 403].indexOf(error) != -1) {
        message += ' ' + Lang.PLAYBACK_PROTECTED_STREAM
    } else if([0, 404, 'connect', 'invalid'].indexOf(error) != -1) {
        message += ' ' + Lang.PLAYBACK_OFFLINE_STREAM
    } else if(['timeout'].indexOf(error) != -1) {
        if(window.navigator.connection.downlink >= (averageStreamingBandwidth() * 2)){
            message += ' ' + Lang.SLOW_SERVER
        } else {
            message += ' ' + Lang.SLOW_CLIENT
        }
    } else if(['playback', 'transcode'].indexOf(error) != -1) {
        message += ' ' + Lang.PLAYBACK_ERROR
    } else if(typeof(error) == 'number' && error != 200) {
        message += ' ' + statusCodeToMessage(error)
    } else {
        message += ' Unknown error.'
    }
    return message
}

function continueLivePlayback(intent, hasErrors){
    let alternate = () => {
        if(!alternateStream(intent) && hasErrors){
            sound('static', 16)
            var message = getPlaybackErrorMessage(intent)
            notify(message, intent.entry.logo || 'fa-exclamation-circle faclr-red', 'normal');
            console.log('STREAM FAILED', message, intent.tuning, intent.error, intent.statusCode, intent.entry.originalUrl, Playback.log(), traceback())
        }
    }
    if(hasErrors){
        setStreamStateCache(intent.entry, false)
        sendStats('error', sendStatsPrepareEntry(intent.entry))
        if(shouldNotifyPlaybackError(intent)){ // don't alert user if has concurrent intents loading
            alternate()
        }
    } else {
        alternate()
    }
}

function continuePlayback(intent, hasErrors){
    if(intent.entry.mediaType == 'live'){
        continueLivePlayback(intent, hasErrors)
    } else if(hasErrors === false) {
        getNextStream(null, (e) => {
            if(e){
                (top || parent).playEntry(e)
            } else {
                (top || parent).stop()
                notify(Lang.NOT_FOUND, 'fa-ban', 'normal')
            }
        })
    } else {
        sound('static', 16)
        var message = getPlaybackErrorMessage(intent, hasErrors)
        notify(message, intent.entry.logo || 'fa-exclamation-circle faclr-red', 'normal')
        console.log('STREAM FAILED', message, intent.tuning, intent.error, intent.statusCode, intent.entry.originalUrl, Playback.log(), traceback())
    }
}

function setMediaTypeClass(c){
    ['live', 'video', 'audio'].forEach(t => {
        $body.removeClass('mt-' + t)
    })
    if(c){
        $body.addClass('mt-' + c)
    }
}

Playback.on('register', (intent, entry) => {
    intent.on('error', () => {
        if(!Playback.active || Playback.active == intent){
            setTimeout(() => {
                continuePlayback(intent, true)
            }, 200)
        }
    })
    intent.on('end', () => {
        // end of stream, go next
        console.log('STREAM ENDED', Playback.active, intent)
        if(!Playback.active || Playback.active == intent){
            console.log('STREAM ENDED', Playback.log(), intent.shadow)
            if(!intent.shadow){
                console.log('STREAM ENDED', Playback.log(), intent.entry.url, isLive(intent.entry.url), intent.entry.originalUrl)
                continuePlayback(intent, false)
            }
        }
    })
})

Playback.on('commit', (intent) => {
    console.log('COMMIT TRIGGERED');
    setMediaTypeClass(intent.entry.mediaType||'video')
    Menu.playState(true)
    setStreamStateCache(intent.entry, true)
    onIntentCommit(intent)
    sendStats('alive', sendStatsPrepareEntry(intent.entry))
    leavePendingState()
    intent.on('error', () => {
        console.error('Stream failure after commit', Playback.log())
    })
})

Playback.on('stop', () => {
    setMediaTypeClass('')
    setTitleData(appName(), '')
    Menu.playState(false)
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
        enterPendingState(title, Lang.CONNECTING)
    }
})

Playback.on('load-out', () => {
    leavePendingState()
    updateStreamEntriesFlags()
})

var engagingTimer = 0, engageTime = 180;

Playback.on('commit', (intent) => {
    clearTimeout(engagingTimer)
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
