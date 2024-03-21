const { EventEmitter } = require('events')

class Downloads extends EventEmitter {
   constructor(){
	   	super()
		this.map = {}
		this.server = false
		this.timer = 0
		this.served = []
			
		const { temp } = require('../paths')
		this.folder = temp
		if(this.folder.charAt(this.folder.length - 1) != '/'){
			this.folder += '/'
		}
		this.clients = []
		this.icon = 'fas fa-download'
		this.opts = {
			port: 0,
			addr: '127.0.0.1'
		}
		this.mimes = {
			'.ico': 'image/x-icon',
			'.html': 'text/html',
			'.js': 'text/javascript',
			'.json': 'application/json',
			'.css': 'text/css',
			'.png': 'image/png',
			'.jpg': 'image/jpeg',
			'.wav': 'audio/wav',
			'.mp3': 'audio/mpeg',
			'.svg': 'image/svg+xml',
			'.pdf': 'application/pdf',
			'.doc': 'application/msword',
			'.mp4': 'video/mp4',
			'.ts': 'video/MP2T'
		}
		this.clear()
	   	this.activeDownloads = {}
		global.renderer.on('download-in-background', this.download.bind(this))
	}
	dialogCallback(ret){
		if(ret == 'downloads-start'){
			if(this.askingDownloadStart){
				this.download(this.askingDownloadStart.url, this.askingDownloadStart.name, this.askingDownloadStart.target)
			}
		} else {
			const cancelPrefix = 'downloads-cancel-'
			if(String(ret).startsWith(cancelPrefix)){
				const fs = require('fs')
				const uid = ret.substr(cancelPrefix.length)
				Object.keys(this.activeDownloads).some(url => {
					if(this.activeDownloads[url].uid == uid){
						this.activeDownloads[url].cancelled = true
						this.activeDownloads[url].destroy()
						fs.unlink(this.activeDownloads[url].file, () => {})
						global.renderer.emit('background-mode-unlock', 'saving-file-'+ uid)
						global.osd.hide(uid)
						delete this.activeDownloads[url]
						global.menu.refreshNow()
						return true
					}
				})
			}
		}
		if(this.askingDownloadStart){
			this.askingDownloadStart = null
		}
	}
    contentRange(type, size, range) {
		const irange = range || {start: 0, end: size - 1}
    	return type + ' ' + irange.start + '-' + irange.end + '/' + (size || '*')
    }
	prepare(){ // jit server init
        return new Promise((resolve, reject) => {
			if(this.server){
				return resolve(this.opts.port)
			}
			const fs = require('fs')
			const http = require('http')
			this.server = http.createServer((req, res) => {
				const uid = global.time()
				const url = require('url')
				const path = require('path')
				this.clients.push(uid)
				console.log(`serve ${req.method} ${req.url}`)
				const parsedUrl = url.parse(req.url)
				let pathname = `.${parsedUrl.pathname}`
				if(pathname == './'){
					pathname = './index.html'
				}
				pathname = global.decodeURIComponentSafe(pathname)
				const ext = path.parse(pathname).ext
				if(typeof(this.map[pathname]) != 'undefined'){
					console.log('serve ' + pathname)
					pathname = this.map[pathname]
					console.log('serve ' + pathname)
				} else {
					console.log('serve ' + pathname)
					pathname = path.join(this.folder, pathname)
					console.log('serve ' + pathname, fs.readdirSync(this.folder))
				}
				let resHeaders = global.prepareCORS({
					'accept-ranges': 'bytes',
					'content-type': this.mimes[ext] || 'text/plain',
					'cache-control': 'max-age=0, no-cache, no-store',
					//'content-disposition': 'attachment; filename="' + name + '"',
					'connection': 'close'
				}, req)
				if(pathname.match(new RegExp('^https?://'))){    
					let reqHeaders = {
						'content-encoding': 'identity'
					}      
					if (req.headers.range) {
						reqHeaders['range'] = req.headers.range
					}
					const download = new global.Download({
						url: pathname,
						keepalive: false,
						retries: 5,
						headers: reqHeaders,
						followRedirect: true
					})
					download.once('response', (status, headers) => {
						resHeaders = Object.assign(Object.assign({}, headers), resHeaders)
						resHeaders = download.removeHeaders(headers, [
							'transfer-encoding', 
							'content-encoding', 
							'keep-alive',
							'strict-transport-security',
							'content-security-policy',
							'x-xss-protection',
							'cross-origin-resource-policy'
						])
						if(!resHeaders['content-length'] && download.contentLength > 0){
							resHeaders['content-length'] = download.contentLength
						}
						res.writeHead(status <= 0 ? 500 : status, resHeaders)
					})
					download.on('error', console.error)
					download.on('data', chunk => res.write(chunk))
					download.once('end', () => {
						res.end()
					})
					download.start()
				} else {
					fs.stat(pathname, (err, stat) => {
						if(err) { 
							res.statusCode = 404
							res.end(`File ${pathname} not found!`)
							return
						}
						let status = 200, len = stat.size, start = 0, end = Math.max(0, len - 1)
						if (req.headers.range) {
							const parseRange = require('range-parser')
							const ranges = parseRange(len, req.headers.range, { combine: true })
							if (ranges === -1) {
								res.writeHead(416, {
									'content-length': 0,
									'content-range': 'bytes */'+ len,
									'x-debug': 1
								})
								return res.end()
							}
							if (Array.isArray(ranges)) {
								start = ranges[0].start
								if(end >= len || end < 0) {
									end = ranges[0].end = len - 1
								} {
									end = ranges[0].end
								}
								status = 206
								resHeaders['content-range'] = this.contentRange('bytes', len, ranges[0])
								resHeaders['content-length'] = end - start + 1
								len = end - start + 1
							}
						}
						if (start >= stat.size){ // dont use len here, may be altered
							res.writeHead(416, {
								'content-length': 0,
								'content-range': 'bytes */'+ len,
								'x-debug': 2
							})
							return res.end()
						}
						if(!resHeaders['content-length']){
							resHeaders['content-length'] = end - start + 1
						}
						resHeaders['x-debug'] = start +'-'+ end +'/'+ stat.size
						res.writeHead(status, resHeaders)
						if (req.method === 'HEAD' || len == 0) return res.end()
						let stream = fs.createReadStream(pathname, {start, end})
						let sent = 0
						const closed = require('../on-closed')
						closed(req, res, stream, () => {
							console.log('serve res finished', sent, start, end)
							if(stream){
								stream.destroy()
								stream = null
							}
							let i = this.clients.indexOf(uid)
							if(i != -1){
								this.clients.splice(i, 1)
							}
							res.end()
						})
						stream.pipe(res)
						stream.on('data', chunk => sent += chunk.length)
						console.log('serve res started')
					})
				}
			}).listen(this.opts.port, this.opts.addr, (err) => {
				if (err) {
					console.error('unable to listen on port', err)
					return reject(err)
				}
                this.opts.port = this.server.address().port
                resolve(this.opts.port)
			}) 
		})
	}
	import(file){
        return new Promise((resolve, reject) => {
			const path = require('path')
			const name = path.basename(file)
			console.log('serve import', this.folder, name)
			const dest = path.join(this.folder, name)
			console.log('serve import', file, dest)
			this.served.push(dest)
			if(file == dest) {
				resolve('http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name))
			} else {
				const fs = require('fs')
				fs.copyFile(file, dest, err => {
					if(err){
						reject(err)
					} else {
						resolve('http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name))
					}
				})
			}
		})
	}
	async serve(file, triggerDownload, doImport, name){
        await this.prepare()
		if(!name){
			const path = require('path')
			name = path.basename(file)
		}
		if(doImport){
			const url = await this.import(file)
			console.log('serve serve', file, url)
			if(triggerDownload){						
				global.renderer.emit('download', url, name)
			}
			return url
		} else {
			let url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name)
			this.map['./' + name] = file
			console.log('serve serve', file, url)
			if(triggerDownload){						
				global.renderer.emit('download', url, name)
			}
			return url
		}
	}
    clear(){
		console.log('serve clear', traceback())
		const fs = require('fs')
        fs.access(this.folder, error => {
            if (error) {
                fs.mkdir(this.folder, { recursive: true }, () => {})
            } else {
				this.served.forEach(f => fs.unlink(f, () => {}))
				this.served = []
            }
        })
    }
	async askDownload(url, name, target){		
		this.askingDownloadStart = {url, name, target}
		let ret = await global.menu.dialog([
			{template: 'question', text: global.paths.manifest.window.title, fa: this.icon},
			{template: 'message', text: global.lang.DOWNLOAD_START_CONFIRM.format(name) +"\r\n\r\n"+ global.lang.DOWNLOAD_START_HINT.format([global.lang.TOOLS, global.lang.ACTIVE_DOWNLOADS].join('/'))},
			{template: 'option', text: lang.YES, id: 'downloads-start', fa: 'fas fa-check-circle'},
			{template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle'}
		], 'no')
		this.dialogCallback(ret)
	}
	getUniqueFilenameHelper(name, i) {
		let pos = name.lastIndexOf('.')
		if(pos == -1){
			return name + '-' + i
		} else {
			return name.substr(0, pos) + '-' + i + name.substr(pos)
		}
	}
	getUniqueFilename(files, name) {
		let i = 0, nname = name
		while(files.includes(nname)) {
			i++
			nname = this.getUniqueFilenameHelper(name, i)
		}
		return nname
	}	
	download(url, name, target){  
		target = target.replace('file:///', '/')  
		console.log('Download in background', url, name, target)
		if(typeof(this.activeDownloads[url]) != 'undefined'){
			return
		}
		const fs = require('fs')
		fs.readdir(target, (err, files) => {
			if(Array.isArray(files)){
				name = this.getUniqueFilename(files, name)
				console.log('UNIQUE FILENAME ' + name + ' IN ' + files.join(','))
			} else {
				console.log('READDIR ERR ' + String(err))
			}
			const uid = 'download-'+ name.replace(new RegExp('[^A-Za-z0-9]+', 'g'), '')
			global.renderer.emit('background-mode-lock', 'saving-file-'+ uid)
			global.osd.show(global.lang.SAVING_FILE_X.format(name) +' 0%', 'fa-mega spin-x-alt', uid, 'persistent')
			const file = target +'/'+ name
			const writer = fs.createWriteStream(file, {flags: 'w' , highWaterMark: Number.MAX_SAFE_INTEGER}), download = new global.Download({
				url,
				keepalive: false,
				retries: 999,
				headers: {},
				followRedirect: true
			})
			download.uid = uid
			download.file = file
			download.filename = name
			this.activeDownloads[url] = download
			if(global.menu.path == global.lang.TOOLS){
				global.menu.refresh()
			}
			download.on('progress', progress => {
				global.osd.show(global.lang.SAVING_FILE_X.format(name) +'  '+ parseInt(progress) +'%', 'fa-mega spin-x-alt', uid, 'persistent')
				if(global.menu.path.indexOf(global.lang.ACTIVE_DOWNLOADS) != -1){
					global.menu.refresh()
				}
			})
			download.on('error', console.error)
			download.on('data', chunk => writer.write(chunk))
			download.once('end', () => {
				const finished = () => {
					writer.destroy()
					const done = () => {
						global.renderer.emit('background-mode-unlock', 'saving-file-'+ uid)
						delete this.activeDownloads[url]
						if(global.menu.path.indexOf(global.lang.ACTIVE_DOWNLOADS) != -1){
							global.menu.refreshNow()
						}
					}
					if(download.cancelled) {
						done()
					} else {
						global.osd.show(global.lang.FILE_SAVED_ON.format(menu.basename(target) || target, name), 'fas fa-check-circle', uid, 'normal')
						fs.chmod(file, 0o777, err => { // https://stackoverflow.com/questions/45133892/fs-writefile-creates-read-only-file#comment77251452_45140694
							console.log('Updated file permissions', err)
							done()
						})
					}
				}
				writer.on('finish', finished)
				writer.on('error', finished)
				writer.end()
			})
			download.start()
		})
	}
	entry(){
		return {
			name: global.lang.ACTIVE_DOWNLOADS,
			type: 'group',
			fa: this.icon,
			renderer: this.entries.bind(this)
		}
	}
	entries(){
		return new Promise((resolve, reject) => {
			let entries = Object.keys(this.activeDownloads).map(url => {
				const download = this.activeDownloads[url], name = download.filename.split('/').pop()
				return {
					name,
					details: global.lang.SAVING_FILE +' '+ download.progress +'%',
					type: 'action',
					fa: this.icon,
					action: async () => {
						let ret = await global.menu.dialog([
							{template: 'question', text: global.paths.manifest.window.title, fa: this.icon},
							{template: 'message', text: global.lang.DOWNLOAD_CANCEL_CONFIRM.format(name)},
							{template: 'option', text: lang.YES, id: 'downloads-cancel-'+ download.uid, fa: 'fas fa-check-circle'},
							{template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle'}
						], 'no')
						this.dialogCallback(ret)
					}
				}
			})
			resolve(entries)
		})
	}
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == global.lang.TOOLS && !entries.some(e => e.name == global.lang.ACTIVE_DOWNLOADS) && Object.keys(this.activeDownloads).length){
                entries.push(this.entry())
            }
            resolve(entries)
        })
    }
}

module.exports = new Downloads()
