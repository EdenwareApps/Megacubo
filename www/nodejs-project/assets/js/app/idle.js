// https://stackoverflow.com/a/668017

class Idle extends EventEmitter {
    constructor(){
        super()
        this.timeout = 5000
        this.lastIdleTime = Date.now() / 1000
        this.idle = false
        this.idleTimer = null
        window.addEventListener('appready', () => {
            this.reset()
            app.on('streamer-connect', () => this.reset())
            app.on('streamer-disconnect', () => this.reset())
            jQuery(window).on('focus resize mousemove mousedown touchstart touchmove keyup play', () => {
                setTimeout(() => this.reset(), 400)
            }).on('blur', () => this.start())
        })
    }
    reset(){
        if(!this.locked){
            clearTimeout(this.idleTimer)
            if(this.idle){
                this.lastIdleTime = Date.now() / 1000
                this.isIdle = this.idle = false
                this.emit('stop')
            }
            this.idleTimer = setTimeout(() => this.start(), this.timeout) //new timer
        }
    }
    start(){
        if(!this.locked){
            if (!this.idle){
                this.idleTime = Date.now() / 1000
                this.isIdle = this.idle = true
                this.emit('start')
            }
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

window.idle = new Idle()
