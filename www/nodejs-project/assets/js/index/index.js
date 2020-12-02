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

function isES6(){
    try{
		Function('() => {};');
		return true
    } catch(exception) {
        return false
    }
}

function updateWebView(){
	var msg
	switch(navigator.language.substr(0, 2)){
		case 'pt':
			msg = "Oops, você precisa atualizar o WebView de seu sistema para rodar este aplicativo.\r\nDeseja faze-lo agora?"
			break
		case 'es':
			msg = "Vaya, debe actualizar el WebView de su sistema para ejecutar esta aplicación. ¿Quieres hacerlo ahora?"
			break
		case 'it':
			msg = "Spiacenti, è necessario aggiornare WebView del sistema per eseguire questa applicazione. Vuoi farlo adesso?"
			break
		default:
			msg = "Oops, you need to update your system's WebView in order to run this application. Do you want to do it now?"
			break
	}
	if(typeof(plugins) == 'undefined'){
		alert(msg.split("\n")[0].trim())
	} else {
		if(confirm(msg)){
			plugins.webViewChecker.openGooglePlayPage().then(function() {
				log('Google Play page has been opened.')
			}).catch(function(error) {
				log(String(error))
			})
		}
	}
	setTimeout(function (){
		top.close()
	}, 15000)
}

function theming(image, color, fontColor, animate){
	console.warn('theming', image, color, fontColor, animate)
	var bg = document.getElementById('background'), splash = document.getElementById('splash'), data = localStorage.getItem('background-data')
	var defImage = screen.width > 1920 ? './assets/images/background-3840x2160.png' : './assets/images/background-1920x1080.png'
	if(data){
		data = JSON.parse(data)
	} else {
		data = {image: defImage, color: '#15002C', fontColor: '#FFFFFF', animate: 'none'} // defaults
		try {
			localStorage.setItem('background-data', JSON.stringify(data))
		} catch(e) {
			console.error(e)
			data.image = ''
			localStorage.setItem('background-data', JSON.stringify(data))
			data.image = image
		}
	}
	if(typeof(image) == 'string'){ // from node
		var changed
		if(image != data.image){
			data.image = image || defImage
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
			data.animate = animate
			changed = true
		}
		if(changed){
			try {
				localStorage.setItem('background-data', JSON.stringify(data))
			} catch(e) {
				console.error(e)
				data.image = ''
				localStorage.setItem('background-data', JSON.stringify(data))
				data.image = image
			}
		}					
	}
	if(!data.image){
		data.image = defImage
	}
	document.body.style.backgroundColor = data.color
	bg.style.backgroundImage = 'url(' + data.image + ')'
	splash.style.backgroundColor = data.color
	splash.style.color = data.fontColor
	animateBackground(data.animate)
}

function animateBackground(val){
	console.warn('animateBackground', val)
	let c = document.body.className || '', r = new RegExp('animate-background-[a-z]+', 'g')
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

function loadJS(url, cb){
    var script = document.createElement("script")
	script.type = "text/javascript";
	if(typeof(cb) == 'function'){
		script.onload = function (){
			//console.warn('LOADED', url);
			setTimeout(cb, 1)
		}
		script.onerror = function (){
			//console.warn('ERROR', url);
			setTimeout(cb, 1)
		}
	}
	script.src = url;
	document.querySelector("head").appendChild(script)
}

function loadScripts(){
	log('.', 'state')
	loadJS('./assets/js/index/bindings.js')
	loadJS('./assets/js/index/video.js', () => {
		loadJS('./assets/js/index/video.hls.js')
	})
}

window.onerror = log
theming()

if(window.cordova){
	console.log('ISCORDOVA')
	document.addEventListener('deviceready', function (){
		if(!isES6()){
			log('No ES6 support')
			updateWebView()
		} else {
			if(typeof(nodejs) == 'undefined'){
				console.warn('Node.JS failure?')
				console.log('Node.JS failure')
			}
			loadScripts()			
			plugins.insomnia.keepAwake()
			document.addEventListener('pause', function (){
				plugins.insomnia.allowSleepAgain()   
			})
			document.addEventListener('resume', function (){
				plugins.insomnia.keepAwake()
			})
		}
	}, false)
} else {
	console.log('NOTCORDOVA')
	loadJS('/socket.io/socket.io.js', loadScripts)
}