//import { clearInterval } from 'timers';

var fs = require('fs'), os = require('os'), ffmpeg = require('fluent-ffmpeg'), peerflix;

var isPending = false;
var cpuCount = os.cpus().length;
var segmentDuration = 2;
var fitterEnabled = true
var FFmpegPath = path.dirname(process.execPath)+path.sep+'ffmpeg'+path.sep+'ffmpeg'
ffmpeg.setFfmpegPath(FFmpegPath);

var PlaybackManager = (() => {
    var self = {
		events: [], 
		intents: [], 
		wasLoading: false, 
        activeIntent: false, 
        lastActiveIntent: false,
        lastCommitTime: 0,
        intentTypesPriorityOrder: ['magnet', 'direct', 'youtube', 'ffmpeg', 'ts', 'frame']
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
    self.fullStop = () => {
        console.log('STOP', traceback());
        self.intents.forEach((intent, i) => {
            self.destroyIntent(intent)
        })
        console.log('FULLY STOPPED', self.intents);
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
    self.stop = () => {
        console.log('STOP', traceback());
        if(self.activeIntent){
            console.log('STOPPED', self.intents);
            self.destroyIntent(self.activeIntent);
            self.activeIntent = false;
            self.trigger('stop');
        }
        NativeStop();
        console.log('STOP OK');
    }
    self.getURL = () => {
        if(self.activeIntent){
            return self.activeIntent.entry.originalUrl || self.activeIntent.entry.url;
        }
    }
    self.isLoading = (fetch) => {
        var loadingIntents;
        if(typeof(fetch)=='string'){
            loadingIntents = self.query({originalUrl: fetch, ended: false, error: false, manual: true});
            return loadingIntents.length > 0;
        }
        var is = false, urls = [];
        loadingIntents = self.query({started: false, ended: false, error: false, isSideload: false, manual: true});
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
                if(self.intents[i] != self.activeIntent){
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
            if(self.intents[i] == self.activeIntent){
                state += ' active';
            }
            if(self.intents[i].isSideload){
                state = 'sideload '+state;
            }
            url = (self.intents[i].prxurl || self.intents[i].entry.url);
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
                        console.log('COMMITING DISCARD', intents[i], self.activeIntent, a, b);                        
                    } else { // keep current activeIntent
                        continue;
                    }
                }
                activeIntent = intents[i];
            }
        }
        // console.log('CHECK INTENTS', self.activeIntent, activeIntent, intents);
        if(activeIntent && activeIntent != self.activeIntent){
            self.commitIntent(activeIntent);
            self.trigger('load-out')
        } else if(!intents.length && self.activeIntent) {
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
            console.log('INTENT ENDED', traceback());
            setTimeout(PlaybackManager.checkIntents.bind(PlaybackManager), 1000)
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
        if(intent && self.activeIntent != intent){
            console.log('COMMITING', intent, self.activeIntent, traceback());
            /*
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
            */
            var allow = true;
            allow = applyFilters('preCommitAllow', allow, intent, self.activeIntent);
            if(allow === false){
                console.log('COMMITING DISALLOWED');
                self.destroyIntent(intent);
                return false; // commiting canceled, keep the current activeIntent
            }

            var allow = true;
            allow = intent.filter('pre-commit', allow, intent, self.activeIntent);
            if(allow === false){
                console.log('COMMITING DISALLOWED *');
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
            self.lastActiveIntent = self.activeIntent = intent;
            self.activeIntent.shadow = false;
            self.activeIntent.committed = true;
            console.log('COMMITING AA', intent);
            if(typeof(intent.commit)=='function'){
                try {
                    intent.commit()
                } catch(e) {
                    console.error(e)
                }
            }
            console.log('COMMITING BB', intent);
            self.trigger('commit', intent, intent.entry);
            setTimeout(self.initRatio, 400);
            setTimeout(self.initRatio, 1000);
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
        var debug = false;
        if(typeof(ratio)!='string'){
            ratio = self.getRatio();
        } else {
            Config.set('aspect-ratio', ratio)
        }
        if(self.activeIntent){
            var v = self.activeIntent.getVideo();
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
                v.style.setProperty("width", w+"px", "important");
                v.style.setProperty("height", h+"px", "important");
                v.style.setProperty("min-width", w+"px", "important");
                v.style.setProperty("min-height", h+"px", "important");
                v.style.setProperty("top", ((wh - h) / 2)+"px", "important");
                v.style.setProperty("left", ((ww - w) / 2)+"px", "important");
                v.style.setProperty("objectFit", "fill", "important");
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
    }
    return self;
})();

function preparePlayIntent(entry, options, ignoreCurrentPlaying){
    if(!options) options = {};
    var shadow = (typeof(options.shadow)!='undefined' && options.shadow);
    var initTime = time(), FFmpegIntentsLimit = 8, types = [];
    var currentPlaybackType = '', currentPlaybackTypePriotity = -1;
    var allowWebPages = typeof(entry.allowWebPages) == 'undefined' ? (!Config.get('ignore-webpage-streams')) : entry.allowWebPages;
    var forceTranscode = Config.get('force-transcode');
    entry.url = String(entry.url); // Parameter "url" must be a string, not object
    entry.originalUrl = entry.originalUrl ? String(entry.originalUrl) : entry.url;
    entry.name = String(entry.name);
    entry.logo = String(entry.logo);
    if(entry.logo == 'undefined'){
        entry.logo = '';
    }
    if(!ignoreCurrentPlaying && !shadow && PlaybackManager.activeIntent && PlaybackManager.activeIntent.entry.originalUrl == (entry.originalUrl || entry.url) && PlaybackManager.activeIntent.entry.name == entry.name){
        currentPlaybackType = PlaybackManager.activeIntent.type;
        currentPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(currentPlaybackType); // less is higher
    }
    console.log('CHECK INTENT', currentPlaybackType, currentPlaybackTypePriotity, entry, options, traceback());
    if(typeof(entry.originalUrl) == 'undefined'){
        entry.originalUrl = entry.url;
    }
    console.log(entry.url);
    if(isMega(entry.url)){ // mega://
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
    if(isMagnet(entry.url)){
        console.log('CREATEPLAYINTENT FOR MAGNET', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('magnet') < currentPlaybackTypePriotity){
            types.push('magnet')
        }
    } else if(isRTMP(entry.url) || isRTSP(entry.url)){
        console.log('CREATEPLAYINTENT FOR RTMP/RTSP', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            types.push('ffmpeg')
        }
    } else if(isRemoteTS(entry.url)){ // before isHTML5Video()
        // these TS can be >20MB and even infinite (realtime), so it wont run as HTML5, FFMPEG is a better approach so
        console.log('CREATEPLAYINTENT FOR TS', entry.url);
        types.push('ts')
    } else if(!forceTranscode && (isHTML5Video(entry.url) || isM3U8(entry.url))){
        console.log('CREATEPLAYINTENT FOR HTML5/M3U8', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('direct') < currentPlaybackTypePriotity){
            types.push('direct')
        }
    } else if(isMedia(entry.url)){
        console.log('CREATEPLAYINTENT FOR MEDIA', entry.url);
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            types.push('ffmpeg')
        }
    } else if(isYT(entry.url)){
        console.log('CREATEPLAYINTENT FOR YT', entry.url);
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(entry.url);
        if(id && id != 'live_stream' && entry.url.indexOf('#yt-live') == -1){
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('youtube') < currentPlaybackTypePriotity){
                types.push('youtube')
            }
        } else {
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
                types.push('frame')
            }
        }
    } else if(['html', 'htm'].indexOf(getExt(entry.url))!=-1) {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url);
        if(allowWebPages){
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
                if(!options || !options.isSideload){
                    types.push('frame')
                }
            }
        }
    } else  {
        console.log('CREATEPLAYINTENT FOR GENERIC', entry.url);
        if(allowWebPages){
            if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('frame') < currentPlaybackTypePriotity){
                if(!options || !options.isSideload){
                    types.push('frame')
                }
            }
        }
        if(currentPlaybackTypePriotity == -1 || PlaybackManager.intentTypesPriorityOrder.indexOf('ffmpeg') < currentPlaybackTypePriotity){
            if(PlaybackManager.query({type: 'ffmpeg', error: false, ended: false}).length < FFmpegIntentsLimit){
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

function createPlayIntent(entry, options, subIntentCreateCallback) {
    console.log('CREATE INTENT', entry, options, traceback());
    var shadow = (typeof(options.shadow)!='undefined' && options.shadow);
    var intents = [];
    console.log(entry.url);
    if(entry.source && isHTTP(entry.source)){
        pingSource(entry.source)
    }
    if(isMega(entry.url)){ // mega://
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
                    })
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
                    })
                }
            }, 200);
            return;
        }
    }
    var data = preparePlayIntent(entry, options);
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
                PlaybackManager.registerIntent(intent);
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
    })
}

