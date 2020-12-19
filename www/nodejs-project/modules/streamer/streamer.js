
const path = require('path'), Events = require('events'), fs = require('fs'), async = require('async')
const AutoTuner = require('../tuner/auto-tuner')

class StreamerTools extends Events {
    constructor(){
        super()
    }
    setOpts(opts){
        if(opts && typeof(opts) == 'object'){     
            Object.keys(opts).forEach((k) => {
                if(['debug'].indexOf(k) == -1 && typeof(opts[k]) == 'function'){
                    this.on(k, opts[k])
                } else {
                    this.opts[k] = opts[k]
                }
            })
        }
    }
	isEntry(e){
		return typeof(e) == 'object' && e && typeof(e.url) == 'string'
	}
    time(){
        return ((new Date()).getTime() / 1000)
    }
	validate(value) {
		let v = value.toLowerCase()
		if(v.substr(0, 7) == 'magnet:'){
			return true
		}
		let prt = v.substr(0, 4), pos = v.indexOf('://')
		if(['http', 'rtmp', 'rtsp'].includes(prt) && pos >= 4 && pos <= 6){
			return true // /^(?:(?:(?:https?|rt[ms]p[a-z]?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
		}
	}
    absolutize(path, url){
        if(path.match(new RegExp('^[htps:]?//'))){
            return path
        }
        let uri = new URL(path, url)
        return uri.href
    }
	isBin(buf){
		if(!buf) {
			return false
		}
		let sepsLimitPercentage = 5, seps = [' ', '<', '>', ',']
		let sample = String(Buffer.concat([buf.slice(0, 64), buf.slice(buf.length - 64)]).toString('binary')), len = this.len(sample)
		let isAscii = sample.match(new RegExp('^[ -~\t\n\r]+$')) // sample.match(new RegExp('^[\x00-\x7F]*[A-Za-z0-9]{3,}[\x00-\x7F]*$'))
		if(isAscii){
			let sepsLen = sample.split('').filter(c => seps.includes(c)).length
			if(sepsLen < (len / (100 / sepsLimitPercentage))){ // separators chars are less then x% of the string
				isAscii = false
			}
		}
		return !isAscii
	}
	_probe(url, timeoutSecs, retries = 0){
		return new Promise((resolve, reject) => {
			let headers = {}, status = 0, sample = [], start = this.time(), timer = 0, currentURL = url
			if(this.validate(url)){
				if(typeof(timeoutSecs) != 'number'){
					timeoutSecs = 10
				}
                const req = {
                    url,
                    followRedirect: true,
                    keepalive: false,
                    retries,
                    headers: {
						'accept-encoding': 'identity' // https://github.com/sindresorhus/got/issues/145
					}
                }
                let download = new global.Download(req), ended = false, sampleSize = 1024, abort = () => {
					if(this.opts.debug){
						this.opts.debug('abort', r)
					}
					clearTimeout(timer)
					if(download){
						download.destroy()		
						download = null			
					}
				}, finish = () => {
					if(this.opts.debug){
						this.opts.debug('finish', ended, sample, headers, traceback())
					}
					if(!ended){
						ended = true
						clearTimeout(timer)
						if(download){
							download.destroy()
						}
						sample = Buffer.concat(sample)
						const ping = this.time() - start
						const received = JSON.stringify(headers).length + this.len(sample)
						const speed = received / ping
						const ret = {status, headers, sample, ping, speed, url, finalUrl: download.currentURL}
						console.log('data', ping, received, speed, ret)
						resolve(ret)
					}
				}
				if(this.opts.debug){
					this.opts.debug(url, timeoutSecs)
				} 
				download.on('error', err => {
					console.warn(url, err)
				})
				download.on('data', chunk => {
					if(typeof(chunk) == 'string'){
						chunk = Buffer.from(chunk)
					}
					sample.push(chunk)
					if(this.len(sample) >= sampleSize){
						console.log('sample', sample, sampleSize)
						finish()
					}
				})
				download.on('response', (statusCode, responseHeaders) => {
					if(this.opts.debug){
						this.opts.debug(url, statusCode, responseHeaders)
					}
					headers = responseHeaders
					status = statusCode
				})
				download.on('end', finish)
				if(this.opts.debug){
					this.opts.debug(url, timeoutSecs)
				}
				timer = setTimeout(() => finish(), timeoutSecs * 1000)
			} else {
                reject('invalid url')
			}
		})
	}
	probe(url, retries = 2){
		return new Promise((resolve, reject) => {
			const timeout = 10
			if(this.proto(url, 4) == 'http'){
				this._probe(url, timeout, retries).then(ret => { 
					//console.warn('PROBED', ret)
					let delay = 2000, cl = ret.headers['content-length'] || -1, ct = ret.headers['content-type'] || '', st = ret.status || 0
					if(st < 200 || st >= 400){
						reject('Failed to connect, error: ' + st)
					} else {
						if(ct){
							ct = ct.split(',')[0].split(';')[0]
						} else {
							ct = ''
						}
						if((!ct || ct.substr(0, 5) == 'text/') && ret.sample){							
							if(String(ret.sample).match(new RegExp('#EXT(M3U|INF)', 'i'))){
								ct = 'application/x-mpegURL'
							}
							if(this.isBin(ret.sample)){
								if(global.lists.msi.isVideo(url)){
									ct = 'video/mp4'
								} else {
									ct = 'video/MP2T'
								}
							}
						}
						if(ct.substr(0, 4) == 'text'){
							reject('Bad content type: ' + ct)
						} else {
							ret.status = st
							ret.contentType = ct.toLowerCase()
							ret.contentLength = cl
							if(!ret.finalUrl){
								ret.finalUrl = ret.url
							}
							ret.ext = this.ext(ret.finalUrl) || this.ext(url)
							resolve(ret)
						}
					}
				}).catch(err => {
					reject(err)
				})
			} else if(this.validate(url)) { // maybe rtmp
				let ret = {}
				ret.status = 200
				ret.contentType = ''
				ret.contentLength = 999999
				ret.url = url
				ret.finalUrl = url
				ret.ext = this.ext(url)
				resolve(ret)
			} else {
				reject('invalid url')
			}
		})
	}
	info(url, retries = 2){
		return new Promise((resolve, reject) => {
			this.probe(url, retries).then(nfo => {
				let type = false
				Object.keys(this.engines).some(name => {
					if(this.engines[name].supports(nfo)){
						type = name
						return true
					}
				})
				if(type){
					nfo.type = type
					resolve(nfo)
				} else {
					reject('unsupported stream type')
				}
			}).catch(reject)
		})
	}
	proto(url, len){
		var ret = '', res = url.split(':')
		if(res.length > 1 && res[0].length >= 3 && res[0].length <= 6){
			ret = res[0]
		} else if(url.match(new RegExp('^//[^/]+\\.'))){
			ret = 'http'
		}
		if(ret && typeof(len) == 'number'){
			ret = ret.substr(0, len)
		}
		return ret
	}
    ext(file){
		let basename = String(file).split('?')[0].split('#')[0].split('/').pop()
		basename = basename.split('.')
		if(basename.length > 1){
			return basename.pop().toLowerCase()
		} else {
			return ''
		}
    }
	len(data){
		if(!data){
			return 0
		} else if(Array.isArray(data)) {
			let len = 0
			data.forEach(d => {
				len += this.len(d)
			})
			return len
		} else if(typeof(data.byteLength) != 'undefined') {
			return data.byteLength
		} else {
			return data.length
		}
	}
}

