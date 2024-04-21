import { EventEmitter } from 'events'
import { main } from '../bridge/renderer'
import { css, time, kbsfmt } from '../../renderer/src/scripts/utils'
import { zapSetup } from '../../modules/zap/renderer'

class StreamerPlaybackTimeout extends EventEmitter {
    constructor(controls){
        super()
        this.setMaxListeners(20)
        this.controls = controls
        this.playbackTimeout = 25000
        this.playbackTimeoutTimer = 0
        this.on('state', s => {
            if(s == 'loading'){
                if(!this.playbackTimeoutTimer){
                    this.playbackTimeoutTimer = setTimeout(() => {
                        console.warn('STUCK')
                        this.emit('stuck')
                        clearTimeout(this.playbackTimeoutTimer)
                        player.current && player.current.reload()
                        this.playbackTimeoutTimer = 0
                        main.emit('video-error', 'timeout', 'client playback timeout')
                    }, this.playbackTimeout)
                }
            } else {
                this.cancelTimeout()
            }
        })        
        this.on('stop', () => {
            this.cancelTimeout()
        })
        main.on('streamer-reset-timeout', err => {
            clearTimeout(this.playbackTimeoutTimer)
            this.playbackTimeoutTimer = 0
        })
    }
    cancelTimeout(){
        main.osd.hide('debug-timeout')
        main.osd.hide('timeout')
        clearTimeout(this.playbackTimeoutTimer)
        this.playbackTimeoutTimer = 0
        if(this.isTryOtherDlgActive()){
            main.menu.endModal()
        }
    }
    isTryOtherDlgActive(){
        return !!document.getElementById('modal-template-option-wait')
    }
    ended(){
        clearTimeout(this.playbackTimeoutTimer)
        if(this.inLiveStream){
            main.emit('video-error', 'timeout', 'remote server timeout or end of stream')
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
    constructor(controls){
        super(controls)
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
                    main.osd.hide(this.osdID + '-sub')
                    main.osd.show(main.lang.ENDED, 'fas fa-play', this.osdID, 'persistent')
                    break
                case 'paused':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    this.OSDNameShown = false
                    main.osd.hide(this.osdID + '-sub')
                    if(this.seekTimer){
                        main.osd.hide(this.osdID)
                    } else {
                        main.osd.show(main.lang.PAUSED +'<span style="opacity: var(--opacity-level-2)"> &nbsp;&middot;&nbsp; </span>'+ this.data.name, 'fas fa-play', this.osdID, 'persistent')
                    }
                    break
                case 'loading':
                    main.osd.hide(this.osdID + '-sub')
                    main.osd.hide(this.osdID)
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    if(this.transcodeStarting){
                        main.osd.show(main.lang.TRANSCODING_WAIT, 'fas fa-circle-notch fa-spin', this.osdID, 'persistent')
                        main.osd.hide(this.osdID +'-sub')
                    } else {
                        this.transmissionNotWorkingHintTimer = setTimeout(() => {
                            if(this.active){
                                main.osd.hide(this.osdID)
                                if(this.autoTuning){
                                    const icon = this.isZapping ? this.zappingIcon : main.config['tuning-icon']
                                    main.osd.show(main.lang.BROADCAST_NOT_WORKING_HINT.format('<i class=\"'+ icon +'\"></i>'), '', this.osdID +'-sub', 'persistent')
                                }
                                main.emit('streamer-is-slow')
                            }
                        }, this.transmissionNotWorkingHintDelay)                    
                    }
                    break
                case 'playing':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    main.osd.hide(this.osdID + '-sub')
                    main.osd.hide(this.osdID)
                    if(!this.OSDNameShown){
                        this.OSDNameShown = true
                        if(this.autoTuning){
                            const icon = this.isZapping ? this.zappingIcon : main.config['tuning-icon']
                            main.osd.show(main.lang.BROADCAST_NOT_WORKING_HINT.format('<i class=\"'+ icon +'\"></i>'), '', this.osdID +'-sub', 'normal')
                        }
                        main.osd.show(this.data.name, this.data.icon || '', this.osdID, 'normal')
                    }
                    break
                case '':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    main.osd.hide(this.osdID + '-sub')
                    main.osd.hide(this.osdID)
            }
        })        
        this.on('stop', () => {
            clearTimeout(this.transmissionNotWorkingHintTimer)
            this.OSDNameShown = false
            main.osd.hide(this.osdID + '-sub')
            main.osd.hide(this.osdID)
        })
    }    
}

class StreamerCasting extends StreamerOSD {
    constructor(controls){
        super(controls)
        this.casting = false
        this.castingPaused = false
        main.on('cast-start', () => this.castUIStart())
        main.on('cast-stop', () => this.castUIStop())
        main.on('external-player', url => {
            parent.Manager.externalPlayer.play(url).catch(err => {
                console.error(err)
                main.osd.show(String(err), 'fas fa-exclamation-triangle faclr-red', 'external-player', 'normal')
            })
        })
        this.on('before-seek', s => {
            if(this.casting){
                if(!player.otime){
                    player.otime = player.time
                }
                if(!player.oresume){
                    player.oresume = player.resume
                }
                player.time = () => {}
                player.resume = () => {}
                this.emit('state', 'paused')
                this.seekBarUpdate(true, s)
            }
        })
        this.on('after-seek', s => {
            if(this.casting){
                this.seekBarUpdate(true, s)
                player.time = player.otime
                player.resume = player.oresume
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
                    player.pause()
                } else if(s == ''){
                    this.casting = false
                    this.castingPaused = false
                    document.body.classList.remove('casting')
                }
            }
        })
    }
    castUIStart() {        
        if(!this.casting){
            this.casting = true
            this.castingPaused = false
            this.unbindStateListener()
            player.pause()
            this.stateListener('playing')
            document.body.classList.add('casting')
            this.inLiveStream && document.body.classList.add('casting-live')
            this.emit('cast-start')
        }
    }
    castUIStop() { 
        if(this.casting){
            this.casting = false
            this.castingPaused = false
            document.body.classList.remove('casting')
            document.body.classList.remove('casting-live')
            this.emit('cast-stop')
            main.emit('cast-stop')
            if(this.active){
                this.bindStateListener()
                if(player.state){
                    player.resume()
                } else {
                    player.load(this.activeSrc, this.activeMimetype, this.activeSubtitle, this.activeCookie, this.activeMediatype, this.data)
                    this.stateListener('loading')
                }
            }
        }
    }
}

