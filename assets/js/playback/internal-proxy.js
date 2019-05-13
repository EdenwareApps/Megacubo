
Playback.proxy = ((parent) => { // handle http / p2p with original url
    var networking = true, ipcache, self = {
        addr: '127.0.0.1',
        closed: false,
        debug: false,
        parent,
        port: 0, // let the http.server sort
        request: false,
        srv: false,
        started: false
    }
    self.log = (...arguments) => {
        arguments.unshift('[Playback.proxy]')
        console.log.apply(this, arguments)
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
        if(self.addr != ip || !self.srv){
            self.addr = ip;
            if(self.srv){
                self.srv.close()
            }
            self.srv = http.createServer((req, response) => {
                if(self.closed){
                    return;
                }
                if(self.debug){
                    self.log('req starting...', req);
                }
                var url = self.unproxify(req.url.split('#')[0])
                if(self.debug){
                    self.log('serving', url)
                }
                let domain = getDomain(url), ext = getExt(url), type
                switch(ext){
                    case 'ts':
                        type = 'video/MP2T';
                        break;
                    case 'm3u8':
                        type = 'application/x-mpegURL';
                        break;
                    default:
                        type = 'video/mp4';
                        break;
                }
                let port = url.match(new RegExp(':([0-9]+)'))
                port = port ? parseInt(port[1]) : 80    
                self.log('serving', domain, port)            
                if(['127.0.0.1', 'localhost'].indexOf(domain) != -1 && port == 80){
                    let localPath  = url.replace(new RegExp('^.*//[^/]+/?'), '')
                    if(self.debug){
                        self.log('start fetching local...', url, localPath)
                    }
                    fs.readFile(path.resolve(localPath), (err, buffer) => {
                        if(self.debug){
                            self.log('fetch local', err, buffer ? buffer.byteLength : 0)
                        }
                        if(err){
                            response.writeHead(404, {
                                "Access-Control-Allow-Origin": "*"
                            })
                            response.end()
                        } else {
                            response.writeHead(200, {
                                "Access-Control-Allow-Origin": "*",
                                "Content-Type": type
                            })
                            response.end(buffer, 'binary')
                        }
                    })
                } else if(ext == 'ts' && self.parent.active && self.parent.active.type != 'ts') { // only ts uses hybridSegmentFetch
                    if(self.debug){
                        self.log('start segment fetching...')
                    }
                    req.connection.on('close', () => {
                        console.warn('SEGMENT ABORT', url)
                        self.parent.HLSManager.cancelDownload(url)
                        response.end()
                    })
                    self.parent.HLSManager.download(url, (err, buffer, location) => {
                        if(err){
                            response.writeHead(502, {
                                "Access-Control-Allow-Origin": "*"
                            })
                            if(self.debug){
                                self.log('responding', 'error 502')
                            }
                            response.end()
                        } else {
                            buffer = bufferize(buffer)
                            doAction('media-save', url, buffer, 'content')
                            if(self.debug){
                                self.log('responding', buffer.byteLength)
                            }
                            if(location){
                                response.writeHead(307, {
                                    "Access-Control-Allow-Origin": "*",
                                    "Location": location
                                })
                            } else {
                                response.writeHead(200, {
                                    "Access-Control-Allow-Origin": "*",
                                    "Content-Type": type,
                                    "Content-Length": buffer.byteLength
                                })
                            }
                            response.end(buffer, 'binary')
                        }
                        if(self.debug){
                            self.log('fine.')
                        }
                        buffer = null;
                    })
                } else if(ext == 'm3u8') {
                    var headers = req.headers, finalUrl = url
                    headers.host = domain
                    if(self.debug){
                        self.log('open', url, req, ext)
                    }
                    req.url = url;
                    if(typeof(headers['accept-encoding']) != 'undefined'){
                        delete headers['accept-encoding']
                    }
                    var err, sent, r = self.request({
                        url: url,
                        headers: req.headers,
                        followRedirect: false
                    }, (error, res, body) => {
                        let hs, code
                        if(res && res.headers){
                            hs = res.headers
                            if(typeof(hs['location']) != 'undefined'){
                                finalUrl = absolutize(hs['location'], url)
                                hs['location'] = self.proxify(finalUrl)
                                hs['access-control-allow-origin'] = '*'
                                if(self.debug){
                                    self.log('response with location', hs)
                                }
                            }
                            if(typeof(hs['accept-encoding']) != 'undefined'){
                                delete hs['accept-encoding']
                            }
                            body = self.parent.HLSManager.process(body, finalUrl)
                            hs['content-length'] = body.length
                            code = res.statusCode
                        } else {
                            hs = {}
                            body = ''
                            hs['content-length'] = 0
                            code = 502
                        }
                        response.writeHead(code, hs)
                        response.end(body, {end: true})
                    })      
                } else { // piped direct response for non "ts segments"
                    var headers = req.headers, finalUrl = url
                    headers.host = domain
                    if(self.debug){
                        self.log('open', url, req, ext)
                    }
                    req.url = url;
                    var err, sent, r = self.request({
                        url: url,
                        headers: req.headers,
                        followRedirect: false
                    })
                    req.pipe(r)
                    r.on("response", res => {
                        sent = true
                        if(self.debug){
                            self.log('response', res)
                        }
                        if(typeof(res.headers['location']) != 'undefined'){
                            finalUrl = absolutize(res.headers['location'], url)
                            res.headers['location'] = self.proxify(finalUrl)
                            if(self.debug){
                                self.log('response with location', res.headers)
                            }
                        }
                        res.headers['access-control-allow-origin'] = '*'
                        response.writeHead(res.statusCode, res.headers)
                    })
                    r.on('error', e => {
                        err = e
                        if(self.debug){
                            self.log('error', JSON.stringify(e))
                        }
                    })
                    r.on('end', () => {
                        if(self.debug){
                            self.log('close', r, req, response, url, m3u8)
                        }
                        if(err && !sent){
                            response.writeHead(500)
                        }
                        response.end()
                    })      
                    r.pipe(response, {end: true})
                }
            }).listen(self.port, self.addr)
        }
    }
    self.init = () => {
        self.started = true;
        self.listen()
        self.request = prepareRequestForever()
    }
    self.isSupported = (url) => {
        return url && url.indexOf('//') != -1 && url.indexOf('//127.0.0.1/') == -1 && url.indexOf('//127.0.0.1:') == -1 && ['m3u8', 'mp4'].indexOf(getExt(url)) != -1
    }
    self.proxify = (url) => {
        if(typeof(url)=='string' && url.indexOf('//') != -1){
            let ip = self.ip()
            if(!self.port){
                if(self.srv && typeof(self.srv.address) == 'function'){
                    self.port = self.srv.address().port
                } else {
                    return url // srv not ready
                }
            }
            url = self.unproxify(url)
            url = url.replace(new RegExp('^(http://|//)', 'i'), 'http://'+self.addr+':'+self.port+'/').replace(new RegExp('^https://', 'i'), 'http://'+self.addr+':'+self.port+'/s/')
        }
        return url;
    }
    self.unproxify = (url) => {
        if(typeof(url)=='string'){
            if(url.substr(0, 3) == '/s/'){
                url = 'https://' + url.substr(3)
            } else if(url.charAt(0) == '/' && url.charAt(1) != '/'){
                url = 'http://' + url.substr(1)
            } else if(url.indexOf('//') != -1){
                var addrp = self.addr.split('.').slice(0, 3).join('.')
                if(url.indexOf(addrp) != -1){
                    url = url.replace(new RegExp('^(http://|//)'+addrp.replaceAll('.', '\\.')+'\\.[0-9]{0,3}:([0-9]+)/', 'g'), '$1').replace('://s/', 's://')
                }  
            }                      
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
        }
        return url;
    }
    self.destroy = () => {
        if(self.debug){
            self.log('closing...')
        }
        self.closed = true;
        if(self.srv){
            self.srv.close()
            self.srv = null;
        }
    }
    addAction('appUnload', () => {
        self.destroy()
    })
    self.init()
    return self
})(Playback)

