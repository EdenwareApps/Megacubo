const Events = require('events'), fs = require('fs'), path = require('path'), MediaInfo = require('../streamer/utils/mediainfo.js')
const async = require('async'), ffmpeg = require('fluent-ffmpeg')

class FFMPEGHelper extends Events {
	constructor(){
		super()
		this.binaryBasename = 'ffmpeg'
		if(process.platform == 'win32'){
			this.binaryBasename += '.exe'
		}
		this.sourcePath = path.resolve(path.join(global.APPDIR, './ffmpeg/'+ this.binaryBasename))
		this.destPath = global.paths['data'].replace(new RegExp('\\\\', 'g'), '/') +'/ffmpeg/'+ this.binaryBasename
		this.minBinarySize = 10000000
	}
	fmtExecutableSlashes(path){
		if(['darwin'].includes(process.platform)){
			return path.replace(new RegExp(' ', 'g'), '\\ ')
		}
		return path
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
}

class FFMPEGDiagnostic extends FFMPEGHelper {
	constructor(){
		super()
		this.log = []
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
				let fa, text, def = 'ok'
				this.diagnostic().then(txt => {
					fa = 'fas fa-info-circle'
					text = txt
				}).catch(err => {
					fa = 'fas fa-exclamation-triangle faclr-red'
					text = String(err)
					def = 'download'
				}).finally(() => {
					global.ui.emit('dialog', [
						{template: 'question', text: global.lang.ABOUT +': FFmpeg', fa},
						{template: 'message', text},
						{template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
						{template: 'option', text: 'Download', id: 'download', fa: 'fas fa-download'},
						{template: 'option', text: global.lang.SAVE, id: 'savelog', fa: 'fas fa-save'}
					], 'dl-ffmpeg', def)
				})
			}
		})
	}
	diagnostic(){
		return new Promise((resolve, reject) => {
			this.arch(arch => {
				let files = [this.sourcePath, this.destPath], log = 'Arch: '+ arch +"\r\n"
				async.eachOf(files, (file, i, done) => {
					fs.stat(file, (err, stat) => {
						let type = 'File', exists = ''
						if(file == this.path){
							exists += 'ACTIVE, '
						}
						if(err || !stat){
							exists += 'NOT EXISTS'
						} else {
							exists += global.kbfmt(stat.size)
							if(stat.isDirectory()){
								type = 'Directory'
							}
						}
						log += type +': '+ file +' '+ exists +"\r\n"
						done()
					})
				}, () => {
					log += 'Active: '+ this.path +"\r\n"
					log += 'Log: '+ this.log.join(', ')
					resolve(log)
				})
			})
		})
	}
}

