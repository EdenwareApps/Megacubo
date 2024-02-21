const http = require('http'), closed = require('../../on-closed')
const StreamerProxyBase = require('./proxy-base'), decodeEntities = require('decode-entities')
const stoppable = require('stoppable'), m3u8Parser = require('m3u8-parser')

class HLSJournal {
	constructor(url, altURL){
		this.url = url
		this.altURL = altURL
		this.header = ''
		this.journal = {}
		this.liveJournal = {}
		this.maxLen = Math.ceil(global.config.get('live-window-time') / 3)
		this.mediaSequence = {}
		this.regexes = {
			unproxify: new RegExp('/127\.0\.0\.1:[0-9]+(/s/|/)'),
			protoNDomain: new RegExp('(https?://|//)[^/]+/'),
			tsBasename: new RegExp('[^/]*\\.(m4s|mts|m2ts|ts)', 'i'),
			ts: new RegExp('^.*\\.(m4s|mts|m2ts|ts)', 'i')			
		}
	}
	process(content){
		if(content){
			let header = [], segments = {}, extinf, currentSegmentName
			content.split("\n").filter(s => s.length >= 7).forEach(line => {
				let isExtinf = line.substr(0, 7) == '#EXTINF'
				if(isExtinf){
					extinf = line
					currentSegmentName = null
				} else if(extinf) {
					if(line.startsWith('#')) {
						extinf += "\r\n"+ line
						if(currentSegmentName) {
							segments[currentSegmentName] = extinf
						}
					} else {
						currentSegmentName = this.segmentName(line)
						extinf += "\r\n"+ line
						segments[currentSegmentName] = extinf
					}
				} else {
					header.push(line)
				}
			})
			const segmentKeys = Object.keys(segments)
			this.liveJournal = segmentKeys.map(u => global.absolutize(u, this.url))
			segmentKeys.forEach(name => {
				if(typeof(this.journal[name]) == 'undefined' || this.journal[name] != segments[name]){
					this.journal[name] = segments[name]
				}
			})
			this.header = header.join("\r\n")
			let m = content.match(new RegExp('EXT-X-MEDIA-SEQUENCE: *([0-9]+)', 'i'))
			if(m){
				this.mediaSequence[segmentKeys[0]] = parseInt(m[1])
			} else {
				console.error('Media sequence missing', content)
			}
			let d = content.match(new RegExp('EXTINF: *([0-9\\.]+)', 'i')), lwt = global.config.get('live-window-time')
			d = d ? parseFloat(d[1]) : 2
			let journalKeys = Object.keys(this.journal)
			let maxJournalSize = parseInt(lwt / d)
			if(journalKeys.length > maxJournalSize) {
				const trimCount = journalKeys.length - maxJournalSize
				journalKeys.slice(0, trimCount).forEach(k => {
					delete this.journal[k]
				})
			}
		}
	}
	readM3U8() {
		let content = this.header
		Object.keys(this.journal).forEach((key, i) => {
			if(i == 0) {
				if(this.mediaSequence[key]) {
					content = content.replace(new RegExp('EXT-X-MEDIA-SEQUENCE: *([0-9]+)', 'i'), 'EXT-X-MEDIA-SEQUENCE:'+ this.mediaSequence[key])
				}
			}
			content += "\r\n"+ this.journal[key]
		})
		return content
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
	inLiveWindow(name){
		let n = name
		if(n.indexOf('://') != -1){
			n = this.segmentName(n)
		}
		return this.liveJournal.some(u => u.indexOf(n) != -1)
	}
}

class HLSRequests extends StreamerProxyBase {
	constructor(opts){
		super(opts)
		this.debugConns = false
		this.debugUnfinishedRequests = false
		this.activeManifest = null
		this.activeRequests = {}
		this.mpegURLRegex = new RegExp('mpegurl', 'i')
		this.once('destroy', () => {
			Object.keys(this.activeRequests).forEach(url => {
				if(this.activeRequests[url].request){
					this.activeRequests[url].request.destroy()
				}
				delete this.activeRequests[url]
			})
			if(global.debugConns){
				global.osd.hide('hlsprefetch')
			}
		})
		this.maxDiskUsage = 200 * (1024 * 1024)
		/* disable content ranging, as we are rewriting meta and segments length comes incorrect from server sometimes */
		this.responseHeadersRemoval.push(...['content-range', 'accept-ranges'])
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
	findSegmentIndexInJournal(segmentUrl, journalUrl) {
		if(!this.journals[journalUrl]) return
		let key, index
		const purl = this.proxify(segmentUrl)
		Object.keys(this.journals[journalUrl].journal).some((k, i) => {
			if(this.journals[journalUrl].journal[k].indexOf(purl) != -1) {
				key = k
				index = i
				return true
			}
		})
		if(key) return {key, index}
	}
	findJournalFromSegment(url){
		let ret
		Object.keys(this.journals).some(jurl => {
			const ptr = this.findSegmentIndexInJournal(url, jurl)
			if(ptr) {
				ret = {journal: jurl, segment: ptr.key, index: ptr.index}
				return true
			}
		})
		return ret
	}
	async getNextInactiveSegment(){
		const journalUrl = this.activeManifest
		if(typeof(this.journals[journalUrl]) == 'undefined') return
		const journal = this.journals[journalUrl].journal
		let next, lastDownloadingKey, lastDownloadingKeyIndex
		Object.keys(journal).some((k, i) => {
			journal[k].split("\n").forEach(line => {
				if(line.length > 3 && !line.startsWith('#')){
					let segmentUrl = this.unproxify(global.absolutize(line, journalUrl))
					if(segmentUrl == this.lastUserRequestedSegment) {
						lastDownloadingKey = k
						lastDownloadingKeyIndex = i
						return true
					}
				}
			})
		})
		if(lastDownloadingKey){
			for(const k of Object.keys(journal).slice(lastDownloadingKeyIndex + 1)) {
				if(!journal[k]) continue
				const line = journal[k].split("\n").filter(line => {
					return line.length > 3 && !line.startsWith('#')
				}).shift().trim()
				const segmentUrl = global.absolutize(this.unproxify(line), journalUrl)
				const cachedInfo = await global.Download.cache.info(segmentUrl)
				if(cachedInfo) continue
				if(this.activeRequests[segmentUrl]) continue
				if(!this.journals[journalUrl].inLiveWindow(segmentUrl)) continue
				next = segmentUrl
				break
			}
		}
		return next
	}
	finishObsoleteSegmentRequests(journalUrl){
		if(!this.journals[journalUrl]) return
		Object.keys(this.journals[journalUrl].journal).forEach(k => {
			this.journals[journalUrl].journal[k].split("\n").forEach(line => {
				if(line.length > 3 && !line.startsWith('#')){
					let segmentUrl = this.unproxify(global.absolutize(line, journalUrl))
					if(typeof(this.activeRequests[segmentUrl]) != 'undefined'){
						if(!this.activeRequests[segmentUrl] || this.activeRequests[segmentUrl].ended) return
						const notLive = !this.journals[journalUrl].inLiveWindow(segmentUrl)
						const notFromUser = this.activeRequests[segmentUrl].opts.shadowClient
						if(notFromUser && notLive){
							console.log('finishing request due to no clients or i\'ts outside of live window', segmentUrl)
							this.activeRequests[segmentUrl].destroy()
							delete this.activeRequests[segmentUrl]
						}
					}
				}
			})
		})
	}
	inLiveWindow(url){
		let pos = this.findJournalFromSegment(url)
		if(pos){
			return this.journals[pos.journal].inLiveWindow(url)
		}
	}
	report404ToJournal(url){
		if(this.debugConns) console.log('report404')
		let pos = this.findJournalFromSegment(url)
		if(pos){
			let ks = Object.keys(this.journals[pos.journal].journal)
			let i = ks.indexOf(pos.segment)
			if(this.debugConns) console.log('report404', pos, i)
			if(i != -1){
				const ret = ks.some((k, i) => {
					delete this.journals[pos.journal].journal[k]
					if(k == pos.segment) return true
				})
			} else {
				console.error('report404 ERR '+ url +' segment not found in journal '+JSON.stringify(pos))
			}
		} else {
			console.error('report404 ERR '+ url +' not found in journal')
		}
	}
	validateStatus(code){
		return code >= 200 && code <= 400 && code != 204
	}
	download(opts){
		const now = global.time(), url = opts.url, seg = this.isSegmentURL(url)
		const ptr = this.findJournalFromSegment(url)
		if(ptr) {
			if(!this.journals[ptr.journal].inLiveWindow(url)) {
				console.error('OUT OF LIVE WINDOW', url)
				opts.cachedOnly = true
			}
		}
		if(this.debugConns){
			console.warn('REQUEST CONNECT START', now, url)
		}
		if(seg && !opts.shadowClient) {
			this.lastUserRequestedSegment = url
		}
		const request = new global.Download(opts)
		this.activeRequests[url] = request
		this.debugActiveRequests()
		if(this.debugUnfinishedRequests){
			global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
		}
		let ended, doPrefetch, mediaType, end = () => {
			if(this.debugConns){
				console.error('REQUEST CONNECT END', global.time() - now, url, request.statusCode, ext)
			}
			if(this.activeRequests[url]){
				delete this.activeRequests[url]
				this.debugActiveRequests()
			}
			if(this.activeRequests[url]){
				delete this.activeRequests[url]
			}
			if(!ended){
				ended = true
				if(!opts.shadowClient) {
					let manifest
					if(mediaType == 'meta'){
						manifest = url
					} else if(mediaType == 'video'){
						if(!this.findSegmentIndexInJournal(url, this.activeManifest)){
							const n = this.findJournalFromSegment(url)
							if(n && n.journal && n.journal != this.activeManifest){
								manifest = n.journal
							}
						}
					}
					if(manifest && manifest != this.activeManifest){
						this.activeManifest = manifest
						if(this.playlistsMeta[manifest]) {
							if(this.playlistsMeta[manifest].bandwidth && !isNaN(this.playlistsMeta[manifest].bandwidth) && this.playlistsMeta[manifest].bandwidth > 0) {
								this.bitrateChecker.save(this.playlistsMeta[manifest].bandwidth, true)
							}
							if(this.playlistsMeta[manifest].resolution) {
								this.emit('dimensions', this.playlistsMeta[manifest].resolution)
							}
						}
						this.finishObsoleteSegmentRequests(manifest)
					}
				}
				if(this.activeManifest && this.committed){ // has downloaded at least one segment to know from where the player is starting
					if(seg &&  this.bitrateChecker.acceptingSamples()){
						if(!this.playlistsMeta[this.activeManifest] || !this.codecData || !(this.codecData.audio || this.codecData.video)) {
							this.committed && this.bitrateChecker.addSample(this.proxify(url))
						}
					}					
					// Using nextTick to prevent "RangeError: Maximum call stack size exceeded"
					doPrefetch && process.nextTick(() => this.prefetch(url, opts))
				}
			}
		}
		request.once('response', (status, headers) => {
			if(this.validateStatus(status)) {
				mediaType = 'video'
				if(this.ext(request.currentURL) == 'm3u8' || (headers['content-type'] && headers['content-type'].match(this.mpegURLRegex))){
					mediaType = 'meta'
				} else {
					// only prefetch if player is downloading old segments (user has seeked back)
					if(headers['x-megacubo-dl-source'] && headers['x-megacubo-dl-source'].indexOf('cache') != -1) {
						// meaningless with no in-disk caching
						if(global.config.get('hls-prefetching') && global.config.get('in-disk-caching-size')) {
							doPrefetch = true
						}
					}
				}
			} else {
				if(this.debugConns){
					console.error('Request error', status, headers, url, request.authErrors, request.opts.maxAuthErrors)
				}
				if(this.debugUnfinishedRequests){
					global.osd.show('unfinished: '+ Object.values(this.activeRequests).length, 'fas fa-info-circle', 'hlsu', 'persistent')
					global.osd.show('error '+ url.split('/').pop().split('?')[0] +' - '+ status, 'fas fa-info-circle', 'hlsr', 'long')
				}
				if(status == 410){
					status = 404
				}
				if(status == 404){
					this.report404ToJournal(url)
					status = 204 // Exoplayer doesn't plays well with 404 errors
				}
			}
		})
		request.on('data', chunk => this.downloadLog(this.len(chunk)))
		request.once('end', end)
		return request
	}
	async prefetch(url, opts){
		if(!this.destroyed && !Object.keys(this.activeRequests).length) {
			let next = await this.getNextInactiveSegment()
			if(next){
				if(this.debugConns) console.warn('PREFETCHING', url, '=>', next)
				const nopts = opts
				nopts.url = next
				nopts.cachedOnly = false
				nopts.shadowClient = true
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
	debugActiveRequests(){
		if(global.debugConns){
			global.osd.show(Object.keys(this.activeRequests).length +' active requests', 'fas fa-download', 'hlsprefetch', 'persistent')
		}
	}
	findJournal(url, altURL){
		if(typeof(this.journals[url]) != 'undefined') return this.journals[url]
		if(typeof(this.journals[altURL]) != 'undefined') return this.journals[altURL]
		let ret, urls = [url, altURL]
		Object.values(this.journals).some(j => {
			if(j.altURL && urls.includes(j.altURL)){
				ret = j
				return true
			}
		})
		return ret
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
		/* disable content ranging, as we are rewriting meta and segments length comes incorrect from server sometimes */
		this.requestHeadersRemoval = ['range', 'cookie', 'referer', 'origin', 'user-agent']
		if(this.opts.debug){
			console.log('OPTS', this.opts)
		}
		this.once('destroy', () => {
			if(this.server){
				this.server.close()
			}
		})
		this.playlists = {} // fallback mirrors for when one playlist of these returns 404, it happens, strangely...
		this.playlistsMeta = {}
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
            } else if(url.startsWith('/') && url.charAt(1) != '/'){
                url = 'http://' + url.substr(1)
            } else if(this.opts.addr && url.indexOf('//') != -1){
                if(url.indexOf(this.opts.addr +':'+ this.opts.port +'/') != -1){
					url = url.replace(new RegExp('^(http://|//)'+ this.opts.addr.replaceAll('.', '\\.') +':'+ this.opts.port +'/', 'g'), '$1')
					url = url.replace('://s/', 's://')
                } 
            }                      
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
        }
        return url
	}
	trackNameChooseAttrs(attributes){
		let attrs = Object.assign({}, attributes)
		if(attrs['BANDWIDTH'] && attrs['AVERAGE-BANDWIDTH']){
			delete attrs['AVERAGE-BANDWIDTH']
		}
		if(Object.keys(attrs).length > 2 && attrs['FRAME-RATE']){
			delete attrs['FRAME-RATE']
		}
		if(Object.keys(attrs).length > 2 && attrs['CODECS']){
			delete attrs['CODECS']
		}
		return Object.keys(attrs)
	}
	trackName(track){
		let name = this.trackNameChooseAttrs(track.attributes).map(k => {
			let v = track.attributes[k]
			if(k == 'RESOLUTION'){
				v = track.attributes[k].width +'x'+ track.attributes[k].height
			}
			if(['AVERAGE-BANDWIDTH', 'BANDWIDTH'].includes(k)){
				v = global.kbsfmt(parseInt(v))
			}
			return global.ucWords(k, true) +': '+ v
		}).join(' &middot; ')
		return name || track.uri
	}
	proxifyM3U8(body, baseUrl, url) {
		if(!this.isM3U8Content(body)) return body
		body = body.trim()
		let u, parser = new m3u8Parser.Parser(), replaces = {}
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
						u = global.absolutize(segment.uri, baseUrl)
						let n = this.proxify(u)
						replaces[dn] = n.substr(0, n.length - df)
						if(this.opts.debug){
							console.log('replace', dn, replaces[dn], '|', df, n, '|', segment.uri)
						}
						body = this.applyM3U8Replace(body, dn, replaces[dn])
						if(this.opts.debug){
							console.log('ok', replaces, body)
						}
					}
				})
				let journal = this.findJournal(baseUrl, url)
				if(typeof(journal) == 'undefined'){
					this.journals[baseUrl] = journal = new HLSJournal(baseUrl, url)
				}
				journal.process(body)
				body = journal.readM3U8(body)
			}
			if(parser.manifest.playlists && parser.manifest.playlists.length){
				if(typeof(this.playlists[url]) == 'undefined'){
					this.playlists[url] = {}
				}
				parser.manifest.playlists.forEach(playlist => {
					let dn = this.dirname(playlist.uri)
					u = global.absolutize(playlist.uri, baseUrl)
					if(!this.playlists[url][u]){
						this.playlists[url][u] = {state: true, name: this.trackName(playlist)} // state=true here means "online"
					}
					if(typeof(replaces[dn]) == 'undefined'){
						if(this.opts.debug){
							console.log('dn', dn)
						}
						replaces[dn] = this.dirname(this.proxify(u))
						if(this.opts.debug){
							console.log('replace', dn, replaces[dn])
						}
						body = this.applyM3U8Replace(body, dn, replaces[dn])
						if(this.opts.debug){
							console.log('ok')
						}
					}
					if(playlist.attributes && !this.playlistsMeta[u]){
						this.playlistsMeta[u] = {}
						if(playlist.attributes['AVERAGE-BANDWIDTH'] && parseInt(playlist.attributes['AVERAGE-BANDWIDTH']) > 128){
							this.playlistsMeta[u].bandwidth = parseInt(playlist.attributes['AVERAGE-BANDWIDTH'])
						} else if(playlist.attributes['BANDWIDTH'] && parseInt(playlist.attributes['BANDWIDTH']) > 128){
							this.playlistsMeta[u].bandwidth = parseInt(playlist.attributes['BANDWIDTH'])
						}
						if(playlist.attributes['RESOLUTION']){
							this.playlistsMeta[u].resolution = playlist.attributes['RESOLUTION'].width +'x'+ playlist.attributes['RESOLUTION'].height
						}
					}
				})
			}
			body = body.replace(new RegExp('(URI="?)([^\\n"\']+)', 'ig'), (...match) => { // for #EXT-X-KEY:METHOD=AES-128,URI="https://...
				if(match[2].indexOf('127.0.0.1') == -1){
					match[2] = global.absolutize(match[2], baseUrl)
					match[2] = this.proxify(match[2])
				}
				return match[1] + match[2]
			})
		}
		parser.dispose()
		parser = null
		return body
	}
	applyM3U8Replace(body, from, to){
		let lines = body.split("\n")
		lines.forEach((line, i) => {
			if(line.length < 3 || line.startsWith('#')) {
				return
			}
			if(line.indexOf('/') == -1 || line.substr(0, 2) == './' || line.substr(0, 3) == '../') {
				if(from == ''){
					lines[i] = global.joinPath(to, line)
				}
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
			this.server = http.createServer(this.handleRequest.bind(this))
            this.serverStopper = stoppable(this.server)
			this.server.listen(0, this.opts.addr, (err) => {
				if(this.destroyed && !err){
					err = 'destroyed'
				}
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
			response.writeHead(404, global.prepareCORS({
				'connection': 'close'
			}, req))
			return response.end()
		}
		if(this.networkOnly){
			if(this.type != 'network-proxy'){
				if(!req.headers['x-from-network-proxy'] && !req.rawHeaders.includes('x-from-network-proxy')){
					console.warn('networkOnly block', this.type, req.rawHeaders)
					response.writeHead(504, global.prepareCORS({
						'connection': 'close'
					}, req))
					return response.end()
				}
			}
		}
		if(this.opts.debug){
			console.log('req starting...', req.url)
		}
		let ended, url = this.unproxify(req.url)		
		let reqHeaders = req.headers
		reqHeaders = this.removeHeaders(reqHeaders, this.requestHeadersRemoval)
		if(this.type == 'network-proxy'){
			reqHeaders['x-from-network-proxy'] = '1'
		} else {
			if(reqHeaders['x-from-network-proxy']){
				delete reqHeaders['x-from-network-proxy']
			}
		}		
		reqHeaders = this.getDefaultRequestHeaders(reqHeaders)
		if(this.opts.debug){
			if(this.type == 'network-proxy'){
				console.log('network serving', url, reqHeaders)
			} else {
				console.log('serving', url, req, url, reqHeaders)
			}
		}
		let match
		const isCacheable = this.committed && (match = url.match(this.isCacheableRegex)) && match.length && match[0].length // strangely it was returning [""] sometimes on electron@9.1.2
		const cacheTTL = isCacheable ? global.config.get('live-window-time') : 0
		const keepalive = this.committed && global.config.get('use-keepalive')
		const download = this.download({
			url,
			cacheTTL,
			acceptRanges: !!cacheTTL,
			debug: false,
			headers: reqHeaders,
			authURL: this.opts.authURL || false, 
			keepalive,
			followRedirect: this.opts.followRedirect,
			maxAuthErrors: this.committed ? 10 : 3,
			retries: this.committed ? 10 : 3
		})
		const abort = data => {
			if(!ended){
				ended = true
			}
			response.destroy()
			// download.destroy()
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
			download.destroy()
			if(this.opts.debug){
				console.log('ended', traceback())
			}
		}
		closed(req, response,  download, () => {
			if(!ended){ // req disconnected
				if(this.opts.debug){
					console.log('response closed or request aborted', ended, response.ended)
				}
				end()
			}
		})
		download.on('error', err => {
			if(this.type == 'network-proxy'){
				console.log('network request error', url, err)
			}
			if(this.committed){
				global.osd.show(global.lang.CONNECTION_FAILURE +' ('+ (err.response ? err.response.statusCode : 'timeout') +')', 'fas fa-times-circle', 'debug-conn-err', 'normal')
				if(this.opts.debug){
					console.log('download err', err)
				}
			}
		})
		download.once('response', (statusCode, headers) => {
			//console.warn('RECEIVING RESPONSE', statusCode, headers, download.currentURL, download)
			headers = this.removeHeaders(headers, this.responseHeadersRemoval)
			headers = global.prepareCORS(headers, url)
			if(this.opts.forceExtraHeaders){
				Object.assign(headers, this.opts.forceExtraHeaders)
			}
			//console.log('download response', url, statusCode, headers)
			headers['connection'] = 'close'
			if(!statusCode || [-1, 0, 401, 403].includes(statusCode)){
				/* avoid to passthrough 403 errors to the client as some streams may return it esporadically */
				return abort()					
			}
			if(statusCode >= 200 && statusCode < 300) { // is data response
				if(statusCode == 206){
					statusCode = 200
				}
				const isSRT = this.isSRT(headers, url)
				if(isSRT) headers['content-type'] = 'text/vtt'
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
					global.osd.show(global.lang.CONNECTION_FAILURE +' ('+ (statusCode || 'timeout') +')', 'fas fa-times-circle', 'debug-conn-err', 'normal')
				}
				let fallback, location
				headers['content-length'] = 0
				if(statusCode == 404){
					Object.keys(this.playlists).some(masterUrl => {
						if(Object.keys(this.playlists[masterUrl]).includes(url)){ // we have mirrors for this playlist
							Object.keys(this.playlists[masterUrl]).some(playlist => {
								if(playlist == url){
									this.playlists[masterUrl][playlist].state = false // means offline
									return true
								}
							})
							let hasFallback = Object.keys(this.playlists[masterUrl]).some(playlist => {
								if(playlist != url && this.playlists[masterUrl][playlist].state === true){
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
					location = this.proxify(global.absolutize(headers.location, url))
				} else if(!statusCode) {
					statusCode = 500
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
	handleMetaResponse(download, statusCode, headers, response, end){
		const isSRT = this.isSRT(headers, download.opts.url)
		if(isSRT) headers['content-type'] = 'text/vtt'
		let closed, data = []
		if(!response.headersSent){
			response.writeHead(statusCode, headers)
			if(this.opts.debug){
				console.log('download sent response headers', statusCode, headers)
			}
		}
		download.on('data', chunk => {
			data.push(chunk)
			if(download.receivedUncompressed >= this.typeMismatchCheckingThreshold) {
				this.typeMismatchCheck(data)
			}
		})
		download.once('end', () => {
			data = String(Buffer.concat(data))
			if(isSRT) {
				data = this.srt2vtt(data)
			} else {
				data = this.proxifyM3U8(data, download.currentURL, download.opts.url)
			}
			if(!closed){
				if(global.isWritable(response)){
					try {
						//console.warn('RECEIVING wr', chunk)
						response.write(data)
					} catch(e){
						console.error(e)
						closed = true
					}
				}
			}
			end()
		})
	}
	handleResponse(download, statusCode, headers, response, end){
		const ext1 = this.ext(download.opts.url)
		const ext2 = this.ext(download.currentURL)
		if(
			ext1 == 'm3u8' || ext2 == 'm3u8' || 
			(!ext1 && !ext2 && headers['content-type'] && headers['content-type'].match(this.mpegURLRegex)) // TS segments sent with application/x-mpegURL has been seen ¬¬
		) {
			return this.handleMetaResponse(download, statusCode, headers, response, end)
		}
		let closed
		if(!response.headersSent){
			response.writeHead(statusCode, headers)
			if(this.opts.debug){
				console.log('download sent response headers', statusCode, headers)
			}
		}
        //console.log('handleResponse', download.opts.url, headers, response.headersSent)
		download.on('data', chunk => {
			if(!closed){
				if(global.isWritable(response)){
					try {
						response.write(chunk)
					} catch(e){
						console.error(e)
						closed = true
					}
				}
			}
		})
		download.once('end', end)
	}
}

module.exports = StreamerProxyHLS
