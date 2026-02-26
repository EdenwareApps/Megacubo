import { MediaPlayerAdapterHTML5Video } from './mediaplayer-adapter'

// Helper function to safely get HLS constants
const getHlsConstants = () => {
        if (typeof Hls === 'undefined') {
                throw new Error('Hls.js library is not loaded. Make sure hls.min.js is loaded before this module.')
        }
        return {
                ErrorTypes: Hls.ErrorTypes,
                ErrorDetails: Hls.ErrorDetails,
                Events: Hls.Events
        }
}

class MediaPlayerAdapterHTML5HLS extends MediaPlayerAdapterHTML5Video {
        constructor(container) {
                super(container)
                this.currentSrc = ''
                this.fatalErrorsCount = 0
                this.lastFatalErrorTime = 0
                this.isReloading = false
                this.isSkippingSegment = false
                
                // Monitoramento de progresso
                this.lastProgressTime = 0
                this.lastProgressValue = 0
                this.progressCheckInterval = null
                this.startMonitoringTimeout = null
                this.skipSegmentTimeout = null
                this.bufferStallCount = 0
                this.lastBufferStallTime = 0
                this.lastManifestUpdate = 0
                this.lastFragmentLoad = 0
                
                this.setup('video')
        }
        load(src, mimetype, additionalSubtitles, cookie, mediatype) {
                if (!src) {
                        console.error('Bad source', src, mimetype)
                        return
                }
                // Lazy-load hls.min.js on first use to reduce renderer OOM at startup
                if (typeof Hls === 'undefined') {
                        if (typeof window.__loadVideoLib !== 'function') {
                                this.emit('error', 'HLS library loader not available', true)
                                return
                        }
                        return window.__loadVideoLib('hls').then(() => this.load(src, mimetype, additionalSubtitles, cookie, mediatype))
                }
                
                const { ErrorTypes, ErrorDetails, Events } = getHlsConstants()
                
                this.active = true
                this._lastLevelParsingRecovery = 0
                // Reset fatal errors count on new load if enough time has passed or source changed
                const currentTime = this.time()
                const srcChanged = src !== this.currentSrc
                if (currentTime != this.lastFatalErrorTime || srcChanged) {
                        this.fatalErrorsCount = 0
                }

                // CRITICAL: Destroy existing HLS instance before creating a new one to prevent memory leaks
                if (this.hls) {
                        console.warn('HLS instance already exists, destroying before creating new one')
                        try {
                                // Remove all event listeners before destroy
                                this.hls.off(Events.ERROR)
                                this.hls.off(Events.FRAG_LOADED)
                                this.hls.off(Events.FRAG_LOADING)
                                this.hls.off(Events.MANIFEST_PARSED)
                                this.hls.off(Events.LEVEL_UPDATED)
                                this.hls.destroy()
                        } catch (e) {
                                console.error('Error destroying previous HLS instance:', e)
                        }
                        this.hls = null
                }

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
                // IMPORTANT: attachMedia() must be called BEFORE loadSource() according to hls.js best practices
                hls.attachMedia(this.object)
                hls.loadSource(this.currentSrc)
                hls.on(Events.ERROR, (event, data) => {
                        // Normalize error data structure - hls.js can pass data directly or as event.data
                        if (!data && event && typeof event === 'object') {
                                // If event is the data object itself
                                if (event.fatal !== undefined || event.type !== undefined || event.details !== undefined) {
                                        data = event
                                } else if (event.data) {
                                        data = event.data
                                }
                        }
                        
                        if (!data || typeof data !== 'object') {
                                console.warn('HLS ERROR: Invalid error data structure', { event, data })
                                return
                        }
                        
                        // Log error with sanitized data (avoid logging sensitive URLs in production)
                        const errorInfo = {
                                type: data.type,
                                details: data.details,
                                fatal: data.fatal,
                                url: data.url ? data.url.substring(0, 100) + '...' : undefined
                        }
                        console.error('HLS ERROR', errorInfo)

                        // Prevent concurrent operations that could cause memory leaks
                        // But allow critical errors even during operations
                        if (this.isReloading || this.isSkippingSegment) {
                                // Only ignore non-fatal errors during operations
                                if (!data.fatal && data.details !== 'bufferStalledError') {
                                        console.warn('HLS operation already in progress, ignoring non-critical error', this.isReloading, this.isSkippingSegment)
                                        return
                                }
                                // Fatal errors or bufferStalledError must be processed even during operations
                        }

                        if (data.details && data.frag && !data.fatal) {
                                if (data.details === 'bufferStalledError') {
                                        const now = Date.now()
                                        if (now - this.lastBufferStallTime < 5000) {
                                                this.bufferStallCount++
                                        } else {
                                                this.bufferStallCount = 1
                                        }
                                        this.lastBufferStallTime = now
                                        
                                        // If many consecutive stalls in short time, treat as fatal
                                        if (this.bufferStallCount >= 5) {
                                                console.error('HLS: Too many buffer stalls (', this.bufferStallCount, '), treating as fatal')
                                                this.emit('error', 'Buffer stalling repeatedly', true)
                                                this.setState('')
                                                this.bufferStallCount = 0
                                                return
                                        }
                                        
                                        // Tentar skip segment
                                        return this.skipSegment(data.frag)
                                }
                                
                                if (data.details === 'fragParsingError' && data.error && data.error.message && data.error.message.includes('Found no media')) {
                                        // Empty fragment - skip immediately without retry
                                        console.warn('Empty fragment detected, skipping immediately', data.frag.url)
                                        return this.skipSegment(data.frag)
                                }
                                
                                if (['fragParsingError', 'fragLoadError', 'bufferNudgeOnStall'].includes(data.details)) {
                                        // handle fragment load errors
                                        return this.skipSegment(data.frag)
                                }
                        } else if (data.fatal) {
                                const currentTime = this.time()
                                if (currentTime != this.lastFatalErrorTime) {
                                        this.fatalErrorsCount = 0
                                }
                                this.fatalErrorsCount++
                                this.lastFatalErrorTime = currentTime

                                // Limit reload attempts: 3 for initial errors, 5 for live streams, 10 for VOD
                                // Reduced from 20 to prevent OOM issues with live streams                                      
                                const isLive = this.mediatype === 'live'
                                const maxRetries = currentTime > 0 ? (isLive ? 5 : 10) : 3

                                if (this.fatalErrorsCount >= maxRetries) {
                                        console.error('HLS fatal error: max retries reached', this.fatalErrorsCount, data.type, 'isLive:', isLive)
                                        this.emit('error', 'HLS fatal error: max retries reached', true)
                                        this.setState('')
                                        return
                                }

                                // Handle levelParsingError with media sequence mismatch: try light recovery
                                // (loadSource only, without unload/destroy) to avoid full reload that
                                // turns off the player and can interfere when transmission was going well.
                                if (data.details === 'levelParsingError' && data.error &&
                                    data.error.message && data.error.message.includes('media sequence mismatch')) {
                                        const sequenceMismatchCount = this.fatalErrorsCount
                                        const now = Date.now()
                                        const lastRecovery = this._lastLevelParsingRecovery || 0
                                        const recoveryInterval = 30000

                                        if (now - lastRecovery > recoveryInterval) {
                                                // First time or 30s passed: try loadSource only (without unload/destroy)
                                                this._lastLevelParsingRecovery = now
                                                console.warn('HLS: Media sequence mismatch - trying light recovery (loadSource) instead of full reload')
                                                this.isReloading = true
                                                setImmediate(() => {
                                                        if (this.hls && this.currentSrc && this.active) {
                                                                try {
                                                                        this.hls.loadSource(this.currentSrc)
                                                                } catch (e) {
                                                                        console.warn('HLS: loadSource in light recovery failed:', e)
                                                                        this._lastLevelParsingRecovery = 0
                                                                        try {
                                                                                this.reload(() => {
                                                                                        this.fatalErrorsCount = sequenceMismatchCount
                                                                                        this.isReloading = false
                                                                                })
                                                                        } catch (reloadErr) {
                                                                                this.isReloading = false
                                                                                this.emit('error', 'Failed to reload after sequence mismatch', true)
                                                                                this.setState('')
                                                                        }
                                                                        return
                                                                }
                                                        }
                                                        setTimeout(() => { this.isReloading = false }, 2000)
                                                })   
                                        } else {
                                                // Already tried light recovery in last 30s: do full reload
                                                console.error('HLS: Media sequence mismatch - light recovery already tried, doing full reload')
                                                try {
                                                        this.isReloading = true
                                                        this.reload(() => {
                                                                this.fatalErrorsCount = sequenceMismatchCount
                                                                this.isReloading = false
                                                        })
                                                } catch (reloadError) {
                                                        console.error('HLS: Error during reload for media sequence mismatch:', reloadError)
                                                        this.isReloading = false
                                                        this.emit('error', 'Failed to reload after sequence mismatch', true)
                                                        this.setState('')
                                                }
                                        }
                                        return
                                }

                                // Handle bufferAppendError less aggressively
                                // Buffer append errors are usually transient - don't do fatal reload immediately
                                if (data.details === 'bufferAppendError') {
                                        // Only try skip segment if there's a fragment and not fatal
                                        if (data.frag && !data.fatal && !this.isSkippingSegment && !this.isReloading) {
                                                console.warn('HLS: bufferAppendError non-fatal - attempting skip segment')
                                                return this.skipSegment(data.frag)
                                        }
                                        
                                        // If fatal or no fragment, handle through switch below
                                        // (don't return here, let continue to switch handle as MEDIA_ERROR)
                                        if (data.fatal) {
                                                console.warn('HLS: bufferAppendError fatal - will be handled by switch', { 
                                                        hasFrag: !!data.frag, 
                                                        isSkipping: this.isSkippingSegment, 
                                                        isReloading: this.isReloading 
                                                })    
                                                // Don't return - let continue to switch handle
                                        } else {
                                                // If not fatal and no frag, just ignore
                                                console.warn('HLS: bufferAppendError non-fatal without frag - ignored')
                                                return
                                        }
                                }

                                switch (data.type) {
                                        case ErrorTypes.MEDIA_ERROR:
                                                console.error('HLS fatal media error encountered, reload', this.fatalErrorsCount, '/', maxRetries)
                                                const mediaErrorsCount = this.fatalErrorsCount

                                                // Only skip segment if not already reloading and skip is not in progress
                                                if (data.frag && !this.isSkippingSegment && !this.isReloading) {
                                                        // Skip segment asynchronously, then reload after a short delay
                                                        this.skipSegment(data.frag).then(() => {
                                                                // Wait a bit before reload to ensure skip completes
                                                                setTimeout(() => {
                                                                        if (!this.isReloading && this.hls && this.active) {
                                                                                try {
                                                                                        this.isReloading = true
                                                                                        this.reload(() => {
                                                                                                this.fatalErrorsCount = mediaErrorsCount
                                                                                                this.isReloading = false
                                                                                        })
                                                                                } catch (reloadError) {
                                                                                        console.error('HLS: Error during reload after skipSegment:', reloadError)
                                                                                        this.isReloading = false
                                                                                        this.emit('error', 'Failed to reload after segment skip', true)
                                                                                        this.setState('')
                                                                                }
                                                                        }
                                                                }, 200)
                                                        }).catch((skipError) => {
                                                                // If skip fails, log and proceed with reload anyway
                                                                console.warn('HLS: skipSegment failed, proceeding with reload:', skipError)
                                                                if (!this.isReloading && this.hls && this.active) {
                                                                        try {
                                                                                this.isReloading = true
                                                                                this.reload(() => {
                                                                                        this.fatalErrorsCount = mediaErrorsCount
                                                                                        this.isReloading = false
                                                                                })
                                                                        } catch (reloadError) {
                                                                                console.error('HLS: Error during reload after skipSegment failure:', reloadError)
                                                                                this.isReloading = false
                                                                                this.emit('error', 'Failed to reload after segment skip error', true)
                                                                                this.setState('')
                                                                        }
                                                                }
                                                        })
                                                } else {
                                                        // Skip segment not available or already in progress, just reload
                                                        try {
                                                                this.isReloading = true
                                                                this.reload(() => {
                                                                        this.fatalErrorsCount = mediaErrorsCount
                                                                        this.isReloading = false
                                                                })
                                                        } catch (reloadError) {
                                                                console.error('HLS: Error during reload for MEDIA_ERROR:', reloadError)
                                                                this.isReloading = false
                                                                this.emit('error', 'Failed to reload after media error', true)
                                                                this.setState('')
                                                        }
                                                }
                                                break
                                        case ErrorTypes.NETWORK_ERROR:
                                                console.error('HLS fatal network error encountered, reload', this.fatalErrorsCount, '/', maxRetries)
                                                const networkErrorsCount = this.fatalErrorsCount
                                                try {
                                                        this.isReloading = true
                                                        this.reload(() => {
                                                                this.fatalErrorsCount = networkErrorsCount
                                                                this.isReloading = false
                                                        })
                                                } catch (reloadError) {
                                                        console.error('HLS: Error during reload for NETWORK_ERROR:', reloadError)
                                                        this.isReloading = false
                                                        this.emit('error', 'Failed to reload after network error', true)
                                                        this.setState('')
                                                }
                                                break
                                        default:
                                                console.error('HLS unknown fatal error encountered, destroy')
                                                this.emit('error', 'HLS fatal error', true)
                                                break
                                }
                        }
                })
                
                // Monitor HLS events to detect real activity
                hls.on(Events.FRAG_LOADED, (event, data) => {
                        // Mark that there is download activity
                        this.lastFragmentLoad = Date.now()
                        this.bufferStallCount = 0 // Reset stall count on successful load
                })
                
                hls.on(Events.FRAG_LOADING, (event, data) => {
                        // Fragment starting to load
                        this.lastFragmentLoad = Date.now()
                })
                
                hls.on(Events.MANIFEST_PARSED, (event, data) => {
                        // Playlist atualizada
                        this.lastManifestUpdate = Date.now()
                })
                
                hls.on(Events.LEVEL_UPDATED, (event, data) => {
                        // Playlist updated (for live streams)
                        this.lastManifestUpdate = Date.now()
                })
                
                this.hls = hls
                this.connect()
                
                // Cancel previous timeout if exists
                if (this.startMonitoringTimeout) {
                        clearTimeout(this.startMonitoringTimeout)
                        this.startMonitoringTimeout = null
                }
                
                // Start progress monitoring after a delay
                this.startMonitoringTimeout = setTimeout(() => {
                        this.startMonitoringTimeout = null
                        this.startProgressMonitoring()
                }, 1000) // Wait 1s to ensure HLS started
        }
        skipSegment(frag) {
                // Prevent concurrent skip operations that could cause memory leaks
                if (this.isSkippingSegment || !this.hls) {
                        console.warn('Skip segment already in progress or HLS not available')
                        return Promise.resolve()
                }

                // Verify Hls.js is available before getting constants
                if (typeof Hls === 'undefined') {
                        console.error('Hls.js library not available in skipSegment')
                        return Promise.resolve()
                }

                // Get HLS constants safely
                const { Events } = getHlsConstants()

                this.isSkippingSegment = true
                return new Promise((resolve, reject) => {
                        let flagClearedInTimeout = false // Track if flag was scheduled for cleanup in setTimeout
                        try {
                                // Verify HLS instance still exists
                                if (!this.hls) {
                                        console.warn('HLS instance destroyed during skipSegment')
                                        this.isSkippingSegment = false
                                        resolve()
                                        return
                                }

                                const start = frag.start + frag.duration
                                
                                // Validar valores antes de pular
                                if (isNaN(start) || start <= 0 || !isFinite(start)) {
                                        console.warn('Cannot skip segment: invalid timing', { start, fragStart: frag.start, fragDuration: frag.duration })
                                        this.isSkippingSegment = false
                                        resolve()
                                        return
                                }
                                
                                if (frag.loader) {
                                        console.warn('Fix level to ' + start)
                                        frag.loader.abort()
                                        frag.loader.startPosition = start

                                        // Verify HLS instance still exists before triggering
                                        if (this.hls && typeof this.hls.trigger === 'function') {
                                                this.hls.trigger(Events.LEVEL_LOADING, {
                                                        url: frag.url
                                                })
                                                resolve()
                                        } else {
                                                console.warn('HLS instance or trigger method not available')
                                                resolve()
                                        }
                                } else {
                                        const currentTime = this.hls.media ? this.hls.media.currentTime : 0
                                        
                                        // Check if skip distance is significant (at least 0.5 seconds)
                                        // If too small, not worth skipping - can cause loop
                                        const skipDistance = Math.abs(start - currentTime)
                                        if (skipDistance < 0.5 && currentTime > 0) {
                                                console.warn('HLS: Skip distance too small (', skipDistance.toFixed(3), 's), skipping operation', {
                                                        currentTime: currentTime.toFixed(3),
                                                        targetTime: start.toFixed(3)
                                                })
                                                this.isSkippingSegment = false
                                                resolve()
                                                return
                                        }
                                        
                                        const fixPlayback = this.hls.media && currentTime >= (frag.start - 12) && currentTime < start

                                        // Log fragment info without the object
                                        const fragInfo = frag.url ? `frag: ${frag.url.split('/').pop()}` : 'unknown frag'
                                        console.warn('Skip from ' + (currentTime || 'unknown') + ' to ' + start, fragInfo, fixPlayback)

                                        // Verify HLS instance still exists before operations
                                        if (!this.hls) {
                                                console.warn('HLS instance destroyed during skipSegment operations')
                                                this.isSkippingSegment = false
                                                resolve()
                                                return
                                        }

                                        this.hls.stopLoad()
                                        if (fixPlayback && this.hls.media) {
                                                this.hls.media.currentTime = start
                                        }

                                        // Verify HLS instance still exists before startLoad
                                        if (!this.hls) {
                                                console.warn('HLS instance destroyed before startLoad')
                                                this.isSkippingSegment = false
                                                resolve()
                                                return
                                        }

                                        // DO NOT call startLoad immediately - this can cause infinite loop
                                        // Instead, use a small delay to allow stopLoad to complete
                                        // and prevent HLS from trying to reload playlist immediately
                                        flagClearedInTimeout = true // Mark that flag will be cleared in setTimeout
                                        setTimeout(() => {
                                                if (this.hls && !this.isReloading) {
                                                        this.hls.startLoad(start)
                                                }
                                                // Clear flag after an additional delay
                                                setTimeout(() => {
                                                        this.isSkippingSegment = false
                                                }, 200)
                                        }, 100)

                                        // Verify HLS instance and media still exist before play
                                        if (fixPlayback && this.hls && this.hls.media) {
                                                // Use play().catch() to handle AbortError gracefully
                                                this.hls.media.play().catch(err => {
                                                        if (err.name !== 'AbortError') {
                                                                console.error('Error playing media after skip:', err)
                                                        }
                                                })
                                        }
                                        // Flag will be cleared in setTimeout above, don't clear in finally
                                        resolve()
                                }
                        } catch (e) {
                                console.error('Error in skipSegment:', e)
                                this.isSkippingSegment = false
                                reject(e)
                        } finally {
                                // Clear flag after a short delay to allow operation to complete
                                // Only clear if not scheduled in setTimeout above (frag.loader case)
                                // Cancel previous timeout if exists
                                if (this.skipSegmentTimeout) {
                                        clearTimeout(this.skipSegmentTimeout)
                                }
                                // Only clear here if not in else path (which already has its own setTimeout)
                                // or if error occurred in frag.loader path
                                if (!flagClearedInTimeout) {
                                        this.skipSegmentTimeout = setTimeout(() => {
                                                this.skipSegmentTimeout = null
                                                this.isSkippingSegment = false
                                        }, 100)
                                }
                        }
                })
        }
        startProgressMonitoring() {
                if (this.progressCheckInterval) return
                
                // Wait a bit more to ensure hls is ready
                if (!this.hls || !this.hls.media) {
                        // Cancel previous timeout if exists
                        if (this.startMonitoringTimeout) {
                                clearTimeout(this.startMonitoringTimeout)
                                this.startMonitoringTimeout = null
                        }
                        // Try again after 500ms
                        this.startMonitoringTimeout = setTimeout(() => {
                                this.startMonitoringTimeout = null
                                this.startProgressMonitoring()
                        }, 500)
                        return
                }
                
                this.lastProgressTime = Date.now()
                this.lastProgressValue = this.hls.media.currentTime || 0
                
                this.progressCheckInterval = setInterval(() => {
                        // Stricter checks to avoid memory leaks
                        if (!this.active || !this.hls || !this.hls.media || !this.hls.media.parentNode) {
                                this.stopProgressMonitoring()
                                return
                        }
                        
                        const now = Date.now()
                        const currentTime = this.hls.media.currentTime
                        const timeSinceLastProgress = now - this.lastProgressTime
                        const timeSinceLastFragment = now - this.lastFragmentLoad
                        const timeSinceLastManifest = now - this.lastManifestUpdate
                        
                        // If in loading state but no progress for more than 20s
                        if (this.state === 'loading') {
                                const noProgress = Math.abs(currentTime - this.lastProgressValue) < 0.1
                                // Check if received any fragment before considering inactivity
                                const noFragmentActivity = this.lastFragmentLoad > 0 && timeSinceLastFragment > 20000
                                const isLive = this.mediatype === 'live'
                                
                                // For live streams, check if playlist is being updated
                                // Only check if already received at least one manifest update
                                if (isLive && this.lastManifestUpdate > 0 && timeSinceLastManifest > 30000) {
                                        console.warn('HLS: Playlist stale, no updates for', Math.round(timeSinceLastManifest/1000), 's')
                                        // Treat as fatal error if playlist doesn't update for too long
                                        if (timeSinceLastManifest > 60000) {
                                                console.error('HLS: Playlist stale for too long, treating as error')
                                                this.emit('error', 'Playlist stopped updating', true)
                                                this.setState('')
                                                return
                                        }
                                }
                                
                                // If no progress and no fragment activity for more than 20s
                                if (noProgress && noFragmentActivity && timeSinceLastProgress > 20000) {
                                        console.warn('HLS: No playback progress and no fragment activity for', Math.round(timeSinceLastProgress/1000), 's')
                                        // If already tried loading but no activity, might be stuck stream
                                        if (timeSinceLastProgress > 30000) {
                                                console.error('HLS: Playback stalled, no progress detected')
                                                if (!this.isReloading && !this.isSkippingSegment && this.active && this.hls) {
                                                        // Tentar reload uma vez
                                                        try {
                                                                this.isReloading = true
                                                                this.reload(() => {
                                                                        this.isReloading = false
                                                                })
                                                        } catch (reloadError) {
                                                                console.error('HLS: Error during reload for stalled playback:', reloadError)
                                                                this.isReloading = false
                                                                this.emit('error', 'Playback stalled and reload failed', true)
                                                                this.setState('')
                                                        }
                                                }
                                        }
                                }
                        }
                        
                        // Update values
                        if (Math.abs(currentTime - this.lastProgressValue) >= 0.1) {
                                this.lastProgressTime = now
                                this.lastProgressValue = currentTime
                                // Reset buffer stall count when there's real progress
                                if (this.bufferStallCount > 0) {
                                        this.bufferStallCount = 0
                                }
                        }
                }, 2000) // Check every 2 seconds
        }
        stopProgressMonitoring() {
                if (this.progressCheckInterval) {
                        clearInterval(this.progressCheckInterval)
                        this.progressCheckInterval = null
                }
        }
        unload() {
                console.log('unload hls')
                
                // Cancel monitoring initialization timeout
                if (this.startMonitoringTimeout) {
                        clearTimeout(this.startMonitoringTimeout)
                        this.startMonitoringTimeout = null
                }
                
                // Cancel skipSegment timeout
                if (this.skipSegmentTimeout) {
                        clearTimeout(this.skipSegmentTimeout)
                        this.skipSegmentTimeout = null
                }
                
                // Clear monitoring
                this.stopProgressMonitoring()
                
                // Clear operation flags to prevent stuck states
                this.isReloading = false
                this.isSkippingSegment = false
                this.bufferStallCount = 0
                this.lastFragmentLoad = 0
                this.lastManifestUpdate = 0

                if (this.hls) {
                        console.log('unload hls disconnect')
                        try {
                                // Verify Hls.js is available before cleanup
                                if (typeof Hls !== 'undefined') {
                                        // Get HLS constants safely
                                        const { Events } = getHlsConstants()
                                        // Remove event listeners before destroy
                                        this.hls.off(Events.ERROR)
                                        this.hls.off(Events.FRAG_LOADED)
                                        this.hls.off(Events.FRAG_LOADING)
                                        this.hls.off(Events.MANIFEST_PARSED)
                                        this.hls.off(Events.LEVEL_UPDATED)
                                        // Detach media element before destroy (best practice)
                                        if (typeof this.hls.detachMedia === 'function') {
                                                this.hls.detachMedia()
                                        }
                                }
                                this.hls.destroy()
                        } catch (e) {
                                console.error('Error destroying HLS in unload:', e)
                        }
                        this.hls = null
                        this.object.src = ''
                        console.log('unload hls super.unload')
                        super.unload()
                        console.log('unload hls OK')
                }
                // Don't reset fatalErrorsCount here - it should persist across reloads                                                                         
        }
        destroy() {
                console.log('hls destroy')
                this.unload()
                super.destroy()
        }
}

export default MediaPlayerAdapterHTML5HLS
