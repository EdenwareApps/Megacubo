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
		const timeout = 10000
		const config = {
			enableWorker: true,
			liveDurationInfinity: false,
			fragLoadingTimeOut: timeout,
			fragLoadingMaxRetry: 1,
			lowLatencyMode: true,
			backBufferLength: 0,
			fragLoadingMaxRetry: 0,
			levelLoadingMaxRetry: 2,
			manifestLoadingMaxRetry: 20,
			fragLoadingMaxRetryTimeout: timeout,
			levelLoadingMaxRetryTimeout: timeout,
			manifestLoadingMaxRetryTimeout: timeout
		}
		const hls = new Hls(config)
		this.setObjectTracks(this.object, additionalSubtitles)		
		hls.loadSource(this.currentSrc)
		hls.attachMedia(this.object)
		hls.on(Events.ERROR, (event, data) => {
			console.error('HLS ERROR', data)			
			if (!data) data = event
			if(data && ['fragParsingError', 'fragLoadError'].includes(data.details)){
				// handle fragment load errors
				const loader = data.frag.loader
				if (data.response && data.response.status === 404) {
					// skip current segment and continue with the same level
					hls.streamController.skipCurrentSegment()
				} else if(loader) { // preferred way
					// retry fragment load
					loader.abort()
					loader.startPosition = data.frag.start
					hls.trigger(Events.LEVEL_LOADING, { url: data.frag.url })
				} else { // last resort
					hls.stopLoad()
					hls.startLoad(data.frag.end + 0.1)
				}
				return
			}
			if(data && data.details == 'manifestLoadTimeOut'){
				hls.recoverMediaError()
				hls.startLoad()
				return
			}
			if (data && data.fatal) {
				switch (data.type) {
					case ErrorTypes.MEDIA_ERROR:
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
