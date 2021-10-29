const http = require('http'), closed = require(global.APPDIR +'/modules/on-closed')
const StreamerProxyBase = require('./proxy-base'), decodeEntities = require('decode-entities')
const fs = require('fs'), async = require('async'), Events = require('events'), m3u8Parser = require('m3u8-parser')
const MPEGTSPacketProcessor = require('./ts-packet-processor.js')

class HLSJournal {
	constructor(url){
		this.url = url
		this.header = ''
		this.journal = {}
		this.maxLen = Math.ceil(global.config.get('live-window-time') / 3)
		this.sortByName = true
	}
	process(content){
		if(content){
			let header = [], segments = {}, extinf
			content.split("\n").filter(s => s.length >= 7).forEach(line => {
				let isExtinf = line.substr(0, 7) == '#EXTINF'
				if(isExtinf){
					extinf = line
				} else if(extinf) {
					if(line.charAt(0) == '#'){
						extinf += "\r\n"+ line
					} else {
						let name = this.segmentName(line)
						segments[name] = extinf +"\r\n"+ line
					}
				} else {
					header.push(line)
				}
			})
			this.header = header.join("\r\n")
			let ks = Object.keys(segments)
			ks.forEach(url => {
				if(typeof(this.journal[url]) == 'undefined' || this.journal[url] != segments[url]){
					this.journal[url] = segments[url]
				}
			})
			if(this.sortByName && !this.isSorted(ks)){
				this.sortByName = false
			}
			if(this.sortByName){
				this.sort()
			}
		}
		return this.header +"\r\n"+ Object.values(this.journal).join("\r\n") +"\r\n"
	}
	segmentName(url){
		let match = url.match(new RegExp('[^=/]+\\.ts'))
		if(match){
			return match[0]
		}
		return url
	}
	isSorted(arr){
		return arr.slice(1).every((item, i) => arr[i] <= item)
	}
	sort(){
		let nj = {}, ks = Object.keys(this.journal)
		ks.sort().slice(this.maxLen * -1).forEach(k => {
			nj[k] = this.journal[k]
		})
		this.journal = nj
	}
}

class HLSRequestClient extends Events {
	constructor(){
		super()
		this.uid = parseInt(Math.random() * 100000000)
	}
	start(){}
	respond(status, headers){
		if(!this.responded){
			if(!headers){
				headers = {'content-length': 0, 'connection': 'keep-alive'}
			}
			this.emit('response', status, headers)
			this.responded = true
		}
	}
	end(){
		if(!this.ended){
			this.respond(500) // just to be sure
			this.emit('end')
			this.ended = true
		}
	}
	fail(status, headers){
		this.respond(status, headers)
		this.end()
	}
	destroy(){}
}

