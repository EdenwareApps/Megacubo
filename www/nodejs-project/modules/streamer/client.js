
class StreamerPlaybackTimeout extends EventEmitter {
    constructor(controls, app){
        super()
        this.app = app
        this.jbody = $(document.body)
        this.controls = controls
        this.playbackTimeout = 25000
        this.playbackTimeoutTimer = 0
        this.on('state', s => {
            if(s == 'loading'){
                if(!this.playbackTimeoutTimer){
                    this.playbackTimeoutTimer = setTimeout(() => {
                        this.emit('stuck')
                        clearTimeout(this.playbackTimeoutTimer)
                        this.app.emit('video-error', 'timeout', this.prepareErrorData({type: 'timeout', details: 'client playback timeout'}))
                    }, this.playbackTimeout)
                }
            } else {
                this.cancelTimeout()
            }
        })        
        this.on('stop', () => {
            this.cancelTimeout()
        })
        this.app.on('streamer-reset-timeout', err => {
            clearTimeout(this.playbackTimeoutTimer)
            this.playbackTimeoutTimer = 0
        })
    }
    cancelTimeout(){
        osd.hide('debug-timeout')
        osd.hide('timeout')
        clearTimeout(this.playbackTimeoutTimer)
        this.playbackTimeoutTimer = 0
        if(this.isTryOtherDlgActive()){
            explorer.endModal()
        }
    }
    isTryOtherDlgActive(){
        return !!document.getElementById('modal-template-option-wait')
    }
    ended(){
        clearTimeout(this.playbackTimeoutTimer)
        if(this.inLiveStream){
            this.app.emit('video-error', 'playback', this.prepareErrorData({type: 'timeout', details: 'client playback ended after '+ v.currentTime + 's'}))
        }
    }
    prepareErrorData(data){
        return {type: data.type || 'playback', details: data.details || ''}
    }
    time(){
        return Date.now() / 1000
    }
}

class StreamerOSD extends StreamerPlaybackTimeout {
    constructor(controls, app){
        super(controls, app)
        this.transmissionNotWorkingHintDelay = 10000
        this.transmissionNotWorkingHintTimer = 0
        this.state = 'loading'
        this.osdID = 'video'
        this.OSDNameShown = false
        this.on('draw', () => {
            this.OSDLoadingHintShown = false
        })
        this.on('state', s => {
            switch(s){
                case 'ended':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    this.OSDNameShown = false
                    osd.hide(this.osdID + '-sub')
                    osd.show(lang.ENDED, 'fas fa-play', this.osdID, 'persistent')
                    break
                case 'paused':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    this.OSDNameShown = false
                    osd.hide(this.osdID + '-sub')
                    if(this.seekTimer){
                        osd.hide(this.osdID)
                    } else {
                        osd.show(lang.PAUSED +'<span style="opacity: var(--opacity-level-2)"> &nbsp;&middot;&nbsp; </span>'+ this.data.name, 'fas fa-play', this.osdID, 'persistent')
                    }
                    break
                case 'loading':
                    osd.hide(this.osdID + '-sub')
                    osd.hide(this.osdID)
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    if(this.transcodeStarting){
                        osd.show(lang.TRANSCODING_WAIT, 'fas fa-circle-notch fa-spin', this.osdID, 'persistent')
                        osd.hide(this.osdID +'-sub')
                    } else {
                        this.transmissionNotWorkingHintTimer = setTimeout(() => {
                            if(this.active){
                                osd.hide(this.osdID)
                                if(this.autoTuning){
                                    const icon = this.isZapping ? this.zappingIcon : config['tuning-icon']
                                    osd.show(lang.BROADCAST_NOT_WORKING_HINT.format('<i class=\"'+ icon +'\"></i>'), '', this.osdID +'-sub', 'persistent')
                                }
                                this.app.emit('streamer-is-slow')
                            }
                        }, this.transmissionNotWorkingHintDelay)                    
                    }
                    break
                case 'playing':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    osd.hide(this.osdID + '-sub')
                    osd.hide(this.osdID)
                    if(!this.OSDNameShown){
                        this.OSDNameShown = true
                        if(this.autoTuning){
                            const icon = this.isZapping ? this.zappingIcon : config['tuning-icon']
                            osd.show(lang.BROADCAST_NOT_WORKING_HINT.format('<i class=\"'+ icon +'\"></i>'), '', this.osdID +'-sub', 'normal')
                        }
                        osd.show(this.data.name, this.data.icon || '', this.osdID, 'normal')
                    }
                    break
                case '':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    osd.hide(this.osdID + '-sub')
                    osd.hide(this.osdID)
            }
        })        
        this.on('stop', () => {
            clearTimeout(this.transmissionNotWorkingHintTimer)
            this.OSDNameShown = false
            osd.hide(this.osdID + '-sub')
            osd.hide(this.osdID)
        })
    }    
}

class StreamerCasting extends StreamerOSD {
    constructor(controls, app){
        super(controls, app)
        this.casting = false
        this.castingPaused = false
        app.on('cast-start', () => this.castUIStart())
        app.on('cast-stop', () => this.castUIStop())
        app.on('external-player', url => {
            parent.parent.Manager.externalPlayer.play(url).catch(err => {
                console.error(err)
                osd.show(String(err), 'fas fa-exclamation-triangle faclr-red', 'external-player', 'normal')
            })
        })
        this.on('before-seek', s => {
            if(this.casting){
                if(!parent.player.otime){
                    parent.player.otime = parent.player.time
                }
                if(!parent.player.oresume){
                    parent.player.oresume = parent.player.resume
                }
                parent.player.time = () => {}
                parent.player.resume = () => {}
                this.emit('state', 'paused')
                this.seekBarUpdate(true, s)
            }
        })
        this.on('after-seek', s => {
            if(this.casting){
                this.seekBarUpdate(true, s)
                parent.player.time = parent.player.otime
                parent.player.resume = parent.player.oresume
                setTimeout(() => {
                    if(this.casting){
                        this.emit('state', 'playing')
                        this.seekBarUpdate(true, s)
                    }
                }, 2500)
            }
        })
        this.on('state', s => {
            if(this.casting){
                if(s == 'playing'){
                    this.unbindStateListener()
                    parent.player.pause()
                } else if(s == ''){
                    this.casting = false
                    this.castingPaused = false
                    this.jbody.removeClass('casting')
                }
            }
        })
    }
    castUIStart() {        
        if(!this.casting){
            this.casting = true
            this.castingPaused = false
            this.unbindStateListener()
            parent.player.pause()
            this.stateListener('playing')
            this.jbody.addClass('casting')
            this.inLiveStream && this.jbody.addClass('casting-live')
        }
    }
    castUIStop() { 
        if(this.casting){
            this.casting = false
            this.castingPaused = false
            this.jbody.removeClass('casting casting-live')
            if(this.active){
                this.bindStateListener()
                if(parent.player.state){
                    parent.player.resume()
                } else {
                    parent.player.load(this.activeSrc, this.activeMimetype, this.activeSubtitle, this.activeCookie, this.activeMediatype, this.data)
                    this.stateListener('loading')
                }
            }
        }
    }
}

