
var lang, config

window['frontendBackendReady'] = {frontend: false, backend: false, callbacks: [], backendCallbacks: []}

function onFrontendBackendReady(fn){
	if(window['frontendBackendReady']['frontend'] && window['frontendBackendReady']['backend']){
		fn()
	} else {
		window['frontendBackendReady'].callbacks.push(fn)
	}
}

function onBackendReady(fn){
	if(window['frontendBackendReady']['backend']){
		fn()
	} else {
		window['frontendBackendReady'].backendCallbacks.push(fn)
	}
}

function frontendBackendReadyCallback(origin){
	if(typeof(window['frontendBackendReady']) == 'undefined'){
		window['frontendBackendReady'] = {frontend: false, backend: !!lang}
	}
	window['frontendBackendReady'][origin] = true
	if(origin == 'backend'){
		config = arguments[1]
		lang = arguments[2]
		window['frontendBackendReady'].backendCallbacks.forEach(f => f())
		window['frontendBackendReady'].backendCallbacks = []
	}
	if(window['frontendBackendReady']['frontend'] && window['frontendBackendReady']['backend']){
		app.lang = lang
		app.config = config
		app.addEventListener('appready', (() => {
			window['frontendBackendReady'].callbacks.forEach(f => f())
			window['frontendBackendReady'].callbacks = []
		}).bind(window))
		app.postMessage({action: 'ready'}, location.origin)
	}
}

function checkPermissions(_perms, callback) {
	if(!Array.isArray(_perms)){
		_perms = [_perms]
	}
	const perms = cordova.plugins.permissions
	_perms = _perms.map(p => {
		if(typeof(p) == 'string'){
			p = perms[p]
		}
		return p
	})
	perms.checkPermission(_perms, status => {
		console.log('checking permissions', _perms)
		console.log(status)
		if (status.hasPermission) {
			callback(true)
		} else {
			// Asking permission to the user
			perms.requestPermissions(_perms, status => {
				console.log(status)
				if (status.hasPermission) {
					callback(true)
				} else {
					callback(false)
				}
			}, () => {
				callback(false)
			})
		}
	}, null)
}

function exit(){
	console.log('index exit()')
	if (navigator.app) {
		navigator.app.exitApp()
	} else if(top == window) {
		window.close()
	}
}

function openExternalFile(file, mimetype){
	console.log('openExternalFile', file)
	if(parent.cordova){
		alert('cannot open file ' + file.split('/').pop())
	} else if(parent.parent.nw) {
		parent.parent.nw.Shell.openItem(file)
	} else {
		window.open(file, '_system')
	}
}

function openExternalURL(url){
	if(parent.navigator.app){
		if(url.match(new RegExp('https://megacubo.tv', 'i'))){
			url = url.replace('https:', 'http:') // bypass Ionic Deeplink
		}
		parent.navigator.app.loadUrl(url, {openExternal: true})
	} else if(parent.parent.nw) {
		parent.parent.nw.Shell.openExternal(url)
	} else {
		window.open(url)
	}
}

function loaded(){
	let splash = document.getElementById('splash')
	if(splash){
		var s = document.querySelector('iframe').style
    	s.display = 'none'
    	s.visibility = 'visible'
		s.display = 'block'
		document.body.style.backgroundImage = 'none'
		document.getElementById('info').style.display = 'none'
		document.getElementById('background').style.visibility = 'visible'
		splash.parentNode.removeChild(splash)
		app.postMessage({action: 'player-ready'}, location.origin)		
        window.dispatchEvent(new CustomEvent('themebackgroundready'))
	}
}

function traceback() { 
    try { 
        var a = {}
        a.debug()
    } catch(ex) {
        return ex.stack.replace('TypeError: a.debug is not a function', '').trim()
    }
}

var nodejs, channel, app = document.querySelector('iframe').contentWindow

window.addEventListener('message', function (e){
	if(e.data.action){
		switch(e.data.action){
			case 'frontend-ready':
				frontendBackendReadyCallback('frontend')
				break
			case 'loaded':
				break
			case 'channel':
				console.log('POST', e.data.args, e)
				channel.post('message', e.data.args)
				break
		}
	}
})
	
document.addEventListener('pause', function (){
	if(app){
		app.postMessage({action: 'suspend'}, location.origin)
		channel.post('message', ['suspend'])
	}
})

