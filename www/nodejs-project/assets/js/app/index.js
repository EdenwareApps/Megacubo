var themeBackgroundReady, tasksCount = 8, tasksCompleted = 0, fakeTasksCount = 0, maxAlerts = 8;

function log(msg, id){
	if(id){
		var d = document.getElementById(id);
		if(d){
			d.parentNode.removeChild(d);
		}
	}
	if(typeof(msg) != 'string'){
		msg = String(msg);
	}
	document.getElementById('info').innerHTML += '<div ' + (id?('id="' + id + '"'):'') + '>' + msg + '</div>';
	console.log('[' + id + '] ' + msg);
}

function isES6(){
	try{
		new Function('class ES6Test { constructor() { const a = 1 } }; return new ES6Test()');
		return true;
	} catch(exception) {
		return false;
	}
}

function updateWebView(){
	var msg, playStoreUrl = 'market://details?id=com.google.android.webview';
	switch(navigator.language.substr(0, 2)){
		case 'pt':
			msg = 'Oops, voce precisa atualizar o WebView de seu sistema para rodar este aplicativo.';
			break;
		case 'es':
			msg = 'Vaya, debe actualizar el WebView de su sistema para ejecutar esta aplicacion.';
			break;
		case 'it':
			msg = 'Spiacenti, e necessario aggiornare WebView del sistema per eseguire questa applicazione.';
			break;
		default:
			msg = 'Oops, you need to update your system\'s WebView in order to run this application.';
			break;
	}
	log(msg);
	alert(msg);
	window.open(playStoreUrl, '_system');
	setTimeout(() => parent.close(), 5000);
}

function theming(image, video, color, fontColor, animate){
	console.warn('theming', image, video, color, fontColor, animate);
	var bg = document.getElementById('background'), splash = document.getElementById('splash'), data = localStorage.getItem('background-data');
	var defaultData = {
		image: screen.width > 1920 ? './assets/images/background-3840x2160.png' : './assets/images/background-1920x1080.png', 
		video: '', 
		color: '#15002C', 
		fontColor: '#FFFFFF', 
		animate: 'none'
	};
	if(data){
		data = JSON.parse(data);
		Object.keys(defaultData).forEach(function (k){
			if(typeof(data[k]) == 'undefined'){
				data[k] = defaultData[k];
			}
		});
	} else {
		data = defaultData; // defaults
		try {
			localStorage.setItem('background-data', JSON.stringify(data));
		} catch(e) {
			console.error(e);
			data.video = '';
			data.image = '';
			localStorage.setItem('background-data', JSON.stringify(data));
			data.image = image;
			data.video = video;
		}
	}
	if(typeof(image) == 'string' || typeof(video) == 'string'){ // from node
		var changed;
		if(image != data.image){
			data.image = image || defaultData.image;
			changed = true;
		}
		if(video != data.video){
			data.video = video || defaultData.video;
			changed = true;
		}
		if(fontColor != data.fontColor){
			data.fontColor = fontColor;
			changed = true;
		}
		if(color != data.color){
			data.color = color;	
			changed = true;
		}
		if(animate != data.animate){
			data.animate = animate || 'none';
			changed = true;
		}
		if(changed){
			try {
				localStorage.setItem('background-data', JSON.stringify(data));
			} catch(e) {
				console.error(e);
				data.image = '';
				data.video = '';
				localStorage.setItem('background-data', JSON.stringify(data));
				data.image = image;
				data.video = video;
			}
		}					
	}
	if(!data.image){
		data.image = defaultData.image;
	}
	if(!data.video){
		data.video = defaultData.video;
	}
	var renderBackground = function () {
		if(data.video){
			bg.style.backgroundImage = 'none';		
			var v = bg.querySelector('video');
			if(!v || v.src != data.video){
				bg.innerHTML = '&nbsp;';
				setTimeout(function () {
					bg.innerHTML = '<video crossorigin src="'+ data.video +'" onerror="setTimeout(() => {if(this.parentNode)this.load()}, 500)" loop muted autoplay style="background-color: black;object-fit: cover;" poster="assets/images/blank.png"></video>';
				}, 1000);
			}
		} else {
			var m = 'url("' + data.image +'")';
			if(bg.style.backgroundImage != m){
				bg.style.backgroundImage = m;
			}
			bg.innerHTML = '';
		}
	};
	if(themeBackgroundReady === true){
		renderBackground();
	} else {
		if(typeof(themeBackgroundReady) == 'undefined'){
			themeBackgroundReady = function () {
				themeBackgroundReady = true;
				renderBackground();
			};
		}
	}
	if(splash){
		splash.style.backgroundColor = data.color;
		splash.style.color = data.fontColor;
	}
	console.log('DATA', data);
	animateBackground(data.video ? 'none' : data.animate);
}