Playback.proxyLow = ((parent) => { // handle low level connection from http manager with app cookies, for hls ts segments only
    var self = {
        parent,
        debug: false,
        closed: false, 
        started: false,
        addr: '127.0.0.1',
        port: 37419,  // should be equal for peers, so hardcode it
        request: false,
        srv: false
    }
    self.log = (...arguments) => {
        arguments.unshift('[Playback.proxyLow]')
        console.log.apply(this, arguments)
    }
    self.listen = () => {
        if(!self.srv){
            self.srv = http.createServer((req, response) => {
                if(self.closed){
                    return;
                }
                if(self.debug){
                    self.log('req starting...', req);
                }
                var url = req.url.split('#')[0];
                if(req.url.substr(0, 3) == '/s/'){
                    url = req.url.replace('/s/', 'https://');
                }
                url = decodeEntities(url)
                if(url.charAt(0)=='/'){
                    url = "http:/"+url;
                }
                if(self.debug){
                    self.log('serving', url);
                }
                let domain = getDomain(url).split(':')[0], ts = getExt(url) == 'ts', type = ts ? "video/MP2T" : "application/x-mpegURL"
                let ppath  = url.replace(new RegExp('^.*//[^/]+'), ''), port = url.match(new RegExp(':([0-9]+)'))
                port = port ? parseInt(port[1]) : 80   
                var headers = req.headers
                headers.host = domain
                if(self.debug){
                    self.log('open', url, req)
                }
                req.url = url;
                var err, hasErr, r = self.request({
                    url: url,
                    headers: req.headers,
                    followRedirect: true // last resort, follow redirects hee
                })
                req.pipe(r)
                r.on("response", res => {
                    hasErr = false
                    if(self.debug){
                        self.log('response', res)
                    }
                    res.headers['access-control-allow-origin'] = '*'
                    response.writeHead(res.statusCode, res.headers)
                })
                r.on('error', e => {
                    hasErr = e
                    if(self.debug){
                        self.log('error', JSON.stringify(e))
                    }
                })
                r.on('end', s => {
                    if(self.debug){
                        self.log('close', s)
                    }
                    if(hasErr){
                        try {
                            response.writeHead(500, {"Access-Control-Allow-Origin": "*"})
                        } catch(e) { }
                        response.end()
                    }
                })      
                r.pipe(response, {end: true})
            }).listen(self.port, self.addr)
        }
    }
    self.init = () => {
        self.started = true;
        self.listen()
        self.request = prepareRequestForever()
    }
    self.isSupported = (url) => {
        return url && url.indexOf('//') != -1 && url.indexOf('//127.0.0.1/') == -1 && ['m3u8', 'mp4'].indexOf(getExt(url)) != -1
    }
    self.proxify = (url) => {
        if(typeof(url)=='string' && url.indexOf('//') != -1){
            if(!self.srv){
                return url // srv not ready
            }
            url = self.unproxify(url)
            url = url.replace(new RegExp('^(http://|//)', 'i'), 'http://'+self.addr+':'+self.port+'/').replace(new RegExp('^https://', 'i'), 'http://'+self.addr+':'+self.port+'/s/')
        }
        return url;
    }
    self.unproxify = (url) => {
        if(typeof(url)=='string'){
            if(url.substr(0, 3) == '/s/'){
                url = 'https://' + url.substr(3)
            } else if(url.charAt(0) == '/' && url.charAt(1) != '/'){
                url = 'http://' + url.substr(1)
            } else if(url.indexOf('//') != -1){
                var addrp = self.addr.split('.').slice(0, 3).join('.')
                if(url.indexOf(addrp) != -1){
                    url = url.replace(new RegExp('^(http://|//)'+addrp.replaceAll('.', '\\.')+'\\.[0-9]{0,3}:([0-9]+)/', 'g'), '$1').replace('://s/', 's://')
                }  
            }                      
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
        }
        return url
    }
    self.destroy = () => {
        if(self.debug){
            self.log('closing...')
        }
        self.closed = true;
        if(self.srv){
            self.srv.close()
            self.srv = null;
        }
    }
    addAction('appUnload', () => {
        self.destroy()
    })
    self.init()
    return self
})(Playback)

