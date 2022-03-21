const http = require('http'), closed = require(global.APPDIR +'/modules/on-closed')
const StreamerProxyBase = require('./proxy-base'), decodeEntities = require('decode-entities')
const fs = require('fs'), async = require('async'), Events = require('events'), m3u8Parser = require('m3u8-parser')
const MPEGTSPacketProcessor = require('./ts-packet-processor.js')

class HLSJournal {
	constructor(url){
		this.url = url
		this.header = ''
		this.journal = {}
		this.liveJournal = {}
		this.maxLen = Math.ceil(global.config.get('live-window-time') / 3)
		this.mediaSequence = {}
		this.regexes = {
			'unproxify': new RegExp('/127\.0\.0\.1:[0-9]+(/s/|/)'),
			'protoNDomain': new RegExp('(https?://|//)[^/]+/'),
			'tsBasename': new RegExp('[^/]*\\.(m4s|mts|m2ts|ts)', 'i'),
			'ts': new RegExp('^.*\\.(m4s|mts|m2ts|ts)', 'i')			
		}
	}
    absolutize(path, url){
		if(path.substr(0, 2) == '//'){
			path = 'http:' + path
		}
        if(['http://', 'https:/'].includes(path.substr(0, 7))){
            return path
		}
		let uri = new URL(path, url)
        return uri.href
	}
	process(content){
		if(content){
			let header = [], segments = {}, extinf
			content.split("\n").filter(s => s.length >= 7).forEach((line, i) => {
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
			this.liveJournal = segments
			Object.keys(segments).forEach(name => {
				if(typeof(this.journal[name]) == 'undefined' || this.journal[name] != segments[name]){
					this.journal[name] = segments[name]
				}
			})
			this.header = header.join("\r\n")
			let m = content.match(new RegExp('EXT-X-MEDIA-SEQUENCE: *([0-9]+)', 'i'))
			if(m){
				m = parseInt(m[1])
				let skeys = Object.keys(segments), jkeys = Object.keys(this.journal), i = jkeys.indexOf(skeys[0])
				if(i == -1){
					console.error('Media sequence processing error')
				} else {
					m -= i
					this.header = this.header.replace(new RegExp('EXT-X-MEDIA-SEQUENCE: *([0-9]+)', 'i'), 'EXT-X-MEDIA-SEQUENCE:'+ m)
				}
			} else {
				console.error('Media sequence missing')
			}
		}
	}
	segmentName(url, basename){
		let match, nurl = url
		if(nurl.match(this.regexes.unproxify)){
			nurl = nurl.replace(this.regexes.unproxify, '/')
		}
		if(basename){				
			match = nurl.match(this.regexes.tsBasename)
		} else {
			if(nurl.match(this.regexes.protoNDomain)){
				nurl = nurl.replace(this.regexes.protoNDomain, '')
			}
			match = nurl.match(this.regexes.ts)
		}
		if(match){
			return match[0]
		}
		return nurl
	}
	isLiveSegment(name){
		let n = name
		if(n.indexOf('://') != -1){
			n = this.segmentName(n)
		}
		return typeof(this.liveJournal[n]) != 'undefined'
	}
}

class HLSRequestClient extends Events {
	constructor(){
		super()
		this.uid = parseInt(Math.random() * 100000000)
	}
	start(){
		this.emit('start')
	}
	respond(status, headers){
		if(!this.responded){
			if(!headers){
				headers = {}
			}
			this.emit('response', status, headers)
			return this.responded = true
		}
	}
	end(){
		if(!this.ended){
			console.error('end without responded')
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

class HLSRequest extends StreamerProxyBase {
	constructor(opts){
		super()
		this.mediaType = ''
		this.folder = opts.folder
		this.url = opts.url
		this.file = opts.file
		this.headersFile = opts.file +'.headers'
		this.request = opts.request
		this.clients = []
		this.starttime = global.time()
		this.responseStarted = false
		this.bytesWritten = 0
		this.headers = null
		this.status = null
		this.currentFragment = 0
		this.fragmentSize = 128 * 1024
		this.fragments = []
		this.transform = {}
		this.contentLength = 0
	}
	reset(){
		this.restoreData = {};
		['fragments', 'headers', 'status', 'bytesWritten','contentLength', 'ended'].forEach(k => {
			this.restoreData[k] = this[k]
			switch(k){
				case 'bytesWritten':
				case 'contentLength':
					this[k] = 0
					break
				case 'fragments':
					this[k] = []
					break
				default:
					this[k] = null
			}
		})
	}
	restore(){
		if(this.restoreData){
			Object.keys(this.restoreData).forEach(k => {
				this[k] = this.restoreData[k]
			})
		}
	}
	expired(){
		return this.mediaType == 'meta' && (this.starttime + 2) < global.time()
	}
	validateStatus(code){
		return code >= 200 && code <= 400 && code != 204
	}
	respond(status, headers){
		if(!this.headers){
			this.status = status
			this.headers = headers
			this.mediaType = this.getMediaType(this.headers, this.url)
			if(typeof(this.headers['accept-ranges']) != 'undefined'){
				delete this.headers['accept-ranges']
			}
			if(typeof(this.headers['content-length']) != 'undefined'){
				delete this.headers['content-length']
			}
			//console.warn('HLSRequest HEAD', this.status, this.headers, this.mediaType)
		}
	}
	write(chunk){
		/*
		console.warn('HLSRequest CHUNK', chunk, chunk.length)
		const stream = fs.createWriteStream(this.requestCacheDir + this.requestCacheMap[url].file, {flags: 'w'}) 
		stream.write
		
		stream.on('error', err => {
			console.error('request stream error', err)
		}) 
		*/
		let offset = this.bytesWritten
		for(let i = 0; i < chunk.length ;){
			let spaceLeft = 0
			if(typeof(this.fragments[this.currentFragment]) == 'undefined'){
				spaceLeft = this.fragmentSize
			} else {
				spaceLeft = this.fragmentSize - this.fragments[this.currentFragment].size
			}
			if(spaceLeft <= 0){
				this.currentFragment++	
				spaceLeft = this.fragmentSize		
			}
			let len = Math.min(spaceLeft, chunk.length - i)
			//console.warn('HLSRequest WR', len, this.currentFragment, spaceLeft)
			if(len <= 0) break
			if(typeof(this.fragments[this.currentFragment]) == 'undefined'){
				//console.warn('HLSRequest SET START', offset, len, i, this.currentFragment, this.fragments[this.currentFragment], spaceLeft)
				this.fragments[this.currentFragment] = {
					buffer: chunk.slice(i, i + len), 
					size: len, 
					start: offset
				}
			} else {
				Object.assign(this.fragments[this.currentFragment], {
					buffer: Buffer.concat([this.fragments[this.currentFragment].buffer, chunk.slice(i, i + len)]),
					size: this.fragments[this.currentFragment].size + len
				})
			}
			offset += len
			i += len
			if(i >= chunk.length) break
		}
		//console.warn('HLSRequest WR', this.fragments, this.bytesWritten, offset)
		this.bytesWritten += chunk.length
		this.pump()
	}
	end(){
		//console.warn('HLSRequest END', this.pumping)
		this.request.destroy()
		this.ended = true
		this.contentLength = this.fragments.map(f => f.size).reduce((partialSum, a) => partialSum + a, 0)
		this.pump()
	}
	addClient(client){
		if(!this.clients.some(c => c.uid == client.uid)){
			client.request = this.request
			client.hrBytesWritten = 0
			this.clients.push(client)
			client.on('start', () => this.pump())
		}
	}
	removeClient(client){
		client.end()
		client.removeAllListeners()
		this.clients = this.clients.filter(c => c.uid != client.uid)
	}
	pump(){
		//console.warn('HLSRequest P', this.status, this.pumping, this.clients.length)
		if(!this.clients.length || this.status === null){
			return
		}
		if(this.pumping){
			if(!this.listenerCount('pumped')){
				this.once('pumped', () => this.pump())
			}
			return
		}
		this.pumping = true
		const finalize = this.ended, clients = this.clients.slice(0)
		//console.warn('HLSRequest PUMP IN', finalize)
		async.eachOfLimit(clients, 2, (client, i, done) => {
			if(!client.responded){
				client.respond(this.status, this.headers)
			}
			async.eachOfLimit(this.fragments.filter(f => (f.start + f.size) > client.hrBytesWritten), 1, (fragment, j, fdone) => {
				if(fragment.size < this.fragmentSize && !finalize){
					return fdone()
				}
				if(fragment.buffer) {
					const chunk = this.cut(fragment.buffer, client.hrBytesWritten, fragment.start)
					//console.warn('HlsRequest CUT', this.status, this.headers, fragment.buffer.length, client.hrBytesWritten, fragment.start, fragment.size, chunk.length)
					if(client.hrBytesWritten < (fragment.start + fragment.size)){
						//console.warn('HLSRequest PUMP', chunk, client.hrBytesWritten, fragment.start, fragment.size, chunk.length)
						client.hrBytesWritten += chunk.length
						client.emit('data', chunk)
					}
					fdone()
				} else if(fragment.file) {
					fs.readFile(this.folder + fragment.file, {encoding: null}, (err, chunk) => {
						if(err){
							console.error(err)
						}
						if(chunk){
							chunk = this.cut(chunk, client.hrBytesWritten, fragment.start)
							if(chunk.length){
								client.hrBytesWritten += chunk.length
								client.emit('data', chunk)
							}
						}
						fdone()
					})
				} else {
					fdone()
				}
			}, done)
		}, () => {
			//console.warn('HLSRequest PUMP OUT')
			this.offload(finalize, () => {
				this.pumping = false
				if(finalize){
					clients.forEach(client => {
						client.end()
						this.removeClient(client)
						//console.warn('HLSRequest ENDED')
					})
				} else if(this.ended && this.clients.length) { // use ended instead of finalize to see if it ended in the meantime
					return this.pump()
				}
				this.emit('pumped')
			})
		})
	}
	offload(finalize, cb){
		async.eachOfLimit(this.fragments, 2, (fragment, i, done) => {
			if(fragment.buffer && (finalize || fragment.buffer.length >= this.fragmentSize)){
				const file = this.file +'-'+ i
				fs.writeFile(this.folder + file, fragment.buffer, (err, content) => {
					if(err){
						console.error(err)
					} else if(this.fragments[i]) { // not destroyed in the meantime
						this.fragments[i].file = file
						this.fragments[i].buffer = null
					} else {
						fs.unlink(file, () => {})
					}
					done()
				})
			} else {
				done()
			}
		}, () => {
			cb()
		})
	}
	cut(chunk, bytesWritten, start){
		let offset = bytesWritten - start
		//console.warn('TRANSFORM CUT', this.transform, this.mediaType)
		if(this.transform[this.mediaType]){
			chunk = this.transform[this.mediaType](String(chunk))
			//console.warn('TRANSFORM', chunk)
		}
		if(offset > 0){
			return chunk.slice(offset)
		}
		return chunk
	}
	addTransform(mediaType, fn){
		this.transform[mediaType] = fn
	}
	destroy(){
		this.destroyed = true
		this.emit('destroy')
		this.removeAllListeners()
		this.request.destroy()
		const files = this.fragments.filter(f => f.file).map(f => f.file)
		this.fragments = []	
		if(files.length){
			files.push(this.headersFile)
		}
		files.map(f => fs.unlink(this.folder + f, () => {}))
		this.clients.forEach(c => c.end())
		this.clients = []
	}
}

class HLSRequests extends StreamerProxyBase {
	constructor(opts){
		super(opts)
		this.debugConns = true
		this.debugUnfinishedRequests = false
		this.prefetchMaxConcurrency = 2
		this.packetFilterPolicy = 1
		this.requestCacheUID = parseInt(Math.random() * 1000000)
		this.requestCacheDir = global.paths.temp +'/streamer/'+ this.requestCacheUID +'/'
		this.requestCacheMap = {}
		this.activeManifest = null
		fs.mkdir(this.requestCacheDir, {recursive: true}, () => {})
		this.activeRequests = {}
		this.on('destroy', () => {
			Object.keys(this.activeRequests).forEach(url => {
				if(this.activeRequests[url].request){
					this.activeRequests[url].request.destroy()
				}
				delete this.activeRequests[url]
			})
			this.clear()
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
        let f = global.sanitize(url)
		if(f.length >= 42){ // Android filename length limit may be lower https://www.reddit.com/r/AndroidQuestions/comments/65o0ds/filename_50character_limit/
			f = this.md5(f)
		}
		return f
    }
	segmentName(url, basename){
		let ret, fine = Object.keys(this.journals).some(j => {
			ret = this.journals[j].segmentName(url, basename)
			return true
		})
		if(!fine){
			let j = new HLSJournal()
			ret = j.segmentName(url, basename)
		}
		return ret
	}
	getSegmentJournal(url){
		let needles, ret
		Object.keys(this.journals).some(jurl => {
			let journal = this.journals[jurl]
			if(!needles){
				needles = [
					this.segmentName(url, false),
					this.segmentName(url, true)
				]
				needles = [...new Set(needles)]
				// console.log('PREFETCH', needles)
			}
			return needles.some(needle => {
				let ks = Object.keys(journal.journal)
				return ks.some((k, i) => {
					if(k.indexOf(needle) != -1){
						ret = {journal: jurl, segment: k}
						return true
					}
				})
			})
		})
		return ret
	}
	getNextSegment(url){
		let next, pos = this.getSegmentJournal(url)
		if(pos){
			let ks = Object.keys(this.journals[pos.journal].journal)
			ks.some((k, i) => {
				if(k == pos.segment){
					// console.log('PREFETCH ..', needle, k)
					let i = ks.indexOf(k)
					if(ks[i + 1]){
						this.journals[pos.journal].journal[ks[i + 1]].split("\n").some(line => {
							if(line.length > 3 && !line.startsWith('#')){
								next = this.unproxify(this.absolutize(line, pos.journal))
								return true
							}
						})
					}
					return true
				}
			})
		}
		return next
	}
	getNextInactiveSegment(journalUrl){
		if(typeof(this.journals[journalUrl]) == 'undefined') return
		let next, lastDownloading
		let ks = Object.keys(this.journals[journalUrl].journal)
		ks.forEach(k => {
			this.journals[journalUrl].journal[k].split("\n").forEach(line => {
				if(line.length > 3 && !line.startsWith('#')){
					let segmentUrl = this.unproxify(this.absolutize(line, journalUrl))
					if(typeof(this.requestCacheMap[segmentUrl]) != 'undefined'){
						lastDownloading = k
					}
				}
			})
		})
		if(lastDownloading){
			ks.some((k, i) => {
				if(k == lastDownloading){
					// console.log('PREFETCH ..', needle, k)
					let i = ks.indexOf(k)
					if(ks[i + 1]){
						this.journals[journalUrl].journal[ks[i + 1]].split("\n").some(line => {
							if(line.length > 3 && !line.startsWith('#')){
								next = this.absolutize(this.unproxify(line), journalUrl)
							}
						})
					}
					return true
				}
			})
		}
		return next
	}
	isLiveSegment(url){
		let pos = this.getSegmentJournal(url)
		if(pos){
			return this.journals[pos.journal].isLiveSegment(url)
		}
	}
	report404ToJournal(url){
		if(this.debugConns) console.log('report404')
		let pos = this.getSegmentJournal(url)
		if(pos){
			let ks = Object.keys(this.journals[pos.journal].journal)
			let i = ks.indexOf(pos.segment)
			if(this.debugConns) console.log('report404', pos, i)
			if(i != -1){
				ks.some((k, i) => {
					delete this.journals[pos.journal].journal[k]
					if(k == pos.segment) return true
				})
			}
		}
	}
	download(opts){
		const now = global.time(), client = new HLSRequestClient(), url = opts.url, ext = this.ext(url), seg = this.isSegmentURL(url)
		client.destroy = () => this.removeClient(url, client)
		if(ext == 'm3u8'){
			this.activeManifest = url
		}
		if(this.activeRequests[url] || (this.requestCacheMap[url] && !this.requestCacheMap[url].expired())){
			this.requestCacheMap[url].addClient(client)
		} else {
			const file = this.url2file(url)
			if(this.debugConns) console.warn('REQUEST CONNECT START', now, url, this.isLiveSegment(url) ? 'IS LIVE' : 'NOT LIVE')
			const request = new global.Download(opts)
			this.activeRequests[url] = request
			if(this.requestCacheMap[url]){
				this.requestCacheMap[url].reset()
				this.requestCacheMap[url].request = request
			} else {
				this.requestCacheMap[url] = new HLSRequest({file, request, url, folder: this.requestCacheDir})
				this.requestCacheMap[url].addTransform('meta', chunk => this.proxifyM3U8(String(chunk), url, request.currentURL))
			}
			if(this.debugUnfinishedRequests) global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
			this.requestCacheMap[url].addClient(client)
			let ended, end = () => {
				//console.error('HLSRequest end')
				if(this.debugConns) console.warn('REQUEST CONNECT END', global.time() - now, url, request.statusCode, ext)
				if(this.requestCacheMap[url]){
					this.requestCacheMap[url].end()
				}
				if(this.activeRequests[url]){
					delete this.activeRequests[url]
				}
				if(!ended){
					ended = true
				}
				setTimeout(() => {
					if(this.activeManifest && Object.keys(this.activeRequests).length < this.prefetchMaxConcurrency && !this.destroyed) {
						if(Object.keys(this.requestCacheMap).length >= 4){ // avoid to slow down on initial segment load order
							let next = this.getNextInactiveSegment(this.activeManifest)
							if(next){
								if(this.debugConns) console.warn('PREFETCHING', next, url)
								const nopts = opts
								nopts.url = next
								this.download(nopts).start()
							} else {
								let info
								if(this.journals[this.activeManifest]){
									info = Object.keys(this.journals[this.activeManifest].journal).slice(-5)
								}
								if(this.debugConns) console.warn('NOT PREFETCHING', Object.values(this.activeRequests).length, url, info)
							}
						}
					}
				}, 50)
			}
			request.once('response', (status, headers) => {
				this.requestCacheMap[url].responseStarted = true
				if(this.requestCacheMap[url].validateStatus(status)) {
					if(this.ext(request.currentURL) == 'm3u8' || (headers['content-type'] && headers['content-type'].indexOf('mpegurl') != -1)){
						// detect too if url just redirects to the real m3u8
						this.activeManifest = url
					}
				} else {
					console.error('Request error', status, headers, url, request, request.authErrors, request.opts.maxAuthErrors)
					if(this.debugUnfinishedRequests){
						global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
						global.osd.show('error '+ url.split('/').pop().split('?')[0] +' - '+ status, 'fas fa-info-circle', 'hlsr', 'long')
					}
					if(status == 410){
						status = 404
					}
					if(status == 403 && this.prefetchMaxConcurrency){ // concurrent connection limit?
						this.prefetchMaxConcurrency--
					}
					if(status == 404){
						this.report404ToJournal(url)
					}
				}
				this.requestCacheMap[url].respond(status, headers)
			})
			request.on('data', chunk => this.requestCacheMap[url].write(chunk))
			request.on('error', err => {
				console.error(err)
				client.emit('request-error', err)
			})
			request.once('end', end)
			request.once('destroy', end)
			client.start = () => {
				//console.warn('HLSRequest REQUEST STARTED')
				request.start()
			}
		}
		return client
	}
	removeClient(url, client){
		client.end()
		client.removeAllListeners()
		if(!this.requestCacheMap[url]){
			if(this.activeRequests[url]){
				delete this.activeRequests[url]
			}
		} else {
			this.requestCacheMap[url].clients = this.requestCacheMap[url].clients.filter(c => c.uid != client.uid)
			if(!this.requestCacheMap[url].clients.length && this.requestCacheMap[url].ended && !this.requestCacheMap[url].isPrefetching){
				if(this.activeRequests[url]){
					delete this.activeRequests[url]
				}
			}
		}
	}
	estimateDiskSpaceUsage(){
		let size = 0
		Object.keys(this.requestCacheMap).forEach(url => {
			const cacheSize = this.requestCacheMap[url].fragments.length * this.requestCacheMap[url].fragmentSize
			size += cacheSize
		})
		return size
	}
	clean(){
		let used = this.estimateDiskSpaceUsage()
		if(used >= this.maxDiskUsage){
			let index = [], count = 0, freed = 0, freeup = this.maxDiskUsage - used
			Object.keys(this.requestCacheMap).forEach(url => {
				if(!this.requestCacheMap[url].clients.length){
					const cacheSize = this.requestCacheMap[url].fragments.length * this.requestCacheMap[url].fragmentSize
					index.push({url, size: cacheSize, time: this.requestCacheMap[url].starttime})
				}
			})
			index.sortByProp('time').some(e => {
				const url = e.url
				count++
				if(typeof(e.size) == 'number'){
					freed += e.size
				}
				this.requestCacheMap[url].destroy()
				return freed >= freeup
			})
			console.warn('Request cache trimmed from '+ global.kbfmt(used) +' to '+ global.kbfmt(used - freed), freed, count)
		}
	}
	clear(){
		Object.values(this.requestCacheMap).forEach(r => r.destroy())
		this.requestCacheMap = []
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
			console.log('OPTS', this.opts)
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
	proxifyM3U8(body, baseUrl, url){
		body = body.trim()
		let parser = new m3u8Parser.Parser(), replaces = {}, u
		try{ 
			parser.push(body)
			parser.end()
		} catch(e) {
			/*
			TypeError: Cannot read property 'slice' of null
    at parseAttributes (/data/data/tv.megacubo.app/files/www/nodejs-project/node_modules/m3u8-parser/dist/m3u8-parser.cjs.js:115:41)
			*/
			console.error(e)
		}
		if(this.opts.debug){
			console.log('M3U8 PARSED', baseUrl, url, parser)
		}
		if(parser.manifest){
			if(parser.manifest.segments && parser.manifest.segments.length){
				parser.manifest.segments.map(segment => {
					segment.uri = segment.uri.trim()
					let dn = this.getURLRoot(segment.uri)
					if(typeof(replaces[dn]) == 'undefined'){
						let df = segment.uri.length - dn.length
						if(this.opts.debug){
							console.log('dn', dn, df, segment.uri)
						}
						u = this.absolutize(segment.uri, url)
						let n = this.proxify(u)
						replaces[dn] = n.substr(0, n.length - df)
						if(this.opts.debug){
							console.log('replace', dn, replaces[dn], df, n)
						}
						body = this.applyM3U8Replace(body, dn, replaces[dn])
						if(this.opts.debug){
							console.log('ok')
						}
					}
				})
				if(typeof(this.journals[baseUrl]) == 'undefined'){
					this.journals[baseUrl] = new HLSJournal(baseUrl)
				}
				this.journals[baseUrl].process(body)
			}
			if(parser.manifest.playlists && parser.manifest.playlists.length){
				if(typeof(this.playlists[url]) == 'undefined'){
					this.playlists[url] = {}
				}
				parser.manifest.playlists.forEach(playlist => {
					let dn = this.dirname(url)
					if(typeof(replaces[dn]) == 'undefined'){
						if(this.opts.debug){
							console.log('dn', dn)
						}
						u = this.absolutize(playlist.uri, url)
						if(!Object.keys(this.playlists[url]).includes(u)){
							this.playlists[url][u] = true // true here means "online"
						}
						replaces[dn] = this.dirname(this.proxify(u))
						if(this.opts.debug){
							console.log('replace', dn, replaces[dn])
						}
						body = this.applyM3U8Replace(body, dn, replaces[dn])
						if(this.opts.debug){
							console.log('ok')
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
			body = body.replace(new RegExp('(URI="?)((https?://||//)[^\\n"\']+)', 'ig'), (...match) => { // for #EXT-X-KEY:METHOD=AES-128,URI="https://...
				if(match[2].indexOf('127.0.0.1') == -1){
					match[2] = this.proxify(match[2])
				}
				return match[1] + match[2]
			})
			//console.log('PROXIFIED', body)
		}
		return body
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
						console.log('unable to listen on port', err)
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
		if(this.opts.debug){
			console.log('req starting...', req, req.url)
		}
		let ended, url = this.unproxify(req.url)
		
		let reqHeaders = req.headers
		reqHeaders = this.removeHeaders(reqHeaders, ['cookie', 'referer', 'origin', 'range'])
		if(this.type == 'network-proxy'){
			reqHeaders['x-from-network-proxy'] = '1'
		} else {
			if(reqHeaders['x-from-network-proxy']){
				delete reqHeaders['x-from-network-proxy']
			}
		}

		if(this.opts.debug){
			if(this.type == 'network-proxy'){
				console.log('network serving', url, reqHeaders)
			} else {
				console.log('serving', url, req, url, reqHeaders)
			}
		}
		const keepalive = this.committed && global.config.get('use-keepalive')
		const download = this.download({
			url,
			debug: false,
			headers: reqHeaders,
			authURL: this.opts.authURL || false, 
			keepalive,
			followRedirect: this.opts.followRedirect,
			acceptRanges: url.indexOf('m3u') == -1 ? true : false,
			maxAuthErrors: this.committed ? 10 : 3,
			retries: this.committed ? 10 : 3
		})
		const abort = data => {
			if(!ended){
				ended = true
			}
			response.destroy()
			//download.destroy()
			if(this.opts.debug){
				console.log('abort', traceback())
			}
		}
		const end = data => {
			if(!ended){
				ended = true
			}
			if(data && global.isWritable(response)){
				response.write(data)
			}
			response.end()
			if(this.opts.debug){
				console.log('ended', traceback())
			}
		}
		closed(req, response, () => {
			if(!ended){ // req disconnected
				if(this.opts.debug){
					console.log('response closed or request aborted', ended, response.ended)
				}
				//download.destroy()
				response.end()
				end()
			}
		})
		download.on('request-error', err => {
			if(this.type == 'network-proxy'){
				console.log('network request error', url, err)
			}
			if(this.committed){
				// global.osd.show(global.streamer.humanizeFailureMessage(err.response ? err.response.statusCode : 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
				global.osd.show(global.lang.CONNECTION_FAILURE +' ('+ (err.response ? err.response.statusCode : 'timeout') +')', 'fas fa-times-circle', 'debug-conn-err', 'normal')
				console.error('download err', err)
				if(this.opts.debug){
					console.log('download err', err)
				}
			}
		})
		download.once('response', (statusCode, headers) => {
			//console.warn('RECEIVING RESPONSE', statusCode, headers, download.currentURL, download)
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
			//console.log('download response', url, statusCode, headers)
			/* disable content ranging, as we are rewriting meta and video */
			headers = this.removeHeaders(headers, ['content-range', 'accept-ranges'])
			if(keepalive){
				headers['connection'] = 'keep-alive' // force keep-alive to reduce cpu usage, even on local connections, is it meaningful? I don't remember why I commented below that it would be broken :/
			} else {
				headers['connection'] = 'close' // always force connection close on local servers, keepalive will be broken
			}
			if(!statusCode || [-1, 0, 401, 403].includes(statusCode)){
				/* avoid to passthrough 403 errors to the client as some streams may return it esporadically */
				return abort()					
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
					if(this.opts.debug){
						console.log('download sent response headers', statusCode, headers)
					}
					response.writeHead(statusCode, headers)
					end()
				} else {
					this.handleResponse(download, statusCode, headers, response, end)
				}
			} else {
				if(this.committed && (!statusCode || statusCode < 200 || statusCode >= 400)){ // skip redirects
					// global.osd.show(global.streamer.humanizeFailureMessage(statusCode || 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
					global.osd.show(global.lang.CONNECTION_FAILURE +' ('+ (statusCode || 'timeout') +')', 'fas fa-times-circle', 'debug-conn-err', 'normal')
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
					if(this.opts.debug){
						console.log('download sent response headers', 301, headers)
					}
				} else if(location){
					headers.location = location
					statusCode = (statusCode >= 300 && statusCode < 400) ? statusCode : 307
					response.writeHead(statusCode, headers)		
					if(this.opts.debug){
						console.log('download sent response headers', statusCode, headers)
					}			
				} else {
					response.writeHead(statusCode, headers)	
					if(this.opts.debug){
						console.log('download sent response headers', statusCode, headers)
					}
				}
				end()
			}
		})
		download.start()
	}
	handleResponse(download, statusCode, headers, response, end){
		let closed
		if(!response.headersSent){
			response.writeHead(statusCode, headers)
			if(this.opts.debug){
				console.log('download sent response headers', statusCode, headers)
			}
		}
        // console.log('handleResponse', headers)
		//console.warn('RECEIVING DATA0')
		download.on('data', chunk => {
			//console.warn('RECEIVING DATA', chunk, closed)
			if(!closed){
				if(global.isWritable(response)){
					try {
						//console.warn('RECEIVING wr', chunk)
						response.write(chunk)
					} catch(e){
						console.error(e)
						closed = true
					}
				}
			}
		})
		download.on('end', end)
	}	
}

module.exports = StreamerProxyHLS