class HLSRequests extends StreamerProxyBase {
	constructor(opts){
		super(opts)
		this.debugUnfinishedRequests = false
		this.packetFilterPolicy = 1
		this.keepInitialData = true
		this.keepLeftOverData = true
		this.requestCacheUID = parseInt(Math.random() * 1000000)
		this.requestCacheDir = global.paths.temp +'/streamer/'+ this.requestCacheUID +'/'
		this.requestCacheMap = {}
		this.mediaTypeCacheTTLs = {meta: 3, video: 60, '': 60}
		fs.mkdir(this.requestCacheDir, {recursive: true}, () => {})
		this.activeRequests = {}
		this.on('destroy', () => {
			Object.keys(this.activeRequests).forEach(url => {
				if(this.activeRequests[url].request){
					this.activeRequests[url].request.destroy()
				}
				delete this.activeRequests[url]
			})
			Object.keys(this.requestCacheMap).forEach(url => {
				this.requestCacheMap[url].clients.forEach(client => client.end())
				delete this.activeRequests[url]
			})
			global.rmdir(this.requestCacheDir, true)
		})
		this.maxDiskUsage = 200 * (1024 * 1024)
		global.diagnostics.checkDisk().then(data => {
			const toUse = data.free * 0.2
			if(toUse < this.maxDiskUsage){
				global.diagnostics.checkDiskUI(true).catch(console.error)
			}
			this.maxDiskUsage = toUse
		}).catch(console.error)
	}
    url2file(url){
        return global.sanitize(url)
    }
	bindRequestCacheSaver(request, status, headers, cb){
		const url = request.opts.url
		async.parallel([
			done => {
				fs.writeFile(this.requestCacheDir + this.requestCacheMap[url].headersFile, JSON.stringify({status, headers}), {}, done)
			},
			done => {
				const stream = fs.createWriteStream(this.requestCacheDir + this.requestCacheMap[url].file, {flags: 'w'})  
				const mediaType = this.getMediaType(headers, request.currentURL)
				let hasErr, bytesWritten = 0
				stream.on('error', err => {
					console.error('request stream error', err)
				}) 
				if(mediaType == 'video'){
					const processor = new MPEGTSPacketProcessor()
					processor.debug = false
					processor.packetFilterPolicy = this.packetFilterPolicy
					processor.keepInitialData = this.keepInitialData
					processor.keepLeftOverData = this.keepLeftOverData
					request.on('data', chunk => {
						processor.push(chunk)
					})
					request.once('end', () => {
						processor.flush(true)
						processor.destroy()
						stream.end()
					})
					processor.on('data', chunk => {
						if(global.isWritable(stream)){
							bytesWritten += chunk.length
							stream.write(chunk)
						} else {
							hasErr = true
						}
					})
				} else {
					request.on('data', chunk => {
						if(global.isWritable(stream)){
							bytesWritten += chunk.length
							stream.write(chunk)
						} else {
							hasErr = true
						}
					})
					request.once('end', () => stream.end())
				}
				stream.once('finish', () => {
					if(request.contentLength && request.contentLength > request.received){
						hasErr = true
						console.error('incomplete download request '+ request.received +' < '+ request.contentLength, request, headers)
					}
					if(hasErr){
						fs.unlink(this.requestCacheDir + this.requestCacheMap[url].file, done)
					} else {
						let ttl = this.mediaTypeCacheTTLs['meta'] // mininal ttl, safer
						let mediaType = this.getMediaType(headers, request.currentURL)
						if(typeof(this.mediaTypeCacheTTLs[mediaType]) == 'number'){
							ttl = this.mediaTypeCacheTTLs[mediaType]
						}
						this.requestCacheMap[url].ttl = global.time() + ttl
						this.requestCacheMap[url].cacheSize = bytesWritten
						this.clean()
						done()
					}
				})
			}
		], cb)
	}
	validateRequestCache(url, allowExpired, cb){
		if(typeof(this.requestCacheMap[url]) != 'undefined'){
			const size = this.requestCacheMap[url].cacheSize
			const file = this.requestCacheDir + this.requestCacheMap[url].file
			if(size){
				if(allowExpired || this.requestCacheMap[url].ttl >= global.time()){
					return fs.stat(file, (err, stat) => {
						cb(stat && stat.size == size)
					})
				}
			}
		}
		cb(false)
	}
	requestFailed(url, status, headers){
		const next = () => {
			if(this.activeRequests[url]){
				delete this.activeRequests[url]
			}
		}
		if(this.requestCacheMap[url]){
			const size = this.requestCacheMap[url].cacheSize
			const file = this.requestCacheDir + this.requestCacheMap[url].file
			const sendFailure = () => {
				headers['content-length'] = 0
				this.requestCacheMap[url].clients.forEach(client => client.fail(status, headers))
				delete this.requestCacheMap[url]
				next()
			}
			fs.stat(file, (err, stat) => {
				const hasValidCache = stat && size && size == stat.size
				if(hasValidCache){
					this.requestCacheMap[url].ttl = global.time() + 1
					this.sendRequestCache(url)
					next()
				} else {
					console.error('request cache invalidated', err, size, stat)
					if(err){
						sendFailure()
					} else {
						fs.unlink(file, sendFailure)
					}
				}
			})
		} else {
			next()
		}
	}
	validateResponseStatus(status){
		return status >= 200 && status < 400
	}
	download(opts){
		const now = global.time(), client = new HLSRequestClient(), url = opts.url, ext = this.ext(url)
		const sendCacheWhenReady = () => {
			if(!this.requestCacheMap[url].clients.some(c => c.uid == client.uid)){
				this.requestCacheMap[url].clients.push(client)
			}
			client.request = this.requestCacheMap[url].request
			if(!this.activeRequests[url]){
				process.nextTick(() => this.sendRequestCache(url))
			}
		}
		client.destroy = () => this.removeClient(url, client)
		if(this.activeRequests[url]){
			sendCacheWhenReady()
		} else {
			this.validateRequestCache(url, ext == 'ts', valid => {
				if(valid) return sendCacheWhenReady()
				const file = this.url2file(url)
				const request = new global.Download(opts)
				if(typeof(this.requestCacheMap[url]) == 'undefined'){
					this.requestCacheMap[url] = {
						file,
						headersFile: file +'.headers',
						clients: []
					}
				}
				this.requestCacheMap[url] = Object.assign(this.requestCacheMap[url], {
					ttl: now,
					request,
					isReceiving: false,
					responseStarted: false
				})
				this.activeRequests[url] = request
				if(this.debugUnfinishedRequests) global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
				this.requestCacheMap[url].clients.push(client)
				let timer = 0, ended, ttl = 60, end = () => {
					if(!ended){
						ended = true
						if(this.requestCacheMap[url] && !this.requestCacheMap[url].responseStarted){
							console.error('!!! Request finished/destroyed before response')
							let headers = {'content-length': 0}
							this.requestCacheMap[url].clients.forEach(client => client.fail(504, headers))
							delete this.requestCacheMap[url]
						}
						if(this.activeRequests[url]){
							delete this.activeRequests[url]
						}
					}
				}
				request.once('response', (status, headers) => {
					this.requestCacheMap[url].responseStarted = true
					if(timer){
						clearTimeout(timer)
					}
					if(this.validateResponseStatus(status)) {
						this.requestCacheMap[url].isReceiving = true							
						this.bindRequestCacheSaver(request, status, headers, () => {
							this.requestCacheMap[url].isReceiving = false
							if(this.debugUnfinishedRequests) global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
							this.sendRequestCache(url)
							delete this.activeRequests[url]
							//let doWarn = request.retryCount || request.authErrors || request.received < request.contentLength || request.received < request.totalContentLength
							//console[doWarn?'warn':'log']('Request finished', request.opts.url.split('/').pop(), request.getTimeoutOptions(), request.retryCount, request.authErrors, request.received, request.contentLength, request.totalContentLength, request)
						})
					} else {
						console.error('Request error', status, headers)
						if(this.debugUnfinishedRequests) global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
						if(this.debugUnfinishedRequests) global.osd.show('error '+ url.split('/').pop().split('?')[0] +' - '+ status, 'fas fa-info-circle', 'hlsr', 'long')
						this.requestFailed(url, status, headers)
						request.destroy()
					}
				})
				request.on('error', err => {
					// console.error('request error', err)
					client.emit('request-error', err)
				})
				request.once('end', end)
				request.once('destroy', end)
				client.request = request
				client.start = () => request.start()
				timer = setTimeout(() => {
					const shouldContinue = () => {
						return !ended && this.requestCacheMap[url] && !this.requestCacheMap[url].responseStarted
					}
					if(!shouldContinue()) return
					this.validateRequestCache(url, true, valid => {
						if(!shouldContinue()) return
						if(valid){
							request.destroy()
							delete this.activeRequests[url]
							if(this.debugUnfinishedRequests) global.osd.show('cached '+ url.split('/').pop().split('?')[0], 'fas fa-info-circle', 'hlsr', 'long')
							console.error('Request timeouted, send cached data')
							this.sendRequestCache(url)
						} else {
							const keepRequest = () => {
								console.error('Request timeouted, is live segment, keeping request')
								if(this.debugUnfinishedRequests) global.osd.show('live, not cached '+ url.split('/').pop().split('?')[0], 'fas fa-info-circle', 'hlsr', 'long')
							}
							if(ext == 'm3u8'){
								keepRequest()
							} else {
								this.isSegmentInCurrentWindow(url, i => {
									if(!shouldContinue()) return
									console.error('SEGMENT OFFSET=', i, url)
									if(typeof(i) == 'number'){
										keepRequest()
									} else {
										if(this.debugUnfinishedRequests) global.osd.show('discard, not cached '+ url.split('/').pop().split('?')[0], 'fas fa-info-circle', 'hlsr', 'long')
										console.error('Request timeouted, no fallback cache, send 404')
										if(typeof(this.requestCacheMap[url]) != 'undefined'){
											this.requestCacheMap[url].clients.forEach(client => {
												client.fail(404)
											})
											delete this.requestCacheMap[url]
										}
										request.destroy()
										delete this.activeRequests[url]
									}
								})
							}
						}
					})
				}, 8000)
			})
		}
		return client
	}
	removeClient(url, client){
		client.end()
		client.removeAllListeners()
		this.requestCacheMap[url].clients = this.requestCacheMap[url].clients.filter(c => c.uid != client.uid)
		if(!this.requestCacheMap[url].clients.length && !this.requestCacheMap[url].isReceiving){
			this.requestCacheMap[url].request.destroy()
			if(this.activeRequests[url]){
				delete this.activeRequests[url]
			}
		}
	}
	isSegmentInCurrentWindow(url, cb){
		let found, segmentBasename = url.split('/').pop()
		async.eachOfLimit(Object.keys(this.requestCacheMap), 4, (playListUrl, i, done) => {
			if(typeof(found) == 'number'){
				return done()
			}
			const file = this.requestCacheDir + this.requestCacheMap[playListUrl].file
			this.getPlaylistSegmentOffset(file, segmentBasename, pos => {
				if(pos != -1){
					found = pos
				}
				done()
			})
		}, () => {
			cb(found)
		})
	}
	getPlaylistFileSegments(file, ifContains, filesizeLimit, callback){
		fs.stat(file, (err, stat) => {
			if(err || stat.size > filesizeLimit){
				callback([])
			} else {
				fs.readFile(file, (err, data) => {
					if(!err){
						data = String(data)
						if(data.indexOf(ifContains) != -1){
							const segments = data.split("\n").filter(line => {
								return line.length > 4 && line.charAt(0) != '#'
							})
							return callback(segments)
						}
					}
					callback([])
				})
			}
		})
	}
	getPlaylistSegmentOffset(file, segmentBasename, callback){
		const maxPlayListSize = 56 * 1024
		this.getPlaylistFileSegments(file, segmentBasename, maxPlayListSize, segments => {
			let pos = -1
			segments.some((segment, i) => {
				if(segment.indexOf(segmentBasename) != -1){
					pos = segments.length - 1 - i
					return true
				}
			})
			console.error('SEGMENTS', segments, segmentBasename, pos)
			callback(pos)
		})
	}
	sendRequestCache(url){
		if(this.requestCacheMap[url].clients.length){
			fs.readFile(this.requestCacheDir + this.requestCacheMap[url].headersFile, (err, content) => {
				const clients = this.requestCacheMap[url].clients
				this.requestCacheMap[url].clients = []
				//console.log('Parsing headers JSON', err, String(content))
				if(!err && content){
					let data
					try {
						data = JSON.parse(String(content))
					} catch(e) {
						console.error(e)
					}
					if(data && data.headers){
						clients.forEach(client => client.emit('response', data.status, data.headers))				
						let dataSent = 0
						const stream = fs.createReadStream(this.requestCacheDir + this.requestCacheMap[url].file)
						stream.on('error', err => {
							console.error('stream error', err)
						})
						stream.on('data', chunk => {
							dataSent += chunk.length
							clients.forEach(client => client.emit('data', chunk))
						})
						stream.on('end', () => {
							clients.forEach(client => client.end())
							//console.log('sent file', url, dataSent)
							if(this.requestCacheMap[url].clients.length) this.sendRequestCache(url) // if a new client joined too late to the party, make it happen again!
						})
					} else {
						console.error('Parsing headers error*', String(content))
						clients.forEach(client => client.fail(500, {}))
					}
				} else {
					console.error('Parsing headers error', err, content)
					clients.forEach(client => client.fail(500, {}))
				}
			})
		}
	}
	diskSpaceUsed(){
		let size = 0
		Object.keys(this.requestCacheMap).forEach(url => {
			if(this.requestCacheMap[url].cacheSize){
				size += this.requestCacheMap[url].cacheSize
			}
		})
		return size
	}
	clean(){
		let used = this.diskSpaceUsed()
		if(used >= this.maxDiskUsage){
			let index = [], count = 0, freed = 0, freeup = this.maxDiskUsage - used
			Object.keys(this.requestCacheMap).forEach(url => {
				index.push([url, this.requestCacheMap[url].cacheSize, this.requestCacheMap[url].ttl])
			})
			index.sortByProp('ttl').some(e => {
				let url = e[0]
				if(!this.requestCacheMap[url].clients.length && !this.requestCacheMap[url].isReceiving){
					count++
					if(typeof(e[1]) == 'number'){
						freed += e[1]
					}
					let files = [
						this.requestCacheDir + this.requestCacheMap[url].headersFile,
						this.requestCacheDir + this.requestCacheMap[url].file
					]
					async.eachOf(files, (file, i, done) => {
						fs.unlink(file, done)
					}, () => {
						delete this.requestCacheMap[url]
					})
				}
				return freed >= freeup
			})
			console.warn('Request cache trimmed from '+ global.kbfmt(used) +' to '+ global.kbfmt(used - freed), freed, count)
		}
	}
}

