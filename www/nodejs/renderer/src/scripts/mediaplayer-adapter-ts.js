import {MediaPlayerAdapterHTML5Video} from './mediaplayer-adapter'

class MediaPlayerAdapterHTML5TS extends MediaPlayerAdapterHTML5Video {
	constructor(container){
		super(container)
		this.currentSrc = ''
		this.isReloading = false
		this.isHandlingError = false
        this.setup('video')
    }
	load(src, mimetype, additionalSubtitles, cookie, mediatype){
		if(!src){
			console.error('Bad source', src, mimetype)
			return
		}
		this.active = true
		
		// CRITICAL: Destroy existing mpegts instance before creating a new one to prevent memory leaks
		if (this.mpegts) {
			console.warn('MPEGTS instance already exists, destroying before creating new one')
			try {
				if (this.errorListener) {
					this.mpegts.off(mpegts.Events.ERROR, this.errorListener)
				}
				if (this.logListener) {
					mpegts.LoggingControl.removeLogListener(this.logListener)
				}
				this.mpegts.detachMediaElement()
				this.mpegts.unload()
				this.mpegts.destroy()
			} catch (e) {
				console.error('Error destroying previous MPEGTS instance:', e)
			}
			this.mpegts = null
			this.errorListener = null
			this.logListener = null
		}
		
		this.setVars(src, mimetype, additionalSubtitles, cookie, mediatype)                                                                             
        this.mpegts = mpegts.createPlayer({
            type: 'mse', // could be mse, mpegts, m2ts, flv
            url: this.currentSrc,
            isLive: mediatype != 'video'
		}, {
            lazyLoad: false,
            enableWorker: true,
            autoCleanupSourceBuffer: true
        })
        this.mpegts.attachMediaElement(this.object)
		
		// Create error listener function
		this.errorListener = err => {
			// Prevent concurrent error handling that could cause memory leaks
			if (this.isReloading || this.isHandlingError) {
				console.warn('MPEGTS operation already in progress, ignoring error', this.isReloading, this.isHandlingError)
				return
			}
			
			const t = this.time()
			if(t != this.lastErrorTime) {
				this.errorsCount = 0
			}
			this.errorsCount++
            console.error('MPEGTS ERROR', err, this.errorsCount, t != this.lastErrorTime)
			if(this.errorsCount >= (t > 0 ? (mediatype === 'live' ? 5 : 10) : 3)){
				this.emit('error', String(err), true)
				this.state = ''
				this.emit('state', '')
			} else {
				const c = this.errorsCount // load() may reset the counter
				this.isHandlingError = true
				if(this.object.error){					
					this.mpegts.detachMediaElement()
					console.warn('!! RENEWING VIDEO OBJECT')
					this.recycle()
					this.mpegts.attachMediaElement(this.object)
				}
				this.mpegts.unload()
				this.mpegts.load()
				this.mpegts.play()
				this.errorsCount = c
				setTimeout(() => {
					this.isHandlingError = false
				}, 100)
			}
			this.lastErrorTime = t
        }
		
		// Create log listener function
		this.logListener = (type, message) => {
			const msg = String(message)
			
			// Filter repetitive messages about dropping audio frames with DTS overlap
			// These messages are expected and already handled automatically by MP4Remuxer
			// Logging them repeatedly can cause log saturation and potential OOM crashes
			if (msg.includes('Dropping') && msg.includes('dtsCorrection') && msg.includes('overlap')) {
				// Don't log - MP4Remuxer is already handling this correctly by dropping frames
				return
			}
			
			// Keep important error messages
			if (msg.includes('sync_byte')) {
				this.errorListener(message)
			}
		}
		
		const v = this.object
		v.addEventListener('error', err => {
			if(this.object.error && !this.isHandlingError){
				this.isHandlingError = true
				try {
					this.mpegts.detachMediaElement()
					console.warn('!! RENEWING VIDEO OBJECT')
					this.recycle()
					this.mpegts.attachMediaElement(this.object)
					this.mpegts.play()
				} catch (e) {
					console.error('Error handling video element error:', e)
				} finally {
					setTimeout(() => {
						this.isHandlingError = false
					}, 100)
				}
			}
		})
        this.mpegts.on(mpegts.Events.ERROR, this.errorListener)
        this.mpegts.unload()
        this.mpegts.load()
        this.mpegts.play()
		mpegts.LoggingControl.addLogListener(this.logListener)
		this.connect()
	}
	unload(){
		console.log('unload ts')
		// Clear operation flags to prevent stuck states
		this.isReloading = false
		this.isHandlingError = false
		
		if(this.mpegts){
			console.log('unload ts disconnect')
			this.disconnect()
			
			// CRITICAL: Properly remove listeners before destroying
			try {
				if (this.errorListener) {
					this.mpegts.off(mpegts.Events.ERROR, this.errorListener)
				}
				if (this.logListener) {
					mpegts.LoggingControl.removeLogListener(this.logListener)
				}
			} catch (e) {
				console.error('Error removing listeners:', e)
			}
			
            this.mpegts.unload()
			this.mpegts.detachMediaElement()
			
			// CRITICAL: Properly destroy the mpegts instance
			try {
				this.mpegts.destroy()
			} catch(e) {
				console.error('Error destroying mpegts:', e)
			}
			
            if(this.logListener){
				mpegts.LoggingControl.removeLogListener(this.logListener)
				delete this.logListener
			}
			this.mpegts = null
			this.errorListener = null
			this.object.src = ''
			console.log('unload ts super.unload')
			super.unload()
			console.log('unload ts OK')
		}
	}
    destroy(){
		console.log('ts destroy')
		this.unload()
		super.destroy()
    }
}

export default MediaPlayerAdapterHTML5TS
