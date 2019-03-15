
const iprx = (() => {
    var debug = false, networking = true, closed, ipcache, self = {
        peers: [],
        srv: false,
        request: false,
        initialized: false,
        listenPort: 0,
        listenIP: '127.0.0.1',
        p2pPort: 9000
    }
    self.resetStats = () => {
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
    }
    self.ip = (recheck) => {
        if(recheck || !ipcache){
            if(networking){
                var dat = Object.keys(os.networkInterfaces())
                    // flatten interfaces to an array
                    .reduce((a, key) => [
                        ...a,
                        ...os.networkInterfaces()[key]
                    ], [])
                    // non-internal ipv4 addresses only
                    .filter(iface => iface.family === 'IPv4' && !iface.internal)
                    // project ipv4 address as a 32-bit number (n)
                    .map(iface => ({...iface, n: (d => ((((((+d[0])*256)+(+d[1]))*256)+(+d[2]))*256)+(+d[3]))(iface.address.split('.'))}))
                    // set a hi-bit on (n) for reserved addresses so they will sort to the bottom
                    .map(iface => iface.address.startsWith('10.') || iface.address.startsWith('192.') ? {...iface, n: Math.pow(2,32) + iface.n} : iface)
                    // sort ascending on (n)
                    .sort((a, b) => a.n - b.n)
                ipcache = dat.length ? dat[0].address : '127.0.0.1'
            } else {
                ipcache = '127.0.0.1'
            }
        }
        return ipcache;
    }
    self.listen = () => {
        var ip = self.ip(true)
        if(self.listenIP != ip || !self.srv){
            self.listenIP = ip;
            if(self.srv){
                self.srv.close()
            }
            self.srv = http.createServer((req, response) => {
                if(debug){
                    console.log('req starting...', req);
                }
                if(closed){
                    return;
                }
                if(debug){
                    console.log('req starting...', req);
                }
                var headers = { 
                    'Cache-Control': 'no-cache',
                    'Access-Control-Allow-Origin': '*'
                }
                var url = req.url.split('#')[0];
                if(req.url.substr(0, 3) == '/s/'){
                    url = req.url.replace('/s/', 'https://');
                }
                if(url.indexOf('crossdomain.xml')!=-1){
                    response.writeHead(200, {'Content-Type': 'text/xml'});
                    response.end("<?xml version=\"1.0\"?>\r\n<!-- http://www.osmf.org/crossdomain.xml -->\r\n<!DOCTYPE cross-domain-policy SYSTEM \"http://www.adobe.com/xml/dtds/cross-domain-policy.dtd\">\r\n<cross-domain-policy>\r\n<allow-access-from domain=\"*\" secure=\"false\"/>\r\n<allow-http-request-headers-from secure=\"false\" headers=\"*\" domain=\"*\"/>\r\n</cross-domain-policy>");
                    return;
                }
                url = decodeEntities(url)
                if(url.charAt(0)=='/'){
                    url = "http:/"+url;
                }
                if(debug){
                    console.log('serving', url);
                }
                let domain = getDomain(url).split(':')[0], ts = getExt(url) == 'ts', type = ts ? "video/MP2T" : "application/x-mpegURL"
                let ppath  = url.replace(new RegExp('^.*//[^/]+'), ''), _port = url.match(new RegExp(':([0-9]+)'))
                _port = _port ? parseInt(_port[1]) : 80                
                if(['127.0.0.1', 'localhost'].indexOf(domain) != -1 && _port == 80){
                    if(debug){
                        console.log('start fetching local...', url, ppath)
                    }
                    fs.readFile(path.resolve(ppath), (err, buffer) => {
                        if(debug){
                            console.log('fetch local', err, buffer ? buffer.byteLength : 0)
                        }
                        if(err){
                            response.writeHead(404, {
                                "Access-Control-Allow-Origin": "*"
                            })
                        } else {
                            response.writeHead(200, {
                                "Access-Control-Allow-Origin": "*",
                                "Content-Type": type
                            })
                            response.end(buffer, 'binary')
                        }
                    })
                } else {
                    if(ts){
                        if(debug){
                            console.log('start fetching...')
                        }
                        self.fetch(url, (err, buffer) => {
                            if(err){
                                response.writeHead(404, {
                                    "Access-Control-Allow-Origin": "*"
                                })
                                if(debug){
                                    console.log('responding', 'error 404')
                                }
                                response.end()
                            } else {
                                buffer = bufferize(buffer);  
                                if(debug){
                                    console.log('responding', buffer.byteLength)
                                }
                                response.writeHead(200, {
                                    "Access-Control-Allow-Origin": "*",
                                    "Content-Type": type
                                })
                                response.end(buffer, 'binary')
                            }
                            if(debug){
                                console.log('fine.')
                            }
                            doAction('media-save', url, buffer, 'content');
                            buffer = null;
                        })
                    } else if(isM3U8(url)) {
                        self.request({
                            url: url,
                            followRedirect: false
                        }, (err, rsp, buffer) => {
                            var content;
                            if(debug){
                                console.log('responding', buffer);
                            }
                            if(err){
                                console.error(err)
                                response.writeHead(
                                    rsp ? rsp.statusCode : 404, 
                                    {"Access-Control-Allow-Origin": "*"}
                                )
                            } else {
                                if(typeof(rsp['headers']['location']) != 'undefined'){
                                    response.writeHead(307, {
                                        "Access-Control-Allow-Origin": "*",
                                        "Location": self.resolve(rsp['headers']['location'])
                                    })
                                    response.end(content)
                                } else {
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
                                                content = content.replaceAll(matches[i], self.resolve(matches[i]))
                                            }
                                        }
                                    }
                                    response.writeHead(200, {
                                        "Access-Control-Allow-Origin": "*",
                                        "Content-Type": type
                                    })
                                    response.end(content)
                                }
                            }
                            response.end();
                            content = null;
                        })
                    } else {
                        var headers = req.headers
                        headers.host = domain
                        console.warn('OPEN', url, req)
                        req.url = url;
                        var err, sent, r = self.request({
                            url: url,
                            headers: req.headers,
                            followRedirect: false
                        })
                        req.pipe(r)
                        r.on("response", rres => {
                            sent = true
                            console.warn('RESPONSE', rres)
                            if(typeof(rres.headers['location']) != 'undefined'){
                                rres.headers['location'] = self.resolve(resolveURL(rres.headers['location'], url))
                                rres.headers['access-control-allow-origin'] = '*'
                                console.warn('RESPONSE', rres.headers)
                            }
                        })
                        r.on('error', e => {
                            err = e
                            console.warn('CLOSE', JSON.stringify(e))
                        })
                        r.on('close', s => {
                            console.warn('CLOSE', s)
                            if(err && !sent){
                                response.writeHead(500, {"Access-Control-Allow-Origin": "*"})
                            }
                            response.end()
                        })      
                        r.pipe(response, {end: true})
                    }
                }
            }).listen(0, ip)
        }
    }
    self.loaded = (segment) => {
        if(debug){
            console.log("Loading finished, bytes:", segment.data.byteLength)
        }
        if(typeof(self.segmentLoadCallbacks[segment.url]) != 'undefined'){
            self.segmentLoadCallbacks[segment.url].forEach(cb => {
                cb(null, segment.data)
            })
        }
        delete self.segmentLoadCallbacks[segment.url]
    }
    self.setP2PPort = (port) => {
        self.p2pPort = port
        if(self.initialized){
            self.p2pml.destroy()
            self.init()
        }
    }
    self.init = () => {
        self.initialized = true;
        self.resetStats()
        self.listen()
        self.request = prepareRequestForever()
        self.p2pml = require(path.resolve('other_modules/p2p-media-loader-core'))
        self.segmentLoadCallbacks = []
        self.segmentLoader = new self.p2pml.HybridLoader({port: self.p2pPort})
        self.segmentLoader.on(self.p2pml.Events.SegmentLoaded, self.loaded)
        self.segmentLoader.on(self.p2pml.Events.SegmentError, (segment, error) => {
            if(debug){
                console.log("Loading failed", segment, error)
            }
            if(typeof(self.segmentLoadCallbacks[segment.url]) != 'undefined'){
                self.segmentLoadCallbacks[segment.url].forEach(cb => {
                    cb(error || 'Loading failed')
                })
            }
            delete self.segmentLoadCallbacks[segment.url]
        })
        self.segmentLoader.on(self.p2pml.Events.PeerConnect, (peer) => {
            if(self.peers.indexOf(peer.id) == -1){
                self.peers.push(peer.id)
            }
            if(debug){
                console.log('Peer connected', peer.id, 'Total', self.peers.length)
            }
        })
        self.segmentLoader.on(self.p2pml.Events.PeerClose, (peerId) => {
            self.peers = self.peers.filter((id) => {
                return id && id != peerId
            })
            if(debug){
                console.log('Peer disconnected', peer.id, 'Total', self.peers.length)
            }
        })
        self.segmentLoader.on(self.p2pml.Events.PieceBytesDownloaded, (method, bytes, peerId) => {
            self.stats[method].in += bytes
        })
        self.segmentLoader.on(self.p2pml.Events.PieceBytesUploaded, (method, bytes) => {
            self.stats[method].out += bytes
        })
    }
    self.fetch = (url, cb) => {
        var fetching = typeof(self.segmentLoadCallbacks[url]) != 'undefined';
        if(!fetching){
            self.segmentLoadCallbacks[url] = []
        }
        self.segmentLoadCallbacks[url].push(cb)
        var segment = self.segmentLoader.getSegment(url)
        if(segment && segment.data){
            return self.loaded(segment)
        } else if(!fetching) {
            if(Playback.allowP2P()){
                self.segmentLoader.load([
                    new self.p2pml.Segment(url, url, undefined, 0)
                ], Playback.active ? Playback.active.entry.name.toLowerCase().replace(new RegExp('[^a-z0-9]+'), '') : 'megacubo')
            } else {
                var cb = function () {
                    blobToBuffer(this.response, (err, buffer) => {
                        self.loaded({url: url, data: buffer || ''})
                    })
                    this.removeEventListener('load', cb);
                    delete cb;
                }
                var invocation = new nw.global.XMLHttpRequest();
                invocation.open('GET', url, true);
                invocation.responseType = "blob";
                invocation.addEventListener('load', cb);
                invocation.send(null)
            }
        }
    }
    self.isSupported = (url) => {
        return url && url.indexOf('//') != -1 && url.indexOf('//127.0.0.1/') == -1 && ['m3u8', 'mp4'].indexOf(getExt(url)) != -1
    }
    self.resolve = (url) => {
        if(typeof(url)=='string' && url.indexOf('//') != -1){
            let ip = self.ip()
            if(!self.listenPort){
                self.listenPort = self.srv.address().port
            }
            var match = url.match(new RegExp(ip.replaceAll('.', '\\.') + ':([0-9]+)'))
            if(match){
                url = url.replace(':'+match[1]+'/', ':'+self.listenPort+'/');
            } else {
                url = url.replace(new RegExp('^(http://|//)', 'i'), 'http://'+ip+':'+self.listenPort+'/').replace(new RegExp('^https://', 'i'), 'http://'+ip+':'+self.listenPort+'/s/')
            }
        }
        return url;
    }
    self.destroy = () => {
        console.warn('Closing...');
        closed = true;
        if(self.srv){
            self.srv.close()
            self.srv = null;
        }
    }
    return self;
})()

iprx.setP2PPort(Config.get('p2p-port'))
iprx.init()

addAction('appUnload', () => {
    iprx.destroy()
})