var currentAnimateBackground
function animateBackground(val){
	console.warn('animateBackground', val);
	var c = document.body.className || '';
	if(val.indexOf('-desktop') != -1){
		if(window.cordova){
			val = 'none';
		} else {
			val = val.replace('-desktop', '');
		}
	}
	if(val == currentAnimateBackground){ // avoid uneeded background reloadings
		return
	}
	currentAnimateBackground = val
	if(val == 'fast'){
		var n = 'animate-background-fast';
		if(c.indexOf(n) == -1) {
			document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '') + ' ' + n;
		}
	} else if(val == 'slow') {
		var n = 'animate-background-slow';
		if(c.indexOf(n) == -1) {
			document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '') + ' ' + n;
		}
	} else {
		var n = 'animate-background';
		if(c.indexOf(n) != -1) {
			document.body.className = c.replace(new RegExp('animate-background-[a-z]+', 'g'), '');
		}
	}
}

function loadJS(url, cb, retries) {
    var script = document.createElement('script');
	script.type = 'text/javascript';
	retries = retries || 3;
	if (typeof cb == 'function') {
		script.onload = function () {
			console.warn('LOADED', url);
			setTimeout(cb, 1);
		};
		script.onerror = function () {
			if (retries) {
				retries--;
				console.warn('RETRY', url);
				setTimeout(function () {
					loadJS(url, cb, retries);
				}, 1);
			} else {
				console.warn('ERROR', url);
				setTimeout(cb, 1);
			}
		};
	}
	script.src = url;
	document.querySelector('head').appendChild(script);
}

function exit() {
	console.log('index exit()');
	if (navigator.app) {
		navigator.app.exitApp();
	} else if (top == window) {
		window.close();
	}
}

function openExternalFile(file, mimetype) {
	console.log('openExternalFile', file);
	if (parent.cordova) {
		alert('Cannot open file: ' + file.split('/').pop())
	} else if (parent.getElectronRemote) {
		parent.getElectronRemote().shell.openExternal(file)
	} else {
		window.open(file, '_system')
	}
}

function openExternalURL(url) {
	if (parent.navigator.app) {
		if (url.match(new RegExp('https://megacubo.tv', 'i'))) {
			url = url.replace('https:', 'http:'); // bypass Ionic Deeplink
		}
		parent.navigator.app.loadUrl(url, { openExternal: true })
	} else if (parent.getElectronRemote) {
		parent.getElectronRemote().shell.openExternal(url)
	} else {
		window.open(url);
	}
}

function loaded() {
	var splash = document.getElementById('splash');
	if (splash) {
		var s = document.querySelector('iframe').style;
		s.display = 'none';
		s.visibility = 'visible';
		s.display = 'block';
		document.body.style.backgroundImage = 'none';
		document.getElementById('info').style.display = 'none';
		document.getElementById('background').style.visibility = 'visible';
		splash.parentNode.removeChild(splash);
	}
	if (typeof themeBackgroundReady == 'function') {
		themeBackgroundReady();
	}
}

function traceback() { 
	try { 
		var a = {};
		a.debug();
	} catch(ex) {
		return ex.stack.replace('TypeError: a.debug is not a function', '').trim();
	}
}

function handleOpenURL(url) { 
	setTimeout(function() {
		if (url && url.match('^[a-z]*:?//')) {
			onBackendReady(function() {
				channel.post('message', ['open-url', url.replace(new RegExp('.*megacubo\.tv/(w|assistir)/', ''), 'mega://')]);
			});
		}
	}, 0);
}

function loadResizeObserverPolyfill(cb) {
	console.log('loadResizeObserverPolyfill', typeof(ResizeObserver));
	if (typeof ResizeObserver == 'undefined') {
		loadJS('./node_modules/resize-observer/dist/resize-observer.js', cb);
	} else {
		cb();
	}
}