class StreamerState extends StreamerCasting {
    constructor(controls, app){
        super(controls, app)
        this.state = ''
        this.stateListener = (s, data, force) => {
            if(s != this.state || force){
                if(this.state == 'ended') {
                    this.app.emit('video-resumed')
                }
                this.state = s
                console.log('STREAMER-STATE', this.state)
                switch(this.state){
                    case 'paused':
                        this.controls.querySelector('.play-button').style.display = 'block'
                        this.controls.querySelector('.pause-button').style.display = 'none'
                        break
                    case 'loading':
                    case 'playing':
                        this.controls.querySelector('.play-button').style.display = 'none'
                        this.controls.querySelector('.pause-button').style.display = 'block'
                        break
                    case 'ended':                    
                        this.controls.querySelector('.play-button').style.display = 'block'
                        this.controls.querySelector('.pause-button').style.display = 'none'
                        this.app.emit('video-ended')
                        break
                    case 'error':                    
                        this.app.emit('video-error', 'playback', this.prepareErrorData({type: 'playback', details: String(data) || 'playback error'}))
                        this.stop(true) // stop silently, to let server handle the video-error
                    case '':
                        this.stop()
                        break
                }
                this.emit('state', this.state)
            }
        }
        this.on('start', () => {
            this.stateListener('loading')
            if(parent.cordova){
                parent.player.once('timeupdate', () => { // only on initial timeupdate of each stream to fix bad loading status on Exoplayer, bad behaviour with hls.js on PC
                    if(this.state == 'loading'){
                        this.stateListener('playing')
                    }
                })
            }
        })
        this.on('stop', () => this.stateListener(''))
        this.app.on('streamer-show-tune-hint', () => {
            const next = () => {
                explorer.dialog([
                    {template: 'question', text: document.title, fa: 'fas fa-info-circle'},
                    {template: 'message', text: lang.TUNING_HINT.format('<i class=\'fas '+ config['tuning-icon'] +'\'></i>')},
                    {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                ])
            }
            if(this.animating){
                this.once('animated', next)
            } else {
                next()
            }
        })
        this.app.on('streamer-client-pause', () => {
            const should = !this.casting && parent.player.state != 'paused'
            if(should) {
                parent.player.pause()
            }
        })
        this.app.on('streamer-client-resume', () => {
            const should = !this.casting && parent.player.state == 'paused'
            if(should) {
                parent.player.resume()
            }
        })
        this.positionReportingInterval = 10
        this.lastPositionReportingTime = time()
        this.lastPositionReported = 0
        this.on('start', () => {
            this.positionReportingInterval = 10
            this.lastPositionReportingTime = time()
            this.lastPositionReported = 0
        })
        parent.player.on('timeupdate', position => {
            if(!this.inLiveStream && position >= 30){
                const now = time()
                if(now > (this.lastPositionReportingTime + this.positionReportingInterval)){
                    let reportingDiff = Math.abs(position - this.lastPositionReported)
                    if(reportingDiff >= this.positionReportingInterval){
                        this.lastPositionReportingTime = now
                        let duration = parent.player.duration()
                        if(duration && duration > 0){
                            this.lastPositionReported = position
                            this.app.emit('state-atts', this.data.url, {duration, position, source: this.data.source})
                        }
                    } else {
                        this.lastPositionReportingTime += (this.positionReportingInterval - reportingDiff + 0.1)
                    }
                }
            }
        })
        this.app.on('resume-dialog', position => {
            const next = () => {
                console.warn('RESUME', position)
                parent.player.pause()
                explorer.dialog([
                    {template: 'question', text: lang.CONTINUE, fa: 'fas fa-redo-alt'},
                    {template: 'option', text: lang.RESUME_FROM_X.format(hmsSecondsToClock(position)), id: 'resume', fa: 'fas fa-redo-alt'},
                    {template: 'option', text: lang.PLAY_FROM_START, id: 'play', fa: 'fas fa-play'}
                ], choose => {
                    switch(choose){
                        case 'resume':
                            parent.player.time(position) // no "break;" here
                        default:
                            parent.player.resume()
                            break
                    }
                    return true
                }, 'resume-from')
            }
            if(this.animating){
                this.once('animated', next)
            } else {
                next()
            }
        })
    }
    bindStateListener(){
        if(!parent.player.listeners('state').includes(this.stateListener)){
            parent.player.on('state', this.stateListener)
        }
        this.stateListening = true
    } 
    unbindStateListener(){
        console.log('STREAMER-UNBINDSTATELISTENER')
        parent.player.removeListener('state', this.stateListener)
        this.stateListening = false
    }
    playOrPause(){
        if(this.active && parent.player.state){
            if(['paused', 'ended'].includes(parent.player.state)){
                if(this.casting){
                    if(this.castingPaused){
                        this.castingPaused = false
                        this.stateListener('playing')
                        this.app.emit('streamer-resume')
                    } else {
                        this.castingPaused = true
                        this.stateListener('paused')
                        this.app.emit('streamer-pause')
                    }
                } else {
                    if(config['unpause-jumpback']){
                        const time = parent.player.time()
                        if(time){
                            const ntime = Math.max(parent.player.time() - config['unpause-jumpback'], 0)
                            if(ntime < time){
                                parent.player.time(ntime)
                            }
                        }
                    }
                    parent.player.resume()
                    this.app.emit('streamer-resume')
                }
            } else {
                parent.player.pause()
                this.app.emit('streamer-pause')
            }
        }
    }
    playOrPauseNotIdle(){
        let _idle = idle.isIdle || idle.lastIdleTime > ((Date.now() / 1000) - 0.5)
        console.error('playOrPauseNotIdle() '+ (_idle?'Y':'N'), idle.isIdle, idle.lastIdleTime)
        if(!_idle){
            this.playOrPause()
        }
    }
    isTuning(){
        let txt = osd.textContent()
        return txt.indexOf(lang.TUNING) != -1 || txt.indexOf(lang.CONNECTING) != -1
    }
}

class StreamerTranscode extends StreamerState { // request stream transcode 
    constructor(controls, app){
        super(controls, app)
        if(!parent.cordova){
            parent.player.on('request-transcode', () => this.app.emit('video-transcode'))
        }
    }
}

class StreamerUnmuteHack extends StreamerTranscode { // unmute player on browser restrictions
    constructor(controls, app){
        super(controls, app)
        if(!parent.cordova){
            this.once('start', () => this.unmuteHack())
            jQuery(document).one('touchstart mousedown keydown', () => {
                console.log('unmute player on browser restrictions')
                this.unmuteHack()
            })
        }
    }
    unmuteHack(){
        if(this.unmuteHackApplied) return
        this.unmuteHackApplied = true
        parent.player.container.querySelectorAll('video, audio').forEach(e => e.muted = false)
    }
}

class StreamerClientVideoAspectRatio extends StreamerUnmuteHack {
    constructor(container, app){
        super(container, app)
        this.aspectRatioList = [
            {h: 16, v: 9},
            {h: 4, v: 3},
            {h: 16, v: 10},
            {h: 21, v: 9}
        ]
        this.activeAspectRatio = this.aspectRatioList[0]
        this.lanscape = window.innerWidth > window.innerHeight
        window.addEventListener('resize', () => {
            let landscape = window.innerWidth > window.innerHeight
            if(landscape != this.landscape){ // orientation changed
                this.landscape = landscape
                setTimeout(() => this.applyAspectRatio(this.activeAspectRatio), 500) // give a delay to avoid confusion
            } else {
                this.applyAspectRatio(this.activeAspectRatio)
            }
        })
        parent.player.on('setup-ratio', r => {
            console.log('SETUP-RATIO', r)
            this.setupAspectRatio()
        })
        this.app.on('ratio', () => {
            this.switchAspectRatio()
        })
        this.on('stop', () => {
            this.aspectRatioList = this.aspectRatioList.filter(m => typeof(m.custom) == 'undefined')
            this.activeAspectRatio = this.aspectRatioList[0]
        })
    }
    generateAspectRatioMetrics(r){
        let h = r, v = 1
        while(h < Number.MAX_SAFE_INTEGER && (!Number.isSafeInteger(h) || !Number.isSafeInteger(v))){
            v++
            h = v * r;
        }
        console.log('generateAspectRatioMetrics', r, {v, h})
        return {v, h}
    }
    registerAspectRatio(metrics){
        let found = this.aspectRatioList.some(m => {
            return (m.v == metrics.v && m.h == metrics.h)
        })
        if(!found){
            metrics.custom = true
            this.aspectRatioList.push(metrics)
        }
        return metrics
    }
    detectAspectRatio(){
        return parent.player.videoRatio()
    }
    setupAspectRatio(){
        let r = this.detectAspectRatio(), metrics = this.generateAspectRatioMetrics(r)
        this.applyAspectRatio(metrics)
        this.registerAspectRatio(metrics)
    }
    switchAspectRatio(){
        var nxt = this.aspectRatioList[0], i = this.aspectRatioList.indexOf(this.activeAspectRatio)
        if(i < (this.aspectRatioList.length - 1)){
            nxt = this.aspectRatioList[i + 1]
        }
        console.log('RATIO', nxt, this.activeAspectRatio, i, this.aspectRatioList)
        this.applyAspectRatio(nxt)
    }
    applyAspectRatio(r){
        this.activeAspectRatio = r        
        parent.player.ratio(r.h / r.v)
    }
}

class StreamerIdle extends StreamerClientVideoAspectRatio {
    constructor(controls, app){
        super(controls, app)
        const rgxIsIdle = new RegExp('(^| )idle', 'g')
        const rgxVideoState = new RegExp('(^| )video[\\-a-z]+', 'g') // should not include 'video' class
        this.on('state', s => {
            const done = () => {
                let c = document.body.className
                if(s && s != 'error'){
                    c = c.replace(rgxVideoState, ' ') +' video-'+ s
                } else {
                    c = c.replace(rgxVideoState, ' ')
                }
                // console.warn('VIDEOCLASS '+ document.body.className +' => '+ c.trim())
                document.body.className = c.trim()
            }
            if(this.animating){
                this.once('animated', done)
            } else {
                done()
            }
        });
        idle.on('idle', () => {
            const c = document.body.className || ''
            if(!c.match(rgxIsIdle)){
                document.body.className += ' idle'
            }
            parent.player.uiVisible(false)
        })
        idle.on('active', () => {
            const c = document.body.className || ''
            if(c.match(rgxIsIdle)){
                document.body.className = c.replace(rgxIsIdle, ' ').trim()
            }
            parent.player.uiVisible(true)
        })
    }   
}

class StreamerSpeedo extends StreamerIdle {
    constructor(controls, app){
        super(controls, app)
        this.invalidSpeeds = ['N/A', 0]
        this.speedoLabel = document.querySelector('#loading-layer > span.loading-layer-status > span')
        this.on('state', state => {
            if(this.isLocal()) return
            switch(state){
                case 'loading':
                    this.speedoUpdate()
                    break
                case 'playing':
                    if(!this.speedoDurationReported && !this.inLiveStream){
                        let duration = parent.player.duration()
                        if(duration && duration > 0){
                            this.speedoDurationReported = true
                            this.app.emit('streamer-duration', duration)
                        }
                    }
                    break
                case '':
                    this.speedoSemSet(-1, lang.WAITING_CONNECTION)
            }
        })
        this.on('start', () => {
            this.commitTime = time()
            this.state = 'loading'
            this.speedoReset()
            this.seekBarReset()
            this.app.emit('downlink', this.downlink())
            if(this.isLocal()){
                return this.speedoSemSet(-1, '')
            }
        })
        this.on('stop', () => {
            this.bitrate = 0
            this.currentSpeed = 0
            this.speedoDurationReported = false
        })
        this.app.on('streamer-speed', speed => {
            this.currentSpeed = speed
            this.speedoUpdate()
        })
        this.app.on('streamer-bitrate', bitrate => {
            this.bitrate = bitrate
            this.speedoUpdate()
        })
        navigator.connection.addEventListener('change', () => { // seems not reliable, so we'll be sending downlink in other moments too        
            console.log('NAVIGATOR.CONNECTION CHANGED!!!')
            this.speedoUpdate()
            this.app.emit('downlink', this.downlink())
        })
        this.app.emit('downlink', this.downlink())
    }
    isLocal(){
        return this.data && this.data.isLocal
    }
    downlink(minimal){
        if(!navigator.onLine){
            return 0
        }
        let downlink = navigator.connection && navigator.connection.downlink ? navigator.connection.downlink : 0
        if(downlink){ // mbs to bits
            downlink = downlink * (1024 * 1024)
        }
        if(minimal && downlink < minimal){
            downlink = minimal
        }
        if(downlink != this.latestDownlink){
            this.latestDownlink = downlink
            this.app.emit('downlink', downlink)
        }
        return downlink
    }
    speedoReset(){
        this.speedoSemSet(-1, lang.WAITING_CONNECTION)
    }
    speedoUpdate(){
        if(!parent.player.state){
            return
        }
        if(this.isLocal()){
            return this.speedoSemSet(-1, '')
        }
        let semSet, starting = !this.commitTime || (time() - this.commitTime) < 15
        let lowSpeedThreshold = (250 * 1024) /* 250kbps */, downlink = this.downlink(this.currentSpeed)
        //console.error('SPEEDOUPDATE', starting, this.commitTime, time(), this.currentSpeed, this.bitrate, downlink)
        if(this.invalidSpeeds.includes(this.currentSpeed)) {
            this.speedoSemSet(-1, this.transcodeStarting ? lang.TRANSCODING_WAIT : lang.WAITING_CONNECTION)
        } else {
            let t = ''
            if(this.bitrate && !this.invalidSpeeds.includes(this.bitrate)){
                let p = parseInt(this.currentSpeed / (this.bitrate / 100))
                if(p > 100){
                    p = 100
                } else if(p < 0) {
                    p = 0
                }
                if(starting){
                    t = lang.WAITING_CONNECTION
                } else if(downlink && downlink < this.bitrate){ // client connection is the throattling factor
                    t += lang.YOUR_CONNECTION_IS_SLOW_TIP.format('<i class="'+ config['tuning-icon'] +'"></i>') + ': '
                } else { // slow server?
                    t += lang.SLOW_SERVER + ': '
                }
                t += ' '+ p + '%'
                if(p < 80){
                    semSet = 2
                } else if(p < 100){
                    semSet = 1
                } else {
                    semSet = 0
                    t = lang.STABLE_CONNECTION
                }
            } else {
                if(starting){
                    t = lang.WAITING_CONNECTION
                } else {
                    t = lang.SLOW_SERVER + ': ' + kbsfmt(this.currentSpeed)
                }
                if(this.currentSpeed <= lowSpeedThreshold){
                    semSet = starting ? -1 : 2
                } else {                   
                    semSet = 1
                }
            }
            if(this.transcodeStarting){
                t = lang.TRANSCODING_WAIT                
            }
            this.speedoSemSet(semSet, t)
        }
    }
    speedoSemSet(s, txt){
        if(s !== this.currentSem || this.transcodeStarting){
            const colors = ['green', 'orange', 'red']
            this.currentSem = s
            this.speedoLabel.innerHTML = txt
            if(!this.speedoSemInfoButton){
                this.speedoSemInfoButton = $(this.getPlayerButton('info')).add($('seekbar')).add($('button.recording'))
            }
            colors.forEach((color, i) => {
                this.speedoSemInfoButton[i == s ? 'addClass' : 'removeClass']('faclr-'+ color)
            })
        }
    }
}

class StreamerButtonActionFeedback extends StreamerSpeedo {
    constructor(controls, app){
        super(controls, app)
        this.buttonActionFeedbackTimer = 0
        this.buttonActionFeedbackIgnores = ['stop', 'info', 'tune', 'volume']
        this.buttonActionFeedbackListeners = {}
        this.on('draw', () => {
            this.buttonActionFeedbackLayer = jQuery('#button-action-feedback')
            this.buttonActionFeedbackLayer.css('visibility', 'visible')
            this.buttonActionFeedbackLayerInner = this.buttonActionFeedbackLayer.find('span')
        })
        this.on('added-player-button', this.addedPlayerButton.bind(this))
        this.on('updated-player-button', this.updatedPlayerButton.bind(this))
    }
    addedPlayerButton(id, name, button, fa) {
        if(this.buttonActionFeedbackIgnores.includes(id)) return
        this.buttonActionFeedbackListeners[name] = () => this.buttonActionFeedback(id, fa)
        button.addEventListener('click', this.buttonActionFeedbackListeners[name])
    }
    updatedPlayerButton(id, name, button, fa) {
        if(this.buttonActionFeedbackIgnores.includes(id)) return
        console.warn('updatedPlayerButton', id, name, button, fa)
        button.removeEventListener('click', this.buttonActionFeedbackListeners[name])
        this.buttonActionFeedbackListeners[name] = () => this.buttonActionFeedback(id, fa)
        button.addEventListener('click', this.buttonActionFeedbackListeners[name])
    }
    buttonActionFeedback(id, fa) {
        if(['paused', 'loading'].includes(this.state)) return
        if(id == 'play-pause') {
            if(this.state == 'playing') return
            fa = 'fas fa-play'
        }
        clearTimeout(this.buttonActionFeedbackTimer)        
        this.buttonActionFeedbackLayerInner.html('<i class="'+ fa +'" style="transform: scale(1); opacity: 1;"></i>')
        this.buttonActionFeedbackLayer.show()
        this.buttonActionFeedbackLayerInner.find('i').css('transform', 'scale(1.5)').css('opacity', '0.01')
        this.buttonActionFeedbackTimer = setTimeout(() => this.buttonActionFeedbackLayer.hide(), 500)
    }
}

class StreamerSeek extends StreamerButtonActionFeedback {
    constructor(controls, app){
        super(controls, app)
        this.seekSkipSecs = 5
        this.seekbar = false
        this.seekBarShowTime = 5000
        this.seekBarShowTimer = 0
        this.seekStepDelay = 400
        this.seekTimer = 0
        this.seekPlaybackStartTime = 0
        this.seekLastDuration = 0
        this.on('draw', () => {
            this.seekbar = this.controls.querySelector('seekbar')
            this.seekbarLabel = this.controls.querySelector('label.status')
            this.seekbarNput = this.seekbar.querySelector('input')
            this.seekbarNputVis = this.seekbar.querySelector('div > div')
            this.seekbarNput.addEventListener('input', () => {
                if(this.active){
                    console.log('INPUTINPUT', this.seekbarNput.value)
                    this.seekByPercentage(this.seekbarNput.value)
                }
            })
            this.seekRewindLayerCounter = document.querySelector('div#seek-back > span.seek-layer-time > span') 
            this.seekForwardLayerCounter = document.querySelector('div#seek-fwd > span.seek-layer-time > span') 
            idle.on('active', () => this.seekBarUpdate(true))
            this.seekBarUpdate(true)
        })
        this.on('state', s => {
            if(['playing', 'error', ''].includes(s)){
                this.seekingFrom = null
                console.log('removing seek layers', s)
                this.jbody.removeClass('seek-back').removeClass('seek-fwd')
                if(s == 'playing'){                    
                    this.seekBarUpdate(true)
                }
            }
            switch(s){
                case 'playing':
                    if(!this.seekPlaybackStartTime){
                        const duration = parent.player.duration()
                        this.seekPlaybackStartTime = time() - duration
                    }
                    break
                case '':
                    this.seekPlaybackStartTime = 0
                    break
            }
        })
        parent.player.on('timeupdate', () => {
            if(parent.player.uiVisibility){
                this.seekBarUpdate()
            }
        })
        parent.player.on('durationchange', uiVisible => {
            const duration = parent.player.duration()
            if(this.seekLastDuration > duration){ // player reset
                this.seekPlaybackStartTime = time() - duration
            }
            this.seekLastDuration = duration
            if(uiVisible) this.seekBarUpdate()
        })
        parent.player.on('play', () => {
            this.seekBarUpdate(true)
        })
    }    
    hmsPrependZero(n){
        if (n < 10){
            n = '0'+ n
        }
        return n
    }
    hms(secs){
        let sec_num = parseInt(secs, 10) // don't forget the second param
        let hours   = this.hmsPrependZero(Math.floor(sec_num / 3600))
        let minutes = this.hmsPrependZero(Math.floor((sec_num - (hours * 3600)) / 60))
        let seconds = this.hmsPrependZero(sec_num - (hours * 3600) - (minutes * 60))
        return hours + ':' + minutes + ':' + seconds
    }
    hmsMin(secs){
        if(secs < 0){
            secs = Math.abs(secs)
        }
        if(secs <= 60){
            return secs + 's'
        } else {
            let sec_num = parseInt(secs, 10) // don't forget the second param
            let hours   = Math.floor(sec_num / 3600)
            let minutes = this.hmsPrependZero(Math.floor((sec_num - (hours * 3600)) / 60))
            let seconds = this.hmsPrependZero(sec_num - (hours * 3600) - (minutes * 60))
            if(hours >= 1){
                hours = this.hmsPrependZero(hours)
                return hours + ':' + minutes + ':' + seconds
            } else {
                return minutes + ':' + seconds
            }
        }
    }
    seekBarReset(){
        this.seekBarUpdate(true, 0)
    }
    seekBarUpdate(force, time){
        if(this.active && this.state){
            if(!['paused', 'ended', 'loading'].includes(parent.player.state) || force === true){
                if(this.seekbarNput && (!window.isIdle || parent.player.state != 'playing' || force === true)){
                    if(typeof(time) != 'number'){
                        time = parent.player.time()
                    }
                    let percent = this.seekPercentage(time), duration = parent.player.duration()
                    this.seekbarLabel.innerHTML = this.seekbarLabelFormat(time, duration)
                    if(percent != this.lastPercent){
                        this.seekBarUpdateView(percent)
                    }
                }
            }
        }
    }
    seekBarUpdateView(percent){
        if(this.active && this.state){
            this.lastPercent = percent
            this.seekbarNputVis.style.width = percent +'%'
        }
    }
    seekBarUpdateSpeed(){
        if(this.active && this.seekbarNput && parent.player.state == 'loading'){
            let percent = this.seekPercentage(), d = parent.player.duration(), t = parent.player.time()
            this.seekbarLabel.innerHTML = this.seekbarLabelFormat(t, d)
            if(percent != this.lastPercent){
                this.seekBarUpdateView(percent)
            }
        }
    }
    seekbarLabelFormat(t, d){        
        let txt
        if(this.inLiveStream && config['use-local-time-counter']){
            txt = moment.unix(this.clockTimerCurrentTime()).format('LTS') //.replace(new RegExp('(\\d\\d:\\d\\d)(:\\d\\d)'), '$1<font style="opacity: var(--opacity-level-2);">$2</font>')
        } else {
            txt = this.hms(t) +' <font style="opacity: var(--opacity-level-2);">/</font> '+ this.hms(d)
        }
        return txt
    }
    seekPercentage(time){
        if(!this.active) return 0
        if(typeof(time) != 'number'){
            time = parent.player.time()
        }
        let minTime = 0, duration = parent.player.duration()
        if(!duration){
            return 0
        }
        if(this.inLiveStream){
            minTime = duration - config['live-window-time']
            if(minTime < 0){
                minTime = 0
            }
        }
        if(minTime){
            time -= minTime
            duration -= minTime
            if(time < 0){
                time = 0
            }
            if(duration < 0){
                duration = 0
            }
        }
        let percent = time / (duration / 100)
        if(isNaN(percent) || percent > 100){ // ?!
            percent = 100
        }
        return parseInt(percent)
    }
    seekTimeFromPercentage(percent){
        if(!this.active) return 0
        let minTime = 0, time = parent.player.time(), duration = parent.player.duration()
        if(this.inLiveStream){
            minTime = duration - config['live-window-time']
            if(minTime < 0){
                minTime = 0
            }
        }
        if(minTime){
            time -= minTime
            duration -= minTime
            if(time < 0){
                time = 0
            }
            if(duration < 0){
                duration = 0
            }
        }
        let ret = parseInt(minTime + (percent * (duration / 100)))
        console.log('SEEK PERCENT', percent, minTime, parent.player.time(), parent.player.duration(), duration, ret)
        return ret
    }
    seekByPercentage(percent){        
        if(this.active){
            let now = parent.player.time(), s = this.seekTimeFromPercentage(percent)
            this.seekTo(s, now > s ? 'rewind' : 'forward')
            this.app.emit('streamer-seek', s)
            this.seekBarUpdate(true)
        }
    }
    seekTo(_s, type){
        if(!this.state) return
        if(parent.cordova && this.activeMimetype == 'video/mp2t') {
            clearTimeout(this.seekFailureTimer)
            this.seekFailureTimer = setTimeout(() => this.app.emit('streamer-seek-failure'), 2000)
            return
        }
        if(typeof(this.seekingFrom) != 'number'){
            this.seekingFrom = parent.player.time()
        }
        let s = _s, minTime = 0, duration = parent.player.duration(), maxTime = Math.max(0, duration - 2)
        if(this.inLiveStream){
            minTime = duration - config['live-window-time']
            if(this.seekingFrom < minTime){
                minTime = this.seekingFrom
            }
            if(parent.player.current.object.buffered && parent.player.current.object.buffered.length){
                let bs = parent.player.current.object.buffered.start(0)
                if(bs < minTime){
                    minTime = bs
                }
            }
            if(minTime < 0){
                minTime = 0
            }
        }
        if(s < minTime){
            s = minTime
        } else if(s > maxTime){
            s = maxTime
        }
        if(type == 'rewind'){
            if(this.seekingFrom < s){
                s = this.seekingFrom
            }
        }
        if(type == 'forward'){
            if(this.seekingFrom > s){
                s = this.seekingFrom
            }
        }
        this.emit('before-seek', s)
        clearTimeout(this.seekTimer)
        this.seekTimer = setTimeout(() => {
            this.seekTimer = 0
            parent.player.resume()
        }, 1500)
        let diff = parseInt(s - this.seekingFrom)
        parent.player.pause()
        parent.player.time(s)
        this.emit('after-seek', s)
        console.log('seeking pre', diff, s, this.seekingFrom)
        if(this.seekLayerRemoveTimer){
            clearTimeout(this.seekLayerRemoveTimer)
        }
        if(diff < 0){
            this.seekRewindLayerCounter.innerText = '-' + this.hmsMin(diff)
            this.jbody.removeClass('seek-fwd').addClass('seek-back')
        } else if(diff > 0) {
            this.seekForwardLayerCounter.innerText = '+' + this.hmsMin(diff)
            this.jbody.removeClass('seek-back').addClass('seek-fwd')
        } else {
            if(type){
                if(type == 'rewind'){
                    this.seekRewindLayerCounter.innerText = this.hmsMin(diff)
                    this.jbody.addClass('seek-back').removeClass('seek-fwd')
                } else {
                    this.seekForwardLayerCounter.innerText = this.hmsMin(diff)
                    this.jbody.removeClass('seek-back').addClass('seek-fwd')
                }
            } else {
                this.jbody.removeClass('seek-back').removeClass('seek-fwd')
            }
        }
        this.seekLayerRemoveTimer = setTimeout(() => {            
            this.jbody.removeClass('seek-back').removeClass('seek-fwd')
        }, 3000)
        this.seekBarUpdate(true, s)
    }
    seekRewind(steps=1){
        if(this.active){
            let now = parent.player.time(), nct = now - (steps * this.seekSkipSecs)
            this.seekTo(nct, 'rewind')
        }
    }
    seekForward(steps=1){
        if(this.active){
            let now = parent.player.time(), nct = now + (steps * this.seekSkipSecs)
            this.seekTo(nct, 'forward')
        }
    }
}

class StreamerLiveStreamClockTimer extends StreamerSeek {
    constructor(controls, app){
        super(controls, app)
        this.useLiveStreamClockTimer = true
        this.calcOverDuration = true
        this.on('start', () => {
            this.resetClockTimer()
        })
        parent.player.on('durationchange', () => {
            this.detectPlayerReset()
        })
        this.on('state', state => {
            switch(state){
                case 'playing':
                    this.detectPlayerReset()
                    break
            }
        })
    }
    detectPlayerReset(){
        const duration = parent.player.duration()
        this.altPlaybackStartTime = time() - duration // ease up the cummulating differences in clock time x player time
        if(duration < this.clockTimerLastDuration){ // player resetted
            this.resetClockTimer()
        }
    }
    resetClockTimer(){
        const now = time(), duration = parent.player.duration()
        this.calcOverDuration = true
        this.playbackStartTime = now
        this.initialPlaybackTime = parent.player.time()
        this.clockTimerLastDuration = this.initialDurationTime = duration
        this.altPlaybackStartTime = now - duration  
        if((this.initialDurationTime - this.initialPlaybackTime) > 60){
            this.calcOverDuration = false
        }
    }
    clockTimerDuration(){
        const now = time(), stime = this.calcOverDuration ? this.altPlaybackStartTime : this.playbackStartTime
        return (now -  stime) + this.initialPlaybackTime
    }
    clockTimerCurrentTime(){
        const playbackTime = parent.player.time(), stime = this.calcOverDuration ? this.altPlaybackStartTime : this.playbackStartTime
        return stime + (playbackTime - this.initialPlaybackTime)
    }
}

class StreamerClientTimeWarp extends StreamerLiveStreamClockTimer {
    constructor(controls, app){
        super(controls, app)
        this.maxRateChange = 0.15
        this.defaultBufferTimeSecs = {
            pressure: 6,
            lazy: 30
        }
        this.currentPlaybackRate = 1
        parent.player.on('timeupdate', pos => this.doTimeWarp(pos))
        parent.player.on('durationchange', () => this.doTimeWarp())
        this.app.on('streamer-connect', (src, mimetype, cookie, mediatype) => {
            if(!config['in-disk-caching'] && mimetype.indexOf('mpegurl') != -1 && mediatype != 'video') {
                this.bufferTimeSecs = this.defaultBufferTimeSecs.pressure
            } else {
                this.bufferTimeSecs = this.defaultBufferTimeSecs.lazy
            }            
            parent.player.playbackRate(0.9) // start with caution
        })
        this.app.on('outside-of-live-window', () => this.syncLiveWindow())
        this.on('stuck', () => this.syncLiveWindow())
    }
    syncLiveWindow() {
        if(!this.inLiveStream) return
        const currentTime = parent.player.time()
        const nudge = 10
        let duration, pduration = parent.player.duration()
        if(!config['in-disk-caching'] && this.activeMimetype.indexOf('mpegurl') != -1 && this.activeMediatype != 'video') {
            duration = this.clockTimerDuration()
        } else {
            duration = pduration
        }
        let minSeekTime = parseInt(duration - (config['live-window-time'] + nudge))
        if(minSeekTime && minSeekTime > (currentTime + nudge)) this.seekTo(minSeekTime, 'forward')
    }
    doTimeWarp(ptime){
        if(this.inLiveStream && config['playback-rate-control'] && this.timewarpInitialPlaybackTime !== null){
            /*
            On HLS we'll try to avoid gets behind live window.
            On MPEGTS we'll just keep the buffer for smooth playback.
            */
            if(typeof(ptime) != 'number') {
                ptime = parent.player.time()
            }
            let duration, pduration = parent.player.duration()
            if(!config['in-disk-caching'] && this.activeMimetype.indexOf('mpegurl') != -1 && this.activeMediatype != 'video') {
                duration = this.clockTimerDuration()
            } else {
                duration = pduration
            }
            if(duration < ptime) return // skip by now
            const remaining = duration - ptime
            let rate = 1 + ((remaining - this.bufferTimeSecs) * (this.maxRateChange / this.bufferTimeSecs))
            rate = Math.min(1 + this.maxRateChange, Math.max(1 - this.maxRateChange, rate))
            // rate = Number(rate.toFixed(2))
            // if(rate != this.currentPlaybackRate){
            if(Math.abs(rate - this.currentPlaybackRate) > 0.02) {            
                this.currentPlaybackRate = rate
                console.warn('PlaybackRate='+ rate +'x', 'remaining '+ parseInt(remaining) +' secs')
                parent.player.playbackRate(rate)
            }
        }
    }
}

class StreamerAndroidNetworkIP extends StreamerClientTimeWarp {
    constructor(controls, app){ // helper for Android 10+, Node.JS won't be able to pick the network IP by itself
        super(controls, app)
        if(parent.cordova){
            parent.plugins.megacubo.on('network-ip', ip => {
                if(ip){
                    console.warn('Network IP received: '+ ip)
                    this.app.emit('network-ip', ip)
                }
            })
            this.updateNetworkIp()
            this.on('start', () => this.updateNetworkIp())
        }
    }
    updateNetworkIp(){
        parent.plugins.megacubo.getNetworkIp()
    }
}

class StreamerClientVideoFullScreen extends StreamerAndroidNetworkIP {
    constructor(controls, app){
        super(controls, app)
        let b = this.controls.querySelector('button.fullscreen')
        if(config['startup-window'] != 'fullscreen'){
            if(parent.cordova){
                this.inFullScreen = true // bugfix for some devices
                this.leaveFullScreen()
                parent.plugins.megacubo.on('appmetrics', this.updateAndroidAppMetrics.bind(this))
                parent.plugins.megacubo.on('nightmode', this.handleDarkModeInfoDialog.bind(this))
                this.updateAndroidAppMetrics(parent.plugins.megacubo.appMetrics)
                this.on('fullscreenchange', () => {
                    this.updateAndroidAppMetrics()
                    parent.plugins.megacubo.getAppMetrics()
                })
                if(b){
                    b.style.display = 'none'
                }
                this.on('start', () => {
                    this.enterFullScreen()
                    setTimeout(() => {
                        if(this.active){ // on Android, when fullscreen plugin slows to respond and stop+start calls got fast, it can happen that the fullscreen get messed, so ensure it after some seconds
                            this.enterFullScreen()
                        }
                    }, 2000)
                })
                this.on('stop', () => this.leaveFullScreen())
            } else {
                this.inFullScreen = false
                if(b) b.style.display = 'inline-flex'
            }
            this.on('fullscreenchange', fs => {
                if(fs){
                    this.jbody.addClass('fullscreen')
                } else {
                    this.jbody.removeClass('fullscreen')
                }
            })
        } else {
            this.inFullScreen = true
            this.jbody.addClass('fullscreen')
            if(b) b.style.display = 'none'
            this.enterFullScreen()
        }
    }
    handleDarkModeInfoDialog(info){
        if(info.miui && info.mode && info.mode != 16){
            explorer.dialog([
                {template: 'question', text: document.title, fa: 'fas fa-info-circle'},
                {template: 'message', text: lang.MIUI_DARK_MODE_HINT},
                {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
            ])
        }
    }
    updateAndroidAppMetrics(metrics){
        if(this.inFullScreen){
            css(' :root { --explorer-padding-top: 0px; --explorer-padding-bottom: 0px; --explorer-padding-right: 0px; --explorer-padding-left: 0px; } ', 'frameless-window')
        } else {
            if(metrics && metrics.top){
                this.lastMetrics = metrics
            } else {
                metrics = this.lastMetrics
            }            
            if(metrics) {
                css(' :root { --explorer-padding-top: ' + metrics.top + 'px; --explorer-padding-bottom: ' + metrics.bottom + 'px; --explorer-padding-right: ' + metrics.right + 'px; --explorer-padding-left: ' + metrics.left + 'px; } ', 'frameless-window')
            }
        }
    }
    updateAfterLeaveAndroidMiniPlayer(){
        if(screen.width == window.outerWidth && screen.height == window.outerHeight && this.active){
            this.enterFullScreen()
        }
    }
    enterFullScreen(){
        if(parent.cordova){
            if(!this.pipLeaveListener){
                this.pipLeaveListener = () => {
                    console.log('LEAVING PIP', screen.width, screen.height, window.outerWidth, window.outerHeight, this.active)
                    this.updateAfterLeaveAndroidMiniPlayer()
                }
            }
            parent.AndroidFullScreen.immersiveMode(() => {}, console.error)
            if(!parent.winman.listeners('leave').includes(this.pipLeaveListener)){
                parent.winman.on('leave', this.pipLeaveListener)
            }
        } else {
            parent.parent.Manager.setFullScreen(true)
        }
        this.inFullScreen = true
        this.emit('fullscreenchange', this.inFullScreen)
    }
    leaveFullScreen(){
        if(this.inFullScreen){
            this.inFullScreen = false
            if(parent.cordova){
                if(this.pipLeaveListener){
                    parent.winman.removeListener('leave', this.pipLeaveListener)
                }
                parent.AndroidFullScreen.immersiveMode(() => {
                    setTimeout(() => { // bugfix for some devices
                        parent.AndroidFullScreen.immersiveMode(() => {
                            parent.AndroidFullScreen.showSystemUI(() => {
                                parent.AndroidFullScreen.showUnderSystemUI(() => {}, console.error)
                            }, console.error)
                        }, console.error);
                    }, 10)
                }, console.error)
            } else {
                parent.parent.Manager.setFullScreen(false)
            }
            this.emit('fullscreenchange', this.inFullScreen)
        }
    }
    toggleFullScreen(){
        if(this.inFullScreen){
            this.leaveFullScreen()
        } else {
            if(parent.winman.inPIP) {
                parent.winman.leave().catch(console.error)
            } else {
                this.enterFullScreen()
            }
        }
    }
}

class StreamerAudioUI extends StreamerClientVideoFullScreen {
    constructor(controls, app){
        super(controls, app)
        this.isAudio = false
        this.app.on('codecData', codecData => {
            if(codecData.audio && !codecData.video){
                this.isAudio = true
                parent.winman && parent.winman.backgroundModeLock('audio')
                this.jbody.addClass('audio')
            } else {
                this.isAudio = false
                parent.winman && parent.winman.backgroundModeUnlock('audio')
                this.jbody.removeClass('audio')
            }
        })
        this.app.on('streamer-audio-track', trackId => {
            console.warn('SET TRACK', trackId)
            parent.player.audioTrack(trackId)
        })
        this.app.on('streamer-subtitle-track', trackId => {
            console.warn('SET TRACK', trackId)
            parent.player.subtitleTrack(trackId)
        })
        this.on('stop', () => {
            this.isAudio = false
            parent.winman && parent.winman.backgroundModeUnlock('audio')
            this.jbody.removeClass('audio')
        })
        this.on('state', s => {
            if(s == 'playing' && this.muted) {
                if(!parent.player.muted()) this.volumeMute()
            }
        })
		parent.player.on('audioTracks', tracks => this.app.emit('audioTracks', tracks))
		parent.player.on('subtitleTracks', tracks => this.app.emit('subtitleTracks', tracks))
        this.volumeInitialized = false
        this.volumeLastClickTime = 0
        this.volumeShowTimer = 0
        this.volumeHideTimer = 0
    }
    startVolumeHideTimer(){
        clearTimeout(this.volumeHideTimer)
        this.volumeHideTimer = setTimeout(() => this.volumeBarHide(), 1500)
    }
    volumeBarVisible(){
        return this.volumeBar.style.display != 'none'
    }
    volumeBarShow(){
        this.volumeBar.style.display = 'inline-table'
        this.startVolumeHideTimer()
    }
    volumeBarHide(){
        this.volumeBar.style.display = 'none'
        this.volumeInputRect = null
    }
    volumeBarToggle(e){
        if(e.target && e.target.tagName && ['button', 'volume-wrap', 'i'].includes(e.target.tagName.toLowerCase())){
            if(this.volumeBarVisible()){
                let now = time()
                if(this.volumeLastClickTime < (now - 0.4)){
                    this.volumeLastClickTime = now
                    this.volumeBarHide()
                }
            } else {
                this.volumeBarShow()
            }
        }
    }
    volumeBarCalcValueFromMove(e){
        if(!this.volumeInputRect){
            this.volumeInputRect = this.volumeInput.getBoundingClientRect()
        }
        const rect = this.volumeInputRect
        const y = e.touches[0].clientY - rect.top
        let percent = 100 - (y / (rect.height / 100))
        percent = Math.max(0, Math.min(100, percent))
        if(this.volumeInput.value != percent){
            this.volumeInput.value = percent
            this.volumeChanged()
        }
    }
    setupVolume(){        
        this.addPlayerButton('volume', 'VOLUME', 'fas fa-volume-up', 4, this.volumeBarShow.bind(this))
        this.volumeButton = this.getPlayerButton('volume')
        jQuery('<volume><volume-wrap><div><input type="range" min="0" max="100" step="1" value="'+ config['volume'] +'" /><div id="volume-arrow"></div></div></volume-wrap></volume>').prependTo(this.volumeButton)
        this.volumeBar = this.volumeButton.querySelector('volume')
        this.volumeInput = this.volumeBar.querySelector('input')
        this.jVolumeInput = jQuery(this.volumeButton)
        if(parent.cordova){
            // input and change events are not triggering satisfatorely on mobile, so we'll use touchmove instead ;)
            this.volumeInput.addEventListener('touchmove', this.volumeBarCalcValueFromMove.bind(this))
        } else {
            this.jVolumeInput.
            on('input', this.volumeChanged.bind(this)).
            on('mouseenter', () => {
                clearTimeout(this.volumeShowTimer)
                this.volumeShowTimer = setTimeout(() => this.volumeBarShow(), 400)
            }).
            on('mouseleave', () => {
                clearTimeout(this.volumeShowTimer)
            })
        }
        let isTouchDevice, touchListener = event => {
            isTouchDevice = true
            this.jVolumeInput.off('touchstart', touchListener)
        }
        this.jVolumeInput.
        on('touchstart', touchListener).
        on('click', event => {
            if(!event.target || isTouchDevice || !['volume-wrap', 'i'].includes(event.target.tagName.toLowerCase())) return
            const volume = parseFloat(this.volumeInput.value)
            if(volume){
                this.volumeMute()
            } else {
                this.volumeUnmute()
            }
        })
        this.once('start', () => this.volumeChanged())
        idle.on('idle', () => this.volumeBarHide())
        explorer.on('focus', e => {
            if(e == this.volumeButton){
                if(!this.volumeBarVisible()){
                    this.volumeLastClickTime = time()
                    this.volumeBarShow()
                }
            } else {
                this.volumeBarHide()
            }
        })
        this.volumeButton.addEventListener('blur', () => {
            if(document.activeElement != this.volumeInput && !document.activeElement.contains(this.volumeInput)){
                this.volumeBarHide()
            }
        })
    }
    isVolumeButtonActive(){
        let s = explorer.selected()
        return s && s.id && s.id == 'volume'
    }
    volumeUp(){
        this.volumeInput.value = Math.min(parseInt(this.volumeInput.value) + 1, 100)
        this.volumeChanged()
    }
    volumeDown(){
        this.volumeInput.value = Math.max(parseInt(this.volumeInput.value) - 1, 0)
        this.volumeChanged()
    }
    volumeMute(){
        const volume = parseFloat(this.volumeInput.value)
        if(volume){
            this.unmuteVolume = volume
        }
        this.muted = true
        this.volumeInput.value = 0
        this.volumeChanged()
    }
    volumeUnmute(){
        this.muted = false
        this.volumeInput.value = this.unmuteVolume || 100
        this.volumeChanged()
    }
    volumeChanged(){
        let nvolume = parseInt(this.volumeInput.value)
        if(!this.volumeInitialized || nvolume != this.volume){
            let volIcon = 'fas fa-volume-up', pc = this.volume ? (50 + (this.volume / 2)) : 100
            this.volume = nvolume
            if(!this.volume){
                volIcon = 'fas fa-volume-mute'
            }
            css(`
            i.fas.fa-volume-up { 
                -webkit-mask-image: linear-gradient(to right, white 0%, white ${pc}%, rgba(255, 255, 255, 0.15) ${pc}%);
                mask-image: linear-gradient(to right, white 0%, white ${pc}%, rgba(255, 255, 255, 0.15) ${pc}%);
            }`, 'volume-icon')
            this.volumeInput.style.background = 'linear-gradient(to right, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 1) '+ nvolume +'%, rgba(0, 0, 0, 0.68) '+ nvolume +'.01%)'
            parent.player.volume(nvolume)
            if(this.volumeInitialized){
                osd.show(this.volume ? lang.VOLUME + ': ' + nvolume : lang.MUTE, volIcon, 'volume', 'normal')
                this.saveVolume()
            } else {
                this.volumeInitialized = true
            }
            if(volIcon != this.lastVolIcon){
                this.lastVolIcon = volIcon
                this.updatePlayerButton('volume', null, volIcon)
            }
        }
        this.startVolumeHideTimer()
    }
    saveVolume(){
        if(this.saveVolumeTimer){
            clearTimeout(this.saveVolumeTimer)
        }
        this.saveVolumeTimer = setTimeout(() => {
            app.emit('config-set', 'volume', this.volume)
        }, 3000)
    }
}

class StreamerClientControls extends StreamerAudioUI {
    constructor(controls, app){
        super(controls, app)
        this.app.on('add-player-button', this.addPlayerButton.bind(this))
        this.app.on('update-player-button', this.updatePlayerButton.bind(this))
        this.app.on('enable-player-button', this.enablePlayerButton.bind(this))
        this.app.on('streamer-info', info => {
            this.controls.querySelector('#streamer-info > div').innerHTML = info.replaceAll("\n", "<br />")
        })
        this.on('state', state => {
            if(['loading', 'paused'].includes(state)){
                this.app.emit('streamer-update-streamer-info')
            }
        })
        idle.on('active', () => this.app.emit('streamer-update-streamer-info'))
        this.controls.innerHTML = `
    <div id="streamer-info">
        <div></div>
    </div>
    <seekbar>
        <input type="range" min="0" max="100" value="0" />
        <div>
            <div></div>
        </div>
    </seekbar>
    <div id="buttons">
        <label class="status"></label>
        <span class="filler"></span>  
    </div>    
    <div id="arrow-down-hint">
        <i class="fas fa-chevron-down"></i>
    </div>
`
        this.addPlayerButton('play-pause', 'PAUSE', `
            <i class="fas fa-play play-button"></i>
            <i class="fas fa-pause pause-button"></i>`, 0, () => {
            this.playOrPauseNotIdle()
        })
        this.addPlayerButton('stop', 'STOP', 'fas fa-stop', 1, () => {            
            if(this.casting) return this.castUIStop()
            this.stop()
        })
        this.addPlayerButton('next', 'GO_NEXT', 'fas fa-step-forward', 5, () => this.app.emit('go-next'))
        this.setupVolume()
        this.addPlayerButton('tune', 'RETRY', config['tuning-icon'], 7, () => this.app.emit('reload-dialog'))
        this.addPlayerButton('ratio', 'ASPECT_RATIO', 'fas fa-expand-alt', 10, () => {
            this.switchAspectRatio()
            let label = this.activeAspectRatio.custom ? lang.ORIGINAL : (this.activeAspectRatio.h + ':' + this.activeAspectRatio.v)
            osd.show(lang.ASPECT_RATIO +': '+ label, '', 'ratio', 'normal')
        }, 0.9)
        if(!parent.cordova && config['startup-window'] != 'fullscreen'){
            this.addPlayerButton('fullscreen', 'FULLSCREEN', 'fas fa-expand', 11, () => {
                this.toggleFullScreen()
            }, 0.85)
        }
        this.addPlayerButton('info', 'ABOUT', `
            <i class="about-icon-dot about-icon-dot-first"></i>
            <i class="about-icon-dot about-icon-dot-second"></i>
            <i class="about-icon-dot about-icon-dot-third"></i>`, 12, () => {
                !this.casting && parent.player.pause()
                this.app.emit('about')
            })
        this.controls.querySelectorAll('button').forEach(bt => {
            bt.addEventListener('touchstart', () => explorer.focus(bt))
        })
        this.emit('draw')
        $('#explorer').on('click', e => {
            if(e.target.id == 'explorer'){
                if(this.active && !explorer.inModal() && !explorer.isExploring()){
                    this.playOrPauseNotIdle()
                }
            }
        })
    }
    addPlayerButton(cls, langKey, fa, position = -1, action, scale = -1){
        const id = cls.split(' ')[0], name = lang[langKey]
        if(this.getPlayerButton(id)) return
        let container = this.controls.querySelector('#buttons')
        let iconTpl = fa.indexOf('<') == -1 ? '<i class="'+ fa +'"></i>' : fa
        let template = `
        <button id="${id}" data-position="${position}" class="${cls}" title="${name}" aria-label="${name}" data-language="${langKey}">
            <span class="button-icon">${iconTpl}</span>
            <label><span data-language="${langKey}">${name}</span></label>
        </button>
`
        if(scale != -1){
            template = template.replace('></i>', ' style="transform: scale('+ scale +')"></i>')
        }
        const bts = container.querySelectorAll('button')
        if(bts.length) {
            let ptr, type = 'after'
            Array.from(bts).some(e => {
                const btpos = parseInt(e.getAttribute('data-position'))
                if(btpos < position) {
                    ptr = e                        
                } else { // >= position
                    ptr = e
                    type = 'before'
                    return true
                }
            })
            if(type == 'after' && position >= 7 && parseInt(ptr.getAttribute('data-position')) < 7) {
                ptr = container.querySelector('span.filler')
            }
            jQuery(ptr)[type](template)
        } else {
            $(container).prepend(template)
        }
        let button = container.querySelector('#' + id)
        if(typeof(action) == 'function'){
            button.addEventListener('click', action)
        } else {
            button.addEventListener('click', () => this.app.emit(action))
        }
        if(name == 'cast' && parent.parent.Manager) parent.parent.Manager.exitPage.touch()
        this.emit('added-player-button', id, name, button, fa)
    }
    getPlayerButton(id){
        return this.controls.querySelector('#buttons #' + id.split(' ')[0])
    }
    updatePlayerButton(id, name, fa, scale = -1){
        let button = this.getPlayerButton(id)
        if(!button) return console.error('Button #'+ id +' not found')
        if(name){
            button.querySelector('label span').innerText = name
            button.setAttribute('title', name)
            button.setAttribute('aria-label', name)
        }
        if(fa){
            let template = `<i class="${fa}"></i>`
            if(scale != -1){
                template = template.replace('></i>', ' style="transform: scale('+ scale +')"></i>')
            }            
            $(button).find('i').replaceWith(template)
        }
        this.emit('updated-player-button', id, name, button, fa)
    }
    enablePlayerButton(id, show){
        let button = this.getPlayerButton(id)
        if(button){
            button.style.display = show ? 'inline-flex' : 'none'
        } else {
            console.error('Button '+ id +' not found')
        }
    }
}

class StreamerClientController extends StreamerClientControls {
    constructor(controls, app){
        super(controls, app)
        this.active = false
        parent.player.on('show', () => this.emit('show'))
        parent.player.on('hide', () => this.emit('hide'))
    }
    start(src, mimetype, cookie, mediatype){
        this.active = true
        this.activeSrc = src
        this.activeSubtitle = this.data.subtitle || ''
        this.activeCookie = cookie
        this.activeMimetype = (mimetype || '').toLowerCase()
        this.activeMediatype = mediatype
        this.inLiveStream = ['live', 'audio'].includes(this.activeMediatype)
        parent.player.load(src, mimetype, this.activeSubtitle, cookie, this.activeMediatype, this.data)
        this.emit('start')
    }
    stop(fromServer){
        if(this.active){
            this.active = false
            this.activeSrc = ''
            this.activeMimetype = ''
            parent.player.unload()
            console.log('STOPCLIENT', fromServer, traceback())
            if(fromServer !== true){
                this.app.emit('stop')
            }
            this.emit('stop')
        }
    }
}

class StreamerClient extends StreamerClientController {
    constructor(controls, app){
        super(controls, app)
        this.app = app
        this.bind()
    }
    errorCallback(src, mimetype){
        if(this.autoTuning && !this.transcodeStarting && this.stateListening && mimetype.indexOf('video/') == -1){ // seems live
            explorer.dialog([
                {template: 'question', text: '', fa: 'fas fa-question-circle'},
                {template: 'option', text: lang.PLAY_ALTERNATE, id: 'tune', fa: config['tuning-icon']},
                {template: 'option', text: lang.STOP, id: 'stop', fa: 'fas fa-stop-circle'},
                {template: 'option', text: lang.RETRY, id: 'retry', fa: 'fas fa-sync'}
            ], choose => {
                switch(choose){
                    case 'tune':
                        this.app.emit('tune')
                        break
                    case 'retry':
                        this.app.emit('retry')
                        break
                    default: // stop or false (dialog closed)
                        this.stop()
                        break
                }
                return true
            }, 'tune')
        }
    }
    bind(){
        this.app.on('pause', () => {
            console.warn('PAUSE')
            parent.player.pause()
        })
        this.app.on('debug-tuning', () => {
            this.debugTuning = true
        })
        this.app.on('streamer-connect', (src, mimetype, cookie, mediatype, data, autoTuning) => {
            if(this.debugTuning){
                osd.show('CONNECT '+ data.name, 'fas fa-info-circle faclr-red', 'debug2', 'normal')
            }
            this.animating = true
            this.bindStateListener()
            if(this.isTryOtherDlgActive()){
                explorer.endModal()
            }
            this.data = data
            this.autoTuning = autoTuning
            console.warn('CONNECT', src, mimetype, cookie, mediatype, data, autoTuning)
            this.start(src, mimetype, cookie, mediatype)
            osd.hide('streamer')
            setTimeout(() => {
                this.animating = false
                this.emit('animated')
                this.emit('animated') // should call it twice
            }, 150)  
        })
        this.app.on('transcode-starting', state => { // used to wait for transcoding setup when supported codec is found on stream
            console.warn('TRANSCODING', state)
            this.transcodeStarting = state
            if(state){
                osd.hide('debug-conn-err')
                osd.hide('streamer')
            }
            state = state ? 'loading' : this.state
            this.stateListener(state, null, true)
            this.speedoUpdate()
        })
        this.app.on('streamer-connect-suspend', () => { // used to wait for transcoding setup when supported codec is found on stream
            this.unbindStateListener()
            if(parent.player.current && parent.player.current.hls){
                parent.player.current.hls.stopLoad()
            }
            parent.player.pause()
            this.stateListener('loading')
        })
        this.app.on('streamer-disconnect', (err, autoTuning) => {
            this.unbindStateListener()
            console.warn('DISCONNECT', err, autoTuning)
            this.autoTuning = autoTuning
            this.stop(true)  
        })
    }
}