function createBaseIntent(){

    var self = {};
    self.type = 'base';
    self.top = top; // reference for listeners
    self.attached = false;
    self.ctime = time();
    self.committed = false;
    self.statusCode = 0;
    self.manual = false;
    self.loaded = false;
    self.decoder = false;
    self.decoderOutputAppending = false;
    self.error = false;
    self.ended = false;
    self.entry = {};
    self.events = {};
    self.isSideload = false;
    self.videoElement = false;
    self.shadow = false;
    self.sideloads = [];
    self.sideloadTesters = [];
    self.started = false;
    self.controller = getFrame('player');
    self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';

    self.getUID = () => {
        var uid = parseInt(Math.random() * 1000000000), files = fs.readdirSync('stream');
        while(files.indexOf(String(uid)) != -1){
            uid++;
        }
        return uid;
    }

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

    self.rename = (newTitle, newLogo) => {
        self.entry.name = newTitle;
        if(newLogo){
            self.entry.logo = newLogo;
        }
        self.trigger('rename', self)
    }

    self.trigger = (action, ...arguments) => {
        var _args = Array.from(arguments);
        if(self && self.events && jQuery.isArray(self.events[action])){
            console.log(action, traceback());
            console.log(self.events[action]);
            console.log(self.events[action].length);
            for(var i=0; self && self.events[action] && i<self.events[action].length; i++){
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

    self.retry = () => {
        var _now = time();
        if(self.attached && !self.error && (!self.lastRetry || (_now - self.lastRetry) > 10) && !isVideo(self.entry.url)){
            console.log('file retry');
            self.lastRetry = _now;
            delete self.decoder;
            self.error = false;
            self.ended = false;
            self.run();
            return true;
        } else {
            self.error = 'timeout';
            self.trigger('error')
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
            self.videoElement = getFrame('player').videoElement()
        }
        if(self.videoElement){
            jQuery('body').removeClass('no-video')
        } else {
            jQuery('body').addClass('no-video')
        }
        return self.videoElement;
    }

    self.sideload = (url) => {
        var debug = false;
        /*
        if(self.shadow || !self.manual){
            console.log('SIDELOAD DISALLOW', 'testing entry');
            return;
        }
        */
        if(self.error || self.ended){
            console.log('SIDELOAD DISALLOW', 'we\'ve already gave up');
            return;
        }
        var surl = removeQueryString(url);
        if(self.sideloads.indexOf(surl) === -1){ // not already tried
            self.sideloads.push(surl);
            if(self.entry.url.indexOf('#nofit') == -1){
                if(isHTTP(url)){
                    getHTTPInfo(url, (ct, cl, url, u, status) => {
                        self.statusCode = status;
                        if(status > 400 && status < 500 && status != 403){
                            setTimeout(() => {
                                if(!self.started && !self.error && !self.ended){
                                    console.warn('Intent error after sideload failure timeout for', url, status);
                                    self.error = 'timeout';
                                    self.trigger('error')
                                }
                            })
                        } else {
                            if(isVideo(url)){
                                if(cl && cl > 10 * (1024 * 1024)){
                                    self.sideloadConfirm(url)
                                }
                            } else {
                                self.sideloadConfirm(url)
                            }
                        }
                    })
                } else {
                    self.sideloadConfirm(url)
                }
                return true;
            } else {
                if(debug){
                    console.log('SIDELOADPLAY SKIP, nofit set') // url already (side)loading
                }
            }
        } else {
            if(debug){
                console.log('SIDELOADPLAY SKIP, already tried that **', self.sideloads) // no frame intent
            }
        }
    }

    self.sideloadConfirm = (url) => {
        var debug = false, fine = true, loadingIntents = PlaybackManager.query({started: false, ended: false, error: false, isSideload: false}); // disallow sideloading if there are other channel intents loading already
        loadingIntents.forEach((intent) => {
            if(intent && intent.entry.originalUrl != self.entry.originalUrl){
                fine = false;
            }
        }); 
        if(!fine){
            console.log('SIDELOAD DISALLOW', 'other channel is loading');
            return false;
        }
        var parentSelf = self, entry = Object.assign({}, self.entry);
        entry.url = url;
        if(debug){
            console.log('SIDELOADPLAY OK', entry, url)
        }
        testEntry(entry, (succeededIntent) => {
            console.log('SIDELOADPLAY SUCCESS', entry, succeededIntent);
            if(parentSelf.error || parentSelf.ended){ 
                console.log('PRE-COMMIT DISALLOW', succeededIntent, PlaybackManager.intents, 'we already gave up *');
                if(succeededIntent){
                    succeededIntent.destroy()
                }
                return false;
            }
            if(succeededIntent){
                if(PlaybackManager.activeIntent){
                    // playing something
                    if(PlaybackManager.activeIntent.entry.originalUrl == succeededIntent.entry.originalUrl){
                        // playing the same channel, check intent type priority so
                        var currentPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(PlaybackManager.activeIntent.type); // less is higher
                        var newPlaybackTypePriotity = PlaybackManager.intentTypesPriorityOrder.indexOf(succeededIntent.type); // less is higher
                        if(newPlaybackTypePriotity < currentPlaybackTypePriotity){
                            console.log('PRE-COMMIT OK, higher priority');
                        } else {
                            console.log('PRE-COMMIT DISALLOW (priority)', succeededIntent, PlaybackManager.intents, newPlaybackTypePriotity, currentPlaybackTypePriotity);
                            if(succeededIntent){
                                succeededIntent.destroy()
                            }
                            return false;
                        }
                    } else {
                        // playing other channel, commit anyway so
                        // remember, on hit play on a channel, cancel any inactive or loading intents, keep only the "actually playing" intent
                        // ... 
                        console.log('PRE-COMMIT OK, changing channel');
                    }
                } else {
                    // not yet playing, not it will be!
                    console.log('PRE-COMMIT OK, wasn\'t playing');
                }
                /*
                succeededIntent.ended = false;
                succeededIntent.manual = true;
                succeededIntent.shadow = false;
                PlaybackManager.registerIntent(succeededIntent);
                PlaybackManager.commitIntent(succeededIntent)
                */
                succeededIntent.destroy()
            }
            self.manual = false;
            self.shadow = true;
            createPlayIntent(entry, {skipTest: true, manual: true, shadow: false})
        }, () => {
            console.log('SIDELOADPLAY FAILURE', entry)
        }, true, (intent) => {
            self.sideloadTesters.push(intent)
        })
    }

    self.apply = (options) => {
        for(var key in options){
            if(typeof(options[key])=='function'){
                self.on(key, options[key])
            } else if(key == 'timeout'){
                self.setTimeout(options[key])
            } else {
                self[key] = options[key];
            }
        }
    }

    self.destroy = () => {
        if(self && self.trigger){
            self.trigger('destroy')  
        }
    }   

    self.clear = () => {
        if(self.tester){
            self.tester.cancel();
            self.tester = null;
        } 
        if(self.decoder){
            self.decoder.kill('SIGKILL');
            if (self.decoder.file) {
                removeFolder(dirname(self.decoder.file), true);
            }
            self.decoder = null;
        }
        self.events = [];
        self.attached = self.videoElement = false;  
    }    

    self.on('error destroy', () => {
        console.log('ERROR TRIGGERED');
        self.sideloadTesters.forEach((sideloadTestIntent) => {
            sideloadTestIntent.destroy()
        });
        self.attached = false; 
        if(self.frame){
            self.frame.src = 'about:blank';
            if(self.frame.parentNode){
                self.frame.parentNode.removeChild(self.frame)
            }
            self.frame = null;
        }
        if(self.tester){
            self.tester.cancel();
            self.tester = null;
        } 
        if(self.decoder){
            self.decoder.kill('SIGKILL');
            if (self.decoder.file) {
                removeFolder(dirname(self.decoder.file), true);
            }
            self.decoder = null;
        }
        self.videoElement = false;  
        console.warn('Intent cleaned.')
    })

    self.on('destroy', () => {
        self.ended = true;
        self.attached = false; 
        clearTimeout(self.timeoutTimer);
    })

    self.timeoutTimer = 0;
    self.timeout = Config.get('connect-timeout') + (Config.get("min-buffer-secs-before-commit") * 1.5);
    
    self.calcTimeout = (secs) => {
        return secs * 1000;
    }
    
    self.setTimeout = (secs) => {
        self.timeout = secs;
        clearTimeout(self.timeoutTimer);
        if(!self.committed && !self.error){
            var s = time();
            self.timeoutTimer = setTimeout(() => {
                if(self && !self.committed && !self.error && !self.ended){
                    console.error('Commit timeout.', time() - s);
                    self.error = 'timeout';
                    self.trigger('error')
                }
            }, self.calcTimeout(secs))
        }
    }
    
    self.resetTimeout = () => {
        self.setTimeout(self.timeout)
    }

    self.setTimeout(self.timeout);

    return self;
}

function createFrameIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'frame';
    self.entry = entry;
    self.fittedElement = false;
    self.fittedScope = false;
    self.allowMediaSourcePausing = true;
    
    self.frame = document.createElement('iframe');
    self.frame.className = "fit-screen hide"; 
    self.frame.nwdisable = true;
    self.frame.nwfaketop = true;
    self.frame.height = "100%";
    self.frame.setAttribute('allowFullScreen', '');
    document.querySelector('body').appendChild(self.frame);

    self.run = () => {    
        if(isHTTP(self.entry.url)){
            self.runConfirm();
            getHTTPInfo(self.entry.url, (ct, cl, url, u, status) => { // OK
                self.statusCode = status;
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct, status);
                    if(status && status < 400 && (!ct || ['text/html'].indexOf(ct.toLowerCase()) != -1)){
                        // OK
                    } else {
                        console.error('Bad HTTP response for '+self.type, ct, status);
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
            if(self.manual && self.entry.url.match(new RegExp('#(catalog|nosandbox|nofit)([^A-Za-z0-9]|$)'))){
                self.started = true;
                self.trigger('start');
            }
        }
    }

    self.detectDOMLoad = (callback) => {
        var c = false;
        if(self && self.frame && (c=self.allowFitter())){
            if(['interactive', 'complete'].indexOf(c.document.readyState) == -1){
                c.document.onreadystatechange = () => {
                    self.detectDOMLoad(callback)
                }
            } else {
                callback()
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
                self.fittedScope = result.scope;
                self.fittedScope.addEventListener('unload', () => {
                    if(!self.error && !self.ended){
                        self.videoElement = false;
                        self.fittedElement = false;
                        setTimeout(self.runFitter, 2000)
                    }
                });
                self.fittedElement = result.element;
                self.getVideo();
                self.started = true;
                self.trigger('start');
                PlaybackManager.setRatio();
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
                console.log('intent.runFitter()', time());
                Fitter.start(c, self);
                self.fitterTimer = setTimeout(self.runFitter, interval);
                console.log('intent.runFitter() OK')
            }
        }, 50);
        console.log('intent.runFitter() -1', time());
        return self.started;
    }
      
    self.commit = () => {
        NativeStop();
        jQuery(document).find('iframe#sandbox').not(self.frame).remove();
        jQuery(self.frame).removeClass('hide').addClass('show').prop('id', 'sandbox');
        self.frame.id = 'sandbox';
        var w = self.fittedScope || self.frame.contentWindow || false;
        if(w){
            enableEventForwarding(w)
        }
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
                notify(Lang.CANNOT_PAUSE, 'fa-exclamation-circle faclr-red', 'normal')
            }
        }
    }
    
    self.seek = (secs) => {
        if(self.getVideo()){
            if(self.allowMediaSourcePausing || self.videoElement.currentSrc.indexOf('blob:')==-1){
                self.videoElement.currentTime += secs;
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
        if(!self.videoElement && self.fittedElement){
            if(self.fittedElement.tagName && self.fittedElement.tagName.toLowerCase()=='video'){
                self.videoElement = self.fittedElement;
            } else {
                if(self.fittedElement.querySelector){
                    self.videoElement = self.fittedElement.querySelector('video')
                } else if(self.fittedScope && self.fittedScope.document) {
                    self.videoElement = self.fittedScope.document.querySelector('video')
                }
            }
            if(self.videoElement){
                console.log('PATCHING VIDEO', self.videoElement, self.videoElement.src, self.videoElement.currentTime);
                prepareVideoObject(self.videoElement, self);
                self.videoElement.muted = false;
                if(isHTTP(self.videoElement.currentSrc)){
                    self.sideload(self.videoElement.currentSrc)
                }
            }
        }
        if(self.videoElement){
            jQuery('body').removeClass('no-video')
        } else {
            jQuery('body').addClass('no-video')
        }
        return self.videoElement;
    }

    self.on('error destroy', () => {
        console.log('ERROR TRIGGERED');
        if(self.frame){
            self.frame.src = 'about:blank';
            jQuery(self.frame).remove();
            delete self.frame;
        }
    });

    self.on('commit', () => {
        document.querySelector('body').appendChild(self.frame);
    });

    
    document.querySelector('body').appendChild(self.frame);

    if(options){
        self.apply(options)
    }

    document.body.appendChild(self.frame);

    return self;

}

function createDirectIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'direct';
    self.entry = entry;
    self.prx = false;
    self.prxurl = false;
    self.tester = false;
        
    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.prxurl, self.mimetype, 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.error('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            (data) => { // error
                console.error('Playback error.', data.originalEvent.path[0].error || data, self.decoder.file, data);
                self.error = 'playback';
                self.trigger('error')
            });
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }
    
    self.runConfirm = () => {
        self.prxurl = self.entry.url;
        if(self.prxurl.match(new RegExp('(https?://).*m3u8'))){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        } else {
            self.mimetype = 'video/mp4; codecs="avc1.4D401E, mp4a.40.2"';
        }
        var p = getFrame('testing-player');
        if(!p || !p.test){
            console.error('No iframe#testing-player found.');
            self.error = 'internal';
            self.trigger('error')
        } else {
            self.resetTimeout();
            console.log('Testing', self.prxurl, self.entry.url, self.mimetype, self, traceback());
            self.tester = p.test(self.prxurl, self.mimetype, () => {
                if(!self.error && !self.ended){
                    console.log('Test succeeded. '+self.prxurl);
                    self.started = true;
                    self.trigger('start')
                }
            }, (data) => {
                if(!self.error && !self.ended){
                    console.error('Test Failed. '+self.prxurl, data);
                    self.error = 'playback';
                    self.trigger('error')
                }
            });
            console.log('Testing')
        }
    }

    self.run = () => {    
        if(self.skipTest || isLocal(self.entry.url)){
            self.runConfirm()
        } else if(isHTTP(self.entry.url)){
            self.runConfirm();
            getHTTPInfo(self.entry.url, (ct, cl, url, u, status) => { // OK
                self.statusCode = status;
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct);
                    if(status && status < 400 && (!ct || [
                        'application/octet-stream',
                        'audio/x-mpegurl', 
                        'video/x-mpegurl', 
                        'application/x-mpegurl', 
                        'video/mp2t', 
                        'application/vnd.apple.mpegurl', 
                        'video/mp4', 
                        'audio/mp4', 
                        'video/webm', 
                        'audio/webm',
                        'audio/ogg',
                        'video/ogg',
                        'video/x-m4v', 
                        'video/m4v',
                        'audio/aac',
                        'application/x-winamp-playlist', 
                        'audio/mpegurl', 
                        'audio/mpeg-url', 
                        'audio/playlist', 
                        'audio/scpls', 
                        'audio/x-scpls'
                        ].indexOf(ct.toLowerCase()) != -1)){
                        // OK
                    } else {
                        console.error('Bad HTTP response for '+self.type, ct, status);
                        self.error = status || 'connect';
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
    self.decoderOutputAppending = true;

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.decoder.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                playPauseNotify()
            },
            () => { // ended
                console.log('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            (data) => { // error
                console.error('Playback error.', data.originalEvent.path[0].error || data, self.decoder.file, data);
                self.error = 'playback';
                self.trigger('error')
            });
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }
    
    self.callDecoder = (ct) => {
        var uid = self.getUID();
        self.prxurl = self.entry.url;
    
        if(['m3u', 'm3u8'].indexOf(getExt(self.prxurl))!=-1 && self.proxify){
            console.log('PRX run');
            self.prx = getHLSProxy();
            self.prxurl = self.prx.getURL(self.prxurl)
        }

        self.decoder = ffmpeg(self.prxurl).
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
            self.decoder
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (!self.prx){
                self.decoder.inputOptions('-multiple_requests 1')
            }
            if (self.entry.url.indexOf('https') == 0) {
                self.decoder.inputOptions('-tls_verify 0')
            }
        }

        if(self.transcode){
            self.decoder.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast');
        }
    
        // setup event handlers
        self.decoder.
        on('codecData', (codecData) => {
            console.warn('CODECDATA', codecData.video.substr(0, 4), codecData);
            if(codecData.video && codecData.video.substr(0, 4) != 'h264' && self.videoCodec == 'copy' && !self.error && !self.ended){
                console.warn('TRANSCODE', dirname(self.decoder.file));
                self.videoCodec = 'libx264';
                self.error = true;
                self.decoder.kill('SIGKILL');
                self.error = false;
                removeFolder(dirname(self.decoder.file), false, self.runConfirm)
            }
        }).
        on('end', () => {
            console.log('file ended');
            self.retry() // will already call error on failure
        }).
        on('error', function(err) {
            console.error('an error happened: ' + err.message);
            self.error = 'ffmpeg';
            self.trigger('error')
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command: ' + commandLine, self.entry, ct);
            // ok, but wait file creation to trigger "start"
        });
    
        self.decoder.file = 'stream/' + uid + '/output.m3u8';
    
        mkdirp(dirname(self.decoder.file));
    
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    var p = getFrame('testing-player');
                    if(!p || !p.test){
                        console.error('No iframe#testing-player found.');
                        self.error = 'internal';
                        self.trigger('error')
                    } else {
                        self.resetTimeout();
                        console.log('Testing', self.decoder.file, self.entry.url, self.mimetype, self, traceback());
                        self.tester = p.test(self.decoder.file, self.mimetype, () => {
                            if(!self.error && !self.ended){
                                console.log('Test succeeded. '+self.prxurl);
                                self.started = true;
                                self.trigger('start')
                            }
                        }, (data) => {
                            if(!self.error && !self.ended){
                                console.error('Test Failed. '+self.prxurl, data);
                                self.error = 'playback';
                                self.trigger('error')
                            }
                        });
                        console.log('Testing')
                    }
                } else {
                    console.error('M3U8 file creation timeout.');
                    self.error = 'ffmpeg';
                    self.trigger('error')
                }
            }
        }, 1800);
        self.decoder.output(self.decoder.file).run();
        self.resetTimeout()
    }
    
    self.run = () => {
        if(isHTTP(self.entry.url)){
            getHTTPInfo(self.entry.url, (ct, cl, url, u, status) => {
                self.statusCode = status;
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct);
                    if(ct.indexOf('text/html') != -1 || status >= 400){
                        console.error('Bad HTTP response for '+self.type, ct, status);
                        self.error = status || 'connect';
                        self.trigger('error');
                        return;
                    }
                    self.transcode = Config.get('force-transcode') || (!ct || [
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
                    self.videoCodec = self.transcode ? 'libx264' : 'copy';
                    self.callDecoder(ct)
                }
            })        
        } else {
            self.callDecoder(null)
        }
    }

    if(options){
        self.apply(options);
        //console.log('ZZZZ', options, self);
    }

    return self;

}

function createTSIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ts';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.prxurl = false;
    self.prx = false;
    self.transcode = Config.get('force-transcode');
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.softErrors = [];
    self.tsDuration = 0;
    self.tsFetchStart = 0;
    self.decoderOutputAppending = true;
    
    var uid = self.getUID(), file = 'stream/' + uid + '/output.m3u8';

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        NativePlayURL(self.decoder.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"', 
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
                console.log('Playback ended.'); // wait for FFMPEG chunks
                self.ended = true;
                self.trigger('ended')
            },
            (data) => { // error
                console.error('Playback error.', data.originalEvent.path[0].error || data, self.decoder.file, data);
                self.error = 'playback';
                self.trigger('error')
            });
        self.videoElement = self.controller.videoElement();
        self.attached = true;
    }

    mkdirp(dirname(file));
    
    self.runConfirm = () => {
        console.log('RunConfirm', file);
        self.prxurl = getTSProxy().getURL(self.entry.url);
        console.log('RunConfirm', self.prxurl, file);

        if(self.decoder){
            try {
                self.decoder.off('error');
                self.decoder.kill('SIGKILL')
            } catch(e) {}
        }

        self.decoder = ffmpeg(self.prxurl).
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
        addOption('-vsync 1').
        addOption('-sn').
        format('hls');
    
        if(self.videoCodec == 'libx264') {
            self.decoder.
                addOption('-g', '30').
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'baseline');      
        } else if(self.videoCodec == 'copy') {
            self.decoder.
                addOption('-copyts');
        }

        var hlsFlags = 'delete_segments', alreadyExists = fs.existsSync(file);
        if(alreadyExists) {
            hlsFlags += ' append_list';
        } else {
            mkdirp(dirname(file));   
        }
        self.decoder.addOption('-hls_flags', hlsFlags);

        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.decoder
                .inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                .inputOptions('-icy 0')
                .inputOptions('-seekable 1')
            if (self.entry.url.indexOf('https') == 0) {
                self.decoder.inputOptions('-tls_verify 0')
            }
        }
    
        // setup event handlers
        self.decoder.
        on('codecData', (codecData) => {
            console.warn('CODECDATA', codecData.video.substr(0, 4), codecData);
            if(codecData.video && codecData.video.substr(0, 4) != 'h264' && self.videoCodec == 'copy' && !self.error && !self.ended){
                console.warn('TRANSCODE', dirname(self.decoder.file));
                self.videoCodec = 'libx264';
                self.error = true;
                self.decoder.kill('SIGKILL');
                self.error = false;
                removeFolder(dirname(self.decoder.file), false, self.runConfirm)
            }
        }).
        on('end', (err) => {
            console.log('file ended', err);
            self.retry() // will already call error on failure
        }).
        on('error', function(err, sout, serr) {
            if(err.message.indexOf('ffmpeg was killed with signal') == -1) {
                if(!self.error){
                    self.error = 'ffmpeg';
                    self.trigger('error')
                }
            } 
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command:', commandLine);
            // ok, but wait file creation to trigger "start"
        });    
        self.decoder.file = file;     
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    console.log('M3U8 file created.');
                    //self.started = true;
                    //self.trigger('start');

                    var p = getFrame('testing-player');
                    if(!p || !p.test){
                        console.error('No iframe#testing-player found.');
                        self.error = 'internal';
                        self.trigger('error')
                    } else {
                        self.resetTimeout();
                        console.log('Testing', self.decoder.file, self.entry.url, self.mimetype, self, traceback());
                        self.tester = p.test(self.decoder.file, self.mimetype, () => {
                            if(!self.error && !self.ended){
                                console.log('Test succeeded. '+self.prxurl);
                                self.started = true;
                                self.trigger('start')
                            }
                        }, (data) => {
                            if(!self.error && !self.ended){
                                console.error('Test Failed. '+self.prxurl, data);
                                self.error = 'playback';
                                self.trigger('error')
                            }
                        });
                        console.log('Testing')
                    }

                } else {
                    console.error('M3U8 file creation timeout.');
                    self.error = 'ffmpeg';
                    self.trigger('error')
                }
            }
        }, 1800);
        self.decoder.output(self.decoder.file).run();
        self.resetTimeout()
    }

    self.run = () => {    
        if(isLocal(self.entry.url)){
            self.runConfirm()
        } else if(isHTTP(self.entry.url)){
            self.runConfirm();
            getHTTPInfo(self.entry.url, (ct, cl, url, u, status) => {
                self.statusCode = status;
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, ct, status);
                    if(status && status < 400 && (!ct || [
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
                        ].indexOf(ct.toLowerCase())) != -1){
                        if(!self.error && !self.ended){
                            // OK
                        }
                    } else {
                        console.error('Bad HTTP response for '+self.type, ct, status);
                        self.error = status || 'connect';
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

    if(options){
        self.apply(options);
        //console.log('ZZZZ', options, self);
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
    self.useDecoder = false;
    self.decoderOutputAppending = true;
        
    self.commit = () => {
        NativePlayURL(self.useDecoder ? self.decoder.file : self.endpoint, self.useDecoder ? 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"' : 'video/mp4', 
            () => { // started
                self.videoElement = getFrame('player').videoElement();
                /*
                console.log('STARTS');
                if(0 && !self.unpaused){
                    self.unpaused = true;
                    self.videoElement = getFrame('player').videoElement();
                    //playPauseNotify()
                    var o = getFrame('overlay');
                    if(o){
                        jQuery(o.document).one('mousemove', () => {
                            console.log('WAKENPLAY');
                            PlaybackManager.play()
                        })
                    }
                }
                */
            },
            () => { // ended
                console.error('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            (data) => { // error
                console.error('Playback error.', data.originalEvent.path[0].error || data, self.decoder.file, data);
                self.error = 'playback';
                self.trigger('error')
            }, false);
        jQuery('#player').removeClass('hide').addClass('show');
        self.attached = true;
        self.videoElement = self.controller.videoElement();
        self.on('play', self.hideStats);
        self.on('pause', self.showStats);
        window.focus()
    }

    self.showStats = () => {
        if(self.notify){
            self.subNotify.show();
            self.notify.show()
        }
    }

    self.hideStats = () => {
        if(self.notify){
            //self.notify.update(false, false, 'short');
            self.notify.close();
            self.subNotify.close()
        }
    }
    
    self.run = () => {
        console.log('run() called');
        self.subNotify = notify(Lang.CAN_BE_SLOW, 'fa-coffee faclr-yellow', 'wait');
        self.notify = notify(Lang.SEARCHING_PEERS, 'fa-magnet', 'wait');
        notifyRemove(Lang.CONNECTING);
        if(self.endpoint){
            console.log('About to stream...');
            self.stream()
        }
    }

    self.destroy = () => {
        self.hideStats();
        clearInterval(self.progressTimer);
        self.peerflix.destroy();
        self.trigger('destroy')
    }
    
    self.stream = () => {
        if(self.useDecoder){
            self.decoder = ffmpeg(self.endpoint).
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
                self.decoder.
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
                self.decoder.inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                    .inputOptions('-icy 0')
                    .inputOptions('-seekable 1')
                if (self.entry.url.indexOf('https') == 0) {
                    self.decoder.inputOptions('-tls_verify 0')
                }
            }
        
            // setup event handlers
            self.decoder.
            on('end', () => {
                console.log('file ended');
            }).
            on('error', function(err) {
                console.error('an error happened: ' + err.message);
                self.error = 'ffmpeg';
                self.trigger('error')
            }).
            on('start', function(commandLine) {
                console.log('Spawned FFmpeg with command: ' + commandLine);
                // ok, but wait file creation to trigger "start"
            });    
            self.decoder.file = 'stream/' + uid + '/output.m3u8';    
            mkdirp(dirname(self.decoder.file));    
            waitInstanceFileExistsTimeout(self, function (exists) {
                if(!self.ended && !self.error){
                    if(exists){
                        console.log('M3U8 file created.');
                        self.started = true;
                        self.trigger('start');
                        clearInterval(self.progressTimer);
                        if(self.notify){
                            self.notify.update(false, false, 'short');
                            self.subNotify.close()
                        }
                    } else {
                        console.error('M3U8 file creation timeout.');
                        self.error = 'ffmpeg';
                        self.trigger('error')
                    }
                }
            }, 1800);
            self.decoder.output(self.decoder.file).run();
            self.resetTimeout()
        } else {
            self.started = true;
            self.trigger('start');
            clearInterval(self.progressTimer);
            if(self.notify){
                self.notify.update(false, false, 'short');
                self.subNotify.close()
            }
        }
    }

    var uid = self.getUID();
    self.setTimeout(600);

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
                    duration = 'short';
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

    self.on('error', self.hideStats);
    self.on('error', () => {
        clearInterval(self.progressTimer)
    });
    self.on('end', () => {
        clearInterval(self.progressTimer)
    });

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
                console.error('Playback ended.');
                self.ended = true;
                self.trigger('ended')
            },
            (data) => { // error
                console.error('Playback error.', data.originalEvent.path[0].error || data, self.decoder.file, data);
                self.error = 'playback';
                self.trigger('error')
            });
        jQuery('#player').removeClass('hide').addClass('show');
        self.attached = true;
        self.videoElement = self.controller.videoElement();
        window.focus()
    }
    
    self.run = () => {
        console.log('run() called');
        if(typeof(ytdl)=='undefined'){
            ytdl = require('ytdl-core')
        }
        var id = ytdl.getURLVideoID(self.entry.url);
        console.log('run() id', id, self.entry.url);
        ytdl.getInfo(id, (err, info) => {
            if (err){
                console.log('YTDL error');
                self.error = 'connect';
                self.trigger('error')
                throw err;
            } else {
                console.log('YT Info', info);
                if(info.title) {
                    self.rename(info.title, info.thumbnail_url)
                }
                var live = [];
                for(var i=0;i<info.formats.length;i++){
                    if(info.formats[i].live){ // live stream 
                        console.log('YT Info live', info.formats[i]);
                        if(info.formats[i].profile == 'main' && info.formats[i].audioEncoding == 'aac' && isM3U8(info.formats[i].url)){ // compatible m3u8
                            console.log('YT Info live OK', info.formats[i]);
                            live.push(info.formats[i])
                        }
                    } else if(!live.length) {
                        console.log('YT Info', info.formats[i]);
                        if(info.formats[i].type.match('mp4.*,')){ // mp4 including audio
                            self.endpoint = info.formats[i].url;
                            self.ctype = info.formats[i].type;
                            self.started = true;
                            self.trigger('start');
                            return;
                            break;
                        }
                    }
                }
                console.log('YT Info', live);
                if(live.length){

                    /*
                    var playlist = "#EXTM3U\r\n";
                    live.reverse().forEach((stream) => {
                        var bitrate = stream.bitrate;
                        bitrate = bitrate.split('-').pop();
                        bitrate = parseFloat(bitrate) * 1000000;
                        playlist += "#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH="+bitrate+", CODECS=\"avc1.4D401E, mp4a.40.2\"\r\n";
                        playlist += getHLSProxy().getURL(stream.url) + "\r\n\r\n";
                    });
                    var playlistFile = 'stream/'+id+'/index.m3u8';
                    mkdirp(dirname(playlistFile));
                    fs.writeFile(playlistFile, playlist, () => {
                        var hr = self.sideload(playlistFile);
                        if(hr){
                            console.warn('Sideload called', playlistFile, playlist);
                            // dont trigger error for now
                            self.manual = false;
                            self.shadow = true;
                            setTimeout(() => {
                                self.error = true;
                                self.trigger('error');
                            }, 20000); // give some ttl to the sideload created
                        } else {
                            console.error('Sideload refused', playlistFile, playlist);
                            self.error = true;
                            self.trigger('error');
                        }
                        return;
                    });
                    */
                    
                    //var hr = self.sideload('https://www.youtube.com/v/'+id+'?autoplay=1&showinfo=0&iv_load_policy=3&rel=0&modestbranding=1#yt-live');
                    var hr = self.sideload('https://www.youtube.com/tv#/watch/video/control?v='+id+'&resume#nosandbox#yt-live');
                    if(hr){
                        console.warn('Sideload called');
                        // dont trigger error for now
                        self.manual = false;
                        self.shadow = true;
                        setTimeout(() => {
                            self.error = 'timeout';
                            self.trigger('error');
                        }, 20000); // give some ttl to the sideload created
                    } else {
                        console.error('Sideload refused');
                        self.error = 'invalid';
                        self.trigger('error');
                    }

                    return;                    
                }
                console.error('No compatible formats', info);
                self.error = 'invalid';
                self.trigger('error')
            }
        })
    }

    self.destroy = () => {
        clearInterval(self.progressTimer);
        self.trigger('destroy') 
    }

    var uid = self.getUID();

    if(options){
        self.apply(options)
    }
    
    return self;

}

var currentScaleMode = 0, scaleModes = ['21:9', '16:9', '16:10', '4:3'];
function changeScaleMode(reverse){
    if(PlaybackManager.activeIntent){
        var v = PlaybackManager.activeIntent.videoElement;
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
            PlaybackManager.setRatio(scaleModes[currentScaleMode]);
            notify('Scale: '+scaleModes[currentScaleMode], 'fa-expand', 'short');
            if(miniPlayerActive){
                var ratio = scaleModeAsInt(scaleModes[currentScaleMode]), nwh = jQuery('body').height(), nww = Math.round(nwh * ratio);
                console.log('QQQ', nww, nwh, ratio);
                window.resizeTo(nww, nwh);
                window.moveTo(screen.availWidth - nww - miniPlayerRightMargin, screen.availWidth - nwh)
            }       
        }        
    }
}

