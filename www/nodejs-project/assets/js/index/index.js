function log(msg, id){
	if(id){
		var d = document.getElementById(id)
		if(d){
			d.parentNode.removeChild(d)
		}
	}
	if(typeof(msg) != 'string'){
		msg = String(msg)
	}
	document.getElementById('info').innerHTML += '<div '+ (id?('id="'+ id +'"'):'') +'>'+ msg +'</div>'
	console.log('[' + id + '] ' + msg)
}

let maxAlerts = 8
window.onerror = function (message, file, line, column, errorObj) {
	let stack = typeof(errorObj) == 'object' && errorObj !== null && errorObj.stack ? errorObj.stack : traceback()
	if(maxAlerts){
		maxAlerts--
		if(file && file.startsWith('blob:http://') == -1){ // ignore hls.js errors
            alert(message +' '+ file +':'+ line +' '+ stack)
			log(message)
		}
	}
	console.error(errorObj || message, {errorObj, message, file, stack})
	return true
}

function isES6(){
    try{
		Function('() => { let a; };');
		return true
    } catch(exception) {
        return false
    }
}

function updateWebView(){
	var msg
	switch(navigator.language.substr(0, 2)){
		case 'pt':
			msg = "Oops, você precisa atualizar o WebView de seu sistema para rodar este aplicativo."
			break
		case 'es':
			msg = "Vaya, debe actualizar el WebView de su sistema para ejecutar esta aplicación."
			break
		case 'it':
			msg = "Spiacenti, è necessario aggiornare WebView del sistema per eseguire questa applicazione."
			break
		default:
			msg = "Oops, you need to update your system's WebView in order to run this application."
			break
	}
	log(msg)
	alert(msg)
	parent.close()
}

var themeBackgroundReady
function theming(image, video, color, fontColor, animate){
	console.warn('theming', image, video, color, fontColor, animate)
	var bg = document.getElementById('background'), splash = document.getElementById('splash'), data = localStorage.getItem('background-data')
	const defaultData = {
		image: screen.width > 1920 ? './assets/images/background-3840x2160.png' : './assets/images/background-1920x1080.png', 
		video: '', 
		color: '#15002C', 
		fontColor: '#FFFFFF', 
		animate: 'none'
	}
	if(data){
		data = JSON.parse(data)
		Object.keys(defaultData).forEach(function (k){
			if(typeof(data[k]) == 'undefined'){
				data[k] = defaultData[k]
			}
		})
	} else {
		data = defaultData // defaults
		try {
			localStorage.setItem('background-data', JSON.stringify(data))
		} catch(e) {
			console.error(e)
			data.video = ''
			data.image = ''
			localStorage.setItem('background-data', JSON.stringify(data))
			data.image = image
			data.video = video
		}
	}
	if(typeof(image) == 'string' || typeof(video) == 'string'){ // from node
		var changed
		if(image != data.image){
			data.image = image || defaultData.image
			changed = true
		}
		if(video != data.video){
			data.video = video || defaultData.video
			changed = true
		}
		if(fontColor != data.fontColor){
			data.fontColor = fontColor
			changed = true
		}
		if(color != data.color){
			data.color = color	
			changed = true
		}
		if(animate != data.animate){
			data.animate = animate || 'none'
			changed = true
		}
		if(changed){
			try {
				localStorage.setItem('background-data', JSON.stringify(data))
			} catch(e) {
				console.error(e)
				data.image = ''
				data.video = ''
				localStorage.setItem('background-data', JSON.stringify(data))
				data.image = image
				data.video = video
			}
		}					
	}
	if(!data.image){
		data.image = defaultData.image
	}
	if(!data.video){
		data.video = defaultData.video
	}
	const renderBackground = function () {
		if(data.video){
			bg.style.backgroundImage = 'none'		
			const v = bg.querySelector('video')
			if(!v || v.src != data.video){
				bg.innerHTML = '&nbsp;'
				setTimeout(function () {
					bg.innerHTML = '<video src="'+ data.video +'" onerror="setTimeout(() => {if(this.parentNode)this.load()}, 500)" loop muted autoplay style="background-color: black;object-fit: cover;" poster="assets/images/blank.png"></video>'
				}, 1000)
			}
		} else {
			const m = 'url("' + data.image +'")'
			if(bg.style.backgroundImage != m){
				bg.style.backgroundImage = m
			}
			bg.innerHTML = ''
		}
	}
	if(themeBackgroundReady){
		renderBackground()
	} else {
		if(typeof(themeBackgroundReady) == 'undefined'){
			themeBackgroundReady = false
			window.addEventListener('themebackgroundready', function () {
				themeBackgroundReady = true
				renderBackground()
			})
		}
	}
	if(splash){
		splash.style.backgroundColor = data.color
		splash.style.color = data.fontColor
	}
	console.log('DATA', data)
	animateBackground(data.video ? 'none' : data.animate)
}

