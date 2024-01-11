var lang, config, nodejs, channel, app = document.querySelector('iframe').contentWindow

class BridgeClient extends EventEmitter {
	constructor() {
        super()
		this.isReady = {frontend: false, backend: false}
		this.localEmit = super.emit
		this.on('get-lang', () => this.channelGetLangCallback())
		this.once('frontend', () => {
			this.isReady.frontend = true
		})
		this.once('backend', (...args) => {
			this.isReady.backend = true
			config = args[0]
			lang = args[1]
		})
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
			redirectOutputToLogcat: true
		})
	}
	configureCordovaChannel() {
		fakeUpdateProgress()
		this.channel = window.parent.nodejs.channel
		this.channel.on('message', args => this.localEmit(...args))
	}
	configureElectronChannel() {
		const bridge = this
		class ElectronChannel extends EventEmitter {
			constructor() {
				super()
				this.originalEmit = this.emit.bind(this)
				this.emit = (...args) => parent.Manager.win.emit(...args)
				this.connect()
			}
			connect(){
				if(this.connected) return
				parent.Manager.win.on('message', args => bridge.localEmit(...args))
				this.connected = true
			}
			post(_, args) {
				this.connect()
				this.emit(...args)
			}
		}
		this.channel = new ElectronChannel()
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
    emit(...args){
        this.channel.post('message', Array.from(args))
    }
	waitBackend(f) {
		if(this.isReady.backend) return f()
		this.once('backend', f)
	}
}

var appChannel = new BridgeClient()
