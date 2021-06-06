
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
        return ((new Date()).getTime() / 1000)
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
                        osd.show(lang.PAUSED, 'fas fa-play', this.osdID, 'persistent')
                    }
                    break
                case 'loading':
                    osd.hide(this.osdID + '-sub')
                    osd.hide(this.osdID)
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    this.transmissionNotWorkingHintTimer = setTimeout(() => {
                        if(this.active){
                            osd.hide(this.osdID)
                            osd.show(lang.TRANSMISSION_NOT_WORKING_HINT.format(this.tuningIcon), '', this.osdID + '-sub', 'persistent')
                        }
                    }, this.transmissionNotWorkingHintDelay)
                    break
                case 'playing':
                    clearTimeout(this.transmissionNotWorkingHintTimer)
                    osd.hide('video-slow')
                    osd.hide(this.osdID + '-sub')
                    osd.hide(this.osdID)
                    if(!this.OSDNameShown){
                        this.OSDNameShown = true
                        osd.show(this.data.name, this.data.servedIcon || '', this.osdID, 'normal')
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
        app.on('cast-start', () => {
            if(!this.casting){
                this.casting = true
                this.castingPaused = false
                this.unbindStateListener()
                parent.player.pause()
                this.stateListener('playing')
                this.jbody.addClass('casting')
                if(this.inLiveStream){
                    this.jbody.addClass('casting-live')
                }
            }
        })
        app.on('cast-stop', () => {
            if(this.casting){
                this.casting = false
                this.castingPaused = false
                this.jbody.removeClass('casting')
                this.jbody.removeClass('casting-live')
                if(this.active){
                    this.bindStateListener()
                    if(parent.player.state){
                        parent.player.resume()
                    } else {
                        parent.player.load(this.activeSrc, this.activeMimetype, this.activeCookie, this.activeMediatype)
                        this.stateListener('loading')
                    }
                }
            }
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
}

class StreamerState extends StreamerCasting {
    constructor(controls, app){
        super(controls, app)
        this.state = ''
        this.stateListener = (s, data) => {
            if(s != this.state){
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
            parent.player.once('timeupdate', () => { // only on initial timeupdate of each stream to fix bad loading status on Exoplayer
                if(this.state == 'loading'){
                    this.stateListener('playing')
                }
            })
        })
        this.on('stop', () => this.stateListener(''))
    }
    bindStateListener(){
        if(!parent.player.listeners('state').includes(this.stateListener)){
            parent.player.on('state', this.stateListener)
        }
    } 
    unbindStateListener(){
        console.log('STREAMER-UNBINDSTATELISTENER')
        parent.player.removeListener('state', this.stateListener)
    }
    playOrPause(){
        if(this.active){
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
                    parent.player.resume()
                    this.app.emit('streamer-resume')
                }
            } else if(parent.player.state) {
                parent.player.pause()
                this.app.emit('streamer-pause')
            }
        }
    }
    playOrPauseNotIdle(){
        let idle = isIdle || lastIdleTime > (((new Date()).getTime() / 1000) - 0.5)
        console.error('playOrPauseNotIdle() '+ (idle?'Y':'N'), isIdle, lastIdleTime)
        if(!idle){
            this.playOrPause()
        }
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
        parent.player.container.querySelectorAll('video, audio').forEach(e => {
            e.muted = false
        })
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
        const rx = new RegExp('(^| )video[\\-a-z]*', 'g'), rx2 = new RegExp('(^| )idle', 'g')
        this.on('stop', s => {
            let c = document.body.className
            c = c.replace(rx, ' ')
            document.body.className = c.trim()
        })
        this.on('state', s => {
            let c = document.body.className
            if(s && s != 'error'){
                c = c.replace(rx, ' ') + ' video video-' + s
            } else {
                c = c.replace(rx, ' ')
            }
            document.body.className = c.trim()
        });
        window.addEventListener('idle-start', () => {
            let c = document.body.className || ''
            if(!c.match(rx2)){
                document.body.className += ' idle'
            }
            parent.player.uiVisible(false)
        })
        window.addEventListener('idle-stop', () => {
            let c = document.body.className || ''
            if(c.match(rx2)){
                document.body.className = c.replace(rx2, ' ').trim()
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
                default:
                    this.speedoSemSet(1, lang.WAITING_CONNECTION)
            }
        })
        this.on('start', () => {
            this.commitTime = time()
            this.state = 'loading'
            this.speedoReset()
            this.seekBarReset()
            this.app.emit('downlink', this.downlink())
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
        this.speedoSemSet(1, lang.WAITING_CONNECTION)
    }
    speedoUpdate(){
        if(!parent.player.state){
            return
        }
        let semSet, starting = !this.commitTime || (time() - this.commitTime) < 10
        let lowSpeedThreshold = (250 * 1024) /* 250kbps */, downlink = this.downlink(this.currentSpeed)
        if(this.invalidSpeeds.includes(this.currentSpeed)) {
            this.speedoSemSet(1, lang.WAITING_CONNECTION)
        } else {
            let t = ''
            if(this.bitrate && !this.invalidSpeeds.includes(this.bitrate)){
                let p = parseInt(this.currentSpeed / (this.bitrate / 100))
                if(p > 100){
                    p = 100
                }
                if(downlink && downlink < this.bitrate){ // client connection is the throattling factor
                    t += lang.YOUR_CONNECTION + ': '
                } else { // slow server?
                    t += lang.SERVER_CONNECTION + ': '
                }
                t += p + '%'
                if(p < 80){
                    semSet = 2
                } else if(p < 100){
                    semSet = 1
                } else {
                    semSet = 0
                    t = lang.STABLE_CONNECTION
                }
            } else {
                t += lang.SERVER_CONNECTION + ': ' + kbsfmt(this.currentSpeed)
                if(this.currentSpeed <= lowSpeedThreshold){
                    if(starting){
                        t = lang.WAITING_CONNECTION
                        semSet = 1
                    } else {
                        semSet = 2
                    }
                } else {                   
                    semSet = 1
                }
            }
            this.speedoSemSet(semSet, t)
        }
    }
    speedoSemSet(s, txt){
        if(s !== this.currentSem){
            const colors = ['green', 'orange', 'red']
            this.currentSem = s
            this.speedoLabel.innerText = txt
            if(!this.speedoSemInfoButton){
                this.speedoSemInfoButton = $(this.getPlayerButton('info'))
            }
            colors.forEach((color, i) => {
                this.speedoSemInfoButton[i == s ? 'addClass' : 'removeClass']('faclr-'+ color)
            })
        }
    }
}

class StreamerSeek extends StreamerSpeedo {
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
        this.useClockCounterInLiveStream = false
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
            window.addEventListener('idle-stop', () => this.seekBarUpdate(true))
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
        parent.player.on('timeupdate', this.seekBarUpdate.bind(this))
        parent.player.on('durationchange', () => {
            const duration = parent.player.duration()
            if(this.seekLastDuration > duration){ // player reset
                this.seekPlaybackStartTime = time() - duration
            }
            this.seekLastDuration = duration
            this.seekBarUpdate()
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
        if(this.inLiveStream && this.useClockCounterInLiveStream){
            let s = this.seekPlaybackStartTime ? (this.seekPlaybackStartTime + t) : time()
            txt = moment.unix(s + t).format('LTS') //.replace(new RegExp('(\\d\\d:\\d\\d)(:\\d\\d)'), '$1<font style="opacity: var(--opacity-level-2);">$2</font>')
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
        this.seekTimer = setTimeout(() => parent.player.resume(), 1500)
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
class StreamerClientTimeWarp extends StreamerSeek {
    constructor(controls, app){
        super(controls, app)
        this.currentPlaybackRate = 1
        parent.player.on('timeupdate', this.doTimeWarp.bind(this))
        parent.player.on('durationchange', this.doTimeWarp.bind(this))
    }
    doTimeWarp(){
        if(this.inLiveStream && config['playback-rate-control']){
            let thresholds = {low: 10, high: 30}
            let rate = this.currentPlaybackRate
            let rates = {slow: 0.9, normal: 1, fast: 1.1}, time = parent.player.time(), duration = parent.player.duration(), buffered = duration - time
            // generate intermediary values
            thresholds.midLow = thresholds.low + ((thresholds.high - thresholds.low) / 3)
            thresholds.midHigh = thresholds.high - ((thresholds.high - thresholds.low) / 3)
            if(buffered <= thresholds.low) {
                rate = rates.slow
            } else if(buffered.between(thresholds.low, thresholds.midLow)) {
                if(rate != rates.slow && rate != rates.normal){
                    rate = rates.normal
                }
            } else if(buffered.between(thresholds.midLow, thresholds.midHigh)) {
                rate = rates.normal
            } else if(buffered.between(thresholds.midHigh, thresholds.high)) {
                if(rate != rates.normal && rate != rates.fast){
                    rate = rates.normal
                }
            } else if(buffered > thresholds.high){
                rate = rates.fast
            }
            if(rate != this.currentPlaybackRate){
                this.currentPlaybackRate = rate
                console.warn('PLAYBACKRATE=*', rate, buffered + 's')
                parent.player.playbackRate(rate)
            }
        }
    }
}

class StreamerClientVideoFullScreen extends StreamerClientTimeWarp {
    constructor(controls, app){
        super(controls, app)
        let b = this.controls.querySelector('button.fullscreen')
        if(config['startup-window'] != 'fullscreen'){
            this.inFullScreen = false
            if(parent.cordova){
                parent.AndroidFullScreen.showSystemUI(() => {}, console.error);
                parent.AndroidFullScreen.showUnderSystemUI(() => {}, console.error);
                parent.plugins.megacubo.on('appmetrics', this.updateAndroidAppMetrics.bind(this))
                this.updateAndroidAppMetrics(parent.plugins.megacubo.appMetrics)
                this.on('fullscreenchange', this.updateAndroidAppMetrics.bind(this))
                if(b) b.style.display = 'none'
                this.on('start', () => this.enterFullScreen())
                this.on('stop', () => this.leaveFullScreen())
            } else {
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
    updateAndroidAppMetrics(metrics){
        if(metrics && metrics.top){
            this.lastMetrics = metrics
        } else {
            metrics = this.lastMetrics
        }
        if(this.inFullScreen){
            css(' :root { --explorer-padding-top: 0px; --explorer-padding-bottom: 0px; --explorer-padding-right: 0px; --explorer-padding-left: 0px; } ', 'frameless-window')
        } else {
            css(' :root { --explorer-padding-top: ' + metrics.top + 'px; --explorer-padding-bottom: ' + metrics.bottom + 'px; --explorer-padding-right: ' + metrics.right + 'px; --explorer-padding-left: ' + metrics.left + 'px; } ', 'frameless-window')
        }
    }
    enterFullScreen(){
        if(parent.cordova){
            parent.AndroidFullScreen.immersiveMode(() => {}, console.error);
        } else {
            let e = parent.document.body // document.documentElement
            if (e.requestFullscreen) {
                e.requestFullscreen()
            } else if (e.msRequestFullscreen) {
                e.msRequestFullscreen()
            } else if (e.mozRequestFullScreen) {
                e.mozRequestFullScreen()
            } else if (e.webkitRequestFullscreen) {
                e.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT)
            }
        }
        this.inFullScreen = true
        this.emit('fullscreenchange', this.inFullScreen)
    }
    leaveFullScreen(){
        if(this.inFullScreen){
            this.inFullScreen = false
            if(parent.cordova){
                parent.AndroidFullScreen.immersiveMode(() => {}, console.error);
                parent.AndroidFullScreen.showSystemUI(() => {}, console.error);
                parent.AndroidFullScreen.showUnderSystemUI(() => {}, console.error);
                //parent.AndroidFullScreen.showUnderStatusBar(() => {}, console.error);
            } else {
                let e = parent.document // document.documentElement
                if (e.exitFullscreen) {
                    e.exitFullscreen()
                } else if (e.msExitFullscreen) {
                    e.msExitFullscreen()
                } else if (e.mozCancelFullScreen) {
                    e.mozCancelFullScreen()
                } else if (e.webkitExitFullscreen) {
                    e.webkitExitFullscreen()
                }
            }
            this.emit('fullscreenchange', this.inFullScreen)
        }
    }
    toggleFullScreen(){
        if(this.inFullScreen){
            this.leaveFullScreen()
        } else {
            this.enterFullScreen()
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
                parent.winman.backgroundModeLock('audio')
                this.jbody.addClass('audio')
            } else {
                this.isAudio = false
                parent.winman.backgroundModeUnlock('audio')
                this.jbody.removeClass('audio')
            }
        })
        this.on('stop', () => {
            this.isAudio = false
            parent.winman.backgroundModeUnlock('audio')
            this.jbody.removeClass('audio')
        })
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
        console.log('VOLUMETOGGLE', e, this.volumeBar.style.display)
        if(e.target && e.target.tagName && ['button', 'volume-wrap', 'i'].includes(e.target.tagName.toLowerCase())){
            if(this.volumeBarVisible()){
                let now = time()
                if(this.volumeLastClickTime < (now - 0.4)){
                    this.volumeLastClickTime = now
                    this.volumeBarHide()
                    console.log('VOLUMETOGGLE HIDE')
                } else {
                    console.log('VOLUMETOGGLE DENY', this.volumeLastClickTime, now)
                }
            } else {
                console.log('VOLUMETOGGLE SHOW')
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
        this.addPlayerButton('volume', lang.VOLUME, 'fas fa-volume-up', 2, this.volumeBarShow.bind(this))
        this.volumeButton = this.getPlayerButton('volume')
        jQuery('<volume><volume-wrap><div><input type="range" min="0" max="100" step="1" value="'+ config['volume'] +'" /><div id="volume-arrow"></div></div></volume-wrap></volume>').appendTo(this.volumeButton)
        this.volumeBar = this.volumeButton.querySelector('volume')
        this.volumeInput = this.volumeBar.querySelector('input')
        if(parent.cordova){
            // input and change events are not triggering satisfatorely on mobile, so we'll use touchmove instead ;)
            this.volumeInput.addEventListener('touchmove', this.volumeBarCalcValueFromMove.bind(this))
        } else {
            this.volumeInput.addEventListener('input', this.volumeChanged.bind(this))
            jQuery(this.volumeButton).hover(() => {
                clearTimeout(this.volumeShowTimer)
                this.volumeShowTimer = setTimeout(() => this.volumeBarShow(), 400)
            }, () => {
                clearTimeout(this.volumeShowTimer)
            })
        }
        this.once('start', () => this.volumeChanged())
        window.addEventListener('idle-start', () => this.volumeBarHide())
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
        this.volumeInput.value = 0
        this.volumeChanged()
    }
    volumeChanged(){
        let nvolume = parseInt(this.volumeInput.value)
        if(!this.volumeInitialized || nvolume != this.volume){
            let volIcon = 'fas fa-volume-up'
            this.volume = nvolume
            if(!this.volume){
                volIcon = 'fas fa-volume-mute'
            } else if(this.volume <= 50){
                volIcon = 'fas fa-volume-down'
            }
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
        this.tuningIcon = 'fas fa-satellite-dish'
        this.controls.innerHTML = `
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
`
        this.addPlayerButton('play-pause', lang.PAUSE, `
            <i class="fas fa-play play-button"></i>
            <i class="fas fa-pause pause-button"></i>`, 0, () => {
            this.playOrPauseNotIdle()
        })
        this.addPlayerButton('stop', lang.STOP, 'fas fa-stop', 1, () => {
            this.stop()
        })
        this.setupVolume()
        this.addPlayerButton('tune', lang.DO_TUNE, this.tuningIcon, -1, () => {
            this.stop()
            this.app.emit('tune')
        })
        this.addPlayerButton('ratio', lang.ASPECT_RATIO, 'fas fa-expand-alt', -1, () => {
            this.switchAspectRatio()
            let label = this.activeAspectRatio.custom ? lang.ORIGINAL : (this.activeAspectRatio.h + ':' + this.activeAspectRatio.v)
            osd.show(lang.ASPECT_RATIO +': '+ label, '', 'ratio', 'normal')
        }, 0.9)
        if(!parent.cordova && config['startup-window'] != 'fullscreen'){
            this.addPlayerButton('fullscreen', lang.FULLSCREEN, 'fas fa-expand', -1, () => {
                this.toggleFullScreen()
            }, 0.85)
        }
        this.addPlayerButton('info', lang.ABOUT, `
            <i class="about-icon-dot about-icon-dot-first"></i>
            <i class="about-icon-dot about-icon-dot-second"></i>
            <i class="about-icon-dot about-icon-dot-third"></i>`, -1, 'about')
        this.controls.querySelectorAll('button').forEach(bt => {
            bt.addEventListener('touchstart', () => {
                explorer.focus(bt)
            })
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
    addPlayerButton(cls, name, fa, position = -1, action, scale = -1){
        let id = cls.split(' ')[0]
        if(this.getPlayerButton(id)){
            return
        }
        let container = this.controls.querySelector('#buttons')
        let iconTpl = fa.indexOf('<') == -1 ? '<i class="'+ fa +'"></i>' : fa
        let template = `
        <button id="${id}" class="${cls}" title="${name}" aria-label="${name}">
            <span class="button-icon">${iconTpl}</span>
            <label><span>${name}</span></label>
        </button>
`
        if(scale != -1){
            template = template.replace('></i>', ' style="transform: scale('+ scale +')"></i>')
        }
        if(position == -1){
            $(container).append(template)
        } else if(position == 0){
            $(container).prepend(template)
        } else {
            let bts = $(container).find('button')
            if(bts.length){
                if(position) {
                    bts.eq(position - 1).after(template)
                } else {
                    $(container).prepend(template)
                }
            } else {
                $(container).append(template)
            }
        }
        let button = container.querySelector('#' + id)
        if(typeof(action) == 'function'){
            button.addEventListener('click', action)
        } else {
            button.addEventListener('click', () => {
                this.app.emit(action)
            })
        }
    }
    getPlayerButton(id){
        return this.controls.querySelector('#buttons #' + id.split(' ')[0])
    }
    updatePlayerButton(id, name, fa, scale = -1){
        let button = this.getPlayerButton(id)
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
    }
    enablePlayerButton(id, show){
        let button = this.getPlayerButton(id)
        button.style.display = show ? 'inline-flex' : 'none'
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
        this.activeCookie = cookie
        this.activeMimetype = (mimetype || '').toLowerCase()
        this.activeMediatype = mediatype
        this.inLiveStream = this.activeMediatype == 'live'
        parent.player.load(src, mimetype, cookie, this.activeMediatype)
        this.emit('start')
    }
    stop(fromServer){
        if(this.active){
            this.active = false
            this.activeSrc = ''
            this.activeMimetype = ''
            console.log('STOPCLIENT', fromServer, traceback())
            if(fromServer !== true){
                this.app.emit('stop')
            }
            parent.player.unload()
            this.emit('stop')
        }
    }
}

class StreamerClient extends StreamerClientController {
    constructor(controls, app){
        console.log('CONT', controls)
        super(controls, app)
        this.app = app
        this.bind()
    }
    errorCallback(src, mimetype){
        if(this.autoTuning && mimetype.indexOf('video/') == -1){ // seems live
            explorer.dialog([
                {template: 'question', text: '', fa: 'fas fa-question-circle'},
                {template: 'option', text: lang.PLAYALTERNATE, id: 'tune', fa: 'fas fa-random'},
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
        this.app.on('tuneable', enable => {
            console.log('TUNEABLE', enable)
            let b = this.controls.querySelector('button.tune')
            if(b){
                b.style.display = enable ? 'inherit' : 'none'
            }
        })
        this.app.on('streamer-connect', (src, mimetype, cookie, mediatype, data, autoTuning) => {
            this.bindStateListener()
            if(explorer.inModal()){
                explorer.endModal()
            }
            this.data = data
            this.autoTuning = autoTuning
            console.warn('CONNECT', src, mimetype, cookie, mediatype, data, autoTuning)
            this.start(src, mimetype, cookie, mediatype)
            this.jbody.addClass('video video-loading')
            osd.hide('streamer')
        })
        this.app.on('streamer-connect-suspend', () => { // used to wait for transcoding setup when supported codec is found on stream
            this.unbindStateListener()
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
