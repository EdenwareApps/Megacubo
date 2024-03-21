class ClassesHandler {
	constructor(){}
	hasClass(element, cls) {
		return !!element.className.match(new RegExp('(\\s|^)'+cls+'(\\s|$)'))
	}
	addClass(element, cls) {
		if (!this.hasClass(element, cls)) element.className += ' '+ cls
	}
	removeClass(element, cls) {
		if (this.hasClass(element, cls)) {
			var reg = new RegExp('(\\s|^)'+ cls +'(\\s|$)')
			element.className = element.className.replace(reg, ' ')
		}
	}
}

var ffmpeg = api.ffmpeg

class ExitPage {
	constructor(){
		this.startTime = this.time()
		this.interval = 72 * 3600
		if(!this.get('last-open')){
			this.set('last-open', this.startTime)
		}
	}
	time(){
		return Date.now() / 1000
	}
	allow(){
		if(!this.url) return
		const now = this.time(), lastOpen = parseInt(this.get('last-open'))
		if((now - this.startTime) < 10){
			return false
		}
		if((now - lastOpen) < this.interval){
			return false
		}
		this.touch()
		return true
	}
	touch(){
		this.set('last-open', this.time())
	}
	open(){
		this.allow() && api.openExternal(this.url)
	}
	get(key){
		return localStorage.getItem(key)
	}
	set(key, val){
		return localStorage.setItem(key, val)
	}
}

class ExternalPlayer {
	constructor() {}
	setContext(context) {
		this.context = context
		this.context.main.on('get-external-players', async () => {
			const results = await api.externalPlayer.available()
			this.context.main.emit('external-players', results)
		})
	}
	async play(url) {
		this.context.streamer.castUIStart()
		if(!url) url = this.context.streamer.data.url
		const availables = await api.externalPlayer.available()
		const chosen = await this.ask(availables)
		if(!chosen || !availables[chosen]) {
			this.context.main.osd.hide('casting')
			this.context.streamer.castUIStop()
			return false
		}
		const message = this.context.main.lang.CASTING_TO.replace('{0}', chosen)
		this.context.main.osd.show(message, 'fab fa-chromecast', 'casting', 'persistent')
		const exit = () => {
			this.context.main.osd.hide('casting')
			this.context.streamer.castUIStop()
		}
		const inPlayer = this.context.streamer.active
		if(inPlayer) {
			this.context.streamer.once('cast-stop', exit)
			url = this.context.streamer.activeSrc
		} else {
			exit()
		}
		api.externalPlayer.play(url, chosen)
		return true
	}
	ask(players) {
		return new Promise((resolve, reject) => {
			if(this.context.main.config['external-player']) {
				const value = this.context.main.config['external-player']
				const name = Array.isArray(value) ? value[1] : value
				console.warn('ASK', players, name)
				if(players[name]) return resolve(name)
			}
			const keys = Object.keys(players)
			if(!keys.length) {
				return reject('No external players detected.')
			} else if(keys.length == 1) {
				return resolve(keys.shift())
			}
			const opts = keys.map(name => {
				return {template: 'option', fa: 'fas fa-play-circle', text: name, id: name}
			})
			opts.unshift({template: 'question', fa: 'fas fa-window-restore', text: this.context.main.lang.OPEN_EXTERNAL_PLAYER})
			opts.push({template: 'option', fa: 'fas fa-times-circle', text: this.context.main.lang.CANCEL, id: 'cancel'})
			this.context.menu.dialog(opts, resolve, null, true)
		})
	}
}

