const fs = require('fs'), MediaURLInfo = require('./media-url-info')

class StreamInfo {
    constructor(){
        this.opts = {
            debug: false,
            probeSampleSize: 1024
        }
        this.mi = new MediaURLInfo()
    }
	_probe(url, timeoutSecs, retries=0, opts={}, recursion=10){
		return new Promise((resolve, reject) => {
			let status = 0, timer = 0, headers = {}, sample = [], start = global.time()
			if(this.validate(url)){
				if(typeof(timeoutSecs) != 'number'){
					timeoutSecs = 10
				}
                const req = {
                    url,
                    followRedirect: true,
					acceptRanges: false,
                    keepalive: false,
                    retries,
					headers: []
                }
				if(opts && typeof(opts) == 'object' && opts.atts){
					if(opts.atts['user-agent']){
						req.headers['user-agent'] = opts.atts['user-agent']
					}
					if(opts.atts['referer']){
						req.headers['referer'] = opts.atts['referer']
					}
				}
                let download = new global.Download(req), ended = false, finish = () => {
					if(this.opts.debug){
						console.log('finish', ended, sample, headers, traceback())
					}
					if(!ended){
						ended = true
						clearTimeout(timer)
						const ping = global.time() - start
						const done = () => {
							const received = JSON.stringify(headers).length + this.len(sample)
							const speed = received / ping
							const ret = {status, headers, sample, ping, speed, url, directURL: download.currentURL}
							// console.log('data', url, status, download.statusCode, ping, received, speed, ret)
							resolve(ret)
						}
						if(download){
							download.destroy()
						}
						sample = Buffer.concat(sample)
						let strSample = String(sample)
						if(strSample.toLowerCase().indexOf('#ext-x-stream-inf') != -1){
							let trackUrl = strSample.split("\n").map(s => s.trim()).filter(line => line.length > 3 && line.charAt(0) != '#').shift()
							trackUrl = global.absolutize(trackUrl, url)
							recursion--
							if(recursion <= 0){
								return reject('Max recursion reached.')
							}
							return this._probe(trackUrl, timeoutSecs, retries, opts, recursion).then( resolve ).catch(err => {
								console.error('HLSTRACKERR', err, url, trackUrl)
								reject(err)
							})
						} else if(strSample.toLowerCase().indexOf('#extinf') != -1){
							let trackUrl = strSample.split("\n").map(s => s.trim()).filter(line => line.length > 3 && line.charAt(0) != '#').shift()
							trackUrl = global.absolutize(trackUrl, url)
							recursion--
							if(recursion <= 0){
								return reject('Max recursion reached.')
							}
							return this._probe(trackUrl, timeoutSecs, retries, opts, recursion).then(ret =>{
								if(ret && ret.status && ret.status >= 200 && ret.status < 300){
									done() // send data from m3u8
								} else {
									resolve(ret) // send bad data from ts
								}
							}).catch(err => {
								console.error('HLSTRACKERR', err, url, trackUrl)
								reject(err)
							})
						} else {
							done()
						}
					}
				}
				if(this.opts.debug){
					console.log(url, timeoutSecs)
				} 
				download.on('error', err => {
					console.warn(url, err)
				})
				download.on('data', chunk => {
					if(typeof(chunk) == 'string'){
						chunk = Buffer.from(chunk)
					}
					sample.push(chunk)
					if(this.len(sample) >= this.opts.probeSampleSize){
						//console.log('sample', sample, this.opts.probeSampleSize)
						finish()
					}
				})
				download.once('response', (statusCode, responseHeaders) => {
					if(this.opts.debug){
						console.log(url, statusCode, responseHeaders)
					}
					headers = responseHeaders
					status = statusCode
				})
				download.once('end', finish)
				download.start()
				if(this.opts.debug){
					console.log(url, timeoutSecs)
				}
				timer = setTimeout(() => finish(), timeoutSecs * 1000)
			} else {
                reject('invalid url')
			}
		})
	}
	async readFilePartial(filePath, length) {
		const fileHandle = await fs.promises.open(filePath, 'r')
		const buffer = Buffer.alloc(length)
		const { bytesRead } = await fileHandle.read(buffer, 0, length, 0)
		fileHandle.close().catch(console.error)
		return buffer.slice(0, bytesRead)
	}
	async probe(url, retries = 2, opts={}){
		const timeout = global.config.get('connect-timeout') * 2
		const proto = this.mi.proto(url)
		if(proto.startsWith('http')) {
			const ret = await this._probe(url, timeout, retries, opts)
			let cl = ret.headers['content-length'] || -1, ct = ret.headers['content-type'] || '', st = ret.status || 0
			if(st < 200 || st >= 400 || st == 204){ // 204=No content
				throw st
			}
			if(ct){
				ct = ct.split(',')[0].split(';')[0]
			} else {
				ct = ''
			}
			if((!ct || ct.substr(0, 5) == 'text/') && ret.sample){	// sniffing						
				if(String(ret.sample).match(new RegExp('#EXT(M3U|INF)', 'i'))){
					ct = 'application/x-mpegURL'
				} else if(this.isBin(ret.sample) && ret.sample.length >= this.opts.probeSampleSize){ // check length too to skip plain text error messages
					if(this.mi.isVideo(url)){
						ct = 'video/mp4'
					} else {
						ct = 'video/MP2T'
					}
				}
			}
			if(ct.substr(0, 4) == 'text' && !this.isYT(url)){
				console.error('Bad content type: ' + ct)
				throw 404
			}
			ret.status = st
			ret.contentType = ct.toLowerCase()
			ret.contentLength = cl
			if(!ret.directURL){
				ret.directURL = ret.url
			}
			ret.ext = this.ext(ret.directURL) || this.ext(url)
			return ret
		} else if(this.validate(url)) { // maybe rtmp
			let ret = {}
			ret.status = 200
			ret.contentType = ''
			ret.contentLength = 999999
			ret.url = url
			ret.directURL = url
			ret.ext = this.ext(url)
			return ret
		} else if(this.isLocalFile(url)) {
			let err
			const stat = await fs.promises.stat(url).catch(e => err = e)
			if(stat && stat.size){
				let ret = {}
				ret.status = 200
				ret.contentType = 'video/mp4'
				ret.contentLength = stat.size
				ret.url = url
				ret.directURL = url
				ret.ext = this.ext(url)
				ret.isLocalFile = true

				let err
				const sample = await this.readFilePartial(url, Math.min(stat.size, this.opts.probeSampleSize)).catch(e => err = e)
				ret.sample = err ? null : sample
				return ret
			}
			throw global.lang.NOT_FOUND
		} else {
			throw global.lang.INVALID_URL
		}
	}
    ext(file){
		let basename = String(file).split('?')[0].split('#')[0].split('/').pop()
		basename = basename.split('.')
		if(basename.length > 1){
			return basename.pop().toLowerCase()
		} else {
			return ''
		}
    }
	proto(url, len){
		var ret = '', res = url.split(':')
		if(res.length > 1 && res[0].length >= 3 && res[0].length <= 6){
			ret = res[0]
		} else if(url.match(new RegExp('^//[^/]+\\.'))){
			ret = 'http'
		}
		if(ret && typeof(len) == 'number'){
			ret = ret.substr(0, len)
		}
		return ret
	}
	rawType(url){
		const mediaType = this.mi.mediaType({url})
		if(mediaType == 'live') {
			return this.mi.isM3U8(url) ? 'hls' : 'ts'
		}
		return mediaType
	}
	isYT(url){
		if(url.indexOf('youtube.com') != -1 || url.indexOf('youtu.be') != -1){
			const d = this.domain(url)
			if(d.indexOf('youtu') != -1){
				return true
			}
		}
	}
	domain(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0]
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	}
	validate(value) {
		if(value.startsWith('//')) {
			value = 'http:'+ value
		}
		let v = value.toLowerCase(), prt = v.substr(0, 4), pos = v.indexOf('://')
		if(['http'].includes(prt) && pos >= 4 && pos <= 6) {
			return true // /^(?:(?:(?:https?|rt[ms]p[a-z]?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
		}
	}
	len(data){
		if (!data) {
			return 0
		}
		if (Array.isArray(data)) {
			return data.reduce((acc, val) => acc + this.len(val), 0)
		}
		return data.byteLength || data.length || 0
	}
	isBin(buf){
		if(!buf) {
			return false
		}
		let sepsLimitPercentage = 5, seps = [' ', '<', '>', ',']
		let sample = String(Buffer.concat([buf.slice(0, 64), buf.slice(buf.length - 64)]).toString('binary')), len = this.len(sample)
		let isAscii = sample.match(new RegExp('^[ -~\t\n\r]+$')) // sample.match(new RegExp('^[\x00-\x7F]*[A-Za-z0-9]{3,}[\x00-\x7F]*$'))
		if(isAscii) {
			let sepsLen = sample.split('').filter(c => seps.includes(c)).length
			if(sepsLen < (len / (100 / sepsLimitPercentage))) { // separators chars are less then x% of the string
				isAscii = false
			}
		}
		return !isAscii
	}
	isLocalFile(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
}

module.exports = StreamInfo
