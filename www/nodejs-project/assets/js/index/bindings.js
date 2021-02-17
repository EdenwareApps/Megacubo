
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

function openExternalURL(url){
	if(parent.navigator.app){
		if(url.match(new RegExp('https://megacubo.tv', 'i'))){
			ul = url.replace('https:', 'http:') // bypass Ionic Deeplink
		}
		parent.navigator.app.loadUrl(url, {openExternal: true})
	} else if(top.nw) {
		top.nw.Shell.openExternal(url)
	} else {
		window.open(url)
	}
}

function loaded(){
	if(document.getElementById('splash').style.display != 'none'){
		var s = document.querySelector('iframe').style
    	s.display = 'none'
    	s.visibility = 'visible'
		s.display = 'block'
		document.body.style.background = 'transparent'
		document.getElementById('info').style.display = 'none'
		document.getElementById('splash').style.display = 'none'
		document.getElementById('background').style.visibility = 'visible'
		app.postMessage({action: 'player-ready'}, location.origin)
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

function channelCallback(){
	// console.log('APPR', arguments)
	if(arguments[0] == 'backend-ready'){
		frontendBackendReadyCallback('backend', arguments[1], arguments[2])
	} else if(arguments[0] == 'get-lang'){
		channel.post('message', ['get-lang-callback', window.navigator.userLanguage || window.navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone, window.navigator.userAgent])
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
channel.post('message', ['get-lang-callback', window.navigator.userLanguage || window.navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone, window.navigator.userAgent])

app.postMessage({action: 'app_js_ready'}, location.origin)

if(typeof(IonicDeeplink) != 'undefined'){
	IonicDeeplink.route(
		{'/assistir/:chId': {target: 'ch', parent: 'chs'}},
		match => {
			// alert('IonicDeeplink match: ' + JSON.stringify(match))
			let p = match['$args']['chId']
			onBackendReady(() => {
				// alert('IonicDeeplink match: ' + p)
				channel.post('message', ['open-name', p])
			})
		}, 
		nomatch => {
			let p = match['$args']['url'].trim()
			if(p.match('^[a-z]*:?//')){
				onBackendReady(() => {
					channel.post('message', ['open-url', p])
				})
			} else {
				alert('IonicDeeplink nomatch: ' + JSON.stringify(nomatch, null, 3))
			}
		}
	)
}

if(typeof(Keyboard) != 'undefined'){
	function adjustLayoutForKeyboard(keyboardHeight){
		const m = app.document.body.querySelector('div#modal > div > div')
		if(m){
			const mi = m.querySelector('.modal-wrap')
			if(keyboardHeight){		
				const h = window.innerHeight - keyboardHeight
				m.style.height = h + 'px'
				if(mi.offsetHeight > h){
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