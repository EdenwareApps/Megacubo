import { EventEmitter } from 'events'
import { main } from '../../../modules/bridge/renderer'

class WindowActions extends EventEmitter {
	constructor(){
		super()
		this.backgroundModeLocks = []
	}
	openExternalURL(url) {
		if (parent.api) { // electron
			parent.api.openExternal(url)
		} else {
			window.open(url, '_system')
		}
	}
	backgroundModeLock(name){
		if(!this.backgroundModeLocks.includes(name)){
			this.backgroundModeLocks.push(name)
		}
	}
	backgroundModeUnlock(name){
		this.backgroundModeLocks = this.backgroundModeLocks.filter(n => n != name)
	}
	askExit(){
		let opts = [
			{template: 'question', text: main.lang.ASK_EXIT, fa: 'fas fa-times-circle'},
			{template: 'option', text: main.lang.NO, id: 'no'},
			{template: 'option', text: main.lang.YES, id: 'yes'}
		]
		if(this.canAutoRestart()){
			opts.push({template: 'option', text: main.lang.RESTARTAPP, id: 'restart'})
		}
		main.menu.dialog(opts, c => {
			if(c == 'yes'){
				this.exit()
			} else if(c == 'restart'){
				this.restart()
			}
		}, 'no')
	}
	askRestart(){
		main.menu.dialog([
			{template: 'question', text: document.title, fa: 'fas fa-info-circle'},
			{template: 'message', text: main.lang.SHOULD_RESTART},
			{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'},
			{template: 'option', text: main.lang.RESTART_LATER, id: 'back', fa: 'fas fa-times-circle'}
		], c => {
			if(c == 'back'){
				main.osd.show(main.lang.SHOULD_RESTART, 'fas fa-exclamation-triangle faclr-red', 'restart', 'normal')
			} else {
				this.restart()
			}
		}, 'submit')
	}
	exitUI(cb){
		console.log('exitUI()')
		if(typeof(window.capacitor) != 'undefined'){
			this.setBackgroundMode(false, true)
		}
		try {
			main.streamer.stop()
		} catch(e) {
			console.error(e)
		}
		main.localEmit('exit-ui')
		cb && setTimeout(cb, 400)
	}
	canAutoRestart(){ 
		return true
	}
	restart(){
		let next = auto => {
			if(auto){
				if(typeof(plugins) != 'undefined' && plugins.megacubo){ // android
					return plugins.megacubo.restartApp()
				} else if(parent.Manager) {
					parent.api.restart()
					return
				}
			}
			this.exit()
		}
		if(this.canAutoRestart()){
			next(true)
		} else {
			main.menu.dialog([
				{template: 'question', text: document.title, fa: 'fas fa-info-circle'},
				{template: 'message', text: main.lang.SHOULD_RESTART},
				{template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
			], next)
		}
	}
	exit(force){
		console.log('exit('+ force +')')
		if(main.streamer && main.streamer.active){
			main.streamer.stop()
		}
		if(!force && this.backgroundModeLocks.length){
			if(typeof(window.capacitor) != 'undefined'){
				this.setBackgroundMode(true, true)
				cordova.plugins.backgroundMode.moveToBackground()
			} else {
				parent.api.tray.goToTray()
			}
		} else {
			if(window.capacitor){
				this.setBackgroundMode(false, true)
			}
			this.exitUI(() => {
				main.emit('exit')
				if(window.capacitor){
					setTimeout(() => { // give some time to backgroundMode.disable() to remove the notification
						window.capacitor.App.exitApp()
					}, 400)
				} else {
					parent.Manager.close()
				}
			})
		}
	}
}

class WinActionsMiniplayer extends WindowActions {
	constructor(main){
		super()
		this.main = main
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
				console.warn('SET PIP', inPIP, this.inPIP)	
				this.inPIP = inPIP === true || inPIP === 'true'
				this.emit(this.inPIP ? 'enter' : 'leave')
			}
		}
	}
	toggle(){
		console.log('winActions.toggle', this.inPIP)
		return this.inPIP ? this.leave() : this.enter()
	}
    async leave(){
		this.set(false)
		return true
	}
	getDimensions(real){
		const scr = window.capacitor ? screen : parent.Manager.getScreenSize(real)
		let width = Math.min(scr.width, scr.height) / 2, aw = Math.max(scr.width, scr.height) / 3
		if(aw < width){
			width = aw
		}
		width = parseInt(width)
		let r = window.innerWidth / window.innerHeight
		if(main.streamer && main.streamer.active){
			r = main.streamer.activeAspectRatio.h / main.streamer.activeAspectRatio.v			
		}
		let height = parseInt(width / r)
		return {width, height}
	}
	enterIfPlaying(){
		if(this.enabled && this.supports() && main.streamer && (main.streamer.active || main.streamer.isTuning())) {
			this.enter().catch(err => console.error('PIP FAILURE', err))
			return true
		}
	}
}

