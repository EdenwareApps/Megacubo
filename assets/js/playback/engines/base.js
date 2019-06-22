
const PLAYBACK_HLS_MIMETYPE = 'application/x-mpegURL; codecs="avc1.42E01E, mp4a.40.2"';
const PLAYBACK_MP4_MIMETYPE = 'video/mp4';

class PlaybackBaseIntent extends Events {
    constructor(){
        super()
        this.playback = Playback;
        this.type = 'base';
        this.top = top; // reference for listeners
        this.attached = false;
        this.ctime = time();
        this.committed = false;
        this.unloaded = false;
        this.statusCode = 0;
        this.manual = false;
        this.loaded = false;
        this.decoder = false;
        this.decoderOutputAppending = false;
        this.errors = {};
        this.error = false;
        this.ended = false;
        this.entry = {};
        this.videoEvents = {};
        this.video = false;
        this.shadow = false;
        this.subtitle = false;
        this.started = false;
        this.testing = [];
        this.ignoreErrors = false;
        this.videoCodec = 'copy'
        this.audioCodec = 'copy'
        this.FF = {
            segmentDuration: 2,
            cpuUsed: -16
        }
        this.controller = getFrame('player')
        this.mimetype = PLAYBACK_HLS_MIMETYPE
        this.workDir = this.playback.proxyLocal.folder + path.sep + 'stream'
        this.streamType = 'live'
        this.on('error', () => {
            console.log('ERROR TRIGGERED', this.entry)
            this.unload()
        })
        this.on('destroy', () => {
            this.unload()
            this.ended = true;
            this.attached = false; 
            clearTimeout(this.timeoutTimer);
        })
        this.on('getVideo', (video) => {
            console.warn("GETVIDEO", "STATECHANGE", video, this, this.playback)
            if(this.destroyed){
                return
            }
            video.muted = false;
            this.playback.bind(video, this)
        })
        this.on('commit', () => {
            this.getVideoUpdateClass()
        })
        this.timeoutTimer = 0;
        this.timeout = Config.get('tune-timeout') + (Config.get('min-buffer-secs-before-commit') * 1.5) 
        this.genUID() 
        this.setTimeout(this.timeout)
    }
    genUID(){          
        this.uid = parseInt(Math.random() * 1000000000)
        let files = fs.readdirSync(this.workDir)
        while(files.indexOf(String(this.uid)) != -1){
            this.uid++
        }
    }
    calcTimeout(secs){
        return secs * 1000;
    }    
    setTimeout(secs){
        this.timeout = secs
        this.clearTimeout()
        var s = time()
        this.timeoutTimer = setTimeout(() => {
            if(this && !this.error && !this.ended && !this.destroyed){
                if(this.committed){
                    let v = this.getVideo()
                    if(v && !v.duration){
                        console.log('Playback timeout on commited intent.', this.entry, this.type, time() - s)
                        this.fail('timeout')
                    }
                } else {
                    console.log('Commit timeout on not commited intent.', this.entry, this.type, time() - s)
                    this.fail('timeout')
                }
            }
        }, this.calcTimeout(secs))
    }    
    clearTimeout(){
        clearTimeout(this.timeoutTimer)
        this.timeoutTimer = 0
    }
    resetTimeout(){
        this.setTimeout(this.timeout)
    }
    validateContentType(ctype){
        return !ctype || ctype.match(new RegExp('^(audio|video|application)'))
    }
    validateStatusCode(code){
        return (code >= 200 && code <= 403)
    }
    ping(cb){
        if(typeof(this.pinged) == 'undefined'){
            getHTTPInfo(this.pingURL || this.entry.url, (ctype, cl, url, u, status) => {
                this.statusCode = status;
                this.pinged = {status: status, type: ctype, length: cl || -1}
                cb(this.pinged)
            })     
        } else {
            cb(this.pinged)
        }
    }
    test(cb){
        if(typeof(this.tested) != 'boolean'){         
            var p = getFrame('testing-player')
            if(!p || !p.test){
                cb(false)    
            } else {
                let ret = p.test(this.testURL || this.streamURL, this.mimetype, this.entry.source, () => {
                    console.log('Test succeeded. '+this.streamURL);
                    this.tested = true;
                    cb(this.tested)
                    ret.destroy()
                }, (data) => {
                    console.error('Test Failed. '+this.streamURL, data);
                    this.tested = false;
                    cb(this.tested)
                    ret.destroy()
                })
                this.testing.push(ret)
            }
        } else {
            cb(this.tested)
        }
    } 
    commit(){
        jQuery('#player').removeClass('hide').addClass('show')
        this.playback.connect(this.streamURL, this.mimetype)
        this.getVideo()
        this.attached = true
    }
    start(test){
        let icb = (worked) => {
            if(worked){
                this.started = true;
                this.emit('start', this)
            } else {
                this.fail('playback')
            }
        }
        if(test){
            this.test(icb)
        } else {
            icb(true)
        }
    } 
    rename(newTitle, newLogo){
        this.entry.name = newTitle;
        if(newLogo){
            this.entry.logo = newLogo;
        }
        this.emit('rename', this)
    }
    play(){
        if(this.controller){
            this.controller.play()
            this.emit('play')
        }
    }
    pause(){
        if(this.controller){
            this.controller.pause();
            this.emit('pause')
        }
    }    
    seek(secs){
        if(this.controller){
            this.controller.seek(secs)
        }
    }
    retry(){
        var  _now = time();
        if(this.attached && !this.error && (!this.lastRetry || (_now - this.lastRetry) > 10) && !isVideo(this.entry.url)){
            console.log('file retry');
            this.lastRetry = _now;
            delete this.decoder;
            this.error = false;
            this.ended = false;
            this.playback.unbind(this);
            this.run();
            return true;
        } else {
            console.log('retry denial', this.attached, !this.error, this.lastRetry, _now, isVideo(this.entry.url), this.entry.url);
            this.fail('timeout')
        }
    }
    playing(){
        if(this.committed){
            if(this.controller){
                return !this.controller.paused();
            } else {
                return true;
            }
        }
    }
    getVideoUpdateClass(){
        if(this.video){
            $body.removeClass('no-video').addClass('has-video')
        } else {
            $body.addClass('no-video').removeClass('has-video')
        }
    }
    getVideo(v){
        if(this.committed){
            if(!this.video || !this.video.parentNode){
                this.video = typeof(v) == 'object' && v ? v : getFrame('player').videoElement();            
                if(this.video){
                    this.emit('getVideo', this.video)
                }
            }
            this.getVideoUpdateClass()
        }
        return this.video;
    }
    apply(options){
        for(var key in options){
            if(typeof(options[key])=='function'){
                this.on(key, options[key])
            } else if(key == 'timeout'){
                this.setTimeout(options[key])
            } else {
                this[key] = options[key];
            }
        }
    }
    restartDecoder(){
        if(!this.destroyed){
            if(this.controller){
                this.controller.video.pause()
                if(this.controller.hls){
                    this.controller.hls.stopLoad()
                }
            }            
            this.killDecoder()
            this.resetTimeout()
            this.genUID()
            this.once('start', () => {
                this.commit()
            })
            process.nextTick(() => {
                this.confirm()
                this.playback.setState('load')
            })
            return true
        }
    }
    killDecoder(){
        if(this.decoder){
            let dec = this.decoder
            if(this.waiter){
                this.waiter.cancel()
            }
            dec.removeAllListeners()
            dec.kill()
            if (dec.file) {
                removeFolder(dirname(dec.file), true)
            }    
            this.decoder = null  
            if(this.proxy){
                this.proxy.reset()
            }
            process.nextTick(() => {
                dec = null
            })
        }
    }
    ffmpeg(url){
        this.file = path.resolve(this.workDir + path.sep + this.uid + path.sep + 'output.m3u8')
        mkdirr(dirname(this.file))
        let ret = ffmpeg(url).
            addOption('-threads', 0).
            inputOptions('-fflags +genpts').
            addOption('-err_detect', 'ignore_err').
            addOption('-analyzeduration 2147483647').
            addOption('-probesize', '2147483647').
            videoCodec(this.videoCodec).
            audioCodec(this.audioCodec).
            addOption('-strict', '-2').
            addOption('-flags:a', '+global_header').
            addOption('-hls_time', this.FF.segmentDuration).
            addOption('-hls_init_time', 2). // 1 causes manifestParsingError "invalid target duration"
            addOption('-hls_list_size', 0).
            addOption('-map', '0:a').
            addOption('-map', '0:v').
            // addOption('-copyts').
            addOption('-sn').
            format('hls')
        if(this.videoCodec == 'libx264') {
            ret.addOption('-pix_fmt', 'yuv420p').addOption('-vprofile', 'baseline').addOption('-preset:v', 'veryfast')
            /*
            if(this.playback.allowTranscodeFPS){
                let fps = Config.get('transcode-fps')
                if(fps > 0){
                    this.decoder.
                    addOption('-vf "minterpolate=fps='+fps+':mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"').
                    addOption('-r', fps)
                }
            }
            */
        }
        /*
        if(this.audioCodec == 'aac') {
            ret.addOption('-profile:a', 'aac_low').
            addOption('-preset:a', 'veryfast').
            addOption('-preset:a', 'veryfast').
            addOption('-b:a', '128k').
            addOption('-ac', '2').
            addOption('-ar', '48000').
            addOption('-af', '"aresample=async=1:min_hard_comp=0.100000:first_pts=0"')            
        }
        */
        if (url.indexOf('http') == 0 && isMedia(url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0]
            ret.
            inputOptions('-user_agent', '"' + agent + '"'). //  -headers ""
            inputOptions('-icy 0').
            inputOptions('-seekable 1').
            inputOptions('-multiple_requests 1')
            if (isHTTPS(url)) {
                ret.inputOptions('-tls_verify 0')
            }
        }
        ret.
        on('end', () => {
            if(!this.unloaded){
                console.log('file ended');
                // this.retry() // will already call error on failure
                this.ended = true;
                this.emit('end')
            }
        }).
        on('error', (err) => {
            if(!this.unloaded){
                console.error('an error happened: ' + err.message)
                err = err.message || err
                let m = err.match(new RegExp('Server returned ([0-9]+)'))
                if(m && m.length > 1){
                    err = parseInt(m[1])
                }
                this.fail(err)
            }
        }).
        on('start', (commandLine) => {
            console.log('Spawned FFmpeg with command: ' + commandLine, this.entry)
            // setPriority('idle', ret.ffmpegProc.pid) // doesnt't help on tuning performance
            // ok, but wait file creation to trigger "start"
        }).
        on('stderr', (stderrLine) => {
            if(!this.unloaded){
                if(!stderrLine.match(new RegExp('frame=.*fps=', 'i'))){
                    console.log('Stderr output: ' + stderrLine)
                    ret.log += stderrLine + "\r\n"
                }
            }
        }).
        on('codecData', (codecData) => {
            console.warn('CODECDATA', codecData);
            if(!this.error && !this.ended){
                let r, tv = codecData.video && codecData.video.substr(0, 4) != 'h264'
                let ta = codecData.audio && codecData.audio.indexOf('aac (LC)') == -1
                if(tv && this.videoCodec == 'copy'){
                    this.videoCodec = 'libx264'
                    r = true
                }
                if(ta && this.audioCodec == 'copy'){
                    this.audioCodec = 'aac'
                    r = true
                }
                if(r){                    
                    console.warn('CODECDATA TRANSCODE REQUIRED', tv, ta);
                    this.restartDecoder()
                }
            }
        })
        ret.log = ''
        return ret  
    }
    fail(err){
        if(!this.destroyed && !this.error && !this.unloaded){
            console.error('INTENT FAIL', this.entry.name, this.entry.url, err, traceback())
            if(this.proxy){
                console.error('INTENT FAIL', this.proxy.buffers.map(b => { return this.proxy.len(b) }), fs.readdirSync(this.workDir + path.sep + this.uid), this.decoder ? this.decoder.log : '')
            }
            this.error = err
            this.emit('error', this)
        }
    }
    unload(){
        if(!this.unloaded){
            this.unloaded = true
            if(this.tester){
                this.tester.cancel()
                this.tester = null
            } 
            this.killDecoder()
            this.attached = this.video = false
            this.emit('unload')
        }
    } 
    destroy(){
        if(!this.destroyed){
            this.playback.unbind(this)
            this.destroyed = true
            this.unload()
            this.emit('destroy')
            this.removeAllListeners()
            let keeps = ['entry', 'tuning']
            Object.keys(this).forEach(k => {
                if(keeps.indexOf(k) == -1){
                    if(typeof(this[k]) == 'object'){
                        this[k] = null
                    } else if(typeof(this[k]) == 'function'){
                        this[k] = () => {}
                    }
                }
            })
        }
    }   
}

