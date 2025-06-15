import { ESMitter as EventEmitter } from 'esm-itter'
import { main } from '../../../modules/bridge/renderer'

class WindowActions extends EventEmitter {
	constructor(){
		super()
		this.backgroundModeLocks = []
	}
	openExternalURL(url) {
		if (parent.electron) { // electron
			parent.electron.openExternal(url)
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
		main.menu.dialogs.dialog(opts, c => {
			if(c == 'yes'){
				this.exit()
			} else if(c == 'restart'){
				this.restart()
			}
		}, 'no')
	}
	askRestart(){
		main.menu.dialogs.dialog([
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
			this.setBackgroundMode(false, true).catch((err) => console.error('Failed to disable background mode:', err))
		}
		try {
			main.streamer.stop()
		} catch(e) {
			console.error('Streamer stop error:', e)
		}
		main.localEmit('exit-ui')
		cb && setTimeout(cb, 400)
	}
	canAutoRestart(){ 
		return true
	}
	restart(){
		let next = auto => {
			if(auto === true){
				if(typeof(plugins) != 'undefined' && plugins.megacubo){ // android
					return plugins.megacubo.restartApp()
				} else if(parent.Manager) {
					parent.electron.restart()
					return
				}
			}
			this.exit()
		}
		if(this.canAutoRestart()){
			next(true)
		} else {
			main.menu.dialogs.dialog([
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
				this.setBackgroundMode(true, true, true).catch((err) => console.error('Failed to enable background mode:', err))
			} else {
				parent.electron.tray.goToTray()
			}
		} else {
			if(window.capacitor){
				this.setBackgroundMode(false, true).catch((err) => console.error('Failed to disable background mode:', err))
			}
			this.exitUI(() => {
				main.emit('exit')
				if(window.capacitor){
					setTimeout(() => { // give some time to backgroundMode.disable() to remove the notification
						window.capacitor.App.exitApp().catch((err) => console.error('Failed to exit app:', err))
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
	getLimits(real){
		const scr = window.capacitor ? screen : parent.Manager.getScreenSize(real)
		const factor = 0.25
		let r = window.innerWidth / window.innerHeight
		if(main.streamer && main.streamer.active){
			r = main.streamer.activeAspectRatio.h / main.streamer.activeAspectRatio.v			
		}
		const width = scr.width * factor
		const height = width / r
		return { width, height }
	}
	shouldEnter(){
		if(this.enabled && this.supports() && main.streamer && (main.streamer.active || main.streamer.isTuning())) {
			return true
		}
	}
	enterIfPlaying(){
		if(this.shouldEnter()) {
			this.enter().catch(err => console.error('PIP FAILURE:', err))
			return true
		}
		return false
	}
}

export class AndroidWinActions extends WinActionsMiniplayer {
    constructor(main){
		super(main)
		this.pip = window.capacitor?.PIP
		this.backgroundModeInitiated = false
		this.appPaused = false
		this.backgroundModeDefaults = {}
		this.backgroundListeners = []
		this.setup()
		this.on('enter', () => {
			document.body.classList.add('miniplayer-android')
		})
		this.on('leave', () => {
			this.enteredPipTimeMs = null
			console.log('leaved miniplayer')
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
		return !!this.pip
	}
	observePIPLeave(){
		clearTimeout(this.observePIPLeaveTimer)
		let ms = 2000
		const initialDelayMs = 7000
		if(this.enteredPipTimeMs){
			const now = Date.now()
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
		if(!this.pip || !window.capacitor){
			console.warn('Capacitor or PIP plugin not available')
			return
		}

		let BackgroundMode = window.capacitor.BackgroundMode
		if(!BackgroundMode){
			console.warn('BackgroundMode plugin not available')
			return
		}

		// Listen for app lifecycle events
		this.backgroundListeners.push(
			BackgroundMode.addListener('appInBackground', () => {
				player.emit('app-pause', false)
			}).promise
		)
		this.backgroundListeners.push(
			BackgroundMode.addListener('appInForeground', () => {
				player.emit('app-resume')
			}).promise
		)

		const orientationListener = () => {
			clearTimeout(this.orientationTimeout)
			this.orientationTimeout = setTimeout(() => {
				if(main.streamer.active && !main.streamer.isAudio && document.visibilityState === 'visible'){
					const ratio = player.videoRatio() || (4 / 3)
					if (!isNaN(ratio)){
						console.log('setting PIP aspect ratio', ratio, 240 * ratio, 240)
						this.pip.aspectRatio({width: 240 * ratio, height: 240}).catch((err) => console.error('Failed to set PIP aspect ratio:', err))
					}
				}
			}, 500)
		}

		if(screen.orientation){
			screen.orientation.addEventListener('change', orientationListener)
		}
		window.addEventListener('resize', orientationListener)
		window.addEventListener('orientationchange', orientationListener)

		const stateListener = () => {
			clearTimeout(this.autoPIPTimer)
			const shouldAutoPIP = main.streamer.active && !main.streamer.isAudio && !main.streamer.casting
			if(shouldAutoPIP && document.visibilityState === 'visible'){
				this.autoPIPTimer = setTimeout(() => {
					const ratio = player.videoRatio() || 4 / 3
					this.pip.autoPIP({
						value: true,
						width: 240 * ratio,
						height: 240
					}).catch((err) => console.error('Failed to set autoPIP:', err))
				}, 1000)
			} else {
				this.pip.autoPIP({
					value: false,
					width: 0,
					height: 0
				}).catch((err) => console.error('Failed to disable autoPIP:', err))
			}
		}

		main.streamer.on('state', stateListener)
		main.streamer.on('cast-start', stateListener)
		main.streamer.on('cast-stop', stateListener)
		main.streamer.on('codecData', stateListener)

		player.on('app-pause', async screenOff => {
			if(this.inPIP && !screenOff) return
			this.appPaused = true
			const keepInBackground = this.backgroundModeLocks.length
			let keepPlaying = this.backgroundModeLocks.filter(l => l != 'schedules').length
			console.log('app-pause', screenOff, keepInBackground, keepPlaying, this.inPIP)
			if(main.streamer){
				if(!keepPlaying){
					keepPlaying = main.streamer.casting || main.streamer.isAudio
				}
				if(main.streamer.casting || main.streamer.isAudio){
					await this.setBackgroundMode(true).catch((err) => console.error('Failed to enable background mode on app-pause:', err))
				} else if(screenOff){
					if(!keepPlaying){
						main.streamer.stop()
					}
				} else if(this.shouldEnter()){
					console.log('app-pause', 'entered miniplayer')
					await this.enter().catch((err) => console.error('Failed to enter PIP on app-pause:', err))
				} else if(!keepPlaying){
					main.streamer.stop()
				}
			} else if(keepInBackground){
				await this.setBackgroundMode(true).catch((err) => console.error('Failed to enable background mode on app-pause:', err))
			}
		})

		player.on('app-resume', async () => {
			console.log('app-resume', this.inPIP)
			this.appPaused = false
			await this.setBackgroundMode(false).catch((err) => console.error('Failed to disable background mode on app-resume:', err))
			if(this.inPIP){
				this.observePIPLeave()
			}
		})

		let rotating = false
		window.addEventListener('orientationchange', () => {
			rotating = true
			setTimeout(() => rotating = false, 1000)
		})

		const resizeListener = () => {
			if(rotating) return
			const seemsPIP = this.seemsPIP()
			if(seemsPIP !== this.inPIP && (!seemsPIP || main.streamer.active || main.streamer.isTuning())) {
				console.log('miniplayer change on resize')
				if(seemsPIP){
					this.set(seemsPIP)
				} else {
					this.observePIPLeave()
				}
			}
		}

		window.addEventListener('resize', resizeListener)
		screen.orientation.addEventListener('change', resizeListener)

		this.pip.isPipModeSupported().then(() => {
			this.pipSupported = true
		}).catch((err) => {
			console.error('PiP not supported:', err)
			this.pipSupported = false
		})
	}
	setBackgroundModeDefaults(defaults){
		this.backgroundModeDefaults = defaults || {}
	}
	async setBackgroundMode(state, action = false){
		let BackgroundMode = window.capacitor?.BackgroundMode
		if(!BackgroundMode){
			console.warn('BackgroundMode plugin not available')
			return
		}

		try {
			// Check if background mode state has changed
			let { enabled } = await BackgroundMode.isEnabled()
			if(state === enabled){
				console.log(`Background mode already ${state ? 'enabled' : 'disabled'}`)
				if(action){
					if(state){
						await BackgroundMode.moveToBackground()
					} else {
						await BackgroundMode.moveToForeground()
					}
				}
				return
			}

			// Check notification permission for Android 13+
			if(state){
				let { notifications } = await BackgroundMode.checkNotificationsPermission()
				if(notifications !== 'granted'){
					let { notifications: result } = await BackgroundMode.requestNotificationsPermission()
					if(result !== 'granted'){
						console.warn('Notification permission not granted, cannot enable background mode')
						return
					}
				}
			}

			if(state){
				this.backgroundModeInitiated = true
				await BackgroundMode.enable(this.backgroundModeDefaults)
				if(action){
					await BackgroundMode.moveToBackground()
				}
			} else {
				this.backgroundModeInitiated = false
				if(action){
					await BackgroundMode.moveToForeground()
				}
				await BackgroundMode.disable()
			}
			console.log(`Background mode ${state ? 'enabled' : 'disabled'}`)
		} catch(err) {
			console.error(`Failed to set background mode (${state}):`, err)
		}
	}
    async prepare(){
		if(!this.pip){
			throw new Error('PIP unavailable')
		}
		if(this.pipSupported === true){
			await this.setBackgroundMode(true)
			return true
		}
		if(this.pipSupported === false){
			throw new Error('PIP mode not supported')
		}
		try {
			await this.pip.isPipModeSupported()
			this.pipSupported = true
			await this.setBackgroundMode(true)
			return true
		} catch(err) {
			this.pipSupported = false
			console.error('PIP not supported:', err)
			throw new Error('PIP error: ' + String(err))
		} 
    }
	seemsPIP(){
		const threshold = 0.65;
		return window.innerHeight < (screen.height * threshold) && window.innerWidth < (screen.width * threshold);
	}
    async enter(){
		if(!this.enabled){
			throw new Error('miniplayer disabled')
		}
		if(!this.supports()){
			throw new Error('PIP not supported')
		}
		await this.prepare()
		console.log('ABOUT TO PIP', this.inPIP)
		let success, m = this.getLimits()
		try {
			success = await this.pip.enter({width: m.width, height: m.height})
			if(success){
				this.enteredPipTimeMs = Date.now()
				console.log('enter: '+ String(success))
				this.set(true)
				return success
			} else {
				console.error('pip.enter() failed to enter PIP mode')	
				this.set(false)
				throw new Error('Failed to enter PIP mode')
			}
		} catch(error){
			this.set(false)
			console.error('pip.enter() error:', error)
			throw error
		}
    }
}

export class ElectronWinActions extends WinActionsMiniplayer {
    constructor(main){
		super(main)
        this.pip = parent.Manager
		this.setup()
    }
	setup(){
		if(!this.pip){
			console.warn('Electron Manager not available')
			return
		}
		this.pip.minimizeWindow = () => {
			if(this.pip.miniPlayerActive){	// if already in miniplayer, minimize it				
				this.pip.prepareLeaveMiniPlayer()
				parent.electron.window.hide()
				parent.electron.window.restore()
				setTimeout(() => {
					parent.electron.window.show()
					parent.electron.window.minimize()
				}, 0)
			} else if(!this.enterIfPlaying()){
				parent.electron.window.minimize()
			}
		}
		this.pip.closeWindow = () => this.exit()
		this.pip.on('miniplayer-on', () => this.set(true))
		this.pip.on('miniplayer-off', () => this.set(false))
		window.addEventListener('resize', () => this.resize(), { passive: true })
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
		let dimensions = this.getLimits(); // default miniplayer size
		['height', 'width'].forEach(m => dimensions[m] = dimensions[m] * 1.5) // magnetic margin to recognize miniplayer when resizing window
		return window.innerWidth <= dimensions.width && window.innerHeight <= dimensions.height
	}
    enter(){
        return new Promise((resolve, reject) => {
			if(!this.enabled){
				return reject('miniplayer disabled')
			}
            if(!this.inPIP){
				let m = this.getLimits()
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
