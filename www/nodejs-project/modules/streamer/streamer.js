
const path = require('path'), Events = require('events'), fs = require('fs'), async = require('async')
const AutoTuner = require('../tuner/auto-tuner'), StreamInfo = require('../iptv-stream-info')

if(!Promise.allSettled){
	Promise.allSettled = ((promises) => Promise.all(promises.map(p => p
		.then(value => ({
			status: 'fulfilled', value
		}))
		.catch(reason => ({
			status: 'rejected', reason
		}))
	)))
}

class StreamerTools extends Events {
    constructor(){
        super()
		this.streamInfo = new StreamInfo()
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
	validate(value) {
		let v = value.toLowerCase(), prt = v.substr(0, 4), pos = v.indexOf('://')
		if(['http'].includes(prt) && pos >= 4 && pos <= 6){
			return true // /^(?:(?:(?:https?|rt[ms]p[a-z]?):)?\/\/)(?:\S+(?::\S*)?@)?(?:(?!(?:10|127)(?:\.\d{1,3}){3})(?!(?:169\.254|192\.168)(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}(?:\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4]))|(?:(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)(?:\.(?:[a-z\u00a1-\uffff0-9]-*)*[a-z\u00a1-\uffff0-9]+)*(?:\.(?:[a-z\u00a1-\uffff]{2,})))(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(value);
		}
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
	isLocalFile(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m && m.length > 1 && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	info(url, retries = 2, source=''){
		return new Promise((resolve, reject) => {
			this.pingSource(source, () => {
				this.streamInfo.probe(url, retries).then(nfo => {
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
		})
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
			workDir: global.paths.temp +'/streamer',
			shadow: false,
			debug: false,
			osd: false
		}
        this.engines = {
            aac: require('./engines/aac'),
            hls: require('./engines/hls'),
            rtmp: require('./engines/rtmp'),
            dash: require('./engines/dash'),
            ts: require('./engines/ts'),
            video: require('./engines/video'),
            vodhls: require('./engines/vodhls'),
            yt: require('./engines/yt')
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
			this.info(data.url, 2, data.source).then(nfo => {
				this.intentFromInfo(data, opts, aside, nfo).then(resolve).catch(reject)
			}).catch(err => {
				if(this.opts.debug){
					console.log('ERR', err)
				}
				if(String(err).match(new RegExp("(: 401|^401$)"))){
					this.forbid(data.url)
				}
				reject(err)
			})
        })
	}
	pingSource(url, cb){ // ensure to keep any auth
        if(typeof(global.streamerPingSourceTTLs) == 'undefined'){ // using global here to make it unique between any tuning and streamer
            global.streamerPingSourceTTLs = {}            
        }
        if(typeof(global.streamerPingSourceCallbacks) == 'undefined'){
            global.streamerPingSourceCallbacks = {}
        }
		if(global.validateURL(url)){
			let now = global.time()
			if(!global.streamerPingSourceTTLs[url] || global.streamerPingSourceTTLs[url] < now){
				if(this.pingSourceQueue(url, cb, cb)){
					let ret = ''
					global.Download.promise({
						url,
						timeout: 10,
						retry: 0,
						receiveLimit: 1,
						followRedirect: true
					}).then(body => {
						//console.log('pingSource: ok', body)	
						ret = String(body)
					}).catch(err => {
						//console.warn('pingSource error?: '+ String(err))
					}).finally(() => {
						//console.log('pingSource: unqueue resolving', ret)	
						global.streamerPingSourceTTLs[url] = now + 600
						this.pingSourceUnqueue(url, 'resolve', ret)
					})
				}
			} else {
				cb()
			}
		} else {
			cb()
		}
	}	
    pingSourceQueue(k, resolve, reject){
        // console.log('name', JSON.stringify(k))
        let ret
        if(typeof(global.streamerPingSourceCallbacks[k]) == 'undefined'){
            global.streamerPingSourceCallbacks[k] = []
            ret = true
        }
        global.streamerPingSourceCallbacks[k].push({resolve, reject})
        return ret
    }
    pingSourceUnqueue(k, type, body){
        let ret
        if(typeof(global.streamerPingSourceCallbacks[k]) != 'undefined'){
            global.streamerPingSourceCallbacks[k].forEach(r => {
                r[type](body)
            })
            delete global.streamerPingSourceCallbacks[k]
        }        
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
					console.log('RUN', intent, opts)
				}
				intent.start().then(() => {
					this.unregisterLoadingIntent(intent, true)
					if(intent.cancel){
						if(this.opts.debug){
							console.log('CANCEL')
						}
						intent.destroy()
						reject('cancelled by user')
					} else {
						if(this.opts.debug){
							console.log('COMMIT', intent)
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
						console.log('ERR', err)
					}
					intent.destroy()
					reject(err)
				})
			}
		})
	}
	retry(){		
		console.warn('RETRYING')
		let data = this.active ? this.active.data : this.lastActiveData
		if(data) this.play(data)
	}
	commit(intent){
		if(intent && this.active != intent){
			if(this.opts.debug){
				console.log('COMMITTING', global.traceback())
			}
			if(intent.destroyed){
				console.error('COMMITTING DESTROYED INTENT', global.traceback(), intent)
				return 'COMMITTING DESTROYED INTENT'
			}
			if(this.opts.debug){
				console.log('INTENT SWITCHED !!', this.active ? this.active.data : false, intent ? intent.data : false, intent.destroyed, global.traceback())
				if(!intent.opts.debug){
					intent.opts.debug = this.opts.debug
				}
			}
			this.unload()
			this.active = intent // keep referring below as intent to avoid confusion on changing intents, specially inside events
			this.lastActiveData = this.active.data
			intent.committed = true
			intent.commitTime = global.time()
			intent.on('destroy', () => {
				if(intent == this.active){
					this.emit('uncommit', intent)
					if(this.opts.debug){
						console.log('ACTIVE INTENT UNCOMMITTED & DESTROYED!!', intent, this.active)
					}
					this.stop()
				}
				if(this.opts.debug){
					console.log('INTENT UNCOMMITTED & DESTROYED!!', intent)
				}
			})
			intent.on('bitrate', bitrate => {
				global.ui.emit('streamer-bitrate', bitrate)
			})
			intent.on('fail', err => {
				this.emit('uncommit', intent)
				if(this.opts.debug){
					console.log('INTENT FAILED !!')
				}
				this.handleFailure(intent.data, err)
			})
			intent.on('codecData', codecData => {
				if(codecData && intent == this.active){
					global.ui.emit('codecData', codecData)
				}
				if(!global.cordova && !intent.isTranscoding()){
					if(codecData.video && codecData.video.match(new RegExp('(hevc|mpeg2video|mpeg4)')) && intent.opts.videoCodec != 'libx264'){
						if((!global.tuning && !global.zap.isZapping) || global.config.get('transcoding-tuning')){
							this.transcode(null, err => {
								if(err) intent.fail('unsupported format')
							})
						} else {
							intent.fail('unsupported format')
						}
					}
				}
			})
			intent.on('streamer-connect', () => this.connect())
			if(intent.codecData){
				intent.emit('codecData', intent.codecData)
			}
			this.emit('commit', intent)
			intent.emit('commit')
			let data = this.connect(intent)
			console.warn('STREAMER COMMIT '+ data.url)
			return true
		} else {
			return 'ALREADY COMMITTED OR NO INTENT'
		}
	}
	connect(intent){
		if(!intent) intent = this.active
		let data = intent.data
		data.engine = intent.type
		if(data.icon){
			data.originalIcon = data.icon
			data.icon = global.icons.url + global.icons.key(data.icon)
		} else {
			data.icon = global.icons.url + global.channels.entryTerms(data).join(',')
		}
		this.emit('streamer-connect', intent.endpoint, intent.mimetype, data)
		if(intent.transcoderStarting){
			global.ui.emit('streamer-connect-suspend')
		}
		if(!this.opts.shadow){
			global.osd.hide('streamer')
		}
		return data
	}
	transcode(intent, _cb, silent){
		let transcoding = global.config.get('transcoding')
		let cb = (err, transcoder) => {
			if(typeof(_cb) == 'function'){
				_cb(err, transcoder)
				_cb = null
			}
		}
		if(!intent){
			if(this.active){
				intent = this.active
			} else {
				return cb(global.lang.START_PLAYBACK_FIRST)
			}
		}
		if((transcoding || silent) && intent.transcode){
			if(intent.transcoder){
				if(intent.transcoderStarting){
					intent.transcoder.once('transcode-started', () => cb(null, intent.transcoder))
					intent.transcoder.once('transcode-failed', cb)
				} else {
					cb(null, intent.transcoder)
				}
			} else {
				console.warn('Transcoding started')
				if(!silent){
					global.ui.emit('streamer-connect-suspend')
					global.ui.emit('transcode-starting', true)
				}
				intent.transcode().then(() => {
					this.emit('streamer-connect', intent.endpoint, intent.mimetype, intent.data)
					cb(null, intent.transcoder)
				}).catch(err => {
					if(this.active){
						console.error(err)
						cb(err)
						intent.fail('unsupported format', err, intent.codecData)
						if(!silent){
							intent.fail('unsupported format')
						}
					}
				}).finally(() => {
					global.ui.emit('transcode-starting', false)					
				})
			}
			return true
		} else {
			cb('Transcoding unavailable')
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
			global.osd.hide('transcode')
		}
		this.unregisterAllLoadingIntents()
		if(this.active){
			let data = this.active.data
            this.emit('streamer-disconnect', err)
			console.log('STREAMER->STOP', err, global.traceback())
			if(!err && this.active.failed){
				err = 'failed'
			}
			if(!err){ // stopped with no error
				let longWatchingThreshold = 15 * 60, watchingDuration = (global.time() - this.active.commitTime)
				console.log('STREAMER->STOP', watchingDuration, this.active.commitTime)
				if(this.active.commitTime && watchingDuration > longWatchingThreshold){
					global.ui.emit('streamer-long-watching', watchingDuration)
					this.emit('streamer-long-watching', watchingDuration)
				}
			}
            this.active.destroy()
			this.active = null
			this.emit('stop', err, data)
		}
	}
	share(){
		if(this.active && !this.opts.shadow){
			let url = this.active.data.originalUrl || this.active.data.url
			let name = this.active.data.originalName || this.active.data.name
			let icon = this.active.data.originalIcon || this.active.data.icon
			if(global.mega.isMega(url)){
				global.ui.emit('share', global.ucWords(global.MANIFEST.name), name, 'https://megacubo.tv/assistir/' + encodeURIComponent(url.replace('mega://', '')))
			} else {
				url = global.mega.build(name, {url, icon, mediaType: this.active.mediaType})
				global.ui.emit('share', global.ucWords(global.MANIFEST.name), name, url.replace('mega://', 'https://megacubo.tv/assistir/'))
			}
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
		this.downlink = 0
		if(!this.opts.shadow){
			global.ui.on('downlink', downlink => this.downlink = downlink)
			this.on('commit', this.startSpeedo.bind(this))
			this.on('uncommit', this.endSpeedo.bind(this))
			this.on('speed', speed => global.ui.emit('streamer-speed', speed))
			this.speedoSpeedListener = speed => this.emit('speed', speed)
		}
	}
	bindSpeedo(){
		this.unbindSpeedo()
		this.speedoAdapter = this.active.findLowAdapter(this.active, ['proxy', 'downloader', 'joiner']) // suitable adapters to get download speed
		if(this.speedoAdapter){
			this.speedoAdapter.on('speed', this.speedoSpeedListener)
		}
	}
	unbindSpeedo(){
		if(this.speedoAdapter){
			this.speedoAdapter.removeListener('speed', this.speedoSpeedListener)
			this.speedoAdapter = false
		}
	}
	startSpeedo(){
		if(this.active && !this.speedoAdapter){
			this.bindSpeedo()
		}
	}
	endSpeedo(){
		this.unbindSpeedo()
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
			let now = global.time()
			if(this.throttling[domain] > now){
				rule = 'deny'
			} else {
				delete this.throttling[domain]
			}
		}
		return rule == 'allow'
	}
	forbid(url){
		this.throttling[this.getDomain(url)] = global.time() + this.throttleTTL
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

class StreamerTracks extends StreamerThrottling {
	constructor(opts){
		super(opts)
	}
	getTrackOptions(tracks, activeTrack){
		return Object.keys(tracks).map((name, i) => {
			let opt = {template: 'option', text: name, id: 'track-'+ i}
			if(tracks[name] == activeTrack){
				opt.fa = 'fas fa-play'
			}
			return opt
		})
	}
	async showTrackSelector(){
		if(!this.active) return
		let tracks = this.active.getTracks(), activeTrack = this.active.getActiveTrack(), opts = this.getTrackOptions(tracks, activeTrack)
		opts.unshift({template: 'question', text: global.lang.SELECT_TRACK})
		let ret = await global.explorer.dialog(opts)
		if(ret){
			let uri
			opts.filter(o => o.id == ret).forEach(o => {
				uri = tracks[o.text]
			})
			if(uri && uri != this.active.endpoint){
				this.active.endpoint = uri
				this.connect()
			}
		}
		return {ret, opts}
	}
}

class StreamerAbout extends StreamerTracks {
	constructor(opts){
		super(opts)
		if(!this.opts.shadow){
			this.aboutEntries = []
			this.moreAboutEntries = []
			const aboutTitleRenderer = (data, short) => {
				let text
				if(this.active.mediaType == 'live' || !data.groupName){
					text = data.name
				} else {
					text = '<div style="display: flex;flex-direction: row;"><span style="opacity: 0.5;display: inline;">'+ data.groupName +'&nbsp;&nbsp;&rsaquo;&nbsp;&nbsp;</span>'+ data.name +'</div>'
				}
				return {template: 'question', text, fa: 'fas fa-info-circle'}
			}
			this.aboutRegisterEntry('title', aboutTitleRenderer)
			this.aboutRegisterEntry('title', aboutTitleRenderer, null, null, true)
			this.aboutRegisterEntry('text', (data, short) => {
				if(!short) return {template: 'message', text: this.aboutText()}
			})
			this.aboutRegisterEntry('ok', () => {
				return {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'}
			})
			this.aboutRegisterEntry('share', data => {
				if(!data.isLocal){
					return {template: 'option', text: global.lang.SHARE, id: 'share', fa: 'fas fa-share-alt'}
				}
			}, this.share.bind(this))
			this.aboutRegisterEntry('more', data => {
				return {template: 'option', text: global.lang.MORE_OPTIONS, id: 'more', fa: 'fas fa-ellipsis-v'}
			}, this.moreAbout.bind(this))
			this.aboutRegisterEntry('tracks', () => {
				if(this.active.getTracks && Object.keys(this.active.getTracks()).length){
					return {template: 'option', fa: 'fas fa-bars', text: global.lang.SELECT_TRACK, id: 'tracks'}
				}
			}, this.showTrackSelector.bind(this), null, true)
			global.ui.on('streamer-update-streamer-info', async () => {
				if(this.active){
					let opts = await this.aboutStructure(true)
					let	msgs = opts.filter(o => ['question','message'].includes(o.template)).map(o => o.text)
					// msgs[1] = msgs[1].split('<i')[0].replace(new RegExp('<[^>]*>', 'g'), '')
					global.ui.emit('streamer-info', msgs.join('<br />'))
				}
			})
		}	
	}
	aboutRegisterEntry(id, renderer, action, position, more){
		let e = {id, renderer, action}
		let k = more ? 'moreAboutEntries' : 'aboutEntries'
		if(typeof(position) == 'number'){
			this[k].splice(position, 0, e)
		} else {
			this[k].push(e)
		}
	}
	aboutStructure(short){
		return new Promise((resolve, reject) => {
			Promise.allSettled(this.aboutEntries.map(o => {
				return Promise.resolve(o.renderer(this.active.data, short))
			})).then(results => {
				let ret = [], textPos = -1, titlePos = -1
				results.forEach(r => {
					if(r.status == 'fulfilled' && r.value){
						if(Array.isArray(r.value)){
							ret = ret.concat(r.value)
						} else if(r.value) {
							ret.push(r.value)
						}
					}
				})
				ret = ret.filter((r, i) => {
					if(r.template == 'question'){
						if(titlePos == -1){
							titlePos = i
						} else {
							ret[titlePos].text += ' &middot; '+ r.text
							return false
						}
					}
					if(r.template == 'message'){
						if(textPos == -1){
							textPos = i
						} else {
							ret[textPos].text += r.text
							return false
						}
					}
					return true
				})
				ret.some((r, i) => {
					if(r.template == 'message'){
						ret[i].text = '<div>'+ r.text +'</div>'
						return true
					}
				})
				resolve(ret)
			}).catch(reject)
		})
	}
	moreAboutStructure(){
		return new Promise((resolve, reject) => {
			Promise.allSettled(this.moreAboutEntries.map(o => {
				return Promise.resolve(o.renderer(this.active.data))
			})).then(results => {
				let ret = [], textPos = -1, titlePos = -1
				results.forEach(r => {
					if(r.status == 'fulfilled' && r.value){
						if(Array.isArray(r.value)){
							ret = ret.concat(r.value)
						} else if(r.value) {
							ret.push(r.value)
						}
					}
				})
				ret = ret.filter((r, i) => {
					if(r.template == 'question'){
						if(titlePos == -1){
							titlePos = i
						} else {
							ret[titlePos].text += ' &middot; '+ r.text
							return false
						}
					}
					if(r.template == 'message'){
						if(textPos == -1){
							textPos = i
						} else {
							ret[textPos].text += r.text
							return false
						}
					}
					return true
				})
				ret.some((r, i) => {
					if(r.template == 'message'){
						ret[i].text = '<div>'+ r.text +'</div>'
						return true
					}
				})
				resolve(ret)
			}).catch(reject)
		})
	}
	aboutText(){
		let text = ''
		if(this.active.bitrate && !this.active.data.isLocal){
			const currentSpeed = (this.speedoAdapter || this.active).currentSpeed, tuneable = this.isTuneable, icon = '<i class="fas fa-circle {0}"></i> '
			if(this.downlink < currentSpeed){
				this.downlink = currentSpeed
			}
			let p = parseInt(currentSpeed / (this.active.bitrate / 100))
			if(p > 100){
				p = 100
			}
			console.log('about conn', currentSpeed, this.downlink, this.active.bitrate, p +'%')
			if(p == 100) {
				text += icon.format('faclr-green')
				text += global.lang.STABLE_CONNECTION + ' (' + global.kbsfmt(this.active.bitrate) +')'
			} else {
				if(p < 80){
					text += icon.format('faclr-red')
				} else {
					text += icon.format('faclr-orange')
				}
				if(this.downlink && (this.downlink < this.active.bitrate)){
					if(tuneable){
						text += global.lang.YOUR_CONNECTION_IS_SLOW_TIP.format('<i class="'+ global.config.get('tuning-icon') +'"></i>')
					} else {
						text += global.lang.YOUR_CONNECTION_IS_SLOW
					}
					text += ' (' + global.kbsfmt(this.downlink) + ' < ' + global.kbsfmt(this.active.bitrate) + ')'
				} else {
					text += global.lang.SLOW_SERVER + ' (' + global.kbsfmt(currentSpeed) + ' < ' + global.kbsfmt(this.active.bitrate)+')'
				}
			}
		}
		let meta = [this.active.type.toUpperCase()], dimensions = this.active.dimensions()
		if(dimensions){
			meta.push(dimensions)
		}
		if(this.active.codecData && (this.active.codecData.video || this.active.codecData.audio)){
			let codecs = [this.active.codecData.video, this.active.codecData.audio].filter(s => s)
			codecs = codecs.map(c => c = c.replace(new RegExp('\\([^\\)]*[^A-Za-z\\)][^\\)]*\\)', 'g'), '').replace(new RegExp(' +', 'g'), ' ').trim())
			meta = meta.concat(codecs)
		}
		if(this.active.transcoder){
			meta.push(global.lang.TRANSCODING.replaceAll('.', ''))
		}
		text = '<div>'+ text + '</div><div>' + meta.join(' | ') +'</div>'
		return text
	}
    async about(){
		if(this.opts.shadow){
			return
		}
		let title, text = ''
		if(this.active){
			let struct = await this.aboutStructure()
			let ret = await global.explorer.dialog(struct, 'ok')
			this.aboutCallback(ret)
		} else {
			title = global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' - '+ process.arch
			text = global.lang.NONE_STREAM_FOUND
        	global.ui.emit('info', title, text.trim())
		}
    }
    async moreAbout(){
		if(this.opts.shadow) return
		let title, text = ''
		if(this.active){
			let struct = await this.moreAboutStructure()
			let ret = await global.explorer.dialog(struct, 'ok')
			this.aboutCallback(ret)
		} else {
			title = global.ucWords(global.MANIFEST.name) +' v'+ global.MANIFEST.version +' - '+ process.arch
			text = global.lang.NONE_STREAM_FOUND
        	global.ui.emit('info', title, text.trim())
		}
    }
	aboutCallback(chosen){
		console.log('about callback', chosen)
		if(this.active && this.active.data){
			this.aboutEntries.concat(this.moreAboutEntries).some(o => {
				if(o.id && o.id == chosen){
					if(typeof(o.action) == 'function'){
						o.action(this.active.data)
					}
					return true
				}
			})
		}
	}
}

class Streamer extends StreamerAbout {
	constructor(opts){
		super(opts)
		if(!this.opts.shadow){
			global.ui.once('init', () => {
				global.explorer.on('open', path => {
					if(global.tuning && path.indexOf(global.lang.STREAMS) != -1){
						global.tuning.destroy()
					}
				})
			})
			global.ui.on('streamer-duration', duration => {
				if(this.active && this.active.info.contentLength){
					this.active.bitrate = (this.active.info.contentLength / duration) * 8
					global.ui.emit('streamer-bitrate', this.active.bitrate)
				}
			})
		}
	}
	setTuneable(enable){
		this.isTuneable = !!enable
		global.ui.emit('tuneable', this.isTuneable)
	}
	findPreferredStreamURL(name){
		let ret = null
		global.histo.get().some(e => {
			if(e.name == name || e.originalName == name){
				ret = e.preferredStreamURL
				return true
			}
		})
		return ret
	}
    hlsOnly(entries){
        let nentries = entries.filter(a => {
			return this.ext(a.url) == 'm3u8'
		})
		return nentries.length ? nentries : entries
    }
	async playFromEntries(entries, name, megaURL, txt, connectId, mediaType, preferredStreamURL, silent){
		if(this.opts.shadow){
			throw 'in shadow mode'
		}
		const loadingEntriesData = [global.lang.AUTO_TUNING, name]
		console.warn('playFromEntries', entries, name, connectId)
		if(!this.active){
			global.explorer.setLoadingEntries(loadingEntriesData, true, txt)
			if(!silent){
				global.osd.show(global.lang.TUNING_WAIT_X.format(name) + ' 0%', 'fa-mega spin-x-alt', 'streamer', 'persistent')
			}
		}
		if(global.tuning){
			global.tuning.destroy()
		}
		entries = await global.watching.order(entries)
		if(this.connectId != connectId){
			throw 'another play intent in progress'
		}
		console.log('tuning', entries, name)
		let tuning = new AutoTuner(entries, {preferredStreamURL, name, megaURL, mediaType})
		global.tuning = tuning
		tuning.txt = txt
		tuning.on('progress', i => {
			if(!silent && !this.active && i.progress && !isNaN(i.progress)){
				global.osd.show(global.lang.TUNING_WAIT_X.format(name) +' '+ i.progress + '%', 'fa-mega spin-x-alt', 'streamer', 'persistent')
			}
		})
		tuning.on('finish', () => {
			tuning.destroy()
		})
		tuning.on('destroy', () => {
			global.osd.hide('streamer')
			tuning = null
		})
		let hasErr
		await tuning.tune().catch(err => {
			if(err != 'cancelled by user'){
				hasErr = err
				console.error(err)
			}
		})
		if(hasErr){
			if(!silent){
				global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-circle faclr-red', 'streamer', 'normal')
				this.triggerCheckForListExpiral(entries)
			}
		} else {
			this.setTuneable(true)
		}
		global.explorer.setLoadingEntries(loadingEntriesData, false)
		return !hasErr
	}
	async playPromise(e, results, silent){
		if(this.opts.shadow){
			throw 'in shadow mode'
		}
		e = global.deepClone(e)
		if(this.active){
			this.stop()
		}
		if(global.tuning){
			if(!global.tuning.destroyed && global.tuning.opts.megaURL && global.tuning.opts.megaURL == e.url){
				return this.tune(e)
			}
			global.tuning.destroy()
		}
		const connectId = global.time()
		this.connectId = connectId
		this.emit('connecting', connectId)
		const isMega = global.mega.isMega(e.url), txt = isMega ? global.lang.TUNING : undefined
		const opts = isMega ? global.mega.parse(e.url) : {mediaType: 'live'};		
		const loadingEntriesData = [e, global.lang.AUTO_TUNING]
		if(!silent){
			console.log('SETLOADINGENTRIES', loadingEntriesData)
			global.explorer.setLoadingEntries(loadingEntriesData, true, txt)
		}
		console.warn('STREAMER INTENT', e, results, traceback());
		let succeeded
		if(Array.isArray(results)){
			let name = e.name
			if(opts.name){
				name = opts.name
			}
			succeeded = await this.playFromEntries(results, name, isMega ? e.url : '', txt, connectId, opts.mediaType, e.preferredStreamURL || this.findPreferredStreamURL(name), silent)
			if(this.connectId == connectId){
				this.connectId = false
				if(!succeeded){
					this.emit('connecting-failure', e)
				}
			} else {
				if(!silent){
					global.explorer.setLoadingEntries(loadingEntriesData, false)
				}
				throw 'another play intent in progress'
			}
		} else if(isMega && !opts.url) {
			let name = e.name
			if(opts.name){
				name = opts.name
			}
			let terms = opts.terms ? opts.terms.split(',') : global.lists.terms(name, false)
			if(!silent){
				global.osd.show(global.lang.TUNING_WAIT_X.format(name), 'fa-mega spin-x-alt', 'streamer', 'persistent')   
			}
			await global.lists.manager.waitListsReady()
			let entries = await global.lists.search(terms, {
				type: 'live',
				safe: (global.config.get('parental-control-policy') == 'block')
			})
			if(this.connectId != connectId){
				if(!silent){
					global.explorer.setLoadingEntries(loadingEntriesData, false)
				}
				throw 'another play intent in progress'
			}		
			console.warn('ABOUT TO TUNE', name, JSON.stringify(entries), opts)
			entries = entries.results		
			if(opts.hlsOnly === true){
				entries = this.hlsOnly(entries)
			}
			console.warn('ABOUT TO TUNE', name, opts, entries.length)
			if(entries.length){
				entries = entries.map(s => {
					s.originalName = name
					s.originalUrl = e.url
					return s
				})
				succeeded = await this.playFromEntries(entries, name, e.url, txt, connectId, opts.mediaType, e.preferredStreamURL || this.findPreferredStreamURL(name), silent)
			}
			if(!succeeded){
				this.connectId = false
				this.emit('connecting-failure', e)
				if(!silent){
					global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-circle faclr-red', 'streamer', 'normal')
					global.ui.emit('sound', 'static', 25)
				}
			}
		} else {
			if(opts.url){
				e = Object.assign(Object.assign({}, e), opts)
			}
			console.warn('STREAMER INTENT', e);
			let terms = global.channels.entryTerms(e)
			this.setTuneable(!global.lists.msi.isVideo(e.url) && global.channels.isChannel(terms))
			if(!silent){
				global.osd.show(global.lang.CONNECTING + ' ' + e.name + '...', 'fa-mega spin-x-alt', 'streamer', 'persistent')
			}
			let hasErr
			await this.intent(e).catch(r => hasErr = r)
			if(hasErr){
				if(this.connectId != connectId){
					if(!silent){
						global.explorer.setLoadingEntries(loadingEntriesData, false)
					}
					throw 'another play intent in progress'
				}		
				console.warn('STREAMER INTENT ERROR', hasErr, traceback())
				global.ui.emit('sound', 'static', 25);
				this.connectId = false
				this.emit('connecting-failure', e)
				this.handleFailure(e, hasErr)
			} else {
				console.warn('STREAMER INTENT SUCCESS', e)
				succeeded = true
			}
		}
		if(!silent){
			global.explorer.setLoadingEntries(loadingEntriesData, false)
		}
		return succeeded
	}
	async triggerCheckForListExpiral(){
		if(global.activeLists.my.length == 0 || !global.tuning){
			return
		}
		const expiralCheckLockTime = 300
		if(typeof(this.expiralCheckLock) == 'undefined'){
			this.expiralCheckLock = {}
		}
		const now = global.time(), from = now - expiralCheckLockTime, validLiveTypes = ['hls', 'ts']
		const csources = global.activeLists.my.filter(u => {
			return !this.expiralCheckLock[u] || this.expiralCheckLock[u] < from
		})
		if(!csources.length){
			return
		}
		const sources = {}, entries = Object.values(global.tuning.log())
		csources.forEach(s => {
			sources[s] = entries.filter(e => e.source == s)
		})
		Object.keys(sources).forEach(source => {
			if(this.expiralCheckLock[source] && this.expiralCheckLock[source] > from){
				return
			}
			if(sources[source].some(e => validLiveTypes.includes(e.type))){
				return
			}
			let expiralStatusCodes = [401, 403], expiralMessageTypes = ['video', 'vodhls'], expiralScore = sources[source].filter(e => {
				return expiralStatusCodes.includes(e.error) || expiralMessageTypes.includes(e.type)
			}).length
			if(expiralScore > (sources[source].length / 2)){	
				console.warn('triggerCheckForListExpiral', source +' EXPIRED', expiralScore +'/'+ sources[source].length)
				this.expiralCheckLock[source] = now
				global.explorer.dialog([
					{template: 'question', text: 'Megacubo', fa: 'fas fa-info-circle'},
					{template: 'message', text: global.lang.IPTV_LIST_EXPIRED +'<br /><br />'+ source},
					{template: 'option', text: 'OK', id: 'ok'}
				], 'ok').catch(console.error) // dont wait
			}
		})
	}
	play(e, results, silent){
		this.playPromise(e, results, silent).catch(console.error)
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
			let ch = global.channels.isChannel(global.channels.entryTerms(e))
			if(ch){
				e.name = ch.name
			}
			const same = global.tuning && !global.tuning.finished && !global.tuning.destroyed && (global.tuning.has(e.url) || global.tuning.opts.megaURL == e.url)
			const loadingEntriesData = [e, global.lang.AUTO_TUNING]
			console.log('tuneEntry', e, same)
			if(same){
				global.tuning.tune().then(() => {
					this.setTuneable(true)
				}).catch(err => {
					if(err != 'cancelled by user'){
						this.emit('connecting-failure', e)
						console.error('tune() ERR', err)
						global.osd.show(global.lang.NO_MORE_STREAM_WORKED_X.format(e.name), 'fas fa-exclamation-circle faclr-red', 'streamer', 'normal')
					}
				}).finally(() => {
					global.explorer.setLoadingEntries(loadingEntriesData, false)
				})
			} else {
				const name = e.originalName || e.name
				global.search.termsFromEntry(e, false).then(terms => {
					if(!terms){
						terms = global.lists.terms(name)
					}
					if(Array.isArray(terms)){
						terms = terms.join(' ')
					}
					e.url = global.mega.build(name, {terms})
					this.play(e)
				}).catch(console.error)
			}
			return true
		}
	}
	handleFailure(e, r, silent, doTune){		
		let c = doTune ? 'tune' : 'stop', trace = traceback()
		if(!this.isEntry(e)){
			if(this.active){
				e = this.active.data
			} else {
				e = this.lastActiveData
			}
		}
		this.stop({err: r, trace})
		this.emit('failure', e)		
		if(this.opts.shadow){
			return
		}
		if(c != 'tune' && e && (global.tuning && global.tuning.has(e.url))){
			c = 'tune'
		}
		if((r != null && typeof(r) != 'undefined') && (c != 'tune' || !e) && (silent !== true || c == 'stop' || !e)){
			this.handleFailureMessage(r)
		}
		console.error('handleFailure', r, c, e)
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
	humanizeFailureMessage(r){
		r = String(r)
		let msg = global.lang.PLAYBACK_OFFLINE_STREAM
		switch(r){
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
				msg = global.lang.SLOW_SERVER
				break
			case 'unsupported format':
			case 'invalid url':
				msg = global.lang.PLAYBACK_UNSUPPORTED_STREAM
				break
			default:
				msg = r
				let code = msg.match(new RegExp('(code|error):? ([0-9]+)'))
				code = String((code && code.length) ? code[2] : msg)
				switch(code){
					case '0':
						msg = global.lang.SLOW_SERVER
						break
					case '400':
					case '401':
					case '403':
						msg = global.lang.PLAYBACK_PROTECTED_STREAM
						break
					case '-1':
					case '404':
					case '410':
						msg = global.lang.PLAYBACK_OFFLINE_STREAM
						break
					case '453':
					case '500':
					case '502':
					case '503':
					case '504':
						msg = global.lang.PLAYBACK_OVERLOADED_SERVER
						break
				}
		}
		return msg
	}
	handleFailureMessage(r){
		global.osd.show(this.humanizeFailureMessage(r), 'fas fa-exclamation-circle faclr-red', '', 'normal')
	}
}

module.exports = Streamer