function animateBackground(val){
	console.warn('animateBackground', val)
	let c = document.body.className || '', r = new RegExp('animate-background-[a-z]+', 'g')
	if(val.indexOf('-desktop') != -1){
		if(window.cordova){
			val = 'none'
		} else {
			val = val.replace('-desktop', '')
		}
	}
	if(val == 'fast'){
		let n = 'animate-background-fast'
		if(c.indexOf(n) == -1) {
			document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '') + ' ' + n
		}
	} else if(val == 'slow') {
		let n = 'animate-background-slow'
		if(c.indexOf(n) == -1) {
			document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '') + ' ' + n
		}
	} else {
		let n = 'animate-background'
		if(c.indexOf(n) != -1) {
			document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '')
		}
	}
}

function loadJS(url, cb, retries=3){
    var script = document.createElement("script")
	script.type = "text/javascript";
	if(typeof(cb) == 'function'){
		script.onload = function (){
			console.warn('LOADED', url);
			setTimeout(cb, 1)
		}
		script.onerror = function (){
			if(retries){
				retries--
				console.warn('RETRY', url);
				setTimeout(function (){
					loadJS(url, cb, retries)
				}, 1)

			} else {
				console.warn('ERROR', url);
				setTimeout(cb, 1)
			}
		}
	}
	script.src = url;
	document.querySelector("head").appendChild(script)
}

function loadResizeObserverPolyfill(cb){
	console.log('loadResizeObserverPolyfill', typeof(ResizeObserver))
	if(typeof(ResizeObserver) == 'undefined'){
		loadJS('./node_modules/resize-observer/dist/resize-observer.js', cb)
	} else {
		cb()
	}
}

function loadScripts(){
	updateSplashProgress()
	loadJS('./assets/js/index/bindings.js', function (){
		updateSplashProgress()
		loadResizeObserverPolyfill(function (){
			loadJS('./assets/js/index/video.js', function (){
				updateSplashProgress()
				loadJS('./assets/js/index/video.hls.js', function (){
					updateSplashProgress()
				})
			})
		})
	})
}

var tasksCount = 8, tasksCompleted = 0, fakeTasksCount = 0

if(window.cordova){
	fakeTasksCount = 15
	tasksCount += fakeTasksCount
}

function updateSplashProgress(increase = 1){
	let sd = document.querySelector('#splash-progress > div')
	if(sd){
		tasksCompleted += increase
		sd.style.width = (tasksCompleted / (tasksCount / 100)) +'%'
	}
}

function fakeUpdateProgress(){
	let timer = setInterval(function (){
		fakeTasksCount--
		if(!fakeTasksCount){
			clearInterval(timer)
		}
		updateSplashProgress()
	}, 1000)
}

theming()

if(window.cordova){
	updateSplashProgress()
	document.addEventListener('deviceready', function (){	
		updateSplashProgress()
		if(navigator.splashscreen){
			navigator.splashscreen.hide()
		}
		if(isES6()){
			loadScripts()			
			plugins.insomnia.keepAwake()
			document.addEventListener('pause', function (){
				cordova.plugins.backgroundMode.isScreenOff(function (ret){
					player && player.emit('app-pause', ret)
				})
				plugins.insomnia.allowSleepAgain()   
			})
			document.addEventListener('resume', function (){
				player && player.emit('app-resume')
				plugins.insomnia.keepAwake()
			})
		} else {
			log('No ES6 support')
			updateWebView()
		}
	}, false)
} else {
	updateSplashProgress(2)
	loadJS('/socket.io/socket.io.js', loadScripts)
}