Playback.proxyLocal = ((parent) => { // http'ize local files from ffmpeg output
    var self = {
        parent,
        debug: false,
        addr: '127.0.0.1',
        folder: dirname(GStore.folder) + path.sep + 'public',
        closed: false,
        srv: false,
        port: 0  // should be equal for peers, so hardcode it
    }
    self.log = (...arguments) => {
        arguments.unshift('[Playback.proxyLocal]')
        console.log.apply(this, arguments)
    }
    self.init = () => {
        self.srv = http.createServer((req, response) => {
            if(self.closed){
                return
            }
            if(self.debug){
                self.log('req starting...', req);
            }
            var file = self.unproxify(req.url.split('#')[0])
            if(self.debug){
                self.log('serving', file)
            }
            fs.exists(file, (exists) => {
                if (!exists) {
                    response.writeHead(404, { 
                        'Content-Type': 'text/plain' 
                    })
                    response.end('404 Not Found\n')
                    return
                }    
                fs.readFile(file, 'binary', function(err, buffer) {
                    if (err) {
                        response.writeHead(500, { 
                            'Content-Type': 'text/plain' 
                        })
                        response.end(err + '\n')
                        return
                    }    
                    doAction('media-save', file, buffer, 'content')
                    response.writeHead(200)
                    response.write(buffer, 'binary')
                    response.end()
                })
            })

            
        }).listen(self.port)
    }
    self.proxify = (file) => {
        let p = path.sep + 'public' + path.sep
        if(typeof(file)=='string'){
            if(file.indexOf(p) != -1){
                file = file.split(p)[1]
            }
            if(!self.port){
                if(self.srv && typeof(self.srv.address) == 'function'){
                    self.port = self.srv.address().port
                } else {
                    return file // srv not ready
                }
            }
            file = 'http://127.0.0.1:'+self.port+'/'+file.replaceAll('\\', '/')
        }
        return file
    }
    self.unproxify = (url) => {
        if(typeof(url)=='string'){
            if(url.charAt(0) == '/'){
                url = url.slice(1)
            }
            url = url.replace(new RegExp('^.*:[0-9]+/+'), '')
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
            url = self.folder + path.sep + url
        }
        return url
    }
    self.destroy = () => {
        if(self.debug){
            self.log('closing...')
        }
        self.closed = true
        if(self.srv){
            self.srv.close()
            self.srv = null
        }
    }
    addAction('appUnload', () => {
        self.destroy()
    })
    self.init()
    return self
})(Playback)
