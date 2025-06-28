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
			let r = this.current.duration
			if(isNaN(r)){
				return 0
			}
			if(r === Infinity){
				if(this.current.object.buffered.length){
					for(let i=0; i < this.current.object.buffered.length; i++){
						r = this.current.object.buffered.end(i)
					}
				} else {
					r = this.current.time() + 2
				}
			}
			return r
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
		main.localEmit('player-show')
		this.revealTimer = setTimeout(() => {
			document.documentElement.classList.add('playing')
			const c = document.body.className
			// console.warn('VIDEOCLASS* '+ c)
            if(!c.includes('video-')) { // no state set yet, add 'video-loading' so
				document.body.classList.add('video')
				document.body.classList.add('video-loading')
			} else {
				document.body.classList.add('video')
			}
			if(!(this.current instanceof MediaPlayerAdapterAndroidNative)) {
				this.container.style.display = 'flex'
				this.container.querySelectorAll('video, audio').forEach(e => {
					e.style.display = (e == this.current.object) ? 'block' : 'none'
				})
			}
		}, 400)
	}
	hide(){
		if(this.revealTimer){
			clearTimeout(this.revealTimer)
		}
		document.documentElement.classList.remove('playing');
		['video', 'video-loading', 'video-playing', 'video-paused'].forEach(c => document.body.classList.remove(c))
		main.localEmit('player-hide')
		this.container.style.display = 'none'
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
		if(this.current){
			return this.current.object.muted
		}
	}
	setState(s, err){
		if(this.state != s){
			this.state = s
			if(!this.suspendStateChangeReporting) this.emit('state', s, err)
		}
	}
	load(src, mimetype, additionalSubtitles, cookie, mediatype, data){
		this.setState('loading')
		this.mediatype = mediatype
		this.suspendStateChangeReporting = true
		this.current && this.current.unload(true)
		if(window.plugins && window.plugins.megacubo){
			this.setup('native', MediaPlayerAdapterAndroidNative)
		} else {
			let m = mimetype.toLowerCase()
			if(m.includes('mpegurl')){
				this.setup('html5h', MediaPlayerAdapterHTML5HLS)
			} else if(m.includes('mp2t') || (src.endsWith('.ts') && mediatype == 'video') || (data && data.mpegts === true)){
				this.setup('html5t', MediaPlayerAdapterHTML5TS)
			} else if(m.includes('dash') || src.endsWith('.mpd')) {
				this.setup('html5d', MediaPlayerAdapterHTML5DASH)
			} else if(m.includes('audio/')){
				this.setup('html5a', MediaPlayerAdapterHTML5Audio)
			} else {
				this.setup('html5v', MediaPlayerAdapterHTML5Video)
			}
		}
		const current = this.current
		this.suspendStateChangeReporting = false
		current.errorsCount = 0
		try {
			current.load(src, mimetype, additionalSubtitles, cookie, mediatype)
		} catch(err) {
			console.error('Media player error:', err.message || err)
		}
		this.current = current
		this.show()
		main.config && current.volume(main.config['volume'])
		document.body.style.backgroundColor = 'transparent'
		return current
	}
	setup(adapterName, adapter){
		this.adapter = adapterName
		this.currentAudioTracks = []
		this.currentSubtitleTracks = []
		if (this.current) {
			this.current.destroy();
			this.current = null;
		}

		const a = new adapter(this.innerContainer)
		a.on('state', s => {
			if(typeof(s) == 'undefined') return
			if(!s && this.hasErr){
				s = 'error'
			}
			if(!this.suspendStateChangeReporting) this.setState(s, this.hasErr)
		})
		a.on('setup-ratio', r => {
			if(!this.current) return
			this.emit('setup-ratio', r)
		})
		a.on('timeupdate', n => {
			if(!this.current) return
			this.emit('timeupdate', n)
		})
		a.on('durationchange', () => {
			if(!this.current) return
			this.emit('durationchange', this.uiVisibility)
		})
		a.on('audioTracks', tracks => {
			if(!this.current) return
			if(!this.equals(tracks, this.currentAudioTracks)){
				this.currentAudioTracks = tracks
				this.emit('audioTracks', tracks)
			}
		})
		a.on('subtitleTracks', tracks => {
			if(!this.current) return
			if(!this.equals(tracks, this.currentSubtitleTracks)){
				this.currentSubtitleTracks = tracks
				this.emit('subtitleTracks', tracks)
			}
		})
		a.on('error', (err, fatal) => {
			if(!this.current){
				try { // a.disconnect() is not a function
					a.disconnect()
					a.unload()
				} catch(e) {}
				return
			}
			if(this.clearErrTimer){
				clearTimeout(this.clearErrTimer)
			}
			if(fatal === true){
				this.state = 'error'
				if(!this.suspendStateChangeReporting) this.emit('state', this.state, err)
				a.unload()
			} else {
				this.hasErr = String(err)
				this.clearErrTimer = setTimeout(() => {
					this.hasErr = null
				}, 5000)
			}
		})
		a.on('ended', (err, fatal) => {
			if(!this.current) return
			this.suspendStateChangeReporting = true
			this.pause()
			setTimeout(() => {
				this.suspendStateChangeReporting = false
				this.setState('ended')
			}, 0)
		})
		a.config = main.config
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
			this.current.unload(true)
			if(!silent) {
				this.hide()
				this.current = null
				this.setState('')
			}
		}
	}
}

export default MediaPlayer
