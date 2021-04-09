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

class FFMpeg {
	constructor(){
		this.childs = {}
		this.executable = require('path').resolve('ffmpeg/ffmpeg')
		if(this.executable.indexOf(' ') != -1){
			this.executable = '"'+ this.executable +'"'
			if(['darwin'].includes(process.platform)){
				this.executable = this.executable.replace(new RegExp(' ', 'g'), '\\ ')
			}
		}
		if(process.platform == 'win32'){
			this.executable += '.exe'
			this.executable = this.executable.replace(new RegExp('\\\\', 'g'), '/')
		}
		this.tmpdir = require('os').tmpdir()
	}
	exec(cmd, cb){
		if(!this.cp){
			this.cp = top.require('child_process')
		}
		let stdout = '', stderr = '', child = this.cp.spawn(this.executable, cmd, {
			cwd: this.tmpdir, 
			killSignal: 'SIGINT'
		})
		child.stdout.on('data', s => stdout += s)
		child.stderr.on('data', s => stderr += s)
		child.on('error', err => {
			delete this.childs[child.pid]
			console.log('FFEXEC DONE', cmd, child, err, stdout, stderr)
			if (err) {
				cb(String(err || stderr) || 'error')
			}
		})
		child.on('close', () => {
			delete this.childs[child.pid]
			console.log('FFEXEC DONE', cmd, child, stdout, stderr)
			cb('return-'+ (stderr || stdout))
		})
		console.log('FFEXEC '+ this.executable, cmd, child)
		this.childs[child.pid] = child
		cb('start-'+ child.pid)
	}
	kill(pid){
		if(typeof(this.childs[pid]) != 'undefined'){
			this.childs[pid].kill('SIGINT')
			delete this.childs[pid]
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
				this.kill(pid)
			}
		})
	}
}

ffmpeg = new FFMpeg()

