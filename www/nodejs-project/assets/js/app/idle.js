// https://stackoverflow.com/a/668017

(function (w){
    const timeout = 5000
    w.lastIdleTime = ((new Date()).getTime() / 1000)
    let lck, lckTimer, j = w.jQuery, jw = j(w), idle = false, idleTimer = null, reset = () => {
        if(!lck){
            clearTimeout(idleTimer)
            if(idle){
                w.lastIdleTime = ((new Date()).getTime() / 1000)
                w.isIdle = idle = false
                w.dispatchEvent(new CustomEvent('idle-stop'))
            }
            idleTimer = setTimeout(start, timeout) //new timer
        }
    }, start = () => {
        if(!lck){
            let now = ((new Date()).getTime() / 1000)
            if (!idle){
                w.idleTime = ((new Date()).getTime() / 1000)
                w.isIdle = idle = true
                w.dispatchEvent(new CustomEvent('idle-start'))
            }
        }
    }, lock = (secs) => {
        if(lckTimer){
            clearTimeout(lckTimer)
        }
        lck = true, lckTimer = setTimeout(() => {
            lck = false
        }, secs * 1000)
    }
    w.idleStart = start.bind(this)
    w.idleStop = reset.bind(this)
    w.idleLock = lock.bind(this)
    w.addEventListener('appready', () => {
        reset()
        jw.on('focus resize mousemove mousedown touchstart touchmove keyup play', () => {
            setTimeout(reset, 400)
        }).on('blur', start)
        app.on('streamer-connect', reset)
        app.on('streamer-disconnect', reset)
    })
})(window)