class StreamerState extends StreamerCasting {
    constructor(controls){
        super(controls)
        this.state = ''
        this.stateListener = (s, data, force) => {
            if(s != this.state || force){
                if(this.state == 'ended') {
                    main.emit('video-resumed')
                }
                this.state = s
                console.log('STREAMER-STATE', this.state)
                switch(this.state){
                    case 'paused':
                        this.controls.querySelector('.play-button').style.display = 'inline-flex'
                        this.controls.querySelector('.pause-button').style.display = 'none'
                        break
                    case 'loading':
                    case 'playing':
                        this.controls.querySelector('.play-button').style.display = 'none'
                        this.controls.querySelector('.pause-button').style.display = 'inline-flex'
                        break
                    case 'ended':                    
                        this.controls.querySelector('.play-button').style.display = 'inline-flex'
                        this.controls.querySelector('.pause-button').style.display = 'none'
                        main.emit('video-ended')
                        break
                    case 'error':
                        main.emit('video-error', 'playback', data ? String(data.details || data) : 'playback error')
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
            if(window.capacitor){
                player.once('timeupdate', () => { // only on initial timeupdate of each stream to fix bad loading status on Exoplayer, bad behaviour with hls.js on PC
                    if(this.state == 'loading'){
                        this.stateListener('playing')
                    }
                })
            }
        })
        this.on('stop', () => this.stateListener(''))
        main.on('streamer-show-tune-hint', () => {
            const next = () => {
                main.menu.dialog([
                    {template: 'question', text: document.title, fa: 'fas fa-info-circle'},
                    {template: 'message', text: main.lang.TUNING_HINT.format('<i class=\'fas '+ main.config['tuning-icon'] +'\'></i>')},
                    {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                ])
            }
            if(this.animating){
                this.once('animated', next)
            } else {
                next()
            }
        })
        main.on('streamer-client-pause', () => {
            const should = !this.casting && player.state != 'paused'
            if(should) {
                player.pause()
            }
        })
        main.on('streamer-client-resume', () => {
            const should = !this.casting && player.state == 'paused'
            if(should) {
                player.resume()
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
        player.on('timeupdate', position => {
            if(!this.inLiveStream && position >= 30){
                const now = time()
                if(now > (this.lastPositionReportingTime + this.positionReportingInterval)){
                    this.lastPositionReportingTime = now
                    let duration = player.duration()
                    if(duration && duration > 0){
                        this.lastPositionReported = position
                        main.emit('state-atts', this.data.url, {duration, position, source: this.data.source})
                    }
                }
            }
        })
        main.on('resume-dialog', (position, duration) => {
            const next = () => {
                console.warn('RESUME', position)
                const next = choose => {
                    switch(choose){
                        case 'resume':
                            player.time(position) // no "break;" here
                        default:
                            player.resume()
                            break
                    }
                    return true
                }
                if(position > (duration * 0.8)) {
                    player.pause()
                    main.menu.dialog([
                        {template: 'question', text: main.lang.CONTINUE, fa: 'fas fa-redo-alt'},
                        {template: 'option', text: main.lang.RESUME_FROM_X.format(this.hmsSecondsToClock(position)), id: 'resume', fa: 'fas fa-redo-alt'},
                        {template: 'option', text: main.lang.PLAY_FROM_START, id: 'play', fa: 'fas fa-play'}
                    ], next, 'resume-from')
                } else {
                    next('resume')
                }
            }
            if(this.animating){
                this.once('animated', next)
            } else {
                next()
            }
        })
    }
    bindStateListener(){
        if(!player.listeners('state').includes(this.stateListener)){
            player.on('state', this.stateListener)
        }
        this.stateListening = true
    } 
    unbindStateListener(){
        console.log('STREAMER-UNBINDSTATELISTENER')
        player.removeListener('state', this.stateListener)
        this.stateListening = false
    }
    playOrPause(){
        if(this.active && player.state){
            if(['paused', 'ended'].includes(player.state)){
                if(this.casting){
                    if(this.castingPaused){
                        this.castingPaused = false
                        this.stateListener('playing')
                        main.emit('streamer-resume')
                    } else {
                        this.castingPaused = true
                        this.stateListener('paused')
                        main.emit('streamer-pause')
                    }
                } else {
                    if(main.config['unpause-jumpback']){
                        const time = player.time()
                        if(time){
                            const ntime = Math.max(player.time() - main.config['unpause-jumpback'], 0)
                            if(ntime < time){
                                player.time(ntime)
                            }
                        }
                    }
                    player.resume()
                    main.emit('streamer-resume')
                }
            } else {
                player.pause()
                main.emit('streamer-pause')
            }
        }
    }
    playOrPauseNotIdle(){
        let _idle = main.idle.isIdle || main.idle.lastIdleTime > ((Date.now() / 1000) - 0.5)
        console.error('playOrPauseNotIdle() '+ (_idle?'Y':'N'), main.idle.isIdle, main.idle.lastIdleTime)
        if(!_idle){
            this.playOrPause()
        }
    }
    isTuning(){
        if(!main.osd) return ''
        let txt = main.osd.textContent()
        return txt.indexOf(main.lang.TUNING) != -1 || txt.indexOf(main.lang.CONNECTING) != -1
    }
}

class StreamerClientVideoAspectRatio extends StreamerState {
    constructor(container){
        super(container)
        this.aspectRatioList = [
            {h: 16, v: 9},
            {h: 4, v: 3},
            {h: 16, v: 10},
            {h: 21, v: 9}
        ]
        this.activeAspectRatio = this.aspectRatioList[0]
        this.landscape = window.innerWidth > window.innerHeight
        window.addEventListener('resize', () => this.resize(), {passive: true})
        player.on('setup-ratio', r => this.setupAspectRatio())
        main.on('ratio', () => this.switchAspectRatio())
        this.on('stop', () => {
            this.aspectRatioList = this.aspectRatioList.filter(m => typeof(m.custom) == 'undefined')
            this.activeAspectRatio = this.aspectRatioList[0]
        })
    }
    resize() {
        let landscape = window.innerWidth > window.innerHeight
        if(landscape != this.landscape){ // orientation changed
            this.landscape = landscape
            setTimeout(() => this.applyAspectRatio(this.activeAspectRatio), 500) // give a delay to avoid confusion
        } else {
            this.applyAspectRatio(this.activeAspectRatio)
        }
        window.capacitor && plugins.megacubo.getAppMetrics()
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
        return player.videoRatio()
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
        player.ratio(r.h / r.v)
    }
}

class StreamerIdle extends StreamerClientVideoAspectRatio {
    constructor(controls){
        super(controls)
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
        main.idle.on('idle', () => {
            const c = document.body.className || ''
            if(!c.match(rgxIsIdle)){
                document.body.className += ' idle'
            }
            player.uiVisible(false)
        })
        main.idle.on('active', () => {
            const c = document.body.className || ''
            if(c.match(rgxIsIdle)){
                document.body.className = c.replace(rgxIsIdle, ' ').trim()
            }
            player.uiVisible(true)
        })
    }   
}

class StreamerSpeedo extends StreamerIdle {
    constructor(controls){
        super(controls)
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
                        let duration = player.duration()
                        if(duration && duration > 0){
                            this.speedoDurationReported = true
                            main.emit('streamer-duration', duration)
                        }
                    }
                    break
                case '':
                    this.speedoSemSet(-1, main.lang.WAITING_CONNECTION)
            }
        })
        this.on('start', () => {
            this.commitTime = time()
            this.state = 'loading'
            this.speedoReset()
            this.seekBarReset()
            main.emit('downlink', this.downlink())
            if(this.isLocal()){
                return this.speedoSemSet(-1, '')
            }
        })
        this.on('stop', () => {
            this.bitrate = 0
            this.currentSpeed = 0
            this.speedoDurationReported = false
        })
        main.on('streamer-speed', speed => {
            this.currentSpeed = speed
            this.speedoUpdate()
        })
        main.on('streamer-bitrate', bitrate => {
            this.bitrate = bitrate
            this.speedoUpdate()
        })
        navigator.connection.addEventListener('change', () => { // seems not reliable, so we'll be sending downlink in other moments too        
            console.log('NAVIGATOR.CONNECTION CHANGED!!!')
            this.speedoUpdate()
            main.emit('downlink', this.downlink())
        }, {passive: true})
        main.emit('downlink', this.downlink())
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
            main.emit('downlink', downlink)
        }
        return downlink
    }
    speedoReset(){
        this.speedoSemSet(-1, main.lang.WAITING_CONNECTION)
    }
    speedoUpdate(){
        if(!player.state){
            return
        }
        if(this.isLocal()){
            return this.speedoSemSet(-1, '')
        }
        let semSet, starting = !this.commitTime || (time() - this.commitTime) < 15
        let lowSpeedThreshold = (250 * 1024) /* 250kbps */, downlink = this.downlink(this.currentSpeed)
        //console.error('SPEEDOUPDATE', starting, this.commitTime, time(), this.currentSpeed, this.bitrate, downlink)
        if(this.invalidSpeeds.includes(this.currentSpeed)) {
            this.speedoSemSet(-1, this.transcodeStarting ? main.lang.TRANSCODING_WAIT : main.lang.WAITING_CONNECTION)
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
                    t = main.lang.WAITING_CONNECTION
                } else if(downlink && downlink < this.bitrate){ // client connection is the throattling factor
                    t += main.lang.YOUR_CONNECTION_IS_SLOW_TIP.format('<i class="'+ main.config['tuning-icon'] +'"></i>') + ': '
                } else { // slow server?
                    t += main.lang.SLOW_SERVER + ': '
                }
                t += ' '+ p + '%'
                if(p < 80){
                    semSet = 2
                } else if(p < 100){
                    semSet = 1
                } else {
                    semSet = 0
                    t = main.lang.STABLE_CONNECTION
                }
            } else {
                if(starting){
                    t = main.lang.WAITING_CONNECTION
                } else {
                    t = main.lang.SLOW_SERVER + ': ' + kbsfmt(this.currentSpeed)
                }
                if(this.currentSpeed <= lowSpeedThreshold){
                    semSet = starting ? -1 : 2
                } else {                   
                    semSet = 1
                }
            }
            if(this.transcodeStarting){
                t = main.lang.TRANSCODING_WAIT                
            }
            this.speedoSemSet(semSet, t)
        }
    }
    speedoSemSet(s, txt){
        if(s !== this.currentSem || this.transcodeStarting){
            const colors = ['green', 'orange', 'red']
            this.currentSem = s
            this.speedoLabel.innerHTML = txt
            const speedoSemInfoButton = [
                this.getPlayerButton('stream-info'),
                document.querySelector('seekbar'),
                document.querySelector('button.recording')
            ].filter(e => e)
            colors.forEach((color, i) => {
                speedoSemInfoButton.forEach(e => {
                    e.classList[i == s ? 'add' : 'remove']('faclr-'+ color)
                })
            })
        }
    }
}

