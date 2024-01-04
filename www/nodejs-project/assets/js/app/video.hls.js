const { ErrorTypes, ErrorDetails, Events } = Hls

class VideoControlAdapterHTML5HLS extends VideoControlAdapterHTML5Video {
	constructor(container) {
		super(container)
		this.currentSrc = ''
		this.setup('video')
	}
	load(src, mimetype, additionalSubtitles, cookie, type) {
		if (!src) {
			console.error('Bad source', src, mimetype, traceback())
			return
		}
		this.active = true
		this.engineType = type
		if (this.currentSrc !== src) {
			this.currentSrc = src
			this.currentMimetype = mimetype
		}
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
			if(data && data.details) {
				if(data.frag && ['fragParsingError', 'fragLoadError', 'bufferStalledError'].includes(data.details) && !data.fatal){
					// handle fragment load errors
					return this.skipCurrentSegment(data.frag)
				} else if(data.details == 'manifestLoadTimeOut'){
					hls.recoverMediaError()
					hls.startLoad()
					return
				}
			}
			if (data && data.fatal) {
				switch (data.type) {
					case ErrorTypes.MEDIA_ERROR:
						if(data.frag) {
							this.skipCurrentSegment(data.frag) // skip before recover to prevent loading same frag
						}
						console.error('HLS fatal media error encountered, reload')
						hls.recoverMediaError()
						break
					case ErrorTypes.NETWORK_ERROR:
						console.error('HLS fatal network error encountered, reload')
						hls.stopLoad()
						hls.recoverMediaError()
						hls.startLoad()
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
	skipCurrentSegment(frag) {
		const start = frag.start + frag.duration
		if(frag.loader) {
			console.warn('Fix level to '+ start)
			frag.loader.abort()
			frag.loader.startPosition = start
			this.hls.trigger(Events.LEVEL_LOADING, {
				url: frag.url
			})
		} else {
			const fixPlayback = this.hls.media.currentTime >= (frag.start - 2) && this.hls.media.currentTime < start
			console.warn('Skip from '+ this.hls.media.currentTime +' to '+ start, fixPlayback)		
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