document.addEventListener('resume', function (){
	if(app){
		app.postMessage({action: 'resume'}, location.origin)
		channel.post('message', ['resume'])
	}
})

document.addEventListener('backbutton', function(e){
	if(app){
		e.preventDefault()
		app.postMessage({action: 'backbutton'}, location.origin)
	}
}, false)

window.addEventListener('beforeunload', () => {
	console.log('beforeunload at index')
	//channel.post('message', ['unbind'])
})

function channelGetLangCallback(){
	var next = lang => {
		if(!lang){
			lang = window.navigator.userLanguage || window.navigator.language
		}
		// prevent "Intl is not defined"
        channel.post('message', ['get-lang-callback', lang, (Intl || parent.parent.Intl).DateTimeFormat().resolvedOptions().timeZone, window.navigator.userAgent, window.navigator.onLine])
	}
	if(window.cordova){
		navigator.globalization.getPreferredLanguage(language => next(language.value), () => next())
	} else {
		next()
	}
}

function channelCallback(){
	// console.log('APPR', arguments)
	if(arguments[0] == 'backend-ready'){
		frontendBackendReadyCallback('backend', arguments[1], arguments[2])
	} else if(arguments[0] == 'get-lang'){
		channelGetLangCallback()
	} else {
		if(window.cordova){
			app.postMessage({action: 'channel', args: Array.from(arguments)}, location.origin)
		} else {
			channel.emit('message', Array.from(arguments))
		}
	}
}

if(window.cordova){
	fakeUpdateProgress()
	channel = nodejs.channel
	channel.on('message', (...args) => {
		channelCallback.apply(null, args[0])
	})
	nodejs.start('main.js', err => {
		updateSplashProgress()
		console.log('Node main script loaded.')
		if (err) {
			log(String(err))
		}
	})
} else {
	class Channel extends EventEmitter {
		constructor(){
			super()
			this.io = io.connect("/", {log: true}) // transports:['websocket', 'polling'],  nodejs doesn't support websockets without native libraries yet :(
			var onevent = this.io.onevent;
			this.io.onevent = function (packet) {
				var args = packet.data || []
				//onevent.call (this, packet);    // original call, SEEMS NOT NEEDED
				packet.data = ["*"].concat(args)
				onevent.call(this, packet)      // additional call to catch-all
			}
			this.sock = new Proxy(this.io, {
				get: (io, field) => {
					if(field in io){
						return io[field]
					}
					const id = parseInt(Math.random() * 1000000)
					return (...args) => {
						return new Promise((resolve, reject) => {
							io.once('callback-' + id, ret => {
								(ret.error ? reject : resolve)(ret.data)
							})
							console.log('call-' + field, {id, args})
						})
					}
				}
			})
			this.io.on('*', channelCallback)
		}
		post(type, args){
			// console.warn('POST', args)
			this.sock.emit.apply(this.sock, args)
		}		
	}
    channel = new Channel()
	updateSplashProgress()
}

channelGetLangCallback()
app.postMessage({action: 'app_js_ready'}, location.origin)

function handleOpenURL(url) { // cordova-plugin-customurlscheme helper method, will handle deeplinks too
	setTimeout(() => {
		if(url && url.match('^[a-z]*:?//')){
			onBackendReady(() => {
				channel.post('message', ['open-url', url.replace(new RegExp('.*megacubo\.tv/(w|assistir)/', ''), 'mega://')])
			})
		}
	}, 0)
}

if(typeof(Keyboard) != 'undefined'){
	function adjustLayoutForKeyboard(keyboardHeight){
		const m = app.document.body.querySelector('div#modal > div > div')
		if(m){
			const mi = m.querySelector('.modal-wrap')
			if(keyboardHeight){		
				const h = window.innerHeight - keyboardHeight
				m.style.height = h + 'px'
				if(mi && mi.offsetHeight > h){
					const mq = mi.querySelector('span.modal-template-question')
					if(mq){
						mq.style.display = 'none'
					}
				}
			} else {
				m.style.height = '100vh'
				if(mi){
					mi.querySelector('span.modal-template-question').style.display = 'flex'
				}
			}
		}
	}
	window.addEventListener('keyboardWillShow', event => {
		adjustLayoutForKeyboard(event.keyboardHeight)
	})
	window.addEventListener('keyboardWillHide', () => {
		adjustLayoutForKeyboard(false)
	})
}