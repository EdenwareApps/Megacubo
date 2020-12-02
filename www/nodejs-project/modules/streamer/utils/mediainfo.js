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
	    let dat = nfo.match(new RegExp('[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{2}'))
	    return dat ? this.clockToSeconds(dat[0]) : 0
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
	info(path, callback){
		let cb = ret => {
			if(this.opts.debug){
				this.opts.debug('MediaInfo.info() ', ret)
			}
			if(typeof(callback) == 'function'){
				callback(String(ret))
				callback = null
			}
		}
		if(!this.exec){
			this.exec = require('child_process').exec
		}
		let child, data = '', timeout = setTimeout(() => {
			if(child){
				child.kill()
			}
			if(typeof(callback) == 'function'){
				cb('timeout')
			}
		}, 20000)
		child = this.exec(this.opts.ffmpegPath +' -i "'+ this.fmtSlashes(path) +'"', {
			windowsHide: true, 
			shell: true
		}, (error, stdout, stderr) => {
			clearTimeout(timeout)
			if(error || stderr){
				cb(error || stderr)
			} else {
				cb(stdout)
			}
		})
	}
	version(callback){
		let cb = ret => {
			if(this.opts.debug){
				this.opts.debug('MediaInfo.version() ', ret)
			}
			if(typeof(callback) == 'function'){
				callback(String(ret))
				callback = null
			}
		}
		if(!this.exec){
			this.exec = require('child_process').exec
		}
		let child, data = '', timeout = setTimeout(() => {
			if(child){
				child.kill()
			}
			if(typeof(callback) == 'function'){
				cb('timeout')
			}
		}, 20000)
		child = this.exec(this.opts.ffmpegPath +' -version', {
			windowsHide: true,
			shell: true
		}, (error, stdout, stderr) => {
			if(error || stderr){
				cb(error || stderr)
			} else {
				cb(stdout)
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
	fmtSlashes(file){
		return file.replace(new RegExp("[\\\\/]+", "g"), "/")
	}
}

module.exports = MediaInfo