class StreamerBase extends StreamerTools {
	constructor(opts){
		super(opts)
        this.opts = {
			workDir: global.paths['data'] +'/ffmpeg/data',
			shadow: false,
			debug: false,
			osd: false
		}
        this.engines = {
            aac: require('./engines/aac'),
            hls: require('./engines/hls'),
            rtmp: require('./engines/rtmp'),
            ts: require('./engines/ts'),
            video: require('./engines/video'),
            vodhls: require('./engines/vodhls'),
            magnet: require('./engines/magnet')
		}
		this.loadingIntents = []
		this.setOpts(opts)
	}
	registerLoadingIntent(intent){
		this.loadingIntents.push(intent)
	}
	unregisterLoadingIntent(intent, keep){
		if(!keep){
			intent.cancel = true
		}
		let i = this.loadingIntents.indexOf(intent)
		if(i != -1){
			delete this.loadingIntents[i]
			this.loadingIntents = this.loadingIntents.filter(n => {
				return !!n
			}).slice(0)
		}
	}
	unregisterAllLoadingIntents(){
		this.loadingIntents.forEach((intent, i) => {
			this.loadingIntents[i].cancel = true
		})
		this.loadingIntents = []
	}
    intent(data, opts, aside){ // create intent
        return new Promise((resolve, reject) => {
			if(!this.throttle(data.url)){
				return reject('401')
			}
            this.info(data.url, opts).then(nfo => {
				this.intentFromInfo(data, opts, aside, nfo).then(resolve).catch(reject)
            }).catch(err => {
				if(this.opts.debug){
					this.opts.debug('ERR', err)
				}
				if(String(err).match(new RegExp("(: 401|^401$)"))){
					this.forbid(data.url)
				}
                reject(err)
            })
        })
	}
	intentFromInfo(data, opts, aside, nfo){
        return new Promise((resolve, reject) => {
			opts = Object.assign(Object.assign({}, this.opts), opts || {})
			let intent = new this.engines[nfo.type](data, opts, nfo)
			if(aside){
				resolve(intent)
			} else {
				this.unregisterAllLoadingIntents()
				this.registerLoadingIntent(intent)
				if(this.opts.debug){
					this.opts.debug('RUN', intent, opts)
				}
				intent.start().then(() => {
					this.unregisterLoadingIntent(intent, true)
					if(intent.cancel){
						if(this.opts.debug){
							this.opts.debug('CANCEL')
						}
						intent.destroy()
						reject('cancelled by user')
					} else {
						if(this.opts.debug){
							this.opts.debug('COMMIT', intent)
						}
						this.commit(intent)
						resolve(intent)
					}
				}).catch(err => {
					if(!this.opts.shadow){
						global.osd.hide('streamer')
					}
					this.unregisterLoadingIntent(intent)
					if(this.opts.debug){
						this.opts.debug('ERR', err)
					}
					intent.destroy()
					reject(err)
				})
			}
		})
	}
	commit(intent){
		if(intent && this.active != intent){
			if(this.opts.debug){
				this.opts.debug('COMMITTING', global.traceback())
			}
			if(intent.destroyed){
				console.error('COMMITTING DESTROYED INTENT', global.traceback(), intent)
				return
			}
			if(this.opts.debug){
				this.opts.debug('INTENT SWITCHED !!', this.active ? this.active.data : false, intent ? intent.data : false, intent.destroyed, global.traceback())
				if(!intent.opts.debug){
					intent.opts.debug = this.opts.debug
				}
			}
			this.unload()
			this.active = intent // keep referring below as intent to avoid confusion on changing intents, specially inside events
			this.lastActiveData = this.active.data
			intent.committed = true
			intent.on('destroy', () => {
				if(intent == this.active){
					if(this.opts.debug){
						this.opts.debug('ACTIVE INTENT UNCOMMITTED & DESTROYED!!', intent, this.active)
					}
					this.stop()
				}
				if(this.opts.debug){
					this.opts.debug('INTENT UNCOMMITTED & DESTROYED!!', intent)
				}
			})
			intent.on('fail', err => {
				if(this.opts.debug){
					this.opts.debug('INTENT FAILED !!')
				}
				this.handleFailure(intent.data, err)
			})
			if(!global.cordova){ // only desktop version can't play hevc
				intent.on('codecData', codecData => {
					if(codecData && codecData.video.indexOf('hevc') != -1 && intent == this.active){
						if(global.config.get('allow-transcoding')){
							if(intent.type == 'ts' || intent.type == 'hls'){
								if(!intent.transcoder){
									console.warn('HEVC transcoding started')
									global.ui.emit('streamer-connect-suspend')
									intent.transcode().then(() => {
										this.emit('streamer-connect', intent.endpoint, intent.mimetype, intent.data)
									}).catch(err => {
										console.error(err)
										intent.fail('unsupported format')
									})
								}
								return
							}
						}
						console.error('unsupported format', codecData)
						intent.fail('unsupported format') // we can transcode .ts segments, but transcode a mp4 video would cause request ranging errors
					}
				})
				if(intent.codecData){
					intent.emit('codecData', intent.codecData)
				}
			}
			this.emit('commit', intent)
			intent.emit('commit')
			let data = intent.data
			data.engine = intent.type == 'video' ? 'mp4' : intent.type
			if(this.opts.debug){
				this.opts.debug('VIDEOINTENT2', intent.endpoint, intent.mimetype, data, intent.opts, intent.info)
			}
			this.emit('streamer-connect', intent.endpoint, intent.mimetype, data)
			if(!this.opts.shadow){
				global.osd.hide('streamer')
			}
			return true
		}
	}
	pause(){
		if(this.active){
            if(!this.opts.shadow){
				global.ui.emit('pause')
			}
		}
	}
	stop(err){
		if(!this.opts.shadow){
			global.osd.hide('streamer')
		}
		this.unregisterAllLoadingIntents()
		if(this.active){
			let data = this.active.data
            this.emit('streamer-disconnect', err)
            this.active.destroy()
			this.active = null
			this.emit('stop', err, data)
		}
	}
	share(){
		if(this.active && !this.opts.shadow){
			global.ui.emit('share', global.ucWords(global.MANIFEST.name), this.active.data.name, 'https://megacubo.tv/assistir/' + encodeURIComponent(this.active.data.name))
		}
	}
    unload(){
        if(this.active){
            this.active.emit('uncommit')
            this.emit('uncommit', this.active)
            this.stop()
        }
    }
}

