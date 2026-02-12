import { ESMitter as EventEmitter } from 'esm-itter'

export class MediaPlayerAdapter extends EventEmitter {
	constructor(container){
		super()
		this.container = container
		this.active = false
	}
	setState(s, err){
		if(this.state != s){
			this.state = s
			if(!this.suspendStateChangeReporting) this.emit('state', s, err)
		}
	}
	setVars(src, mimetype, additionalSubtitles, cookie, mediatype) {
		this.currentSrc = src
		this.currentMimetype = mimetype
		this.currentAdditionalSubtitles = additionalSubtitles
		this.cookie = cookie
		this.mediatype = mediatype
	}
	reload(cb) {
		const alive = this.active && this.object
		let t = 0
		try {
			// time() may not exist in all subclasses, handle gracefully
			if (typeof this.time === 'function') {
				t = this.time()
			}
		} catch (e) {
			console.warn('Error getting time in reload:', e)
		}
		
		const {currentSrc, currentMimetype, currentAdditionalSubtitles, cookie, mediatype} = this
		this.suspendStateChangeReporting = true
		
		try {
			this.unload()
		} catch (unloadError) {
			console.error('Error during unload in reload:', unloadError)
		}
		
		if(alive){
			setTimeout(() => {
				try {
					this.suspendStateChangeReporting = false
					this.setState('loading')
					const loadResult = this.load(currentSrc, currentMimetype, currentAdditionalSubtitles, cookie, mediatype)
					const done = () => {
						if(t && this.mediatype == 'live' && typeof this.time === 'function') {
							this.time(t + 0.5) // nudge a bit to skip any decoding error on part of the file
						}
						cb && cb()
					}
					if (loadResult && typeof loadResult.then === 'function') {
						loadResult.then(done).catch(loadError => {
							console.error('Error during load in reload:', loadError)
							this.emit('error', 'Failed to reload', true)
							this.setState('')
							if (cb) cb()
						})
					} else {
						done()
					}
				} catch (loadError) {
					console.error('Error during load in reload:', loadError)
					this.emit('error', 'Failed to reload', true)
					this.setState('')
					if (cb) cb()
				}
			}, 10)
		} else {
			this.emit('error', 'Playback failure', true)
			this.setState('')
			if (cb) cb()
		}
	}
	destroy(){
		this.active = false
		this.object = null
		this.unload()
		this.removeAllListeners()
	}
}

