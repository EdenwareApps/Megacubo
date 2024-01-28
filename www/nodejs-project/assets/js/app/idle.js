// https://stackoverflow.com/a/668017

class Idle extends EventEmitter {
    constructor(){
        super()
        this.timeout = 5000
        this.awayTimeout = 10000
        this.lastIdleTime = Date.now() / 1000
        this.idle = false
        this.idleTimer = 0
        this.awayTimer = 0
        this.reset()
        app.on('streamer-connect', () => this.reset())
        app.on('streamer-disconnect', () => this.reset())
        jQuery(window).on('focus mousemove mousedown touchstart touchmove keyup play', () => {
            setTimeout(() => this.reset(), 400)
        }).on('blur', () => this.start())
    }
    setTimeoutAwayState(n){
        if(n > 5) {
            this.timeout = 5000
            this.awayTimeout = (n * 1000) - this.timeout
        } else {
            if(n) {
                this.timeout = Math.min(5, n) * 1000
                this.awayTimeout = 0
            } else {
                this.timeout = 5000
                this.awayTimeout = null
            }
        }
        this.reset()
    }
    reset(){
        if(!this.locked){
            var now = parseInt(Date.now() / 1000)
            if(now <= this.lastResetTime) return // cap to 1 call/sec
            this.isAway = false
            this.lastResetTime = now
            clearTimeout(this.awayTimer)
            clearTimeout(this.idleTimer)
            if(this.idle){
                this.lastIdleTime = now
                this.isIdle = this.idle = false
                this.isAway = false
                this.emit('active')
            }
            this.idleTimer = setTimeout(() => this.start(), this.timeout) //new timer
        }
    }
    start(){
        if(!this.locked){
            if (!this.idle){
                this.idleTime = Date.now() / 1000
                this.isIdle = this.idle = true
                this.emit('idle')
                if(typeof(this.awayTimeout) == 'number') {
                    this.idleTimer = setTimeout(() => this.away(), this.awayTimeout) //new timer
                }
            }
        }
    }
    away(){
        if (this.idle){
            this.isAway = true
            this.emit('away')
        }
    }
    lock(secs){
        if(this.lockTimer){
            clearTimeout(this.lockTimer)
        }
        this.locked = true
        this.lockTimer = setTimeout(() => {
            this.locked = false
        }, secs * 1000)
    }
}
