

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
                this.emit('error', 'playback', this.prepareErrorData(data))
            }
        }
        console.warn(msg)
    }	
    handleNetworkError(data) {	
		if(!this.active) return
		if(!isNaN(this.object.duration) && this.object.duration) { // 
			let now = performance.now()	
			this.recoverNetworkCodecDate = now
			this.hls.stopLoad()
			this.hls.detachMedia(this.object)
			setTimeout(() => {
				console.warn('trying to recover from network Error...')
				if(this.active){
					this.hls.attachMedia(this.object)
					this.hls.startLoad() // ffmpeg/server slow response
					try{
						this.object.load()
					}catch(e){
						console.error(e)
					}
				}
			}, 0)
			this.emit('slow')
		} else {
			let msg = 'fatal video error'
			console.error(msg, this.object.duration)
			this.emit('error', 'playback', this.prepareErrorData(data))
			this.state = ''
			this.emit('state', '')
		}
    }	
    prepareErrorData(data){
        return {type: data.type || 'playback', details: data.details || ''}
    }
    loadHLS(cb){
		if(!this.hls){
			this.hls = new Hls({
				enableWorker: true,
				autoStartLoad: false,
				defaultAudioCodec: 'mp4a.40.2',
				liveBackBufferLength: 10 // secs, limited due to memory usage
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
				console.error('hlserr', data)
				if (data.fatal) {
					switch (data.type) {
						case Hls.ErrorTypes.MEDIA_ERROR:
							console.error('media error', data.details)
							this.handleMediaError(data)
							break
						case Hls.ErrorTypes.NETWORK_ERROR:
							console.error('network error', data.networkDetails)
							//this.handleNetworkError(data)
							break
						default:
							console.error('unrecoverable error', data.details)
							this.emit('error', 'playback', this.prepareErrorData(data))
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
							console.error('Error while loading key ' + data.frag.decryptdata.uri)
							break
						case Hls.ErrorDetails.KEY_LOAD_TIMEOUT:
							console.error('Timeout while loading key ' + data.frag.decryptdata.uri)
							break
						case Hls.ErrorDetails.BUFFER_APPEND_ERROR:
							console.error('Buffer append error', parseInt(this.object.duration))
							// it happens when handleNetworkError is in progress, ignore
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
							// this.handleNetworkError(data)
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
	load(src, mimetype, cookie){
		console.warn('LOAD SRC')
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