function loadScripts() {
	updateSplashProgress();
	loadJS('./modules/bridge/client.js', function () {
		updateSplashProgress();
		loadResizeObserverPolyfill(function () {
			loadJS('./assets/js/app/video.js', function () {
				loadJS('./node_modules/hls.js/dist/hls.js', function() { // hls.light.js will not play fmp4 or handle subtitles
					loadJS('./assets/js/app/video.hls.js', function () {
						updateSplashProgress();
						loadJS('./assets/js/app/video.ts.js', function () {
							loadJS('./assets/js/app/window.js', function () {
								updateSplashProgress();
							});
						});
					});
				});
			});
		});
	});
}

function updateSplashProgress(increase) {
	increase = increase || 1;
	let sd = document.querySelector('#splash-progress > div');
	if (sd) {
		tasksCompleted += increase;
		sd.style.width = (tasksCompleted / (tasksCount / 100)) + '%';
	}
}

function fakeUpdateProgress() {
	let timer = setInterval(function () {
		fakeTasksCount--;
		if (fakeTasksCount <= 0) {
			clearInterval(timer);
		}
		updateSplashProgress();
	}, 1000);
}

window.onerror = function (message, file, line, column, errorObj) {
	let stack = typeof errorObj == 'object' && errorObj !== null && errorObj.stack ? errorObj.stack : traceback();
	console.error(errorObj || message, { errorObj, message, file, stack });
	if (maxAlerts) {
		maxAlerts--;
		if (file && 
			!file.startsWith('blob:http://') && // ignore hls.js internal errors
			!file.endsWith('mpegts.js') // ignore mpegts.js internal errors
			) {
			alert(message + ' ' + file + ':' + line + ' ' + stack);
			log(message);
		}
	}
	return true;
}
	
document.addEventListener('pause', function () {
	if (window.channel) {
		channel.post('message', ['suspend']);
	}
});

document.addEventListener('resume', function () {
	if (window.channel) {
		channel.post('message', ['resume']);
	}
});

document.addEventListener('backbutton', function (e) {
	if (window.app) {
		e.preventDefault();
		app.postMessage({ action: 'backbutton' }, location.origin);
	}
}, false);

if (typeof Keyboard != 'undefined') {
	window.addEventListener('keyboardWillShow', function (event) {
		adjustLayoutForKeyboard(event.keyboardHeight);
	});
	window.addEventListener('keyboardWillHide', function () {
		adjustLayoutForKeyboard(false);
	});
	function adjustLayoutForKeyboard(keyboardHeight) {
		var m, mi;
		m = app.document.body.querySelector('div#modal > div > div');
		if (m) {
			mi = m.querySelector('.modal-wrap');
			if (keyboardHeight) {		
				var h;
				h = window.innerHeight - keyboardHeight;
				m.style.height = h + 'px';
				if (mi && mi.offsetHeight > h) {
					var mq = mi.querySelector('span.modal-template-question');
					if (mq) {
						mq.style.display = 'none';
					}
				}
			} else {
				m.style.height = '100vh';
				if (mi) {
					mi.querySelector('span.modal-template-question').style.display = 'flex';
				}
			}
		}
	}
}

if (window.cordova) {
	fakeTasksCount = 15;
	tasksCount += fakeTasksCount;
}

theming();

if (window.cordova) {
	updateSplashProgress();
	document.addEventListener('deviceready', function () {	
		updateSplashProgress();
		if (navigator.splashscreen) {
			navigator.splashscreen.hide();
		}
		if (isES6()) {
			loadScripts();
			plugins.insomnia.keepAwake();
			document.addEventListener('pause', function () {
				cordova.plugins.backgroundMode.isScreenOff(function (ret) {
					player && player.emit('app-pause', ret);
				});
				plugins.insomnia.allowSleepAgain();   
			});
			document.addEventListener('resume', function () {
				player && player.emit('app-resume');
				plugins.insomnia.keepAwake();
			});
		} else {
			log('No ES6 support');
			updateWebView();
		}
	}, false);
} else {
	updateSplashProgress(2);
	loadScripts();
}
