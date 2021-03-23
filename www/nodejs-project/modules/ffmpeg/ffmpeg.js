const Events = require('events'), fs = require('fs'), path = require('path'), async = require('async')

let FFmpegControllerUIDIterator = 1

class FFmpegController extends Events {
	constructor(input){
		super()
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
				'-loglevel', this.dest ? 'error' : 'info', // if logerror=(warning|error) it will not return the codec and bitrate data
				'-analyzeduration', 10000000, // 10s in microseconds
				'-probesize', 10485760,	// 10MB
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
		global.ui.emit('ffmpeg-exec', this.uid, cmdArr)
		this.emit('start', cmdArr.join(' '))
	}
	kill(){
		global.ui.emit('ffmpeg-kill', this.uid)
		this.options.input = this.options.output = []
		global.ui.removeAllListeners('ffmpeg-callback-'+ this.uid)
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
		this.debug = true
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
		this.exec(path, [], (error, output) => {
			cb(String(error || output))
		})
	}
}

class FFMPEGDiagnostic extends FFMPEGMediaInfo {
	constructor(){
		super()
		this.log = []
		global.ui.on('dl-ffmpeg', ret => {
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
        this.version((data, output) => {
			let text = this.encodeHTMLEntities(data || lang.FFMPEG_NOT_FOUND) +"<br />"+ this.executable
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
				let finish = () => {
					log += "\r\n" + this.log.join(', ')
					resolve(log)
				}
				if(process.platform == 'android'){
					finish()
				} else {
					fs.stat(this.executable, (err, stat) => {
						log += 'File: '+ this.executable +' '+ ((err || !stat) ? 'NOT EXISTS' : global.kbfmt(stat.size)) +"\r\n"
						finish()
					})
				}
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
		let ret = new FFmpegController(input)
		return ret
	}
	exec(input, cmd, cb){
		const child = this.create(input), timeout = setTimeout(() => {
			if(child){
				child.kill()
			}
			if(typeof(cb) == 'function'){
				cb('timeout', '')
			}
		}, 20000)
		child.outputOptions(cmd)
		child.on('end', data => {
			clearTimeout(timeout)
			cb(null, data)
		})
		child.on('error', err => {
			clearTimeout(timeout)
			cb(err)
		})
		child.run()
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
