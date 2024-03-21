import EventEmitter from 'events'
import { Idle } from '../../renderer/src/scripts/idle'

class BridgeClient extends EventEmitter {
	constructor() {
        super()
		this.config = {}
		this.lang = {}
		this.isReady = {renderer: false, main: false}
		this.localEmit = (...args) => {
			try {
				super.emit(...args)
			} catch(e) {
				console.error(e, args)
			}
		}
		this.on('get-lang', () => this.channelGetLangCallback())
		this.on('lang', lang => {
			this.lang = lang
		})
		this.on('config', (_, c) => {
			this.config = c
		})
		this.once('renderer', () => {
			this.isReady.renderer = true
		})
		this.once('main-ready', (config, lang) => {
			this.isReady.main = true
			this.config = config
			this.lang = lang
			this.localEmit('config', Object.keys(config), config)
		})
		if (window.cordova) {
			this.configureCordovaChannel()
		} else {
			this.configureElectronChannel()
			this.channelGetLangCallback()
		}
		this.idle = new Idle(this)
	}
	startNodeMainScript() {
	}
	configureCordovaChannel() {
		document.addEventListener('deviceready', () => {
			this.channel = window.nodejs.channel
			this.channel.on('message', args => this.localEmit(...args))
			navigator.splashscreen && navigator.splashscreen.hide()
			plugins.insomnia.keepAwake()
			document.addEventListener('pause', () => {
				cordova.plugins.backgroundMode.isScreenOff(function (ret) {
					player && player.emit('app-pause', ret)
				})
				plugins.insomnia.allowSleepAgain()   
			}, {passive: true})
			document.addEventListener('resume', () => {
				player && player.emit('app-resume')
				plugins.insomnia.keepAwake()
			}, {passive: true})
			window.nodejs.start('main.js', err => {
				err && console.error(err)
				this.channelGetLangCallback()
				console.log('Node main script loaded.')
			}, {
				redirectOutputToLogcat: true
			})
		}, {once: true, passive: true})
	}
	configureElectronChannel() {
		const bridge = this
		class ElectronChannel extends EventEmitter {
			constructor() {
				super()
				this.originalEmit = this.emit.bind(this)
				this.emit = (...args) => parent.api.window.emit(...args)
				this.connect()
			}
			connect(){
				if(this.connected) return
				parent.api.window.on('message', args => bridge.localEmit(...args))
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
					name: (Intl || Intl).DateTimeFormat().resolvedOptions().timeZone,
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
    emit(...args) {
        this.channel.post('message', Array.from(args))
    }
	waitMain(f) {
		if(this.isReady.main === true) return f()
		this.once('main-ready', f)
	}
	waitRenderer(f) {
		if(this.isReady.renderer === true) return f()
		this.once('renderer', f)
	}
}

export const main = new BridgeClient()