class MediaPlayerAdapterHTML5 extends MediaPlayerAdapter {
	constructor(container){
		super(container)
        this.lastSeenTime = 0
		this.state = ''
		this._ratio = 0
		this.hasReceivedRatio = false
		this.uiVisibility = true
		this.currentSrc = ''
		this.currentMimetype = ''
		this.errorsCount = 0
		this.lastErrorTime = 0
	}
	setup(tag){
		console.log('adapter setup')
		this.object = this.container ? this.container.querySelector(tag) : null
		if (this.object) {
			this.recycle() // force to clear tracks
			this.patchPauseFn()
		}
	}
	patchPauseFn(){		
		if(typeof(this.object._pause) == 'undefined'){
			this.object._pause = this.object.pause
			this.object.pause = () => {} // prevent hls.js or browser from messing with playback
		}
	}
	uiVisible(visible){
		this.uiVisibility = visible
	}
	connect(){
		if (!this.object) {
			console.error('Cannot connect: object is null')
			return
		}
		
		try {
			this.object.currentTime = 0
		} catch (e) {
			console.warn('Error setting currentTime to 0:', e)
		}
		
		// Add text tracks change listener with error handling
		try {
			if (this.object.textTracks && this.object.textTracks.addEventListener) {
				this.object.textTracks.addEventListener('change', () => {
					try {
						this.emit('subtitleTracks', this.subtitleTracks())
					} catch (e) {
						console.error('Error in subtitleTracks change handler:', e)
					}
				})
			}
		} catch (e) {
			console.warn('Error adding textTracks listener:', e)
		}
		
		const onerr = e => {
			if (!this.object || !this.active) {
				return
			}
			
			try {
				if(this.object.error){
					e = this.object.error
				}
				
				let t = 0
				try {
					if (typeof this.time === 'function') {
						t = this.time()
					}
				} catch (timeError) {
					console.warn('Error getting time in error handler:', timeError)
				}
				
				const errStr = e ? String(e.message ? e.message : e) : 'unknown error'
				const isFailed = this.object.error || this.object.networkState == 3 || this.object.readyState < 2 || errStr.match(new RegExp('(pipeline_error|demuxer)', 'i'))
				console.error('Video error', t, this.errorsCount || 0, e, errStr, this.object.networkState +', '+ this.object.readyState, isFailed)
				
				if(isFailed){
					this.errorsCount = (this.errorsCount || 0) + 1
					const maxRetries = t > 0 ? 20 : 2
					
					if(this.errorsCount >= maxRetries){
						console.error('Video error: max retries reached', this.errorsCount, '/', maxRetries)
						this.emit('error', String(e.message || e), true)
						this.setState('')
					} else {
						const c = this.errorsCount // load() will reset the counter
						try {
							this.reload(() => {
								this.errorsCount = c
							})
						} catch (reloadError) {
							console.error('Error during reload in error handler:', reloadError)
							this.emit('error', 'Failed to reload after error', true)
							this.setState('')
						}
					}
				}
			} catch (errorHandlerError) {
				console.error('Error in error handler:', errorHandlerError)
			}
		}
		if (!this.object || typeof this.object.addEventListener !== 'function') {
			console.warn('Cannot connect: object is not available or addEventListener is not a function')
			return
		}
		
		try {
			if(this.currentMimetype && this.currentMimetype.match(new RegExp('(mpegts|mpegurl)', 'i'))){
				// let hls.js and mpegts.js do its own error handling first
				this.object.addEventListener('error', () => {
					setTimeout(() => {
						if (this.object && this.object.error && this.active) {
							onerr()
						}
					}, 10)
				})
			} else {
				this.object.addEventListener('error', onerr)
				const source = this.object.querySelector('source')
				if(source){ // for video only, hls.js uses src directly
					source.addEventListener('error', onerr)
				}
			}
		} catch (e) {
			console.error('Error adding error listeners:', e)
		}
		try {
			
			this.object.addEventListener('ended', e => {
				if (!this.active) return
				console.log('video ended', e)
				this.emit('ended', String(e))
			})
			
			this.object.addEventListener('timeupdate', event => {
				if (!this.active || !this.object) return
				try {
					this.emit('timeupdate', this.object.currentTime)
					if(this.state === 'loading') {
						this.processState()
					}
				} catch (e) {
					console.error('Error in timeupdate handler:', e)
				}
			})
			
			this.object.addEventListener('durationchange', event => {
				if (!this.active || !this.object) return
				try {
					if(this.object.duration && this.duration != this.object.duration){
						this.duration = this.object.duration
						if(this.duration && this.errorsCount){
							this.errorsCount = 0
						}
					}
					this.emit('durationchange')
				} catch (e) {
					console.error('Error in durationchange handler:', e)
				}
			})
			
			this.object.addEventListener('loadedmetadata', event => {
				if (!this.active || !this.object) return
				try {
					if(this.object.videoHeight){
						let r = this.object.videoWidth / this.object.videoHeight
						if(r > 0 && !this.hasReceivedRatio){
							this.hasReceivedRatio = true
							this.emit('setup-ratio', r)
						}
						this.ratio(r)
					}
					this.emit('audioTracks', this.audioTracks())
					this.emit('subtitleTracks', this.subtitleTracks())
				} catch (e) {
					console.error('Error in loadedmetadata handler:', e)
				}
			})
			
			this.object.addEventListener('waiting', () => {
				if (this.active) {
					this.setState('loading')
				}
			})
			
			this.object.addEventListener('playing', () => {
				if (this.active) {
					this.setState('playing')
				}
			})
			
			// Verify this.object is still available before adding multiple listeners
			if (this.object && typeof this.object.addEventListener === 'function') {
				['abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'ended', 'error', 'loadeddata', 'loadedmetadata', 'loadstart', 'pause', 'play', 'seeked', 'stalled', 'suspend'].forEach(n => {
					try {
						if (this.object && typeof this.object.addEventListener === 'function') {
							this.object.addEventListener(n, this.processState.bind(this))
						}
					} catch (e) {
						console.warn('Error adding event listener for', n, ':', e)
					}
				})
			}
			
			if (this.object) {
				try {
					this.processState()
				} catch (e) {
					console.warn('Error in processState() during connect():', e)
				}
			}
		} catch (e) {
			console.error('Error in connect():', e)
		}
	}
	disconnect(){
		this.recycle()
	}	
	recycle() {
		if (!this.object || !this.object.parentNode) {
			return
		}
		
		try {
			const p = this.object.parentNode
			const volume = this.object.volume || 1
			
			// Pause and clear source
			if (this.object.pause) {
				this.object.pause()
			}
			if (this.object.removeAttribute) {
				this.object.removeAttribute('src')
			}
			if (this.object.load) {
				this.object.load()
			}
			
			// Clone the element to reset its state
			const v = this.object.cloneNode(false)
			v.autoplay = true
			
			// Replace the element
			p.removeChild(this.object)
			p.appendChild(v)
			this.object = v
			this.object.volume = volume
			this.patchPauseFn()
		} catch (e) {
			console.error('Error in recycle():', e)
			// If recycle fails, try to at least clear the source
			if (this.object && this.object.removeAttribute) {
				try {
					this.object.removeAttribute('src')
					if (this.object.load) {
						this.object.load()
					}
				} catch (clearError) {
					console.error('Error clearing source after recycle failure:', clearError)
				}
			}
		}
	}
	setTextTracks(object, tracks) {
		if (!object || typeof object.querySelectorAll !== 'function') {
			console.warn('setTextTracks: invalid object')
			return
		}
		
		try {
			const existingTracks = object.querySelectorAll('track')
			for (var i = 0; i < existingTracks.length; i++) {
				try {
					object.removeChild(existingTracks[i])
				} catch (e) {
					console.warn('Error removing existing track', i, ':', e)
				}
			}
			
			if(tracks && typeof tracks === 'string') {
				tracks.split('§').forEach((subtitleUrl, i) => {
					if (!subtitleUrl) return
					
					try {
						const track = document.createElement('track')
						track.kind = 'captions'
						track.src = subtitleUrl

						if(i == 0) {
							track.mode = 'showing'
							track.enabled = true
						}

						try {
							const urlParams = new URL(subtitleUrl)
							const language = urlParams.searchParams.get('lang')
							const label = urlParams.searchParams.get('label')
						
							if(language) track.srclang = language
							if(label) track.label = label
						} catch (urlError) {
							console.warn('Error parsing subtitle URL:', subtitleUrl, urlError)
							// Continue without language/label if URL parsing fails
						}

						object.appendChild(track)
					} catch (trackError) {
						console.error('Error creating/appending track', i, ':', trackError)
					}
				})
			}
		} catch (e) {
			console.error('Error in setTextTracks():', e)
		}
	}
	disableTextTracks() {
		if (!this.object) return
		try {
			if (this.object.textTracks) {
				for(let i=0; i<this.object.textTracks.length; i++) {
					try {
						this.object.textTracks[i].mode = 'disabled'
					} catch (e) {
						console.warn('Error disabling text track', i, ':', e)
					}
				}
			}
			const existingTracks = this.object.querySelectorAll('track')
			for (var i = 0; i < existingTracks.length; i++) {
				try {
					this.object.removeChild(existingTracks[i])
				} catch (e) {
					console.warn('Error removing track', i, ':', e)
				}
			}
		} catch (e) {
			console.error('Error in disableTextTracks():', e)
		}
	}
	addTextTrack(trackNfo) {
		if (!this.object || !trackNfo) {
			return
		}
		
		try {
			if(this.object.readyState < 2) {
				const listener = () => {
					try {
						this.addTextTrack(trackNfo)
						this.object.removeEventListener('loadedmetadata', listener)
					} catch (e) {
						console.error('Error in addTextTrack listener:', e)
					}
				}
				return this.object.addEventListener('loadedmetadata', listener)
			}
			this.disableTextTracks() // disable video embedded tracks
			const track = document.createElement('track')
			track.kind = 'captions'
			track.label = trackNfo.name || 'English'
			track.srclang = trackNfo.language || 'en'
			track.enabled = true
			track.src = trackNfo.url
			track.mode = 'showing'
			track.addEventListener('load', () => {
				try {
					track.mode = 'showing'
				} catch (e) {
					console.warn('Error setting track mode in load handler:', e)
				}
			})
			this.object.appendChild(track)
			if (this.object.textTracks && this.object.textTracks.length > 0) {
				try {
					this.object.textTracks[0].mode = 'showing'
				} catch (e) {
					console.warn('Error setting first text track mode:', e)
				}
			}
		} catch (e) {
			console.error('Error in addTextTrack():', e)
		}
	}
	load(src, mimetype, additionalSubtitles, cookie, mediatype){
		if (!src) {
			console.error('Bad source in load()', src, mimetype)
			return
		}
		
		if (!this.object) {
			console.error('Cannot load: object is null')
			this.emit('error', 'Media element not available', true)
			return
		}
		
		try {
			this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)
			this._paused = false
			this.setState('loading')
			this.suspendStateChangeReporting = true
			this.unload(true)
			this.active = true
			console.log('adapter load')

			this.setTextTracks(this.object, additionalSubtitles)
			this.object.src = src
			this.connect()
			this.object.load()
			this._paused = false
			this.setState('loading')
			this.suspendStateChangeReporting = false
			this.resume()
			console.log('adapter resume', this.object.outerHTML, src, mimetype)
		} catch (e) {
			console.error('Error in load():', e)
			this.emit('error', 'Failed to load media', true)
			this.setState('')
			this.active = false
		}
	}
	unload(){
		console.log('adapter unload')
		this.hasReceivedRatio = false
		if(this.active){
			this.active = false
			try {
				this.disconnect()
			} catch (e) {
				console.error('Error in disconnect() during unload():', e)
			}
			
			if(this.object && this.object.currentSrc) {
				try {
					this.pause()
					this._paused = false
					const source = document.createElement('source')
					source.type = 'video/mp4'
					source.src = ''
					this.object.innerHTML = ''
					this.object.appendChild(source)
					this.object.removeAttribute('src')
					this.object.load()
				} catch (e) {
					console.error('Error clearing object source in unload():', e)
				}
			}
		}
	}
	resume(){
		if (!this.object || !this.active) {
			return
		}
		
		this._paused = false
		try {
			let promise = this.object.play()
			if(promise && typeof promise.catch === 'function'){
				promise.catch(err => {
					// AbortError and NotAllowedError are expected (user pause, autoplay restrictions)
					if (err.name !== 'AbortError' && err.name !== 'NotAllowedError' && this.active){
						console.error('Error in resume():', err, err.message, this.object ? this.object.networkState : 'N/A', this.object ? this.object.readyState : 'N/A')
					}
				})
			}
		} catch (e) {
			console.error('Error calling play() in resume():', e)
		}
	}
	pause(){
		this._paused = true
		if (this.object && typeof this.object._pause === 'function') {
			try {
				this.object._pause()
			} catch (e) {
				console.error('Error calling _pause():', e)
			}
		}
	}
	restart(){
		if (typeof this.time === 'function') {
			try {
				this.time(0)
			} catch (e) {
				console.error('Error setting time to 0 in restart():', e)
			}
		}
		this.resume()
	}
	time(s){
		if (!this.object) {
			return 0
		}
		if(typeof(s) == 'number'){
			try {
				this.object.currentTime = s
			} catch (e) {
				console.error('Error setting currentTime:', e)
			}
		}
		try {
			return this.object.currentTime || 0
		} catch (e) {
			console.error('Error getting currentTime:', e)
			return 0
		}
	}
	ratio(s){
		if(typeof(s) == 'number'){
			try {
				let css, rd, wr, portrait
				if(window.innerWidth < window.innerHeight){
					portrait = true
					wr = window.innerHeight / window.innerWidth
				} else {
					wr = window.innerWidth / window.innerHeight
				}
				rd = (wr > s)
				console.log('ratiochange', rd, this.ratioDirection, wr, s, this._ratio)
				if(typeof(this.ratioDirection) == 'undefined' || this.ratioDirection != rd || s != this._ratio || portrait != this.inPortrait){
					this.inPortrait = portrait
					this._ratio = s
					this.ratioDirection = rd
					if(this.inPortrait){
						css = 'player > div { width: 100vw; height: calc(100vw / ' + this._ratio + ') !important; }'
					} else {
						if(this.ratioDirection){
							css = 'player > div { height: 100vh; width: calc(100vh * ' + this._ratio + ') !important; }'
						} else {
							css = 'player > div { width: 100vw; height: calc(100vw / ' + this._ratio + ') !important; }'
						}
					}
					if(!this.ratioCSS){
						this.ratioCSS = document.createElement('style')
					}
					this.ratioCSS.innerText = ''
					this.ratioCSS.appendChild(document.createTextNode(css))
					const target = document.querySelector("head, body")
					if (target) {
						target.appendChild(this.ratioCSS)
					} else {
						console.warn('Could not find head or body element to append ratio CSS')
					}
					console.log('ratioupdated', this.inPortrait ?? false)
				}
			} catch (e) {
				console.error('Error in ratio():', e)
			}
		}
		return this._ratio || 0
	}
	playbackRate(rate){
		if (!this.object) return 1
		if(typeof(rate) == 'number'){
			try {
				this.object.playbackRate = rate
			} catch (e) {
				console.error('Error setting playbackRate:', e)
			}
		}
		try {
			return this.object.playbackRate || 1
		} catch (e) {
			console.error('Error getting playbackRate:', e)
			return 1
		}
	}
	videoRatio(){
		if (!this.object) {
			return 1.7777777777777777
		}
		try {
			if(!this.object.videoWidth || !this.object.videoHeight){
				return 1.7777777777777777
			}
			return this.object.videoWidth / this.object.videoHeight
		} catch (e) {
			console.error('Error getting videoRatio:', e)
			return 1.7777777777777777
		}
	}
	processState(){
		if (!this.object) {
			return
		}
		
		var s = ''
		if(this.active){
			try {
				if(this.object.paused){
					if(this._paused === true) {
						s = 'paused'
					} else {
						s = 'loading'
						this.resume()
					} 
				} else if(this.object.readyState < 4) { // if duration == Infinity, readyState will be 3		
					this.lastSeenTime = this.object.currentTime || 0
					s = 'loading'
				} else {
					s = 'playing'
				}
			} catch (e) {
				console.error('Error in processState():', e)
				s = ''
			}
		}
		this.setState(s)
	}
	volume(l){
		if (!this.object) return
		if(typeof(l) == 'number'){
			try {
				this.object.volume = l / 100
			} catch (e) {
				console.error('Error setting volume:', e)
			}
		}
	}
	audioTracks(){
		if (!this.object || !this.object.audioTracks) {
			return []
		}
		return this.formatTracks(this.object.audioTracks)
	}
	audioTrack(trackId){
		if (!this.object || !this.object.audioTracks) {
			return
		}
		try {
			for (let i = 0; i < this.object.audioTracks.length; i++) {
				const enable = i == trackId || this.object.audioTracks[i].id == trackId
				this.object.audioTracks[i].enabled = enable
			}
		} catch (e) {
			console.error('Error setting audio track:', e)
		}
	}
	subtitleTracks(){
		if (!this.object || !this.object.textTracks) {
			return []
		}
		return this.formatTracks(this.object.textTracks)
	}
	subtitleTrack(trackId){
		if(!this.object || !this.object.textTracks) return
		try {
			for (let i = 0; i < this.object.textTracks.length; i++) {
				const enable = i == trackId || this.object.textTracks[i].id == trackId
				this.object.textTracks[i].enabled = enable
				this.object.textTracks[i].mode = enable ? 'showing' : 'disabled'
			}
		} catch (e) {
			console.error('Error setting subtitle track:', e)
		}
	}
	formatTracks(tracks, activeId){
		if(!tracks || typeof(tracks) != 'object'){
			return []
		}
		if(!Array.isArray(tracks)){
			tracks = [...tracks]
		}
		const allow = ['id', 'lang', 'language', 'enabled', 'label', 'name']
		return tracks.map((t, i) => {
			const ts = {}
			for(const k of allow) {
				if(t[k]) {
					ts[k] = t[k]
				}
			}
			if(typeof(ts.id) == 'undefined') {
				ts.id = i
			}
			if(typeof(activeId) != 'undefined' && activeId == ts.id){
				ts.enabled = true
			}
			return ts
		})
	}
	destroy(){
		console.log('adapter destroy')
		this.pause()
		this.unload()
		this.object = null
		this.removeAllListeners()
	}
}

