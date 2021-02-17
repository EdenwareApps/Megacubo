const Events = require('events'), fs = require('fs'), path = require('path')
const async = require('async'), ffmpeg = require('fluent-ffmpeg')

class FFMPEGHelper extends Events {
	constructor(){
		super()
		this.debug = true
		this.binaryBasename = 'ffmpeg'
		if(process.platform == 'win32'){
			this.binaryBasename += '.exe'
		}
		this.tmpDir = path.join(global.paths['temp'], 'ffmpeg')
		this.path = path.resolve(path.join(global.APPDIR, './ffmpeg/'+ this.binaryBasename))
		this.minBinarySize = 10000000
	}
	grantExecPerms(file, callback){
		fs.access(file, fs.constants.X_OK, err => {
			if(err){
				// set ffmpeg +x permission
				let fschmod = require('fs-chmod')
				fschmod.chmod(file, '+x').then(() => {
					callback(null)
				}).catch(err => {
					console.error(err)
					callback(err)
				})
			} else {
				callback(null)
			}
		})
	}
	clockToSeconds(str) {
		let cs = str.split('.'), p = cs[0].split(':'), s = 0, m = 1
		while (p.length > 0) {
			s += m * parseInt(p.pop(), 10)
			m *= 60
		}    
		if(cs.length > 1 && cs[1].length >= 2){
			s += parseInt(cs[1].substr(0, 2)) / 100
		}
		return s
	}
	parseBytes(t, b){
		let n = parseFloat(t)
		switch(b){
			case "kb":
				n = n * 1024
				break
			case "mb":
				n = n * (1024 * 1024)
				break
		}
		return parseInt(n)
	}
	fmtSlashes(file){
		return file.replace(new RegExp("[\\\\/]+", "g"), "/")
	}
	fmtExecutableSlashes(path){
		if(['darwin'].includes(process.platform)){
			return path.replace(new RegExp(' ', 'g'), '\\ ')
		}
		return path
	}
}

class FFMPEGMediaInfo extends FFMPEGHelper {
	constructor(){
		super()
	}
	duration(nfo) {
		let dat = nfo.match(new RegExp(': +([0-9]{2}:[0-9]{2}:[0-9]{2})\\.[0-9]{2}'))
		console.log('duration', nfo, dat)
	    return dat ? this.clockToSeconds(dat[1]) : 0
	}
	codecs(nfo, raw) {
		let rp = raw === true ? ': ([^\r\n]+)' : ': ([^,\r\n]+)'
	    let video = nfo.match(new RegExp('Video' + rp)), audio = nfo.match(new RegExp('Audio' + rp)), unknown = nfo.match(new RegExp('Unknown' + rp))
	    video = Array.isArray(video) ? video[1] : (Array.isArray(unknown) ? 'unknown' : '')
		audio = Array.isArray(audio) ? audio[1] : ''
	    return {video, audio}
	}
	dimensions(nfo) {
	    let match = nfo.match(new RegExp('[0-9]{2,5}x[0-9]{2,5}'))
	    return match && match.length ? match[0] : ''
	}
	rawBitrate(nfo){
		// bitrate: 1108 kb/s
		let bitrate = 0, lines = nfo.match(new RegExp("Stream #[^\n]+", "g"))
		if(lines){
			lines.forEach(line => {
				let raw = line.match(new RegExp('([0-9]+) ([a-z]+)/s'))
				if (raw) {
					bitrate += this.parseBytes(raw[1], raw[2])
				}
			})
		}
		let raw = nfo.match(new RegExp("itrate: ([0-9]+) ([a-z]+)/s"))
		if(raw && raw.length){
			let n = this.parseBytes(raw[1], raw[2])
			if(!bitrate || n > bitrate){
				bitrate = n
			}
		}
		return bitrate ? bitrate : false
	}
	getFileDuration(file, cb){
		let next = () => {
			this.info(file, nfo => {
				if(nfo){
					// console.log('mediainfo', nfo)
					let duration = this.duration(nfo)
					if(isNaN(duration)){
						console.error('duration() failure', nfo, duration)
						cb('duration check failure', 0)
					} else {
						cb(null, duration)
					}
				} else {
					cb('FFmpeg unable to process ' + file + ' ' + JSON.stringify(nfo), 0)
				}
			})
		}
		if(length){
			next()
		} else {
			fs.stat(file, (err, stat) => {
				if(err) { 
					cb('File not found or empty.', 0)
				} else {
					next()
				}
			})
		}
	}
	bitrate(file, cb, length){
		let next = () => {
			this.info(file, nfo => {
				if(nfo){
					// console.log('mediainfo', nfo)
					let codecs = this.codecs(nfo), rate = this.rawBitrate(nfo), dimensions = this.dimensions(nfo)
					if(!rate){
						rate = parseInt(length / this.duration(nfo))
					}
					if(isNaN(rate)){
						console.error('bitrate() failure', nfo, global.kbfmt(length))
						cb('bitrate check failure', null, codecs, dimensions)
					} else {
						cb(null, rate, codecs, dimensions)
					}
				} else {
					cb('FFmpeg unable to process ' + file + ' ' + JSON.stringify(nfo), 0)
				}
			})
		}
		if(length){
			next()
		} else {
			fs.stat(file, (err, stat) => {
				if(err) { 
					cb('File not found or empty.', 0, false)
				} else {
					length = stat.size
					next()
				}
			})
		}
	}
	info(path, cb){
		this.exec(this.path +' -i "'+ this.fmtSlashes(path) +'"', (error, output) => {
			cb(String(error || output))
		})
	}
}

