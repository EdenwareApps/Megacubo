const Events = require('events'), fs = require('fs'), path = require('path')

let FFmpegControllerUIDIterator = 1

class FFmpegController extends Events {
	constructor(input, master){
		super()
		this.master = master
		this.input = input
		this.options = {
			input: [],
			output: []
		}
		this.uid = FFmpegControllerUIDIterator
		FFmpegControllerUIDIterator++
	}
    cmdArr(){
		let cmd = []
		this.options.input.forEach(a => cmd = cmd.concat(a))
		if(this.input){ 
			// add these input options only if we have an input, not in -version, per example
			cmd = cmd.concat([
				'-loglevel', 'info', // if logerror=(warning|error) it will not return the codec and bitrate data
				// '-analyzeduration', 10000000, // 10s in microseconds
				// '-probesize', 10485760,	// 10MB
				'-err_detect', 'ignore_err',
				'-i', this.input
			])
		}
		this.options.output.forEach(a => cmd = cmd.concat(a))
		if(this.dest){
			cmd = cmd.concat(['-strict', 'experimental']) // cmd = cmd.concat(['-strict', '-2'])
			cmd = cmd.concat(['-max_muxing_queue_size', 2048]) // https://stackoverflow.com/questions/49686244/ffmpeg-too-many-packets-buffered-for-output-stream-01	
			cmd.push(this.dest.replace(new RegExp('\\\\', 'g'), '/'))
		}
		return cmd
    }
	adjustOptions(k, v){
		if(Array.isArray(k)){
			return k
		}
		if(typeof(v) == 'number'){
			v = String(v)
		}
		if(typeof(v) != 'string'){
			if(typeof(k) != 'string'){
				console.error('BADTYPE: '+ typeof(k) +' '+ k)
			}
			return k.split(' ')
		}
		return [k, v]
	}
	inputOptions(k, v){
		this.options.input.push(this.adjustOptions(k, v))
		return this
	}
	outputOptions(k, v){
		this.options.output.push(this.adjustOptions(k, v))
		return this
	}
	format(fmt){
		this.outputOptions('-f', fmt)
		return this
	}
	audioCodec(codec){
		this.outputOptions('-acodec', codec)
		return this
	}
	videoCodec(codec){
		this.outputOptions('-vcodec', codec)
		return this
	}
	output(dest){
		this.dest = dest
		return this
	}
	run(){
		let cmdArr = this.cmdArr()
		global.ui.on('ffmpeg-callback-'+ this.uid, this.callback.bind(this))
		global.ui.on('ffmpeg-metadata-'+ this.uid, this.metadataCallback.bind(this))
		global.ui.emit('ffmpeg-exec', this.uid, cmdArr)
		this.emit('start', cmdArr.join(' '))
	}
	kill(){
		global.ui.emit('ffmpeg-kill', this.uid)
		this.options.input = this.options.output = []
		global.ui.removeAllListeners('ffmpeg-callback-'+ this.uid)
		global.ui.removeAllListeners('ffmpeg-metadata-'+ this.uid)
	}
	metadataCallback(nfo){
		let codecs = this.master.codecs(nfo), dimensions = this.master.dimensions(nfo)
		if(codecs) this.emit('codecData', codecs)
		if(dimensions) this.emit('dimensions', dimensions)
	}
	callback(err, output){
		//console.log('ffmpeg.callback '+ this.uid +', '+ err +', '+ output)
		if(err){
			this.emit('error', err)
		} else {
			this.emit('end', output)
		}
	}
}

class FFMPEGHelper extends Events {
	constructor(){
		super()
		this.debug = false
		this.executable = require('path').resolve('ffmpeg/ffmpeg')
		if(process.platform == 'win32'){
			this.executable += '.exe'
		}
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
}

class FFMPEGMediaInfo extends FFMPEGHelper {
	constructor(){
		super()
	}
	duration(nfo) {
		let dat = nfo.match(new RegExp(': +([0-9]{2}:[0-9]{2}:[0-9]{2})\\.[0-9]{2}'))
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
					let codecs = this.codecs(nfo), rate = this.rawBitrate(nfo), dimensions = this.dimensions(nfo)
					if(!rate && length){
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
		if(length || !this.isLocal(file)){
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
	isLocal(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	info(path, cb){
		this.exec(path, [], (error, output) => {
			cb(String(error || output))
		})
	}
}

class FFMPEGDiagnostic extends FFMPEGMediaInfo {
	constructor(){
		super()
		global.ui.on('dl-ffmpeg', ret => {
			switch(ret){
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
		let text = ''
		this.diagnostic().then(txt => {
			text = txt
		}).catch(err => {
			text = String(err)
		}).finally(() => {
			const filename = 'megacubo-ffmpeg-log.txt', file = global.downloads.folder + path.sep + filename
			fs.writeFile(file, text, {encoding: 'utf-8'}, err => {
				global.downloads.serve(file, true, false).catch(global.displayErr)
			})
		})	
	}
	diagnosticDialog(){
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
				{template: 'message', text: this.encodeHTMLEntities(text)},
				{template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
				{template: 'option', text: global.lang.SAVE, id: 'savelog', fa: 'fas fa-save'}
			], 'dl-ffmpeg', 'ok')
		})
	}
	diagnostic(){
		return new Promise((resolve, reject) => {
			if(this.log){
				return resolve(this.log)
			}
			this.arch(arch => {
				this.version((data, output) => {
					const nl = "\r\n"
					this.log = (data || lang.FFMPEG_NOT_FOUND) + nl
					this.log += 'Arch: '+ arch + nl
					let finish = () => {
						resolve(this.log)
					}
					if(process.platform == 'android'){
						finish()
					} else {
						fs.stat(this.executable, (err, stat) => {
							this.log += 'File: '+ this.executable +' '+ ((err || !stat) ? 'NOT EXISTS' : global.kbfmt(stat.size)) + nl
							finish()
						})
					}
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
				if(stat && stat.size){
					fs.readFile(archHintFile, (err, ret) => {
						if(ret){
							cb(String(ret).trim())
						} else {
							cb(this._arch())
						}
					})
				} else {
					cb(this._arch())
				}
			})
		} else {
			cb(this._arch())
		}
	}
}

class FFMPEG extends FFMPEGDiagnostic {
	constructor(){
		super()
	}
	create(input){
		let ret = new FFmpegController(input, this)
		return ret
	}
	exec(input, cmd, cb){
		const proc = this.create(input), timeout = setTimeout(() => {
			if(proc){
				proc.kill()
			}
			if(typeof(cb) == 'function'){
				cb('timeout', '')
				cb = null
			}
		}, 30000)
		proc.outputOptions(cmd)
		proc.once('end', data => {
			clearTimeout(timeout)
			if(typeof(cb) == 'function'){
				cb(null, data)
				cb = null
			}
		})
		proc.on('error', err => {
			clearTimeout(timeout)
			if(typeof(cb) == 'function'){
				cb(err)
				cb = null
			}
		})
		proc.run()
	}
    version(cb){
		this.exec('', ['-version'], (error, output) => {
			let data = String(error || output)
			let m = data.match(new RegExp('ffmpeg version ([^ ]*)'))
			if(m && m.length > 1){
				cb(m[1], data)
			} else {
				cb(false, data)
			}
		})
    }
}

module.exports = FFMPEG
