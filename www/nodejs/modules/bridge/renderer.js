import { ESMitter as EventEmitter } from 'esm-itter'
import { Idle } from '../../renderer/src/scripts/idle'
import { css } from '../../renderer/src/scripts/utils'

class BridgeClient extends EventEmitter {
	constructor() {
        super()
		this.css = css
		this.config = {}
		this.lang = {
			locale: 'en',
			countryCode: 'US'
		}
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
				this.emit = (...args) => parent.electron.window.emit(...args)
				this.connect()
			}
			connect(){
				if(this.connected) return
				parent.electron.window.on('message', args => bridge.localEmit(...args))
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
		const nav = window.navigator || {}
		const hints = []
		const push = lng => {
			if (typeof lng != 'string') return
			lng = lng.trim()
			if (lng && !hints.includes(lng)) hints.push(lng)
		}
		// ordered by user preference: the system/OS list first, then the effective UI language
		if (Array.isArray(nav.languages)) nav.languages.forEach(push)
		push(nav.language)
		push(nav.userLanguage || nav.browserLanguage)
		const timezone = { name: 'UTC', minutes: (new Date()).getTimezoneOffset() * -1 }
		try {
			timezone.name = window.Intl.DateTimeFormat().resolvedOptions().timeZone || timezone.name
			// resolvedOptions() reports the Intl default locale, which can differ from navigator.language
			push(window.Intl.DateTimeFormat().resolvedOptions().locale)
		} catch (e) {}
		this.emit('get-lang-callback', 
			hints.join(', '), 
			timezone,
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