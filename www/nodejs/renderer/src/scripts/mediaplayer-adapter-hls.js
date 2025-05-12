import {MediaPlayerAdapterHTML5Video} from './mediaplayer-adapter'

const { ErrorTypes, ErrorDetails, Events } = Hls

class MediaPlayerAdapterHTML5HLS extends MediaPlayerAdapterHTML5Video {
	constructor(container) {
		super(container)
		this.currentSrc = ''
		this.setup('video')
	}
	load(src, mimetype, additionalSubtitles, cookie, mediatype) {
		if (!src) {
			console.error('Bad source', src, mimetype)
			return
		}
		this.active = true
		this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)
		const timeout = 15000
		const config = {
			enableWorker: true,
			liveDurationInfinity: false,
			lowLatencyMode: true,
			backBufferLength: 0,
			fragLoadingTimeOut: timeout,
			fragLoadingMaxRetry: 1,
			levelLoadingMaxRetry: 2,
			manifestLoadingMaxRetry: 20,
			fragLoadingMaxRetryTimeout: timeout,
			levelLoadingMaxRetryTimeout: timeout,
			manifestLoadingMaxRetryTimeout: timeout
		}
		const hls = new Hls(config)
		this.setTextTracks(this.object, additionalSubtitles)		
		hls.loadSource(this.currentSrc)
		hls.attachMedia(this.object)
		hls.on(Events.ERROR, (event, data) => {
			console.error('HLS ERROR', data)			
			if (!data) data = event			
			if (!data) return
			if(data.details && data.frag && !data.fatal) {
				if(['fragParsingError', 'fragLoadError', 'bufferStalledError', 'bufferNudgeOnStall'].includes(data.details)){
					// handle fragment load errors
					return this.skipSegment(data.frag)
				}
			} else if (data.fatal) {
				switch (data.type) {
					case ErrorTypes.MEDIA_ERROR:
						if(data.frag) {
							this.skipSegment(data.frag) // skip before recover to prevent loading same frag
						}
						console.error('HLS fatal media error encountered, reload')
						this.reload()
						break
					case ErrorTypes.NETWORK_ERROR:
						console.error('HLS fatal network error encountered, reload')
						this.reload()
						break
					default:
						console.error('HLS unknown fatal error encountered, destroy')
						this.emit('error', 'HLS fatal error', true)
						break
				}
			}
		})
		this.hls = hls
		this.connect()
	}
	skipSegment(frag) {
		const start = frag.start + frag.duration
		if(frag.loader) {
			console.warn('Fix level to '+ start)
			frag.loader.abort()
			frag.loader.startPosition = start
			this.hls.trigger(Events.LEVEL_LOADING, {
				url: frag.url
			})
		} else {
			const fixPlayback = this.hls.media.currentTime >= (frag.start - 12) && this.hls.media.currentTime < start
			console.warn('Skip from '+ this.hls.media.currentTime +' to '+ start, frag, fixPlayback)		
			this.hls.stopLoad()
			if(fixPlayback) this.hls.media.currentTime = start
			this.hls.startLoad(start)
			if(fixPlayback) this.hls.media.play()
		}
	}
	unload() {
		console.log('unload hls')
		if (this.hls) {
			console.log('unload hls disconnect')
			this.hls.destroy()
			this.hls = null
			this.object.src = ''
			console.log('unload hls super.unload')
			super.unload()
			console.log('unload hls OK')
		}
	}
	destroy() {
		console.log('hls destroy')
		this.unload()
		super.destroy()
	}
}

export default MediaPlayerAdapterHTML5HLS