class FFMPEGDownload extends FFMPEGDiagnostic {
	constructor(){
		super()
		global.ui.on('dl-ffmpeg', ret => {
			console.warn("DL-FFMPEG", ret)
			switch(ret){
				case 'log':
					this.diagnosticDialog(true)
					break
				case 'savelog':
					this.saveLog()
					break
				case 'download':
					this.download(this.destPath).then(version => {
						console.log('download', this.destPath)
						this.path = this.destPath
						let text = "OK\r\n"+ this.path +"\r\n"+ version
						global.ui.emit('dialog', [
							{template: 'question', text: global.lang.ABOUT +': FFmpeg', fa: 'fas fa-check-circle faclr-green'},
							{template: 'message', text},
							{template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'}
						], 'dl-ffmpeg', 'ok')
					}).catch(err => {
						console.log('download', err)
						global.ui.emit('dialog', [
							{template: 'question', text: 'FFMPEG Download error', fa: 'fas fa-exclamation-triangle faclr-red'},
							{template: 'message', text: String(err)},
							{template: 'option', text: global.lang.RETRY, id: 'download', fa: 'fas fa-download'}
						], 'dl-ffmpeg', 'download')
					})
					break
			}
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
	download(target){
		return new Promise((resolve, reject) => {
			if(!['android', 'win32'].includes(process.platform)){
				return reject('download not available for '+ process.platform)
			}
			let size, headers, err = '', received = 0
			this.arch(arch => {
				const url = 'http://app.megacubo.net/dev/ffmpeg/' + arch +'/'+ this.binaryBasename
				console.log('download', target, url)
				fs.mkdir(path.dirname(target), {recursive: true}, err => {
					if(err){
						console.error(err)
					}
					if(global.osd) global.osd.show('Download FFmpeg: 0%', 'fa-mega spin-x-alt', 'ffmpeg-dl', 'persistent')
					const stream = fs.createWriteStream(target, {flags:'w'})
					console.log('download2', target)
					const download = new global.Download({
						url,
						keepalive: false,
						retries: 10,
						timeout: 60,
						followRedirect: false,
						headers: {
							'accept-encoding': 'identity'
						}
					})
					download.on('response', (c, h) => {
						headers = h
					})
					download.on('error', r => {
						err = r
					})
					download.on('data', chunk => {
						stream.write(chunk)
						received += chunk.length
					})
					download.on('progress', progress => {
						if(global.osd) global.osd.show('Download FFmpeg: '+ progress +'%', 'fa-mega spin-x-alt', 'ffmpeg-dl', 'persistent')
					})
					download.on('end', () => {
						console.log('download3', target, download)
						if(global.osd) global.osd.show('Download FFmpeg: '+ global.lang.TESTING, 'fa-mega spin-x-alt', 'ffmpeg-dl', 'persistent')
						stream.on('finish', () => {
							console.log('download3', target, headers)
							if(headers && typeof(headers['content-length']) != 'undefined'){
								let cl = parseInt(headers['content-length'])
								if(cl >= this.minBinarySize){
									size = cl
								}
							}
							console.log('download4', received, size, target)
							if(received > this.minBinarySize && (!size || received >= size)){		
								// on android, right after download, it returns "file in use" error
								// or: NODEJS-MOBILE: CANNOT LINK EXECUTABLE ... empty/missing DT_HASH/DT_GNU_HASH in ... (new hash type from the future?)
								// even with long retries, so we'll just not test it at all, for now...
								this.grantExecPerms(target, () => {
									this.checkBinaryIntegrity(target, true, () => { // check downloaded ffmpeg binary, but ignore the result due to the bugs mentioned above
										resolve(target)
										if(global.osd) global.osd.show('Download FFmpeg: OK', 'fas fa-check-circle faclr-green', 'ffmpeg-dl', 'normal')
									})
								})
							} else {
								err += ' #'+ download.statusCode + ' | ' + url
								reject(err)
								if(global.osd) global.osd.show('Download FFmpeg: '+ String(err), 'fas fa-exclamation-triangle faclr-red', 'ffmpeg-dl', 'normal')
							}
						})
						stream.end()
					})
				})
			})
		})
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

class FFMPEG extends FFMPEGDownload {
	constructor(opts){
		super()
		this.isReady = false
		this.runFromAppDataFolder = ['win32', 'android'].includes(process.platform)
		this.lastDiagnosticAlertTime = 0
		this.diagnosticAlertsInterval = 120 // secs
		this.mediainfo = new MediaInfo({})
		this.prepare()
	}
	ready(cb){
		if(this.isReady){
			cb()
		} else {
			this.on('ready', cb)
		}
	}
	create(...args){
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
	prepare(){
		if(!this.isReady){
			let log = [], allowDownload = false
			const callback = () => {
				ffmpeg.setFfmpegPath(this.path)
				this.log = log
				this.path = this.fmtExecutableSlashes(this.path)
				this.mediainfo.opts.ffmpegPath = this.path
				this.isReady = true
				this.emit('ready')
			}
			const fail = () => {
				log.push('failed.')
				let text = global.lang.INSTALL_CORRUPTED
                global.ui.emit('dialog', [
                    {template: 'question', text: global.lang.FFMPEG_NOT_FOUND, fa: 'fas fa-exclamation-triangle faclr-red'},
                    {template: 'message', text},
                    {template: 'option', text: 'OK', fa: 'fas fa-check-circle', id: 'ok'}
                ], 'dl-ffmpeg', 'ok')
				this.path = this.sourcePath
				callback()
			}
			const doDownload = () => {
				if(allowDownload){
					log.push('downloading...')
					this.download(this.destPath).then(() => {
						log.push('download succeeded')
						this.path = this.destPath
						callback()
					}).catch(err => { // download ffmpeg from server
						log.push(String(err))
						log.push('download failed')
						this.path = this.sourcePath
						callback()
					})
				} else {
					fail()
				}
			}
			fs.access(path.dirname(this.sourcePath), fs.constants.W_OK, err => {
				log.push('source path writing: '+ (err || 'FINE'))
			})
			this.checkBinaryIntegrity(this.sourcePath, true, (succeeded, output) => { // check installed ffmpeg binary
				if(succeeded){
					this.path = this.sourcePath
					log.push('installed ffmpeg found and has exec perms')
					callback()
					this.log = log
				} else {
					log.push('installed ffmpeg not found or has not exec perms')
					log.push(output)
					this.checkBinaryIntegrity(this.destPath, false, (succeeded, output) => { // check installed ffmpeg binary
						if(succeeded){
							log.push('already installed on appdata folder')
							this.path = this.destPath
							callback()
						} else {
							log.push('not installed yet on appdata folder')
							log.push(output)
							fs.mkdir(path.dirname(this.destPath), {recursive: true}, err => {
								if(err){
									log.push(String(err))
								}
								this.checkBinaryIntegrity(this.sourcePath, false, (succeeded, output) => { // check just the size of the ffmpeg from the app files, no testOutput here
									if(succeeded){
										log.push('has local file, copying...')
										fs.copyFile(this.sourcePath, this.destPath, err => { // copy ffmpeg from the app files
											if (err){
												log.push(String(err))
												log.push('copying failed')
												console.error(err)
												doDownload()
											} else {
												this.grantExecPerms(this.destPath, () => { // chmod x on the copied file
													this.checkBinaryIntegrity(this.destPath, true, (succeeded, output) => { // check the copied ffmpeg
														if(succeeded){
															this.path = this.destPath
															callback()
														} else {
															log.push(String(output))
															log.push('copied file is not valid')
															doDownload()
														}
													})
												})
											}
										})
									} else {
										log.push(String(output))
										log.push('no valid local file')
										doDownload()
									}
								})
							})
						}
					})
				}
			})
		}
	}
    version(cb, ffmpegPath){
		if(!ffmpegPath){
			ffmpegPath = this.path || this.destPath
		}
		this.grantExecPerms(ffmpegPath, () => {
			const next = data => {
				data = String(data)
				let m = data.match(new RegExp('ffmpeg version ([^ ]*)'))
				if(m && m.length > 1){
					cb(m[1], data)
				} else {
					cb(false, data)
				}
			}
			this.mediainfo.version(next, ffmpegPath)
		})
    }
}

module.exports = FFMPEG
