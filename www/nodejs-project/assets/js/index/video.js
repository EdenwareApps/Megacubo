
class VideoControl extends EventEmitter {
	constructor(container){
		super()
		this.container = container
		this.innerContainer = this.container.querySelector('div')
		if(!this.innerContainer){
			this.innerContainer = document.createElement('div')
			this.container.appendChild(this.innerContainer)
		}
		this.adapters = {}
		this.adapter = ''
		this.current = null
		this.state = ''
		this.hasErr = null
		this.clearErrTimer = null
		this.uiVisibility = true
		this.currentAudioTracks = null
		this.currentSubtitleTracks = null
	}
	uiVisible(visible){
		if(this.current){
			this.uiVisibility = visible
			return this.current.uiVisible(visible)
		}
	}
	time(s){
		if(this.current){
			if(typeof(s) == 'number'){
				return this.current.time(s)
			}
			return this.current.time()
		}
		return 0
	}
	duration(){
		if(this.current){
			let r = this.current.duration
			if(isNaN(r)){
				return 0
			}
			if(r === Infinity){
				if(this.current.object.buffered.length){
					for(let i=0; i < this.current.object.buffered.length; i++){
						r = this.current.object.buffered.end(i)
					}
				} else {
					r = this.current.time() + 2
				}
			}
			return r
		}
		return 0
	}
	ratio(s){
		if(this.current){
			if(typeof(s) == 'number'){
				return this.current.ratio(s)
			}
			return this.current.ratio()
		}
		return 0
	}
	playbackRate(rate){
		if(this.current){
			if(typeof(rate) == 'number'){
				return this.current.playbackRate(rate)
			}
			return this.current.playbackRate()
		}
		return 1
	}
	videoRatio(){
		if(this.current){
			return this.current.videoRatio()
		}
		return 0
	}
	show(){
		const h = $('html'), useCurtains = config['fx-nav-intensity']
		if(useCurtains){
			h.removeClass('curtains-static').removeClass('curtains-close').addClass('curtains')
		}
		if(this.revealTimer){
			clearTimeout(this.revealTimer)
		}
		this.revealTimer = setTimeout(() => {
			h.addClass('playing')
			if(useCurtains){
				h.removeClass('curtains')
			}
			$(document.querySelector('iframe').contentWindow.document.body).addClass('video')
			if(!(this.current instanceof VideoControlAdapterAndroidNative)){
				this.container.style.display = 'flex'
				this.container.querySelectorAll('video, audio').forEach(e => {
					e.style.display = (e == this.current.object) ? 'block' : 'none'
				})
			}
		}, 400)
	}
	hide(){
		if(this.revealTimer){
			clearTimeout(this.revealTimer)
		}
		const h = $('html'), useCurtains = config['fx-nav-intensity']
		h.removeClass('playing')
		if(useCurtains){
			h.addClass('curtains-static').removeClass('curtains').removeClass('curtains-close')
			setTimeout(() => {
				h.addClass('curtains-close')
			}, 0)
		}
		this.container.style.display = 'none'
	}
	resume(){
		if(this.current){
			if(this.state == 'ended'){
				this.current.restart()
			} else {
				this.current.resume()
			}
		}
	}
	pause(){
		if(this.current){
			this.current.pause()
		}
	}
	volume(l){
		if(this.current){
			this.current.volume(l)
		}
	}
	load(src, mimetype, cookie, mediatype){
		if(this.current){
			this.current.unload()
			this.current = null
		}
		this.state = 'loading'
		if(!this.suspendStateChangeReporting) this.emit('state', this.state)
		if(window.plugins && window.plugins.megacubo){
			this.setup('native', VideoControlAdapterAndroidNative)
		} else {
			let m = mimetype.toLowerCase()
			if(m.indexOf('mpegurl') != -1){
				this.setup('html5h', VideoControlAdapterHTML5HLS)
			} else if(m.indexOf('mp2t') != -1){
				this.setup('html5t', VideoControlAdapterHTML5TS)
			} else if(m.indexOf('audio/') != -1){
				this.setup('html5a', VideoControlAdapterHTML5Audio)
			} else {
				this.setup('html5v', VideoControlAdapterHTML5Video)
			}
		}
		this.current.errorsCount = 0
		this.current.load(src, mimetype, cookie, mediatype)
		this.show()
		this.current.volume(config['volume'])
		document.body.style.backgroundColor = 'transparent'
		return this.current
	}
	setup(adapter, cls){
		this.adapter = adapter
		if(typeof(this.adapters[this.adapter]) == 'undefined'){
			const a = new (cls)(this.innerContainer)
			a.on('state', s => {
				if(!this.current) return
				this.state = this.current ? this.current.state : ''
				if(!this.state && this.hasErr){
					this.state = 'error'
				}
				if(!this.suspendStateChangeReporting) this.emit('state', this.state, this.hasErr)
			})
			a.on('setup-ratio', r => {
				if(!this.current) return
				this.emit('setup-ratio', r)
			})
			a.on('timeupdate', () => {
				if(!this.current) return
				this.emit('timeupdate')
			})
			a.on('durationchange', () => {
				if(!this.current) return
				this.emit('durationchange', this.uiVisibility)
			})
			a.on('request-transcode', () => {
				if(!this.current) return
				this.emit('request-transcode')
			})
			a.on('audioTracks', tracks => {
				if(!this.current) return
				if(!this.equals(tracks, this.currentAudioTracks)){
					this.currentAudioTracks = tracks
					this.emit('audioTracks', tracks)
				}
			})
			a.on('subtitleTracks', tracks => {
				if(!this.current) return
				if(!this.equals(tracks, this.currentSubtitleTracks)){
					this.currentSubtitleTracks = tracks
					this.emit('subtitleTracks', tracks)
				}
			})
			a.on('error', (err, fatal) => {
				if(!this.current){
					try { // a.disconnect() is not a function
						a.disconnect()
						a.unload()
					} catch(e) { }
					return
				}
				if(this.clearErrTimer){
					clearTimeout(this.clearErrTimer)
				}
				if(fatal === true){
					this.state = 'error'
					if(!this.suspendStateChangeReporting) this.emit('state', this.state, err)
					a.unload()
				} else {
					this.hasErr = String(err)
					this.clearErrTimer = setTimeout(() => {
						this.hasErr = null
					}, 5000)
				}
			})
			a.on('ended', (err, fatal) => {
				if(!this.current) return
				this.state = 'ended'
				if(!this.suspendStateChangeReporting) this.emit('state', this.state)
			})
			a.config = config
			this.adapters[this.adapter] = a
		}
		this.current = this.adapters[this.adapter]
	}
    equals(a, b){
		return a && b && a.length == b.length ? a.every((r, i) => {
			return a[i] === b[i]
		}) : false
    }
	audioTracks(){
		if(this.current){
			return this.current.audioTracks()
		}
		return []
	}
	audioTrack(trackId){
		if(this.current){
			this.current.audioTrack(trackId)
		}
	}
	subtitleTracks(){
		if(this.current){
			return this.current.subtitleTracks()
		}
		return []
	}
	subtitleTrack(trackId){
		if(this.current){
			this.current.subtitleTrack(trackId)
		}
	}
	unload(){
		console.log('unload', traceback())
		if(this.current){
			console.log('unload')
			this.hide()
			this.current.unload()
			this.current = null
			this.state = ''
			if(!this.suspendStateChangeReporting) this.emit('state', this.state)
		}
	}
}

