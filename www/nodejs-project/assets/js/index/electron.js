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

const fs = require('fs'), path = require('path')

class FFmpegDownloader {
	constructor(){}
	dl(){
		return getElectronRemote().getGlobal('Download')
	}
	async download(target, osd, mask) {
		const Download = this.dl()
		const tmpZipFile = path.join(target, 'ffmpeg.zip')
		const arch = process.arch == 'x64' ? 64 : 32
		let osName
		switch (process.platform) {
			case 'darwin':
				osName = 'macos'
				break
			case 'win32':
				osName = 'windows'
				break
			default:
				osName = 'linux'
				break
		}
		const variant = osName + '-' + arch
		const url = await this.getVariantURL(variant)
		osd.show(mask.replace('{0}', '0%'), 'fas fa-circle-notch fa-spin', 'ffmpeg-dl', 'persistent')
		await Download.file({
			url,
			file: tmpZipFile,
			progress: p => {
				osd.show(mask.replace('{0}', p + '%'), 'fas fa-circle-notch fa-spin', 'ffmpeg-dl', 'persistent')
			}
		})
		const AdmZip = require('adm-zip')
		const zip = new AdmZip(tmpZipFile)
		const entryName = process.platform == 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
		const targetFile = path.join(target, entryName)
		zip.extractEntryTo(entryName, target, false, true)
		fs.unlink(tmpZipFile, () => {})
		return targetFile
	}
	async check(osd, mask, folder){
		try {
			await fs.promises.access(path.join(this.executableDir, this.executable), fs.constants.F_OK)
			return true
		} catch (error) {
			try {
				await fs.promises.access(path.join(folder, this.executable), fs.constants.F_OK)
				this.executableDir = folder
				return true
			} catch (error) {
				let err
				const file = await this.download(folder, osd, mask).catch(e => err = e)
				if (err) {
					osd.show(String(err), 'fas fa-exclamation-triangle faclr-red', 'ffmpeg-dl', 'normal')
				} else {
					osd.show(mask.replace('{0}', '100%'), 'fas fa-circle-notch fa-spin', 'ffmpeg-dl', 'normal')
					this.executableDir = path.dirname(file)
					this.executable = path.basename(file)
					return true
				}
			}
		}
		return false
	}
	async getVariantURL(variant){
		const Download = this.dl()
		const data = await Download.get({url: 'https://ffbinaries.com/api/v1/versions', responseType: 'json'})
		for(const version of Object.keys(data.versions).sort().reverse()){
			const versionInfo = await Download.get({url: data.versions[version], responseType: 'json'})
			if(versionInfo.bin && typeof(versionInfo.bin[variant]) != 'undefined'){
				return versionInfo.bin[variant].ffmpeg
			}
		}
	}
}