class StreamerSpeedo extends StreamerBase {
	constructor(opts){
		super(opts)
		this.speedoTimer = 0
		this.speedoClientSpeed = 0
		if(!this.opts.shadow){
			global.ui.on('speedo-start', this.startSpeedo.bind(this))
			global.ui.on('speedo-end', this.endSpeedo.bind(this))
		}
	}
	startSpeedo(clientSpeed){
		if(this.opts.shadow){
			return
		}
		if(clientSpeed){
			this.speedoClientSpeed = clientSpeed
		}
		if(!this.speedoTimer && this.active){
			this.speedoTimer = global.setInterval(this.updateSpeedo.bind(this), 1000)
		}
	}
	endSpeedo(){
		if(this.opts.shadow){
			return
		}
		if(this.speedoTimer){
			clearInterval(this.speedoTimer)
			this.speedoTimer = 0
		}
	}
	updateSpeedo(){
		if(this.opts.shadow){
			return
		}
		if(!this.active){
			this.endSpeedo()
			return
		}
		global.ui.emit('speedo', this.active.speed(), this.active.bitrate)
	}
}

class StreamerThrottling extends StreamerSpeedo {
	constructor(opts){
		super(opts)
		this.throttling = {};
		this.throttleTTL = 10
	}
	throttle(url){
		let rule = 'allow', domain = this.getDomain(url)
		if(typeof(this.throttling[domain]) != 'undefined'){
			let now = this.time()
			if(this.throttling[domain] > now){
				rule = 'deny'
			} else {
				delete this.throttling[domain]
			}
		}
		return rule == 'allow'
	}
	forbid(url){
		this.throttling[this.getDomain(url)] = this.time() + this.throttleTTL
	}
	getDomain(u){
		if(u && u.indexOf('//') != -1){
			let d = u.split('//')[1].split('/')[0]
			if(d == 'localhost' || d.indexOf('.') != -1){
				return d
			}
		}
		return ''
	}
}