class VideoControlAdapter extends EventEmitter {
	constructor(container){
		super()
		this.container = container
		this.active = false
	}
}

class VideoControlAdapterHTML5 extends VideoControlAdapter {
	constructor(container){
		super(container)
        this.lastSeenTime = 0
		this.state = ''
		this._ratio = 0
		this.hasReceivedRatio = false
		this.uiVisibility = true
		this.currentSrc = ''
		this.currentMimetype = ''
	}
	setup(tag){
		console.log('adapter setup')
		this.object = this.container.querySelector(tag)
	}
	uiVisible(visible){
		this.uiVisibility = visible
	}
	connect(){
		this.suspendStateChangeReporting = false
		this.object.currentTime = 0
		const v = $(this.object)
		v.off()
		if(!this.object.parentNode){
			this.container.appendChild(this.object)
		}
        v.on('click', event => {
            let e = (event.target || event.srcElement)
            if(e.tagName && e.tagName.toLowerCase() == tag){
				this.emit('click')
            }
        })
		const onerr = e => {
			if(this.object.error){
				e = this.object.error
			}
			const t = this.time()
			const errStr = e ? String(e.message ? e.message : e) : 'unknown error'
			const isFailed = this.object.error || this.object.networkState == 3 || this.object.readyState < 2 || errStr.match(new RegExp('(pipeline_error|demuxer)', 'i'))
			console.error('Video error', t, this.errorsCount, e, errStr, this.object.networkState +', '+ this.object.readyState, isFailed)
			if(isFailed){
				this.errorsCount++
				if(this.errorsCount >= (t > 0 ? 20 : 2)){
					this.emit('error', String(e), true)
				} else {
					const c = this.errorsCount // load() will reset the counter
					this.suspendStateChangeReporting = true
					this.unload()
					setTimeout(() => {
						this.suspendStateChangeReporting = false
						this.load(this.currentSrc, this.currentMimetype)
						if(t){
							this.object.currentTime = t + 0.5 // nudge a bit to skip any decoding error on part of the file
						}
						this.errorsCount = c
					}, 10)
				}
			}
		}
		if(this.currentMimetype.match(new RegExp('(mpegts|mpegurl)', 'i'))){
			// let hls.js and mpegts.js do its own error handling first
			v.on('error', () => setTimeout(() => this.object.error && onerr(), 10))
		} else {
			v.on('error', onerr)
			const source = this.object.querySelector('source')
			if(source){ // for video only, hls.js uses src directly
				source.addEventListener('error', onerr)
			}
		}
		v.on('ended', e => {
			console.log('video ended', e)
            this.emit('ended', String(e))
		})
        v.on('timeupdate', event => {
			this.emit('timeupdate')
		})
        v.on('durationchange', event => {
			if(this.object.duration && this.duration != this.object.duration){
				this.duration = this.object.duration
				if(this.duration && this.errorsCount){
					this.errorsCount = 0
				}
			}
			this.emit('durationchange')
		})
        v.on('loadedmetadata', event => {
			if(this.object.videoHeight){
				let r = this.object.videoWidth / this.object.videoHeight
				if(r > 0 && !this.hasReceivedRatio){
					this.hasReceivedRatio = true
					this.emit('setup-ratio', r)
				}
				this.ratio(r)
			}
			this.emit('audioTracks', this.audioTracks())
			this.emit('subtitleTracks', this.subtitleTracks())
		});
		['abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'ended', 'error', 'loadeddata', 'loadedmetadata', 'loadstart', 'pause', 'play', 'playing', 'seeked', 'stalled', 'suspend', 'waiting'].forEach(n => {
			v.on(n, this.processState.bind(this))
		})
	}
	disconnect(){
		$(this.object).off()
	}
	load(src, mimetype){
		if(this.currentSrc != src){
			this.currentSrc = src
			this.currentMimetype = mimetype
		}
		this.unload()
		this.active = true
		console.log('adapter load')
		this.object.src = src
		this.connect()
		this.object.load()
		this.resume()
		console.log('adapter resume', this.object.outerHTML, src, mimetype)
	}
	unload(){
		console.log('adapter unload')
		this.hasReceivedRatio = false
		if(this.active){
			this.active = false
			this.disconnect()
			if(this.object.currentSrc){
				this.object.pause()
				this.object.innerHTML = '<source type="video/mp4" src="" />'
				this.object.removeAttribute('src')
				this.object.load()
			}
		}
	}
	resume(){
		let promise = this.object.play()
		if(promise){
			promise.catch(err => {
				if(this.active){
					console.error(err, err.message, this.object.networkState, this.object.readyState)
				}
			})
		}
	}
	pause(){
		this.object.pause()
	}
	restart(){
		this.time(0)
		this.resume()
	}
	time(s){
		if(typeof(s) == 'number'){
			this.object.currentTime = s
		}
		return this.object.currentTime
	}
	ratio(s){
		if(typeof(s) == 'number'){
			let css, rd, wr, portrait
			if(window.innerWidth < window.innerHeight){
				portrait = true
				wr = window.innerHeight / window.innerWidth
			} else {
				wr = window.innerWidth / window.innerHeight
			}
			rd = (wr > s)
			console.log('ratiochange', rd, this.ratioDirection, wr, s, this._ratio)
			if(typeof(this.ratioDirection) == 'undefined' || this.ratioDirection != rd || s != this._ratio || portrait != this.inPortrait){
				this.inPortrait = portrait
				this._ratio = s
				this.ratioDirection = rd
				if(this.inPortrait){
					css = 'player > div { width: 100vw; height: calc(100vw / ' + this._ratio + '); }'
				} else {
					if(this.ratioDirection){
						css = 'player > div { height: 100vh; width: calc(100vh * ' + this._ratio + '); }'
					} else {
						css = 'player > div { width: 100vw; height: calc(100vw / ' + this._ratio + '); }'
					}
				}
            	if(!this.ratioCSS){
	                this.ratioCSS = document.createElement('style')
            	}
            	this.ratioCSS.innerText = ''
            	this.ratioCSS.appendChild(document.createTextNode(css))
            	document.querySelector("head, body").appendChild(this.ratioCSS)
				console.log('ratioupdated', this.inPortrait)
			}
		}
		return this._ratio
	}
	playbackRate(rate){
		if(typeof(rate) == 'number'){
			this.object.playbackRate = rate
		}
		return this.object.playbackRate
	}
	videoRatio(){
		if(!this.object.videoWidth){
			return 1.7777777777777777
		}
		return this.object.videoWidth / this.object.videoHeight
	}
	processState(){
		var s = ''
		if(this.active){
			if(this.object.paused){
				if(isNaN(this.object.duration)){
					s = 'loading'
				} else {
					s = 'paused'
				}            
			// } else if(this.object.readyState <= 2 && this.object.networkState == 2){        
			
			} else if(this.object.readyState < 3 || this.object.networkState == 0){ // if duration == Infinity, readyState will be 3
			
				this.lastSeenTime = this.object.currentTime
				s = 'loading'
			} else {
				s = 'playing'
			}
			if(s != this.state){
				if(s == 'playing'){
					if(!this.object.currentTime && (this.object.currentTime <= this.lastSeenTime)){
						s = 'loading'
						$(this.object).one('timeupdate', this.processState.bind(this))
					}
				}
			}
		}
		if(this.state != s){
			this.state = s
			if(!this.suspendStateChangeReporting) this.emit('state')
		}
	}
	volume(l){
		if(typeof(l) == 'number'){
			this.object.volume = l / 100
		}
	}
	audioTracks(){
		return this.formatTracks(this.object.audioTracks)
	}
	audioTrack(trackId){
		for (let i = 0; i < this.object.audioTracks.length; i++) {
			this.object.audioTracks[i].enabled = i == trackId
		}
	}
	subtitleTracks(){
		return this.formatTracks(this.object.subtitleTracks)
	}
	subtitleTrack(trackId){
		for (let i = 0; i < this.object.subtitleTracks.length; i++) {
			this.object.subtitleTracks[i].enabled = i == trackId
		}
	}
	formatTracks(tracks, activeId){
		if(!tracks || typeof(tracks) != 'object'){
			return []
		}
		if(!Array.isArray(tracks)){
			tracks = Array.from(tracks)
		}
		const allow = ['id', 'lang', 'enabled', 'label', 'name']
		return tracks.map(t => {
			const ts = {}
			Object.keys(t).filter(k => allow.includes(k)).forEach(k => ts[k] = t[k])
			if(typeof(activeId) != 'undefined' && activeId == ts.id){
				ts.enabled = true
			}
			return ts
		})
	}
	destroy(){
		console.log('adapter destroy')
		this.pause()
		this.unload()
		this.object = null
		this.removeAllListeners()
	}
}

