
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
				w.osd.show(lang.SHOULD_RESTART, 'fas fa-exclamation-triangle faclr-red', 'restart', 'normal')
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
			const useCurtains = config && config['fx-nav-intensity']
			if(useCurtains){
				jQuery('html').removeClass('curtains-close').addClass('curtains')
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
					let w = this.getAppWindow()
					if(w && w.app) {
						w.app.emit('electron-relaunch')
					} else {
						parent.parent.Manager.restart()
					}
					return
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
		console.log('exit('+ force +')', traceback())
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
		console.log('winman.toggle', this.inPIP)
		return this.inPIP ? this.leave() : this.enter()
	}
    leave(){
        return new Promise((resolve, reject) => {
			this.set(false)
			resolve(true)
		})
	}
	getDimensions(real){
		const scr = parent.cordova ? screen : parent.Manager.getScreenSize(real), streamer = this.getStreamer()
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
			if(app && app.jQuery){
				app.jQuery(app.document.body).addClass('miniplayer-cordova')
			}
		})
		this.on('leave', () => {
			this.enteredPipTimeMs = false
			console.warn('leaved miniplayer')
			let app = this.getAppWindow()
			if(app){
				if(app.jQuery) {
					app.jQuery(app.document.body).removeClass('miniplayer-cordova')
				}
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
	supports(){
		return true // no way to detect here
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

class ElectronMiniplayer extends MiniPlayerBase {
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

// using window['winman'] to prevent scope problems on updateConfig on Android
window['winman'] = new (parent.parent.cordova ? CordovaMiniplayer : ElectronMiniplayer)

var cfgReceived
function updateConfig(cfg){
	console.log('updateConfig', cfg)
	if(typeof(window['winman']) == 'undefined' || !window['winman']){
		return	
	}
	if(!cfg){
		cfg = config
	}
	if(cfg){
		window.config = cfg
		if(window.player){
			player.config = cfg
			Object.keys(player.adapters).forEach(k => {
				player.adapters[k].config = cfg
			})
		}
		window['winman'].enabled = cfg['miniplayer-auto']
		if(!parent.parent.cordova) {
			parent.parent.Manager.fsapi = !!cfg['fsapi']
			if(!cfgReceived){ // run once
				cfgReceived = true
				switch(cfg['startup-window']){
					case 'fullscreen':
						if(parent.parent.Manager && parent.parent.Manager.setFullScreen){
							parent.parent.Manager.setFullScreen(true)
						}
						break
					case 'miniplayer':
						window['winman'].enter()
						break
				}
			}
		}
	}
}

onFrontendBackendReady(updateConfig)