class StreamerAbout extends StreamerThrottling {
	constructor(opts){
		super(opts)
		if(!this.opts.shadow){
			this.aboutOptions = []
			this.aboutDialogRegisterOption('title', data => {
				return {template: 'question', text: data.name, fa: 'fas fa-info-circle'}
			})
			this.aboutDialogRegisterOption('text', () => {
				return {template: 'message', text: this.aboutText()}
			})
			this.aboutDialogRegisterOption('ok', () => {
				return {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'}
			})
			this.aboutDialogRegisterOption('share', () => {
				return {template: 'option', text: global.lang.SHARE, id: 'share', fa: 'fas fa-share-alt'}
			}, this.share.bind(this))
			global.ui.on('streamer-about-cb', chosen => {
				console.log('about callback', chosen)
				if(this.active.data){
					this.aboutOptions.some(o => {
						if(o.id == chosen){
							if(typeof(o.action) == 'function'){
								o.action(this.active.data)
							}
							return true
						}
					})
				}
			})	
		}	
	}
	aboutDialogRegisterOption(id, renderer, action){
		this.aboutOptions.push({id, renderer, action})
	}
	aboutDialogStructure(){
		return this.aboutOptions.map(o => o.renderer(this.active.data)).filter(o => o)
	}
	aboutText(){
		let text = ''
		if(this.active.bitrate){
			const speed = this.active.speed(), tuneable = !!global.tuning, icon = '<i class="fas fa-circle {0}"></i> '
			if(this.speedoClientSpeed < speed){
				this.speedoClientSpeed = speed
			}
			if(this.speedoClientSpeed && (this.speedoClientSpeed < this.active.bitrate)){
				text += icon.format('faclr-red')
				if(tuneable){
					text += global.lang.YOUR_CONNECTION_IS_SLOW_TIP.format('<i class="fas fa-random"></i>')
				} else {
					text += global.lang.YOUR_CONNECTION_IS_SLOW
				}
				text += ' (' + global.kbsfmt(this.speedoClientSpeed) + ' < ' + global.kbsfmt(this.active.bitrate) + ')'
			} else if(speed && (speed < this.active.bitrate)) {
				text += icon.format('faclr-orange') + global.lang['SLOW_SERVER'] + ' (' + global.kbsfmt(speed) + ' < ' + global.kbsfmt(this.active.bitrate)+')'
			} else {
				text += icon.format('faclr-green') + global.lang['STABLE_CONNECTION'] + ' (' + global.kbsfmt(this.active.bitrate) +')'
			}
		}
		let meta = [this.active.type], dimensions = this.active.dimensions()
		if(dimensions){
			meta.push(dimensions)
		}
		if(this.active.codecData && (this.active.codecData.video || this.active.codecData.audio)){
			let codecs = [this.active.codecData.video, this.active.codecData.audio].filter(s => s)
			codecs = codecs.map(c => c = c.replace(new RegExp('\\([^\\)]*[^A-Za-z\\)][^\\)]*\\)', 'g'), '').replace(new RegExp(' +', 'g'), ' ').trim())
			meta = meta.concat(codecs)
		}
		text += "\r\n" + meta.join(' | ')
		return text
	}
    about(){
		if(this.opts.shadow){
			return
		}
		let title, text = ''
		if(this.active){
			global.ui.emit('dialog', this.aboutDialogStructure(this.active.data), 'streamer-about-cb', 'ok')
		} else {
			title = global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' - '+ process.arch
			text = global.lang.NONE_STREAM_FOUND
        	global.ui.emit('info', title, text.trim())
		}
    }
}

class Streamer extends StreamerAbout {
	constructor(opts){
		super(opts)
		global.ui.once('init', () => {
			global.explorer.on('open', () => {
				if(global.tuning){
					global.tuning.destroy()
				}
			})
		})
	}
	playFromEntries(entries, name, megaUrl, txt, callback, connectId, mediaType){
		if(this.opts.shadow){
			return
		}
		const loadingEntriesData = [global.lang.AUTO_TUNING, name]
		console.warn('playFromEntries', entries, name, connectId)
		if(!this.active){
			this.setUILoadingEntries(loadingEntriesData, true, txt)
			global.osd.show(global.lang.TUNING + ' ' + name + '... 0%', 'fa-mega spin-x-alt', 'streamer', 'persistent')
		}
		global.watching.order(entries).then(entries => {
			if(this.connectId != connectId){
				return
			}
			console.log('tuning', entries, name)
			let tuning = new AutoTuner(entries, {}, megaUrl, mediaType)
			global.tuning = tuning
			tuning.txt = txt
			tuning.on('progress', i => {
				if(!this.active && i.progress && !isNaN(i.progress)){
					global.osd.show(global.lang.TUNING + ' ' + name + '... ' + i.progress + '%', 'fa-mega spin-x-alt', 'streamer', 'persistent')
				}
			})
			tuning.on('finish', () => {
				tuning.destroy()
			})
			tuning.on('destroy', () => {
				global.osd.hide('streamer')
				if(tuning == global.tuning){
					global.tuning = null
				}
				tuning = null
			})
			tuning.tune().then(() => {
				callback(true)
				global.ui.emit('tuneable', true)	
			}).catch(err => {
				if(err != 'cancelled by user'){
					global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-circle faclr-red', 'streamer', 'normal')
				}
			}).finally(() => {
				this.setUILoadingEntries(loadingEntriesData, false)
			})
		}).catch(err => {
			global.displayErr(err)
			global.osd.hide('streamer')
			callback(false)
		})
	}
	play(e, results){
		if(this.opts.shadow){
			return
		}
		if(this.active){
			this.stop()
		}
		if(global.tuning){
			if(global.tuning.megaUrl && global.tuning.megaUrl == e.url){
				return this.tune(e)
			}
			global.tuning.destroy()
			global.tuning = null
		}
		const connectId = global.time()
		this.connectId = connectId
		this.emit('connecting', connectId)
		const isMega = global.mega.isMega(e.url), txt = isMega ? global.lang.TUNING : undefined
		const opts = isMega ? global.mega.parse(e.url) : {mediaType: 'live'};		
		const loadingEntriesData = [e, global.lang.AUTO_TUNING]
		this.setUILoadingEntries(loadingEntriesData, true, txt)
		if(global.config.get('show-logos') ){
			e = global.icons.prepareEntry(e)
		}
		console.log(e)
		if(Array.isArray(results)){
			this.playFromEntries(results, e.name, isMega ? e.url : '', txt, succeeded => {
				if(this.connectId == connectId){
					this.connectId = false
					if(!succeeded){
						this.emit('connecting-failure', e)
					}
				}
			}, connectId, opts.mediaType)
		} else if(isMega) {
			let name = e.name
			if(opts.name){
				name = opts.name
			}
			global.osd.show(global.lang.TUNING + ' ' + name + '...', 'fa-mega spin-x-alt', 'streamer', 'persistent')   
			global.lists.search(name, {
				partial: false, 
				type: 'live',
				typeStrict: false
			}).then(entries => {
				if(this.connectId != connectId){
					return
				}				
				//console.warn('ABOUT TO TUNE', name, JSON.stringify(entries))
				entries = entries.results
				if(entries.length){
					this.playFromEntries(entries, name, e.url, txt, succeeded => {
						if(!succeeded){
							this.connectId = false
							this.emit('connecting-failure')
						}
					}, connectId, opts.mediaType)
				} else {			
					this.connectId = false
					this.emit('connecting-failure', e)
					global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-circle faclr-red', 'streamer', 'normal')
					global.ui.emit('sound', 'static', 25)
					this.setUILoadingEntries(loadingEntriesData, false)
				}
			})
		} else {
			global.ui.emit('tuneable', global.channels.isChannel(e.terms.name))
			global.osd.show(global.lang.CONNECTING + ' ' + e.name + '...', 'fa-mega spin-x-alt', 'streamer', 'persistent')
			this.intent(e).then(n => {
				console.warn('STREAMER INTENT SUCCESS', e);
			}).catch(r => {
				if(this.connectId != connectId){
					return
				}				
				console.warn('STREAMER INTENT ERROR', r, traceback())
				global.ui.emit('sound', 'static', 25);
				this.connectId = false
				this.emit('connecting-failure', e)
				this.handleFailure(e, r)
			}).finally(() => {
				this.setUILoadingEntries(loadingEntriesData, false)
			})
		}
	}
	setUILoadingEntries(es, state, txt){
		es.map(e => {
			if(typeof(e) == 'string'){
				return {name: e}
			} else {
				['path', 'url', 'name'].some(att => {
					if(e[att]){
						let _e = {}
						_e[att] = e[att]
						e = _e
						return true
					}
				})
				return e
			}
		}).forEach(e => global.ui.emit('set-loading', e, state, txt))
	}
	tune(e){
		if(this.opts.shadow){
			return
		}
		if(!this.isEntry(e)){
			if(this.active){
				e = this.active.data
			}		
		}
		if(this.isEntry(e)){
			this.stop()
			const same = global.tuning && !global.tuning.finished && (global.tuning.has(e.url) || global.tuning.megaUrl == e.url)
			const loadingEntriesData = [e, global.lang.AUTO_TUNING]
			console.log('tuneEntry', e, same)
			if(same){
				global.tuning.tune().then(() => {
					global.ui.emit('tuneable', true)	
				}).catch(err => {
					if(err != 'cancelled by user'){
						this.emit('connecting-failure', e)
						console.error('tune() ERR', err)
						global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(e.name), 'fas fa-exclamation-circle faclr-red', 'streamer', 'normal')
					}
				}).finally(() => {
					this.setUILoadingEntries(loadingEntriesData, false)
				})
			} else {
				global.search.termsFromEntry(e, false).then(terms => {
					if(!terms){
						terms = global.lists.terms(e.name)
					}
					if(Array.isArray(terms)){
						terms = terms.join(' ')
					}
					e.url = global.mega.build(e.name, {terms})
					this.play(e)
				}).catch(console.error)
			}
			return true
		}
	}
	handleFailure(e, r, silent){		
		let c = 'stop', trace = traceback()
		if(!this.isEntry(e)){
			if(this.active){
				e = this.active.data
			}
		}
		this.stop({err: r, trace})
		this.emit('failure', e)		
		if(this.opts.shadow){
			return
		}
		if(c != 'tune' && (global.tuning && global.tuning.has(e.url))){
			c = 'tune'
		}
		if(r && (c != 'tune' || !e) && (silent !== true || c == 'stop' || !e)){
			this.handleFailureMessage(r)
		}
		console.error('handleFailure', c, e, e.url, global.tuning)
		if(c == 'stop'){
			return
		} else {
			if(!e){
				return false
			}
			if(!global.mega.isMega(e.url)){
				if(!this.tune(e)){
					this.stop({err: 'tune failure', trace})
				}
			}
		}
	}
	handleFailureMessage(r){
		r = String(r)
		let msg = global.lang.PLAYBACK_OFFLINE_STREAM
		switch(String(r)){
			case 'playback':
				msg = lang.PLAYBACK_ERROR
				break
			case 'network':
				msg = lang.PLAYBACK_OVERLOADED_SERVER
				break
			case 'request error':
				msg = global.lang.PLAYBACK_OFFLINE_STREAM
				break
			case 'timeout':
				msg = global.lang.PLAYBACK_TIMEOUT
				break
			case 'unsupported format':
			case 'invalid url':
				msg = global.lang.PLAYBACK_UNSUPPORTED_STREAM
				break
			case 'ffmpeg fail':
				msg = global.lang.FFMPEG_DISABLED
				break
			default:
				let m = r.match(new RegExp('error: ([0-9]+)'))
				m = (m && m.length) ? m[1] : r
				switch(m){
					case '400':
					case '401':
					case '403':
						msg = global.lang.PLAYBACK_PROTECTED_STREAM
						break
					case '404':
					case '410':
						msg = global.lang.PLAYBACK_OFFLINE_STREAM
						break
					case '500':
					case '502':
					case '503':
					case '504':
						msg = global.lang.PLAYBACK_OVERLOADED_SERVER
						break
				}
		}
		global.osd.show(msg, 'fas fa-exclamation-circle faclr-red', '', 'normal')
	}
}

module.exports = Streamer
