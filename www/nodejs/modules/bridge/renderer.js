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
		} else if (window.parent && window.parent.electron) {
			this.configureElectronChannel()
		} else {
			// Web mode - use WebSocket
			this.configureWebChannel()
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
	configureWebChannel() {
		const bridge = this
		class WebSocketChannel extends EventEmitter {
			constructor() {
				super()
				this.originalEmit = this.emit.bind(this)
				this.messageQueue = []
				this.reconnectAttempts = 0
				this.maxReconnectAttempts = 10
				this.reconnectDelay = 1000
				this.connect()
			}
			connect() {
				if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) return

				// Determine WebSocket URL from current location
				const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
				const host = window.location.host
				const wsUrl = `${protocol}//${host}/ws`

				console.log('[WebChannel] Connecting to:', wsUrl)

				try {
					this.ws = new WebSocket(wsUrl)

					this.ws.onopen = () => {
						console.log('[WebChannel] Connected')
						this.connected = true
						this.reconnectAttempts = 0

						// Send any queued messages
						while (this.messageQueue.length > 0) {
							const msg = this.messageQueue.shift()
							this.ws.send(msg)
						}
					}

					this.ws.onmessage = (event) => {
						try {
							const data = JSON.parse(event.data)
							if (data.type === 'message' && Array.isArray(data.args)) {
								bridge.localEmit(...data.args)
							}
						} catch (e) {
							console.error('[WebChannel] Parse error:', e)
						}
					}

					this.ws.onclose = () => {
						console.log('[WebChannel] Disconnected')
						this.connected = false
						this.attemptReconnect()
					}

					this.ws.onerror = (err) => {
						console.error('[WebChannel] Error:', err)
					}
				} catch (e) {
					console.error('[WebChannel] Connection error:', e)
					this.attemptReconnect()
				}
			}
			attemptReconnect() {
				if (this.reconnectAttempts < this.maxReconnectAttempts) {
					this.reconnectAttempts++
					const delay = this.reconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1)
					console.log(`[WebChannel] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
					setTimeout(() => this.connect(), delay)
				} else {
					console.error('[WebChannel] Max reconnection attempts reached')
				}
			}
			emit(...args) {
				const message = JSON.stringify({ type: 'message', args })
				if (this.ws && this.ws.readyState === WebSocket.OPEN) {
					this.ws.send(message)
				} else {
					// Queue message for when connection is established
					this.messageQueue.push(message)
					this.connect()
				}
			}
			post(_, args) {
				this.emit(...args)
			}
		}
		this.channel = new WebSocketChannel()
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