export class MediaPlayerAdapterHTML5Video extends MediaPlayerAdapterHTML5 {
	constructor(container){
		super(container)
        this.setup('video')
	}
}

export class MediaPlayerAdapterHTML5Audio extends MediaPlayerAdapterHTML5 {
	constructor(container){
		super(container)
        this.setup('audio')
	}
}

export class MediaPlayerAdapterAndroidNative extends MediaPlayerAdapter {
	constructor(container){
		super(container)
		this.object = window.plugins['megacubo'] || {}
		this.state = ''
		this.duration = 0
		this.currentTime = 0
		this.hasReceivedRatio = false
		this.aspectRatio = 1.7777777777777777
		this.object.on('ratio', e => {
			console.log('RECEIVED RATIO', e)
			if(e.ratio > 0 && !this.hasReceivedRatio){
				this.hasReceivedRatio = true
				this.emit('setup-ratio', e.ratio)
			}
		})
		this.object.on('state', state => {
			if(state != this.state){
				if(state == 'paused' && !this.duration){
					state = 'loading'
				}
				this.state = state
				if(!this.suspendStateChangeReporting) this.emit('state', this.state)
			}
		})
		this.object.on('timeupdate', () => {
			if(!this.active) return
			this.currentTime = this.object.currentTime
			this.emit('timeupdate', this.object.currentTime)
		})
		this.object.on('durationchange', () => {
			this.duration = this.object.duration
			this.emit('durationchange')
		})
		this.object.on('audioTracks', tracks => {
			this.emit('audioTracks', tracks)
		})		
		this.object.on('subtitleTracks', tracks => {
			this.emit('subtitleTracks', tracks)
		})		
		this.object.on('error', (err, data) => {
			console.log('Error: ', err, 'data:', data)
			this.errorCallback(err)
		})
	}
	uiVisible(visible){
		this.object.uiVisible(visible)
	}
	load(src, mimetype, additionalSubtitles, cookie, mediatype){
		this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)
		this.active = true
		this.currentTime = 0
		this.duration = 0
		this.state = 'loading'
		this.mediatype = mediatype
		this.emit('state', this.state)
		this.object.play(src, mimetype, additionalSubtitles, cookie, mediatype, this.successCallback.bind(this), this.errorCallback.bind(this))
	}
	successCallback(){
		console.warn('exoplayer success', arguments)
	}
	errorCallback(...args){
		console.error('exoplayer err', args)
		this.emit('error', args.length ? args[0] : 'Exoplayer error', true)
		this.state = ''
		this.emit('state', '')
	}
	unload(){
		this.hasReceivedRatio = false
		this.active = false
		this.object.stop()
	}
	resume(){
		this.object.resume()
	}
	pause(){
		this.object.pause()
	}
	restart(){
		this.time(0)
		this.resume()
	}
	time(s){
		if(typeof(s) == 'number'){
			this.currentTime = s
			this.object.seek(s)
		}
		return this.currentTime
	}
	ratio(s){
		if(typeof(s) == 'number'){
			this.object.ratio(s)
		}
		return this.object.aspectRatio
	}	
	playbackRate(rate){
		if(typeof(rate) == 'number'){
			console.warn('SET PLAYBACK RATE', rate)
			this.object.setPlaybackRate(rate)
		}
		return this.object.playbackRate
	}
	videoRatio(){
		return this.object.aspectRatio
	}	
	volume(l){
		this.object.volume(l)
	}
	audioTrack(trackId){
		return this.object.audioTrack(trackId)
	}
	audioTracks(){
		return this.object.audioTracks()
	}
	subtitleTrack(trackId){
		return this.object.subtitleTrack(trackId)
	}
	subtitleTracks(){
		return this.object.subtitleTracks()
	}
	addTextTrack(){
		// TODO
	}
	destroy(){
		this.unload()
		this.removeAllListeners()
	}
}