class WindowManagerCommon extends ClassesHandler {
	constructor(){
		super()
		this.waitAppCallbacks = []
		this.trayMode = false
		this.leftWindowDiff = 0
		this.miniPlayerActive = false
		this.miniPlayerRightMargin = 18
		this.initialSize = this.getDefaultWindowSize(true)
		this.initialSizeUnscaled = this.screenScale(this.initialSize, true)
		api.window.setSize(...this.initialSizeUnscaled, false)
		this.centralizeWindow(...this.initialSizeUnscaled)
		this.exitPage = new ExitPage()
		this.externalPlayer = new ExternalPlayer()
		this.inFullScreen = false
		CustomFrame.attach(window, {
			icon: './assets/images/default_icon_white.png',
			uiIconsTheme: './assets/custom-frame/icons/css/cf-fa.css',
			style: './assets/custom-frame/custom-frame-core.css',
			frameTheme: './assets/custom-frame/custom-frame-theme.css',
			frameIconSize: 21,
			size: 30,
			win: api.window,
			details: {
				title: 'Megacubo',
				icon: './default_icon.png'
			}
		})
		this.resizeListenerDisabled = false
		this.load()
	}
	load(){
		const target = document.querySelector('iframe')
		target.src = 'http://127.0.0.1:'+ api.window.port +'/renderer/index.html'
	}
	screenScale(v, reverse){
		if(Array.isArray(v)){
			return v.map(r => this.screenScale(r, reverse))
		} else if(reverse) {
			return Math.round(v / api.screenScaleFactor)
		} else {
			return Math.round(v * api.screenScaleFactor)
		}
	}
	getDefaultWindowSize(real){
		let scr = this.getScreenSize(real), realWidth = scr.availWidth
		let margin = realWidth > 1500 ? 0.8 : 0.975
		let ratio = 16 / 9, defWidth = scr.width * margin, defHeight = defWidth / ratio
		if(defHeight > (scr.availHeight * margin)){
			defHeight = scr.availHeight * margin
			defWidth = defHeight * ratio
		}
		return [parseInt(defWidth), parseInt(defHeight)]
	}
	handleArgs(cmd){
		console.log('cmdline: ' + cmd)
		if(!Array.isArray(cmd)){
			cmd = cmd.split(' ').filter(s => s)
		}
		if(cmd.length){
			cmd = cmd.pop()
			if(cmd.length > 2 && !cmd.startsWith('-') && cmd.indexOf('\\') == -1) {
				cmd = cmd.replace(new RegExp('^"|"$', 'g'), '')
				if(!cmd.match(new RegExp('^/[^/]'))){
					console.log('cmdline*: ' + cmd)
					let sharing = '/w/', pos = cmd.indexOf(sharing)
					if(pos != -1) cmd = cmd.substr(pos + sharing.length)
					if(cmd.indexOf('//') == -1) cmd = 'mega://'+ cmd
					console.log('cmdline**: ' + cmd)
					this.app.main.waitMain(() => {
						this.app.main.emit('open-url', decodeURIComponent(cmd))
					})
				}
			}
		}
		if(api.tray.active){
			api.tray.restoreFromTray()
		}
		api.window.focus()
	}
	openFile(accepts, cb){
		if(!this.openFileDialogChooser){ // JIT
			this.openFileDialogChooser = document.createElement('input')
			this.openFileDialogChooser.type = 'file'
			document.body.appendChild(this.openFileDialogChooser)
		}
		this.openFileDialogChooser.onchange = null
		this.openFileDialogChooser.value = ''
		if(accepts){
			this.openFileDialogChooser.setAttribute('accept', accepts)
		} else {
			this.openFileDialogChooser.removeAttribute('accept')
		}
		this.openFileDialogChooser.onchange = evt => {
			if(this.openFileDialogChooser.value){
				const file = Array.from(evt.target.files).shift()
				if(file && file.path){
					cb(null, file.path)
				} else {
					cb(null, this.openFileDialogChooser.value)
				}
			} else {
				console.error('Bad file selected')
				cb('Bad file selected')
			}
		}
		this.openFileDialogChooser.click()
		return this.openFileDialogChooser
	}
	idleChange(){
		setTimeout(() => {
			let idle = this.app.main.idle.isIdle
			if(idle){			
				if(!this.hasClass(document.body, 'idle') && this.app.main.streamer.state == 'playing'){
					this.addClass(document.body, 'idle')
				}
			} else {		
				if(this.hasClass(document.body, 'idle')){
					this.removeClass(document.body, 'idle')
				}
			}
			this.updateTitlebarHeight()
		}, 250)
	}
	updateTitlebarHeight(){
		let idle = this.app.main.idle.isIdle
		if (this.inFullScreen || (idle && this.app.main.streamer.state.indexOf('video-playing') != -1)) {
			this.app.main.css(' :root { --menu-padding-top: 0px; } ', 'frameless-window')
		} else {
			this.app.main.css(' :root { --menu-padding-top: 30px; } ', 'frameless-window')
		}
	}
	focusApp(){
		const f = document.querySelector('iframe')
		f.focus()
		f.addEventListener('blur', () => f.focus(), {passive: true})
	}
	getApp(){
		if(!this.app){
			const app = document.querySelector('iframe').contentWindow
			if(app.main && app.main.streamer) {
				this.app = app
				this.externalPlayer.setContext(app)
			}
		}
		return this.app || false
	}
	waitApp(fn){
		this.getApp()
		if(this.app && this.app.main.streamer){
			fn()
		} else {
			this.waitAppCallbacks.push(fn)
		}
	}
	appLoaded(){
		this.getApp()
		this.waitAppCallbacks.forEach(f => f())
		this.waitAppCallbacks = []
	}
	on(name, fn, useCapture){
		document.addEventListener(name, fn, useCapture)
	}
	emit(name){
		var event = new CustomEvent(name)
		document.dispatchEvent(event)
	}
	isPlaying(){
		return this.app.main.streamer.state != ''
	}
	getVideoRatio(){
		const v = document.querySelector('iframe').contentWindow.document.querySelector('player video')
		return v && v.offsetWidth ? (v.offsetWidth / v.offsetHeight) : (16 / 9)
	}
	fixMaximizeButton(){
		if(this.isMaximized() || this.miniPlayerActive){
			this.showRestoreButton()
		} else {
			this.showMaximizeButton()
		}
	}
	toggleFullScreen(){
		const s = this.isFullScreen()
		console.error('toggleFullScreen', {s})
		this.setFullScreen(!s)
	}
	showMaximizeButton(){
		var e = document.querySelector('.cf-maximize')
		if(e){ // at fullscreen out or unminimize the maximize button was disappearing
			e.style.display = 'inline-block'
			document.querySelector('.cf-restore').style.display = 'none'
		}
	}
	showRestoreButton(){
		var e = document.querySelector('.cf-restore')
		if(e){
			e.style.display = 'inline-block'
			document.querySelector('.cf-maximize').style.display = 'none'
		}
	}
	patchButton(sel, fn, label){
		let old_element = document.querySelector(sel), new_element = old_element.cloneNode(true)
		old_element.parentNode.replaceChild(new_element, old_element)
		new_element.addEventListener('click', fn);
		['title', 'aria-label'].forEach(k => new_element.setAttribute(k, label))
	}
	patch(){    
		if(!document.querySelector('.cf-maximize')){
			return setTimeout(this.patch.bind(this), 250)
		}    
		this.patchButton('.cf-maximize', this.maximize.bind(this), this.app.main.lang.MAXIMIZE)
		this.patchButton('.cf-restore', () => {
			setTimeout(this.fixMaximizeButton.bind(this), 50)
			this.restore()
		}, this.app.main.lang.RESTORE)
		this.patchButton('.cf-minimize', () => {
			this.resizeListenerDisabled = true
			this.minimizeWindow()
			setTimeout(() => {
				this.resizeListenerDisabled = false
			}, 500)
		}, this.app.main.lang.MINIMIZE)
		this.patchButton('.cf-close', () => this.closeWindow(), this.app.main.lang.CLOSE)
		this.patch = () => {}
	}
	closeWindow(){ // will be overwritten by winActions
		this.close()
	}
}

