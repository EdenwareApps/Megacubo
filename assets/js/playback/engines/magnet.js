
var torrentsFolder = Users.loggedFolder + path.sep + 'Torrents';
var torrentsEntryName = 'Torrents', torrentSearchPath = torrentsEntryName + '/' + Lang.SEARCH; 

var torrentsDefaultTrackers = [
    "udp://tracker.tiny-vps.com:6969/announce", 
    "udp://tracker.opentrackr.org:1337/announce", 
    "udp://bt.xxx-tracker.com:2710/announce", 
    "udp://tracker.vanitycore.co:6969/announce", 
    "udp://9.rarbg.to:2730/announce", 
    "udp://ipv4.tracker.harry.lu:80/announce", 
    "udp://open.stealth.si:80/announce", 
    "udp://tracker.coppersurfer.tk:6969/announce", 
    "udp://tracker.coppersurfer.tk:80/announce", 
    "udp://tracker.pirateparty.gr:6969/announce", 
    "udp://tracker.port443.xyz:6969/announce", 
    "udp://tracker.cyberia.is:6969/announce", 
    "udp://exodus.desync.com:6969/announce", 
    "udp://thetracker.org:80/announce", 
    "udp://tracker.justseed.it:1337/announce", 
    "udp://tracker.torrent.eu.org:451/announce", 
    "udp://tracker.torrent.eu.org:451", 
    "http://tracker3.itzmx.com:8080/announce", 
    "udp://9.rarbg.to:2710/announce", 
    "udp://tracker.open-internet.nl:6969/announce", 
    "udp://public.popcorn-tracker.org:6969/announce"
]

function getMagnetName(url){
    var match = url.match(new RegExp('dn=([^&]+)'));
    if(match){
        return urldecode(match[1])
    }
    return 'Unknown Magnet';
}

function getMagnetHash(uri){
    var m = uri.match(new RegExp('btih:([A-Za-z0-9]{40})'))
    if(m.length){
        return m[1]
    }
    var m = uri.match(new RegExp('([A-Za-z0-9]{40})'))
    if(m.length){
        return m[1]
    }
    return ''
}

var Trackers = (() => {
    var self = {}
    self.parse = (query) => {
        if(jQuery.isArray(trs)){
            return trs
        }
        var trs = []
        if(query.indexOf('?') != -1){
            query = query.split('?')[1]
        }
        query.split('&').forEach((q) => {
            q = q.split('=')
            if(q.length == 2 && q[0].toLowerCase() == 'tr' && trs.indexOf(q[1]) == -1){
                trs.push(q[1])
            }
        })
        return trs.map(decodeURIComponent)
    }
    self.compile = (trs) => {
        if(!jQuery.isArray(trs)){
            return trs
        }
        return trs.getUnique().map(tr => { return 'tr='+encodeURIComponent(tr)}).join('&')
    }
    self.has = (uri, tr) => {
        return uri.indexOf('tr='+tr) != -1
    }
    self.add = (uri, trs) => {
        if(!jQuery.isArray(trs)){
            trs = self.parse(trs)
        }
        trs.forEach(tr => {
            if(!self.has(uri, tr)){
                if(uri.indexOf('?') == -1){
                    uri += '?'
                } else {
                    uri += '&'
                }
                uri += 'tr='+tr
            }
        })
        return uri.replace('&&', '&')       
    }
    self.remove = (uri, trs) => {
        uri = uri.split('?')
        if(uri.length > 1){
            if(!jQuery.isArray(trs)){
                trs = self.parse(trs)
            }
            uri[1] = uri[1].split('&').filter(tr => {
                tr = tr.split('=')
                if(tr.length > 1){
                    if(trs.indexOf(tr[1]) != -1){
                        return false
                    }
                }
                return true
            }).join('&')
        }
        return uri.join('?')
    }
    return self
})()

var torrentsNotification = notify('...', 'fa-magnet', 'forever', true);
torrentsNotification.hide();