class PlaybackTranscodeIntent extends PlaybackBaseIntent {    
    constructor(entry, options){
        super(entry, options)
        this.type = 'transcode'
        this.entry = entry
        this.folder = ''
        this.proxify = true
        this.streamURL = false
        this.decoderOutputAppending = true
        this.streamType = 'live'
        if(options){
            this.apply(options)
            //console.log('ZZZZ', options, this);
        }
    }  
    confirm(){
        this.decoder = this.ffmpeg(this.entry.url)
        this.decoder.file = path.resolve(this.workDir + path.sep + this.uid + path.sep + 'output.m3u8')
        this.streamURL = this.playback.proxyLocal.proxify(this.decoder.file)
        this.decoder.addOption('-hls_flags ' + (fs.existsSync(this.decoder.file) ? 'delete_segments+append_list' :  'delete_segments'))
        mkdirr(dirname(this.decoder.file))
        this.waiter = waitFileTimeout(this.decoder.file, (exists) => {
            if(!this.ended && !this.error && !this.destroyed){
                if(exists){
                    this.start()
                } else {
                    console.error('M3U8 file creation timeout.');
                    this.fail('transcode')
                }
            }
        }, 1800)
        this.decoder.output(this.decoder.file).run()
    }    
    run(){
        this.confirm()
    }
}

PlaybackTranscodeIntent.supports = (entry) => {
    return !entry.url.match(new RegExp('^(magnet|mega):', 'i'))
}

Playback.registerEngine('transcode', PlaybackTranscodeIntent, 999)
