
const http = require('http'), path = require('path'), parseRange = require('range-parser'), finished = require('on-finished')
const StreamerProxyBase = require('./proxy-base'), decodeEntities = require('decode-entities'), m3u8Parser = require('m3u8-parser')

class StreamerProxy extends StreamerProxyBase {
	constructor(opts){
		super('', opts)
		this.type = 'proxy'
		this.connections = {}
		this.journal = {}
		this.internalRequestAbortedEvent = 'request-aborted'
		// this.opts.debug = console.log
		if(this.opts.debug){
			this.opts.debug('OPTS', this.opts)
		}
		this.on('destroy', () => {
			console.warn('proxy.destroy()', Object.keys(this.connections))
			Object.keys(this.connections).forEach(this.destroyConn.bind(this))
			this.connections = {}
			this.server.close()
		})
		this.playlists = {} // fallback mirrors for when one playlist of these returns 404, it happens, strangely...
		this.playlistBitrates = {}
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
				if(!force && this.connections[uid].download.preventDestroy){
					return // hold reference to ondestroy
				} else {
					this.connections[uid].download.preventDestroy = false
					this.connections[uid].download.destroy()
				}
			}
			delete this.connections[uid]
		}
	}
    proxify(url){
        if(typeof(url) == 'string' && url.indexOf('//') != -1){
            if(!this.port){
                if(this.server && typeof(this.server.address) == 'function'){
                    this.port = this.server.address().port
                } else {
                    return url // srv not ready
                }
            }
			url = this.unproxify(url)
			if(url.substr(0, 7) == 'http://') {
				url = 'http://'+ this.opts.addr +':'+this.port+'/' + url.substr(7)
			} else if(url.substr(0, 8) == 'https://') {
				url = 'http://'+ this.opts.addr +':'+ this.port +'/s/' + url.substr(8)
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
	keepJournal(url, segments){
		console.log('SEGMENTS', segments)
		if(typeof(this.journal[url]) == 'undefined'){
			this.journal[url] = []
		}
		let addingSegments = []
		for(let i = (segments.length - 1); i>= 0; i--){
			let has = this.journal[url].some(jseg => jseg.uri == segments[i].uri)
			if(has){
				console.log('SEGMENTS HAS', i, segments.length,  this.journal[url].length)
				break
			} else {
				addingSegments.push(segments[i])
			}
		}
		console.log('SEGMENTS ADD', addingSegments.length)
		if(addingSegments.length){
			this.journal[url] = this.journal[url].concat(addingSegments.reverse())
		}
	}
	proxifyM3U8(body, url){
		body = body.replace(new RegExp('^ +', 'gm'), '')
		body = body.replace(new RegExp(' +$', 'gm'), '')
		let parser = new m3u8Parser.Parser(), replaces = {}, u
		parser.push(body)
		parser.end()
		// console.log('M3U8 PARSED', url, parser)
		if(parser.manifest){
			let qs = url.indexOf('?') ? url.split('?')[1] : ''
			if(parser.manifest.segments && parser.manifest.segments.length){
				// this.keepJournal(url, parser.manifest.segments) // TODO
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
							if(playlist.attributes["AVERAGE-BANDWIDTH"] && parseInt(playlist.attributes["AVERAGE-BANDWIDTH"]) > 128){
								this.playlistBitrates[u] = parseInt(playlist.attributes["AVERAGE-BANDWIDTH"])
							} else if(playlist.attributes["BANDWIDTH"] && parseInt(playlist.attributes["BANDWIDTH"]) > 128){
								this.playlistBitrates[u] = parseInt(playlist.attributes["BANDWIDTH"])
							}
						}
					}
				})
			}
			// console.warn('PRXBODY', body, parser.manifest, replaces)
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
    contentRange (type, size, range) {
      return type + ' ' + (range ? range.start + '-' + range.end : '*') + '/' + size
    }
	start(){
		return new Promise((resolve, reject) => {
			this.server = http.createServer(this.handleRequest.bind(this)).listen(0, this.opts.addr, (err) => {
				if (err) {
					if(this.opts.debug){
						this.opts.debug('unable to listen on port', err)
					}
					this.emit('fail')
					reject(err)
					return
				}
				this.connectable = true
				this.port = this.server.address().port
				resolve(true)
			})
		})
	}
	handleRequest(req, response){
		if(this.destroyed || req.url.indexOf('favicon.ico') != -1){
			response.writeHead(404, {
				'Access-Control-Allow-Origin': '*'
			})
			return response.end()
		}
		if(this.debug){
			this.debug('req starting...', req, req.url)
		}
		let url = this.unproxify(req.url)
		let reqHeaders = req.headers, dom = this.getDomain(url)
		reqHeaders.host = dom;
		['cookie', 'referer', 'origin'].forEach(k => {
			if(typeof(reqHeaders[k]) != 'undefined'){
				delete reqHeaders[k]
			}
		})
		if(this.debug){
			this.debug('serving', url, req, path.basename(url), url, reqHeaders)
		}
		const uid = this.uid()
		let ended
		const download = new global.Download({
			url,
			retries: 5,
			keepalive: this.committed && global.config.get('use-keepalive'),
			headers: reqHeaders,
			followRedirect: false
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
		}
		/* Prevent never-ending responses bug on v10.5.0. Is it needed yet? */
		if(response.socket){
			response.socket.on('close', () => {
				if(this.opts.debug){
					this.opts.debug('response socket close', ended, response.ended)
				}
				setTimeout(() => {
					if(response.writable){
						if(this.opts.debug){
							this.opts.debug('response socket close timeout', ended, response.ended)
						}
						response.emit(this.internalRequestAbortedEvent)
						response.end()
					}
				}, 2000)
			})
		} else {
			console.warn('no socket, already disconnected?!')
			return end()
		}
		
		req.on('close', () => { // req disconnected
			if(!ended){
				console.warn('client aborted the request')
				if(this.connections[uid] && this.connections[uid].response){
					this.connections[uid].response.emit(this.internalRequestAbortedEvent)
				}
				end()
			}
		})
		download.on('error', err => {
			if(this.committed){
				global.osd.show((err.response ? err.response.statusCode : 'timeout') + ' error', 'fas fa-times-circle', 'debug-conn-err', 'normal')
			}
		})
		download.on('response', (statusCode, headers) => {
			headers = this.removeHeaders(headers, ['transfer-encoding'])
			headers['access-control-allow-origin'] = '*'
			if(statusCode >= 200 && statusCode < 300){ // is data response
				if(req.method == 'HEAD'){
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
					global.osd.show((statusCode || 'timeout') + ' error', 'fas fa-times-circle', 'debug-conn-err', 'normal')
				}
				let fallback, location
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
					headers['location'] = fallback
					response.writeHead(301, headers)
				} else if(location){
					headers['location'] = location
					response.writeHead((statusCode >= 300 && statusCode < 400) ? statusCode : 307, headers)					
				} else {
					// we'll avoid to passthrough 403 errors to the client as some streamsmay return it esporadically
					response.writeHead(statusCode && ![401, 403].includes(statusCode) ? statusCode : 504, headers)
				}
				end()
			}
		})
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
		if(typeof(this.playlistBitrates[url]) != 'undefined' && this.bitrates.length < this.opts.bitrateCheckingAmount){
			console.log('METARESPONSE BITRATE SAVE!!', url, this.playlistBitrates[url])
			this.saveBitrate(this.playlistBitrates[url])
		}
		headers = this.removeHeaders(headers, ['content-length']) // we'll change the content
		headers = this.addCachingHeaders(headers, 4) // set a min cache to this m3u8 to prevent his overfetching
		download.on('end', data => {
			if(data.length > 12){
				if(!response.headersSent){
					response.writeHead(statusCode, headers)
				}
				data = this.proxifyM3U8(String(data), url)
				if(this.opts.debug){
					this.opts.debug('M3U8 ' + data, url)
				}
			} else {
				console.error('Invalid response from server', url, data)
				if(!response.headersSent){
					response.writeHead(504, headers)
				}
			}
			end(data)
		})
	}	
	handleVideoResponse(download, statusCode, headers, response, end, url, uid){
		if(!headers['content-type'] || !headers['content-type'].match(new RegExp('^(audio|video)'))){ // fix bad mimetypes
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
			response.writeHead(statusCode, headers)
		}
		let offset = download.requestingRange ? download.requestingRange.start : 0
		let sampleCollected, doBitrateCheck = offset == 0 && this.bitrates.length < this.opts.bitrateCheckingAmount
		let onend = () => {
			//console.warn('download ended')
			if(doBitrateCheck){
				this.finishBitrateSample(uid)
			}
			if(download.preventDestroy){
				//console.warn('download.destroy() forceFirstBitrateDetection hack removed', offset)
				download.preventDestroy = false
				download.destroy()
			}
			end()
		}
		// console.warn('handleVideoResponse', doBitrateCheck, this.opts.forceFirstBitrateDetection, offset, download, statusCode, headers)
		if(doBitrateCheck && this.opts.forceFirstBitrateDetection){
			response.on(this.internalRequestAbortedEvent, () => { // client disconnected
				//console.warn('forceFirstBitrateDetection hack applied')
				download.preventDestroy = true
			})
		}
		download.on('data', chunk => {
			if(download.preventDestroy !== true){
				response.write(chunk)
			}
			let len = this.len(chunk)
			if(this.listenerCount('data')){
				this.emit('data', url, chunk, len, offset)
			}
			offset += len
			if(doBitrateCheck && !sampleCollected){
				//console.warn('forceFirstBitrateDetection data', this.bitrateCheckBuffer[uid], offset, chunk)
				if(!this.collectBitrateSample(chunk, len, uid)){                       
					sampleCollected = true
					//console.warn('forceFirstBitrateDetection done', download.preventDestroy, download.ended, download.destroyed)
					if(download.preventDestroy){
						//console.warn('download.destroy() forceFirstBitrateDetection hack removed, destroying', offset)
						download.preventDestroy = false
						download.end()
					}
				}
			}
		})
		download.on('end', onend)
		if(download.ended){
			onend()
		}
	}	
	handleGenericResponse(download, statusCode, headers, response, end){
		if(!response.headersSent){
			response.writeHead(statusCode, headers)
		}
        console.log('handleGenericResponse', headers)
		download.on('data', chunk => response.write(chunk))
		download.on('end', () => end())
	}	
	addCachingHeaders(headers, secs){		
		return Object.assign(headers, {
			'cache-control': 'max-age=' + secs + ', public',
			'expires': (new Date(Date.now() + secs)).toUTCString()
		})
	}
}

module.exports = StreamerProxy
