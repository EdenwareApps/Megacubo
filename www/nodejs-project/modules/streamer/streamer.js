
const path = require('path'), Events = require('events')
const AutoTuner = require('../tuner/auto-tuner'), StreamInfo = require('./utils/stream-info')
const Zap = require('../zap'), StreamerProxy = require('./utils/proxy')
const Subtitles = require('../subtitles')

const SYNC_BYTE = 0x47
const PACKET_SIZE = 188

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
		this.streamInfoCaching = {} // avoid iptv server abusing
		this.on('failure', data => this.invalidateInfoCache(data.url))
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
	async info(url, retries=2, entry={}){
		if(!url){
			throw global.lang.INVALID_URL
		}
		await this.pingSource(entry.source).catch(console.error)
		let type = false
		const now = global.time()
		const cachingKey = this.infoCacheKey(url), skipSample = entry.skipSample || this.streamInfo.mi.isVideo(url)
		if(cachingKey && this.streamInfoCaching[cachingKey] && now < this.streamInfoCaching[cachingKey].until) {
			if(skipSample || (this.streamInfoCaching[cachingKey].sample && this.streamInfoCaching[cachingKey].sample.length)) {
				return this.streamInfoCaching[cachingKey]
			}
		}
		const nfo = await this.streamInfo.probe(url, retries, Object.assign({skipSample}, entry))
		if(nfo && (nfo.headers || nfo.isLocalFile)) {
			Object.keys(this.engines).some(name => {
				if(this.engines[name].supports(nfo)) {
					type = name
					return true
				}
			})
		}
		if(type){
			if(type == 'ts' && !nfo.sample.length) {
				console.error('empty response', nfo, Object.keys(this.engines).slice(0), this.destroyed)
				throw 'empty response'
			}
			nfo.type = type
			nfo.until = now + 600
			this.streamInfoCaching[cachingKey] = nfo
			return nfo
		} else {
			console.error('unknown stream type', nfo, Object.keys(this.engines).slice(0), this.destroyed)
			throw 'unknown stream type'
		}
	}
	infoCacheKey(url){
		const rawType = this.streamInfo.rawType(url)
		const proto = this.streamInfo.mi.proto(url)
		const domain = this.streamInfo.mi.domain(url)
		if(!rawType) return null
		return [proto, domain, rawType].join('-')
	}
	invalidateInfoCache(url){
		const cachingKey = this.infoCacheKey(url)
		if(cachingKey && this.streamInfoCaching[cachingKey]) {
			delete this.streamInfoCaching[cachingKey]
		}
	}
	isTuning(){
		return global.tuning && global.tuning.active()
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
		if (!data) {
			return 0
		}
		if (Array.isArray(data)) {
			return data.reduce((acc, val) => acc + this.len(val), 0)
		}
		return data.byteLength || data.length || 0
	}
	isPacketized(sample){
		return Buffer.isBuffer(sample) && sample.length >= PACKET_SIZE && sample[0] == SYNC_BYTE && sample[PACKET_SIZE] == SYNC_BYTE
	}
	destroy(){
		this.removeAllListeners()
		this.destroyed = true
		this.engines = {}
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
            vodhls: require('./engines/vod-hls'),
            vodts: require('./engines/vod-ts'),
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
    async intent(data, opts, aside){ // create intent
		if(!data.url){
			throw global.lang.INVALID_URL
		}
		if(!this.throttle(data.url)){
			throw '401'
		}
		let err
		const nfo = await this.info(data.url, 2, Object.assign({allowBlindTrust: true}, data)).catch(e => err = e)
		if(err) {
			if(this.opts.debug){
				console.log('ERR', err)
			}
			if(String(err).match(new RegExp("(: 401|^401$)"))){
				this.forbid(data.url)
			}
			throw err
		}
		return await this.intentFromInfo(data, opts, aside, nfo)
	}
	async pingSource(url){ // ensure to keep any auth
		if(typeof(global.streamerPingSourceTTLs) == 'undefined'){ // using global here to make it unique between any tuning and streamer
			global.streamerPingSourceTTLs = {}            
		}
		if(global.validateURL(url)){
			let now = global.time()
			if(!global.streamerPingSourceTTLs[url] || global.streamerPingSourceTTLs[url] < now){
				console.log('pingSource', global.streamerPingSourceTTLs[url], now)	
				global.streamerPingSourceTTLs[url] = now + 60 // lock while connecting
				let err
				const ret = await global.Download.head({
					url,
					timeout: 10,
					retry: 0,
					receiveLimit: 1,
					followRedirect: true
				}).catch(r => err = r)
				if(typeof(err) != 'undefined') {
					console.warn('pingSource error?: '+ String(err))
				} else {
					console.log('pingSource: ok')	
					if(ret.statusCode < 200 || ret.statusCode >= 400){ // in case of error, renew after 5min
						global.streamerPingSourceTTLs[url] = now + 300
					} else { // in case of success, renew after 10min
						global.streamerPingSourceTTLs[url] = now + 600
					}
				}
			}
		}
	}
	async intentFromInfo(data, opts, aside, nfo){
		opts = Object.assign(Object.assign({}, this.opts), opts || {})
		if(data && data['user-agent']) {
			opts.userAgent = data['user-agent']
		}
		if(data && data['referer']) {
			opts.referer = data['referer']
		}
		let intent
		try {
			intent = new this.engines[nfo.type](data, opts, nfo)
		} catch(err) {
			throw 'Engine "'+ nfo.type +'" not found. '+ err
		}
		if(aside){
			return intent
		} else {
			this.unregisterAllLoadingIntents()
			this.registerLoadingIntent(intent)
			if(this.opts.debug){
				console.log('RUN', intent, opts)
			}
			let err
			await intent.start().catch(e => err = e)
			if(err) {
				if(!this.opts.shadow){
					global.osd.hide('streamer')
				}
				this.unregisterLoadingIntent(intent)
				if(this.opts.debug){
					console.log('ERR', err)
				}
				intent.destroy()
				throw err
			}
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
				await this.commit(intent)
				return intent
			}
		}
	}
	async askExternalPlayer() {
		if(!this.active || global.cordova) return
		const url = this.active.data.url
		const chosen = await global.explorer.dialog([
			{template: 'question', text: global.lang.OPEN_EXTERNAL_PLAYER_ASK, fa: 'fas fa-play'},
			{template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
			{template: 'option', text: global.lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle'}
		], 'yes')
		if(chosen == 'yes') {
			global.ui.emit('external-player', url)
			return true
		}
	}
	reload(){		
		console.warn('RELOADING')
		let data = this.active ? this.active.data : this.lastActiveData
		if(data){
			this.stop()
			process.nextTick(() => this.play(data))
		}
	}
	async commit(intent){
		if(intent){
			if(this.active == intent){
				return true // 'ALREADY COMMITTED'
			} else {
				if(this.opts.debug){
					console.log('COMMITTING', global.traceback())
				}
				if(intent.destroyed){
					console.error('COMMITTING DESTROYED INTENT', global.traceback(), intent)
					return false
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
				intent.once('destroy', () => {
					console.error('streamer intent destroy()')
					if(intent == this.active) {
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
					if(intent == this.active){
						global.ui.emit('streamer-bitrate', bitrate)
					}
				})
				intent.on('fail', err => {
					this.emit('uncommit', intent)
					if(this.opts.debug){
						console.log('INTENT FAILED !!')
					}
					this.handleFailure(intent.data, err).catch(global.displayErr)
				})
				intent.on('codecData', async codecData => {
					if(codecData && intent == this.active){
						global.ui.emit('codecData', codecData)
					}
					if(!global.cordova && !intent.isTranscoding()){
						if(codecData.video && codecData.video.match(new RegExp('(mpeg2video|mpeg4)')) && intent.opts.videoCodec != 'libx264'){
							const openedExternal = await this.askExternalPlayer().catch(console.error)
							if(openedExternal !== true) {
								if((!global.tuning && !this.zap.isZapping) || global.config.get('transcoding-tuning')){
									this.transcode(null, err => {
										if(err) intent.fail('unsupported format')
									})
								} else {
									return intent.fail('unsupported format')
								}
							}
						}
					}
					if(codecData.audio && !codecData.video) { // is an audio stream
						if(global.tuning && global.tuning.opts.name == intent.data.originalName && !this.streamInfo.mi.isRadio(intent.data.originalName)){ // not expecing an audio stream
 							return intent.fail('unsupported format') // fail this audio only stream for tuning resuming
						}
					}
				})
				intent.on('streamer-connect', () => this.uiConnect().catch(console.error))
				if(intent.codecData){
					intent.emit('codecData', intent.codecData)
				}
				this.emit('commit', intent)
				intent.emit('commit')
				await this.uiConnect(intent)
				console.warn('STREAMER COMMIT '+ intent.data.url)
				return true
			}
		} else {
			return 'NO INTENT'
		}
	}
	async getProxyAdapter(intent) {
		let adapter
		if(!intent) {
			intent = this.active
		}
		if(!intent) return
		adapter = intent.findAdapter(null, ['proxy'], a => !a.opts.agnostic)
		if(!adapter) {
			adapter = new StreamerProxy({agnostic: false}) // agnostic mode will not transform to vtt
			intent.connectAdapter(adapter)
			await adapter.start()
		}
		return adapter
	}
	async uiConnect(intent, skipTranscodingCheck){
		if(!intent) intent = this.active
		const data = Object.assign({}, intent.data) // clone it before to change subtitle attr or any other
		if(data.subtitle) {
			const adapter = await this.getProxyAdapter(intent)
			data.subtitle = adapter.proxify(data.subtitle)
		}
		data.engine = intent.type
		if(data.icon){
			data.originalIcon = data.icon
			data.icon = global.icons.url + global.icons.key(data.icon)
		} else {
			data.icon = global.icons.url + global.channels.entryTerms(data).join(',')
		}
		intent.on('outside-of-live-window', () => global.ui.emit('outside-of-live-window'))
		this.emit('streamer-connect', intent.endpoint, intent.mimetype, data)
		if(!skipTranscodingCheck && intent.transcoderStarting){
			global.ui.emit('streamer-connect-suspend')
			if(!this.opts.shadow){
				global.osd.hide('streamer')
			}
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
				intent.transcode().then(async () => {
					await this.uiConnect(intent, true)
					cb(null, intent.transcoder)
				}).catch(err => {
					if(this.active){
						console.error(err)
						cb(err)
						intent.fail('unsupported format', err, intent.codecData)
						silent || intent.fail('unsupported format')
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
		console.error('streamer stop()')
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
				if(this.active.commitTime && watchingDuration > longWatchingThreshold) {
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
				global.ui.emit('share', global.ucWords(global.MANIFEST.name), name, 'https://megacubo.tv/w/' + encodeURIComponent(url.replace('mega://', '')))
			} else {
				url = global.mega.build(name, {url, icon, mediaType: this.active.mediaType})
				global.ui.emit('share', global.ucWords(global.MANIFEST.name), name, url.replace('mega://', 'https://megacubo.tv/w/'))
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
		let rule = 'allow', domain = this.streamInfo.mi.domain(url)
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
		this.throttling[this.streamInfo.mi.domain(url)] = global.time() + this.throttleTTL
	}
}

class StreamerGoNext extends StreamerThrottling {
	constructor(opts){
		super(opts)
		if(!this.opts.shadow){
			global.ui.on('video-ended', () => this.goNext().catch(global.displayErr))
			global.ui.on('video-resumed', () => this.cancelGoNext())
			global.ui.on('stop', () => this.cancelGoNext())
			global.ui.on('go-prev', () => this.goPrev().catch(global.displayErr))
			global.ui.on('go-next', () => this.goNext(true).catch(global.displayErr))
			this.on('pre-play-entry', e => this.saveQueue(e).catch(global.displayErr))
			this.on('streamer-connect', () => this.goNextButtonVisibility().catch(global.displayErr))				
			process.nextTick(() => {
				this.aboutRegisterEntry('gonext', async () => {
					if(this.active.mediaType == 'video'){
						const next = await this.getNext()
						if(next) return {template: 'option', fa: 'fas fa-step-forward', text: global.lang.GO_NEXT, id: 'gonext'}
					}
				}, () => this.goNext().catch(global.displayErr), null, true)
			})
		}
	}
	sleep(ms){
		return new Promise(resolve => setTimeout(resolve, ms))
	}
	async getQueue() {
		let entries = await global.storage.promises.get('streamer-go-next-queue').catch(console.error)
		if(!Array.isArray(entries)) entries = []
		return entries
	}
	async getPrev(offset=0){
		const entry = this.active ? this.active.data : this.lastActiveData
		const entries = await this.getQueue()
		if(entry && entries.length){
			let prev, found = -1
			if(entry.originalUrl) found = entries.findIndex(e => (e.originalUrl || e.url) == entry.originalUrl)
			if(found == -1) found = entries.findIndex(e => e.url == entry.url)
			if(found == -1) return false
			entries.slice(0, found).reverse().some(e => {
				if(e){
					if(offset) {
						offset--
					} else {
						prev = e
						return true
					}
				}
			})
			return prev
		}
	}
	async getNext(offset=0){
		const entry = this.active ? this.active.data : this.lastActiveData
		const entries = await this.getQueue()
		if(entry && entries.length){
			let next, found = -1
			if(entry.originalUrl) found = entries.findIndex(e => (e.originalUrl || e.url) == entry.originalUrl)
			if(found == -1) found = entries.findIndex(e => e.url == entry.url)
			if(found == -1) return false
			entries.slice(found + 1).some(e => {
				if(e){
					if(offset) {
						offset--
					} else {
						next = e
						return true
					}
				}
			})
			return next
		}
	}
	async saveQueue(e){
		if(e.url){
			const entries = global.explorer.pages[global.explorer.path].filter(n => n.url)
			if(entries.length > 1 && entries.some(n => n.url == e.url)){
				entries.forEach((n, i) => {
					if(n.renderer) delete entries[i].renderer
				})
				global.storage.set('streamer-go-next-queue', entries, true)
			}
		}
	}
	async goNextButtonVisibility() {
		const next = await this.getNext()
		global.ui.emit('enable-player-button', 'next', !!next)
	}
	async goPrev(){
		let offset = 0
		const msg = global.lang.GOING_PREVIOUS
		global.osd.show(msg, 'fa-mega spin-x-alt', 'go-next', 'persistent')
		this.goingNext = true
		while(true) {
			const prev = await this.getPrev(offset), ret = {}
			if(!prev) break
			const isMega = global.mega.isMega(prev.url)
			if(!isMega) {
				ret.info = await this.info(prev.url, 2, Object.assign({allowBlindTrust: true, skipSample: true}, prev)).catch(err => ret.err = err)
				if(ret.err) {
					offset++
					continue // try prev one
				}
			}
			if(this.goingNext !== true) return // cancelled
			let err
			if(isMega) {
				await this.play(prev).catch(err => err = err)
			} else {
				await this.intentFromInfo(prev, {}, undefined, ret.info).catch(e => err = e)
			}
			if(err) {
				offset++
				continue // try prev one
			} else {
				break
			}
		}
		this.goingNext = false
		global.osd.hide('go-next')
	}
	async goNext(immediate){
		let offset = 0, start = global.time(), delay = immediate ? 0 : 5
		const msg = delay ? global.lang.GOING_NEXT_SECS_X.format(delay) : global.lang.GOING_NEXT
		global.osd.show(msg, 'fa-mega spin-x-alt', 'go-next', 'persistent')
		this.goingNext = true
		while(true) {
			const next = await this.getNext(offset), ret = {}
			if(!next) break
			const isMega = global.mega.isMega(next.url)
			if(!isMega) {
				ret.info = await this.info(next.url, 2, Object.assign({allowBlindTrust: true, skipSample: true}, next)).catch(err => ret.err = err)
				if(ret.err) {
					offset++
					continue // try next one
				}
			}
			const now = global.time(), elapsed = now - start
			if(this.goingNext !== true) return // cancelled
			let err
			if(elapsed < delay) await this.sleep((delay - elapsed) * 1000)
			if(isMega) {
				await this.play(next).catch(err => err = err)
			} else {
				await this.intentFromInfo(next, {}, undefined, ret.info).catch(e => err = e)
			}
			if(err) {
				offset++
				continue // try next one
			} else {
				break
			}
		}
		this.goingNext = false
		global.osd.hide('go-next')
	}
	cancelGoNext(){
		delete this.goingNext
		global.osd.hide('go-next')
	}
}

class StreamerTracks extends StreamerGoNext {
	constructor(opts){
		super(opts)
		if(!this.opts.shadow){
			global.ui.on('audioTracks', tracks => {
				if(this.active){
					this.active.audioTracks = tracks
				}
			})
			global.ui.on('subtitleTracks', tracks => {
				if(this.active){
					this.active.subtitleTracks = tracks
					if(!this.active.subtitleAutoConfigured && tracks.length && global.config.get('subtitles')) {
						this.active.subtitleAutoConfigured = true
						const id = tracks[0].id || 0
						this.active.subtitleTrack = id
						global.ui.emit('streamer-subtitle-track', id)
					}
				}
			})
		}
	}
	getTrackOptions(tracks, activeTrack){
		const sep = ' &middot; ', opts = Object.keys(tracks).map((name, i) => {
			let opt = {template: 'option', text: name, id: 'track-'+ i}
			if(tracks[name].url == activeTrack) opt.fa = 'fas fa-play'
			return opt
		})
		let names = opts.map(o => o.text.split(sep))
		for(let i = 0; i < names[0].length; i++){
			if(names.slice(1).map(n => n[i] || '').every(n => n == names[0][i])){
				names.forEach((n, j) => {
					names[j][i] = ''
				})
			}
		}
		names.forEach((n, i) => {
			opts[i].otext = opts[i].text
			opts[i].text = n.filter(l => l).join(sep)
		})
		return opts
	}
	getExtTrackOptions(tracks, activeTrack){
		return this.removeCommonAttributes(tracks).map(track => {
			let text = track.label || track.name
			if(!text){				
				if(track.lang){
					text = track.lang +' '+ String(track.id)
				} else if(track.language){
					text = track.language +' '+ String(track.id)
				} else {
					text = String(track.id)
				}
			}
			let opt = {template: 'option', text, id: 'track-'+ track.id}
			if(track.id == activeTrack) opt.fa = 'fas fa-check-circle'
			return opt
		})
	}
	removeCommonAttributes(arr) {
		const valueCounts = {}
		arr.forEach(obj => {
			for (const key in obj) {
				valueCounts[key] = valueCounts[key] || {};
				valueCounts[key][obj[key]] = (valueCounts[key][obj[key]] || 0) + 1
			}
		})
		const totalObjects = arr.length
		const attributesToDelete = []
		for (const key in valueCounts) {
			const values = Object.keys(valueCounts[key])
			if (values.length !== totalObjects) {
				attributesToDelete.push(key)
			}
		}
		attributesToDelete.length && arr.forEach(obj => {
			attributesToDelete.forEach(attr => {
				delete obj[attr]
			})
		})
		return arr
	}
	async showQualityTrackSelector(){
		if(!this.active) return
		let activeTrackId, activeTrack = this.active.getActiveQualityTrack()
		let tracks = await this.active.getQualityTracks(true)
		let opts = this.getTrackOptions(tracks, activeTrack)
		opts.forEach(o => {
			if(o.fa) activeTrackId = o.id
		})
		opts.unshift({template: 'question', text: global.lang.SELECT_QUALITY})
		let ret = await global.explorer.dialog(opts, activeTrackId)
		if(ret){
			let uri, bandwidth
			opts.some(o => {
				if(o.id != ret) return
				const track = tracks[o.otext || o.text]
				if(track) {
					uri = this.active.prx.proxify(track.url)
					bandwidth = track.bandwidth
					return true
				}
			})
			if(uri && uri != this.active.endpoint){
				this.active.setActiveQualityTrack(uri, bandwidth)
				this.active.endpoint = uri
				await this.uiConnect()
			}
		}
		return {ret, opts}
	}
	async showAudioTrackSelector(){
		if(!this.active) return
		let activeTrackId, activeTrack = this.active.audioTrack, tracks = this.active.getAudioTracks(), opts = this.getExtTrackOptions(tracks, activeTrack)
		opts.forEach(o => {
			if(o.fa) activeTrackId = o.id
		})
		opts.unshift({template: 'question', fa: 'fas fa-volume-up', text: global.lang.SELECT_AUDIO})
		let ret = await global.explorer.dialog(opts, activeTrackId)
		console.warn('TRACK OPTS RET', ret, opts)
		if(ret){
			const n = ret.replace(new RegExp('^track\\-'), '')
			this.active.audioTrack = n
			global.ui.emit('streamer-audio-track', n)
		}
		return {ret, opts}
	}
	async showSubtitleTrackSelector(){
		if(!this.active) return
		let activeTrackId, activeTrack = this.active.subtitleTrack, tracks = this.active.getSubtitleTracks(), opts = this.getExtTrackOptions(tracks, activeTrack)
		let hasActive = opts.some(o => !!o.fa)
		opts.unshift({template: 'option', text: global.lang.NONE, id: 'track--1', fa: hasActive ? undefined : 'fas fa-check-circle'})
		opts.forEach(o => {
			if(o.fa) activeTrackId = o.id
		})
		opts.unshift({template: 'question', fa: 'fas fa-comments', text: global.lang.SELECT_SUBTITLE})
		if(!global.cordova && this.active.mediaType == 'video') {
			opts.push({template: 'option', fa: 'fas fa-search-plus', details: 'Opensubtitles.com', id: 'search', text: global.lang.SEARCH})
		}
		let ret = await global.explorer.dialog(opts, activeTrackId)
		if(ret == 'search') {
			await this.showSearchSubtitleTrackSelector()
		} else if(ret) {
			const n = ret.replace(new RegExp('^track\\-'), '')
			this.active.subtitleTrack = n
			global.ui.emit('streamer-subtitle-track', n)
			global.config.set('subtitles', ret != '-1')
		}
	}
	async showSearchSubtitleTrackSelector(query, ask){
		if(!this.active) return		
		if(!this.subtitles) this.subtitles = new Subtitles()
		if(!query) query = global.lists.terms(this.active.data.name).join(' ')
		let err, hasActive, activeTrackId = '', cancelId = 'track--1'
		let extraOpts = []
		extraOpts.push({template: 'option', text: global.lang.SEARCH, id: 'submit', fa: 'fas fa-search'})
		extraOpts.push({template: 'option', text: global.lang.CANCEL, id: cancelId, fa: 'fas fa-times-circle'})
		if(!query || ask) {
			query = await global.explorer.prompt({
				question: global.lang.ADJUST_SEARCH_TERMS,
				defaultValue: query,
				placeholder: query,
				fa: 'fas fa-search-plus',
				extraOpts
			})
		}
		global.osd.show(global.lang.SEARCHING, 'fas fa-circle-notch fa-spin', 'search-subs', 'persistent')
		const results = await this.subtitles.search(query).catch(e => err = e)
		global.osd.hide('search-subs')
		if(err) global.displayErr(err)
		if(!Array.isArray(results) || !results.length) {
			if(query && query != cancelId) {
				err || global.displayErr(global.lang.NOT_FOUND +', '+ global.lang.X_RESULTS.format(0))
				await this.showSearchSubtitleTrackSelector(query, true)
			}
			return
		}
		const opts = results.map(r => {
			return {
				template: 'option',
				text: r.name,
				id: r.url
			}
		})
		opts.push({template: 'option', text: global.lang.NONE, id: cancelId, fa: hasActive ? undefined : 'fas fa-check-circle'})
		opts.push({template: 'option', text: global.lang.SEARCH, id: 'search', fa: 'fas fa-search'})
		/*
		opts.forEach(o => {
			if(o.fa) activeTrackId = o.id
		})
		*/
		opts.unshift({template: 'question', fa: 'fas fa-comments', text: global.lang.SELECT_SUBTITLE})
		const ret = await global.explorer.dialog(opts, activeTrackId)
		console.error('SELECTED SUB OK: '+ ret)
		if(ret == 'search') {
			await this.showSearchSubtitleTrackSelector(query, true)
		} else if(ret != cancelId) {
			const i = results.findIndex(r => r.url == ret)
			this.active.subtitleTrack = ret
			global.ui.emit('streamer-add-subtitle-track', results[i])
			global.config.set('subtitles', true)
		} else {
			global.config.set('subtitles', false)
		}
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
			this.aboutRegisterEntry('tracks', async () => {
				if(this.active.getQualityTracks) {
					const tracks = await this.active.getQualityTracks()
					if(Object.keys(tracks).length > 1) {
						return {template: 'option', fa: 'fas fa-bars', text: global.lang.SELECT_QUALITY, id: 'tracks'}
					}
				}
			}, this.showQualityTrackSelector.bind(this), null, true)
			this.aboutRegisterEntry('audiotracks', () => {
				return {template: 'option', fa: 'fas fa-volume-up', text: global.lang.SELECT_AUDIO, id: 'audiotracks'}
			}, this.showAudioTrackSelector.bind(this), null, true)
			this.aboutRegisterEntry('subtitletracks', () => {
				return {template: 'option', fa: 'fas fa-comments', text: global.lang.SELECT_SUBTITLE, id: 'subtitletracks'}
			}, this.showSubtitleTrackSelector.bind(this), null, true)
			this.aboutRegisterEntry('streamInfo', () => {
				if(this.active && this.active.data.url.indexOf('://') != -1) {
					return {template: 'option', fa: 'fas fa-info-circle', text: global.lang.KNOW_MORE, id: 'streamInfo'}
				}
			}, this.showStreamInfo.bind(this), 99, true)
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
	async showStreamInfo(){
		if(!this.active) return
		const domain = global.Download.domain(this.active.data.url)
		const addr = await global.Download.stream.lookup.lookup(domain, {})
		const countryCode = await global.cloud.getCountry(addr).catch(global.displayErr)
		const country = global.lang.countries.getCountryName(countryCode, global.lang.locale)
		await global.explorer.info(global.lang.KNOW_MORE, 'Broadcast server country: '+ (country || countryCode))
	}
	aboutRegisterEntry(id, renderer, action, position, more) {
		if(this.opts.shadow) return
		let e = {id, renderer, action}
		let k = more ? 'moreAboutEntries' : 'aboutEntries'
		if(this[k]){
			if(typeof(position) == 'number' && position < this[k].length){
				this[k].splice(position, 0, e)
			} else {
				this[k].push(e)
			}
		} else {
			console.error('aboutRegisterEntry ERR '+ k, this[k])
		}
	}
	async aboutTrigger(id, more) {
		let k = more ? 'moreAboutEntries' : 'aboutEntries'
		const found = this[k].some(e => {
			if(e.id == id) {
				this.active && e.action(this.active.data)
				return true
			}
		})
		if(!found && !more) {
			return await this.aboutTrigger(id, true)
		}
		return found
	}
	async aboutStructure(short){
		const benchmarks = {}
		const results = await Promise.allSettled(this.aboutEntries.map(async o => {
			benchmarks[o.id] = global.time()
			const ret = await o.renderer(this.active.data, short)
			benchmarks[o.id] = global.time() - benchmarks[o.id]
			return ret
		}))
		let ret = [], textPos = -1, titlePos = -1
		results.forEach(r => {
			if(r.status == 'fulfilled' && r.value){
				if(Array.isArray(r.value)){
					ret.push(...r.value)
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
					ret[textPos].text += ' '+ r.text
					return false
				}
			}
			return true
		})
		ret.some((r, i) => {
			if(r.template == 'message'){
				// ret[i].text = '<div>'+ r.text +' '+ Object.keys(benchmarks).map(id => id +': '+ parseFloat(benchmarks[id]).toFixed(1)).join(', ') +'</div>'
				ret[i].text = '<div>'+ r.text +'</div>'
				return true
			}
		})
		return ret
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
							ret.push(...r.value)
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
		const currentSpeed = parseInt((this.speedoAdapter || this.active).currentSpeed || 0), icon = '<i class=\'fas fa-circle {0}\'></i> '
		if(this.active.bitrate && !this.active.data.isLocal){
			const tuneable = this.isTuneable
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
				if(this.downlink && !isNaN(this.downlink) && this.active.bitrate && (this.downlink < this.active.bitrate)){
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
		} else if(currentSpeed && !isNaN(currentSpeed) && currentSpeed >= 0) {
			text += icon.format('faclr-orange') +' '+ global.kbsfmt(currentSpeed)
		}
		let meta = [this.active.type.toUpperCase()], dimensions = this.active.dimensions()
		dimensions && meta.push(dimensions)
		if(this.active.codecData && (this.active.codecData.video || this.active.codecData.audio)){
			let codecs = [this.active.codecData.video, this.active.codecData.audio].filter(s => s)
			codecs = codecs.map(c => c = c.replace(new RegExp('\\([^\\)]*[^A-Za-z\\)][^\\)]*\\)', 'g'), '').replace(new RegExp(' +', 'g'), ' ').trim())
			meta.push(...codecs)
		}
		this.active.transcoder && meta.push(global.lang.TRANSCODING.replaceAll('.', ''))
		if(text) text = '<div>'+ text +'</div>'
		text += '<div>' + meta.join(' | ') +'</div>'
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
        	global.explorer.info(title, text.trim())
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
        	global.explorer.info(title, text.trim())
		}
    }
	aboutCallback(chosen){
		console.log('about callback', chosen)
		if(this.active && this.active.data){
			this.aboutEntries.concat(this.moreAboutEntries).some(o => {
				if(o.id && o.id == chosen){
					if(typeof(o.action) == 'function'){						
                        const ret = o.action(this.active.data)
                        ret && ret.catch && ret.catch(global.displayErr)
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
			this.zap = new Zap()
			global.uiReady(() => {
				global.explorer.on('open', path => {
					if(global.tuning && path.indexOf(global.lang.STREAMS) != -1){
						global.tuning.destroy()
					}
				})
			})
			global.ui.on('streamer-duration', duration => {
				if(this.active && this.active.mediaType == 'video' && this.active.type != 'vodhls' && this.active.info.contentLength){
					const bitrate = (this.active.info.contentLength / duration) * 8
					if(bitrate > 0){
						this.active.emit('bitrate', bitrate)
						this.active.bitrate = bitrate
						global.ui.emit('streamer-bitrate', bitrate)
					}
				}
			})
			global.ui.on('streamer-seek-failure', async () => {
				const ret = await global.explorer.dialog([
					{template: 'question', fa: 'fas fa-warn-triangle', text: 'Force MPEGTS broadcasts to be seekable ('+ global.lang.SLOW +')'},
					{template: 'message', text: global.lang.ENABLE_MPEGTS_SEEKING},
					{template: 'option', text: global.lang.NO, fa: 'fas fa-times-circle', id: 'no'},
					{template: 'option', text: global.lang.YES, fa: 'fas fa-check-circle', id: 'yes'}
				], 'no')
				if(ret == 'yes'){
					global.config.set('ffmpeg-broadcast-pre-processing', 'mpegts')
					this.reload()
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
	async playFromEntries(entries, name, megaURL, txt, connectId, mediaType, preferredStreamURL, silent){
		if(this.opts.shadow){
			throw 'in shadow mode'
		}
		const loadingEntriesData = [global.lang.AUTO_TUNING, name]
		console.warn('playFromEntries', name, connectId, silent)
		global.explorer.setLoadingEntries(loadingEntriesData, true, txt)
		silent || global.osd.show(global.lang.TUNING_WAIT_X.format(name) + ' 0%', 'fa-mega spin-x-alt', 'streamer', 'persistent')
		global.tuning && global.tuning.destroy()
		entries = await global.watching.order(entries)
		if(this.connectId != connectId){
			throw 'another play intent in progress'
		}
		console.log('tuning', name, entries.length)
		let tuning = new AutoTuner(entries, {preferredStreamURL, name, megaURL, mediaType})
		global.tuning = tuning
		tuning.txt = txt
		tuning.on('progress', i => {
			if(!silent && i.progress && !isNaN(i.progress)){
				global.osd.show(global.lang.TUNING_WAIT_X.format(name) +' '+ i.progress + '%', 'fa-mega spin-x-alt', 'streamer', 'persistent')
			}
		})
		tuning.on('finish', () => {
			tuning.destroy()
		})
		tuning.once('destroy', () => {
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
			silent || global.osd.show(global.lang.NONE_STREAM_WORKED_X.format(name), 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal')
			this.emit('hard-failure', entries)
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
		if(this.active && !global.config.get('play-while-loading')){
			this.stop()
		}
		if(global.tuning){
			if(!global.tuning.destroyed && global.tuning.opts.megaURL && global.tuning.opts.megaURL == e.url){
				return await this.tune(e)
			}
			global.tuning.destroy()
		}
		const connectId = global.time()
		this.connectId = connectId
		this.emit('connecting', connectId)
		const isMega = global.mega.isMega(e.url), txt = isMega ? global.lang.TUNING : undefined
		const opts = isMega ? global.mega.parse(e.url) : {mediaType: 'live'};		
		const loadingEntriesData = [e, global.lang.AUTO_TUNING]
		silent || global.explorer.setLoadingEntries(loadingEntriesData, true, txt)
		console.warn('STREAMER INTENT', e, results, traceback());
		let succeeded
		this.emit('pre-play-entry', e)
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
				silent || global.explorer.setLoadingEntries(loadingEntriesData, false)
				throw 'another play intent in progress'
			}
		} else if(isMega && !opts.url) {
			let name = e.name
			if(opts.name){
				name = opts.name
			}
			let terms = opts.terms || global.lists.terms(name, false)
			silent || global.osd.show(global.lang.TUNING_WAIT_X.format(name), 'fa-mega spin-x-alt', 'streamer', 'persistent')
			const listsReady = await global.lists.manager.waitListsReady(10)
			if(listsReady !== true) {				
				silent || global.osd.hide('streamer')
				throw global.lang.WAIT_LISTS_READY
			}
			let entries = await global.lists.search(terms, {
				type: 'live',
				safe: !global.lists.parentalControl.lazyAuth(),
                limit: 1024
			})
			if(this.connectId != connectId){
				silent || global.explorer.setLoadingEntries(loadingEntriesData, false)
				throw 'another play intent in progress'
			}		
			// console.warn('ABOUT TO TUNE', terms, name, JSON.stringify(entries), opts)
			entries = entries.results		
			if(entries.length){
				entries = entries.map(s => {
					s.originalName = name
					if(s.rawname) s.rawname = name
					s.originalUrl = e.url
					s.programme = e.programme
					return s
				})
				succeeded = await this.playFromEntries(entries, name, e.url, txt, connectId, opts.mediaType, e.preferredStreamURL || this.findPreferredStreamURL(name), silent)
			}
			if(!succeeded){
				global.osd.hide('streamer')
				this.connectId = false
				this.emit('connecting-failure', e)				
				if(!silent){
					const err = global.lists.activeLists.length ? 
						global.lang.NONE_STREAM_WORKED_X.format(name) : 
						(
							(global.lists && Object.keys(global.lists).length) ? global.lang.NO_LIST : global.lang.NO_LISTS_ADDED
						)
					global.osd.show(err, 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal')
					global.ui.emit('sound', 'static', 25)
					this.emit('hard-failure', entries)
				}
			}
		} else {
			if(opts.url){
				e = Object.assign(Object.assign({}, e), opts)
			}
			console.warn('STREAMER INTENT', e)
			let terms = global.channels.entryTerms(e)
			this.setTuneable(!this.streamInfo.mi.isVideo(e.url) && global.channels.isChannel(terms))
			silent || global.osd.show(global.lang.CONNECTING +' '+ e.name + '...', 'fa-mega spin-x-alt', 'streamer', 'persistent')
			let hasErr, intent = await this.intent(e).catch(r => hasErr = r)
			if(typeof(hasErr) != 'undefined'){
				if(this.connectId != connectId){
					silent || global.explorer.setLoadingEntries(loadingEntriesData, false)
					throw 'another play intent in progress'
				}		
				console.warn('STREAMER INTENT ERROR', hasErr, traceback())
				global.ui.emit('sound', 'static', 25)
				this.connectId = false
				this.emit('connecting-failure', e)
				this.handleFailure(e, hasErr).catch(global.displayErr)
			} else {
				if(intent.mediaType != 'live'){
					this.setTuneable(false)
				}
				console.warn('STREAMER INTENT SUCCESS', intent, e)
				succeeded = true
			}
		}
		silent || global.explorer.setLoadingEntries(loadingEntriesData, false)
		return succeeded
	}
	play(e, results, silent){
		return this.playPromise(e, results, silent).catch(silent ? console.error : global.displayErr)
	}
	async tune(e){
		if(this.opts.shadow) return
		if(!this.isEntry(e)){
			if(this.active){
				e = this.active.data
			}		
		}
		if(this.isEntry(e)){
			if(this.active && !global.config.get('play-while-loading')){
				this.stop()
			}
			const ch = global.channels.isChannel(global.channels.entryTerms(e))
			if(ch){
				e.name = ch.name
			}
			const same = global.tuning && !global.tuning.finished && !global.tuning.destroyed && (global.tuning.has(e.url) || global.tuning.opts.megaURL == e.url)
			const loadingEntriesData = [e, global.lang.AUTO_TUNING]
			console.log('tuneEntry', e, same)
			if(same){
				let err
				await global.tuning.tune().catch(e => err = e)
				global.explorer.setLoadingEntries(loadingEntriesData, false)
				if(err) {
					if(err != 'cancelled by user'){
						this.emit('connecting-failure', e)
						console.error('tune() ERR', err)
						global.osd.show(global.lang.NO_MORE_STREAM_WORKED_X.format(e.name), 'fas fa-exclamation-triangle faclr-red', 'streamer', 'normal')
					}
					return
				}
				this.setTuneable(true)
			} else {
				if(ch) {
					e.url = global.mega.build(ch.name, {terms: ch.terms})
				} else {
					const name = e.originalName || e.name
					let terms = await global.search.termsFromEntry(e, false)
					if(!terms) terms = global.lists.terms(name)
					if(Array.isArray(terms)) terms = terms.join(' ')
					e.url = global.mega.build(name, {terms})
				}
				this.play(e)
			}
			return true
		}
	}
	async handleFailure(e, r, silent, doTune){		
		let c = doTune ? 'tune' : 'stop', trace = traceback()
		if(!this.isEntry(e)){
			if(this.active){
				e = this.active.data
			} else {
				e = this.lastActiveData
			}
		}
		if(!doTune || !global.config.get('play-while-loading')){
			this.stop({err: r, trace})
		}
		this.emit('failure', e)		
		if(this.opts.shadow) return
		if(this.zap.isZapping){
			c = 'stop'
		} else if(c != 'tune' && e && (global.tuning && global.tuning.has(e.url))){
			c = 'tune'
		}
		if((r != null && typeof(r) != 'undefined') && (c != 'tune' || !e) && (silent !== true || c == 'stop' || !e)){
			this.handleFailureMessage(r)
		}
		console.error('handleFailure', r, c, e)
		const isMega = e && global.mega.isMega(e.url)
		if(!isMega && e) {
			if(c == 'stop') {
				const terms = global.channels.entryTerms(e)
				const ch = global.channels.isChannel(terms)
				if(ch) {
					const skips = [global.lang.STREAMS, global.lang.IPTV_LISTS, global.lang.CATEGORY_MOVIES_SERIES]
					if(skips.every(s => global.explorer.path.indexOf(s) == -1)) {
						const chosen = await global.explorer.dialog([
							{template: 'question', text: global.lang.PLAYBACK_OFFLINE_STREAM, fa: 'fas fa-exclamation-triangle faclr-red'},
							{template: 'message', text: global.lang.PLAY_ALTERNATE_ASK},
							{template: 'option', text: global.lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
							{template: 'option', text: global.lang.NO, id: 'no', fa: 'fas fa-times-circle'}
						], 'yes')
						if(chosen == 'yes') c = 'tune'
					}
				}
			}
			if(c != 'stop'){
				if(await this.tune(e)) return
				if(!global.config.get('play-while-loading')){
					this.stop({err: 'tune failure', trace})
				}
			}
		}
		this.emit('hard-failure', [e])
	}
	humanizeFailureMessage(r){
		r = String(r)
		let msg = global.lang.PLAYBACK_OFFLINE_STREAM, status = ''
		switch(r) {
			case 'playback':
				msg = lang.PLAYBACK_ERROR
				break
			case 'network':
				msg = lang.PLAYBACK_OVERLOADED_SERVER
				break
			case 'request error':
				msg = global.lang.PLAYBACK_OFFLINE_STREAM
				status = r
				break
			case 'timeout':
				msg = global.lang.SLOW_SERVER
				status = 'timeout'
				break
			case 'unsupported format':
			case 'invalid url':
				msg = global.lang.PLAYBACK_UNSUPPORTED_STREAM
				break
			default:
				msg = r
				let code = msg.match(new RegExp('(code|error):? ([0-9]+)'))
				code = String((code && code.length) ? code[2] : msg)
				const http = require('http');
				if(http.STATUS_CODES[code]) {
					status = http.STATUS_CODES[code].toLowerCase()
				}
				switch(code){
					case '-7':
						msg = 'Worker crashed.'
						status = 'worker exited'
						break
					case '0':
						msg = global.lang.SLOW_SERVER
						status = 'timeout'
						break
					case '400':
					case '401':
					case '403':
						msg = global.lang.PLAYBACK_PROTECTED_STREAM
						break
					case '-1':
					case '404':
					case '406':
					case '410':
						msg = global.lang.PLAYBACK_OFFLINE_STREAM
						if(r == -1) status = 'unreachable'
						break
					case '421':
					case '453':
					case '500':
					case '502':
					case '503':
					case '504':
						msg = global.lang.PLAYBACK_OVERLOADED_SERVER
						break
				}
		}
		if(status) {
			msg += ': '+ global.ucFirst(status)
		}
		return msg
	}
	handleFailureMessage(r){
		process.nextTick(() => {
			global.osd.show(this.humanizeFailureMessage(r), 'fas fa-exclamation-triangle faclr-red', 'failure', 'normal')
		})
	}
}

module.exports = Streamer