class StreamerButtonActionFeedback extends StreamerSpeedo {
    constructor(controls){
        super(controls)
        this.buttonActionFeedbackTimer = 0
        this.buttonActionFeedbackIgnores = ['stop', 'stream-info', 'tune', 'volume']
        this.buttonActionFeedbackListeners = {}
        this.on('draw', () => {
            this.buttonActionFeedbackLayer = document.querySelector('#button-action-feedback')
            this.buttonActionFeedbackLayer.style.visibility = 'visible'
            this.buttonActionFeedbackLayerInner = this.buttonActionFeedbackLayer.querySelector('span')
        })
        this.on('added-player-button', this.addedPlayerButton.bind(this))
        this.on('updated-player-button', this.updatedPlayerButton.bind(this))
    }
    addedPlayerButton(id, name, button, fa) {
        if(this.buttonActionFeedbackIgnores.includes(id)) return
        this.buttonActionFeedbackListeners[name] = () => this.buttonActionFeedback(id, fa)
        button.addEventListener('click', this.buttonActionFeedbackListeners[name], {passive: true})
    }
    updatedPlayerButton(id, name, button, fa) {
        if(this.buttonActionFeedbackIgnores.includes(id)) return
        console.warn('updatedPlayerButton', id, name, button, fa)
        button.removeEventListener('click', this.buttonActionFeedbackListeners[name])
        this.buttonActionFeedbackListeners[name] = () => this.buttonActionFeedback(id, fa)
        button.addEventListener('click', this.buttonActionFeedbackListeners[name], {passive: true})
    }
    buttonActionFeedback(id, fa) {
        if(['paused', 'loading'].includes(this.state)) return
        if(id == 'play-pause') {
            if(this.state == 'playing') return
            fa = 'fas fa-play'
        }
        clearTimeout(this.buttonActionFeedbackTimer)        
        this.buttonActionFeedbackLayerInner.innerHTML = '<i class="'+ fa +'" style="transform: scale(1); opacity: 1;"></i>'
        this.buttonActionFeedbackLayer.style.display = 'inline-block'
        const i = this.buttonActionFeedbackLayerInner.querySelector('i')
        i.style.transform = 'scale(1.5)'
        i.style.opacity = '0.01'
        this.buttonActionFeedbackTimer = setTimeout(() => {
            this.buttonActionFeedbackLayer.style.display = 'none'
        }, 500)
    }
}

