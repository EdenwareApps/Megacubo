const fs = require('fs'), path = require('path')

class MediaInfo {
	constructor(opts){
		this.opts = {
			debug: false,
			ffmpegPath: ''
		}
		if(opts){
			Object.keys(opts).forEach(k => {
				this.opts[k] = opts[k]
			})
		}
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
	exec(cmd, cb){
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
			shell: true
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
	info(path, cb){
		this.exec(this.opts.ffmpegPath +' -i "'+ this.fmtSlashes(path) +'"', (error, output) => {
			cb(String(error || output))
		})
	}
	version(cb, ffmpegPath){
		if(!ffmpegPath){
			ffmpegPath = this.opts.ffmpegPath
		}
		this.exec(ffmpegPath +' -version', (error, output) => {
			cb(String(error || output))
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
	fmtSlashes(file){
		return file.replace(new RegExp("[\\\\/]+", "g"), "/")
	}
}

module.exports = MediaInfo
