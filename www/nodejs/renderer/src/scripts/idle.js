import { EventEmitter } from 'events'

class EnergySavingController extends EventEmitter {
    constructor(main) {
        super()
        this.main = main
        this.active = false
    }
    start() {
        if (this.active || !this.main.config['timeout-secs-energy-saving']) return
        this.active = true
        this.emit('start')
    }
    end() {
        if (!this.active) return
        this.active = false
        this.emit('end')
    }
}

export class Idle extends EventEmitter {
    constructor(main){
        super(main)
        this.main = main
        this.timeout = 5000
        this.awayTimeout = 10000
        this.lastIdleTime = Date.now() / 1000
        this.idle = false
        this.idleTimer = 0
        this.awayTimer = 0
        this.reset()
        this.energySaver = new EnergySavingController(this.main)
        this.main.on('streamer-connect', () => this.reset())
        this.main.on('streamer-disconnect', () => this.reset())
        this.main.on('config', () => {
            this.setTimeoutAwayState(this.main.config['timeout-secs-energy-saving'])
        });
        ['focus', 'mousemove', 'mousedown', 'touchstart', 'touchmove', 'keyup', 'play'].forEach(eventType => {
            window.addEventListener(eventType, () => {
                setTimeout(() => this.reset(), 400)
            })
        })
        window.addEventListener('blur', () => this.start())
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
        if(!this.locked) {
            var now = parseInt(Date.now() / 1000)
            if(now <= this.lastResetTime) return // cap to 1 call/sec
            this.isAway = false
            this.lastResetTime = now
            clearTimeout(this.awayTimer)
            clearTimeout(this.idleTimer)
            if(this.idle) {
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
            if (!this.idle) {
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