function scaleModeAsInt(scaleMode){
    var n = scaleMode.split(':');
    return parseInt(n[0]) / parseInt(n[1])
}

function NativePlayURL(dest, mimetype, started, ended, error, paused) {
    showPlayers(true, false);
    if(!mimetype){
        mimetype = 'application/x-mpegURL';
    }
    console.log('WAITREADY');
    var pl = getFrame('player');
    pl.src(dest, mimetype);
    pl.ready(() => {
        var ap = false, v = jQuery(pl.document.querySelector('video'));
        if(v){
            if(started){
                console.log('STARTED', ap, paused);
                if(!ap && paused){
                    ap = true;
                    setTimeout(() => {
                        console.log('PAUSING');
                        PlaybackManager.pause() // use PlaybackManager to trigger the notifies from createMagnetIntent
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
    });
    setTimeout(() => {
        PlaybackManager.setRatio()
    }, 2000)
}

function NativeStop() {
    var pl = getFrame('player');
    pl.stop();
    showPlayers(0, 0)
}

var HLSProxyInstance, fetchAgent = new http.Agent({ 
    keepAlive: true 
}), fetchOpts = {
    redirect: 'follow',
    agent: fetchAgent
};

function getHLSProxy(){
    if(!HLSProxyInstance) {
        var debug = false, port = 0, closed;
        HLSProxyInstance = http.createServer((request, response) => {
            if(closed){
                return;
            }
            if(debug){
                console.log('request starting...', request);
            }
            var headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            }
            var url = request.url.split('#')[0];
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://');
            }
            if(url.indexOf('crossdomain.xml')!=-1){
                headers = setHTTPHeaderInObject({'Content-Type': 'text/xml'}, headers);
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
            if(getExt(url) == 'ts'){
                if(debug){
                    console.log('start fetching...')
                }
                HLSProxyInstance.fetch(url, (buffer, headers, code) => {
                    headers = setHTTPHeaderInObject({'Content-Type': 'video/MP2T'}, headers);
                    if(debug){
                        console.log('responding', buffer)
                    }
                    buffer = bufferize(buffer);  
                    response.writeHead(code, headers);
                    response.write(buffer, 'binary');
                    response.end();
                    if(debug){
                        console.log('fine.')
                    }
                    doAction('media-save', url, buffer, 'content');
                    buffer = null;
                })
            } else {
                HLSProxyInstance.fetch(url, (buffer, headers, code) => {
                    headers = setHTTPHeaderInObject({'Content-Type': 'application/x-mpegURL'}, headers);
                    var content, ignoreHeaders = 'content-encoding,content-length';
                    for(var k in headers){
                        if(ignoreHeaders.indexOf(k.toLowerCase()) != -1){
                            delete headers[k]
                        }
                    }
                    if(debug){
                        console.log('responding', buffer);
                    }
                    if(buffer instanceof Buffer){
                        content = buffer.toString('utf8')
                    } if(buffer instanceof ArrayBuffer){
                        content = Buffer.from(buffer).toString('utf8')
                    } else {
                        content = String(buffer)
                    }
                    if(debug){
                        console.log('responding 2', url, content)
                    }
                    if(content.substr(0, 192).indexOf('#EXT')!=-1){ // really is m3u8
                        //if(content.indexOf('.ts')!=-1){
                            //stuff below was causing errors, dont remember why I've put that here
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
                })
            }
        }).listen();
        HLSProxyInstance.fetch = (url, callback) => {
            var code = 200, headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*'
            };
            var cb = function () {
                if(!closed){
                    code = this.status || 200;
                    this.getAllResponseHeaders().split("\n").forEach((s) => {
                        var p = s.indexOf(':');
                        if(p){
                            s = [toTitleCase(s.substr(0, p)), s.substr(p + 1).trim()]; 
                            if(s[0] && typeof(headers[s[0]])=='undefined'){
                                headers[s[0]] = s[1]; 
                            }
                        }
                    });
                    if(this.responseURL && this.responseURL != url){
                        code = 302;
                        headers = setHTTPHeaderInObject({
                            'Location': HLSProxyInstance.getURL(this.responseURL)
                        }, headers);
                        if(debug){
                            console.log('location: '+headers['Location']);
                        }
                    }
                    if(callback){
                        blobToBuffer(this.response, (err, buffer) => {
                            if(err){
                                code = 500;
                                callback('', headers, code)
                            } else {
                                callback(buffer, headers, code)
                            }
                        })
                    }
                }
                this.removeEventListener('load', cb);
                delete callback;
            }
            var invocation = new XMLHttpRequest();
            invocation.open('GET', url, true);
            invocation.responseType = "blob";
            invocation.addEventListener('load', cb);
            invocation.send(null)
        }
        HLSProxyInstance.getURL = (url) => {
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
        HLSProxyInstance.destroy = () => {
            console.warn('Closing...');
            closed = true;
            if(HLSProxyInstance){
                HLSProxyInstance.close()
                HLSProxyInstance = null;
            }
        }
    }
    return HLSProxyInstance;
}

var StaticTSFetch = (() => {
    var ttl = 300, salt = 'tsc'; // keep salt short
    return (url, cb) => {
        var val = Store.get(salt + url);
        if(val) {
            cb(false, val)
        } else {
            var invocation = new XMLHttpRequest();
            var internalErrCb = function (err) { // dont update function declare
                cb(err, '');
                this.removeEventListener('load', internalCb);
                this.removeEventListener('error', internalErrCb);
                delete internalCb;
                delete internalErrCb;
            }
            var internalCb = function () { // dont update function declare
                blobToBuffer(this.response, (err, buffer) => {
                    console.error(url, err, buffer);
                    if(err){
                        cb(err, '')
                    } else {
                        Store.set(salt + url, buffer, ttl);
                        cb(false, buffer)
                    }
                });
                console.error(this);
                this.removeEventListener('load', internalCb);
                this.removeEventListener('error', internalErrCb);
                delete internalCb;
                delete internalErrCb;
            }
            invocation.open('GET', url, true);
            invocation.responseType = "blob";
            invocation.addEventListener("load", internalCb);
            invocation.addEventListener("error", internalErrCb);
            invocation.send(null)
        }
    }
})();

var TSProxyInstance;

function getTSProxy(){
    if(!TSProxyInstance){
        var debug = false, ids = 0, port = 0, request = prepareRequestForever();
        var stream = require('stream'), util = require('util');
        var Transform = stream.Transform;
        var createStreamer = (url, callback, client, abortCallback) => {
            var errorLevel = 0, lastResponseSize = -1, r, aborted, streamerClosed, nextIntersectBuffer, bytesToIgnore = 0, intersectBuffers = [],
                intersectBufferSize = 32 * 1024 /* needle */, 
                maxIntersectBufferSize = 5 * (1024 * 1024) /* stack, keep big */;
            var abort = () => {
				if(!aborted){
                    if(debug){
                        console.log('TSProxy', 'streamer abort', '(client ' + client.id + ')')
                    }
                    aborted = true;
                    close()
                }
            }
            var close = () => {
				if(!streamerClosed){
                    if(debug){
                        console.log('TSProxy', 'streamer close', '(client ' + client.id + ')', traceback())
                    }
                    streamerClosed = true;
                    intersectBuffers = [];
                    nextIntersectBuffer = null;
                    abortCallback();
                    if(r){
                        r.abort();
                        r = null;
                    }
                }
            }
            var intersectBuffersSum = () => {
                var length = 0;
                intersectBuffers.forEach((buffer) => {
                    length += buffer.length;
                });
                return length;
            }
            var Hermes = function (options) {
                // allow use without new
                if (!(this instanceof Hermes)) {
                    return new Hermes(options);
                }
                Transform.call(this, options);
            }
            util.inherits(Hermes, Transform);
            Hermes.prototype._transform = function (data, enc, cb) {
                if(!streamerClosed){
                    var currentIntersectBufferSize = intersectBuffersSum();
                    lastResponseSize += data.length;
                    if(nextIntersectBuffer){
                        if(debug){
                            console.log('TSProxy', 'intersection', '(client ' + client.id + ')', currentIntersectBufferSize, maxIntersectBufferSize);
                        }
                        var offset = -1;
                        try {
                            if(debug){
                                console.warn('TSProxy', 'TS Joining', '(client ' + client.id + ')', url)
                            }
                            offset = Buffer.concat(intersectBuffers).lastIndexOf(data.slice(0, intersectBufferSize));
                            if(debug){
                                console.warn('TSProxy', 'TS Joining', '(client ' + client.id + ')', offset, currentIntersectBufferSize, data.length)
                            }
                        } catch(e) {
                            console.error('TSProxy', '(client ' + client.id + ')', e)
                        }
                        if(offset != -1){
                            bytesToIgnore = currentIntersectBufferSize - offset;
                            if(bytesToIgnore < data.length){
                                callback(data.slice(bytesToIgnore))
                            } else {
                                bytesToIgnore -= data.length;
                            }
                        } else {
                            callback(data)
                        }
                        nextIntersectBuffer = null;
                    } else {
                        //console.log('responding', data.length);
                        var skip = false;
                        if(bytesToIgnore){
                            if(data.length > bytesToIgnore){
                                if(debug){
                                    console.log('TSProxy', 'removing duplicated data', '(client ' + client.id + ')')
                                }
                                data = data.slice(bytesToIgnore);
                                bytesToIgnore = 0;
                            } else {
                                if(debug){
                                    console.log('TSProxy', 'TS stream slow, duplicated response received', '(client ' + client.id + ')')
                                }
                                bytesToIgnore -= data.length;
                                skip = true;
                            }
                        }
                        if(!skip){
                            if(currentIntersectBufferSize > maxIntersectBufferSize){
                                intersectBuffers = intersectBuffers.slice(1);
                            }  
                            intersectBuffers.push(data);
                            //console.log(data);
                            //top.zaz = data;
                            callback(data)
                        }
                    }
                } else {
                    client.end();
                    close()
                }
                data = null;
                this.push('');
                cb()
            }
            var connect = () => {
                if(debug){
                    console.log('TSProxy', 'maybe reconnect', '(client ' + client.id + ')')
                }
                if(streamerClosed) {
                    if(debug){
                        console.log('TSProxy', 'avoid to reconnect, streamer closed', '(client ' + client.id + ')')
                    }
                    close()
                } else {
                    if(debug){
                        console.log('TSProxy', 'reconnecting', '(client ' + client.id + ')', lastResponseSize, url)
                    }
                    if(r){
                        r.abort()
                    }
                    if(lastResponseSize != -1){
                        if(lastResponseSize > (32 * 1024)){
                            errorLevel = 0;
                        } else {
                            console.log('TSProxy', 'bad response', '(client ' + client.id + ')', lastResponseSize, errorLevel);
                            errorLevel++;
                        }
                        if(errorLevel >= 2){
                            console.log('TSProxy', 'bad response limit reached', '(client ' + client.id + ')', errorLevel);
                            return close()
                        }
                        lastResponseSize = 0;
                    }
                    r = null;
                    r = request({method: 'GET', uri: url, timeout: Config.get('connect-timeout') * 1000});
                    r.on('error', (err) => {
                        if(debug){
                            console.log('TSProxy', 'timeout', '(client ' + client.id + ')');
                            connect()
                        }
                    });
                    var h = new Hermes();
                    h.on('finish', () => {
                        if(debug){
                            console.log('TSProxy', 'host closed', '(client ' + client.id + ')')
                        }
                        if(!nextIntersectBuffer){
                            nextIntersectBuffer = true;
                        }
                        if(debug){
                            console.log('TSProxy', 'host closed, reconnect', '(client ' + client.id + ')')
                        }
                        connect()
                    });
                    r.pipe(h)
                }
			};
			connect();
			return {'request': r, 'abort': abort}
        }
        TSProxyInstance = http.createServer((request, client) => {
            client.id = ids++;
            if(debug){
                console.log('TSProxy', 'request starting...', '(client ' + client.id + ')', request);
            }
            var closed, headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'video/MP2T',
                'Transfer-Encoding': 'chunked'
            }
            var url = request.url.split('#')[0];
            if(request.url.substr(0, 3) == '/s/'){
                url = request.url.replace('/s/', 'https://');
            }
            if(url.charAt(0)=='/'){
                url = "http:/" + url;
            }
            if(debug){
                console.log('TSProxy', 'serving', '(client ' + client.id + ')', url);
            }
            var code = 200, streamer;
			if(debug){
				console.log('TSProxy', 'start fetching...', '(client ' + client.id + ')', headers)
            }
            client.writeHead(code, headers);
            /* Emitted when the response has been sent. More specifically, this event is emitted when the last segment of the response headers and body have been handed off to the operating system for transmission over the network. It does not imply that the client has received anything yet.
			client.on('finish', function () {
				if(debug){
                    console.log('TSProxy', 'client finish', streamer)
                }
                client.end();
                client = null;
				if(typeof(streamer) == 'object'){
                    streamer.abort()
				}
            });
            */
            var clientClose = () => {
				if(!closed){
                    if(debug){
                        console.log('TSProxy', 'client closed', '(client ' + client.id + ')', streamer)
                    }
                    closed = true;
                    client.end();
                    client = null;
                }
				if(typeof(streamer) == 'object'){
                    streamer.abort()
				}
            }
            client.on('close', clientClose);
			streamer = createStreamer(url, (buffer) => {
                if(closed){
                    if(debug){
                        console.log('TSProxy', 'discarding late data', '(client ' + client.id + ')', buffer.length)
                    }
                } else if(buffer) {
                    if(debug){
                        console.log('TSProxy', 'responding', '(client ' + client.id + ')')
                    }
                    client.write(buffer, 'binary')
                }
                buffer = null;
			}, client, () => {
                clientClose()
            })
        }).listen();
        TSProxyInstance.getURL = (url) => {
            if(!port){
                port = TSProxyInstance.address().port;
            }
            var match = url.match(new RegExp('127\\.0\\.0\\.1:([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+port+'/');
            } else {
                url = url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
            }
            return url;
        }
        TSProxyInstance.destroy = () => {
            if(debug){
                console.warn('TSProxy', 'Closing...')
            }
            TSProxyInstance.close()
            TSProxyInstance = null;
        }
    }
    return TSProxyInstance;
}

jQuery(window).on('beforeunload', () =>{
    console.warn('Closing servers');
    if(TSProxyInstance){
        TSProxyInstance.destroy()
    }
    if(HLSProxyInstance){
        HLSProxyInstance.destroy()
    }
    console.warn('Closing servers OK')
});

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
    notify(intent.entry.name, 'fa-play faclr-green', 'short');
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
    if(intent.manual && !intent.shadow && !intent.disabled){
        var url = intent.entry.originalUrl;
        for(var i=0; i<PlaybackManager.intents.length; i++){
            if(PlaybackManager.intents[i].entry.originalUrl == url && PlaybackManager.intents[i].entry.name == intent.entry.name && PlaybackManager.intents[i] != intent && !PlaybackManager.intents[i].error && !PlaybackManager.intents[i].ended){
                console.log('SHOULD', false, PlaybackManager.intents[i], intent);
                return false;
            }
        }
        console.log('SHOULD', true);
        return true;
    }
    return false;
}

PlaybackManager.on('play', delayedPlayPauseNotify);
PlaybackManager.on('pause', delayedPlayPauseNotify);
PlaybackManager.on('register', (intent, entry) => {
    intent.on('error', () => {
        //console.log('STREAM FAILED', PlaybackManager.log())
        setTimeout(() => {
            //console.log('STREAM FAILED', PlaybackManager.log());
            setStreamStateCache(intent.entry, false);
            sendStats('error', sendStatsPrepareEntry(intent.entry))
            if(!intent.shadow && shouldNotifyPlaybackError(intent)){ // don't alert user if has concurrent intents loading
                if(!Config.get('similar-transmissions') || !switchPlayingStream(intent)){
                    sound('static', 16);
                    var message = Lang.PLAY_STREAM_FAILURE.format(intent.entry.name);
                    if([404, 'connect', 'invalid'].indexOf(intent.error) != -1 || [404].indexOf(intent.statusCode) != -1) {
                        message += ' ' + Lang.PLAYBACK_OFFLINE_STREAM;
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
                    console.log('STREAM FAILED', message, intent.entry.originalUrl, PlaybackManager.log())
                }
            }
        }, 200)
    });
    intent.on('ended', () => {
        // end of stream, go next
        console.log('STREAM ENDED', PlaybackManager.log())
        if(!intent.shadow){
            if(isLive(intent.entry.url)){
                // if is live, the stream should not end, so connect to another broadcast
                if(!intent.shadow && isMega(intent.entry.originalUrl)){ // mega://
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
                var type = getPlayIntentTypes(intent.entry), next = getNextStream();
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
});

PlaybackManager.on('commit', (intent) => {
    console.log('COMMIT TRIGGERED');
    Menu.playState(true);
    setStreamStateCache(intent.entry, true);
    onIntentCommit(intent);
    delayedPlayPauseNotify();
    sendStats('alive', sendStatsPrepareEntry(intent.entry));
    leavePendingState();    
    var v = intent.getVideo();
    if(v) {
        v.volume = Config.get('volume')
    }
    var terms = playingStreamKeyword(intent.entry), b = document.querySelector('.try-other');
    if(b) {
        jQuery(b)[terms ? 'show' : 'hide']()
    }
    setTimeout(() => {
        if(PlaybackManager.activeIntent){
            PlaybackManager.setRatio()
        }
    }, 200)
});

PlaybackManager.on('stop', () => {
    Menu.playState(false);
    delayedPlayPauseNotify();
    if(!PlaybackManager.intents.length){
        stop(true)
    }
});

PlaybackManager.on('load-in', () => {
    var title = false, intents = PlaybackManager.query({started: false, ended: false, error: false, isSideload: false});
    if(intents.length){
        title = (decodeURIComponent(intents[0].entry.name)||intents[0].entry.name);
    }
    if(!isPending){
        enterPendingState(title)
    }
});

PlaybackManager.on('load-out', () => {
    leavePendingState();
    updateStreamEntriesFlags()
});

var engagingTimer = 0, engageTime = 180;

PlaybackManager.on('commit', (intent) => {
    clearTimeout(engagingTimer);
    engagingTimer = setTimeout(() => {
        if(PlaybackManager.activeIntent){
            sendStats('success', sendStatsPrepareEntry(PlaybackManager.activeIntent.entry));
            History.add(intent.entry)
        }
    }, engageTime * 1000)
});

PlaybackManager.on('stop', () => {
    clearTimeout(engagingTimer)
});

addAction('stop', () => {
    updateStreamEntriesFlags();
    sendStats('stop')
});

jQuery(window).on('beforeunload', () => {
    removeFolder('stream', false);
    stop();
    unloadFrames()
});
