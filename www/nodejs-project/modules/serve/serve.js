const path = require('path'), http = require('http'), fs = require('fs'), url = require('url'), closed = require(global.APPDIR +'/modules/on-closed')
const parseRange = require('range-parser'), sanitize = require('sanitize-filename')

class Serve {
    constructor(folder){
		this.map = {}
		this.server = false
		this.ttl = 120 // secs
		this.timer = 0
		this.served = []
		this.folder = folder
		if(this.folder.charAt(this.folder.length - 1) != '/'){
			this.folder + '/'
		}
		this.clients = []
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
	}
    contentRange (type, size, range) {
      return type + ' ' + (range ? range.start + '-' + range.end : '*') + '/' + size
    }
	wake(){
        return new Promise((resolve, reject) => {
			if(this.server){
				return resolve(this.opts.port)
			}
			this.resetTimeout()
			this.server = http.createServer((req, res) => {
				const uid = (new Date()).getTime()
				this.clients.push(uid)
				console.log(`serve ${req.method} ${req.url}`)
				const parsedUrl = url.parse(req.url)
				let pathname = `.${parsedUrl.pathname}`
				if(pathname == './'){
					pathname = './index.html'
				}
				pathname = decodeURIComponent(pathname)
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
				fs.stat(pathname, (err, stat) => {
					if(err) { 
						res.statusCode = 404
						res.end(`File ${pathname} not found!`)
						return
					}
					let start = 0, end = stat.size - 1, len = stat.size, name = sanitize(path.basename(pathname).replace(/[^\x00-\x7F]/g, ''))
					if (req.headers.range) {
					  const ranges = parseRange(len, req.headers.range, { combine: true })
					  if (ranges === -1) {
						res.setHeader('Content-Length', 0)
						res.setHeader('Content-Range', this.contentRange('bytes', len))
						res.statusCode = 416
						return res.end()
					  }
					  if (Array.isArray(ranges)) {
						start = ranges[0].start
						end = ranges[0].end
						res.statusCode = 206
						res.setHeader('Content-Range', this.contentRange('bytes', len, ranges[0]))
						len = end - start + 1
					  }
					}
					res.setHeader('Content-Length', len)
					res.setHeader('Accept-Ranges', 'bytes')
					res.setHeader('Content-type', this.mimes[ext] || 'text/plain' )
					res.setHeader('Access-Control-Allow-Origin', '*')
					res.setHeader('Access-Control-Allow-Methods', 'GET')
					res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Content-Length, Cache-Control, Accept, Authorization')
					res.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')
					res.setHeader('Content-Disposition', 'attachment; filename="' + name + '"');
					res.setHeader('Connection', 'close')
					res.setHeader('X-Debug', [start, end].join(','))
					if (req.method === 'HEAD') return res.end()
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
					stream.on('data', chunk => sent += chunk.length)
					stream.pipe(res)
					console.log('serve res started')
				})
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
	serve(file, triggerDownload, doImport){
        return new Promise((resolve, reject) => {	
			this.wake().then(() => {
				if(doImport){
					this.import(file).then(url => {
						console.log('serve imported', fs.readdirSync(this.folder))
						this.resetTimeout()
						console.log('serve serve', file, url)
						if(triggerDownload){						
							global.ui.emit('download', url, path.basename(url))
						}
						resolve(url)
					}).catch(reject)
				} else {
					let name = path.basename(file), url = 'http://' + this.opts.addr + ':' + this.opts.port + '/' + encodeURIComponent(name)
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
}

module.exports = Serve