function createMagnetIntent(entry, options){    
    var self = createBaseIntent();
    self.transcode = typeof(entry.transcode) == 'boolean' ? entry.transcode : (Config.get('transcode-policy') == 'always' || 'wmv|avi|mpg|mpeg|3gp'.split('|').indexOf(getExt(getMagnetName(entry.url)||entry.url)) != -1);
    self.videoCodec = self.transcode ? 'libx264' : 'copy';
    self.type = 'magnet';
    self.entry = entry;
    self.folder = '';
    self.peerflix = false;
    self.streamURL = false;
    self.peerflixEndpoint = false;
    self.progressTimer = 0;
    self.unpaused = false;
    self.decoderOutputAppending = true;
    self.streamStarted = false;
    self.playbackStarted = false;
    self.ignoreErrors = true;
    self.streamType = 'video'
    self.videoEvents = {
        'play': () => {
            self.hideStats()
        },
        'playing': () => {
            self.hideStats()
        },
        'pause': () => {
            self.showStats() 
        },
        'waiting': () => {
            self.showStats() 
        },
        'stalled': () => {
            self.showStats() 
        },
        'error': (data) => { // error
            if(self.ignoreErrors){
                setTimeout(self.resume, 200)
                return true
            } else {
                self.hideStats()
                return false
            }
        }
    }
    self.percent = () => {        
        var downloaded = 0;
        for (var i = 0; i < self.peerflix.torrent.pieces.length; i++) {
            if (self.peerflix.bitfield.get(i)){
                downloaded++;
            }
        }      
        return (downloaded / (self.peerflix.torrent.pieces.length / 100))
    }   
    self.isReady = () => {
        self.streamURL = self.transcode ? self.ffmpegEndpoint : self.peerflixEndpoint;
        return self.streamURL
    }
    self.resume = () => { 
        if(!self.shadow){
            Playback.setState('load')
        }
        self.showStats()
        if(self.isReady()){
            var f = getFrame('player'), v = f.video
            if(!self.playbackStarted) {
                self.playbackStarted = true;
                console.warn('RESUME', self.transcode)
                if(self.transcode){
                    Playback.connect(
                        self.ffmpegEndpoint, 
                        'application/x-mpegURL; codecs="avc1.4D401E, mp4a.40.2"'
                    )
                } else {
                    Playback.connect(
                        self.peerflixEndpoint, 
                        'video/mp4'
                    )
                }
                showPlayers(true, false)
            } else {
                if(v.paused){
                    v.play()
                }
            }
            if(self.manifestAvailable){
                setTimeout(() => {
                    self.ignoreErrors = false;
                    if(!v.currentTime){
                        f.reset()
                    }
                }, 5000)
            }
        }
    }
    self.commit = () => {
        self.attached = true;
        var v = self.getVideo()
        if(v) v.pause()
        showPlayers(true, false)
    }
    self.showStats = () => {
        torrentsNotification.show()
    }
    self.hideStats = () => {
        torrentsNotification.hide()
    }    
    self.run = () => {
        if(Config.get('p2p')){
            console.log('run() called')
            torrentsNotification.update(Lang.SEARCHING_PEERS, 'fa-circle-notch pulse-spin', 'wait')
            self.setTimeout(600)
            if(typeof(peerflix)=='undefined'){
                window.peerflix = require('peerflix')
            }
            let defTrackers = Trackers.parse(self.entry.url) 
            self.entry.url = Trackers.add(self.entry.url, torrentsDefaultTrackers)
            self.peerflix = peerflix(self.entry.url, {tmp: torrentsFolder})
            self.peerflix.server.on('listening', () => {
                self.peerflixEndpoint = 'http://127.0.0.1:' +  self.peerflix.server.address().port + '/';
                self.stream()
                let jfile = torrentsFolder + path.sep + 'torrent-stream' + path.sep + getMagnetHash(self.entry.url) + '.json'
                //console.warn("EXX", jfile)
                fs.exists(jfile, exists => {
                    console.warn("EXX", jfile, exists)
                    if(!exists){
                        console.warn("EXX", defTrackers)
                        fs.writeFile(jfile, JSON.stringify(defTrackers), jQuery.noop)
                    }
                })                
            })
            self.started = true;
            self.trigger('start', self)
        } else {
            self.error = 'p2p-disabled';
            self.trigger('error')
        }
    }
    self.destroy = () => {
        self.hideStats();
        clearInterval(self.progressTimer);
        self.peerflix.destroy();
        self.trigger('destroy')
    }    
    self.stream = () => {
        localTorrentsEntries = false // flush local torrents cache
        if(!self.streamStarted){
            self.streamStarted = true;
            if(self.transcode){
                self.decoder = ffmpeg(self.peerflixEndpoint).
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
                addOption('-pix_fmt', 'yuv420p').
                addOption('-profile:v', 'main').
                addOption('-preset:v', 'veryfast').
                addOption('-sn').
                format('hls');
        
                        //addOption('-g 15').
                        //addOption('-cluster_size_limit 10M').
                        //addOption('-cluster_time_limit 10K').
                        //addOption('-movflags +faststart+frag_keyframe+empty_moov+default_base_moof').
                        //addOption('-x264opts no-scenecut')

                if(self.playback.allowTranscodeFPS){
                    let fps = Config.get('transcode-fps')
                    if(fps > 0) {
                        self.decoder.
                        addOption('-vf', '"minterpolate=fps='+fps+':mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"').
                        addOption('-r', fps)
                    }
                }
            
                if (self.entry.url.indexOf('http') == 0 && isMedia(self.entry.url)) { // skip other protocols
                    var agent = navigator.userAgent.split('"')[0];
                    self.decoder.inputOptions('-user_agent', '"' + agent + '"') //  -headers ""
                        .inputOptions('-icy 0')
                        .inputOptions('-seekable 1')
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
                self.decoder.file = path.resolve(self.workDir + path.sep + self.uid + path.sep + 'output.m3u8')
                self.ffmpegEndpoint = self.playback.proxyLocal.proxify(self.decoder.file)

                mkdirr(dirname(self.decoder.file));    
                waitInstanceFileExistsTimeout(self, (exists) => {
                    if(!self.ended && !self.error){
                        if(exists){
                            console.log('M3U8 file created.')
                            self.manifestAvailable = true;
                            self.resume()
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
                self.manifestAvailable = true;
            }
            self.resume()
        }
    }
    var lastPercentage = null;
    self.progressTimer = setInterval(() => {
        if(self.peerflix && self.peerflix.torrent){
            var p = self.percent()
            if(p >= 0 && p != lastPercentage){
                lastPercentage = p;
                torrentPercentage(self.entry.url, p)
                var complete = p >= 100
                torrentsNotification.update(
                    complete ? Lang.COMPLETE : (Lang.RECEIVING+': '+ Math.round(p, 2) +'% &middot; '+ formatBytes(self.peerflix.swarm.downloadSpeed())+'/s'), 
                    (self.playbackStarted || complete) ? 'fa-magnet' : 'fa-circle-notch pulse-spin'
                )
                updateTorrentsListingState(self.entry.url, p)
            }            
        }
    }, 1000)
    var err = () => {
        self.hideStats()  
        clearInterval(self.progressTimer)
    }
    self.on('error', err)
    self.on('end', err)
    self.on('getVideo', () => {
        console.log('WAXXX', self.videoElement)
        var cb = () => {
            var t = self.videoElement.currentTime
            console.log('WAXXX', t)
            if(t && t > 0){
                jQuery(self.videoElement).off('timeupdate', cb)
                self.playback.setState('play')
            }
        }
        jQuery(self.videoElement).on('timeupdate', cb)
        console.log('WAXXX')
    })
    if(options){
        self.apply(options)
    } 
    self.playback.on('stop', () => {
        self.hideStats()
    })   
    return self;
}


