const { ErrorTypes, ErrorDetails, Events } = Hls

class HLSObserver extends EventEmitter {
	constructor(hlsInstance, fragLoadTimeout = 10000) {
		super()

		this.hls = hlsInstance
		this.isDownloadingSegment = false
		this.isStuck = false
		this.fragLoadTimeout = fragLoadTimeout

		this.hls.on(Events.FRAG_LOAD_ERROR, () => this.handleFragLoadError())
		this.hls.on(Events.FRAG_LOAD_TIMEOUT, () => this.handleFragLoadTimeout())
		this.hls.on(Events.FRAG_LOADING, () => this.handleFragLoading())
		this.hls.on(Events.FRAG_LOADED, () => this.handleFragLoaded())
		this.hls.on(Events.ERROR, data => this.handleError(data))
		this.hls.on(Events.MANIFEST_LOADING, () => this.handleManifestLoading())
		this.hls.on(Events.MANIFEST_LOADED, () => this.handleManifestLoaded())
		this.hls.on(Events.MANIFEST_LOAD_ERROR, () => this.handleManifestLoadError())
		this.hls.on(Events.MANIFEST_LOAD_TIMEOUT, () => this.handleManifestLoadTimeout())

		this.hls.on(Events.FRAG_LOAD_ERROR, this.handleFragLoadError)
		this.hls.on(Events.FRAG_LOAD_TIMEOUT, this.handleFragLoadTimeout)
		this.hls.on(Events.FRAG_LOADING, this.handleFragLoading)
		this.hls.on(Events.FRAG_LOADED, this.handleFragLoaded)
		this.hls.on(Events.ERROR, this.handleError)
		this.hls.on(Events.MANIFEST_LOADING, this.handleManifestLoading)
		this.hls.on(Events.MANIFEST_LOADED, this.handleManifestLoaded)
		this.hls.on(Events.MANIFEST_LOAD_ERROR, this.handleManifestLoadError)
		this.hls.on(Events.MANIFEST_LOAD_TIMEOUT, this.handleManifestLoadTimeout)
	}
	handleFragLoading() {
		this.isDownloadingSegment = Date.now() / 1000
		this.isStuck = false
		this.timer && clearTimeout(this.timer) && (this.timer = 0)
	}
	handleFragLoaded() {
		this.isDownloadingSegment = false
	}
	handleFragLoadError() {
		this.isDownloadingSegment = false
	}
	handleFragLoadTimeout(event, data) {
		this.isDownloadingSegment = false
	}
	handleError(event, data) {
		this.isDownloadingSegment = false
		if (!data) data = event
		if (data && data.type === ErrorTypes.MEDIA_ERROR &&
			data.details === ErrorDetails.BUFFER_STALLED_ERROR
		) {
			const playerEmptyLoading =
				this.hls.media.networkState == 2 && [1, 2].includes(this.hls.media.readyState)
			const fatal = data.fatal || playerEmptyLoading
			this.isStuck = fatal
			if (this.isStuck && !this.timer) {
				this.timer = setTimeout(() => {
					this.isStuck && this.emit('stuck')
					clearTimeout(this.timer) && (this.timer = 0)
				}, this.fragLoadTimeout)
			} else if (!this.isStuck && this.timer) {
				clearTimeout(this.timer) && (this.timer = 0)
			}
		}
	}
	handleManifestLoading() {
		this.isPlaylistLoading = true
		this.isStuck = false
		this.timer && clearTimeout(this.timer) && (this.timer = 0)
	}
	handleManifestLoaded() {
		this.isPlaylistLoading = false
	}
	handleManifestLoadError() {
		this.isPlaylistLoading = false
	}
	handleManifestLoadTimeout() {
		this.isPlaylistLoading = false
	}
	check() {
		const fragLoadTimeout = 10
		const deadline = (Date.now() / 1000) - fragLoadTimeout
		const isDownloading = (this.isDownloadingSegment && this.isDownloadingSegment > deadline) || this.isPlaylistLoading
		const isPaused = this.hls.media.paused
		const isStuck = this.isStuck
		return (isDownloading || isPaused || !isStuck)
	}
	disconnect() {
		this.hls.off(Events.FRAG_LOAD_ERROR, this.handleFragLoadError)
		this.hls.off(Events.FRAG_LOAD_TIMEOUT, this.handleFragLoadTimeout)
		this.hls.off(Events.FRAG_LOADING, this.handleFragLoading)
		this.hls.off(Events.FRAG_LOADED, this.handleFragLoaded)
		this.hls.off(Events.ERROR, this.handleError)
		this.hls.off(Events.MANIFEST_LOADING, this.handleManifestLoading)
		this.hls.off(Events.MANIFEST_PARSED, this.handleManifestParsed)
		this.hls.off(Events.LEVEL_LOADING, this.handleLevelLoading)
		this.hls.off(Events.LEVEL_LOADED, this.handleLevelLoaded)
		this.hls.off(Events.LEVEL_UPDATED, this.handleLevelUpdated)
	}
}

class VideoControlAdapterHTML5HLS extends VideoControlAdapterHTML5Video {
	constructor(container) {
		super(container)
		this.currentSrc = ''
		this.setup('video')
	}
	load(src, mimetype, cookie, type) {
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
		this.recycle()
		const timeout = 10000
		const config = {
			enableWorker: true,
			liveDurationInfinity: false,
			fragLoadingTimeOut: timeout,
			fragLoadingMaxRetry: 1,
			progressive: true,
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
			} else {
				const fine = this.observer.check()
				if(!fine){
					hls.recoverMediaError()
					hls.startLoad()
				}
			}
		})
		this.observer = new HLSObserver(hls)
		this.observer.on('stuck', () => hls.recoverMediaError())
		this.hls = hls
		this.connect()
	}
	unload() {
		console.log('unload hls')
		if (this.hls) {
			console.log('unload hls disconnect')
			this.observer.disconnect()
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