class VideoControlAdapterHTML5Video extends VideoControlAdapterHTML5 {
	constructor(container){
		super(container)
        this.setup('video')
	}
}

class VideoControlAdapterHTML5Audio extends VideoControlAdapterHTML5 {
	constructor(container){
		super(container)
        this.setup('audio')
	}
}

class VideoControlAdapterAndroidNative extends VideoControlAdapter {
	constructor(container){
		super(container)
		this.object = window.plugins['megacubo'] || {}
		this.state = ''
		this.duration = 0
		this.currentTime = 0
		this.hasReceivedRatio = false
		this.aspectRatio = 1.7777777777777777
		this.object.on('ratio', e => {
			console.log('RECEIVED RATIO', e)
			if(e.ratio > 0 && !this.hasReceivedRatio){
				this.hasReceivedRatio = true
				this.emit('setup-ratio', e.ratio)
			}
		})
		this.object.on('state', state => {
			if(state != this.state){
				this.state = state
				if(!this.suspendStateChangeReporting) this.emit('state', this.state)
			}
		})
		this.object.on('timeupdate', () => {
			if(!this.active) return
			this.currentTime = this.object.currentTime
			this.emit('timeupdate')
		})
		this.object.on('durationchange', () => {
			this.duration = this.object.duration
			this.emit('durationchange')
		})
		this.object.on('audioTracks', tracks => {
			this.emit('audioTracks', tracks)
		})		
		this.object.on('subtitleTracks', tracks => {
			this.emit('subtitleTracks', tracks)
		})		
		this.object.on('error', (err, data) => {
			console.log('Error: ', err, 'data:', data)
			this.emit('error', String(err), true)
		})
	}
	uiVisible(visible){
		this.object.uiVisible(visible)
	}
	load(src, mimetype, cookie, mediatype){
		console.warn('Load source', src)
		this.active = true
		this.currentTime = 0
		this.duration = 0
		this.object.setBackBuffer(config['live-window-time'] * 1000)
		this.object.play(src, mimetype, cookie, mediatype, this.successCallback.bind(this), this.errorCallback.bind(this))
	}
	successCallback(){
		console.warn('exoplayer success', arguments)
	}
	errorCallback(...args){
		console.error('exoplayer err', args)
		this.emit('error', args.length ? args[0] : 'Exoplayer error')
		//console.error(err, arguments)
		//this.stop()
		//this.emit('error', err)
	}
	unload(){
		this.hasReceivedRatio = false
		this.active = false
		this.object.stop()
	}
	resume(){
		this.object.resume()
	}
	pause(){
		this.object.pause()
	}
	restart(){
		this.time(0)
		this.resume()
	}
	time(s){
		if(typeof(s) == 'number'){
			this.currentTime = s
			this.object.seek(s)
		}
		return this.currentTime
	}
	ratio(s){
		if(typeof(s) == 'number'){
			this.object.ratio(s)
		}
		return this.object.aspectRatio
	}	
	playbackRate(rate){
		if(typeof(rate) == 'number'){
			console.warn('SET PLAYBACK RATE', rate)
			this.object.setPlaybackRate(rate)
		}
		return this.object.playbackRate
	}
	videoRatio(){
		return this.object.aspectRatio
	}	
	volume(l){
		this.object.volume(l)
	}
	audioTrack(trackId){
		return this.object.audioTrack(trackId)
	}
	audioTracks(){
		return this.object.audioTracks()
	}
	subtitleTrack(trackId){
		return this.object.subtitleTrack(trackId)
	}
	subtitleTracks(){
		return this.object.subtitleTracks()
	}
	destroy(){
		this.unload()
		this.removeAllListeners()
	}
}