class FFMpeg extends FFmpegDownloader {
	constructor(){
		super()
		this.childs = {}
		this.executable = 'ffmpeg'
		if(process.platform == 'win32'){
			this.executable += '.exe'
		}
		this.executableDir = process.resourcesPath || path.resolve('ffmpeg')
		this.executable = path.basename(this.executable)
		this.tmpdir = require('os').tmpdir()
	}
	isMetadata(s){
		return s.indexOf('Stream mapping:') != -1
	}
	exec(cmd, cb){
		if(!this.cp){
			this.cp = window.require('child_process')
		}
		let exe, gotMetadata, output = ''
		if(process.platform == 'linux'){ // cwd was not being honored on Linux
			exe = this.executableDir +'/'+ this.executable
		} else {
			exe = this.executable
		}
		const child = this.cp.spawn(exe, cmd, {
			cwd: this.executableDir, 
			killSignal: 'SIGINT'
		})
		const maxLogLength = 1 * (1024 * 1024), log = s => {
			s = String(s)
			output += s
			if(output.length > maxLogLength){
				output = output.substr(-maxLogLength)
			}
			if(!gotMetadata && this.isMetadata(s)){
				gotMetadata = true
				cb('metadata-'+ output)
			}
		}
		child.stdout.on('data', log)
		child.stderr.on('data', log)
		child.on('error', err => {
			console.log('FFEXEC ERR', cmd, child, err, output)
		})
		child.once('close', () => {
			delete this.childs[child.pid]
			console.log('FFEXEC DONE', cmd, child, output)
			cb('return-'+ output)
			child.removeAllListeners()
		})
		console.log('FFEXEC '+ this.executable, cmd, child)
		this.childs[child.pid] = child
		cb('start-'+ child.pid)
	}
	abort(pid){
		if(typeof(this.childs[pid]) != 'undefined'){
			const child = this.childs[pid]
			delete this.childs[pid]
			child.kill('SIGINT')
		} else {
			console.log('CANTKILL', pid)
		}
	}
	cleanup(keepIds){
		Object.keys(this.childs).forEach(pid => {
			if(keepIds.includes(pid)){				
				console.log("Cleanup keeping " + pid)
			} else {
				console.log("Cleanup kill " + pid)
				this.abort(pid)
			}
		})
	}
}

function getElectronRemote(){
	let electronRemote
	if(process.versions.electron && parseFloat(process.versions.electron) >= 22){
		electronRemote = require('@electron/remote')
	} else {
		electronRemote = require('electron')
		if(electronRemote.remote){
			electronRemote = electronRemote.remote
		}
	}
	return electronRemote
}

var ffmpeg = new FFMpeg()
const { screen: electronScreen, Menu, Tray, getCurrentWindow, shell } = getElectronRemote()

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
	manifest(callback) {
		fetch('./package.json')
			.then(response => response.text())
			.then(data => {
				data = data.replace(new RegExp('/\\* .+ \\*/', 'gm'), '')
				data = JSON.parse(data.split("\n").join(""))
				callback(null, data);
			})
			.catch(error => {
				console.error('Erro ao obter o manifesto:', error)
				callback(error)
			})
	}
	open(){
		if(this.allow()){
			this.manifest(data => {
				const version = data && data.version ? data.version : ''
				shell.openExternal('http://app.megacubo.net/out.php?ver='+ version)
			})
		}
	}
	get(key){
		return localStorage.getItem(key)
	}
	set(key, val){
		return localStorage.setItem(key, val)
	}
}

