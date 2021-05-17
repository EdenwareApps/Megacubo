// In development

const http = require('http'), closed = require(global.APPDIR +'/modules/on-closed')
const StreamerProxyBase = require('./proxy-base'), decodeEntities = require('decode-entities')
const fs = require('fs'), Events = require('events'), m3u8Parser = require('m3u8-parser')

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

class DownloadClient extends Events {
	constructor(){
		super()
		this.uid = parseInt(Math.random() * 100000000)
	}
	start(){}
}

class StreamerProxy extends StreamerProxyBase {
	constructor(opts){
		super(opts)
		this.opts.port = 0
		this.type = 'proxy'
		this.networkOnly = false
		this.connections = {}
		this.journals = {}
		this.internalRequestAbortedEvent = 'request-aborted'
		this.opts.followRedirect = true // some servers require m3u8 to requested by original url, otherwise will trigger 406 status, while the player may call directly the "location" header url on next requests ¬¬
		this.opts.forceExtraHeaders = null
		if(this.opts.debug){
			this.opts.debug('OPTS', this.opts)
		}
		this.on('destroy', () => {
			console.warn('proxy.destroy()', Object.keys(this.connections))
			Object.keys(this.connections).forEach(this.destroyConn.bind(this))
			this.connections = {}
			if(this.server){
				this.server.close()
			}
		})
		this.playlists = {} // fallback mirrors for when one playlist of these returns 404, it happens, strangely...
		this.playlistBitrates = {}
		this.playlistBitratesSaved = {}
		this.loaderUID = parseInt(Math.random() * 1000000)
		this.loaderTempFolder = global.paths.temp +'/streamer/'+ this.loaderUID +'/'
		this.loaderCacheMap = {}
		this.domainQueue = {}
		this.mediaTypeCacheTTLs = {meta: 3, video: 60, '': 60}
		fs.mkdir(this.loaderTempFolder, {recursive: true}, () => {})
	}
	destroyConn(uid, data=false, force=true){
		if(this.connections[uid]){
			if(this.connections[uid].response){
				if(data && typeof(data) != 'number' && (this.connections[uid].response.writable || this.connections[uid].response.writeable)){
					if(!this.connections[uid].response.headersSent){
						this.connections[uid].response.setHeader('access-control-allow-origin', '*')
					}
					this.connections[uid].response.end(data)
				} else {
					this.connections[uid].response.end()
				}
			}
			if(this.connections[uid].download){
				this.connections[uid].download[force ? 'destroyAll' : 'destroy']()
			}
			delete this.connections[uid]
		}
	}
	destroyAllConns(){
		Object.keys(this.connections).forEach(uid => this.destroyConn(uid, false, true))
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
    url2file(url){
        return global.sanitize(url)
    }
	download(opts){
		const now = global.time(), client = new DownloadClient(), url = opts.url
		if(typeof(this.loaderCacheMap[url]) == 'undefined' || this.loaderCacheMap[url].ttl < now){
			const file = this.url2file(url)
			const stream = fs.createWriteStream(this.loaderTempFolder + file, {flags: 'w'})   
			const request = new global.Download(opts)
			this.loaderCacheMap[url] = {
				file,
				headersFile: file +'.headers',
				ttl: now + 600, // temp placeholder value
				additionalClients: [],
				originalClient: client,
				request
			}
			let ended, ttl = 60, end = () => {
				if(!ended){
					ended = true
					stream.on('finish', () => {
						client.emit('end')
						client.ended = true
						this.loaderCacheMap[url].originalClient = null
						this.loaderCacheMap[url].finished = true
						this.loaderCacheMap[url].ttl = global.time() + ttl
						this.send(url)
						let doWarn = request.retryCount || request.authErrors || request.received < request.contentLength || request.received < request.totalContentLength
						console[doWarn?'warn':'log']('SEND END', request.opts.url.split('/').pop(), request.getTimeoutOptions(), request.retryCount, request.authErrors, request.received, request.contentLength, request.totalContentLength, request)
					})
					stream.end()
				}
			}
			request.once('response', (status, headers) => {
				let mediaType = this.getMediaType(headers, request.currentURL)
				if(typeof(this.mediaTypeCacheTTLs[mediaType]) == 'number'){
					ttl = this.mediaTypeCacheTTLs[mediaType]
				}
				client.emit('response', status, headers)
				fs.writeFile(this.loaderTempFolder + this.loaderCacheMap[url].headersFile, JSON.stringify({status, headers}), () => {})
			})
			request.on('data', chunk => {
				client.emit('data', chunk)
				stream.write(chunk)
			})
			request.on('error', err => {
				client.emit('error', err)
			})
			request.once('end', end)
			request.once('destroy', end)
			client.request = request
			client.start = () => request.start()
			client.destroy = () => {
				client.removeAllListeners()
				if(!this.loaderCacheMap[url].additionalClients.length){
					request.destroy()
				}
			}
			client.destroyAll = () => {
				client.removeAllListeners()
				this.loaderCacheMap[url].additionalClients.forEach(c => c.removeAllListeners())
				request.destroy()
			}
		} else {
			this.loaderCacheMap[url].additionalClients.push(client)
			client.request = this.loaderCacheMap[url].request
			client.destroy = () => {
				client.removeAllListeners()
				this.loaderCacheMap[url].additionalClients = this.loaderCacheMap[url].additionalClients.filter(c => c.uid != client.uid)
				if(!this.loaderCacheMap[url].originalClient && !this.loaderCacheMap[url].additionalClients.length){
					this.loaderCacheMap[url].request.destroy()
				}
			}
			client.destroyAll = () => {
				if(this.loaderCacheMap[url].originalClient){
					this.loaderCacheMap[url].originalClient.removeAllListeners()
				}
				this.loaderCacheMap[url].additionalClients.forEach(c => c.removeAllListeners())
				request.destroy()
			}
			if(this.loaderCacheMap[url].finished){
				process.nextTick(() => this.send(url))
			}
		}
		return client
	}
	send(url){
		if(this.loaderCacheMap[url].additionalClients.length){
			fs.readFile(this.loaderTempFolder + this.loaderCacheMap[url].headersFile, (err, content) => {
				const additionalClients = this.loaderCacheMap[url].additionalClients
				this.loaderCacheMap[url].additionalClients = []
				//console.log('Parsing headers JSON', err, String(content))
				if(!err && content){
					let data = JSON.parse(String(content))
					if(data && data.headers){
						additionalClients.forEach(client => client.emit('response', data.status, data.headers))				
						let dataSent = 0
						const stream = fs.createReadStream(this.loaderTempFolder + this.loaderCacheMap[url].file)
						stream.on('error', err => {
							console.error('stream error', err)
						})
						stream.on('data', chunk => {
							dataSent += chunk.length
							additionalClients.forEach(client => client.emit('data', chunk))
						})
						stream.on('end', () => {
							additionalClients.forEach(client => {
								client.emit('end')
								client.ended = true
							})
							console.log('sent file', url, dataSent)
							if(this.loaderCacheMap[url].additionalClients.length) this.send(url) // if a new client joined too late to the party, make it happen again!
						})
					} else {
						console.error('Parsing headers error*', String(content))
						additionalClients.forEach(client => client.emit('end'))
					}
				} else {
					console.error('Parsing headers error', err, content)
					additionalClients.forEach(client => client.emit('end'))
				}
			})
		}
	}
    contentRange(type, size, range) {
		const irange = range || {start: 0, end: size - 1}
    	return type + ' ' + irange.start + '-' + irange.end + '/' + (size || '*')
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
		this.destroyAllConns()
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
		console.log('req starting...', req, req.url)
		const uid = this.uid()
		let ended, url = this.unproxify(req.url)
		
		const domain = this.getDomain(url)
		if(typeof(this.domainQueue[domain]) != 'undefined' && this.domainQueue[domain].length){
			this.domainQueue[domain].push({req, response})
			return
		}
		this.domainQueue[domain] = [{req, response}]

		let reqHeaders = req.headers
		reqHeaders['accept-encoding'] =  'identity' // not needed and problematic
		reqHeaders = this.removeHeaders(reqHeaders, ['cookie', 'referer', 'origin'])
		if(this.type == 'network-proxy'){
			reqHeaders['x-from-network-proxy'] = '1'
		} else {
			if(reqHeaders['x-from-network-proxy']){
				delete reqHeaders['x-from-network-proxy']
			}
		}
		if(typeof(reqHeaders['range']) != 'undefined' && this.ext(url) == 'm3u8'){
			/* avoid content ranging on m3u8, as we are rewriting it */
			delete reqHeaders['range']
		}
		//TEMP TEST
		reqHeaders['range'] = 'bytes=0-'

		if(this.debug){
			this.debug('serving', url, req, url, reqHeaders, uid)
		}
		if(this.type == 'network-proxy'){
			console.log('network serving', url, reqHeaders)
		}
		const download = this.download({
			url,
			retries: 5,
			debug: false,
			headers: reqHeaders,
			authURL: this.opts.authURL || false, 
			keepalive: this.committed && global.config.get('use-keepalive'),
			followRedirect: this.opts.followRedirect
		})
		this.connections[uid] = {response, download}
		const end = data => {
			if(!ended){
				ended = true
				this.destroyConn(uid, data, false)
			}
			if(this.opts.debug){
				this.opts.debug('ended', uid, traceback())
			}
			this.domainQueue[domain] = this.domainQueue[domain].slice(1)
			if(this.domainQueue[domain].length){
				const nextRequest = this.domainQueue[domain].shift()
				const nextRequests = this.domainQueue[domain]
				delete this.domainQueue[domain]
				this.handleRequest(nextRequest.req, nextRequest.response)
				if(nextRequests.length){
					this.domainQueue[domain] = (this.domainQueue[domain] || []).concat(nextRequests)
				}
			}
		}
		closed(req, response, () => {
			if(!ended){ // req disconnected
				if(this.opts.debug){
					this.opts.debug('response closed', ended, response.ended)
				}
				response.emit(this.internalRequestAbortedEvent)
				response.end()
				if(this.connections[uid] && this.connections[uid].response){
					this.connections[uid].response.emit(this.internalRequestAbortedEvent)
				}
				end()
			}
		})
		download.on('error', err => {
			if(this.type == 'network-proxy'){
				console.log('serving', url, err)
			}
			if(this.committed){
				global.osd.show(global.streamer.humanizeFailureMessage(err.response ? err.response.statusCode : 'timeout'), 'fas fa-times-circle', 'debug-conn-err', 'normal')
				console.error('download err', err)
				if(this.debug){
					this.debug('download err', err)
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
				this.debug('download response', statusCode, headers, uid)
			}
			headers['connection'] = 'close' // always force connection close on local servers, keepalive will be broken
			if(statusCode >= 200 && statusCode < 300){ // is data response
				if(!headers['content-disposition'] || headers['content-disposition'].indexOf('attachment') == -1 || headers['content-disposition'].indexOf('filename=') == -1){
					// setting filename to allow future file download feature
					// will use sanitize to prevent net::ERR_RESPONSE_HEADERS_MULTIPLE_CONTENT_DISPOSITION on bad filename
					headers['content-disposition'] = 'attachment; filename="' + global.filenameFromURL(url) + '"'
				}
				let len = parseInt(headers['content-length'])
				if(len && typeof(headers['content-range']) == 'undefined'){
					headers['content-range'] = 'bytes 0-'+ (len - 1) +'/'+ len // improve upnp compat
				}
				if(req.method == 'HEAD'){
					if(this.debug){
						this.debug('download sent response headers', statusCode, headers)
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
							this.handleVideoResponse(download, statusCode, headers, response, end, url, uid)
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
						this.debug('download sent response headers', 301, headers)
					}
				} else if(location){
					headers.location = location
					statusCode = (statusCode >= 300 && statusCode < 400) ? statusCode : 307
					response.writeHead(statusCode, headers)		
					if(this.debug){
						this.debug('download sent response headers', statusCode, headers)
					}			
				} else {
					// we'll avoid to passthrough 403 errors to the client as some streams may return it esporadically
					statusCode = statusCode && ![401, 403].includes(statusCode) ? statusCode : 504
					response.writeHead(statusCode, headers)	
					if(this.debug){
						this.debug('download sent response headers', statusCode, headers)
					}			

				}
				end()
			}
		})
		download.start()
	}
	getMediaType(headers, url){
		let type = '', minSegmentSize = 96 * 1024
		if(typeof(headers['content-type']) != 'undefined' && (headers['content-type'].indexOf('video/') != -1 || headers['content-type'].indexOf('audio/') != -1)){
			type = 'video'
		} else if(typeof(headers['content-type']) != 'undefined' && headers['content-type'].toLowerCase().indexOf('linguist') != -1){ // .ts bad mimetype "text/vnd.trolltech.linguist"
			type = 'video'
		}  else if(typeof(headers['content-type']) != 'undefined' && (headers['content-type'].toLowerCase().indexOf('mpegurl') != -1 || headers['content-type'].indexOf('text/') != -1)){
			type = 'meta'
		} else if(typeof(headers['content-type']) == 'undefined' && this.ext(url) == 'm3u8') {
			type = 'meta'
		} else if(typeof(headers['content-length']) != 'undefined' && parseInt(headers['content-length']) >= minSegmentSize){
			type = 'video'
		} else if(typeof(headers['content-type']) != 'undefined' && headers['content-type'] == 'application/octet-stream') { // force download video header
			type = 'video'
		}
		return type
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
		
		/* avoid content ranging on m3u8, as we are rewriting it */
		headers = this.removeHeaders(headers, ['content-range', 'accept-ranges'])
		if(statusCode == 206) statusCode = 200

		let data = []
		download.on('data', chunk => data.push(chunk))
		download.once('end', () => {
			data = String(Buffer.concat(data))
			if(data.length > 12){
				this.proxifyM3U8(String(data), url, download.request.currentURL, body => {
					if(!response.headersSent){
						response.writeHead(statusCode, headers)
						if(this.debug){
							this.debug('download sent response headers', statusCode, headers)
						}
					}
					body = body.replace(new RegExp('#EXT-X-MEDIA-SEQUENCE:.*\n'), '')
					//console.log('M3U8 ' + body, statusCode, url, download.request.currentURL)
					end(body)
				})
			} else {
				console.error('Invalid response from server', url, data)
				if(!response.headersSent){
					response.writeHead(statusCode, headers)
					if(this.debug){
						this.debug('download sent response headers', statusCode || 504, headers)
					}
				}
				end(data)
			}
		})
	}	
	handleVideoResponse(download, statusCode, headers, response, end, url, uid){
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
		if(!response.headersSent){
			if(this.debug){
				this.debug('download sent response headers', statusCode, headers)
			}
			response.writeHead(statusCode, headers)
		}
		let dataSent = 0, initialOffset = download.request.requestingRange ? download.request.requestingRange.start : 0, offset = initialOffset
		let sampleCollected, doBitrateCheck = this.committed && this.type != 'network-proxy' && this.bitrates.length < this.opts.bitrateCheckingAmount
		let onend = () => {
			console.warn('download ended', url, dataSent, initialOffset, download.request.statusCode, download.request.destroyed, download.request.retryCount, download.request.authErrors)
			if(doBitrateCheck){
				console.log('finishBitrateSampleProxy', url, sampleCollected, initialOffset, offset)
				this.finishBitrateSample(url)
			}
			end()
		}
		// console.warn('handleVideoResponse', doBitrateCheck, this.opts.forceFirstBitrateDetection, offset, download, statusCode, headers)
		download.on('data', chunk => {
			dataSent += chunk.length
			response.write(chunk)
			let len = this.len(chunk)
			if(this.listenerCount('data')){
				this.emit('data', url, chunk, len, offset)
			}
			this.downloadLog(len)
			if(doBitrateCheck && !sampleCollected){
				//console.warn('forceFirstBitrateDetection data', this.bitrateCheckBuffer[uid], offset, chunk)
				if(!this.collectBitrateSample(chunk, offset, len, url)){                       
					sampleCollected = true
					console.log('collectBitrateSampleProxy', url, sampleCollected, initialOffset, offset)
				}
			}
			offset += len
		})
		download.once('end', onend)
		if(download.ended) onend()
	}	
	handleGenericResponse(download, statusCode, headers, response, end){
		if(!response.headersSent){
			response.writeHead(statusCode, headers)
			if(this.debug){
				this.debug('download sent response headers', statusCode, headers)
			}
		}
        console.log('handleGenericResponse', headers)
		download.on('data', chunk => response.write(chunk))
		download.once('end', () => end())
	}	
	addCachingHeaders(headers, secs){		
		return Object.assign(headers, {
			'cache-control': 'max-age=' + secs + ', public',
			'expires': (new Date(Date.now() + secs)).toUTCString()
		})
	}
}

module.exports = StreamerProxy