class StreamerSeek extends StreamerButtonActionFeedback {
    constructor(controls){
        super(controls)
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
            this.seekbarLabel = this.controls.querySelector('span.status')
            this.seekbarNput = this.seekbar.querySelector('input')
            this.seekbarNputVis = this.seekbar.querySelector('div > div')
            this.seekbarNput.addEventListener('input', () => {
                if(this.active){
                    console.log('INPUTINPUT', this.seekbarNput.value)
                    this.seekByPercentage(this.seekbarNput.value)
                }
            }, {passive: true})
            this.seekRewindLayerCounter = document.querySelector('div#seek-back > span.seek-layer-time > span') 
            this.seekForwardLayerCounter = document.querySelector('div#seek-fwd > span.seek-layer-time > span') 
            main.idle.on('active', () => this.seekBarUpdate(true))
            this.seekBarUpdate(true)
        })
        this.on('state', s => {
            if(['playing', 'error', ''].includes(s)){
                this.seekingFrom = null
                console.log('removing seek layers', s)
                document.body.classList.remove('seek-back')
                document.body.classList.remove('seek-fwd')
                if(s == 'playing'){                    
                    this.seekBarUpdate(true)
                }
            }
            switch(s){
                case 'playing':
                    if(!this.seekPlaybackStartTime){
                        const duration = player.duration()
                        this.seekPlaybackStartTime = time() - duration
                    }
                    break
                case '':
                    this.seekPlaybackStartTime = 0
                    break
            }
        })
        player.on('timeupdate', () => {
            if(player.uiVisibility){
                this.seekBarUpdate()
            }
        })
        player.on('durationchange', uiVisible => {
            const duration = player.duration()
            if(this.seekLastDuration > duration){ // player reset
                this.seekPlaybackStartTime = time() - duration
            }
            this.seekLastDuration = duration
            if(uiVisible) this.seekBarUpdate()
        })
        player.on('play', () => {
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
            if(!['paused', 'ended', 'loading'].includes(player.state) || force === true){
                if(this.seekbarNput && (!window.isIdle || player.state != 'playing' || force === true)){
                    if(typeof(time) != 'number'){
                        time = player.time()
                    }
                    let percent = this.seekPercentage(time), duration = player.duration()
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
        if(this.active && this.seekbarNput && player.state == 'loading'){
            let percent = this.seekPercentage(), d = player.duration(), t = player.time()
            this.seekbarLabel.innerHTML = this.seekbarLabelFormat(t, d)
            if(percent != this.lastPercent){
                this.seekBarUpdateView(percent)
            }
        }
    }
    seekbarLabelFormat(t, d){        
        let txt
        if(this.inLiveStream && main.config['use-local-time-counter']){
            txt = moment.unix(this.clockTimerCurrentTime()).format('LTS') //.replace(new RegExp('(\\d\\d:\\d\\d)(:\\d\\d)'), '$1<font style="opacity: var(--opacity-level-2);">$2</font>')
        } else {
            txt = this.hms(t) +' <font style="opacity: var(--opacity-level-2);">/</font> '+ this.hms(d)
        }
        return txt
    }
    seekPercentage(time){
        if(!this.active) return 0
        if(typeof(time) != 'number'){
            time = player.time()
        }
        let minTime = 0, duration = player.duration()
        if(!duration){
            return 0
        }
        if(this.inLiveStream){
            minTime = duration - main.config['live-window-time']
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
        let minTime = 0, time = player.time(), duration = player.duration()
        if(this.inLiveStream){
            minTime = duration - main.config['live-window-time']
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
        console.log('SEEK PERCENT', percent, minTime, player.time(), player.duration(), duration, ret)
        return ret
    }
    seekByPercentage(percent){        
        if(this.active){
            let now = player.time(), s = this.seekTimeFromPercentage(percent)
            this.seekTo(s, now > s ? 'rewind' : 'forward')
            main.emit('streamer-seek', s)
            this.seekBarUpdate(true)
        }
    }
    seekTo(_s, type){
        if(!this.state) return
        if(window.capacitor && this.activeMimetype == 'video/mp2t') {
            clearTimeout(this.seekFailureTimer)
            this.seekFailureTimer = setTimeout(() => main.emit('streamer-seek-failure'), 2000)
            return
        }
        if(typeof(this.seekingFrom) != 'number'){
            this.seekingFrom = player.time()
        }
        let s = _s, minTime = 0, duration = player.duration(), maxTime = Math.max(0, duration - 2)
        if(this.inLiveStream){
            minTime = duration - main.config['live-window-time']
            if(this.seekingFrom < minTime){
                minTime = this.seekingFrom
            }
            if(player.current.object.buffered && player.current.object.buffered.length){
                let bs = player.current.object.buffered.start(0)
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
            player.resume()
        }, 1500)
        let diff = parseInt(s - this.seekingFrom)
        player.pause()
        player.time(s)
        this.emit('after-seek', s)
        console.log('seeking pre', diff, s, this.seekingFrom)
        if(this.seekLayerRemoveTimer){
            clearTimeout(this.seekLayerRemoveTimer)
        }
        if(diff < 0){
            this.seekRewindLayerCounter.innerText = '-' + this.hmsMin(diff)
            document.body.classList.remove('seek-fwd')
            document.body.classList.add('seek-back')
        } else if(diff > 0) {
            this.seekForwardLayerCounter.innerText = '+' + this.hmsMin(diff)
            document.body.classList.remove('seek-back')
            document.body.classList.add('seek-fwd')
        } else {
            if(type){
                if(type == 'rewind'){
                    this.seekRewindLayerCounter.innerText = this.hmsMin(diff)
                    document.body.classList.add('seek-back')
                    document.body.classList.remove('seek-fwd')
                } else {
                    this.seekForwardLayerCounter.innerText = this.hmsMin(diff)
                    document.body.classList.remove('seek-back')
                    document.body.classList.add('seek-fwd')
                }
            } else {
                document.body.classList.remove('seek-back')
                document.body.classList.remove('seek-fwd')
            }
        }
        this.seekLayerRemoveTimer = setTimeout(() => {            
            document.body.classList.remove('seek-back')
            document.body.classList.remove('seek-fwd')
        }, 3000)
        this.seekBarUpdate(true, s)
    }
    seekRewind(steps=1){
        if(this.active){
            let now = player.time(), nct = now - (steps * this.seekSkipSecs)
            this.seekTo(nct, 'rewind')
        }
    }
    seekForward(steps=1){
        if(this.active){
            let now = player.time(), nct = now + (steps * this.seekSkipSecs)
            this.seekTo(nct, 'forward')
        }
    }
}

class StreamerLiveStreamClockTimer extends StreamerSeek {
    constructor(controls){
        super(controls)
        this.useLiveStreamClockTimer = true
        this.calcOverDuration = true
        this.on('start', () => {
            this.resetClockTimer()
        })
        player.on('durationchange', () => {
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
        const duration = player.duration()
        this.altPlaybackStartTime = time() - duration // ease up the cummulating differences in clock time x player time
        if(duration < this.clockTimerLastDuration){ // player resetted
            this.resetClockTimer()
        }
    }
    resetClockTimer(){
        const now = time(), duration = player.duration()
        this.calcOverDuration = true
        this.playbackStartTime = now
        this.initialPlaybackTime = player.time()
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
        const playbackTime = player.time(), stime = this.calcOverDuration ? this.altPlaybackStartTime : this.playbackStartTime
        return stime + (playbackTime - this.initialPlaybackTime)
    }
}

class StreamerClientTimeWarp extends StreamerLiveStreamClockTimer {
    constructor(controls){
        super(controls)
        this.maxRateChange = 0.15
        this.defaultBufferTimeSecs = {
            pressure: 6,
            lazy: 20
        }
        this.currentPlaybackRate = 1
        player.on('timeupdate', pos => this.doTimeWarp(pos))
        player.on('durationchange', () => this.doTimeWarp())
        main.on('streamer-connect', (src, mimetype, cookie, mediatype) => {
            if(!main.config['in-disk-caching-size'] && mimetype.toLowerCase().indexOf('mpegurl') != -1 && mediatype != 'video') {
                this.bufferTimeSecs = this.defaultBufferTimeSecs.pressure
            } else {
                this.bufferTimeSecs = this.defaultBufferTimeSecs.lazy
            }            
            player.playbackRate(0.9) // start with caution
        })
        main.on('outside-of-live-window', () => this.syncLiveWindow())
        this.on('stuck', () => this.syncLiveWindow())
    }
    syncLiveWindow() {
        if(!this.inLiveStream) return
        const currentTime = player.time()
        const nudge = 10
        let duration, pduration = player.duration()
        if(!main.config['in-disk-caching-size'] && this.activeMimetype.indexOf('mpegurl') != -1 && this.activeMediatype != 'video') {
            duration = this.clockTimerDuration()
        } else {
            duration = pduration
        }
        let minSeekTime = parseInt(duration - (main.config['live-window-time'] + nudge))
        if(minSeekTime && minSeekTime > (currentTime + nudge)) this.seekTo(minSeekTime, 'forward')
    }
    doTimeWarp(ptime){
        if(this.inLiveStream && main.config['playback-rate-control'] && this.timewarpInitialPlaybackTime !== null){
            /*
            On HLS we'll try to avoid gets behind live window.
            On MPEGTS we'll just keep the buffer for smooth playback.
            */
            if(typeof(ptime) != 'number') {
                ptime = player.time()
            }
            let duration, pduration = player.duration()
            if(!main.config['in-disk-caching-size'] && this.activeMimetype.indexOf('mpegurl') != -1 && this.activeMediatype != 'video') {
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
                player.playbackRate(rate)
            }
        }
    }
	hmsSecondsToClock(secs) {
		var sec_num = parseInt(secs, 10); // don't forget the second param
		var hours   = Math.floor(sec_num / 3600);
		var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
		var seconds = sec_num - (hours * 3600) - (minutes * 60);    
		if (hours   < 10) {hours   = "0"+hours;}
		if (minutes < 10) {minutes = "0"+minutes;}
		if (seconds < 10) {seconds = "0"+seconds;}
		return hours+':'+minutes+':'+seconds;
	}
}

class StreamerAndroidNetworkIP extends StreamerClientTimeWarp {
    constructor(controls){ // helper for Android 10+, Node.JS won't be able to pick the network IP by itself
        super(controls)
        if(window.capacitor){
            plugins.megacubo.on('network-ip', ip => {
                if(ip){
                    console.warn('Network IP received: '+ ip)
                    main.emit('network-ip', ip)
                }
            })
            this.updateNetworkIp()
            this.on('start', () => this.updateNetworkIp())
        }
    }
    updateNetworkIp(){
        plugins.megacubo.getNetworkIp()
    }
}

class StreamerClientVideoFullScreen extends StreamerAndroidNetworkIP {
    constructor(controls){
        super(controls)
        let b = this.controls.querySelector('button.fullscreen')
        if(main.config['startup-window'] != 'fullscreen'){
            if(window.capacitor){
                this.inFullScreen = true // bugfix for some devices
                this.leaveFullScreen()
                this.on('fullscreenchange', () => {
                    this.updateAndroidAppMetrics()
                    plugins.megacubo.getAppMetrics()
                })
                if(b){
                    b.style.display = 'none'
                }
                let timer = 0
                this.on('start', () => {
                    clearTimeout(timer)
                    this.enterFullScreen() // start ASAP, no timer
                    timer = setTimeout(() => { // ensure fullscreen on video
                        this.active && this.enterFullScreen
                    }, 200)
                })
                this.on('stop', () => {
                    clearTimeout(timer)
                    // wait a bit, maybe it will start again immediately, like when tuning
                    timer = setTimeout(() => {
                        this.active || this.leaveFullScreen()
                    }, 500)
                })
                plugins.megacubo.on('appmetrics', this.updateAndroidAppMetrics.bind(this))
                plugins.megacubo.on('nightmode', this.handleDarkModeInfoDialog.bind(this))
                this.updateAndroidAppMetrics(plugins.megacubo.appMetrics)
            } else {
                this.inFullScreen = false
                if(b) b.style.display = 'inline-flex'
            }
            this.on('fullscreenchange', fs => {
                if(fs){
                    document.body.classList.add('fullscreen')
                } else {
                    document.body.classList.remove('fullscreen')
                }
            })
        } else {
            this.inFullScreen = true
            document.body.classList.add('fullscreen')
            if(b) b.style.display = 'none'
            this.enterFullScreen()
        }
    }
    handleDarkModeInfoDialog(info){
        if(info.miui && info.mode && info.mode != 16){
            main.menu.dialog([
                {template: 'question', text: document.title, fa: 'fas fa-info-circle'},
                {template: 'message', text: main.lang.MIUI_DARK_MODE_HINT},
                {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
            ])
        }
    }
    updateAndroidAppMetrics(metrics){
        if(this.inFullScreen){
            css(' :root { --menu-padding-top: 0px; --menu-padding-bottom: 0.5vmin; --menu-padding-right: 0.5vmin; --menu-padding-left: 0.5vmin; } ', 'frameless-window')
        } else {
            if(metrics && metrics.top){
                this.lastMetrics = metrics
            } else {
                metrics = this.lastMetrics
            }            
            if(metrics) {
                css(' :root { --menu-padding-top: ' + metrics.top + 'px; --menu-padding-bottom: calc(0.5vmin +  ' + metrics.bottom + 'px); --menu-padding-right:  calc(0.5vmin +  ' + metrics.right + 'px); --menu-padding-left: calc(0.5vmin +  ' + metrics.left + 'px); } ', 'frameless-window')
            }
        }
    }
    updateAfterLeaveAndroidMiniPlayer(){
        if(screen.width == window.outerWidth && screen.height == window.outerHeight && this.active){
            this.enterFullScreen()
        }
    }
    enterFullScreen(){
        if(window.capacitor){
            if(!this.pipLeaveListener){
                this.pipLeaveListener = () => {
                    console.log('LEAVING PIP', screen.width, screen.height, window.outerWidth, window.outerHeight, this.active)
                    this.updateAfterLeaveAndroidMiniPlayer()
                }
            }
            AndroidFullScreen.immersiveMode(() => {}, console.error)
            if(!winActions.listeners('leave').includes(this.pipLeaveListener)){
                winActions.on('leave', this.pipLeaveListener)
            }
        } else {
            parent.Manager.setFullScreen(true)
        }
        this.inFullScreen = true
        this.emit('fullscreenchange', this.inFullScreen)
    }
    leaveFullScreen(){
        if(this.inFullScreen){
            this.inFullScreen = false
            if(window.capacitor){
                if(this.pipLeaveListener){
                    winActions.removeListener('leave', this.pipLeaveListener)
                }
                AndroidFullScreen.immersiveMode(() => {
                    setTimeout(() => { // bugfix for some devices
                        AndroidFullScreen.immersiveMode(() => {
                            AndroidFullScreen.showSystemUI(() => {
                                AndroidFullScreen.showUnderSystemUI(() => {}, console.error)
                            }, console.error)
                        }, console.error);
                    }, 10)
                }, console.error)
            } else {
                parent.Manager.setFullScreen(false)
            }
            this.emit('fullscreenchange', this.inFullScreen)
        }
    }
    toggleFullScreen(){
        if(this.inFullScreen){
            this.leaveFullScreen()
        } else {
            if(winActions && winActions.inPIP) {
                winActions.leave().catch(console.error)
            } else {
                this.enterFullScreen()
            }
        }
    }
}

class StreamerAudioUI extends StreamerClientVideoFullScreen {
    constructor(controls){
        super(controls)
        this.isAudio = false
        main.on('codecData', codecData => {
            if(codecData.audio && !codecData.video){
                this.isAudio = true
                winActions && winActions.backgroundModeLock('audio')
                document.body.classList.add('audio')
            } else {
                this.isAudio = false
                winActions && winActions.backgroundModeUnlock('audio')
                document.body.classList.remove('audio')
            }
            this.emit('codecData', codecData)
        })
        main.on('streamer-audio-track', trackId => {
            console.warn('SET TRACK', trackId)
            player.audioTrack(trackId)
        })
        main.on('streamer-subtitle-track', trackId => {
            console.warn('SET TRACK', trackId)
            player.subtitleTrack(trackId)
        })
        main.on('streamer-add-subtitle-track', track => {
            console.warn('ADD TRACK', track)
            player.current && player.current.addTextTrack(track)
        })
        this.on('stop', () => {
            this.isAudio = false
            winActions && winActions.backgroundModeUnlock('audio')
            document.body.classList.remove('audio')
        })
        this.on('state', s => {
            if(s == 'playing' && this.muted) {
                if(!player.muted()) this.volumeMute()
            }
        })
		player.on('audioTracks', tracks => main.emit('audioTracks', tracks))
		player.on('subtitleTracks', tracks => main.emit('subtitleTracks', tracks))
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
        this.volumeButton.insertBefore(this.buildElementFromHTML('<volume><volume-wrap><div><input type="range" min="0" max="100" step="1" value="'+ main.config['volume'] +'" /><div id="volume-arrow"></div></div></volume-wrap></volume>'), this.volumeButton.firstChild)
        this.volumeBar = this.volumeButton.querySelector('volume')
        this.volumeInput = this.volumeBar.querySelector('input')
        if(window.capacitor){
            // input and change events are not triggering satisfatorely on mobile, so we'll use touchmove instead ;)
            this.volumeInput.addEventListener('touchmove', this.volumeBarCalcValueFromMove.bind(this), {passive: true})
        } else {
            this.volumeInput.addEventListener('input', this.volumeChanged.bind(this))
            this.volumeInput.addEventListener('mouseenter', () => {
                clearTimeout(this.volumeShowTimer)
                this.volumeShowTimer = setTimeout(() => this.volumeBarShow(), 400)
            })
            this.volumeInput.addEventListener('mouseleave', () => {
                clearTimeout(this.volumeShowTimer)
            })
        }
        let isTouchDevice, touchListener = event => {
            isTouchDevice = true
            this.volumeInput.removeEventListener('touchstart', touchListener)
        }
        this.volumeInput.addEventListener('touchstart', touchListener)
        this.volumeInput.addEventListener('click', event => {
            if(!event.target || isTouchDevice || !['volume-wrap', 'i'].includes(event.target.tagName.toLowerCase())) return
            const volume = parseFloat(this.volumeInput.value)
            if(volume){
                this.volumeMute()
            } else {
                this.volumeUnmute()
            }
        })
        this.once('start', () => this.volumeChanged())
        main.idle.on('idle', () => this.volumeBarHide())
        main.menu.on('focus', e => {
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
        }, {passive: true})
    }
    isVolumeButtonActive(){
        let s = main.menu.selected()
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
            player.volume(nvolume)
            if(this.volumeInitialized){
                main.osd.show(this.volume ? main.lang.VOLUME + ': ' + nvolume : main.lang.MUTE, volIcon, 'volume', 'normal')
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
            main.emit('config-set', 'volume', this.volume)
        }, 3000)
    }
}

class StreamerClientControls extends StreamerAudioUI {
    constructor(controls){
        super(controls)
        main.on('add-player-button', this.addPlayerButton.bind(this))
        main.on('update-player-button', this.updatePlayerButton.bind(this))
        main.on('enable-player-button', this.enablePlayerButton.bind(this))
        main.on('streamer-info', info => {
            this.controls.querySelector('#streamer-info > div').innerHTML = info.replaceAll("\n", "<br />")
        })
        this.on('state', state => {
            if(['loading', 'paused'].includes(state)){
                main.emit('streamer-update-streamer-info')
            }
        })
        main.idle.on('active', () => main.emit('streamer-update-streamer-info'))
        this.addPlayerButton('play-pause', 'PAUSE', `
            <i class="fas fa-play play-button"></i>
            <i class="fas fa-pause pause-button"></i>`, 0, () => {
            this.playOrPauseNotIdle()
        })
        this.addPlayerButton('stop', 'STOP', 'fas fa-stop', 1, () => {            
            if(this.casting) return this.castUIStop()
            this.stop()
        })
        this.addPlayerButton('next', 'GO_NEXT', 'fas fa-step-forward', 5, () => main.emit('go-next'))
        this.setupVolume()
        this.addPlayerButton('tune', 'RETRY', main.config['tuning-icon'], 7, () => main.emit('reload-dialog'))
        this.addPlayerButton('ratio', 'ASPECT_RATIO', 'fas fa-expand-alt', 10, () => {
            this.switchAspectRatio()
            let label = this.activeAspectRatio.custom ? main.lang.ORIGINAL : (this.activeAspectRatio.h + ':' + this.activeAspectRatio.v)
            main.osd.show(main.lang.ASPECT_RATIO +': '+ label, '', 'ratio', 'normal')
        }, 0.9)
        if(!window.capacitor && main.config['startup-window'] != 'fullscreen'){
            this.addPlayerButton('fullscreen', 'FULLSCREEN', 'fas fa-expand', 11, () => {
                this.toggleFullScreen()
            }, 0.85)
        }
        this.addPlayerButton('stream-info', 'ABOUT', 'fas fa-ellipsis-v', 12, () => main.emit('about'))
        this.controls.querySelectorAll('button').forEach(bt => {
            bt.addEventListener('touchstart', () => main.menu.focus(bt), {passive: true})
        })
        this.emit('draw')
        document.querySelector('#menu').addEventListener('click', e => {
            if(e.target.id == 'menu'){
                if(this.active && !main.menu.inModal() && !main.menu.isExploring()){
                    this.playOrPauseNotIdle()
                }
            }
        })
    }
    buildElementFromHTML(code) {
        const wrap = document.createElement('span')
        wrap.innerHTML = code
        return wrap.firstElementChild
    }
    addPlayerButton(cls, langKey, fa, position = -1, action, scale = -1){
        const id = cls.split(' ')[0], name = main.lang[langKey]
        if(this.getPlayerButton(id)) return
        let container = this.controls.querySelector('#buttons')
        let iconTpl = fa.indexOf('<') == -1 ? '<i class="'+ fa +'"></i>' : fa
        let template = `
        <button id="${id}" data-position="${position}" class="${cls}" title="${name}" aria-label="${name}">
            <span class="button-icon">${iconTpl}</span>
            <span class="button-label"><span><span>${name}</span></span></span>
        </button>
`
        if(scale != -1){
            template = template.replace('></i>', ' style="transform: scale('+ scale +')"></i>')
        }
        const bt = this.buildElementFromHTML(template)
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
            if(type == 'after') {
                ptr.insertAdjacentElement('afterend', bt)
            } else {
                ptr.parentNode.insertBefore(bt, ptr)
            }
        } else {
            container.insertBefore(bt, container.firstChild)
        }
        let button = container.querySelector('#' + id)
        if(typeof(action) == 'function'){
            button.addEventListener('click', action, {passive: true})
        } else {
            button.addEventListener('click', () => main.emit(action), {passive: true})
        }
        if(name == 'cast' && parent.Manager) parent.Manager.exitPage.touch()
        this.emit('added-player-button', id, name, button, fa)
    }
    getPlayerButton(id){
        return this.controls.querySelector('#buttons #' + id.split(' ')[0])
    }
    updatePlayerButton(id, name, fa, scale = -1){
        let button = this.getPlayerButton(id)
        if(!button) return console.error('Button #'+ id +' not found')
        if(name){
            button.querySelector('.button-label > span > span').innerText = name
            button.setAttribute('title', name)
            button.setAttribute('aria-label', name)
        }
        if(fa){
            let template = `<i class="${fa}"></i>`
            if(scale != -1){
                template = template.replace('></i>', ' style="transform: scale('+ scale +')"></i>')
            }            
            button.querySelector('i').replaceWith(this.buildElementFromHTML(template))
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
    constructor(controls){
        super(controls)
        this.active = false
        player.on('show', () => this.emit('show'))
        player.on('hide', () => this.emit('hide'))
    }
    start(src, mimetype, cookie, mediatype){
        this.active = true
        this.activeSrc = src
        this.activeSubtitle = this.data.subtitle || ''
        this.activeCookie = cookie
        this.activeMimetype = (mimetype || '').toLowerCase()
        this.activeMediatype = mediatype
        this.inLiveStream = ['live', 'audio'].includes(this.activeMediatype)
        player.load(src, mimetype, this.activeSubtitle, cookie, this.activeMediatype, this.data)
        this.emit('start')
    }
    stop(fromServer){
        if(this.active){
            this.active = false
            this.activeSrc = ''
            this.activeMimetype = ''
            player.unload()
            console.log('STOPCLIENT', fromServer)
            if(fromServer !== true){
                main.emit('stop')
            }
            this.emit('stop')
            this.casting && this.castUIStop() // if it opened in external player
        }
    }
}

export class StreamerClient extends StreamerClientController {
    constructor(controls){
        super(controls)
        this.bind()
        zapSetup(this)
    }
    errorCallback(src, mimetype){
        if(this.autoTuning && !this.transcodeStarting && this.stateListening && mimetype.indexOf('video/') == -1){ // seems live
            main.menu.dialog([
                {template: 'question', text: '', fa: 'fas fa-question-circle'},
                {template: 'option', text: main.lang.PLAY_ALTERNATE, id: 'tune', fa: main.config['tuning-icon']},
                {template: 'option', text: main.lang.STOP, id: 'stop', fa: 'fas fa-stop-circle'},
                {template: 'option', text: main.lang.RETRY, id: 'retry', fa: 'fas fa-sync'}
            ], choose => {
                switch(choose){
                    case 'tune':
                        main.emit('tune')
                        break
                    case 'retry':
                        main.emit('retry')
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
        main.on('pause', () => {
            console.warn('PAUSE')
            player.pause()
        })
        main.on('debug-tuning', () => {
            this.debugTuning = true
        })
        main.on('streamer-connect', (src, mimetype, cookie, mediatype, data, autoTuning) => {
            if(this.debugTuning){
                main.osd.show('CONNECT '+ data.name, 'fas fa-info-circle faclr-red', 'debug2', 'normal')
            }
            this.animating = true
            this.bindStateListener()
            if(this.isTryOtherDlgActive()){
                main.menu.endModal()
            }
            this.data = data
            this.autoTuning = autoTuning
            console.warn('CONNECT', src, mimetype, cookie, mediatype, data, autoTuning)
            this.start(src, mimetype, cookie, mediatype)
            main.osd.hide('streamer')
            setTimeout(() => {
                this.animating = false
                this.emit('animated')
                this.emit('animated') // should call it twice
            }, 150)  
        })
        main.on('transcode-starting', state => { // used to wait for transcoding setup when supported codec is found on stream
            console.warn('TRANSCODING', state)
            this.transcodeStarting = state
            if(state){
                main.osd.hide('debug-conn-err')
                main.osd.hide('streamer')
            }
            state = state ? 'loading' : this.state
            this.stateListener(state, null, true)
            this.speedoUpdate()
        })
        main.on('streamer-connect-suspend', () => { // used to wait for transcoding setup when supported codec is found on stream
            this.unbindStateListener()
            if(player.current && player.current.hls){
                player.current.hls.stopLoad()
            }
            player.pause()
            this.stateListener('loading')
        })
        main.on('streamer-disconnect', (err, autoTuning) => {
            this.unbindStateListener()
            console.warn('DISCONNECT', err, autoTuning)
            this.autoTuning = autoTuning
            this.stop(true)  
        })
    }
}