class WindowManagerCommon extends ClassesHandler {
	constructor(){
		super()
		this.screenScaleFactor = electronScreen.getPrimaryDisplay().scaleFactor || 1
		this.win = getCurrentWindow()
		this.waitAppCallbacks = []
		this.trayMode = false
		this.leftWindowDiff = 0
		this.miniPlayerActive = false
		this.miniPlayerRightMargin = 18
		this.initialSize = this.getDefaultWindowSize(true)
		this.initialSizeUnscaled = this.screenScale(this.initialSize, true)
		this.win.setSize(...this.initialSizeUnscaled, false)
		this.centralizeWindow(...this.initialSizeUnscaled)
		this.exitPage = new ExitPage()
		this.inFullScreen = false
		this.nwcf = require('./modules/nw-custom-frame')
		this.nwcf.attach(window, {
			icon: './assets/images/default_icon_white.png',
			uiIconsTheme: './modules/nw-custom-frame/icons/css/nw-cf-fa.css',
			frameIconSize: 21, // You can specify the size in em,rem, etc...
			size: 30, // You can specify the size in em,rem, etc...
			win: this.win,
			details: require('./package.json').window
		})
		this.resizeListenerDisabled = false
		this.load()
	}
	load(){
		const target = document.querySelector('iframe')
		const { opts: { port } } = getElectronRemote().getGlobal('ui')
		target.src = 'http://127.0.0.1:'+ port +'/index.html'
	}
	screenScale(v, reverse){
		if(Array.isArray(v)){
			return v.map(r => this.screenScale(r, reverse))
		} else if(reverse) {
			return Math.round(v / this.screenScaleFactor)
		} else {
			return Math.round(v * this.screenScaleFactor)
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
			if(cmd.length && cmd.charAt(0) != '-' && !cmd.match(new RegExp('^/[^/]'))){
				console.log('cmdline*: ' + cmd)
				let sharing = '/w/', pos = cmd.indexOf(sharing)
				if(pos != -1){
					cmd = cmd.substr(pos + sharing.length)
				}
				if(cmd.indexOf('//') == -1){
					cmd = 'mega://'+ cmd
				}
				console.log('cmdline**: ' + cmd)
				this.container.onBackendReady(() => {
					this.container.channel.post('message', ['open-url', decodeURIComponent(cmd)])
				})
			}
		}
		if(this.tray){
			this.restoreFromTray()
		}
		this.win.focus()
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
			let idle = this.app.idle.isIdle
			if(idle){			
				if(!this.hasClass(document.body, 'idle') && this.app.streamer.state == 'playing'){
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
		let idle = this.app.isIdle
		if (this.inFullScreen || (idle && this.app.streamer.state.indexOf('video-playing') != -1)) {
			this.app.css(' :root { --explorer-padding-top: 0px; } ', 'frameless-window')
		} else {
			this.app.css(' :root { --explorer-padding-top: 30px; } ', 'frameless-window')
		}
	}
	focusApp(){
		[document.querySelector('iframe'), this.container.document.querySelector('iframe')].forEach(f => {
			f.focus()
			f.addEventListener('blur', () => f.focus())
		})
	}
	getApp(){
		if(!this.container){
			this.container = document.querySelector('iframe').contentWindow
		}
		if(!this.app && this.container){
			const app = this.container.document.querySelector('iframe')
			if(app && app.contentWindow){
				this.app = app.contentWindow
			}
		}
		return this.app && this.app.streamer ? this.app : false
	}
	waitApp(fn){
		this.getApp()
		if(this.app && this.app.streamer){
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
		return this.app.streamer.state != ''
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
		var e = document.querySelector('.nw-cf-maximize')
		if(e){ // at fullscreen out or unminimize the maximize button was disappearing
			e.style.display = 'inline-block'
			document.querySelector('.nw-cf-restore').style.display = 'none'
		}
	}
	showRestoreButton(){
		var e = document.querySelector('.nw-cf-restore')
		if(e){
			e.style.display = 'inline-block'
			document.querySelector('.nw-cf-maximize').style.display = 'none'
		}
	}
	patchButton(sel, fn, label){
		let old_element = document.querySelector(sel), new_element = old_element.cloneNode(true)
		old_element.parentNode.replaceChild(new_element, old_element)
		new_element.addEventListener('click', fn);
		['title', 'aria-label'].forEach(k => new_element.setAttribute(k, label))
	}
	patch(){    
		if(!document.querySelector('.nw-cf-maximize')){
			return setTimeout(this.patch.bind(this), 250)
		}    
		this.patchButton('.nw-cf-maximize', this.maximize.bind(this), this.app.lang.MAXIMIZE)
		this.patchButton('.nw-cf-restore', () => {
			setTimeout(this.fixMaximizeButton.bind(this), 50)
			this.restore()
		}, this.app.lang.RESTORE)
		this.patchButton('.nw-cf-minimize', () => {
			this.resizeListenerDisabled = true
			this.minimizeWindow()
			setTimeout(() => {
				this.resizeListenerDisabled = false
			}, 500)
		}, this.app.lang.MINIMIZE)
		this.patchButton('.nw-cf-close', () => this.closeWindow(), this.app.lang.CLOSE)
		this.patch = () => {}
	}
	closeWindow(){ // will be overwritten by winman
		this.close()
	}
}

class WindowManager extends WindowManagerCommon {
	constructor(){
		super()
		let appStarted
		this.fsapiLastState = this.fsapi = false
		this.on('miniplayer-on', () => {
			this.setShowInTaskbar(false)
			this.fixMaximizeButton()
			this.win.show()
			appStarted && this.app.streamer.emit('miniplayer-on')
			this.exitPage.open()
		})
		this.on('miniplayer-off', () => {
			this.win.setAlwaysOnTop(false)
			this.setShowInTaskbar(true)
			this.fixMaximizeButton()
			appStarted && this.app.streamer.emit('miniplayer-off')
		})
		this.waitApp(() => {
			appStarted = true
			this.app.css(' :root { --explorer-padding-top: 30px; } ', 'frameless-window')
			this.app.streamer.on('fullscreenchange', fs => {
				this.inFullScreen = fs
				this.updateTitlebarHeight()
			})
			this.app.streamer.on('state', this.idleChange.bind(this))
			this.app.idle.on('idle', this.idleChange.bind(this))
			this.app.idle.on('active', this.idleChange.bind(this))
			this.patch()
			setTimeout(() => {
				this.focusApp()
				this.app.explorer.reset()
				const { app } = getElectronRemote()
				app.on('open-file', (event, path) => this.handleArgs(path))
				this.handleArgs(process.argv)
			}, 100)
		})
	}
	setShowInTaskbar(enable) {
		if(enable){
			this.win.setAlwaysOnTop(false)
		} else {
			this.win.setAlwaysOnTop(true, 'screen-saver')
		}
	}
	prepareTray() {
		if (!this.tray) {
			const icon = path.join(process.resourcesPath, './app/default_icon.png')
			const title = document.title
			this.tray = new Tray(icon)
			this.tray.setToolTip(title)
			const contextMenu = Menu.buildFromTemplate([
				{
					label: title,
					click: () => {
						this.win.show()
						this.tray.destroy()
						this.tray = null
					}
				},
				{
					label: this.app.lang.CLOSE,
					click: () => {
						this.tray.destroy()
						this.tray = null
						this.close()
					}
				}
			])
			this.tray.setContextMenu(contextMenu)
			this.tray.on('click', () => {
				this.win.show()
				this.tray.destroy()
				this.tray = null
			})
		}
	}
	removeFromTray(){
		console.error('leaveMiniPlayer')
		if(this.tray){
			this.tray.remove()
			this.tray = false
			this.setShowInTaskbar(true)
		}
	}
	goToTray(){
		this.prepareTray()
		this.win.hide()
		this.setShowInTaskbar(false)
	}
	restoreFromTray(){
		console.error('leaveMiniPlayer')
		this.win.show()
		this.removeFromTray()
	}
	restart(){
		console.log('restartApp') 
		const { app } = getElectronRemote()
		process.nextTick(() => {
			app.relaunch()
			app.exit()
		})
	}
	getScreen() {
		const primaryDisplay = electronScreen.getPrimaryDisplay()
		const scaleFactor = primaryDisplay.scaleFactor
		const bounds = primaryDisplay.bounds
		const workArea = primaryDisplay.workArea
		const screenData = {
			width: bounds.width,
			height: bounds.height,
			availWidth: workArea.width,
			availHeight: workArea.height,
			screenScaleFactor: scaleFactor
		}	  
		return screenData
	}
	getScreenSize(real){
		const s = this.getScreen() || window.screen
		let {width, height, availWidth, availHeight} = s
		if(s.screenScaleFactor){
			this.screenScaleFactor = s.screenScaleFactor
		}
		if(real && this.screenScaleFactor){
			width *= this.screenScaleFactor
			height *= this.screenScaleFactor
			availWidth *= this.screenScaleFactor
			availHeight *= this.screenScaleFactor
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
			this.win.setFullScreen(this.inFullScreen)
		}
		if(enterFullscreen){
			if(this.app){
				if(this.app.osd && this.app.hotkeys && this.app.hotkeys){
					let key = this.app.hotkeys.getHotkeyAction('FULLSCREEN', true)
					if(key){
						this.app.osd.show(this.app.lang.EXIT_FS_HINT.replace('{0}', key), 'fas fa-info-circle', 'esc-to-exit', 'normal')
					}
				}
			}
		} else {
			this.miniPlayerActive = false
			this.emit('miniplayer-off')
			this.fixMaximizeButton()
			if(this.app && this.app.osd){
				this.app.osd.hide('esc-to-exit')
			}
		}
		this.win.show()
		if(!this.nwcfHeader) this.nwcfHeader = document.querySelector('.nw-cf')
		this.nwcfHeader.style.display = enterFullscreen ? 'none' : 'block';
		setTimeout(() => {
			// if(enterFullscreen) this.win.blur()
			this.updateTitlebarHeight()
			this.fixMaximizeButton()
			this.win.setAlwaysOnTop(enterFullscreen || this.miniPlayerActive)
			this.win.focus()
		}, 400)
	}
	restore(){
		console.error('leaveMiniPlayer')
		if(this.isFullScreen()){
			this.setFullScreen(false)
		} else if(this.miniPlayerActive) {
			this.leaveMiniPlayer()
		} else if(this.win.isMaximized()) {
			this.win.restore()
			const size = this.restoreSize || this.initialSize
			console.warn('restore()', size)
			this.win.setSize(size[0], size[1], false)
			this.centralizeWindow.apply(this, size)
		}
		this.showMaximizeButton()
	}
	centralizeWindow(w, h){
		var s = this.getScreenSize(false), x = Math.round((s.availWidth - (w || window.outerWidth)) / 2)
		var y = Math.round((s.availHeight - (h || window.outerHeight)) / 2)
		this.win.setPosition(x, y, false)
	}
	enterMiniPlayer(w, h){
		console.warn('enterminiPlayer', w, h)
		this.miniPlayerActive = true
		this.emit('miniplayer-on')
		let scr = this.getScreenSize()
		const ww = (w + this.miniPlayerRightMargin) // * this.screenScaleFactor
		const args = [scr.availWidth - ww, scr.availHeight - h].map(n => parseInt(n))
		console.warn('enterMiniPlayer', args, {scr, w, h}, scr.availWidth - ww, scr.availHeight - h)
		this.win.setPosition(...args, false)
		this.win.setSize(w, h, false)
	}
	prepareLeaveMiniPlayer(){
		console.warn('prepareLeaveMiniPlayer')
		this.miniPlayerActive = false
		this.win.setAlwaysOnTop(false)
		this.emit('miniplayer-off')
	}
	leaveMiniPlayer(){
		console.warn('leaveMiniPlayer')
		this.prepareLeaveMiniPlayer()
		this.win.setSize(...this.initialSizeUnscaled, false)
		this.centralizeWindow(...this.initialSizeUnscaled)
	}
	size(){
		const [width, height] = this.win.getSize()
		return {width, height}
	}
	isMaximized(){
		if(this.win.x > 0 || this.win.y > 0) return false
		var w = window, widthMargin = 6, heightMargin = 6, scr = this.getScreenSize()
		return (w.outerWidth >= (scr.availWidth - widthMargin) && w.outerHeight >= (scr.availHeight - heightMargin))
	}
	maximize(){
		if(!this.isMaximized()){
			if(!this.miniPlayerActive){
				const ret = this.size()
				ret && ret.width && (this.restoreSize = Object.values(ret))
			}
			this.win.maximize()
			this.showRestoreButton()
		}
	}
	minimizeWindow(){		
		this.resizeListenerDisabled = true
		this.win.show()
		this.win.minimize()
		setTimeout(() => {
			this.resizeListenerDisabled = false
		}, 500)
	}
	close(){
		this.exitPage.open()
		this.win.close()
	}
}
