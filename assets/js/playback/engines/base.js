
function createBaseIntent(){

    var self = {}
    self.playback = Playback;
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
    self.errors = {};
    self.error = false;
    self.ended = false;
    self.entry = {};
    self.events = {};
    self.videoEvents = {};
    self.video = false;
    self.shadow = false;
    self.subtitle = false;
    self.started = false;
    self.ignoreErrors = false;
    self.controller = getFrame('player');
    self.mimetype = 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"';
    self.workDir = self.playback.proxyLocal.folder + path.sep + 'stream';
    self.streamType = 'live'

    self.uid = parseInt(Math.random() * 1000000000), files = fs.readdirSync(self.workDir);
    while(files.indexOf(String(self.uid)) != -1){
        self.uid++;
    }

    self.validateContentType = (ctype) => {
        return !ctype || ctype.match(new RegExp('^(audio|video|application)'))
    }

    self.validateStatusCode = (code) => {
        return !code || (code >= 200 && code <= 403)
    }

    self.ping = (cb) => {
        if(typeof(self.pinged) == 'undefined'){
            getHTTPInfo(self.pingURL || self.entry.url, (ctype, cl, url, u, status) => { // OK
                self.statusCode = status;
                self.pinged = {status: status, type: ctype, length: cl || -1}
                cb(self.pinged)
            })     
        } else {
            cb(self.pinged)
        }
    }

    self.test = (cb) => {
        if(typeof(self.tested) == 'undefined'){         
            var p = getFrame('testing-player')
            if(!p || !p.test){
                cb(false)    
            } else {
                p.test(self.testURL || self.streamURL, self.mimetype, () => {
                    console.log('Test succeeded. '+self.streamURL);
                    self.tested = true;
                    cb(self.tested)
                }, (data) => {
                    console.error('Test Failed. '+self.streamURL, data);
                    self.tested = false;
                    cb(self.tested)
                })
            }
        } else {
            cb(self.tested)
        }
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
    
    self.become = (newIntent) => {
        newIntent.events = self.events
        self = newIntent
    }

    self.rename = (newTitle, newLogo) => {
        self.entry.name = newTitle;
        if(newLogo){
            self.entry.logo = newLogo;
        }
        self.trigger('rename', self)
    }

    self.reportError = (err, type) => {
        if(!self.ignoreErrors){
            if(typeof(self.errors[type]) == 'undefined'){
                self.errors[type] = []
            }
            self.errors[type].push({time: time(), message: err});
            if(type == 'playback'){
                var count = 0, limit = time() - 10;
                self.errors[type].forEach((e) => {
                    if(e.time > limit){
                        count++;
                    }
                })
                if(count >= 3){
                    self.error = 'playback';
                    self.trigger('error')
                }
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
        var  _now = time();
        if(self.attached && !self.error && (!self.lastRetry || (_now - self.lastRetry) > 10) && !isVideo(self.entry.url)){
            console.log('file retry');
            self.lastRetry = _now;
            delete self.decoder;
            self.error = false;
            self.ended = false;
            self.playback.unbind(self);
            self.run();
            return true;
        } else {
            console.log('retry denial', self.attached, !self.error, self.lastRetry, _now, isVideo(self.entry.url), self.entry.url);
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

    self.getVideo = (v) => {
        if(self.committed){
            if(!self.video || !self.video.parentNode){
                self.video = typeof(v) == 'object' && v ? v : getFrame('player').videoElement();            
                if(self.video){
                    self.trigger('getVideo', self.video)
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
        self.playback.unbind(self);
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
        self.events = {}
        self.attached = self.video = false;  
    }    

    self.on('error destroy', () => {
        console.log('ERROR TRIGGERED', self.entry)
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
        self.video = false;  
        console.warn('Intent cleaned.')
    })

    self.on('destroy', () => {
        self.ended = true;
        self.attached = false; 
        clearTimeout(self.timeoutTimer);
    })

    self.on('getVideo', (video) => {
        console.warn("GETVIDEO", "STATECHANGE", video, self, self.playback)
        video.muted = false;
        self.playback.bind(video, self)
    })

    self.on('start', () => {
        if(!self.videoElement){
            $body.addClass('no-video').removeClass('has-video')
        }
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
    self.setTimeout(self.timeout)
    return self;
}
