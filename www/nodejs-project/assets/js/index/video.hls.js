

class VideoControlAdapterHTML5HLS extends VideoControlAdapterHTML5Video {
	constructor(container){
		super(container)
        this.recoverDecodingErrorDate = null
		this.recoverSwapAudioCodecDate = null
		this.src = ''
        this.on('stop', () => {
            this.recoverDecodingErrorDate = null
			this.recoverSwapAudioCodecDate = null
			console.log('onstop')
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
        return {type: data.type || 'playback', details: data.details || ''}
    }
    prepareErrorDataStr(data){
        return (typeof(data) != 'string' && data.details) ? data.details : String(data)
    }
    loadHLS(cb){
		if(!this.hls){
			this.hls = new Hls({
				enableWorker: true,
				autoStartLoad: false,
				defaultAudioCodec: 'mp4a.40.2',
				maxBufferSize: 128, // When doing internal transcoding with low crf, fragments will become bigger
				backBufferLength: this.config['live-window-time'],
				maxBufferLength: 30,
				maxMaxBufferLength: 120,
				/*
				debug: true,
				enableSoftwareAES: false,
				nudgeMaxRetry: 12,
				maxSeekHole: 30,
				maxBufferSize: 20,
				maxBufferHole: 10,
				maxBufferLength: 10,
				maxMaxBufferLength: '120s',
				maxFragLookUpTolerance: 0.04,
				startPosition: 0,
				*/
			})
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
							console.error('Error while loading fragment ' + data.frag.url)
							break
						case Hls.ErrorDetails.FRAG_LOAD_TIMEOUT:
							console.error('Timeout while loading fragment ' + data.frag.url)
							break
						case Hls.ErrorDetails.FRAG_LOOP_LOADING_ERROR:
							console.error('Fragment-loop loading error')
							break
						case Hls.ErrorDetails.FRAG_DECRYPT_ERROR:
							console.error('Decrypting error:' + data.reason)
							break
						case Hls.ErrorDetails.FRAG_PARSING_ERROR:
							console.error('Parsing error:' + data.reason)
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
							console.error('Buffer append error', parseInt(this.object.duration))
							// it happens when handleNetworkError is in progress, ignore
							break
						case Hls.ErrorDetails.BUFFER_FULL_ERROR:
							console.error('Buffer full error')
							// it happens when segments are bigger
							this.hls.recoverMediaError()
							break
						case Hls.ErrorDetails.BUFFER_ADD_CODEC_ERROR:
							console.error('Buffer add codec error for ' + data.mimeType + ':' + data.err.message)
							break
						case Hls.ErrorDetails.BUFFER_APPENDING_ERROR:
							console.error('Buffer appending error', parseInt(this.object.duration))
							// this.hls.attachMedia(this.object) // 
							break
						case Hls.ErrorDetails.BUFFER_STALLED_ERROR:
							console.error('Buffer stalled error', parseInt(this.object.duration))
							// not fatal, would not be needed to handle, BUT, the playback hangs even it not saying that it's a fatal error, so call handleNetworkError(/*startLoad()*/) to ensure
							let time = this.object.currentTime, duration = this.object.duration			
							if((duration - time) > this.config['live-window-time']){
								this.hls.stopLoad()
								let averageLoadTime = 5
								console.log('out of live window', time, duration, this.config)
								time = (duration - this.config['live-window-time']) + averageLoadTime
								if(time < 0){
									time = 0
								}
								this.object.currentTime = time
								this.hls.startLoad()
							} else if((duration - time) < 1){
								console.log('out of buffer, trust on hls.js', time, duration, this.config)
								// ...
							} else {
								console.log('in live window, trust on hls.js', time, duration, this.config)
							}
							break
						case Hls.ErrorDetails.BUFFER_NUDGE_ON_STALL:
							console.error('Buffer nudge on stall', parseInt(this.object.duration))
							break
						default:
							console.error('Hls.js unknown error', data.type, data.details)
							break
					}
				}
			})
			this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
				this.hls.startLoad(0)
				let promise = this.object.play()
				if(promise){
					promise.catch(err => {
						if(this.active){
							console.error(err, err.message, this.object.networkState, this.object.readyState)
						}
					})
				}
			})
			this.hls.on(Hls.Events.MEDIA_ATTACHED, () => {
				cb()
			})
			this.hls.attachMedia(this.object)
		} else {
			cb()
		}
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
			this.hls.loadSource(this.src)
			this.connect()
		})
	}
	load(src, mimetype, cookie){
		if(!src){
			console.error('Bad source', src, mimetype, traceback())
			return
		}
		console.warn('Load source', src)
		this.active = true
		this.src = src
		this.loadHLS(() => {
			this.hls.loadSource(this.src)
			this.connect()
		})
	}
	unload(){
		console.log('unload hls')
		if(this.active){
			this.disconnect()
			try{ // due to some nightmare errors crashing nwjs
				this.hls.destroy()
				this.hls = null
			}catch(e){
				console.error(e)
			}
			super.unload()
			console.log('unload hls OK')
		}
	}
    destroy(){
		console.log('hls destroy')
		super.destroy()
        if(this.hls && typeof(this.hls) != 'boolean'){						
            this.hls.destroy()
        }    
    }
}