class StreamerProxyHLS extends HLSRequests {
	constructor(opts){
		super(opts)
		this.opts.port = 0
		this.type = 'proxy'
		this.networkOnly = false
		this.journals = {}
		this.opts.followRedirect = true // some servers require m3u8 to requested by original url, otherwise will trigger 406 status, while the player may call directly the "location" header url on next requests ¬¬
		this.opts.forceExtraHeaders = null
		if(this.opts.debug){
			this.opts.debug('OPTS', this.opts)
		}
		this.on('destroy', () => {
			if(this.server){
				this.server.close()
			}
		})
		this.playlists = {} // fallback mirrors for when one playlist of these returns 404, it happens, strangely...
		this.playlistBitrates = {}
		this.playlistBitratesSaved = {}
	}
    proxify(url){
        if(typeof(url) == 'string' && url.indexOf('//') != -1){
            if(!this.opts.port){
				console.error('proxify() before server is ready', url, global.traceback())
                return url // srv not ready
            }
			url = this.unproxify(url)
			if(url.substr(0, 7) == 'http://') {
				url = 'http://'+ this.opts.addr +':'+this.opts.port+'/'+ url.substr(7)
			} else if(url.substr(0, 8) == 'https://') {
				url = 'http://'+ this.opts.addr +':'+ this.opts.port +'/s/'+ url.substr(8)
			}
        }
        return url
    }
    unproxify(url){
        if(typeof(url) == 'string'){
            if(url.substr(0, 3) == '/s/'){
                url = 'https://' + url.substr(3)
            } else if(url.charAt(0) == '/' && url.charAt(1) != '/'){
                url = 'http://' + url.substr(1)
            } else if(this.opts.addr && url.indexOf('//') != -1){
				if(!this.addrp){
					this.addrp = this.opts.addr.split('.').slice(0, 3).join('.')
				}
                if(url.indexOf(this.addrp) != -1){
					url = url.replace(new RegExp('^(http://|//)'+ this.addrp.replaceAll('.', '\\.') +'\\.[0-9]{0,3}:([0-9]+)/', 'g'), '$1')
					url = url.replace('://s/', 's://')
                }  
            }                      
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
        }
        return url
	}
	proxifyM3U8(body, baseUrl, url, cb){
		body = body.replace(new RegExp('^ +', 'gm'), '')
		body = body.replace(new RegExp(' +$', 'gm'), '')
		let parser = new m3u8Parser.Parser(), replaces = {}, u
		parser.push(body)
		parser.end()
		//console.log('M3U8 PARSED', baseUrl, url, parser)
		if(parser.manifest){
			if(parser.manifest.segments && parser.manifest.segments.length){
				parser.manifest.segments.map(segment => {
					segment.uri = segment.uri.trim()
					let dn = this.getURLRoot(segment.uri)
					if(typeof(replaces[dn]) == 'undefined'){
						let df = segment.uri.length - dn.length
						if(this.opts.debug){
							this.opts.debug('dn', dn, df, segment.uri)
						}
						u = this.absolutize(segment.uri, url)
						let n = this.proxify(u)
						replaces[dn] = n.substr(0, n.length - df)
						if(this.opts.debug){
							this.opts.debug('replace', dn, replaces[dn], df, n)
						}
						body = this.applyM3U8Replace(body, dn, replaces[dn])
						if(this.opts.debug){
							this.opts.debug('ok')
						}
					}
				})
				if(typeof(this.journals[baseUrl]) == 'undefined'){
					this.journals[baseUrl] = new HLSJournal(baseUrl)
				}
				body = this.journals[baseUrl].process(body)
			}
			if(parser.manifest.playlists && parser.manifest.playlists.length){
				if(typeof(this.playlists[url]) == 'undefined'){
					this.playlists[url] = {}
				}
				parser.manifest.playlists.forEach(playlist => {
					let dn = this.dirname(url)
					if(typeof(replaces[dn]) == 'undefined'){
						if(this.opts.debug){
							this.opts.debug('dn', dn)
						}
						u = this.absolutize(playlist.uri, url)
						if(!Object.keys(this.playlists[url]).includes(u)){
							this.playlists[url][u] = true // true here means "online"
						}
						replaces[dn] = this.dirname(this.proxify(u))
						if(this.opts.debug){
							this.opts.debug('replace', dn, replaces[dn])
						}
						body = this.applyM3U8Replace(body, dn, replaces[dn])
						if(this.opts.debug){
							this.opts.debug('ok')
						}
						if(playlist.attributes){
							if(playlist.attributes['AVERAGE-BANDWIDTH'] && parseInt(playlist.attributes['AVERAGE-BANDWIDTH']) > 128){
								this.playlistBitrates[u] = parseInt(playlist.attributes['AVERAGE-BANDWIDTH'])
							} else if(playlist.attributes['BANDWIDTH'] && parseInt(playlist.attributes['BANDWIDTH']) > 128){
								this.playlistBitrates[u] = parseInt(playlist.attributes['BANDWIDTH'])
							}
						}
					}
				})
			}
			//console.warn('PRXBODY', body, parser.manifest, replaces)
		}
		cb(body)
	}
	applyM3U8Replace(body, from, to){
		let lines = body.split("\n")
		lines.forEach((line, i) => {
			if(line.length < 3 || line.charAt(0) == '#'){
				return
			}
			if(line.indexOf('/') == -1 || line.substr(0, 2) == './' || line.substr(0, 3) == '../'){
				// keep it relative, no problem in these cases
				/*
				if(from == ''){
					lines[i] = to + line
				}
				*/
			} else {
				if(line.substr(0, from.length) == from){
					lines[i] = to + line.substr(from.length)
				}
			}
		})
		return lines.join("\n")
	}
	start(){
		return new Promise((resolve, reject) => {
			this.server = http.createServer(this.handleRequest.bind(this)).listen(0, this.opts.addr, (err) => {
				if (err) {
					if(this.opts.debug){
						this.opts.debug('unable to listen on port', err)
					}
					this.fail()
					reject(err)
					return
				}
				this.connectable = true
				this.opts.port = this.server.address().port
				resolve(true)
			})
		})
	}
	setNetworkOnly(enable){
		this.networkOnly = enable
	}
	handleRequest(req, response){
		if(this.destroyed || req.url.indexOf('favicon.ico') != -1){
			response.writeHead(404, {
				'Access-Control-Allow-Origin': '*'
			})
			return response.end()
		}
		if(this.networkOnly){
			if(this.type != 'network-proxy'){
				if(!req.headers['x-from-network-proxy'] && !req.rawHeaders.includes('x-from-network-proxy')){
					console.warn('networkOnly block', this.type, req.rawHeaders)
					response.writeHead(504, {
						'Access-Control-Allow-Origin': '*'
					})
					return response.end()
				}
			}
		}
		// console.log('req starting...', req, req.url)
		let ended, url = this.unproxify(req.url)
		
		let reqHeaders = req.headers
		reqHeaders['accept-encoding'] =  'identity' // not needed and problematic
		reqHeaders = this.removeHeaders(reqHeaders, ['cookie', 'referer', 'origin', 'range'])
		if(this.type == 'network-proxy'){
			reqHeaders['x-from-network-proxy'] = '1'
		} else {
			if(reqHeaders['x-from-network-proxy']){
				delete reqHeaders['x-from-network-proxy']
			}
		}

		if(this.debug){
			console.log('serving', url, req, url, reqHeaders)
		}
		if(this.type == 'network-proxy'){
			console.log('network serving', url, reqHeaders)
		}
		const keepalive = this.committed && global.config.get('use-keepalive')
		const download = this.download({
			url,
			retries: 5,
			debug: false,
			headers: reqHeaders,
			authURL: this.opts.authURL || false, 
			keepalive,
			followRedirect: this.opts.followRedirect
		})
		const end = data => {
			if(!ended){
				ended = true
			}
			if(data && global.isWritable(response)){
				response.write(data)
			}
			response.end()
			if(this.opts.debug){
				this.opts.debug('ended', traceback())
			}
		}
		closed(req, response, () => {
			if(!ended){ // req disconnected
				if(this.opts.debug){
					this.opts.debug('response closed or request aborted', ended, response.ended)
				}
				download.destroy()
				response.end()
				end()
			}
		})
		download.on('request-error', err => {
			if(this.type == 'network-proxy'){
				console.log('serving', url, err)
			}
			if(this.committed){
				global.osd.show(global.streamer.humanizeFailureMessage(err.response ? err.response.statusCode : 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
				console.error('download err', err)
				if(this.debug){
					console.log('download err', err)
				}
			}
		})
		download.once('response', (statusCode, headers) => {
			headers = this.removeHeaders(headers, [
				'transfer-encoding', 
				'content-encoding', 
				'keep-alive',
				'strict-transport-security',
				'content-security-policy',
				'x-xss-protection',
				'cross-origin-resource-policy'
			])
			headers['access-control-allow-origin'] = '*'
			if(this.opts.forceExtraHeaders){
				headers = Object.assign(headers, this.opts.forceExtraHeaders)
			}
			if(this.debug){
				console.log('download response', statusCode, headers)
			}
			/* disable content ranging, as we are rewriting meta and video */
			headers = this.removeHeaders(headers, ['content-range', 'accept-ranges'])
			if(keepalive){
				headers['connection'] = 'keep-alive' // force keep-alive to reduce cpu usage, even on local connections, is it meaningful? I don't remember why I commented below that it would be broken :/
			} else {
				headers['connection'] = 'close' // always force connection close on local servers, keepalive will be broken
			}
			if(!statusCode || [-1, 0, 401, 403].includes(statusCode)){
				/* avoid to passthrough 403 errors to the client as some streams may return it esporadically */
				return end()					
			}
			if(statusCode >= 200 && statusCode < 300){ // is data response
				if(!headers['content-disposition'] || headers['content-disposition'].indexOf('attachment') == -1 || headers['content-disposition'].indexOf('filename=') == -1){
					// setting filename to allow future file download feature
					// will use sanitize to prevent net::ERR_RESPONSE_HEADERS_MULTIPLE_CONTENT_DISPOSITION on bad filename
					headers['content-disposition'] = 'attachment; filename="' + global.filenameFromURL(url) + '"'
				}
				if(statusCode == 206){
					statusCode = 200
				}
				if(req.method == 'HEAD'){
					if(this.debug){
						console.log('download sent response headers', statusCode, headers)
					}
					response.writeHead(statusCode, headers)
					end()
				} else {
					const mediaType = this.getMediaType(headers, url)
					switch(mediaType){
						case 'meta':
							this.handleMetaResponse(download, statusCode, headers, response, end, url)
							break
						case 'video':
							this.handleVideoResponse(download, statusCode, headers, response, end, url)
							break
						default:
							this.handleGenericResponse(download, statusCode, headers, response, end)
					}
				}
			} else {
				if(this.committed && (!statusCode || statusCode < 200 || statusCode >= 400)){ // skip redirects
					global.osd.show(global.streamer.humanizeFailureMessage(statusCode || 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
				}
				let fallback, location
				headers['content-length'] = 0
				if(statusCode == 404){
					Object.keys(this.playlists).some(masterUrl => {
						if(Object.keys(this.playlists[masterUrl]).includes(url)){ // we have mirrors for this playlist
							Object.keys(this.playlists[masterUrl]).some(playlist => {
								if(playlist == url){
									this.playlists[masterUrl][playlist] = false // means offline
									return true
								}
							})
							let hasFallback = Object.keys(this.playlists[masterUrl]).some(playlist => {
								if(playlist != url && this.playlists[masterUrl][playlist] === true){
									fallback = playlist
									console.warn('Fallback playlist redirect', url, '>>', playlist, JSON.stringify(this.playlists))
									return true
								}
							})
							if(!hasFallback){
								console.warn('No more fallbacks', url, JSON.stringify(this.playlists))
								this.fail(404)
							}
						}
					})
				} else if(typeof(headers.location) != 'undefined') {
					location = this.proxify(this.absolutize(headers.location, url))
				}
				if(fallback){
					headers.location = fallback
					response.writeHead(301, headers)
					if(this.debug){
						console.log('download sent response headers', 301, headers)
					}
				} else if(location){
					headers.location = location
					statusCode = (statusCode >= 300 && statusCode < 400) ? statusCode : 307
					response.writeHead(statusCode, headers)		
					if(this.debug){
						console.log('download sent response headers', statusCode, headers)
					}			
				} else {
					response.writeHead(statusCode, headers)	
					if(this.debug){
						console.log('download sent response headers', statusCode, headers)
					}
				}
				end()
			}
		})
		download.start()
	}
	handleMetaResponse(download, statusCode, headers, response, end, url){
		if(!headers['content-type']){
			headers['content-type'] = 'application/x-mpegURL'
		}	
		if(typeof(this.playlistBitrates[url]) != 'undefined' && typeof(this.playlistBitratesSaved[url]) == 'undefined'){
			this.playlistBitratesSaved[url] = true
			Object.values(this.playlistBitrates).forEach(n => {
				if(this.bitrates.includes(n)){
					this.bitrates = this.bitrates.filter(b => b != n)
				}
			})
			this.saveBitrate(this.playlistBitrates[url])
		}
		headers = this.removeHeaders(headers, ['content-length']) // we'll change the content
		//headers = this.addCachingHeaders(headers, this.mediaTypeCacheTTLs['meta']) // set a min cache to this m3u8 to prevent his overfetching
		
		if(statusCode == 206){
			statusCode = 200
		}

		let data = []
		download.on('data', chunk => data.push(chunk))
		download.once('end', () => {
			data = String(Buffer.concat(data))
			if(data.length > 12){
				this.proxifyM3U8(String(data), url, download.request.currentURL, body => {
					if(!response.headersSent){
						headers['content-length'] = body.length
						response.writeHead(statusCode, headers)
						if(this.debug){
							console.log('download sent response headers', statusCode, headers)
						}
					}
					body = body.replace(new RegExp('#EXT-X-MEDIA-SEQUENCE:.*\n'), '')
					end(body)
				})
			} else {
				console.error('Invalid response from server', url, data)
				if(!response.headersSent){
					response.writeHead(statusCode, headers)
					if(this.debug){
						console.log('download sent response headers', statusCode || 504, headers)
					}
				}
				end(data)
			}
		})
	}	
	handleVideoResponse(download, statusCode, headers, response, end, url){
		if(this.opts.forceVideoContentType){
			headers['content-type'] = this.opts.forceVideoContentType
		} else if(!headers['content-type'] || !headers['content-type'].match(new RegExp('^(audio|video)'))){ // fix bad mimetypes
			switch(this.ext(url)){
				case 'ts':
				case 'mts':
				case 'm2ts':
					headers['content-type'] = 'video/MP2T'
					break
				default:
					headers['content-type'] = 'video/mp4'
			}
		}
		let dataSent = 0, buffer = [], initialOffset = download.request.requestingRange ? download.request.requestingRange.start : 0, offset = initialOffset
		let doBitrateCheck = this.committed && this.type != 'network-proxy' && this.bitrates.length < this.opts.bitrateCheckingAmount
		let onend = () => {
			// console.warn('download ended', url, dataSent, initialOffset, statusCode, headers, download.request.destroyed, download.request.retryCount, download.request.authErrors)
			let chunk = Buffer.concat(buffer)
			let len = this.len(chunk)
			if(!response.headersSent){
				if(this.debug){
					console.log('download sent response headers', statusCode, headers)
				}
				headers['content-length'] = len
				response.writeHead(statusCode, headers)
			}
			response.write(chunk)
			if(doBitrateCheck){
				this.collectBitrateSample(chunk, offset, len, url)
				this.finishBitrateSample(url)
				if(this.debug){
					console.log('finishBitrateSampleProxy', url, initialOffset, offset)
				}
			}
			if(this.listenerCount('data')){
				this.emit('data', url, chunk, len, offset)
			}
			response.end()
			end()
		}
		// console.warn('handleVideoResponse', doBitrateCheck, this.opts.forceFirstBitrateDetection, offset, download, statusCode, headers)
		download.on('data', chunk => {
			dataSent += chunk.length
			buffer.push(chunk)
			this.downloadLog(this.len(chunk))
		})
		download.once('end', onend)
		if(download.ended) onend()
	}	
	handleGenericResponse(download, statusCode, headers, response, end){
		if(!response.headersSent){
			response.writeHead(statusCode, headers)
			if(this.debug){
				console.log('download sent response headers', statusCode, headers)
			}
		}
        console.log('handleGenericResponse', headers)
		download.on('data', chunk => {
			if(global.isWritable(response)){
				response.write(chunk)
			}
		})
		download.once('end', () => end())
	}	
}

module.exports = StreamerProxyHLS
