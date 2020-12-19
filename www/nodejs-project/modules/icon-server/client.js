
class IconServerClient extends EventEmitter {
    constructor(opts){
        super()
        this.debug = false
        this.concurrency = 8
        if(parent.cordova){
            this.concurrency = 3
        }
        this.image = '<img src="{0}" />';
        ['log', 'warn', 'error'].forEach(f => {
            this[f] = this.debug ? console[f] : () => {}
        })
        if(opts){
		    Object.keys(opts).forEach(k => {
    			this[k] = opts[k]
            })
        }
        this.processing = 0
        this.lookupLock = {}
        this.testers = {}
        this.pool = []
        this.callbacks = {}
    }
    run(){
        this.emit('run')
    }
    add(element, src){
        this.pool.push({src, element})
        this.next()
    }
    load(url, cb){
        if(typeof(this.callbacks[url]) == 'undefined'){
            this.callbacks[url] = []
        }
        this.callbacks[url].push(cb)
        if(!this.testers[url]){
            const tstart = time()
            this.testers[url] = this.ajax(url, ret => {
                if(this.debug){
                    console.log('ajax loaded', time(), tstart, Math.round(time() - tstart, 2))
                }
                if(this.testers[url]){
                    delete this.testers[url]
                }
                if(Array.isArray(this.callbacks[url])){
                    var fss = this.callbacks[url]
                    delete this.callbacks[url]
                    fss.forEach(function (f){
                        f(ret)
                    })
                }
                if(this.debug){
                    console.log('ajax done', Math.round(time() - tstart, 2))
                }
            })
        }
    }
    ajax(url, cb){
        var r = new XMLHttpRequest()
        r.open('GET', url, true)
        r.responseType = 'blob'        
        r.onload = oEvent => {
            cb(r.status == 200 ? r.response : false)
        }
        r.onerror = err => {
            cb(false)
        }
        r.send()
        return r
    }
    next(){
        if(this.pool.length && this.processing < this.concurrency){
            this.processing++
            let e = this.pool.shift()
            this.process(e.element, e.src, () => {
                this.processing--
                this.next()
            })
        }
    }
    process(element, src, cb){
        let found, shouldCancel = () => {
            return (found || !element || !element.parentNode)
        }, next = () => {
            this.log('IconServerClient.process(), VALIDATE RESULT', element, found)
            this.emit('validate', element, src, found)
            cb()
            element = null
        }
        this.log('IconServerClient.process()', element)
        if(shouldCancel()) {
            cb()
        } else if(src) {
            this.log('IconServerClient checkImage()', element, src)
            this.check(src, b => {
                if(!found){
                    this.log('IconServerClient checkImage() OK', element, src, b)
                    found = b
                    next()
                }
            }, () => {
                this.log('IconServerClient checkImage() ERR', element, src)
                next()
            })
        } else {
            next()
        }
    }
    check(url, load, error, timeout){
        if(url.indexOf('/') == -1){
            return error()
        }
        let solved, started = true
        if(!timeout){
            timeout = 30
        }
        setTimeout(() => {
            if(!solved){
                solved = true
                error()
            }
        }, timeout * 1000)
        this.load(url, ret => {
            if(ret){
                this.log('IconServerClient checkImage.load()', url, ret)
                if(!solved){
                    solved = true
                    load(ret)
                }
            } else {
                this.log('IconServerClient checkImage.error()', url, ret)
                if(!solved){
                    solved = true
                    error()
                }
            }
        })
    }
}


