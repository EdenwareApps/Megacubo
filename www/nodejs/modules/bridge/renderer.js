import EventEmitter from 'events'
import { Idle } from '../../renderer/src/scripts/idle'
import { css } from '../../renderer/src/scripts/utils'

class BridgeClient extends EventEmitter {
	constructor() {
        super()
		this.css = css
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
			this.localEmit('lang', lang)
			this.localEmit('config', Object.keys(config), config)
		})
		if (window.capacitor) {
			this.configureAndroidChannel()
		} else {
			this.configureElectronChannel()
		}
		this.channelGetLangCallback()
		this.idle = new Idle(this)
	}
	configureAndroidChannel() {
		const bridge = this
		class CapacitorChannel extends EventEmitter {
			constructor() {
				super()
				this.originalEmit = this.emit.bind(this)
				this.emit = (...args) => {
					window.capacitor.NodeJS.whenReady().then(() => {
						window.capacitor.NodeJS.send({
							eventName: 'message',
							args
						});
					}).catch(err => console.error(err))
				}
			}
			connect(){
				if(this.connected) return
				window.capacitor.NodeJS.addListener('message', ({args}) => {
					bridge.localEmit(...args)
				})
				this.connected = true
			}
			post(_, args) {
				this.connect()
				this.emit(...args)
			}
		}
		this.channel = new CapacitorChannel()
		window.plugins.megacubo.on('suspend', isScreenOn => {
			window.player && player.emit('app-pause', !isScreenOn)
			main.emit('suspend')
			capacitor.KeepAwake.allowSleep()
		})
		capacitor.App.addListener('appStateChange', ({isActive}) => {
			if(isActive) {
				window.player && player.emit('app-resume')
				main.emit('resume')
				capacitor.KeepAwake.keepAwake()
			}
		})
		capacitor.KeepAwake.keepAwake()
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
		const lng = window.navigator.userLanguage || window.navigator.language
		// prevent "Intl is not defined"
		this.emit('get-lang-callback', 
			lng, 
			{
				name: window.Intl.DateTimeFormat().resolvedOptions().timeZone,
				minutes: (new Date()).getTimezoneOffset() * -1
			},
			window.navigator.userAgent
		)
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