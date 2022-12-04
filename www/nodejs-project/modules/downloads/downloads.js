const Events = require('events'), fs = require('fs'), FileWriter = require(global.APPDIR + '/modules/write-queue/file-writer')
const path = require('path'), http = require('http'), url = require('url')
const closed = require('../on-closed'), parseRange = require('range-parser')

class Downloads extends Events {
   constructor(folder){
	   	super()
		this.map = {}
		this.server = false
		this.ttl = 120 // secs
		this.timer = 0
		this.served = []
		this.folder = folder
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
		global.ui.on('download-in-background', this.download.bind(this))
	}
	dialogCallback(ret){
		if(ret == 'downloads-start'){
			if(this.askingDownloadStart){
				this.download(this.askingDownloadStart.url, this.askingDownloadStart.name, this.askingDownloadStart.target)
			}
		} else {
			const cancelPrefix = 'downloads-cancel-'
			if(String(ret).startsWith(cancelPrefix)){
				const uid = ret.substr(cancelPrefix.length)
				Object.keys(this.activeDownloads).some(url => {
					if(this.activeDownloads[url].uid == uid){
						this.activeDownloads[url].destroy()
						fs.unlink(this.activeDownloads[url].file, () => {})
						global.ui.emit('background-mode-unlock', 'saving-file-'+ uid)
						delete this.activeDownloads[url]
						global.explorer.refresh()
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
	wake(){
        return new Promise((resolve, reject) => {
			if(this.server){
				return resolve(this.opts.port)
			}
			this.resetTimeout()
			this.server = http.createServer((req, res) => {
				const uid = global.time()
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
				let resHeaders = {
					'accept-ranges': 'bytes',
					'content-type': this.mimes[ext] || 'text/plain',
					'access-control-allow-origin': '*',
					'access-control-allow-methods': 'get',
					'access-control-allow-headers': 'origin, x-requested-with, content-type, content-length, content-range, cache-control, accept, accept-ranges, authorization',
					'cache-control': 'max-age=0, no-cache, no-store',
					//'content-disposition': 'attachment; filename="' + name + '"',
					'connection': 'close'
				}
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
						closed(req, res, () => {
							console.log('serve res finished', sent, start, end)
							if(stream){
								stream.destroy()
								stream = null
							}
							let i = this.clients.indexOf(uid)
							if(i != -1){
								this.clients.splice(i, 1)
							}
							this.resetTimeout()
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
	sleep(){
		if(this.server){
			if(this.clients.length){
				this.resetTimeout()
			} else {
				this.server.close()
				this.server = null
				this.clear()
			}
		}
	}
	keepAwake(enable){
		this._keepAwake = enable
		this.resetTimeout()
	}
	import(file){
        return new Promise((resolve, reject) => {	
			const name = path.basename(file)
			console.log('serve import', this.folder, name)
			const dest = path.join(this.folder, name)
			console.log('serve import', file, dest)
			this.served.push(dest)
			if(file == dest) {
				resolve('http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name))
			} else {
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
	serve(file, triggerDownload, doImport, name){
        return new Promise((resolve, reject) => {	
			this.wake().then(() => {
				if(!name){
					name = path.basename(file)
				}
				if(doImport){
					this.import(file).then(url => {
						console.log('serve imported', fs.readdirSync(this.folder))
						this.resetTimeout()
						console.log('serve serve', file, url)
						if(triggerDownload){						
							global.ui.emit('download', url, name)
						}
						resolve(url)
					}).catch(reject)
				} else {
					let url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name)
					this.map['./' + name] = file
					this.resetTimeout()
					console.log('serve serve', file, url)
					if(triggerDownload){						
						global.ui.emit('download', url, name)
					}
					resolve(url)
				}
			}).catch(reject)
		})
	}
	resetTimeout(){
		clearTimeout(this.timer)
		if(!this._keepAwake){
			setTimeout(this.sleep.bind(this), this.ttl * 1000)
		}
	}
    clear(){
		return
		console.log('serve clear', traceback())
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
		let ret = await global.explorer.dialog([
			{template: 'question', text: 'Megacubo', fa: this.icon},
			{template: 'message', text: global.lang.DOWNLOAD_START_CONFIRM.format(name) +"\r\n\r\n"+ global.lang.DOWNLOAD_START_HINT.format([global.lang.TOOLS, global.lang.ACTIVE_DOWNLOADS].join('/'))},
			{template: 'option', text: lang.YES, id: 'downloads-start', fa: 'fas fa-check-circle'},
			{template: 'option', text: lang.NO, id: 'no', fa: 'fas fa-times-circle'}
		], 'no')
		this.dialogCallback(ret)
	}
	download(url, name, target){  
		target = target.replace('file:///', '/')  
		console.log('Download in background', url, name, target)
		if(typeof(this.activeDownloads[url]) != 'undefined'){
			return
		}
		fs.readdir(target, (err, files) => {
			if(Array.isArray(files)){
				name = global.getUniqueFilename(files, name)
				console.log('UNIQUE FILENAME ' + name + ' IN ' + files.join(','))
			} else {
				console.log('READDIR ERR ' + String(err))
			}
			const uid = 'download-'+ name.replace(new RegExp('[^A-Za-z0-9]+', 'g'), '')
			global.ui.emit('background-mode-lock', 'saving-file-'+ uid)
			global.osd.show(global.lang.SAVING_FILE_X.format(name) +' 0%', 'fa-mega spin-x-alt', uid, 'persistent')
			const file = target +'/'+ name
			const writer = fs.createWriteStream(file, {highWaterMark: Number.MAX_SAFE_INTEGER}), download = new global.Download({
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
			if(global.explorer.path == global.lang.TOOLS){
				global.explorer.refresh()
			}
			download.on('progress', progress => {
				global.osd.show(global.lang.SAVING_FILE_X.format(name) +'  '+ parseInt(progress) +'%', 'fa-mega spin-x-alt', uid, 'persistent')
				if(global.explorer.path.indexOf(global.lang.ACTIVE_DOWNLOADS) != -1){
					global.explorer.refresh()
				}
			})
			download.on('error', console.error)
			download.on('data', chunk => writer.write(chunk))
			download.once('end', () => {
				const finished = () => {
					writer.destroy()
					global.osd.show(global.lang.FILE_SAVED_ON.format(explorer.basename(target) || target, name), 'fas fa-check-circle', uid, 'normal')
					fs.chmod(file, 0o777, err => { // https://stackoverflow.com/questions/45133892/fs-writefile-creates-read-only-file#comment77251452_45140694
						console.log('Updated file permissions', err)
						global.ui.emit('background-mode-unlock', 'saving-file-'+ uid)
						delete this.activeDownloads[url]
						if(global.explorer.path.indexOf(global.lang.ACTIVE_DOWNLOADS) != -1){
							global.explorer.refresh()
						}
					})
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
						let ret = await global.explorer.dialog([
							{template: 'question', text: 'Megacubo', fa: this.icon},
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

module.exports = Downloads
