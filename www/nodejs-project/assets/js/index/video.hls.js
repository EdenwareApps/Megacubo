

class VideoControlAdapterHTML5HLS extends VideoControlAdapterHTML5Video {
	constructor(container){
		super(container)
        this.recoverDecodingErrorDate = null
		this.recoverSwapAudioCodecDate = null
		this.currentSrc = ''
        this.on('stop', () => {
            this.recoverDecodingErrorDate = null
			this.recoverSwapAudioCodecDate = null
			console.log('onstop')
			try{ // due to some nightmare errors crashing nwjs
				this.hls.destroy()
				this.hls = null
			}catch(e){
				console.error(e)
			}
        })
        this.setup('video')
    }
    recover(){
        let duration = this.object.duration, currentTime = this.object.currentTime, solved = false, skipSecs = 1
        if(duration > (currentTime + skipSecs)){
            $(this.object).one('playing play', () => {
				solved = true
				if(this.active){
					console.warn('RECOVER', currentTime, skipSecs)
					this.object.currentTime = currentTime + skipSecs
				}
            })
        }
        this.hls.recoverMediaError()
		setTimeout(() => {
			if(this.object.paused){
				this.resume()
			}
		}, 500)
    }
    handleMediaError(data) {
		if(!this.active) return
        let msg = '', now = performance.now()
        if (!this.recoverDecodingErrorDate || (now - this.recoverDecodingErrorDate) > 3000) {
            this.recoverDecodingErrorDate = now
            msg = 'trying to recover from media Error...'
            this.recover()
        } else {
            /* 
            https://github.com/video-dev/hls.js/blob/master/docs/API.md
            the workflow should be:
            on First Media Error : call hls.recoverMediaError()
            if another Media Error is raised 'quickly' after this first Media Error : first call hls.swapAudioCodec(), then call hls.recoverMediaError().
            */
            if (!this.recoverSwapAudioCodecDate || (now - this.recoverSwapAudioCodecDate) > 3000) { // 
                this.recoverSwapAudioCodecDate = now
                msg = 'trying to swap Audio Codec and recover from mediaError...'
                this.hls.swapAudioCodec()
                this.recover()
            } else {
                msg = 'fatal video error'
                this.emit('error', this.prepareErrorDataStr(data), true)
            }
        }
        console.warn(msg)
    }	
    handleNetworkError(data, force) {	
		if(!this.active) return
		if(force === true || (!isNaN(this.object.duration) && this.object.duration)) {
			let offset = this.object.duration - this.object.currentTime
			this.hls.stopLoad()
			this.hls.detachMedia(this.object)
			setTimeout(() => {
				console.warn('trying to recover from network Error...', this.active)
				if(this.active){
					const loadListener = () => {
						this.object.removeEventListener('loadedmetadata', loadListener)
						let time = this.object.duration - offset
						if(time < 0 || isNaN(time)){
							time = 0
						}
						this.object.currentTime = time
						this.resume()
					}
					this.object.addEventListener('loadedmetadata', loadListener)
					this.hls.attachMedia(this.object)
					this.hls.startLoad() // ffmpeg/server slow response
					try{
						this.object.load()
					}catch(e){
						console.error('PLAYER OBJECT LOAD ERROR', e)
					}
				}
			}, 0)
		} else {
			let msg = 'fatal video error'
			console.error(msg, this.object.duration)
			this.emit('error', this.prepareErrorDataStr(data), true)
			this.state = ''
			this.emit('state', '')
		}
		/*
		if(force === true || (!isNaN(this.object.duration) && this.object.duration)) {
			console.warn('trying to recover from network Error...')
			this.hls.startLoad()
		} else {
			let msg = 'fatal video error'
			console.error(msg, this.object.duration)
			this.emit('error', this.prepareErrorDataStr(data), true)
			this.state = ''
			this.emit('state', '')
		}
		*/
    }
    prepareErrorData(data){
        return {
			type: data.type || 'playback', 
			details: this.prepareErrorDataStr(data)
		}
    }
    prepareErrorDataStr(data){
        if(typeof(data) != 'string' && data.details){
			if(data.err){
				let err = String(data.err)
				if(err){
					return err
				}
			}
			return data.details
		} else {
			return String(data)
		}
    }
	currentFragment(){
		let current, currentTime = this.object.currentTime
		let fragments = Object.values(this.hls.streamController.fragmentTracker.fragments).map(f => f.body)
		fragments.some(fragment => {
			if(fragment.start <= currentTime && (fragment.start + fragment.duration) >= currentTime){
				current = fragment // dont trust on .end, sometimes it's empty
			}
		})
		return current
	}
	time(s){
		if(typeof(s) == 'number'){
			//this.hls.stopLoad()
			this.object.currentTime = s
			//setTimeout(() => this.hls.startLoad(), 10)
		}
		return this.object.currentTime
	}
	skipFragment(fragStart, fragDuration){
		let minHLSWindow = 6
		if(typeof(fragStart) != 'number'){
			let current = this.currentFragment()
			if(!current){
				console.log('Cannot skip fragment, not found in tracker')
				return
			}
			fragStart = current.start
			fragDuration = current.duration
		}
		let newCurrentTime = fragStart + fragDuration
		if(newCurrentTime > this.object.currentTime && newCurrentTime < (this.object.duration + minHLSWindow)){
			console.log('Skipping fragment, from '+ this.object.currentTime +' to '+ newCurrentTime)
			this.time(newCurrentTime)
			$(this.object).one('playing', () => {
				if(this.object.currentTime < newCurrentTime){
					this.object.currentTime = newCurrentTime
				}
				console.log('Current time after nudging is '+ this.object.currentTime)
			})
			return true
		} else {
			console.log('Could not skip fragment', this.object.currentTime, newCurrentTime, this.object.duration)
		}
		setTimeout(() => {
			if(this.object.paused) this.resume()
		}, 500)
	}
	watchRecovery(ms){
		if(this.watchRecoveryTimer) clearTimeout(this.watchRecoveryTimer)
		if(this.object.networkState == 2 && this.object.readyState <= 2){ // readyState may be 1 too
			this.watchRecoveryTimer = setTimeout(() => {
				if(this.object.networkState == 2 && this.object.readyState <= 2){
					console.log('playback hanged, reskip')
					this.skipFragment()
				}
			}, ms || 5000)
		}
	}
	/*
	skip(){
		if(this.object.readyState >= 3) return
		let time = parseFloat(this.object.currentTime), fragments = Object.values(this.hls.streamController.fragmentTracker.fragments)
		let skipped = fragments.some(frag => { // try to skip to next buffered fragment
			if(parseInt(frag.body.start) > time && frag.buffered){ // parseInt required due to floating precision diff
				console.log('playback skipped from '+ time +' to '+ frag.body.start +' to prevent stalling**')
				this.object.currentTime = frag.body.start
				return true
			}
		})
		if(!skipped){
			skipped = fragments.some(frag => { // try to skip to next fragment
				if(parseInt(frag.body.start) > time){ // parseInt required due to floating precision diff
					console.log('playback skipped from '+ time +' to '+ frag.body.start +' to prevent stalling*')
					this.object.currentTime = frag.body.start
					return true
				}
			})
		}
		if(!skipped){
			// try to skip by time
			let secs
			if(this.object.duration > this.object.currentTime){
				secs = (this.object.duration - this.object.currentTime) / 10
			} else {
				secs = this.fragDuration()
			}
			console.log('playback skipped from '+ time +' to '+ (time + secs) +' to prevent stalling')
			this.object.currentTime = (time + secs)
		}
		this.hls.startLoad()
		setTimeout(() => {
			if(this.object.networkState == 2 && this.object.readyState == 2){
				console.log('playback hanged, reskip')
				this.skip()
			}
		}, 5000)
		return skipped
	}
	*/
	fragmentDuration(){
		let min = 0, fragments = Object.values(this.hls.streamController.fragmentTracker.fragments)
		fragments.forEach(frag => {
			if(frag.duration && (!min || frag.duration < min)){
				min = frag.duration
			}
		})
		if(min < 2){
			min = 2
		}
		return min
	}
	nudge(from){
		if(!from){
			from = this.object.currentTime
		}
		let newCurrentTime = from + 0.1, maxNewCurrentTime = this.object.duration - 2
		if(newCurrentTime > maxNewCurrentTime){
			newCurrentTime = maxNewCurrentTime
		}
		console.log('Nudging from '+ this.object.currentTime +' to '+ newCurrentTime)
		this.object.currentTime = newCurrentTime
		$(this.object).one('playing', () => {
			if(this.object.currentTime < (newCurrentTime - 1)){
				this.nudge(newCurrentTime) // the new nudge will add 0.1s, this is expected
			}
		})
		this.watchRecovery(1000)
	}
    loadHLS(cb){
		if(!this.hls){
			const atts = {
				enableWorker: true,
				maxBufferSize: 128 * (1000 * 1000), // When doing internal transcoding with low crf, fragments will become bigger
				backBufferLength: config['live-window-time'],
				maxBufferLength: 60,
				maxMaxBufferLength: 180,
				highBufferWatchdogPeriod: 1,
				nudgeMaxRetry: Number.MAX_SAFE_INTEGER,
				lowLatencyMode: false, // setting false here reduced dramatically the buffer stalled errors on a m3u8 from FFmpeg
				fragLoadingMaxRetry: 3,
				fragLoadingMaxRetryTimeout: 3000,
				manifestLoadingMaxRetryTimeout: 3000,
				levelLoadingMaxRetryTimeout: 3000,
				fragLoadingRetryDelay: 100,
				defaultAudioCodec: 'mp4a.40.2', // AAC-LC from ffmpeg
				/*
				// https://github.com/video-dev/hls.js/blob/master/docs/API.md
				defaultAudioCodec: 'mp4a.40.2',
				debug: true,
				progressive: true,
				lowLatencyMode: false,
				enableSoftwareAES: false,
				maxSeekHole: 30,
				maxBufferSize: 20 * (1000 * 1000),
				maxBufferHole: 10,
				maxBufferLength: 10,
				maxMaxBufferLength: '120s',
				maxFragLookUpTolerance: 0.04,
				startPosition: 0,
				*/
			}
			if(this.engineType == 'video'){ // not "live"
				atts.startPosition = 0
				atts.liveSyncDuration = 99999999
			} else { // Illegal hls.js config: don't mix up liveSyncDurationCount/liveMaxLatencyDurationCount and liveSyncDuration/liveMaxLatencyDuration
				atts.liveSyncDurationCount = 3 // https://github.com/video-dev/hls.js/issues/3764
				atts.liveMaxLatencyDurationCount = Infinity
			}
			this.hls = new Hls(atts)
			this.engineType
			this.hls.on(Hls.Events.ERROR, (event, data) => {
				if(!this.active) return
				console.error('hlserr', data, data.fatal)
				if (data.fatal) {
					let forceNetworkRecover
					if(data.type == Hls.ErrorTypes.OTHER_ERROR && event == 'demuxerWorker'){
						// Uncaught RangeError: byte length of Int32Array should be a multiple of 4
						data.type = Hls.ErrorTypes.NETWORK_ERROR
						forceNetworkRecover = true
					}
					switch (data.type) {
						case Hls.ErrorTypes.MEDIA_ERROR:
							console.error('media error', data.details)
							if(data.details == 'manifestIncompatibleCodecsError'){
								this.emit('request-transcode')
							} else {
								this.handleMediaError(data)
							}
							break
						case Hls.ErrorTypes.NETWORK_ERROR:
							console.error('network error', data.networkDetails)
							this.handleNetworkError(data, forceNetworkRecover)
							break
						default:
							console.error('unrecoverable error', data.details)
							this.emit('error', this.prepareErrorDataStr(data), true)
							break
					}
				} else {
					switch(data.details){
						case Hls.ErrorDetails.MANIFEST_LOAD_ERROR:
							try {
								console.error('Cannot load', data.context.url, url, 'HTTP response code:', data.response.code, data.response.text)
								if(data.response.code === 0){
									console.error('This might be a CORS issue');
								}
							} catch(err) {
								console.error('Cannot load <a href="' + data.context.url + '">' + url + '</a><br>Response body: ' + data.response.text);
							}
							break
						case Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT:
							console.error('Timeout while loading manifest')
							break
						case Hls.ErrorDetails.MANIFEST_PARSING_ERROR:
							console.error('Error while parsing manifest:' + data.reason)
							break
						case Hls.ErrorDetails.LEVEL_LOAD_ERROR:
							console.error('Error while loading level playlist')
							break
						case Hls.ErrorDetails.LEVEL_LOAD_TIMEOUT:
							console.error('Timeout while loading level playlist')
							break
						case Hls.ErrorDetails.LEVEL_SWITCH_ERROR:
							console.error('Error while trying to switch to level ' + data.level)
							break
						case Hls.ErrorDetails.FRAG_LOAD_ERROR:
							console.error('Error while loading fragment ' + data.frag.url, data.frag.start, data.frag.duration)
							this.skipFragment(data.frag.start, data.frag.duration)
							break
						case Hls.ErrorDetails.FRAG_LOAD_TIMEOUT:
							console.error('Timeout while loading fragment ' + data.frag.url, data.frag.start, data.frag.duration)
							this.skipFragment(data.frag.start, data.frag.duration)
							break
						case Hls.ErrorDetails.FRAG_LOOP_LOADING_ERROR:
							console.error('Fragment-loop loading error')
							break
						case Hls.ErrorDetails.FRAG_DECRYPT_ERROR:
							console.error('Decrypting error:' + data.reason)
							break
						case Hls.ErrorDetails.FRAG_PARSING_ERROR:
							console.error('Parsing error:' + data.reason, data.frag)
							//this.skipFragment(data.frag.start, data.frag.duration)
							break
						case Hls.ErrorDetails.KEY_LOAD_ERROR:
							if(this.object.currentTime){
								console.error('Error while loading key ' + data.frag.decryptdata.uri)
							} else {
								this.emit('error', 'key load error', true)
							}
							break
						case Hls.ErrorDetails.KEY_LOAD_TIMEOUT:
							if(this.object.currentTime){
								console.error('Timeout while loading key ' + data.frag.decryptdata.uri)
							} else {
								this.emit('error', 'key load timeout', true)
							}
							break
						case Hls.ErrorDetails.BUFFER_APPEND_ERROR:
							let errStr = this.prepareErrorDataStr(data)
							console.error('Buffer append error', errStr)
							// it happens when handleNetworkError is in progress, ignore
							if(errStr.indexOf('This SourceBuffer has been removed') != -1){
								this.hls.recoverMediaError()
							}
							break
						case Hls.ErrorDetails.BUFFER_FULL_ERROR:
							console.error('Buffer full error')
							// it happens when segments are bigger
							this.hls.recoverMediaError()
							break
						case Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR:
							console.error('Buffer add codec error for ' + data.mimeType + (data.err ? ':' + data.err.message : ''))
							break
						case Hls.ErrorDetails.BUFFER_APPENDING_ERROR:
							console.error('Buffer appending error', parseInt(this.object.duration))
							this.hls.attachMedia(this.object)
							break
						case Hls.ErrorDetails.BUFFER_SEEK_OVER_HOLE_ERROR:
							console.error('Buffer seek over hole error', parseInt(this.object.duration))
							this.watchRecovery()
							break
						case Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL_ERROR:
							console.error('Buffer nudge on stall error', parseInt(this.object.duration))
							this.watchRecovery(200)
							break
						case Hls.ErrorDetails.BUFFER_STALLED_ERROR:
							console.error('Buffer stalled error', parseInt(this.object.duration))
							this.watchRecovery()
							/*
							if(this.object.buffered.length){
								// https://github.com/video-dev/hls.js/issues/3905
								const start = this.object.buffered.start(0)
							 	if(this.object.currentTime < start){
									console.log('fixed by seeking from', this.object.currentTime, 'to', start)
									this.object.currentTime = start
									return
								}
							}
							// not fatal, would not be needed to handle, BUT, the playback hangs even it not saying that it's a fatal error, so call handleNetworkError() to ensure
							let time = this.object.currentTime, duration = this.object.duration			
							if((duration - time) > config['live-window-time']){
								this.hls.stopLoad()
								let averageLoadTime = 5
								console.log('out of live window', time, duration, config)
								time = (duration - config['live-window-time']) + averageLoadTime
								if(time < 0){
									time = 0
								}
								this.object.currentTime = time
								this.hls.startLoad()
							} else if((duration - time) < 1){
								console.log('out of buffer, trust on hls.js', time, duration, config)
								this.hls.startLoad()
							} else {
								console.log('in live window, trust on hls.js', time, duration, config)
								this.hls.startLoad()
							}
							*/
							break
						case Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL:
							console.warn('Buffer nudge on stall', parseInt(this.object.duration))
							this.watchRecovery(1000)
							break
						default:
							console.error('Hls.js unknown error', data.type, data.details)
							break
					}
				}
			})
			this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
				this.resume()
				this.emit('audioTracks', this.audioTracks())
				this.emit('subtitleTracks', this.subtitleTracks())
			})
			this.hls.attachMedia(this.object)
		}
		cb()
	}	
	audioTracks(){
		return this.formatTracks(this.hls.audioTracks, this.hls.audioTrack)
	}
	audioTrack(trackId){
		this.hls.audioTrack = trackId
	}
	subtitleTracks(){
		return this.formatTracks(this.hls.subtitleTracks, this.hls.subtitleTrack)
	}
	subtitleTrack(trackId){
		this.hls.subtitleTrack = trackId
	}
	restart(){
		this.disconnect()
		try{ // due to some nightmare errors crashing nwjs
			this.hls.destroy()
			this.hls = null
		}catch(e){
			console.error(e)
		}
		this.time(0)
		this.loadHLS(() => {
			this.hls.loadSource(this.currentSrc)
			this.connect()
		})
	}
	load(src, mimetype, cookie, type){
		if(!src){
			console.error('Bad source', src, mimetype, traceback())
			return
		}
		console.warn('Load source', src)
		this.active = true
		this.engineType = type
		if(this.currentSrc != src){
			this.currentSrc = src
			this.currentMimetype = mimetype
		}
		this.loadHLS(() => {
			this.hls.loadSource(this.currentSrc)
			this.connect()
		})
	}
	unload(){
		console.log('unload hls')
		if(this.hls && typeof(this.hls) != 'boolean'){
			console.log('unload hls disconnect')
			this.disconnect()
			try{ // due to some nightmare errors crashing nwjs
				this.hls.stopLoad()
				this.hls.destroy()
				this.hls = null
			}catch(e){
				console.error(e)
			}
			this.object.src = ''
			console.log('unload hls super.unload')
			super.unload()
			console.log('unload hls OK')
		}
	}
    destroy(){
		console.log('hls destroy')
		this.unload()
		super.destroy()
    }
}