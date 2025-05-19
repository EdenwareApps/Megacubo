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
		const t = this.time()
		const {currentSrc, currentMimetype, currentAdditionalSubtitles, cookie, mediatype} = this
		this.suspendStateChangeReporting = true
		this.unload()
		if(alive){
			setTimeout(() => {
				this.suspendStateChangeReporting = false
				this.setState('loading')
			this.load(currentSrc, currentMimetype, currentAdditionalSubtitles, cookie, mediatype)
			if(t && this.mediatype == 'live') {
				this.time(t + 0.5) // nudge a bit to skip any decoding error on part of the file
			}
				cb && cb()
			}, 10)
		} else {
			this.emit('error', 'Playback failure', true)
			this.setState('')
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
	}
	setup(tag){
		console.log('adapter setup')
		this.object = this.container.querySelector(tag)
		this.recycle() // force to clear tracks
		this.patchPauseFn()
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
		this.object.currentTime = 0
		this.object.textTracks.addEventListener('change', () => this.emit('subtitleTracks', this.subtitleTracks()))
		this.object.addEventListener('click', event => {
            let e = (event.target || event.srcElement)
            if(e.tagName && e.tagName.toLowerCase() == tag){
				this.emit('click')
            }
        })
		const onerr = e => {
			if(this.object.error){
				e = this.object.error
			}
			const t = this.time()
			const errStr = e ? String(e.message ? e.message : e) : 'unknown error'
			const isFailed = this.object.error || this.object.networkState == 3 || this.object.readyState < 2 || errStr.match(new RegExp('(pipeline_error|demuxer)', 'i'))
			console.error('Video error', t, this.errorsCount, e, errStr, this.object.networkState +', '+ this.object.readyState, isFailed)
			if(isFailed){
				this.errorsCount++
				if(this.errorsCount >= (t > 0 ? 20 : 2)){
					this.emit('error', String(e.message || e), true)
					this.setState('')
				} else {
					const c = this.errorsCount // load() will reset the counter
					this.reload(() => {
						this.errorsCount = c
					})
				}
			}
		}
		if(this.currentMimetype.match(new RegExp('(mpegts|mpegurl)', 'i'))){
			// let hls.js and mpegts.js do its own error handling first
			this.object.addEventListener('error', () => setTimeout(() => this.object.error && onerr(), 10))
		} else {
			this.object.addEventListener('error', onerr)
			const source = this.object.querySelector('source')
			if(source){ // for video only, hls.js uses src directly
				source.addEventListener('error', onerr)
			}
		}
		this.object.addEventListener('ended', e => {
			console.log('video ended', e)
            this.emit('ended', String(e))
		})
        this.object.addEventListener('timeupdate', event => {
			this.emit('timeupdate', this.object.currentTime)
			this.state === 'loading' && this.processState()
		})
        this.object.addEventListener('durationchange', event => {
			if(this.object.duration && this.duration != this.object.duration){
				this.duration = this.object.duration
				if(this.duration && this.errorsCount){
					this.errorsCount = 0
				}
			}
			this.emit('durationchange')
		})
        this.object.addEventListener('loadedmetadata', event => {
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
		});
		this.object.addEventListener('waiting', () => {
			this.setState('loading')
		})
		this.object.addEventListener('playing', () => {
			this.setState('playing')
		});
		['abort', 'canplay', 'canplaythrough', 'durationchange', 'emptied', 'ended', 'error', 'loadeddata', 'loadedmetadata', 'loadstart', 'pause', 'play', 'seeked', 'stalled', 'suspend'].forEach(n => {
			this.object.addEventListener(n, this.processState.bind(this))
		})
		this.processState()
	}
	disconnect(){
		this.recycle()
	}	
	recycle() {
		if (this.object.parentNode && this.object.getAttribute('src')) {
			const volume = this.object.volume
			if(this.object) {
				this.object.pause()
				this.object.removeAttribute('src')
				this.object.load()
			}
			const v = document.createElement('video')
			v.autoplay = true
			this.object.replaceWith(v)
			this.object.parentNode && this.object.parentNode.removeChild(this.object)
			this.object = v
			this.object.volume = volume
			this.patchPauseFn()
		}
	}
	recycle() {
		const p = this.object.parentNode
		if (p) {
			const volume = this.object.volume
			this.object.pause()
			this.object.removeAttribute('src')
			this.object.load()
			const v = this.object.cloneNode(false)
			v.autoplay = true
			p.removeChild(this.object)
			p.appendChild(v)
			this.object = v
			this.object.volume = volume
			this.patchPauseFn()
		}
	}
	setTextTracks(object, tracks) {
		const existingTracks = object.querySelectorAll('track')
		for (var i = 0; i < existingTracks.length; i++) {
			object.removeChild(existingTracks[i])
		}
		if(tracks) {
			tracks.split('§').forEach((subtitleUrl, i) => {
				const track = document.createElement('track')
				//track.kind = 'subtitles'
				track.kind = 'captions'
				track.src = subtitleUrl

				if(i == 0) {
					track.mode = 'showing'
					track.enabled = true
				}

				const urlParams = new URL(subtitleUrl)
				const language = urlParams.searchParams.get('lang')
				const label = urlParams.searchParams.get('label')
			
				if(language) track.srclang = language
				if(label) track.label = label

				object.appendChild(track)
			})
		}
	}
	disableTextTracks() {
		for(let i=0; i<this.object.textTracks.length; i++) {
			this.object.textTracks.mode = 'disabled'
		}
		const existingTracks = this.object.querySelectorAll('track')
		for (var i = 0; i < existingTracks.length; i++) {
			this.object.removeChild(existingTracks[i])
		}
	}
	addTextTrack(trackNfo) {
		if(this.object.readyState < 2) {
			const listener = () => {
				this.addTextTrack(trackNfo)
				this.object.removeEventListener('loadedmetadata', listener)
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
		track.addEventListener('load', () => track.mode = 'showing')
		this.object.appendChild(track)
		this.object.textTracks[0].mode = 'showing'
	}
	load(src, mimetype, additionalSubtitles, cookie, mediatype){
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
	}
	unload(){
		console.log('adapter unload')
		this.hasReceivedRatio = false
		if(this.active){
			this.active = false
			this.disconnect()
			if(this.object.currentSrc) {
				this.pause()
				this._paused = false
				this.object.innerHTML = '<source type="video/mp4" src="" />'
				this.object.removeAttribute('src')
				this.object.load()
			}
		}
	}
	resume(){
		this._paused = false
		let promise = this.object.play()
		if(promise){
			promise.catch(err => {
				if(this.active){
					console.error(err, err.message, this.object.networkState, this.object.readyState)
				}
			})
		}
	}
	pause(){
		this._paused = true
		this.object && this.object._pause && this.object._pause()
	}
	restart(){
		this.time(0)
		this.resume()
	}
	time(s){
		if(typeof(s) == 'number'){
			this.object.currentTime = s
		}
		return this.object.currentTime
	}
	ratio(s){
		if(typeof(s) == 'number'){
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
            	document.querySelector("head, body").appendChild(this.ratioCSS)
				console.log('ratioupdated', this.inPortrait)
			}
		}
		return this._ratio
	}
	playbackRate(rate){
		if(typeof(rate) == 'number'){
			this.object.playbackRate = rate
		}
		return this.object.playbackRate
	}
	videoRatio(){
		if(!this.object.videoWidth){
			return 1.7777777777777777
		}
		return this.object.videoWidth / this.object.videoHeight
	}
	processState(){
		var s = ''
		if(this.active){
			if(this.object.paused){
				if(this._paused === true) {
					s = 'paused'
				} else {
					s = 'loading'
					this.resume()
				} 
			} else if(this.object.readyState < 4) { // if duration == Infinity, readyState will be 3		
				this.lastSeenTime = this.object.currentTime
				s = 'loading'
			} else {
				s = 'playing'
			}
		}
		this.setState(s)
	}
	volume(l){
		if(typeof(l) == 'number'){
			this.object.volume = l / 100
		}
	}
	audioTracks(){
		return this.formatTracks(this.object.audioTracks)
	}
	audioTrack(trackId){
		for (let i = 0; i < this.object.audioTracks.length; i++) {
			const enable = i == trackId || this.object.audioTracks[i].id == trackId
			this.object.audioTracks[i].enabled = enable
		}
	}
	subtitleTracks(){
		return this.formatTracks(this.object.textTracks)
	}
	subtitleTrack(trackId){
		if(!this.object.textTracks) return
		for (let i = 0; i < this.object.textTracks.length; i++) {
			const enable = i == trackId || this.object.textTracks[i].id == trackId
			this.object.textTracks[i].enabled = enable
			this.object.textTracks[i].mode = enable ? 'showing' : 'disabled'
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

