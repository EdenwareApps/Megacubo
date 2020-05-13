

Playback.HLSManager = ((parent) => {
    var self = {
        debug: debugAllow(true),
        callbacks: {},
        minBufferSecs: 5,
        maxQueueLength: 10,
        maxIndexLength: 1024,
        parent,
        indexing: [],
        peers: [],
        request: false,
        started: false,
        closed: false,
        p2pml_use_require: false, // actually crashing on win32 when true, disable for now
        trackers: ["ten.obucagem.langis//:sw".split('').reverse().join('')],
        lastRequestedSegmentUrl: '',
        lastRequestedSegmentsDurations: [],
        downloading: {}
    }
    self.swarmId = () => {
        var id = 'megacubo'
        if(self.parent.active){
            var url = self.parent.active.entry.url
            if(typeof(self.parent.active.entry.originalUrl) != 'undefined' && self.parent.active.entry.originalUrl.match(new RegExp('^(https?://|//)'))){
                url = self.parent.active.entry.originalUrl
            }
            url = getDomain(url) + '-' + basename(url, true)
            id += '-' + url
        }
        return id
    }
    self.reset = () => {
        self.stats = {
            http: {
                out: 0,
                in: 0
            },
            p2p: {
                out: 0,
                in: 0
            }
        }
        if(self.loader){
            self.loader.destroy()
        }
        var cbkeys = Object.keys(self.callbacks)
        if(cbkeys.length){
            cbkeys.forEach(o => {
                self.error(o, 'invalidated', true)
            })
            self.callbacks  = {}
        }
        self.log('RESET', self.callbacks)
        self.loader = new self.p2pml.HybridLoader({
            trackerAnnounce: self.trackers,
            simultaneousP2PDownloads: 6,
            requiredSegmentsPriority: 0,
            httpDownloadProbability: 0,
            cachedSegmentsCount: 20, // default is 30, use less ram with 20
            httpFailedSegmentTimeout: 60000,
            p2pSegmentDownloadTimeout: 30000,
            useP2P: Config.get('p2p')
        })
        self.loader.on(self.p2pml.Events.SegmentLoaded, self.loaded)
        self.loader.on(self.p2pml.Events.SegmentError, self.error)
        self.loader.on(self.p2pml.Events.SegmentAbort, self.abort)
        self.loader.on(self.p2pml.Events.PeerConnect, (peer) => {
            if(self.peers.indexOf(peer.id) == -1){
                self.peers.push(peer.id)
            }
            self.log('peer connected', peer.id, 'Total', self.peers.length)
        })
        self.loader.on(self.p2pml.Events.PeerClose, (peerId) => {
            self.peers = self.peers.filter(id => {
                return id && id != peerId
            })
            self.log('peer disconnected', peerId)
        })
        self.loader.on(self.p2pml.Events.PieceBytesDownloaded, (method, bytes, peerId) => {
            if(method == 'p2p'){
                self.log('data received (via p2p)', bytes + 'bytes')
            }
            self.stats[method].in += bytes
        })
        self.loader.on(self.p2pml.Events.PieceBytesUploaded, (method, bytes) => {
            self.log('data sent (via p2p)', bytes + 'bytes')
            self.stats[method].out += bytes
        })
    }
    self.log = (...arguments) => {
        if(self.debug){
            arguments.unshift('[Playback.HLSManager]')
            console.log.apply(this, arguments)
        }
    }
    self.process = (content, url) => {
        if(content && url){
            const durations = content.toLowerCase().split('extinf:').map(l => {
                l = l.match(new RegExp('^([0-9\.]+)'))
                return l && l.length ? parseFloat(l[0]) : false
            }).filter(n => {
                return typeof(n) == 'number'
            })
            if(durations.length){
                self.lastRequestedSegmentsDurations = self.lastRequestedSegmentsDurations.concat(durations)
                let max = 10, len = self.lastRequestedSegmentsDurations.length
                if(len > max){
                    self.lastRequestedSegmentsDurations = self.lastRequestedSegmentsDurations.slice(len - max)
                }
            }
            const parser = getM3u8Parser()
            parser.push(content)
            parser.end()
            let u, urls = [], replaces = {}
            if(parser.manifest){
                if(parser.manifest.segments){
                    for(var i=0;i<parser.manifest.segments.length;i++){
                        u = absolutize(parser.manifest.segments[i].uri, url)
                        urls.push(self.parent.proxyLow.proxify(u))
                        replaces[parser.manifest.segments[i].uri] = self.parent.proxy.proxify(u)
                        if(self.loader.segmentsQueue.length < self.maxQueueLength){
                            if(self.download(u)){
                                self.log('predict', u)
                            }                
                        }
                    }
                }
                if(parser.manifest.playlists){
                    for(var i=0;i<parser.manifest.playlists.length;i++){
                        u = absolutize(parser.manifest.playlists[i].uri, url)
                        replaces[parser.manifest.playlists[i].uri] = self.parent.proxy.proxify(u)
                    }
                }
            }
            if(urls.length){   
                var i = self.indexing.indexOf(urls[0])
                if(i != -1){
                    self.indexing = self.indexing.slice(0, i)
                }
                if(self.indexing.length > self.maxIndexLength){
                    self.indexing = self.indexing.slice(self.maxIndexLength - self.indexing.length)
                }
                self.indexing = self.indexing.concat(urls)
            }
            Object.keys(replaces).forEach(oldUrl => {
                content = content.replaceAll(oldUrl, replaces[oldUrl])
            })
            // self.log('PROCESSX', content, url, urls, replaces)
        }
        let changed, segments = (self.loader.segmentsQueue || []).slice(0).filter(s => {
            let already = self.loader.segments.get(s.id)
            if(already && typeof(already.data) != 'undefined'){
                // self.log('segment already downloaded', s)
                changed = true
                self.loaded(already, true)
            }
            return !already
        })
        if(changed){
            self.load(segments)
        }
        self.loader.processSegmentsQueue.apply(self.loader, [])
        return content
    }
    self.hls = () => {
        let player = getFrame('player')
        return player ? player.hls : false
    }
    self.currentSegmentUrl = (proxify) => {
        let url = '', hls = self.hls()
        if(hls && hls.streamController && hls.streamController.fragPlaying){
            url = hls.streamController.fragPlaying._url
        } else {
            if(self.loader.segmentsQueue.length){
                url = self.loader.segmentsQueue[0].url
            } else if(self.loader.segments.length){
                url = self.loader.segments[self.loader.segments.length - 1].url
            }
        }
        url = self.parent.proxy.unproxify(url)
        return self.parent.proxyLow[proxify ? 'proxify' : 'unproxify'](url)
    }
    self.currentSegmentDuration = () => {
        let hls = self.hls()
        if(hls && hls.streamController && hls.streamController.fragPlaying){
            return hls.streamController.fragPlaying.duration
        }
        return 2 // reasonable default ts duration
    }
    self.priorize = (segments) => {
        let dups = []
        segments = segments.filter(s => {
            if(dups.indexOf(s.id) != -1){
                return false
            }
            dups.push(s.id)
            let already = self.loader.segments.get(s.id)
            if(already && typeof(already.data) != 'undefined'){
                // self.log('segment already downloaded *', typeof(already.data), already.data)
                self.loaded(already, true)
                return false
            }
            return true
        })
        /*
        Object.keys(self.callbacks).forEach(id => {
            if(self.callbacks[id].length){
                let s = self.loader.segments.get(id)
                if(s){
                    self.log('segment already downloaded **', typeof(already.data), already.data)
                    self.loaded(s, true)
                } else if(s && typeof(s.data) != 'undefined') {
                    if(!segments.some(s => {
                        return s.id == id
                    })){
                        self.log('segment reinserted', typeof(s.data), s.data, JSON.stringify(segments), id)
                        segments.unshift(new self.p2pml.Segment(id, self.callbacks[id][0].url, undefined))
                    }
                }
            } else {
                delete self.callbacks[id]
            }
        })
        */
        if(segments.length){ // even if length=1, run this to adjust download priority (p2p x http)
            var ordered, needle = self.currentSegmentUrl(true)
            if(needle){
                var needleIndex = self.indexing.indexOf(needle)
                //self.log('NEEDLE', needleIndex, self.indexing, needle)
                if(needleIndex != -1){
                    ordered = true
                    var priority = 0, bufferedAmount = 0, bufferAmountRequired = Math.ceil(self.minBufferSecs / self.currentSegmentDuration())
                    for(var i = needleIndex; i < self.indexing.length; i++){
                        let indexed
                        self.loader.segments.forEach(s => {
                            if(!indexed && s.url == self.indexing[i]){
                                indexed = true
                            }
                        })
                        if(!indexed){
                            break
                        }
                        bufferedAmount++
                    }
                    if(self.peers.length){
                        if(bufferAmountRequired < 1){
                            bufferAmountRequired = 0
                        }
                        if(bufferAmountRequired < bufferedAmount || self.parent.stalled()){  // buffered enough, let http rest
                            priority = 0
                            self.loader.settings.requiredSegmentsPriority = 0
                        } else {
                            self.loader.settings.requiredSegmentsPriority = bufferAmountRequired - bufferedAmount
                        }
                    } else { // no peers, do http way only
                        priority = 0
                        self.loader.settings.requiredSegmentsPriority = 0
                    }
                    //self.log('SHOULDBUF', shouldBuf, bufferAmountRequired, bufferedAmount, self.minBufferSecs, self.currentSegmentDuration())
                    var log = []
                    segments = segments.filter(s => {
                        var ret = self.indexing.indexOf(s.url) != -1
                        if(!ret){
                            self.log('segment not on indexing', s, self.indexing[0], self.indexing[self.indexing.length - 1], self.indexing)
                        }
                        return ret
                    }).map(s => {
                        s.priority = priority
                        priority++
                        return s
                    }).sort((a, b) => {
                        const ia = a.priority
                        const ib = b.priority
                        let comparison = 0
                        if (ia > ib) {
                            comparison = 1
                        } else if (ia < ib) {
                            comparison = -1
                        } else {
                            if(a.url > b.url) {
                                comparison = 1
                            } else if (a.url < b.url) {
                                comparison = -1
                            }
                        }
                        return comparison
                    }).map(s => {
                        log.push(s.priority+' :: '+basename(s.url, true))
                        return s
                    })
                    self.log("QUEUE ("+self.loader.settings.requiredSegmentsPriority+", "+bufferAmountRequired+"<"+bufferedAmount+")\r\n" + log.join("\r\n"))
                    //self.log('SHOULDBUF', segments, ordered, self.loader.createSegmentsMap())
                }
            }
            if(!ordered){
                segments = segments.map((s, i) => {
                    s.priority = i
                    return s
                })
            }
        }
        //self.log('SEGMENTSX', segments, ordered, self.loader.createSegmentsMap())
        return segments
    }
    self.load = (segments, segment) => { 
        self.log("stepp 1")
        if(!Array.isArray(segments)){
            segments = (self.loader.segmentsQueue || []).slice(0)
        }
        if(segment && !self.loader.segments.get(segment.id)){
            segment.priority = 0
            var maxQueueLen = 50
            if(segments.length > maxQueueLen){
                var j = segments.length - maxQueueLen
                segments = segments.filter((s, i) => {
                    if(i < j){
                        console.warn('queued out', 'adding: '+segment.url, 'to', segments.map(s => { return s.url }).join("\r\n"))
                        self.error(s, 'queued out, ' + segments.length +' > '+maxQueueLen, true)                   
                    } else {
                        return true
                    }
                }).slice()
            }
            segments.push(segment)
            self.indexing.push(segment.url)
        }
        self.log("stepp 2", segments)
        let nsegments = self.priorize(segments)      
        self.log("stepp 2.5", nsegments)  
        self.loader.load(nsegments, self.swarmId())
        self.log("stepp 3", self.loader.segmentsQueue)        
    }
    self.loaded = (segment, stop) => {
        if(typeof(self.downloading[segment.id]) == 'number' && self.downloading[segment.id]){
            self.downloading[segment.id]--
        }
        if(typeof(self.callbacks[segment.id]) != 'undefined'){
            self.callbacks[segment.id].forEach(o => {
                o.cb(null, segment.data)
            })
            delete self.callbacks[segment.id]
        }
        if(stop !== true){
            self.log("loaded:", segment.url, "bytes:", segment.data.byteLength, typeof(self.callbacks[segment.id]))
            self.load()
        }
    }
    self.error = (segment, error, stop) => {
        if(self.loader.p2pManager.isDownloading(segment)){
            self.log("segment loading failed, wait for p2p?", segment, error)
            return
        }
        if(typeof(self.downloading[segment.id]) == 'number' && self.downloading[segment.id]){
            self.downloading[segment.id]--
        }
        self.log("segment loading failed", segment, error)
        if(typeof(self.callbacks[segment.id]) != 'undefined'){
            self.callbacks[segment.id].forEach(o => {
                o.cb(error || 'failed')
            })
            delete self.callbacks[segment.id]
        }
        if(stop !== true){
            self.load()
        }
    }
    self.abort = (segment) => {
        self.log("segment loading abort", segment)
        self.error(segment, "Segment load aborted", true)
    }
    self.init = () => {
        self.started = true;
        self.request = requestForever
        if(self.p2pml_use_require){
            self.p2pml = require('p2p-media-loader-core')
            self.reset()
        } else {
            loadScript('modules/p2p-media-loader-core/build/p2p-media-loader-core.js', () => {
                self.p2pml = p2pml.core
                self.reset()
            })
        }
    }
    self.id = (url) => {
        let l = url
        if(getExt(l) == 'ts'){
            l = removeQueryString(l)
        }
        return self.swarmId() + '+' + l
    }
    self.download = (url, cb) => {
        const id = self.id(url), internalUrl = self.parent.proxyLow.proxify(url)
        if(!self.parent.proxy.isFragment(url)){
            const err = 'Segment ignored: ' + url
            console.error(err)
            if(typeof(cb) == 'function'){
                cb(err)
            }
            return
        }
        if(typeof(cb) == 'function'){
            if(typeof(self.callbacks[id]) == 'undefined'){
                self.callbacks[id] = []
            }
            self.callbacks[id].push({id, cb, url: internalUrl, originalUrl: url})
            self.lastRequestedSegmentUrl = url
            if(self.loader.segmentsQueue.size >= 3){
                var cancelling = self.loader.segmentsQueue.slice(0, self.loader.segmentsQueue.size - 3)
                self.loader.segmentsQueue = self.loader.segmentsQueue.slice(self.loader.segmentsQueue.size - 3)
                cancelling.forEach(s => {
                    self.error(s, 'queued out*', true)
                })
            }
        }
        var segment = self.loader.getSegment(id)
        if(segment){
            self.log('segment precached', url)
            self.loaded(segment, true)
        } else { // maybe futurely support mp4 with pseudo ranging 
            let downloading = self.loader.segmentsQueue.some(s => { 
                return s.id == id
            })
            if(!downloading){
                if(typeof(self.downloading) == 'undefined'){
                    self.downloading[url] = 0
                }
                self.downloading[url]++
                self.log('segment requesting...', url)
                self.load(null, new self.p2pml.Segment(id, internalUrl, undefined))
                return true
            }
        }
    }
    self.cancelDownload = (url) => {
        self.log('cancel download', url)
        const id = self.id(url)
        if(typeof(self.downloading[id]) == 'number' && self.downloading[id]){
            self.downloading[id]--
        }
        let has = self.loader.segmentsQueue.filter(s => s.id == id).length
        if(has){
            self.load(self.loader.segmentsQueue.filter(s => { 
                if(s.id == id){
                    if(self.loader.httpManager.isDownloading(s)){
                        self.loader.httpManager.abort(s)
                    }
                    if(!self.loader.p2pManager.isDownloading(s)){
                        self.loader.p2pManager.download(s)
                    }
                }
                return true
            }))
            return true
        }
    }
    self.destroy = () => {
        self.log('closing...')
        self.closed = true;
    }
    self.parent.on('stop', self.reset)
    addAction('appUnload', () => {
        self.destroy()
    })
    addFilter('about', txt => {
        if(self.parent.active && self.parent.active.type == 'hls'){
            if(self.stats.p2p.in || self.loader.p2pManager.peers.size){
                txt += 'P2P: '+Math.round(parseFloat(self.stats.p2p.in / ((self.stats.http.in + self.stats.p2p.in) / 100)), 1) + '%'
                if(self.loader.p2pManager.peers.size > 1){
                    txt += ' (' + self.loader.p2pManager.peers.size + ' ' + Lang.USERS + ')'
                }
                txt += "\n";   
            }  
        }
        return txt      
    })
    self.init()
    return self
})(Playback)