class FFMPEGDiagnostic extends FFMPEGMediaInfo {
	constructor(){
		super()
		this.log = []
		global.ui.on('dl-ffmpeg', ret => {
			console.warn("DL-FFMPEG", ret)
			switch(ret){
				case 'log':
					this.diagnosticDialog(true)
					break
				case 'savelog':
					this.saveLog()
					break
			}
		})
	}
    encodeHTMLEntities(str){
        return str.replace(/[\u00A0-\u9999<>&](?!#)/gim, (i) => {
          return '&#' + i.charCodeAt(0) + ';'
        })
	}
	saveLog(){		
		const filename = 'megacubo-ffmpeg-log.txt', file = global.serve.folder + path.sep + filename
		fs.writeFile(file, this.log.join("\r\n"), {encoding: 'utf-8'}, err => {
			global.serve.serve(file, true, false).catch(global.displayErr)
		})
	}
	diagnosticDialog(forceLog){
        global.ffmpeg.version((data, output) => {
            console.warn('FFMPEG INFO', data)
			let text = this.encodeHTMLEntities(data || lang.FFMPEG_NOT_FOUND) +"<br />"+ global.ffmpeg.path
            if(data && forceLog !== true){
                global.ui.emit('dialog', [
                    {template: 'question', text: data ? lang.FFMPEG_VERSION : lang.FFMPEG_NOT_FOUND, fa: 'fas fa-info-circle'},
                    {template: 'message', text},
                    {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'},
					{template: 'option', text: 'Log', fa: 'fas fa-clipboard', id: 'log'}
                ], 'dl-ffmpeg', 'ok')
            } else {
				let fa, text
				this.diagnostic().then(txt => {
					fa = 'fas fa-info-circle'
					text = txt
				}).catch(err => {
					fa = 'fas fa-exclamation-triangle faclr-red'
					text = String(err)
				}).finally(() => {
					global.ui.emit('dialog', [
						{template: 'question', text: global.lang.ABOUT +': FFmpeg', fa},
						{template: 'message', text},
						{template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
						{template: 'option', text: global.lang.SAVE, id: 'savelog', fa: 'fas fa-save'}
					], 'dl-ffmpeg', 'ok')
				})
			}
		})
	}
	diagnostic(){
		return new Promise((resolve, reject) => {
			this.arch(arch => {
				let log = 'Arch: '+ arch +"\r\n"
				fs.stat(this.path, (err, stat) => {
					log += 'File: '+ this.path +' '+ ((err || !stat) ? 'NOT EXISTS' : global.kbfmt(stat.size)) +"\r\n"
					log += "\r\n" + this.log.join(', ')
					resolve(log)
				})
			})
		})
	}
	_arch(){
		if(process.platform == 'win32'){
			return 'win'+ (process.arch == 'x64' ? 64 : 32)
		} else {
			switch(process.arch){
				case 'arm64':
					return 'arm64-v8a'
					break
				case 'arm':
					return 'armeabi-v7a'
					break
				case 'x64': 
					return 'x86_64'
					break
				case 'ia32':
				case 'x32':
				default:
					return 'x86'
			}
		}
	}
	arch(cb){
		if(process.platform == 'android'){
			let archHintFile = global.APPDIR + '/arch.dat'
			fs.stat(archHintFile, (err, stat) => {
				console.error('ARCHHINTFILE*'+(err ? String(err) : stat.size))
				if(stat && stat.size){
					console.error('ARCHHINTFILE READING')
					fs.readFile(archHintFile, (err, ret) => {
						console.error('ARCHHINTFILE '+ret)
						if(ret){
							cb(String(ret).trim())
						} else {
							cb(this._arch())
						}
					})
				} else {
					console.error('ARCHHINTFILE FAIL')
					cb(this._arch())
				}
			})
		} else {
			cb(this._arch())
		}
	}
	checkBinaryIntegrity(file, testOutput, cb){
		fs.stat(file, (err, stat) => {
			if(stat && stat.size && stat.size > this.minBinarySize){
				if(testOutput){
					this.version((version, output) => {
						cb(!!version, output)
					}, file)
				} else {
					cb(true)
				}
			} else {
				cb(false)
			}
		})
	}
}

class FFMPEG extends FFMPEGDiagnostic {
	constructor(){
		super()
		this.isReady = false
		this.runFromAppDataFolder = ['win32', 'android'].includes(process.platform)
		this.lastDiagnosticAlertTime = 0
		this.diagnosticAlertsInterval = 120 // secs
	}
	ready(cb){
		if(this.isReady){
			cb()
		} else {
			this.on('ready', cb)
		}
	}
	create(...args){
		if(typeof(args['cwd']) == 'undefined'){
			args['cwd'] = this.tmpDir
		}
		const proc = ffmpeg.apply(ffmpeg, args)
		proc.on('stderr', (stderrLine) => {
			let now = global.time()
			if((now - this.lastDiagnosticAlertTime) > this.diagnosticAlertsInterval){
				if(stderrLine.indexOf('Out of memory') != -1){
					global.diagnostics.checkMemoryUI().catch(console.error)
				} else if(stderrLine.indexOf('No space left on device') != -1) {
					global.diagnostics.checkDiskUI().catch(console.error)
				}
			}
		})
		return proc
	}
	exec(cmd, cb, ffmpegPath){
		if(!ffmpegPath){
			ffmpegPath = this.path
		}
		if(!this._exec){
			this._exec = require('child_process').exec
		}		
		let child, timeout = setTimeout(() => {
			if(child){
				child.kill()
			}
			if(typeof(cb) == 'function'){
				cb('timeout', '')
			}
		}, 20000)
		child = this._exec(cmd, {
			windowsHide: true, 
			shell: true,
			cwd: this.tmpDir
		}, (error, stdout, stderr) => {
			clearTimeout(timeout)
			if(typeof(cb) == 'function'){
				if(error || stderr){
					cb(error || stderr, stdout)
				} else {
					cb(null, stdout)
				}
				cb = null
			}
		})
	}
	init(){
		if(!this.isReady){
			let log = []
			const callback = () => {
				ffmpeg.setFfmpegPath(this.path)
				this.log = log
				this.path = this.fmtExecutableSlashes(this.path)
				this.isReady = true
				this.emit('ready')
			}
			const fail = () => {
				log.push('failed.')
				global.ui.emit('dialog', [
                    {template: 'question', text: global.lang.FFMPEG_NOT_FOUND, fa: 'fas fa-exclamation-triangle faclr-red'},
                    {template: 'message', text: global.lang.INSTALL_CORRUPTED},
                    {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'}
                ], 'dl-ffmpeg', 'ok')
				callback()
			}
			const tests = cb => {					
				fs.access(path.dirname(this.path), fs.constants.W_OK, err => {
					log.push('ffmpeg path writing: '+ (err || 'FINE'))					
					fs.access(path.dirname(this.path), fs.constants.X_OK, err => {
						log.push('ffmpeg path executing: '+ (err || 'FINE'))				
						fs.access(this.path, fs.constants.X_OK, err => {
							log.push('ffmpeg executing: '+ (err || 'FINE'))
							fs.stat(this.path, (err, stat) => {
								log.push(err || JSON.stringify(stat, null, 3))
								cb()
							})
						})
					})
				})
			}
			this.checkBinaryIntegrity(this.path, true, (succeeded, output) => { // check installed ffmpeg binary
				if(succeeded){
					log.push('installed ffmpeg found and has exec perms')
					callback()
					this.log = log
				} else {
					log.push('installed ffmpeg not found or has not exec perms')
					log.push(output)
					tests(() => {
						fail()
					})
				}
			})
			fs.mkdir(this.tmpDir, {recursive: true}, err => { if(err) console.error(err) })
		}
	}
    version(cb, ffmpegPath){
		if(!ffmpegPath){
			ffmpegPath = this.path
		}
		this.grantExecPerms(ffmpegPath, () => {
			this.exec(ffmpegPath +' -version', (error, output) => {
				let data = String(error || output)
				let m = data.match(new RegExp('ffmpeg version ([^ ]*)'))
				if(m && m.length > 1){
					cb(m[1], data)
				} else {
					cb(false, data)
				}
			})
		})
    }
}

module.exports = FFMPEG
