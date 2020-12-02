const Events = require('events'), fs = require('fs'), path = require('path'), MediaInfo = require('../streamer/utils/mediainfo.js')
const async = require('async'), ffmpeg = require('fluent-ffmpeg'), fschmod = require('fs-chmod')

class FFMPEGHelper extends Events {
	constructor(){
		super()
	}
	copy(source, callback){
		const chmod = () => {
			fs.access(this.path, fs.constants.X_OK, err => {
				if(err){
					// set ffmpeg +x permission
					fschmod.chmod(this.path, '+x').then(callback).catch(err => {
						console.error(err)
						callback()
					})
				} else {
					callback()
				}
			})
		}
		if(!source || source == this.path){
			return chmod()
		}
		let sizes = []
		async.eachOf([source, this.path], (file, i, done) => {
			fs.stat(file, (err, stat) => {
				if(err) { 
					console.error('File not found or accessible: '+ path)
					sizes[i] = -1
				} else {
					sizes[i] = stat.size
				}
				done()
			})
		}, () => {
			if(sizes[0] == sizes[1]){
				chmod()
			} else {
				fs.mkdir(path.dirname(this.path), (err) => {
					fs.copyFile(source, this.path, err => {
						if (err){
							console.error(err)
							this.path = source
						}
						chmod()
					})
				})
			}
		})
	}
	getAndroidArch(){
		switch(require('os').arch()){
			case 'arm':
				return 'armeabi-v7a'
				break
			case 'arm64':
				return 'arm64-v8a'
				break
			case 'ia32':
			case 'x32':
			case 'ppc':
				return 'x86'
				break
			/* TODO: SOMEONE CAN HELP HERE, HOW MUCH CRAZY ARCHS :O ... xD
			case 'mips'
			case 'mipsel'
			case 's390'
			case 's390x'
			case 'ppc64':
			*/
			case 'x64': 
			default:
				return 'x86_64'
		}
	}
	findFFmpegAndroid(callback){
		let sourceFile = path.resolve(path.join(global.APPDIR, './ffmpeg/ffmpeg'))
		fs.stat(sourceFile, (err, stat) => {
			if(stat){
				callback(sourceFile)
			} else {
				sourceFile = path.resolve(path.join(global.APPDIR, './ffmpeg/' + this.getAndroidArch() + '/ffmpeg'))
				fs.stat(sourceFile, (err, stat) => {
					if(stat){
						callback(sourceFile)
					} else {
						callback(false)
					}
				})
			}
		})
	}
}

class FFMPEG extends FFMPEGHelper {
	constructor(opts){
		super()
		this.isReady = false
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
		return ffmpeg.apply(ffmpeg, args)
	}
	prepare(){
		if(!this.isReady){
			const callback = () => {
				ffmpeg.setFfmpegPath(this.path)
				this.mediainfo.opts.ffmpegPath = this.path
				this.isReady = true
				this.emit('ready')
			}
			if(process.platform == 'win32'){	
				this.path = path.resolve(path.join(global.APPDIR, './ffmpeg/ffmpeg.exe'))
				return callback()
			} else {				
				this.path = global.paths['data'].replace(new RegExp('\\\\', 'g'), '/') + '/ffmpeg/ffmpeg'
				if(process.platform == 'android') {
					this.prepareAndroid(callback)
				} else {
					this.prepareLinux(callback)
				}
			}
		}
	}
	prepareAndroid(callback){
		fs.mkdir(path.dirname(this.path), {recursive: true}, err => {
			fs.stat(this.path, (err, stat) => {
				this.findFFmpegAndroid(file => {
					this.copy(file, callback)
				})
			})
		})
	}
	prepareLinux(callback){
		this.copy(file, callback)
	}
    version(cb){
        const next = data => {
            data = String(data)
            let m = data.match(new RegExp('ffmpeg version ([^ ]*)'))
            if(m && m.length > 1){
                cb(m[1])
            } else {
				cb(false)
			}
        }
        if(fs.existsSync(this.path)){
            this.mediainfo.version(next)
        } else {
            next('')
        }
    }
}

module.exports = FFMPEG
