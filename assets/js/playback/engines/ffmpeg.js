
function createFFmpegIntent(entry, options){

    var self = createBaseIntent();
    self.type = 'ffmpeg';
    self.entry = entry;
    self.folder = '';
    self.proxify = true;
    self.streamURL = false;
    self.transcode = typeof(entry.transcode) == 'boolean' ? entry.transcode : Config.get('transcode-policy') ==  'always';
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.decoderOutputAppending = true;
    self.streamType = getMediaType(self.entry)

    self.commit = () => {
        jQuery('#player').removeClass('hide').addClass('show');
        self.playback.connect(self.streamURL, 'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"');
        self.getVideo();
        self.attached = true;
    }
    
    self.callDecoder = (ct) => {
        self.streamURL = self.entry.url;
        self.decoder = ffmpeg(self.streamURL).
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
        // addOption('-copyts').
        addOption('-sn').
        format('hls')

        if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
            var agent = navigator.userAgent.split('"')[0];
            self.decoder.
            inputOptions('-user_agent', '"' + agent + '"'). //  -headers ""
            inputOptions('-icy 0').
            inputOptions('-seekable 1').
            inputOptions('-multiple_requests 1')
            if (isHTTPS(self.streamURL)) {
                self.decoder.inputOptions('-tls_verify 0')
            }
        }

        if(self.transcode){
            self.decoder.
            addOption('-pix_fmt', 'yuv420p').
            addOption('-profile:v', 'main').
            addOption('-preset:v', 'veryfast')
            if(self.playback.allowTranscodeFPS){
                let fps = Config.get('transcode-fps')
                if(fps > 0){
                    self.decoder.
                    addOption('-vf "minterpolate=fps='+fps+':mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"').
                    addOption('-r', fps)
                }
            }
        }
    
        self.decoder.
        on('codecData', (codecData) => {
            console.warn('CODECDATA', codecData.video.substr(0, 4), codecData);
            if(codecData.video && codecData.video.substr(0, 4) != 'h264' && self.videoCodec == 'copy' && !self.error && !self.ended){
                console.warn('TRANSCODE', dirname(self.decoder.file));
                self.transcode = true;
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
        })
    
        self.decoder.file = path.resolve(self.workDir + path.sep + self.uid + path.sep + 'output.m3u8')
        self.streamURL = self.playback.proxyLocal.proxify(self.decoder.file)
        self.decoder.addOption('-hls_flags ' + (fs.existsSync(self.decoder.file) ? 'delete_segments+append_list+omit_endlist' :  'delete_segments+omit_endlist'))

        mkdirr(dirname(self.decoder.file))
    
        waitInstanceFileExistsTimeout(self, (exists) => {
            if(!self.ended && !self.error){
                if(exists){
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
        if(isHTTP(self.entry.url)){
            self.ping((result) => {
                if(!self.error && !self.ended){
                    console.log('Content-Type', self.entry.url, result)
                    if(result.type.indexOf('text/html') != -1 || result.status >= 400){
                        console.error('Bad HTTP response for '+self.type, result)
                        self.error = status || 'connect';
                        self.trigger('error');
                        return;
                    }
                    if(typeof(self.entry.transcode) != 'boolean'){
                        var tp = Config.get('transcode-policy');
                        self.transcode = tp == 'always' || (!result.type || [
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
                            ].indexOf(result.type) == -1)
                    }
                    self.videoCodec = self.transcode ? 'libx264' : 'copy';
                    self.callDecoder(result.type)
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