class WindowManager extends WindowManagerCommon {
	constructor(){
		super()
		let appStarted
		this.fsapiLastState = this.fsapi = false
		this.on('miniplayer-on', () => {
			api.tray.setShowInTaskbar(false)
			this.fixMaximizeButton()
			api.window.show()
			appStarted && this.app.main.streamer.emit('miniplayer-on')
			this.exitPage.open()
		})
		this.on('miniplayer-off', () => {
			api.window.setAlwaysOnTop(false)
			api.tray.setShowInTaskbar(true)
			this.fixMaximizeButton()
			appStarted && this.app.main.streamer.emit('miniplayer-off')
		})
		this.waitApp(() => {
			appStarted = true
			this.app.main.css(' :root { --menu-padding-top: 30px; } ', 'frameless-window')
			this.app.main.streamer.on('fullscreenchange', fs => {
				this.inFullScreen = fs
				this.updateTitlebarHeight()
			})
			this.app.main.streamer.on('state', this.idleChange.bind(this))
			this.app.main.idle.on('idle', this.idleChange.bind(this))
			this.app.main.idle.on('active', this.idleChange.bind(this))
			this.app.main.on('arguments', this.handleArgs.bind(this))
			this.app.main.on('exit-page', url => this.exitPage.url = url)
			this.patch()
			setTimeout(() => {
				this.focusApp()
				this.app.menu.reset()
			}, 100)
		})
	}
	getScreenSize(real){
		const s = api.getScreen() || window.screen
		let {width, height, availWidth, availHeight} = s
		if(real && api.screenScaleFactor){
			width *= api.screenScaleFactor
			height *= api.screenScaleFactor
			availWidth *= api.screenScaleFactor
			availHeight *= api.screenScaleFactor
		}
		return {width, height, availWidth, availHeight}
	}
	isFullScreen(){
		if(this.fsapiLastState) {
			return !!document.fullscreenElement
		} else {
			const tolerance = 10
			const scr = this.getScreenSize()
			const { width, height } = this.size()
			const ret = (width + tolerance) >= scr.width && (height + tolerance) >= scr.height
			return !!ret
		}
	}
	async setFullScreen(enterFullscreen){
		const wasFullscreen = this.isFullScreen()
		console.error('SETFULLSCREEN', wasFullscreen, enterFullscreen)
		if(enterFullscreen == wasFullscreen) return
		this.inFullScreen = enterFullscreen
		const usefsapi = wasFullscreen ? this.fsapiLastState : this.fsapi // exit fullscreen with right method on config change
		this.fsapiLastState = this.fsapi
		if(usefsapi) {
			if(wasFullscreen) {
				document.exitFullscreen()
			} else {
				try {
					document.body.requestFullscreen()
				} catch(e) {
					console.error(e)
					this.inFullScreen = false
					document.exitFullscreen()
				}
			}
		} else {
			api.window.setFullScreen(enterFullscreen)
		}
		if(enterFullscreen){
			if(this.app){
				if(this.app.osd && this.app.main.hotkeys && this.app.main.hotkeys){
					let key = this.app.main.hotkeys.getHotkeyAction('FULLSCREEN', true)
					if(key){
						this.app.main.osd.show(this.app.main.lang.EXIT_FS_HINT.replace('{0}', key), 'fas fa-info-circle', 'esc-to-exit', 'normal')
					}
				}
			}
		} else {
			this.miniPlayerActive = false
			this.emit('miniplayer-off')
			this.fixMaximizeButton()
			if(this.app && this.app.main.osd){
				this.app.main.osd.hide('esc-to-exit')
			}
		}
		api.window.show()
		if(!this.cfHeader) this.cfHeader = document.querySelector('.cf')
		this.cfHeader.style.display = enterFullscreen ? 'none' : 'block';
		setTimeout(() => {
			// if(enterFullscreen) api.window.blur()
			this.updateTitlebarHeight()
			this.fixMaximizeButton()
			api.window.setAlwaysOnTop(enterFullscreen || this.miniPlayerActive)
			api.window.focus()
		}, 400)
	}
	restore(){
		console.error('leaveMiniPlayer')
		if(this.isFullScreen()){
			this.setFullScreen(false)
		} else if(this.miniPlayerActive) {
			this.leaveMiniPlayer()
		} else if(api.window.isMaximized()) {
			api.window.restore()
			const size = this.restoreSize || this.initialSize
			console.warn('restore()', size)
			api.window.setSize(size[0], size[1], false)
			this.centralizeWindow.apply(this, size)
		}
		this.showMaximizeButton()
	}
	centralizeWindow(w, h){
		var s = this.getScreenSize(false), x = Math.round((s.availWidth - (w || window.outerWidth)) / 2)
		var y = Math.round((s.availHeight - (h || window.outerHeight)) / 2)
		api.window.setPosition(x, y, false)
	}
	enterMiniPlayer(w, h){
		console.warn('enterminiPlayer', w, h)
		this.miniPlayerActive = true
		this.emit('miniplayer-on')
		let scr = this.getScreenSize()
		const ww = (w + this.miniPlayerRightMargin) // * api.screenScaleFactor
		const args = [scr.availWidth - ww, scr.availHeight - h].map(n => parseInt(n))
		console.warn('enterMiniPlayer', args, {scr, w, h}, scr.availWidth - ww, scr.availHeight - h)
		api.window.setPosition(...args, false)
		api.window.setSize(w, h, false)
	}
	prepareLeaveMiniPlayer(){
		console.warn('prepareLeaveMiniPlayer')
		this.miniPlayerActive = false
		api.window.setAlwaysOnTop(false)
		this.emit('miniplayer-off')
	}
	leaveMiniPlayer(){
		console.warn('leaveMiniPlayer')
		this.prepareLeaveMiniPlayer()
		api.window.setSize(...this.initialSizeUnscaled, false)
		this.centralizeWindow(...this.initialSizeUnscaled)
	}
	size(){
		const [width, height] = api.window.getSize()
		return {width, height}
	}
	isMaximized(){
		const position = api.window.getPosition()
		if(position.some(v => v > 0)) return false
		var w = window, widthMargin = 6, heightMargin = 6, scr = this.getScreenSize()
		return (w.outerWidth >= (scr.availWidth - widthMargin) && w.outerHeight >= (scr.availHeight - heightMargin))
	}
	maximize(){
		if(!this.isMaximized()){
			if(!this.miniPlayerActive){
				const ret = this.size()
				ret && ret.width && (this.restoreSize = Object.values(ret))
			}
			api.window.maximize()
			this.showRestoreButton()
		}
	}
	minimizeWindow(){		
		this.resizeListenerDisabled = true
		api.window.show()
		api.window.minimize()
		setTimeout(() => {
			this.resizeListenerDisabled = false
		}, 500)
	}
	close(){
		this.exitPage.open()
		api.window.close()
	}
}
