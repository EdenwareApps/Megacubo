const Events = require('events'), async = require('async')

class ConnRacing extends Events {
    constructor(urls, opts={}){
        super()
        this.urls = urls.slice(0)
        this.opts = opts
        this.results = []
        this.callbacks = []
        this.downloads = []
        this.ended = false
        this.racingEnded = false
        this.readyIterator = 0
        this.start()
        this.uid = parseInt(Math.random() * 10000)
    }
    start(){
        if(!this.urls.length){
            return this.end()
        }
        async.eachOfLimit(this.urls, 10, (url, i, acb) => {
            let download, finished, headers = {}, status = 0, start = global.time()
            const finish = () => {
                if(!finished){
                    finished = true
                    this.readyIterator++
                    const result = {
                        time: global.time() - start,
                        url,
                        directURL: download ? download.currentURL : url,
                        valid: status >= 200 && status < 300,
                        status,
                        headers
                    }
                    this.results.push(result)
                    if(download){
                        download.destroy()		
                        download = null			
                    }
                    acb()   
                    this.pump()       
                }
            }
            if(!url.match(new RegExp('^(//|https?://)'))){ // url not testable
                status = 200
                return finish()
            }
            const req = Object.assign({
                url,
                followRedirect: true,
                acceptRanges: false,
                keepalive: false,
                retries: 1,
                headers: {
                    'accept-encoding': 'identity' // https://github.com/sindresorhus/got/issues/145
                }
            }, this.opts)
            download = new global.Download(req)
            this.downloads.push(download)
            download.on('response', (statusCode, responseHeaders) => {
                headers = responseHeaders
                status = statusCode
                finish()
            })
            download.on('end', finish)
        }, () => {
            this.racingEnded = true
            this.pump()
        })
    }
    pump(){
        if(this.destroyed){
            return
        }
        if(this.results.length && this.callbacks.length){
            let cb = this.callbacks.shift(), res = this.results.shift()
            cb(res)
        } else if(this.ended || (this.racingEnded && !this.results.length)) {
            this.ended = true
            let cbs = this.callbacks.slice(0)
            this.callbacks = []
            cbs.forEach(f => f(false))
        }
    }
    next(cb){
        if(this.ended){
            return cb(false)
        }
        this.callbacks.push(cb)
        this.pump()
    }
    end(){
        if(!this.ended){
            this.ended = true
            this.pump()
            this.emit('end')
            this.destroy()
        }
    }
    progress(){
        return this.readyIterator / (this.urls.length / 100)
    }
    destroy(){
        if(!this.destroyed){
            this.ended = true
            this.destroyed = true
            this.results = []
            this.callbacks = [] // keep before
            this.downloads.forEach(d => d.destroy())
            this.downloads = []
            this.removeAllListeners()
        }
    }
}

module.exports = ConnRacing
 