class WindowManager extends ClassesHandler {
	constructor(){
		super()
		this.trayMode = false
		this.win = nw.Window.get()
		this.leftWindowDiff = 0
		this.miniPlayerActive = false
		this.initialSize = [this.win.width, this.win.height]
		this.miniPlayerRightMargin = 18
		this.inFullScreen = false
		this.nwcf = require('nw-custom-frame')
		this.nwcf.attach(window, {
			'icon': 'assets/images/default_icon_white.png',
			'size': 30, // You can specify the size in em,rem, etc...
			'frameIconSize': 21 // You can specify the size in em,rem, etc...
		})
		this.on('miniplayer-on', () => {
			console.warn('MINIPLAYER ON')
			this.win.setAlwaysOnTop(true)
			this.win.setShowInTaskbar(false)
			this.fixMaximizeButton()
			this.app.streamer.emit('miniplayer-on')
		})
		this.on('miniplayer-off', () => {
			console.warn('MINIPLAYER OFF')
			this.win.setAlwaysOnTop(false)
			this.win.setShowInTaskbar(true)
			this.fixMaximizeButton()
			this.app.streamer.emit('miniplayer-off')
		})
		this.waitApp(() => {
			this.app.css(' :root { --explorer-padding-top: 30px; } ', 'frameless-window')
			this.app.streamer.on('fullscreenchange', fs => {
				console.warn('FULLSCREEN CHANGE', fs)
				this.inFullScreen = fs
				this.updateTitlebarHeight()
			})
			this.app.addEventListener('idle-start', this.idleChange.bind(this))
			this.app.addEventListener('idle-stop', this.idleChange.bind(this))
			this.app.streamer.on('state', this.idleChange.bind(this))
			this.app.restart = this.restart.bind(this)
			this.patch()
			setTimeout(() => {
				this.focusApp()
				this.app.explorer.reset()
				nw.App.on('open', this.handleArgs.bind(this))
				this.handleArgs(nw.App.argv)
			}, 100)
		})
	}
	handleArgs(cmd){
		console.log('cmdline: ' + cmd)
		if(!Array.isArray(cmd)){
			cmd = cmd.split(' ').filter(s => s)
		}
		if(cmd.length){
			cmd = cmd.pop()
			if(cmd.length && cmd.charAt(0) != '-'){
				console.log('cmdline*: ' + cmd)
				let sharing = '/assistir/', pos = cmd.indexOf(sharing)
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
	}
	prepareTray(){
		if(!this.tray){
			const title = 'Megacubo'
			this.tray = new nw.Tray({
				title, 
				icon: 'default_icon.png', 
				click: () => this.restoreFromTray()
			})
			this.tray.on('click', () => this.restoreFromTray())
			const menu = new nw.Menu()
			menu.append(new nw.MenuItem({
				label: title,
				click: () => this.restoreFromTray()
			}))
			menu.append(new nw.MenuItem({
				label: this.app.lang.CLOSE,
				click: () => {
					this.tray = false
					this.close()
				}
			}))
			this.tray.menu = menu
			this.tray.tooltip = title
		}
	}
	removeFromTray(){
		if(this.tray){
			this.tray.remove();
			this.tray = false;
			this.win.setShowInTaskbar(true)
		}
	}
	goToTray(){
		this.prepareTray()
		this.win.hide()
		this.win.setShowInTaskbar(false)
	}
	restoreFromTray(){
		this.win.show()
		this.removeFromTray()
	}
	restart(){
		console.log('restartApp')  
		this.win.hide()
		process.on('exit', function () {
			require('child_process').spawn(process.execPath, nw.App.argv, {
				shell: false,
				detached: true
			})
		})
		process.exit()
	}
	idleChange(){
		setTimeout(() => {
			let idle = this.app.isIdle
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
	waitApp(fn){
		if(this.waitAppTimer){
			clearTimeout(this.waitAppTimer)
		}
		if(!this.container){
			this.container = document.querySelector('iframe').contentWindow
		}
		if(this.container.document.querySelector('iframe') && this.container.document.querySelector('iframe').contentWindow){
			this.app = this.container.document.querySelector('iframe').contentWindow
			if(this.app.streamer){
				fn()
			} else {
				this.app.addEventListener('streamer-ready', fn)
			}
		} else if(!this.container){
			document.querySelector('iframe').addEventListener('load', () => {
				this.waitApp(fn)
			})
		} else {
			this.waitAppTimer = setTimeout(this.waitApp.bind(this, fn), 250)
		}
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
	isFullScreen(){
		return (this.win && this.win.width >= screen.width && this.win.height >= screen.height) || !!(this.win.isKioskMode || this.win.isFulscreen)
	}
	setFullScreen(enter){
		console.warn('setFullscreen()', enter);
		if(!enter){
			this.inFullScreen = this.miniPlayerActive = false;
			this.emit('miniplayer-off');
			this.win.leaveKioskMode(); // bugfix, was remembering to enter fullscreen irreversibly
			this.win.leaveFullscreen();
			console.log('FSOUT');
			this.fixMaximizeButton()
			console.log('FSOUT');
			if(this.app && this.app.osd){
				this.app.osd.hide('esc-to-exit')
			}
		} else {
			this.inFullScreen = true;
			this.win.enterFullscreen()
			if(this.app && this.app.osd && this.app.getActionHotkey){
				let key = this.app.getActionHotkey('FULLSCREEN', true)
				if(key){
					this.app.osd.show(this.app.lang.EXIT_FS_HINT.replace('{0}', key), 'fas fa-info-circle', 'esc-to-exit', 'normal')
				}
			}
		}
		var f = () => {
			console.log('FSOUT1');
			var _fs = this.isFullScreen();
			this.win.setAlwaysOnTop(_fs || this.miniPlayerActive);
			this.win.requestAttention(_fs);
			if(_fs) {
				this.win.blur();
				this.win.focus()
			}
			console.log('FSOUT1OK');
		}
		setTimeout(f, 500);
		setTimeout(f, 1000);
		setTimeout(f, 2000);
		this.win.show()
	}
	restore(){
		if(this.isFullScreen()){
			this.setFullScreen(false)
		} else if(this.miniPlayerActive) {
			this.leaveMiniPlayer()
		} else {
			console.warn('restore()', this.initialSize);
			this.win.width = this.initialSize[0]
			this.win.height = this.initialSize[1]
			this.centralizeWindow.apply(this, this.initialSize)
		}
		this.showMaximizeButton()
	}
	centralizeWindow(w, h){
		console.warn('centralizeWindow()', w, h);
		var x = Math.round((screen.availWidth - (w || window.outerWidth)) / 2);
		var y = Math.round((screen.availHeight - (h || window.outerHeight)) / 2);
		this.win.x = x;
		this.win.y = y;
		console.log('POS', x, y);
	}
	getVideoRatio(){
		const v = document.querySelector('iframe').contentWindow.document.querySelector('video')
		return v && v.offsetWidth ? (v.offsetWidth / v.offsetHeight) : (16 / 9)
	}
	enterMiniPlayer(w, h){
		this.win.hide()
		setTimeout(() => { 
			this.miniPlayerActive = true;  
			this.emit('miniplayer-on');
			window.resizeTo(w, h);
			window.moveTo(screen.availWidth - w - this.miniPlayerRightMargin, screen.availWidth - h)
		}, 100)
		setTimeout(() => { 
			this.win.show() 
		}, 250)
	}
	prepareLeaveMiniPlayer(){
		this.miniPlayerActive = false;  
		this.win.setAlwaysOnTop(false)
		this.emit('miniplayer-off')
	}
	leaveMiniPlayer(){
		this.prepareLeaveMiniPlayer()
		window.resizeTo.apply(window, this.initialSize)
		this.centralizeWindow.apply(this, this.initialSize)
	}
	fixMaximizeButton(){
		if(this.isMaximized() || this.miniPlayerActive){
			this.showRestoreButton()
		} else {
			this.showMaximizeButton()
		}
	}
	toggleFullScreen(){
		this.setFullScreen(!this.isFullScreen());
	}
	isMaximized(){
		if(this.win.x > 0 || this.win.y > 0) return false;
		var w = window, widthMargin = 6, heightMargin = 6;
		return (w.outerWidth >= (screen.availWidth - widthMargin) && w.outerHeight >= (screen.availHeight - heightMargin));
	}
	maximize(){
		if(!this.isMaximized()){
			if(!this.miniPlayerActive){
				this.initialSize = [this.win.width, this.win.height]
			}
			this.win.setMaximumSize(0, 0);
			this.win.x = this.win.y = this.leftWindowDiff;
			process.nextTick(() => {
				this.win.width = screen.availWidth + (this.leftWindowDiff * -2);
				this.win.height = screen.availHeight + (this.leftWindowDiff * -2);
				this.win.x = this.win.y = this.leftWindowDiff;
			})
		}
		this.showRestoreButton()
	}
	minimizeWindow(){
		this.win.show()
		this.win.minimize()
	}
	showMaximizeButton(){
		var e = document.querySelector('.nw-cf-maximize');
		if(e){ // at fullscreen out or unminimize the maximize button was disappearing
			e.style.display = 'inline-block';
			document.querySelector('.nw-cf-restore').style.display = 'none';
		}
	}
	showRestoreButton(){
		var e = document.querySelector('.nw-cf-restore');
		if(e){
			e.style.display = 'inline-block';
			document.querySelector('.nw-cf-maximize').style.display = 'none';
		}
	}
	setCloseToTray(enable){		
		this.closeToTray = enable
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
			setTimeout(this.fixMaximizeButton.bind(this), 50);
			this.restore()
		}, this.app.lang.RESTORE)
		this.patchButton('.nw-cf-minimize', () => this.minimizeWindow(), this.app.lang.MINIMIZE)
		this.patchButton('.nw-cf-close', () => {
			if(this.closeToTray){
				this.goToTray()
			} else {
				this.close()
			}
		}, this.app.lang.CLOSE)
		this.patch = () => {}
	}
	forceClose(){
		nw.App.closeAllWindows()
		this.win.close(true)
	}
	close(){
		console.error('nw close()')
		try {
			this.app.exit()
			setTimeout(() => this.forceClose(), 3000)
		} catch(e) {
			this.forceClose()
		}
	}
}
