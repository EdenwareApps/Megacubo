import {MediaPlayerAdapterHTML5Video} from './mediaplayer-adapter'

// Helper function to safely check if mpegts.js is available
const isMpegtsAvailable = () => {
        return typeof mpegts !== 'undefined' && typeof mpegts.createPlayer === 'function'
}

class MediaPlayerAdapterHTML5TS extends MediaPlayerAdapterHTML5Video {
	constructor(container){
		super(container)
		this.currentSrc = ''
		this.isReloading = false
		this.isHandlingError = false
		this.errorsCount = 0
		this.lastErrorTime = 0
        this.setup('video')
    }
	load(src, mimetype, additionalSubtitles, cookie, mediatype){
		if(!src){
			console.error('Bad source', src, mimetype)
			return
		}
		// Lazy-load mpegts.js on first use to reduce renderer OOM at startup
		if (!isMpegtsAvailable()) {
			if (typeof window.__loadVideoLib !== 'function') {
				this.emit('error', 'MPEGTS library loader not available', true)
				return
			}
			return window.__loadVideoLib('mpegts').then(() => this.load(src, mimetype, additionalSubtitles, cookie, mediatype))
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
		
		try {
			this.mpegts = mpegts.createPlayer({
				type: 'mse', // could be mse, mpegts, m2ts, flv
				url: this.currentSrc,
				isLive: mediatype != 'video'
			}, {
				lazyLoad: false,
				enableWorker: true,
				autoCleanupSourceBuffer: true
			})
			
			if (!this.mpegts) {
				throw new Error('Failed to create MPEGTS player')
			}
			
			this.mpegts.attachMediaElement(this.object)
		} catch (createError) {
			console.error('Error creating MPEGTS player:', createError)
			this.emit('error', 'Failed to create MPEGTS player', true)
			this.setState('')
			return
		}
		
		// Create error listener function
		this.errorListener = err => {
			// Prevent concurrent error handling that could cause memory leaks
			if (this.isReloading || this.isHandlingError) {
				console.warn('MPEGTS operation already in progress, ignoring error', this.isReloading, this.isHandlingError)
				return
			}
			
			// Verify mpegts instance still exists
			if (!this.mpegts || !this.active) {
				console.warn('MPEGTS instance destroyed or inactive, ignoring error')
				return
			}
			
			const t = this.time()
			if(t != this.lastErrorTime) {
				this.errorsCount = 0
			}
			this.errorsCount++
			
			// Use this.mediatype instead of mediatype from closure
			const isLive = this.mediatype === 'live'
			const maxRetries = t > 0 ? (isLive ? 5 : 10) : 3
			
			console.error('MPEGTS ERROR', err, this.errorsCount, '/', maxRetries, 'isLive:', isLive)
			
			if(this.errorsCount >= maxRetries){
				console.error('MPEGTS: Max retries reached, giving up')
				this.emit('error', String(err), true)
				this.setState('')
				this.emit('state', '')
				this.isHandlingError = false
			} else {
				const c = this.errorsCount // load() may reset the counter
				this.isHandlingError = true
				
				// Use async function to properly handle recovery operations
				const performRecovery = async () => {
					try {
						// Verify instance still exists before operations
						if (!this.mpegts || !this.active) {
							console.warn('MPEGTS: Instance destroyed during recovery, aborting')
							return
						}
						
						// If video element has error, recycle it
						if(this.object && this.object.error && this.mpegts){
							try {
								this.mpegts.detachMediaElement()
								console.warn('!! RENEWING VIDEO OBJECT')
								if (typeof this.recycle === 'function') {
									this.recycle()
								} else {
									console.warn('MPEGTS: recycle() method not available')
								}
								if (this.mpegts && this.object && this.active) {
									this.mpegts.attachMediaElement(this.object)
								}
							} catch (recycleError) {
								console.error('MPEGTS: Error during video element recycle:', recycleError)
								// Continue with recovery even if recycle fails
							}
						}
						
						// Verify instance still exists after recycle
						if (!this.mpegts || !this.active) {
							console.warn('MPEGTS: Instance destroyed after recycle, aborting')
							return
						}
						
						// Reload the stream
						this.mpegts.unload()
						this.mpegts.load()
						
						// Play with proper error handling
						await this.mpegts.play().catch(playError => {
							// AbortError and NotAllowedError are expected
							if (playError.name !== 'AbortError' && playError.name !== 'NotAllowedError') {
								console.warn('MPEGTS: Error playing after error recovery:', playError)
								throw playError // Re-throw to be caught by outer catch
							}
						})
						
						this.errorsCount = c
					} catch (recoveryError) {
						console.error('MPEGTS: Error during error recovery:', recoveryError)
						// If recovery fails, try using reload() method as fallback
						if (this.active && typeof this.reload === 'function') {
							try {
								this.isReloading = true
								this.reload(() => {
									this.errorsCount = c
									this.isReloading = false
									this.isHandlingError = false
								})
								return // Exit early, reload will handle cleanup
							} catch (reloadError) {
								console.error('MPEGTS: Error during reload fallback:', reloadError)
								this.emit('error', 'Error recovery and reload failed', true)
								this.setState('')
							}
						} else {
							this.emit('error', 'Error recovery failed', true)
							this.setState('')
						}
					} finally {
						// Clear flag after a delay to allow operations to complete
						setTimeout(() => {
							this.isHandlingError = false
						}, 100)
					}
				}
				
				// Execute recovery asynchronously
				performRecovery().catch(finalError => {
					console.error('MPEGTS: Unexpected error in recovery process:', finalError)
					this.isHandlingError = false
				})
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
			if(this.object && this.object.error && !this.isHandlingError && this.mpegts && this.active){
				this.isHandlingError = true
				
				// Use async function for proper error handling
				const handleVideoError = async () => {
					try {
						// Verify instance still exists
						if (!this.mpegts || !this.active) {
							console.warn('MPEGTS: Instance destroyed during video error handling')
							return
						}
						
						this.mpegts.detachMediaElement()
						console.warn('!! RENEWING VIDEO OBJECT')
						
						if (typeof this.recycle === 'function') {
							this.recycle()
						} else {
							console.warn('MPEGTS: recycle() method not available')
						}
						
						// Verify instance still exists after recycle
						if (this.mpegts && this.object && this.active) {
							this.mpegts.attachMediaElement(this.object)
							await this.mpegts.play().catch(playError => {
								if (playError.name !== 'AbortError' && playError.name !== 'NotAllowedError') {
									console.warn('MPEGTS: Error playing after video element error:', playError)
								}
							})
						}
					} catch (e) {
						console.error('Error handling video element error:', e)
						// If video error recovery fails, try reload as fallback
						if (this.active && typeof this.reload === 'function') {
							try {
								this.isReloading = true
								this.reload(() => {
									this.isReloading = false
								})
							} catch (reloadError) {
								console.error('MPEGTS: Error during reload after video error:', reloadError)
								this.emit('error', 'Video error recovery failed', true)
								this.setState('')
							}
						}
					} finally {
						setTimeout(() => {
							this.isHandlingError = false
						}, 100)
					}
				}
				
				handleVideoError().catch(finalError => {
					console.error('MPEGTS: Unexpected error in video error handler:', finalError)
					this.isHandlingError = false
				})
			}
		})
		
		try {
			this.mpegts.on(mpegts.Events.ERROR, this.errorListener)
			// Load and play the stream
			this.mpegts.load()
			this.mpegts.play().catch(playError => {
				// AbortError and NotAllowedError are expected (user pause, autoplay restrictions)
				if (playError.name !== 'AbortError' && playError.name !== 'NotAllowedError') {
					console.warn('MPEGTS: Error during initial play:', playError)
				}
			})
			mpegts.LoggingControl.addLogListener(this.logListener)
		} catch (initError) {
			console.error('Error initializing MPEGTS player:', initError)
			this.emit('error', 'Failed to initialize MPEGTS player', true)
			this.setState('')
			return
		}
		
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
			if (isMpegtsAvailable()) {
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
			}
			
			try {
				this.mpegts.unload()
				this.mpegts.detachMediaElement()
			} catch (e) {
				console.error('Error unloading/detaching mpegts:', e)
			}
			
			// CRITICAL: Properly destroy the mpegts instance
			try {
				this.mpegts.destroy()
			} catch(e) {
				console.error('Error destroying mpegts:', e)
			}
			
			this.mpegts = null
			this.errorListener = null
			this.logListener = null
			if (this.object) {
				this.object.src = ''
			}
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