export class AndroidWinActions extends WinActionsMiniplayer {
    constructor(main){
		super(main)
		this.pip = PictureInPicture
		this.appPaused = false
		this.setup()
		this.on('enter', () => {
			document.body.classList.add('miniplayer-android')
		})
		this.on('leave', () => {
			this.enteredPipTimeMs = false
			console.warn('leaved miniplayer')
			document.body.classList.remove('miniplayer-android')
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
			// orientation change listener to avoid enter PIP mode when the user is just rotating the device
			let orientationChanging = 0
			const orientationListener = () => {
				if(orientationChanging) {
					clearTimeout(orientationChanging)
				} else {					
					this.pip.autoPIP(false, 0, 0) // only if it was not already changing orientation
				}
				orientationChanging = setTimeout(() => {
					orientationChanging = 0
					stateListener()
				}, 2000)
			}
			screen.orientation && screen.orientation.addEventListener('change', orientationListener)
			window.addEventListener('resize', orientationListener)
			window.addEventListener('orientationchange', orientationListener)

			const stateListener = () => {
				if(orientationChanging) return
				setTimeout(() => { // wait a bit for consolidated values
					if(orientationChanging) return
					const shouldAutoPIP = main.streamer.active && !main.streamer.isAudio && !main.streamer.casting
					if(shouldAutoPIP) {
						const ratio = player.videoRatio()
						const width = (240 * ratio) || 320
						this.pip.autoPIP(true, (240 * player.videoRatio()) || 320, 240)
					} else {
						this.pip.autoPIP(false, 0, 0)
					}
				}, 0)
			}
			main.streamer.on('state', stateListener)
			main.streamer.on('cast-start', stateListener)
			main.streamer.on('cast-stop', stateListener)
			main.streamer.on('codecData', stateListener) // isAudio updated
			player.on('app-pause', screenOff => {
				if(this.inPIP && !screenOff) return
				this.appPaused = true
				let keepInBackground = this.backgroundModeLocks.length
				let keepPlaying = this.backgroundModeLocks.filter(l => l != 'schedules').length
				console.warn('app-pause', screenOff, keepInBackground, keepPlaying, this.inPIP)
				if(main.streamer){
					if(!keepPlaying){
						keepPlaying = main.streamer.casting || main.streamer.isAudio
					}
					if(main.streamer.casting || main.streamer.isAudio){
						keepInBackground = true
					} else {
						if(screenOff){ // skip miniplayer
							if(!keepPlaying){ // not doing anything important
								main.streamer.stop()
							}
						} else {
							if(this.enterIfPlaying()) {
								console.warn('app-pause', 'entered miniplayer')
								keepInBackground = false // enter() already calls cordova.plugins.backgroundMode.enable() on prepare()
							} else if(!keepPlaying) { // no reason to keep playing
								main.streamer.stop()
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
			const listener = () => {
				let seemsPIP = this.seemsPIP()
				if(seemsPIP != this.inPIP){
					console.warn('miniplayer change on resize')
					if(seemsPIP){
						this.set(seemsPIP)
					} else {
						this.observePIPLeave()
					}
				}
			}
			window.addEventListener('resize', listener)
			window.addEventListener('orientationchange', listener, { capture: true })
			screen.orientation && screen.orientation.addEventListener('change', listener)
			this.pip.isPipModeSupported(() => {}, err => {
				console.error('PiP not supported', err)
			})
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
		// should not confuse with phone in portrait mode but the app with landscape orientation
		// so we check if the height is less than half of the screen height
		// and if the width is less than half of the screen width
		return window.innerHeight < (screen.height / 2) && window.innerWidth < (screen.width * 0.7)
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

export class ElectronWinActions extends WinActionsMiniplayer {
    constructor(main){
		super(main)
        this.pip = parent.Manager
		this.setup()
    }
	setup(){
		if(this.pip){
			this.pip.minimizeWindow = () => {
				if(this.pip.miniPlayerActive){	// if already in miniplayer, minimize it				
					this.pip.prepareLeaveMiniPlayer()
					parent.api.window.hide()
					parent.api.window.restore()
					setTimeout(() => {
						parent.api.window.show()
						parent.api.window.minimize()
					}, 0)
				} else if(!this.enterIfPlaying()){
					parent.api.window.minimize()
				}
			}
			this.pip.closeWindow = () => this.exit()
			this.pip.on('miniplayer-on', () => this.set(true))
			this.pip.on('miniplayer-off', () => this.set(false))
			window.addEventListener('resize', () => this.resize(), 150)
		}
	}
	resize() {
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
	}
	seemsPIP(){
		let dimensions = this.getDimensions();
		['height', 'width'].forEach(m => dimensions[m] = dimensions[m] * 1.5)
		let seemsPIP = window.innerWidth <= dimensions.width && window.innerHeight <= dimensions.height
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
