import { MediaPlayerAdapterHTML5Audio, MediaPlayerAdapterHTML5Video, MediaPlayerAdapterAndroidNative } from './mediaplayer-adapter'
import MediaPlayerAdapterHTML5TS from './mediaplayer-adapter-ts'
import MediaPlayerAdapterHTML5HLS from './mediaplayer-adapter-hls'
import MediaPlayerAdapterHTML5DASH from './mediaplayer-adapter-dash'
import { ESMitter as EventEmitter } from 'esm-itter'
import { main } from '../../../modules/bridge/renderer'

class MediaPlayer extends EventEmitter {
	constructor(container){
		super()
		this.container = container
		this.innerContainer = this.container.querySelector('div')
		if(!this.innerContainer){
			this.innerContainer = document.createElement('div')
			this.container.appendChild(this.innerContainer)
		}
		this.adapter = ''
		this.current = null
		this.state = ''
		this.config = main.config
		this.hasErr = null
		this.clearErrTimer = null
		this.uiVisibility = true
		this.currentAudioTracks = null
		this.currentSubtitleTracks = null
		main.on('config', () => {
			this.config = main.config
			if(this.current){
				this.current.config = this.config
			}
		})
	}
	uiVisible(visible){
		if(this.current){
			this.uiVisibility = visible
			return this.current.uiVisible(visible)
		}
	}
	time(s){
		if(this.current){
			if(typeof(s) == 'number'){
				return this.current.time(s)
			}
			return this.current.time()
		}
		return 0
	}
	duration(){
		if(this.current){
			try {
				let r = this.current.duration
				if(isNaN(r)){
					return 0
				}
				if(r === Infinity){
					if(this.current.object && this.current.object.buffered && this.current.object.buffered.length){
						try {
							for(let i=0; i < this.current.object.buffered.length; i++){
								r = this.current.object.buffered.end(i)
							}
						} catch (e) {
							console.warn('Error reading buffered ranges:', e)
							r = (typeof this.current.time === 'function' ? this.current.time() : 0) + 2
						}
					} else {
						r = (typeof this.current.time === 'function' ? this.current.time() : 0) + 2
					}
				}
				return r
			} catch (e) {
				console.error('Error getting duration:', e)
				return 0
			}
		}
		return 0
	}
	ratio(s){
		if(this.current){
			if(typeof(s) == 'number'){
				return this.current.ratio(s)
			}
			return this.current.ratio()
		}
		return 0
	}
	playbackRate(rate){
		if(this.current){
			if(typeof(rate) == 'number'){
				return this.current.playbackRate(rate)
			}
			return this.current.playbackRate()
		}
		return 1
	}
	videoRatio(){
		if(this.current){
			return this.current.videoRatio()
		}
		return 0
	}
	show(){
		if(this.revealTimer){
			clearTimeout(this.revealTimer)
		}
		try {
			main.localEmit('player-show')
		} catch (e) {
			console.warn('Error emitting player-show:', e)
		}
		this.revealTimer = setTimeout(() => {
			try {
				if (document && document.documentElement && typeof document.documentElement.classList !== 'undefined') {
					document.documentElement.classList.add('playing')
				}
				if (document && document.body && typeof document.body.classList !== 'undefined') {
					const c = document.body.className || ''
					// console.warn('VIDEOCLASS* '+ c)
					if(!c.includes('video-')) { // no state set yet, add 'video-loading' so
						document.body.classList.add('video')
						document.body.classList.add('video-loading')
					} else {
						document.body.classList.add('video')
					}
				}
				if(!(this.current instanceof MediaPlayerAdapterAndroidNative)) {
					if (this.container) {
						this.container.style.display = 'flex'
						const mediaElements = this.container.querySelectorAll('video, audio')
						mediaElements.forEach(e => {
							try {
								e.style.display = (this.current && e == this.current.object) ? 'block' : 'none'
							} catch (e) {
								console.warn('Error setting element display:', e)
							}
						})
					}
				}
			} catch (e) {
				console.error('Error in show() timeout:', e)
			}
		}, 400)
	}
	hide(){
		if(this.revealTimer){
			clearTimeout(this.revealTimer)
			this.revealTimer = null
		}
		try {
			if (document && document.documentElement && typeof document.documentElement.classList !== 'undefined') {
				document.documentElement.classList.remove('playing')
			}
			if (document && document.body && typeof document.body.classList !== 'undefined') {
				['video', 'video-loading', 'video-playing', 'video-paused'].forEach(c => {
					try {
						if (document.body && typeof document.body.classList !== 'undefined') {
							document.body.classList.remove(c)
						}
					} catch (e) {
						console.warn('Error removing class', c, ':', e)
					}
				})
			}
			main.localEmit('player-hide')
		} catch (e) {
			console.error('Error in hide():', e)
		}
		if (this.container) {
			try {
				this.container.style.display = 'none'
			} catch (e) {
				console.warn('Error hiding container:', e)
			}
		}
	}
	resume(){
		if(this.current){
			if(this.state == 'ended'){
				this.current.restart()
			} else {
				this.current.resume()
			}
		}
	}
	pause(){
		if(this.current){
			this.current.pause()
		}
	}
	volume(l){
		if(this.current){
			this.current.volume(l)
		}
	}
	muted(){
		if(this.current && this.current.object){
			try {
				return this.current.object.muted || false
			} catch (e) {
				console.warn('Error getting muted state:', e)
				return false
			}
		}
		return false
	}
	setState(s, err){
		if(this.state != s){
			this.state = s
			if(!this.suspendStateChangeReporting) this.emit('state', s, err)
		}
	}
	load(src, mimetype, additionalSubtitles, cookie, mediatype, data){
		if (!src) {
			console.error('Bad source in load()', src, mimetype)
			this.emit('error', 'Invalid source', true)
			return null
		}
		
		this.setState('loading')
		this.mediatype = mediatype
		this.suspendStateChangeReporting = true
		
		// Unload current adapter if exists
		if(this.current){
			try {
				this.current.unload(true)
			} catch (e) {
				console.error('Error unloading current adapter:', e)
			}
		}
		
		try {
			if(window.plugins && window.plugins.megacubo){
				this.setup('native', MediaPlayerAdapterAndroidNative)
			} else {
				// Validate mimetype before using
				const m = (mimetype && typeof mimetype === 'string') ? mimetype.toLowerCase() : ''
				const srcStr = (src && typeof src === 'string') ? src : ''
				
				if(m.includes('mpegurl')){
					this.setup('html5h', MediaPlayerAdapterHTML5HLS)
				} else if(m.includes('mp2t') || (srcStr.endsWith('.ts') && mediatype == 'video') || (data && data.mpegts === true)){
					this.setup('html5t', MediaPlayerAdapterHTML5TS)
				} else if(m.includes('dash') || srcStr.endsWith('.mpd')) {
					this.setup('html5d', MediaPlayerAdapterHTML5DASH)
				} else if(m.includes('audio/')){
					this.setup('html5a', MediaPlayerAdapterHTML5Audio)
				} else {
					this.setup('html5v', MediaPlayerAdapterHTML5Video)
				}
			}
		} catch (setupError) {
			console.error('Error setting up adapter:', setupError)
			this.emit('error', 'Failed to setup media adapter', true)
			this.setState('')
			this.suspendStateChangeReporting = false
			return null
		}
		
		const current = this.current
		if (!current) {
			console.error('Failed to create adapter')
			this.emit('error', 'Failed to create media adapter', true)
			this.setState('')
			this.suspendStateChangeReporting = false
			return null
		}
		
		this.suspendStateChangeReporting = false
		
		// Initialize errorsCount if it exists
		if (typeof current.errorsCount !== 'undefined') {
			current.errorsCount = 0
		}
		
		try {
			const loadResult = current.load(src, mimetype, additionalSubtitles, cookie, mediatype)
			if (loadResult && typeof loadResult.then === 'function') {
				loadResult.then(() => {
					this.current = current
					try { this.show() } catch (e) { console.error('Error in show():', e) }
				}).catch(err => {
					console.error('Media player error (async load):', err && err.message || err)
					this.emit('error', 'Failed to load media', true)
					this.setState('')
				})
				return current
			}
		} catch(err) {
			console.error('Media player error:', err.message || err)
			this.emit('error', 'Failed to load media', true)
			this.setState('')
			return null
		}
		
		this.current = current
		
		try {
			this.show()
		} catch (e) {
			console.error('Error in show():', e)
		}
		
		try {
			if(main.config && typeof current.volume === 'function'){
				current.volume(main.config['volume'])
			}
		} catch (e) {
			console.warn('Error setting volume:', e)
		}
		
		try {
			if (document && document.body && typeof document.body.style !== 'undefined') {
				document.body.style.backgroundColor = 'transparent'
			}
		} catch (e) {
			console.warn('Error setting background color:', e)
		}
		
		return current
	}
	setup(adapterName, adapter){
		if (!adapter || typeof adapter !== 'function') {
			console.error('Invalid adapter provided:', adapterName)
			return null
		}
		
		this.adapter = adapterName
		this.currentAudioTracks = []
		this.currentSubtitleTracks = []
		
		// Destroy current adapter if exists
		if (this.current) {
			try {
				if (typeof this.current.destroy === 'function') {
					this.current.destroy()
				}
			} catch (e) {
				console.error('Error destroying current adapter:', e)
			}
			this.current = null
		}

		let a
		try {
			if (!this.innerContainer) {
				throw new Error('innerContainer is not available')
			}
			a = new adapter(this.innerContainer)
			if (!a) {
				throw new Error('Adapter constructor returned null/undefined')
			}
		} catch (createError) {
			console.error('Error creating adapter:', createError)
			this.emit('error', 'Failed to create media adapter', true)
			return null
		}
		
		// Setup event listeners with error handling
		try {
			a.on('state', s => {
				if(typeof(s) == 'undefined') return
				if(!s && this.hasErr){
					s = 'error'
				}
				if(!this.suspendStateChangeReporting) this.setState(s, this.hasErr)
			})
			
			a.on('setup-ratio', r => {
				if(!this.current) return
				try {
					this.emit('setup-ratio', r)
				} catch (e) {
					console.error('Error emitting setup-ratio:', e)
				}
			})
			
			a.on('timeupdate', n => {
				if(!this.current) return
				try {
					this.emit('timeupdate', n)
				} catch (e) {
					console.error('Error emitting timeupdate:', e)
				}
			})
			
			a.on('durationchange', () => {
				if(!this.current) return
				try {
					this.emit('durationchange', this.uiVisibility)
				} catch (e) {
					console.error('Error emitting durationchange:', e)
				}
			})
			
			a.on('audioTracks', tracks => {
				if(!this.current) return
				try {
					if(!this.equals(tracks, this.currentAudioTracks)){
						this.currentAudioTracks = tracks
						this.emit('audioTracks', tracks)
					}
				} catch (e) {
					console.error('Error handling audioTracks:', e)
				}
			})
			
			a.on('subtitleTracks', tracks => {
				if(!this.current) return
				try {
					if(!this.equals(tracks, this.currentSubtitleTracks)){
						this.currentSubtitleTracks = tracks
						this.emit('subtitleTracks', tracks)
					}
				} catch (e) {
					console.error('Error handling subtitleTracks:', e)
				}
			})
			
			a.on('error', (err, fatal) => {
				if(!this.current){
					try {
						// a.disconnect() may not be a function in all adapters
						if (typeof a.disconnect === 'function') {
							a.disconnect()
						}
						if (typeof a.unload === 'function') {
							a.unload()
						}
					} catch(e) {
						console.warn('Error cleaning up adapter after error:', e)
					}
					return
				}
				try {
					if(this.clearErrTimer){
						clearTimeout(this.clearErrTimer)
					}
					if(fatal === true){
						this.state = 'error'
						if(!this.suspendStateChangeReporting) this.emit('state', this.state, err)
						if (typeof a.unload === 'function') {
							a.unload()
						}
					} else {
						this.hasErr = String(err)
						this.clearErrTimer = setTimeout(() => {
							this.hasErr = null
						}, 5000)
					}
				} catch (e) {
					console.error('Error handling adapter error:', e)
				}
			})
			
			a.on('ended', (err, fatal) => {
				if(!this.current) return
				try {
					this.suspendStateChangeReporting = true
					this.pause()
					setTimeout(() => {
						this.suspendStateChangeReporting = false
						this.setState('ended')
					}, 0)
				} catch (e) {
					console.error('Error handling ended event:', e)
					this.suspendStateChangeReporting = false
				}
			})
			
			// Set config if available
			if (main && main.config) {
				a.config = main.config
			}
		} catch (listenerError) {
			console.error('Error setting up adapter listeners:', listenerError)
			// Try to clean up
			try {
				if (typeof a.destroy === 'function') {
					a.destroy()
				}
			} catch (cleanupError) {
				console.error('Error cleaning up adapter after listener error:', cleanupError)
			}
			return null
		}
		
		this.current = a
		return this.current
	}
    equals(a, b){
		return a && b && a.length == b.length ? a.every((r, i) => {
			return a[i] === b[i]
		}) : false
    }
	audioTracks(){
		if(this.current){
			return this.current.audioTracks()
		}
		return []
	}
	audioTrack(trackId){
		if(this.current){
			this.current.audioTrack(trackId)
		}
	}
	subtitleTracks(){
		if(this.current){
			return this.current.subtitleTracks()
		}
		return []
	}
	subtitleTrack(trackId){
		if(this.current){
			this.current.subtitleTrack(trackId)
		}
	}
	unload(silent){
		silent || console.log('unload')
		if(this.current){
			try {
				if (typeof this.current.unload === 'function') {
					this.current.unload(true)
				}
			} catch (e) {
				console.error('Error unloading current adapter:', e)
			}
			if(!silent) {
				try {
					this.hide()
				} catch (e) {
					console.error('Error in hide() during unload:', e)
				}
				this.current = null
				this.setState('')
			}
		}
	}
}

export default MediaPlayer
