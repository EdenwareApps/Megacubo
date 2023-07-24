var lang, config, nodejs, channel, app = document.querySelector('iframe').contentWindow

window['frontendBackendReady'] = {frontend: false, backend: false, callbacks: [], backendCallbacks: []}

function onFrontendBackendReady(fn){
	if(frontendBackendReady.frontend && frontendBackendReady.backend){
		fn()
	} else {
		frontendBackendReady.callbacks.push(fn)
	}
}

function onBackendReady(fn){
	if(frontendBackendReady.backend){
		fn()
	} else {
		frontendBackendReady.backendCallbacks.push(fn)
	}
}

function frontendBackendReadyCallback(origin){
	if(typeof(frontendBackendReady) == 'undefined'){
		frontendBackendReady = {frontend: false, backend: !!lang}
	}
	frontendBackendReady[origin] = true
	if(origin == 'backend'){
		config = arguments[1]
		lang = arguments[2]
		frontendBackendReady.backendCallbacks.forEach(f => f())
		frontendBackendReady.backendCallbacks = []
	}
	if(!app) {
		app = document.querySelector('iframe').contentWindow
	}
	if(frontendBackendReady.frontend && frontendBackendReady.backend){
		app.lang = lang
		app.config = config
		frontendBackendReady.callbacks.forEach(f => f())
		frontendBackendReady.callbacks = []
	}
}

class BridgeClient extends EventEmitter {
	constructor() {
        super()
		this.localEmit = super.emit
		if (window.cordova) {
			this.configureCordovaChannel()
			this.startNodeMainScript()
		} else {
			this.configureElectronChannel()
			this.channelGetLangCallback()
			updateSplashProgress()
		}
	}
	startNodeMainScript() {
		window.parent.nodejs.start('main.js', err => {
			err && log(String(err))
			this.channelGetLangCallback()
			updateSplashProgress()
			console.log('Node main script loaded.')
		}, {
			redirectOutputToLogcat: false
		})
	}
	configureCordovaChannel() {
		fakeUpdateProgress()
		this.channel = window.parent.nodejs.channel
		this.channel.on('message', (...args) => {
			this.channelCallback.apply(this, args[0])
		})
	}
	configureElectronChannel() {
		const bridgeChannel = this
		class ElectronChannel extends EventEmitter {
			constructor() {
				super()
				const { getGlobal } = window.parent.getElectronRemote()
				this.getMain = () => (this.main = getGlobal('ui'))
				this.originalEmit = this.emit.bind(this)
				this.emit = (...args) => this.post('', Array.from(args))
				this.connect()
			}
			connect(){
				if(this.connected) return
				this.getMain()
				if(this.main){
					const { ipcMain } = window.parent.getElectronRemote()
					this.io = ipcMain
					this.io.on('message', (...args) => {
						bridgeChannel.channelCallback.apply(bridgeChannel, args[0])
					})
					this.connected = true
				} else {
					setTimeout(() => this.connect(), 1000)
				}
			}
			post(_, args) {
				this.connect()
				if (this.main) {
					this.main.localEmit(...args)
				} else {
					console.error('POST MISSED?', args)
				}
			}
		}
		this.channel = new ElectronChannel()
	}
	channelCallback(...args){
		setTimeout(() => { // async to prevent blocking main
			if(args[0] == 'backend-ready'){
				frontendBackendReadyCallback('backend', args[1], args[2])
			} else if(args[0] == 'get-lang'){
				this.channelGetLangCallback()
			} else {
				this.localEmit.apply(this, Array.from(arguments))
			}
		}, 0)
	}
	channelGetLangCallback(){
		var next = lng => {
			if(!lng){
				lng = window.navigator.userLanguage || window.navigator.language
			}
			// prevent "Intl is not defined"
			this.emit('get-lang-callback', 
				lng, 
				{
					name: (Intl || parent.Intl).DateTimeFormat().resolvedOptions().timeZone,
					minutes: (new Date()).getTimezoneOffset() * -1
				},
				window.navigator.userAgent, 
				window.navigator.onLine
			)
		}
		if(window.cordova){
			navigator.globalization.getPreferredLanguage(language => next(language.value), () => next())
		} else {
			next()
		}
	}
    emit(){
        this.channel.post('message', Array.from(arguments))
    }
}

var appChannel = new BridgeClient()
