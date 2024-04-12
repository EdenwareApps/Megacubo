function patch(scope) {
	if(typeof(scope.URL) != 'undefined'){ // node
		scope.URL = require('url').URL
	}
	if(typeof(scope.URLSearchParams) == 'undefined'){ // node
		scope.URLSearchParams = require('url-search-params-polyfill')
	}		
	const sanitizeFilename = require('sanitize-filename')
	scope.sanitize = (txt, keepAccents) => {
		let ret = txt
		if(keepAccents !== true) {
			//ret = ret.replace(new RegExp('[^\x00-\x7F]+', 'g'), '')
			ret = ret.normalize('NFD').replace(new RegExp('[\u0300-\u036f]', 'g'), '').replace(new RegExp('[^A-Za-z0-9\\._\\- ]', 'g'), '')
		}
		return sanitizeFilename(ret)
	}
	if(process.platform == 'android') {
		const np = require('../network-ip')
		if(np.shouldPatchNetworkInterfaces()) {
			const os = require('os')
			os.networkInterfaces = () => np.networkInterfaces()
		}
	}
	const nodeMajorVersion = parseInt(process.versions.node.split('.').shift())
	if(nodeMajorVersion < 16) {
		const Mod = require('module')
		const req = Mod.prototype.require
		Mod.prototype.require = function () { // compat with 'node:*' modules for old Electron versions
			if(arguments[0].startsWith('node:')) {
				arguments[0] = arguments[0].substr(5)
			}
			return req.apply(this, arguments)
		}
	}
	scope.DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS = 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Content-Range, Range, Vary, range, Authorization'
	scope.prepareCORS = (headers, url, forceOrigin) => {
		let origin = typeof(forceorigin) == 'string' ? forceOrigin : '*'
		if(url) {
			if(typeof(url) != 'string') { // is req object
				scope.reqip = url
				if(url.headers.origin) {
					url = url.headers.origin
				} else {
					const scheme = url.connection.encrypted ? 'https' : 'http'
					const host = url.headers.host
					url = scheme +'://'+ host + url.url
				}
			}
			let pos = url.indexOf('//')
			if(!forceOrigin && pos != -1 && pos <= 5) {
				origin = url.split('/').slice(0, 3).join('/')
			}
		}
		if(headers.setHeader) { // response object
			headers.setHeader('access-control-allow-origin', origin)
			headers.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS')
			headers.setHeader('access-control-allow-headers', scope.DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS)
			headers.setHeader('access-control-expose-headers', scope.DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS)
			headers.setHeader('access-control-allow-credentials', true)
		} else {
			headers['access-control-allow-origin'] = origin
			headers['access-control-allow-methods'] = 'GET,HEAD,OPTIONS'
			headers['access-control-allow-headers'] = scope.DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS
			headers['access-control-expose-headers'] = scope.DEFAULT_ACCESS_CONTROL_ALLOW_HEADERS
			headers['access-control-allow-credentials'] = true
		}
		return headers
	}
	scope.isWritable = stream => {
		return (stream.writable || stream.writeable) && !stream.finished
	}
	scope.rmdir = (folder, itself, cb) => {
		const rimraf = require('rimraf')
		let dir = folder
		if(dir.charAt(dir.length - 1) == '/'){
			dir = dir.substr(0, dir.length - 1)
		}
		if(!itself){
			dir += '/*'
		}
		if(cb === true){ // sync
			try {
				rimraf.sync(dir)
			} catch(e) {}
		} else {
			try {
				rimraf(dir, cb || (() => {}))
			} catch(e) {
				if(typeof(cb) == 'function'){
					cb()
				}
			}
		}
	}
	scope._moveFile = async (from, to) => {
		const fs = require('fs')
		const fstat = await fs.promises.stat(from).catch(console.error)
		if(!fstat) throw '"from" file not found'
		let err
		await fs.promises.rename(from, to).catch(e => err = e)
		if(err) {
			let err
			await fs.promises.copyFile(from, to).catch(e => err = e)
			if(typeof(err) != 'undefined'){
				const tstat = await fs.promises.stat(to).catch(console.error)
				if(tstat && tstat.size == fstat.size) err = null
			}
			if(err) throw err
			await fs.promises.unlink(from).catch(() => {})
		}
		return true
	}
	scope.moveFile = (from, to, _cb, timeout=5, until=null, startedAt = null, fromSize=null) => {
		const fs = require('fs'), now = scope.time(), cb = err => {
			if(_cb){
				_cb(err)
				_cb = null
			}
		}
		if(until === null){
			until = now + timeout
		}
		if(startedAt === null){
			startedAt = now
		}
		const move = () => {
			scope._moveFile(from, to).then(() => cb()).catch(err => {
				if(until <= now){
					fs.access(from, (aerr, stat) => {
						console.error('MOVERETRY GAVEUP AFTER '+ (now - startedAt) +' SECONDS', err, fromSize, aerr)
						return cb(err)
					})
					return
				}
				fs.stat(to, (ferr, stat) => {
					if(stat && stat.size == fromSize){
						cb()
					} else {
						fs.stat(from, (err, stat) => {
							if(stat && stat.size == fromSize){
								setTimeout(() => {
									scope.moveFile(from, to, cb, timeout, until, startedAt, fromSize)
								}, 500)
							} else {
								console.error('MOVERETRY FROM FILE WHICH DOESNT EXISTS ANYMORE', err, stat)
								console.error(ferr, err)
								cb(err || '"from" file changed')
							}
						})
					}
				})
			})
		}
		if(fromSize === null){
			fs.stat(from, (err, stat) => {
				if(err){
					console.error('MOVERETRY FROM FILE WHICH NEVER EXISTED', err)
					cb(err)
				} else {
					fromSize = stat.size
					move()
				}
			})
		} else {
			move()
		}
	}
	scope.decodeURIComponentSafe = uri => {
		try {
			return decodeURIComponent(uri)
		} catch(e) {
			return uri.replace(new RegExp('%[A-Z0-9]{0,2}', 'gi'), x => {
				try {
					return decodeURIComponent(x)
				} catch(e) {
					return x
				}
			})
		}
	}
	scope.listNameFromURL = url => {
		if(!url) return 'Untitled '+ parseInt(Math.random() * 9999)
		let name, subName
		if (url.indexOf('?') !== -1) {
			url.split('?')[1].split('&').forEach(s => {
				s = s.split('=')
				if (s.length > 1) {
					if (['name', 'dn', 'title'].includes(s[0])) {
						if (!name || name.length < s[1].length) {
							name = s[1]
						}
					}
					if (['user', 'username'].includes(s[0])) {
						if (!subName) {
							subName = s[1]
						}
					}
				}
			})
		}
		if(!name && url.indexOf('@') != -1) {
			const m = url.match(new RegExp('//([^:]+):[^@]+@([^/#]+)'))
			if(m) {
				name = m[2] +' '+ m[1]
			}
		}
		if (name) {
			name = scope.decodeURIComponentSafe(name)
			if (name.indexOf(' ') === -1 && name.indexOf('+') !== -1) {
				name = name.replaceAll('+', ' ').replaceAll('<', '').replaceAll('>', '')
			}
			return scope.trimExt(name, ['m3u'])
		}
        if(url.indexOf('//') == -1){ // isLocal
            return scope.trimExt(url.split('/').pop(), ['m3u'])
        } else {
            url = String(url).replace(new RegExp('^[a-z]*://', 'i'), '').split('/').filter(s => s.length)
            if(!url.length){
                return 'Untitled '+ parseInt(Math.random() * 9999)
            } else if(url.length == 1) {
                return scope.trimExt(url[0].split(':')[0], ['m3u'])
            } else {
                return scope.trimExt(url[0].split('.')[0] + ' ' + (subName || url[url.length - 1]), ['m3u'])
            }
        }
	}
	scope.forwardSlashes = path => {
		if(path && path.indexOf('\\') != -1){
			return path.replaceAll('\\', '/').replaceAll('//', '/')
		}
		return path
	}
    scope.parseJSON = json => { // prevent JSON related crashes
		let ret
		try {
			let parsed = JSON.parse(json)
			ret = parsed
		} catch(e) { }
		return ret
	}
	scope.kbfmt = (bytes, decimals = 2) => { // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
		if (isNaN(bytes) || typeof(bytes) != 'number') return 'N/A'
		if (bytes === 0) return '0 Bytes'
		const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
	}
	scope.kbsfmt = (bytes, decimals = 1) => { // https://stackoverflow.com/questions/15900485/correct-way-to-convert-size-in-bytes-to-kb-mb-gb-in-javascript
		if (isNaN(bytes) || typeof(bytes) != 'number') return 'N/A'
		if (bytes === 0) return '0 Bytes/ps'
		const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes/ps', 'KBps', 'MBps', 'GBps', 'TBps', 'PBps', 'EBps', 'ZBps', 'YBps']
		const i = Math.floor(Math.log(bytes) / Math.log(k))
		return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
	}
	scope.absolutize = (path, url) => {
		if(!path) return url
		if(!url) return path
		if(path.startsWith('//')){
			path = 'http:'+ path
		}
        if(path.match(new RegExp('^[htps:]?//'))){
            return path
        }
        let uri
		try {
			uri = new URL(path, url)
			return uri.href
		} catch(e) {
			return scope.joinPath(url, path)
		}
    }
    scope.ucWords = (str, force) => {
		if(!force && str != str.toLowerCase()){
			return str
		}
        return str.replace(new RegExp('(^|[ ])[A-zÀ-ú]', 'g'), letra => {
            return letra.toUpperCase()
        })
	}
}

if(typeof(module) != 'undefined' && typeof(module.exports) != 'undefined'){
	module.exports = patch
} else {
	patch(window)
}


