
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
        if(Array.isArray(trs)){
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
        if(!Array.isArray(trs)){
            return trs
        }
        return trs.getUnique().map(tr => { return 'tr='+encodeURIComponent(tr)}).join('&')
    }
    self.has = (uri, tr) => {
        return uri.indexOf('tr='+tr) != -1
    }
    self.add = (uri, trs) => {
        if(!Array.isArray(trs)){
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
            if(!Array.isArray(trs)){
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

class PlaybackMagnetIntent extends PlaybackBaseIntent {  
    constructor(entry, options){ 
        super(entry, options)
        this.type = 'magnet';
        this.entry = entry;
        this.folder = '';
        this.peerflix = false;
        this.streamURL = false;
        this.peerflixEndpoint = false;
        this.progressTimer = 0;
        this.unpaused = false;
        this.decoderOutputAppending = true;
        this.streamStarted = false;
        this.playbackStarted = false;
        this.ignoreErrors = true;
        this.streamType = 'video'
        this.videoEvents = {
            'play': [
                () => {
                    this.hideStats()
                }
            ],
            'playing': [
                () => {
                    this.hideStats()
                }
            ],
            'pause': [
                () => {
                    this.showStats() 
                }
            ],
            'waiting': [
                () => {
                    this.showStats() 
                }
            ],
            'stalled': [
                () => {
                    this.showStats() 
                }
            ],
            'error': [
                (data) => { // error
                    if(this.ignoreErrors){
                        setTimeout(this.resume, 200)
                        return true
                    } else {
                        this.hideStats()
                        return false
                    }
                }
            ]
        }
        var lastPercentage = null;
        this.progressTimer = setInterval(() => {
            if(this.peerflix && this.peerflix.torrent){
                var p = this.percent()
                if(p >= 0 && p != lastPercentage){
                    lastPercentage = p;
                    torrentPercentage(this.entry.url, p)
                    var complete = p >= 100
                    torrentsNotification.update(
                        complete ? Lang.COMPLETE : (Lang.RECEIVING+': '+ Math.round(p, 2) +'% &middot; '+ formatBytes(this.peerflix.swarm.downloadSpeed())+'/s'), 
                        (this.playbackStarted || complete) ? 'fa-magnet' : 'fa-mega spin-x-alt'
                    )
                    updateTorrentsListingState(this.entry.url, p)
                }            
            }
        }, 1000)
        var err = () => {
            this.hideStats()  
            clearInterval(this.progressTimer)
        }
        this.on('error', err)
        this.on('end', err)
        this.on('getVideo', () => {
            console.log('WAXXX', this.video)
            var cb = () => {
                var t = this.video.currentTime
                console.log('WAXXX', t)
                if(t && t > 0){
                    jQuery(this.video).off('timeupdate', cb)
                    this.playback.setState('play')
                }
            }
            jQuery(this.video).on('timeupdate', cb)
            console.log('WAXXX')
        })
        if(options){
            this.apply(options)
        } 
        this.playback.on('stop', () => {
            this.hideStats()
        })   
    }
    percent(){        
        var downloaded = 0;
        for (var i = 0; i < this.peerflix.torrent.pieces.length; i++) {
            if (this.peerflix.bitfield.get(i)){
                downloaded++;
            }
        }      
        return (downloaded / (this.peerflix.torrent.pieces.length / 100))
    }   
    isReady(){
        if(this.videoCodec == 'copy' && this.audioCodec == 'copy'){
            this.streamURL = this.peerflixEndpoint
            this.mimetype = PLAYBACK_MP4_MIMETYPE
        } else {
            this.streamURL = this.ffmpegEndpoint
            this.mimetype = PLAYBACK_HLS_MIMETYPE
        }
        return this.streamURL
    }
    resume(){ 
        if(!this.shadow){
            Playback.setState('load')
        }
        this.showStats()
        if(this.isReady()){
            var f = getFrame('player'), v = f.video
            if(!this.playbackStarted) {
                this.playbackStarted = true
                Playback.connect(this.streamURL, this.mimetype)
                showPlayers(true, false)
            } else {
                if(v.paused){
                    v.play()
                }
            }
            if(this.manifestAvailable){
                setTimeout(() => {
                    this.ignoreErrors = false;
                    if(!v.currentTime){
                        f.reset()
                    }
                }, 5000)
            }
        }
    }
    commit(){
        this.attached = true;
        var v = this.getVideo()
        if(v) v.pause()
        showPlayers(true, false)
    }
    showStats(){
        torrentsNotification.show()
    }
    hideStats(){
        torrentsNotification.hide()
    }    
    run(){
        if(Config.get('p2p')){
            console.log('run() called')
            torrentsNotification.update(Lang.SEARCHING_PEERS, 'fa-mega spin-x-alt', 'wait')
            this.setTimeout(600)
            if(typeof(peerflix)=='undefined'){
                window.peerflix = require('peerflix')
            }
            let defTrackers = Trackers.parse(this.entry.url) 
            this.entry.url = Trackers.add(this.entry.url, torrentsDefaultTrackers)
            this.peerflix = peerflix(this.entry.url, {tmp: torrentsFolder})
            this.peerflix.server.on('listening', () => {
                this.peerflixEndpoint = 'http://127.0.0.1:' +  this.peerflix.server.address().port + '/';
                this.stream()
                let jfile = torrentsFolder + path.sep + 'torrent-stream' + path.sep + getMagnetHash(this.entry.url) + '.json'
                //console.warn("EXX", jfile)
                fs.exists(jfile, exists => {
                    console.warn("EXX", jfile, exists)
                    if(!exists){
                        console.warn("EXX", defTrackers)
                        fs.writeFile(jfile, JSON.stringify(defTrackers), jQuery.noop)
                    }
                })                
            })
            this.start()
        } else {
            this.fail('p2p-disabled')
        }
    }
    destroy(){
        this.hideStats()
        clearInterval(this.progressTimer)
        this.peerflix.destroy()
        super.destroy()
    }    
    stream(){
        localTorrentsEntries = false // flush local torrents cache
        if(!this.streamStarted){
            this.streamStarted = true;
            if(this.videoCodec == 'copy' && this.audioCodec == 'copy'){
                this.manifestAvailable = true;
            } else {
                this.decoder = this.ffmpeg(this.peerflixEndpoint)
        
                        //addOption('-g 15').
                        //addOption('-cluster_size_limit 10M').
                        //addOption('-cluster_time_limit 10K').
                        //addOption('-movflags +faststart+frag_keyframe+empty_moov+default_base_moof').
                        //addOption('-x264opts no-scenecut')

                if(this.playback.allowTranscodeFPS){
                    let fps = Config.get('transcode-fps')
                    if(fps > 0) {
                        this.decoder.
                        addOption('-vf', '"minterpolate=fps='+fps+':mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1"').
                        addOption('-r', fps)
                    }
                }
            
                this.decoder.file = path.resolve(this.workDir + path.sep + this.uid + path.sep + 'output.m3u8')
                this.ffmpegEndpoint = this.playback.proxyLocal.proxify(this.decoder.file)

                mkdirr(dirname(this.decoder.file));    
                this.waiter = waitFileTimeout(this.decoder.file, (exists) => {
                    if(!this.ended && !this.error && !this.destroyed){
                        if(exists){
                            console.log('M3U8 file created.')
                            this.manifestAvailable = true;
                            this.resume()
                        } else {
                            console.error('M3U8 file creation timeout.');
                            this.fail('transcode')
                        }
                    }
                }, 1800);
                this.decoder.output(this.decoder.file).run()
            }
            this.resume()
        }
    }
}

PlaybackMagnetIntent.supports = (entry) => {
    return entry.url.match(new RegExp('^(magnet):', 'i'))
}

Playback.registerEngine('magnet', PlaybackMagnetIntent, 5)
