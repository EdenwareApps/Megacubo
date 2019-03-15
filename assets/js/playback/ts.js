
function createTSIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ts';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.streamURL = false;
    self.transcode = typeof(entry.transcode) == 'boolean' ? entry.transcode : Config.get('transcode-policy') == 'always';
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.softErrors = [];
    self.tsDuration = 0;
    self.tsFetchStart = 0;
    self.decoderOutputAppending = true;
    self.videoEvents = {
        'play': () => { // started
            var pl = getFrame('player');
            self.getVideo();
            pl.player.off('ended');
            pl.player.on('ended', () => {
                console.log('PLAYER RESET')
                pl.reset()
            })
        },
        'ended': () => {
            // self.retry()
            console.error('TS video element ended.', fs.existsSync(self.decoder.file), String(fs.readFileSync(self.decoder.file)))
            return true
        }
    }
    
    var file = 'stream/' + self.uid + '/output.m3u8';

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        self.playback.connect(self.decoder.file, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"');
        self.getVideo();
        self.attached = true;
    }

    mkdirp(dirname(file));
    
    self.runConfirm = () => {
        console.log('RunConfirm', file);
        self.streamURL = getTSStreamer().resolve(self.entry.url);
        console.log('RunConfirm', self.streamURL, file);

        if(self.decoder){
            try {
                self.decoder.off('error');
                self.decoder.kill('SIGKILL')
            } catch(e) {}
        }

        self.decoder = ffmpeg(self.streamURL).
            addOption('-cpu-used -16').
            addOption('-use_wallclock_as_timestamps', 1).
            // addOption('-deadline realtime').
            addOption('-threads ' + (cpuCount - 1)).
            inputOptions('-fflags +genpts').
            // inputOptions('-stream_loop -1').
            videoCodec(self.videoCodec).
            audioCodec('aac').
            addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-hls_time', segmentDuration).
            addOption('-hls_list_size', 0).
            addOption('-start_time', 0).
            addOption('-vsync', 1). // https://www.cleancss.com/explain-command/ffmpeg/6658
            addOption('-sn').
            format('hls')
    
        if(self.videoCodec == 'libx264') {
            self.decoder.
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'baseline');      
            if(self.playback.allowTranscodeFPS){
                let fps = Config.get('transcode-fps')
                if(fps > 0){
                    self.decoder.
                    addOption('-vf', 'minterpolate=fps='+fps+':mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1').
                    addOption('-r', fps)
                }
            }
        }

        var hlsFlags = '+delete_segments', alreadyExists = fs.existsSync(file);
        if(alreadyExists) {
            hlsFlags += ' +append_list';
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
            if (isHTTPS(self.streamURL)) {
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
        on('end', (stdout, stderr) => {
            console.log('file ended', stdout, stderr);
            self.retry() // will already call error on failure
        }).
        on('error', function(err, sout, serr) {
            if(err.message.indexOf('ffmpeg was killed with signal') == -1) {
                console.log('FFmpeg error, not killed', err.message, sout, serr);
                /* retry instead of stop on connection discontinuity
                if(!self.error){
                    self.error = 'ffmpeg';
                    self.trigger('error')
                }
                */
                self.retry()
            } 
        }).
        on('start', function(commandLine) {
            console.log('Spawned FFmpeg with command:', commandLine);
            // ok, but wait file creation to trigger "start"
        }).
        on('stderr', function(stderrLine) {
            if(!stderrLine.match(new RegExp('frame=.*fps=', 'i'))){
                console.log('Stderr output: ' + stderrLine)
            }
        });    
        self.streamURL = self.decoder.file = file;     
        waitInstanceFileExistsTimeout(self, function (exists) {
            if(!self.ended && !self.error){
                if(exists){
                    console.log('M3U8 file created.')
                    self.test((worked) => {
                        if(worked){
                            self.started = true;
                            self.trigger('start', self)
                        } else {
                            self.error = 'playback';
                            self.trigger('error')
                        }
                    })
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
            self.runConfirm()
            self.ping(result => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, result);
                    if(self.validateContentType(result.type) && self.validateStatusCode(result.status)){
                        if(!self.error && !self.ended){
                            // OK
                        }
                    } else if(!self.started) {
                        console.error('Bad HTTP response for '+self.type, result);
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

var TSStreamerInstance;

function getTSStreamer(){
    if(!TSStreamerInstance){
        var debug = false, connectionDurationSecs = 5, ids = 0, port = 0, request = prepareRequestForever()
        var stream = require('stream'), util = require('util')
        var Transform = stream.Transform;
        var len = (data) => {
            if(!data){
                return 0
            } else if(typeof(data.byteLength) != 'undefined') {
                return data.byteLength
            } else {
                return data.length
            }
        }
        var remain = () => {
            if(Playback.active && Playback.active.type == 'ts'){
                var v = Playback.active.getVideo()
                if(v){
                    var s = v.duration - v.currentTime - connectionDurationSecs
                    if(s < 0){
                        s = 0
                    } else if(s > 5) { // max 5 secs delay
                        s = 5
                    }
                    return s
                }
            }
            return 0
        }
        var createStreamer = (url, callback, client, abortCallback) => {
            var errorLevel = 0, lastResponseSize = -1, r, aborted, streamerClosed, nextIntersectBuffer, bytesToIgnore = 0, intersectBuffers = [],
                intersectBufferSize = 32 * 1024 /* needle */, 
                maxIntersectBufferSize = 5 * (1024 * 1024) /* stack, keep big */;
            var abort = () => {
				if(!aborted){
                    if(debug){
                        console.log('[ts] streamer abort', '(client ' + client.id + ')')
                    }
                    aborted = true;
                    close()
                }
            }
            var close = () => {
				if(!streamerClosed){
                    if(debug){
                        console.log('[ts] streamer close', '(client ' + client.id + ')', traceback())
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
                    var currentIntersectBufferSize = intersectBuffersSum()
                    lastResponseSize += len(data)
                    if(nextIntersectBuffer){
                        if(debug){
                            console.log('[ts] intersection', '(client ' + client.id + ')', currentIntersectBufferSize, maxIntersectBufferSize);
                        }
                        var offset = -1;
                        try {
                            if(debug){
                                console.warn('[ts] joining', '(client ' + client.id + ')', url)
                            }
                            // offset = Buffer.concat(intersectBuffers).lastIndexOf(data.slice(0, intersectBufferSize))
                            offset = Buffer.concat(intersectBuffers).indexOf(data.slice(0, intersectBufferSize))
                            if(debug){
                                console.warn('[ts] joining', '(client ' + client.id + ')', offset, currentIntersectBufferSize, len(data))
                            }
                        } catch(e) {
                            console.error('[ts] join error, client ' + client.id, e)
                        }
                        if(offset != -1){
                            bytesToIgnore = currentIntersectBufferSize - offset;
                            if(bytesToIgnore < len(data)){
                                callback(data.slice(bytesToIgnore))
                            } else {
                                bytesToIgnore -= len(data)
                            }
                        } else {
                            callback(data)
                        }
                        nextIntersectBuffer = null;
                    } else {
                        //console.log('responding', len(data));
                        var skip = false;
                        if(bytesToIgnore){
                            if(len(data) > bytesToIgnore){
                                if(debug){
                                    console.log('[ts] removing duplicated data', '(client ' + client.id + ', '+bytesToIgnore+'bytes)')
                                }
                                data = data.slice(bytesToIgnore);
                                bytesToIgnore = 0;
                            } else {
                                if(debug){
                                    // console.log('[ts] Duplicated response received', '(client ' + client.id + ', '+bytesToIgnore+'bytes)')
                                }
                                bytesToIgnore -= len(data);
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
            var reconnect = () => {
                var s = parseInt(remain() * 1000)
                console.log('[ts] reconnect after', s + 'ms')
                setTimeout(connect, s)
            }
            var connect = () => {
                if(debug){
                    console.log('[ts] maybe reconnect', '(client ' + client.id + ')')
                }
                if(streamerClosed) {
                    if(debug){
                        console.log('[ts] avoid to reconnect, streamer closed', '(client ' + client.id + ')')
                    }
                    close()
                } else {
                    if(debug){
                        console.log('[ts] reconnecting', '(client ' + client.id + ')', lastResponseSize, url)
                    }
                    if(r){
                        r.abort()
                    }
                    if(lastResponseSize != -1){
                        if(lastResponseSize > (32 * 1024)){
                            errorLevel = 0;
                        } else {
                            console.log('[ts] bad response', '(client ' + client.id + ')', lastResponseSize, errorLevel);
                            errorLevel++;
                        }
                        if(errorLevel >= 4){
                            console.log('[ts] bad response limit reached', '(client ' + client.id + ')', errorLevel);
                            lastResponseSize = -1;
                            return close()
                        }
                        lastResponseSize = 0
                    }
                    let s = time()
                    r = null;
                    r = request({method: 'GET', uri: url, timeout: Config.get('connect-timeout') * 1000});
                    r.on('error', (err) => {
                        if(debug){
                            phantomLastResponseSize = lastResponseSize;
                            if(navigator.onLine){
                                if(phantomLastResponseSize == lastResponseSize){
                                    lastResponseSize = 0;
                                } else {
                                    // altered outside
                                }
                            } else {
                                // no connection, delay it up
                                // dont notify the user? we dont want to annoy him, but his Internet connection is down, so what to do?
                                // we dont want the user to blame the software without know his Internet connection is bad performance reason, notify it so!
                                // just notify, avoid to stop the channel
                                console.error('No internet connection.')
                            }
                            console.error('[ts] timeout', '(client ' + client.id + ')', err)
                            reconnect()
                        }
                    })
                    r.on('response', (response) => {
                        connectionDurationSecs = time() - s
                        if(debug){
                            console.warn('[ts] received headers after ', connectionDurationSecs, response) // 200
                        }
                    })
                    var h = new Hermes();
                    h.on('finish', () => {
                        if(debug){
                            console.log('[ts] host closed', '(client ' + client.id + ')')
                        }
                        if(!nextIntersectBuffer){
                            nextIntersectBuffer = true;
                        }
                        if(debug){
                            console.log('[ts] host closed, reconnect', '(client ' + client.id + ')')
                        }
                        reconnect()
                    })
                    r.pipe(h)
                }
			}
			connect()
			return {'request': r, 'abort': abort}
        }
        TSStreamerInstance = http.createServer((request, client) => {
            client.id = ids++;
            if(debug){
                console.log('[ts] request starting...', '(client ' + client.id + ')', request);
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
                console.log('[ts] serving', '(client ' + client.id + ')', url);
            }
            var code = 200, streamer;
			if(debug){
				console.log('[ts] start fetching...', '(client ' + client.id + ')', headers)
            }
            client.writeHead(code, headers);
            /* Emitted when the response has been sent. More specifically, this event is emitted when the last segment of the response headers and body have been handed off to the operating system for transmission over the network. It does not imply that the client has received anything yet.
			client.on('finish', function () {
				if(debug){
                    console.log('[ts] client finish', streamer)
                }
                client.end();
                client = null;
				if(typeof(streamer) == 'object' && streamer){
                    streamer.abort()
				}
            });
            */
            var clientClose = () => {
				if(!closed){
                    if(debug){
                        console.log('[ts] client closed', '(client ' + client.id + ')', streamer)
                    }
                    closed = true;
                    client.end();
                    client = null;
                }
				if(typeof(streamer) == 'object' && streamer){
                    streamer.abort()
				}
            }
            client.on('close', clientClose);
			streamer = createStreamer(url, (buffer) => {
                if(closed){
                    if(debug){
                        console.log('[ts] discarding late data', '(client ' + client.id + ')', buffer.length)
                    }
                } else if(buffer) {
                    if(debug){
                        console.log('[ts] responding', '(client ' + client.id + ')')
                    }
                    client.write(buffer, 'binary')
                }
                buffer = null;
			}, client, () => {
                clientClose()
            })
        }).listen();
        TSStreamerInstance.resolve = (url) => {
            if(!port){
                port = TSStreamerInstance.address().port;
            }
            var match = url.match(new RegExp('127\\.0\\.0\\.1:([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+port+'/');
            } else {
                url = url.replace('http://', 'http://127.0.0.1:'+port+'/').replace('https://', 'http://127.0.0.1:'+port+'/s/')
            }
            return url;
        }
        TSStreamerInstance.destroy = () => {
            if(debug){
                console.warn('[ts] Closing...')
            }
            TSStreamerInstance.close()
            TSStreamerInstance = null;
        }
    }
    return TSStreamerInstance;
}

$win.on('beforeunload', () =>{
    console.warn('Closing servers');
    if(TSStreamerInstance){
        TSStreamerInstance.destroy()
    }
    console.warn('Closing servers OK')
})