class WinMan extends EventEmitter {
	constructor(){
		super()
		this.backgroundModeLocks = []
	}
	backgroundModeLock(name){
		if(!this.backgroundModeLocks.includes(name)){
			this.backgroundModeLocks.push(name)
		}
	}
	backgroundModeUnlock(name){
		this.backgroundModeLocks = this.backgroundModeLocks.filter(n => n != name)
	}
	getAppFrame(){
		return document.querySelector('iframe')
	}
	getAppWindow(){
		let f = this.getAppFrame()
		if(f && f.contentWindow){
			return f.contentWindow
		}
	}
	getStreamer(){
		let w = this.getAppWindow()
		if(w && w.streamer){
			return w.streamer
		}		
	}
	askExit(){
		let w = this.getAppWindow(), opts = [
			{template: 'question', text: w.lang.ASK_EXIT, fa: 'fas fa-times-circle'},
			{template: 'option', text: w.lang.NO, id: 'no'},
			{template: 'option', text: w.lang.YES, id: 'yes'}
		]
		if(this.canAutoRestart()){
			opts.push({template: 'option', text: w.lang.RESTARTAPP, id: 'restart'})
		}
		w.explorer.dialog(opts, c => {
			if(c == 'yes'){
				this.exit()
			} else if(c == 'restart'){
				this.restart()
			}
		}, 'no')
	}
	askRestart(){
		let w = this.getAppWindow()
		w.explorer.dialog([
			{template: 'question', text: document.title, fa: 'fas fa-info-circle'},
			{template: 'message', text: lang.SHOULD_RESTART},
			{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'},
			{template: 'option', text: lang.RESTART_LATER, id: 'back', fa: 'fas fa-times-circle'}
		], c => {
			if(c == 'back'){
				w.osd.show(lang.SHOULD_RESTART, 'fas fa-exclamation-circle faclr-red', 'restart', 'normal')
			} else {
				this.restart()
			}
		}, 'submit')
	}
	exitUI(){
		let w = this.getAppWindow()
		console.log('exitUI()')
		if(typeof(cordova) != 'undefined'){
			this.setBackgroundMode(false, true)
		}
		try {
			w.streamer.stop()
			//w.$('wrap').html('<div style="vertical-align: middle; height: 100%; display: flex; justify-content: center; align-items: center;"><i class="fa-mega" style="font-size: 25vh;color: var(--font-color);"></i></div>')
			//w.$('#home-arrows').hide()
			const useCurtains = config && config['fx-nav-intensity']
			if(useCurtains){
				$('html').removeClass('curtains-close').addClass('curtains')
			}
		} catch(e) {
			console.error(e)
		}
	}
	canAutoRestart(){ 
		let autoRestartSupport
		if(parent.parent.process && parent.parent.process.platform == 'win32'){
			autoRestartSupport = true
		} else if(typeof(cordova) != 'undefined' && cordova && parseInt(parent.parent.device.version) < 10 && typeof(plugins) != 'undefined' && plugins.megacubo) {
			autoRestartSupport = true
		}
		return autoRestartSupport
	}
	restart(){
		let next = auto => {
			if(auto){
				if(typeof(plugins) != 'undefined' && plugins.megacubo){ // cordova
					return plugins.megacubo.restartApp()
				} else if(parent.parent.Manager) {
					return parent.parent.Manager.restart()
				}
			}
			this.exit()
		}
		if(this.canAutoRestart()){
			next(true)
		} else {
			let w = this.getAppWindow()
			w.explorer.dialog([
				{template: 'question', text: document.title, fa: 'fas fa-info-circle'},
				{template: 'message', text: lang.SHOULD_RESTART},
				{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
			], next)
		}
	}
	exit(force){
		console.log('exit()', traceback())
		let w = this.getAppWindow()
		if(w.streamer && w.streamer.active){
			w.streamer.stop()
		}
		if(!force && this.backgroundModeLocks.length){
			if(typeof(cordova) != 'undefined'){
				this.setBackgroundMode(true, true)
				cordova.plugins.backgroundMode.moveToBackground()
			} else {
				parent.parent.Manager.goToTray()
			}
		} else {
			if(typeof(cordova) != 'undefined'){
				this.setBackgroundMode(false, true)
			}
			this.exitUI()
			setTimeout(() => {
				if(w){
					w.app.emit('exit')
				}
				if(typeof(cordova) != 'undefined'){
					setTimeout(() => { // give some time to backgroundMode.disable() to remove the notification
						navigator.app.exitApp()
					}, 400)
				} else {
					parent.parent.Manager.close()
				}
			}, 500)
		}
	}
}

class MiniPlayerBase extends WinMan {
	constructor(){
		super()
		this.enabled = true
        this.pipSupported = null
        this.inPIP = false
	}
	supports(){
		return true
	}
	set(inPIP){
		if(inPIP != this.inPIP){
			if(!inPIP || this.enabled){
				console.warn('SET PIP', inPIP, this.inPIP, traceback())	
				this.inPIP = inPIP === true || inPIP === 'true'
				this.emit(this.inPIP ? 'enter' : 'leave')
			}
		}
	}
	toggle(){
		return this.inPIP ? this.leave() : this.enter()
	}
    leave(){
        return new Promise((resolve, reject) => {
			this.set(false)
			resolve(true)
		})
	}
	getDimensions(){
		const scr = parent.cordova ? screen : parent.Manager.getScreenSize(), streamer = this.getStreamer()
		let width = Math.min(scr.width, scr.height) / 2, aw = Math.max(scr.width, scr.height) / 3
		if(aw < width){
			width = aw
		}
		width = parseInt(width)
		let r = window.innerWidth / window.innerHeight
		if(streamer && streamer.active){
			r = streamer.activeAspectRatio.h / streamer.activeAspectRatio.v			
		}
		let height = parseInt(width / r)
		return {width, height}
	}
	enterIfPlaying(){
		let streamer = this.getStreamer()
		if(this.enabled && this.supports() && streamer && (streamer.active || streamer.isTuning())) {
			this.enter().catch(err => console.error('PIP FAILURE', err))
			return true
		}
	}
}

class CordovaMiniplayer extends MiniPlayerBase {
    constructor(){
		super()
		this.pip = parent.parent.PictureInPicture
		this.appPaused = false
		this.setup()
		this.on('enter', () => {
			let app = this.getAppWindow()
			if(app){
				app.$(app.document.body).addClass('miniplayer-cordova')
			}
		})
		this.on('leave', () => {
			this.enteredPipTimeMs = false
			console.warn('leaved miniplayer')
			let app = this.getAppWindow()
			if(app){
				app.$(app.document.body).removeClass('miniplayer-cordova')
				if(app.streamer && app.streamer.active){
					app.streamer.enterFullScreen()	
				}
			}
			if(this.appPaused){
				clearTimeout(this.waitAppResumeTimer)
				this.waitAppResumeTimer = setTimeout(() => {
					if(this.appPaused){
						player.emit('app-pause', true)
					}
				}, 2000)
			}
		})
	}
	getAndroidVersion() {
		let ua = navigator.userAgent.toLowerCase()
		let match = ua.match(/android\s([0-9\.]*)/i)
		return match ? parseInt(match[1], 10) : undefined
	}
	supports(){
		return this.getAndroidVersion() >= 8
	}
	observePIPLeave(){
		if(this.observePIPLeaveTimer){
			clearTimeout(this.observePIPLeaveTimer)
		}
		let ms = 2000, initialDelayMs = 7000
		if(this.enteredPipTimeMs){
			const now = (new Date()).getTime()
			ms = Math.max(ms, (this.enteredPipTimeMs + initialDelayMs) - now)
		}
		this.observePIPLeaveTimer = setTimeout(() => {
			if(!this.seemsPIP()){
				console.log('exiting PIP Mode after observing')
				this.leave()
			}
		}, ms)
		console.log('observing PIP leave', ms, this.inPIP)
	}
	setup(){
		if(this.pip){
			player.on('app-pause', screenOff => {
				if(this.inPIP && !screenOff) return
				this.appPaused = true
				let streamer = this.getStreamer(), keepInBackground = this.backgroundModeLocks.length
				let keepPlaying = this.backgroundModeLocks.filter(l => l != 'schedules').length
				console.warn('app-pause', screenOff, keepInBackground, this.inPIP)
				if(streamer){
					if(!keepPlaying){
						keepPlaying = streamer.casting || streamer.isAudio
					}
					if(streamer.casting || streamer.isAudio){
						keepInBackground = true
					} else {
						if(screenOff){ // skip miniplayer
							if(!keepPlaying){ // not doing anything important
								streamer.stop()
							}
						} else {
							if(this.enterIfPlaying()) {
								console.warn('app-pause', 'entered miniplayer')
								keepInBackground = false // enter() already calls cordova.plugins.backgroundMode.enable() on prepare()
							} else if(!keepPlaying) { // no reason to keep playing
								streamer.stop()
							}
						}
					}
				}
				if(keepInBackground){
					this.setBackgroundMode(true)
					//cordova.plugins.backgroundMode.moveToBackground()
				}
			})
			player.on('app-resume', () => {
				console.warn('app-resume', this.inPIP)
				this.appPaused = false
				this.setBackgroundMode(false)
				if(this.inPIP){
					this.observePIPLeave()
				}
			});
			(new ResizeObserver(() => {
				let seemsPIP = this.seemsPIP()
				if(seemsPIP != this.inPIP){
					console.warn('miniplayer change on resize')
					if(seemsPIP){
						this.set(seemsPIP)
					} else {
						this.observePIPLeave()
					}
				}
			})).observe(document.body)
		}
	}
	setBackgroundMode(state, force){
		const minInterval = 5, now = (new Date()).getTime() / 1000
		if(this.setBackgroundModeTimer){
			clearTimeout(this.setBackgroundModeTimer)
		}
		if(force || !this.lastSetBackgroundMode || (now - this.lastSetBackgroundMode) >= minInterval) {
			if(state !== this.currentBackgroundModeState) {
				this.lastSetBackgroundMode = now
				this.currentBackgroundModeState = state
				if(state) {
					cordova.plugins.backgroundMode.enable()
				} else {
					cordova.plugins.backgroundMode.disable()
				}
			}
		} else {
			const delay = ((this.lastSetBackgroundMode + minInterval) - now) * 1000
			this.setBackgroundModeTimer = setTimeout(() => {
				this.setBackgroundMode(state, force)
			}, delay)
		}
	}
    prepare(){
        return new Promise((resolve, reject) => {
            if(this.pip){
                if(typeof(this.pipSupported) == 'boolean'){					
					this.setBackgroundMode(true)
                    resolve(true)
                } else {
                    try {
                        this.pip.isPipModeSupported(success => {
							this.pipSupported = success
                            if(success){
								this.setBackgroundMode(true)
                                resolve(true)
                            } else {
                                reject('pip mode not supported')
                            }
                        }, error => {
                            console.error(error)
                            reject('pip not supported: '+ String(error))
                        })
                    } catch(e) {
                        console.error(e)
                        reject('PIP error: '+ String(e))
                    } 
                }
            } else {
                reject('PIP unavailable')
            }
        })
    }
	seemsPIP(){
		let seemsPIP		
		if(screen.width < screen.height) {
			seemsPIP = window.innerHeight < (screen.height / 2)
		} else {
			seemsPIP = window.innerWidth < (screen.width / 2)
		}
		return seemsPIP
	}
    enter(){
        return new Promise((resolve, reject) => {
			if(!this.enabled){
				return reject('miniplayer disabled')
			}
			if(!this.supports()){
				return reject('not supported')
			}
            this.prepare().then(() => {
				console.warn('ABOUT TO PIP', this.inPIP)
				let m = this.getDimensions()
                this.pip.enter(m.width, m.height, success => {
                    if(success){
						this.enteredPipTimeMs = (new Date()).getTime()
                        console.log('enter: '+ String(success))
                        this.set(true)
                        resolve(success)
                    } else {
						console.error('pip.enter() failed to enter pip mode')	
                        this.set(false)
                        reject('failed to enter pip mode')
                    }							
                }, error => {
                    this.set(false)
                    console.error('pip.enter() error', error)
                    reject(error)
                })
            }).catch(reject)
        })
    }
}

class NWJSMiniplayer extends MiniPlayerBase {
    constructor(){
		super()
        this.pip = parent.parent.Manager
		this.setup()
    }
	setup(){
		if(this.pip){
			this.pip.minimizeWindow = () => {
				if(this.pip.miniPlayerActive){	// if already in miniplayer, minimize it				
					this.pip.prepareLeaveMiniPlayer()
					this.pip.win.hide()
					this.pip.restore()
					setTimeout(() => {
						this.pip.win.show()
						this.pip.win.minimize()
					}, 0)
				} else if(!this.enterIfPlaying()){
					this.pip.win.minimize()
				}
			}
			this.pip.closeWindow = () => this.exit()
			this.pip.on('miniplayer-on', () => this.set(true))
			this.pip.on('miniplayer-off', () => this.set(false))
			window.addEventListener('resize', () => {
				if(this.pip.resizeListenerDisabled !== false) return
				if(this.seemsPIP()){
					if(!this.pip.miniPlayerActive){
						this.pip.miniPlayerActive = true  
						this.pip.emit('miniplayer-on')
					}
				} else {
					if(this.pip.miniPlayerActive){
						this.pip.miniPlayerActive = false
						this.pip.emit('miniplayer-off')
					}
				}
			})
		}
	}
	seemsPIP(){
		let dimensions = this.getDimensions();
		['height', 'width'].forEach(m => dimensions[m] = dimensions[m] * 1.5)
		let seemsPIP = window.innerWidth <= dimensions.width && window.innerHeight <= dimensions.height
		console.log('resize', seemsPIP, dimensions)
		return seemsPIP
	}
    enter(){
        return new Promise((resolve, reject) => {
			if(!this.enabled){
				return reject('miniplayer disabled')
			}
            if(!this.inPIP){
				let m = this.getDimensions()
				this.pip.enterMiniPlayer(m.width, m.height)
				this.set(true)
			}
			resolve(true)
        })
    }
    leave(){	
        return new Promise((resolve, reject) => {	
			if(this.inPIP){
				this.pip.leaveMiniPlayer()
				this.set(false)
			}
			resolve(true)
		})
	}
}

player = new VideoControl(document.querySelector('player'))
winman = new (parent.parent.cordova ? CordovaMiniplayer : NWJSMiniplayer)

var cfgReceived
function updateConfig(cfg){
	console.log('updateConfig', cfg)
	if(!cfg){
		cfg = config
	}
	if(cfg){
		if(!cfgReceived){ // run once
			cfgReceived = true
			switch(cfg['startup-window']){
				case 'fullscreen':
					if(parent.parent.Manager && parent.parent.Manager.setFullScreen){
						parent.parent.Manager.setFullScreen(true)
					}
					break
				case 'miniplayer':
					winman.enter()
					break
			}
		}
		window.config = player.config = cfg
		Object.keys(player.adapters).forEach(k => {
			player.adapters[k].config = cfg
		})
		winman.enabled = cfg['miniplayer-auto']
	}
}

onFrontendBackendReady(updateConfig)

if(!parent.cordova){
	['play', 'pause', 'seekRewindward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'skipad'].forEach(n => {
		// disable media keys on this frame
		try {
			navigator.mediaSession.setActionHandler(n, function() {})
		} catch(e){}
	})
}

document.querySelector('iframe#app').src = './app.html'
