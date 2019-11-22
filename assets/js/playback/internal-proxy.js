
class Proxy extends Events {
	constructor(url, opts){
		super()
		this.url = url
		this.opts = {
			debug: false,
			idleTimeout: 10000,
			initialErrorLimit: 2, // at last 2
			errorLimit: 5,
			sniffingSizeLimit: 128 * 1024, 
			delaySecsLimit: 3,
			minBitrateCheckSize: 2 * (1024 * 1024),
			bitrateCheckingAmount: 3,
			delayLevelIncrement: 0.1,
			ffmpeg: path.resolve('ffmpeg/ffmpeg')
		}
		this.defaults = this.opts
		this.bitrate = false
		this.downloadLogging = {}
		this.clients = []
		this.bitrates = []
		this.port = 0
		this.endpoint = ''
		this.connectable = false
		this.reset()
		if(opts){
			Object.keys(opts).forEach((k) => {
				if(['request', 'debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
					this.on(k, opts[k])
				} else {
					this.opts[k] = opts[k]
				}
			})
		}
		this.mediainfo = new MediaInfo(this.opts)
        this.server = http.createServer((request, client) => {
			if(this.destroyed){
				if(this.server){
					this.server.close()
				}
				return
			}
			this.clients.push(client)
            var closed, writer = new Writer(client), headers = { 
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
				'Transfer-Encoding': 'chunked'
            }
            if(this.opts.debug){
                this.opts.debug('[ts] serving (timeout reset)', this.url)
            }
            this.emit('client-connect', client)
            var code = 200, handler = (buffer) => {
				if(this.destroyed){
					return
				}
				if(writer){
					writer.write(buffer, 'binary')
				}
            }, clean = () => {
				if(writer){
					writer.end()
					writer = false
				}
			}
            client.writeHead(code, headers)
            client.on('close', () => {
				clean()
				if(this.destroyed){
					return
				}
				let i = this.clients.indexOf(client)
				if(i != -1){
					delete this.clients[i]
					this.clients = this.clients.filter((item) => {
						return item !== undefined
					})
				}
				if(!this.clients.length){
					let finish = () => {
						if(this.opts.debug){
							this.opts.debug('[ts] timeout reached')
						}
						this.emit('timeout', this.clients ? this.clients.length : 0)
						this.destroy()
					}
					if(this.opts.idleTimeout){
						if(this.opts.debug){
							this.opts.debug('[ts] timeout start')
						}
						clearTimeout(this.idleTimer)
						this.idleTimer = setTimeout(finish, this.opts.idleTimeout)
					} else {
						finish()
					}
				}
				if(this.opts.debug){
					this.opts.debug('[ts] disconnect', this.clients.length)
				}
				this.emit('client-disconnect', client)
				this.removeListener('destroy', clean)
				this.removeListener('broadcast', handler)				
			})
			if(this.opts.debug){
				this.opts.debug('[ts] new connection', request, client)
			}
			          
			this.on('destroy', clean)
		}).listen(0, "127.0.0.1", (err) => {
			if (err) {
				if(this.opts.debug){
					this.opts.debug("unable to listen on port", err);
				}
			}
			this.port = this.server.address().port
			this.endpoint = 'http://127.0.0.1:'+this.port+'/'+this.endpointName
			this.emit('ready', this.endpoint)
		})
		this.pump()
	}
	getBitrate(){
		if(this.len(this.backBuffer) >= this.opts.minBitrateCheckSize && this.bitrates.length < this.opts.bitrateCheckingAmount && !this.destroyed){
			let i = Math.random(), tmpFile = tmpDir + path.sep + i + '.TS', buffer = Buffer.concat(this.backBuffer)
			fs.writeFile(tmpFile, buffer, (err) => {
				this.mediainfo.bitrate(tmpFile, (err, bitrate, codecData) => {
					if(bitrate){
						this.bitrates.push(bitrate)
						this.bitrate = this.bitrates.reduce((a, b) => a + b, 0) / this.bitrates.length
					}
					if(this.opts.debug){
						this.opts.debug('[ts] analyzing: ' + tmpFile, 'sample len: '+ this.kfmt(this.len(buffer))+'B', 'bitrate: '+ this.kfmt(this.bitrate)+'ps', this.bitrates)
					}
					if(codecData && codecData.video){
						this.emit('codecData', codecData)	
					}
					fs.unlink(tmpFile, () => {})
				})
			})
		}
	}
	speed(){
		let u = this.time(), downloaded = 0, started = 0, maxSampleLen = 10 * (1024 * 1024)
		Object.keys(this.downloadLogging).reverse().forEach((time) => {
			let rtime = Number(time)
			if(typeof(rtime) == 'number' && rtime){
				if(downloaded < maxSampleLen){ // keep
					downloaded += this.downloadLogging[rtime]
					if(!started || rtime < started){
						started = rtime
					}
				} else {
					delete this.downloadLogging[time]
				}
			}			
		})
		let speed = parseInt(downloaded / (u - started))
		if(this.opts.debug){
			this.opts.debug('[ts] download speed:', this.kfmt(speed) + 'Bps' + ((this.bitrate) ? ', required: ' + this.kfmt(this.bitrate) + 'Bps': ''))
		}
		return speed
	}
	time(){
		return ((new Date()).getTime() / 1000)
	}
	kfmt(num, digits) {
		var si = [
			{ value: 1, symbol: "" },
			{ value: 1E3, symbol: "K" },
			{ value: 1E6, symbol: "M" },
			{ value: 1E9, symbol: "G" },
			{ value: 1E12, symbol: "T" },
			{ value: 1E15, symbol: "P" },
			{ value: 1E18, symbol: "E" }
		]
		var i, rx = /\.0+$|(\.[0-9]*[1-9])0+$/
		for (i = si.length - 1; i > 0; i--) {
			if (num >= si[i].value) {
				break
			}
		}
		return (num / si[i].value).toFixed(digits).replace(rx, "$1") + si[i].symbol
	}
	handleData(data, enc, cb){
		if(this.opts.debug){
			// this.opts.debug('[ts] data received', this.destroyed) // , this.destroyed, this.currentRequest, this.intent)
		}
		if(!data){
			return
		}
		if(this.destroyed){
			return
		}
		let skip, len = this.len(data)
		if(!len){
			skip = true
		} else if(len < this.opts.sniffingSizeLimit){
			let bin = this.isBin(data)
			if(!bin){
				skip = true
				this.triggerError('bad data', String(data))
			}
		}
		if(!skip){
			this.errors = 0
			this.connectable = true
			// this.downloadLogging[this.time()] = len // moved to output()
			if(Array.isArray(this.nextBuffer)){
				this.nextBuffer.push(data)
				if(this.len(this.nextBuffer) >= this.opts.needleSize){
					if(this.opts.debug){
						this.opts.debug('[ts] calling join() from handleData')
					}
					this.join()
				}
			} else {
				this.output(data)
			}
		}
		cb()
	}
	isBin(buf){
		let bin, sample = buf.slice(0, 24).toString()
		for (let i = 0; i < sample.length; i++) {
			let chr = sample.charCodeAt(i)
			// if (chr === 65533 || chr <= 8) {
			if (chr > 127 || chr <= 8) { // https://stackoverflow.com/questions/10225399/check-if-a-file-is-binary-or-ascii-with-node-js
				bin = true
				break
			}
		}
		return bin
	}
	join(){
		let done, needle = Buffer.concat(this.nextBuffer), ns = this.len(needle)
		if(ns){
			if(ns >= this.opts.minNeedleSize){
				let start = this.time(), stack = Buffer.concat(this.backBuffer), pos = stack.lastIndexOf(needle)
				if(pos != -1){
					let sl = this.len(stack)
					this.bytesToIgnore = sl - pos
					if(this.opts.debug && this.bytesToIgnore){
						this.opts.debug('[ts] ignoring next ' + this.kfmt(this.bytesToIgnore) + 'B', 'took ' + Math.round(this.time() - start, 1) + 's')
					}
				} else {
					if(this.opts.debug){
						this.opts.debug('[ts] no intersection', 'took ' + Math.round(this.time() - start, 1) + 's')
					}
				}
			} else {
				if(this.opts.debug){
					this.opts.debug('[ts] insufficient needle size, bypassing', this.kfmt(ns) + 'B' + ' < ' + this.kfmt(this.opts.minNeedleSize) + 'B', needle)
				}
			}
			this.output(needle) // release nextBuffer, bytesToIgnore is the key here to joining
			this.nextBuffer = false
			this.getBitrate()
		}
	}
	output(data){
		let len = this.len(data), bLen = 0
		if(this.bytesToIgnore){
			if(len <= this.bytesToIgnore){
				this.bytesToIgnore -= len
				if(this.opts.debug){
					// this.opts.debug('[ts] Discarded chunk with ' + l + ' bytes') 
					this.opts.debug('[ts] discarding') 
				}
				return
			} else {
				data = data.slice(this.bytesToIgnore)
				this.bytesToIgnore = 0
				len -= this.bytesToIgnore
				if(this.opts.debug){
					// this.opts.debug('[ts] Discarded ' + l + ' bytes') 
					this.opts.debug('[ts] discarding') 
				}
			}
		}
		this.downloadLogging[this.time()] = len
		this.emit('broadcast', data)
		this.backBuffer.push(data) // collect backBuffer for future joining calc
		this.backBuffer = this.backBuffer.reverse().filter((b, i) => {
			bLen += this.len(b)
			return bLen < this.opts.backBufferSize
		}).reverse()		
	}
	pump(){
		if(this.opts.debug){
			this.opts.debug('[ts] pump', this.destroyed)
		}
		if(this.destroyed){
			return
		}
		let ctype = '', statusCode = 0, headers = {}, h = new this.hermes()
		let next = () => {
			next = null
			if(this.opts.debug){
				this.opts.debug('[ts] host closed', Array.isArray(this.nextBuffer))
			}
			if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
				this.currentRequest.abort()
			}
			h.end()
			if(this.destroyed){
				return
			}
			if(Array.isArray(this.nextBuffer)){ // we've not joined the recent connection data yet, insufficient needle size
				if(this.opts.debug){
					this.opts.debug('[ts] calling join() from pump after connection close')
				}
				this.join() // join prematurely to be ready for next connection anyway
			}
			this.bytesToIgnore = 0 // bytesToIgnore should be discarded here, as we're starting a new connection which will return data in different offset
			this.nextBuffer = []
			this.currentRequest = h = null
			let speed = this.speed()
			/* break leaking here by avoiding nested call to next pump */
			if([400, 401, 403].indexOf(statusCode) == -1 && (!this.bitrate || speed < this.bitrate)){
				this.delayLevel = 0
				process.nextTick(this.pump.bind(this))
			} else {
				if(this.delayLevel < this.opts.delaySecsLimit){
					this.delayLevel += this.opts.delayLevelIncrement
				}
				setTimeout(this.pump.bind(this), this.opts.delaySecsLimit * 1000)
				if(this.opts.debug){
					this.opts.debug('[ts] delaying ' + this.delayLevel + ' seconds', statusCode == 200, ctype.indexOf('text') == -1, (!this.bitrate || speed < this.bitrate))
				}
			}
		}
		this.currentRequest = this.opts.request({
			method: 'GET', 
			uri: this.url, 
			ttl: 0
		})
		this.currentRequest.on('error', (err) => {
			if(this.destroyed){
				return
			}
			if(!this.triggerError('timeout ' + JSON.stringify(err))){
				next()
			}
		})
		this.currentRequest.on('response', (response) => {
			if(this.destroyed){
				return
			}
            if(this.opts.debug){
				if(this.opts.debug){
					this.opts.debug('[ts] headers received', response.statusCode) // 200
				}
			}
			statusCode = response.statusCode
			headers = response.headers
			ctype = typeof(headers['content-type']) != 'undefined' ? headers['content-type'] : ''
			if((!statusCode || statusCode >= 400) || ctype.indexOf('text') != -1){
				this.triggerError('bad response', ctype, this.errors, statusCode, headers)
				if(!this.destroyed){ // recheck after triggerError
					if(ctype.indexOf('text') != -1){
						let errorpage = []
						this.currentRequest.on('data', chunk => {
							errorpage.push(chunk)
						})
						this.currentRequest.on('end', () => {
							if(this.opts.debug){
								this.opts.debug('[ts] errorpage', Buffer.concat(errorpage).toString())
							}
						})
					}
				}
			} else {
				if(this.currentRequest){
					this.currentRequest.pipe(h)
				}
			}
		})
		this.currentRequest.on('end', () => {
			next()
		})
	}
	len(data){
		if(!data){
			return 0
		} else if(Array.isArray(data)) {
			let len = 0
			data.forEach(d => {
				len += this.len(d)
			})
			return len
		} else if(typeof(data.byteLength) != 'undefined') {
			return data.byteLength
		} else {
			return data.length
		}
	}
	endRequest(){
		if(this.currentRequest){
			try {
				this.currentRequest.abort()
			} catch(e) {
				if(this.opts.debug){
					this.opts.debug('endRequest error', e)	
				}
				this.currentRequest.end()
			}
		}
	}
	reset(){
		if(this.currentRequest && typeof(this.currentRequest.abort) == 'function'){
			this.currentRequest.abort()
			this.currentRequest = false
		}
		if(this.idleTimer){
			clearTimeout(this.idleTimer)
			this.idleTimer = 0
		}
		this.errors = 0
		this.bytesToIgnore = 0
		this.delayLevel = 0
	}
	triggerError(...args){
		this.errors++
		if(this.opts.debug){
			this.opts.debug('[ts] error', this.errors, args)
		}
		if(this.errors >= (this.connectable ? this.opts.errorLimit : this.opts.initialErrorLimit)){
			if(this.opts.debug){
				this.opts.debug('[ts] error limit reached', this.errors, this.opts.errorLimit)
			}
			this.destroy()
			return true
		}
	}
	destroy(){
		if(this.opts.debug){
			this.opts.debug('[ts] destroy')
		}
		this.endRequest()
		if(!this.destroyed){
			if(this.opts.debug){
				this.opts.debug('[ts] destroying...', this.currentRequest)
			}
			this.destroyed = true
			this.emit('destroy')
			this.server.close()
			Object.keys(this).forEach(k => {
				if(k != 'opts' && typeof(this[k]) == 'object'){
					this[k] = null
				}
			})
			this.emit = () => {}
		}
	}	
}


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
    self.isFragment = (url) => {
        return ['m2ts', 'ts', 'm4s', 'm4v', 'm4a', 'aac'].indexOf(getExt(url)) != -1
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
                if(self.debug){
                    self.log('serving', domain, port)            
                }
                let allowP2P = self.parent.active && self.parent.active.type == 'hls' && !self.parent.query({started: false, ended: false, error: false}).length && Config.get('p2p') && !Tuning.active()
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
                } else if(self.isFragment(url) && allowP2P) { // only ts uses hybridSegmentFetch
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
                                self.log('responding', 'error 502', err)
                            }
                            response.end()
                        } else {
                            buffer = bufferize(buffer)
                            if(self.debug){
                                self.log('responding', buffer.byteLength, location)
                            }
                            if(location){
                                response.writeHead(307, {
                                    "Access-Control-Allow-Origin": "*",
                                    "Location": location
                                })
                            } else {
                                response.writeHead(200, {
                                    "Access-Control-Allow-Origin": "*",
                                    "Content-Type": type
                                    //, "Content-Length": Buffer.byteLength(buffer, 'binary')
                                })
                            }
                            response.end(buffer, 'binary')
                        }
                        if(self.debug){
                            self.log('fine.')
                        }
                        // buffer = null
                    })
                } else if(ext == 'm3u8') {
                    var retries = 3, headers = req.headers, finalUrl = url
                    headers.host = domain
                    if(self.debug){
                        self.log('open', url, req, ext)
                    }
                    req.url = url
                    if(typeof(headers['accept-encoding']) != 'undefined'){
                        delete headers['accept-encoding']
                    }
                    var go = () => {
                        self.request({
                            url: url,
                            headers: req.headers,
                            followRedirect: false,
                            ttl: 2000
                        }, (error, res, body) => {
                            let hs, code, delay = 100
                            if(retries && res && [502, 401, 403].indexOf(res.statusCode) != -1){
                                retries--
                                console.warn('Connection error, delaying ', req.headers, res ? res.statusCode : -1, retries)
                                if(res.statusCode == 403){
                                    delay = 5000
                                    req.headers['connection'] = 'close'
                                }
                                return setTimeout(go, delay)
                            }
                            if(retries && res && res.headers){
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
                                checkStreamTypeByContent(body, t => {
                                    if(t == 'stream' && allowP2P){
                                        body = self.parent.HLSManager.process(body, finalUrl)
                                    }
                                })
                                //hs['content-length'] = body.length
                                delete hs['content-length']
                                code = res.statusCode
                            } else {
                                console.error('Connection error, gaving up ', error)
                                hs = {}
                                body = ''
                                hs['content-length'] = 0
                                code = res && res.statusCode ? res.statusCode : 0
                            }
                            if(code){
                                response.writeHead(code, hs)
                                response.end(body, {end: true})
                            } else {
                                response.connection.destroy()
                            }
                        })      
                    }
                    go()
                } else { // piped direct response for non "ts segments"
                    var headers = req.headers, finalUrl = url
                    headers.host = domain
                    if(self.debug){
                        self.log('open', url, req, ext)
                    }
                    req.url = url
                    var err, sent, r = self.request({
                        url: url,
                        headers: req.headers,
                        followRedirect: false,
                        ttl: 10000
                    })
                    req.pipe(r)
                    req.connection.on('close', () => {
                        r.abort()
                        response.end()
                    })
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
                            self.log('close', r, req, response, url)
                        }
                        if(err && !sent){
                            response.writeHead(500)
                        }
                        response.end()
                    })      
                    r.pipe(response)
                }
            }).listen(self.port, self.addr)
        }
    }
    self.init = () => {
        self.started = true;
        self.listen()
        self.request = requestForever
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
        debug: true,
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
                    self.log('serving', url)
                }
                let saving = []
                let domain = getDomain(url)
                let port = url.match(new RegExp(':([0-9]+)'))
                port = port ? parseInt(port[1]) : 80   
                var headers = req.headers
                headers.host = domain
                if(self.debug){
                    self.log('open', url, req)
                }
                req.url = url;
                var err, hasErr, r = self.request({
                    url: url,
                    ttl: 10000,
                    headers: req.headers,
                    followRedirect: true // last resort, follow redirects hee
                })
                req.pipe(r)
                req.connection.on('close', () => {
                    r.abort()
                    response.end()
                })
                if(isTS(url)){
                    r.on("data", chunk => {
                        saving.push(chunk)
                    })
                }
                r.on("response", res => {
                    hasErr = false
                    if(self.debug){
                        self.log('response', res)
                    }
                    if(typeof(res.headers['content-length']) != 'undefined'){
                        delete res.headers['content-length']
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
                    if(saving.length){
                        doAction('media-save', url, Buffer.concat(saving), 'content')
                    }
                })      
                r.pipe(response)
            }).listen(self.port, self.addr)
        }
    }
    self.init = () => {
        self.started = true;
        self.listen()
        self.request = requestForever
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
                response.writeHead(200)
                fs.createReadStream(file).pipe(response)          
                if(isTS(req.url)){
                    doAction('media-save', req.url, file, 'path')
                }
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
            url = path.resolve(self.folder + path.sep + url)
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
