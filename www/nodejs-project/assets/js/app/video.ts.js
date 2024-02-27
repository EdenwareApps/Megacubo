
class VideoControlAdapterHTML5TS extends VideoControlAdapterHTML5Video {
	constructor(container){
		super(container)
		this.currentSrc = ''
        this.setup('video')
    }
	load(src, mimetype, additionalSubtitles, cookie, mediatype){
		if(!src){
			console.error('Bad source', src, mimetype, traceback())
			return
		}
		this.active = true
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
		this.errorListener = err => {
			const t = this.time()
			if(t != this.lastErrorTime) {
				this.errorsCount = 0
			}
			this.errorsCount++
            console.error('MPEGTS ERROR', err, this.errorsCount, t != this.lastErrorTime)
			if(this.errorsCount >= (t > 0 ? 20 : 3)){
				this.emit('error', String(err), true)
				this.state = ''
				this.emit('state', '')
			} else {
				const c = this.errorsCount // load() may reset the counter
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
			}
			this.lastErrorTime = t
        }
		this.logListener = (type, message) => {
			if(String(message).indexOf('sync_byte') != -1){
				this.errorListener(message)
			}
		}
		const v = $(this.object)
		v.on('error', err => {
			if(this.object.error){
				this.mpegts.detachMediaElement()
				console.warn('!! RENEWING VIDEO OBJECT')
				this.recycle()
				this.mpegts.attachMediaElement(this.object)
				this.mpegts.play()
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
		if(this.mpegts){
			console.log('unload ts disconnect')
			this.disconnect()
            this.mpegts.unload()
            // this.mpegts.detachMediaElement()
            this.mpegts.destroy()
            this.mpegts = null
			if(this.logListener){
				mpegts.LoggingControl.removeLogListener(this.logListener)
				delete this.logListener
			}
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