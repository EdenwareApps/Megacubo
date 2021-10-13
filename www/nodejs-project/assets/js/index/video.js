
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
		this.config = {}
		this.uiVisibility = true
		if(typeof(config) != 'undefined'){
			this.config = config
		}
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
				r = this.current.time() + 2
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
		$('html').addClass('playing')
		if(!(this.current instanceof VideoControlAdapterAndroidNative)){
			this.container.style.display = 'flex'
			this.container.querySelectorAll('video, audio').forEach(e => {
				e.style.display = (e == this.current.object) ? 'block' : 'none'
			})
		}
	}
	hide(){
		$('html').removeClass('playing')
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
		this.emit('state', this.state)
		if(!window.plugins || typeof(window.plugins['megacubo']) == 'undefined'){
			let m = mimetype.toLowerCase()
			if(m.indexOf('mpegurl') != -1){
				this.setup('html5h', VideoControlAdapterHTML5HLS)
			} else if(m.indexOf('audio/') != -1){
				this.setup('html5a', VideoControlAdapterHTML5Audio)
			} else {
				this.setup('html5v', VideoControlAdapterHTML5Video)
			}
		} else {
			this.setup('native', VideoControlAdapterAndroidNative)
		}
		this.current.errorsCount = 0
		this.current.load(src, mimetype, cookie, mediatype)
		this.show()
		this.current.volume(this.config['volume'])
		return this.current
	}
	setup(adapter, cls){
		this.adapter = adapter
		if(typeof(this.adapters[this.adapter]) == 'undefined'){
			let a = new (cls)(this.innerContainer)
			a.on('state', s => {
				if(!this.current) return
				this.state = this.current ? this.current.state : ''
				if(!this.state && this.hasErr){
					this.state = 'error'
				}
				this.emit('state', this.state, this.hasErr)
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
				this.emit('durationchange')
			})
			a.on('request-transcode', () => {
				if(!this.current) return
				this.emit('request-transcode')
			})
			a.on('error', (err, fatal) => {
				if(!this.current){
					a.disconnect()
					return a.unload()
				}
				if(this.clearErrTimer){
					clearTimeout(this.clearErrTimer)
				}
				if(fatal === true){
					this.state = 'error'
					this.emit('state', this.state, err)
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
				this.emit('state', this.state)
			})
			a.config = this.config
			this.adapters[this.adapter] = a
		}
		this.current = this.adapters[this.adapter]
	}
	unload(){
		console.log('unload', traceback())
		if(this.current){
			console.log('unload')
			this.hide()
			this.current.unload()
			this.current = null
			this.state = ''
			this.emit('state', this.state)
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
		if(typeof(this.object._pause) == 'undefined'){
			this.object._pause = this.object.pause
			this.object.pause = () => {} // prevent browser from pausing stream unexpectedly on Android
		}
	}
	uiVisible(visible){
		this.uiVisibility = visible
	}
	connect(){
		this.object.currentTime = 0
		let v = $(this.object)
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
			const errStr = e ? String(e.message ? e.message : e) : 'unknown error'
			const isFailed = this.object.networkState == 3 || this.object.readyState < 2 || errStr.match(new RegExp('(pipeline_error|demuxer)', 'i'))
			console.error('video error', this.errorsCount, e, errStr, this.object.networkState +', '+ this.object.readyState, isFailed)
			if(isFailed){
				this.errorsCount++
				let t = this.time()
				if(this.errorsCount >= (t > 0 ? 5 : 2)){
					this.emit('error', String(e), true)
				} else {
					this.load(this.currentSrc, this.currentMimetype)
					if(t){
						this.object.currentTime = t
					}
				}
			}
		}
        v.on('error', onerr)
        let source = this.object.querySelector('source')
		if(source){ // for video only, will be skiped for hls.js
			source.addEventListener('error', onerr)
		}
        v.on('ended', e => {
			console.log('video ended', e)
            this.emit('ended', String(e))
		})
        v.on('timeupdate', event => {
			this.emit('timeupdate')
		})
        v.on('durationchange', event => {
			this.duration = this.object.duration
			if(this.duration && this.errorsCount){
				this.errorsCount = 0
			}
			if(this.uiVisibility){
				this.emit('durationchange')
			}
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
        /*
		let codec = mimetype.replace(new RegExp('"+', 'g'), "'").split(';'), type = codec[0]
        codec = codec.length > 1 ? codec[1].split("'")[1] : ''
		let h = '<source type="'+ type +'" src="'+ src +'" '
		if(codec){
			h += ' codecs="'+ codec +'" '
		}
		h += ' />'
		*/
		let h = ''
		this.object.src = src
		this.object.innerHTML = h
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
				this.object._pause()
				Array.from(this.object.getElementsByTagName('source')).forEach(s => {
					s.src = ''
					s.parentNode.removeChild(s)
				})
				this.object.innerHTML = '<source type="video/mp4" src="" />'
				this.object.removeAttribute('src')
				this.object.load()
				this.object._pause()
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
		this.object._pause()
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
				let invRatio = 1 - (s - 1)
				this.ratioDirection = rd
				if(this.inPortrait){
					//if(this.ratioDirection){
					//	css = 'player > div { height: 100vh; width: calc(100vh * ' + this._ratio + '); }'
					//} else {
						css = 'player > div { width: 100vw; height: calc(100vw / ' + this._ratio + '); }'
					//}
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
			this.emit('state')
		}
	}
	volume(l){
		if(typeof(l) == 'number'){
			this.object.volume = l / 100
		}
	}
	destroy(){
		console.log('adapter destroy')
		this.pause()
		this.unload()
		this.object = null
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
				this.emit('state', this.state)
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
	destroy(){
		this.unload()
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
		if(typeof(cordova) == 'undefined' || parseInt(top.device.version) >= 10){
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
	exitUI(){
		let w = this.getAppWindow()
		console.log('exitUI()')
		if(typeof(cordova) != 'undefined'){
			cordova.plugins.backgroundMode.disable()
		}
		try {
			w.streamer.stop()
			w.$('wrap').html('<div style="vertical-align: middle; height: 100%; display: flex; justify-content: center; align-items: center;"><i class="fa-mega" style="font-size: 25vh;color: var(--font-color);"></i></div>')
			w.$('#home-arrows').hide()
		} catch(e) {
			console.error(e)
		}
	}
	restartUI(cb){		
		if(typeof(cordova) == 'undefined' || parseInt(top.device.version) >= 10){
			cb()
		} else {
			let w = this.getAppWindow()
			w.explorer.dialog([
				{template: 'question', text: 'Megacubo', fa: 'fas fa-info-circle'},
				{template: 'message', text: lang.SHOULD_RESTART},
				{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
			], cb)
		}
	}
	restart(){
		console.log('restart()')
		if(typeof(plugins) != 'undefined' && plugins.megacubo){ // cordova
			this.restartUI(() => {
				plugins.megacubo.restartApp()
			})
		} else { // nwjs
			let w = this.getAppWindow()
			if(w){
				w.app.emit('exit')
			}
			top.Manager.restart()
		}
	}
	exit(){
		console.log('exit()', traceback())
		if(this.backgroundModeLocks.length){
			if(typeof(cordova) != 'undefined'){
				cordova.plugins.backgroundMode.enable()
				cordova.plugins.backgroundMode.moveToBackground()
			} else {
				top.Manager.goToTray()
			}
		} else {
			this.exitUI()
			let w = this.getAppWindow()
			if(w){
				w.app.emit('exit')
			}
			if(typeof(cordova) != 'undefined'){
				setTimeout(() => { // give some time to backgroundMode.disable() to remove the notification
					navigator.app.exitApp()
				}, 400)
			} else {
				top.Manager.close()
			}
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
		let width = Math.min(screen.width, screen.height) / 2, aw = Math.max(screen.width, screen.height) / 3, streamer = this.getStreamer()
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
		if(this.enabled && streamer && (streamer.active || streamer.isTuning()) && !this.inPIP) {
			this.enter().catch(err => console.error('PIP FAILURE', err))
			return true
		}
	}
}

class CordovaMiniplayer extends MiniPlayerBase {
    constructor(){
		super()
		this.pip = top.PictureInPicture
		this.appPaused = false
		this.setup()
		this.on('enter', () => {
			let app = this.getAppWindow()
			if(app){
				app.$(app.document.body).addClass('miniplayer-cordova')
			}
		})
		this.on('leave', () => {
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
	setup(){
		if(this.pip){
			player.on('app-pause', screenOff => {
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
								keepInBackground = true
							} else if(!keepPlaying) { // no reason to keep playing
								streamer.stop()
							}
						}
					}
				}
				if(keepInBackground){
					cordova.plugins.backgroundMode.enable()
					//cordova.plugins.backgroundMode.moveToBackground()
				}
			})
			player.on('app-resume', () => {
				console.warn('app-resume', this.inPIP)
				this.appPaused = false
				cordova.plugins.backgroundMode.disable()
				if(this.inPIP){
					this.set(false)
				}
			});
			(new ResizeObserver(() => {
				let seemsPIP = this.seemsPIP()
				if(seemsPIP != this.inPIP){
					console.warn('miniplayer change on resize')
					this.set(seemsPIP)
				}
			})).observe(document.body)
		}
	}
    prepare(){
        return new Promise((resolve, reject) => {
            if(this.pip){
                if(typeof(this.pipSupported) == 'boolean'){
                    resolve(true)
                } else {
                    try {
                        this.pip.isPipModeSupported(success => {
							this.pipSupported = success
                            if(success){
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
            this.prepare().then(() => {
				console.warn('ABOUT TO PIP', this.inPIP)
				let m = this.getDimensions()
                this.pip.enter(m.width, m.height, success => {
                    if(success){
                        console.log('enter: '+ String(success))
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
        this.pip = top.Manager
		this.setup()
    }
	setup(){
		if(this.pip){
			this.pip.minimizeWindow = () => {
				if(this.pip.miniPlayerActive){	// if already in miniplayer, minimize it				
					this.pip.prepareLeaveMiniPlayer()
					//this.pip.win.hide()
					//this.pip.restore()
					setTimeout(() => {
						//this.pip.win.show()
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
winman = new (top.cordova ? CordovaMiniplayer : NWJSMiniplayer)

var cfgReceived
function updateConfig(cfg){
	console.log('updateConfig', config)
	if(!cfg){
		cfg = config
	}
	if(cfg){
		if(!cfgReceived){ // run once
			cfgReceived = true
			switch(cfg['startup-window']){
				case 'fullscreen':
					if(top.Manager && top.Manager.setFullScreen){
						top.Manager.setFullScreen(true)
					}
					break
				case 'miniplayer':
					winman.enter()
					break
			}
		}
		player.config = cfg
		Object.keys(player.adapters).forEach(k => {
			player.adapters[k].config = cfg
		})
		winman.enabled = cfg['miniplayer-auto']
	}
}

frontendBackendReadyCallback(updateConfig)

if(!parent.cordova){
	['play', 'pause', 'seekRewindward', 'seekforward', 'seekto', 'previoustrack', 'nexttrack', 'skipad'].forEach(n => {
		// disable media keys on this frame
		try {
			navigator.mediaSession.setActionHandler(n, function() {})
		} catch(e){}
	})
}


