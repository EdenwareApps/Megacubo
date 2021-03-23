const Events = require('events'), async = require('async')

class ConnRacing extends Events {
    constructor(urls){
        super()
        this.urls = urls
        this.results = []
        this.callbacks = []
        this.downloads = []
        this.ended = false
        this.readyIterator = 0
        this.start()
    }
    start(){
        async.eachOf(this.urls, (url, i, acb) => {
            let ended, headers = {}, status = 0, start = global.time()       
            const req = {
                url,
                followRedirect: true,
                acceptRanges: false,
                keepalive: false,
                retries: 1,
                headers: {
                    'accept-encoding': 'identity' // https://github.com/sindresorhus/got/issues/145
                }
            }
            let download = new global.Download(req), end = () => {
                if(download){
                    download.destroy()		
                    download = null			
                }
                acb()
            }, finish = () => {
                if(!ended){
                    ended = true
                    this.readyIterator++
                    const result = {
                        time: global.time() - start,
                        url,
                        directURL: download.currentURL,
                        valid: status >= 200 && status < 300,
                        status,
                        headers
                    }
                    this.results.push(result)
                    this.pump() 
                    end()                
                }
            }
            this.downloads.push(download)
            download.on('response', (statusCode, responseHeaders) => {
                headers = responseHeaders
                status = statusCode
                finish()
            })
            download.on('end', finish)
        }, () => {
            this.ended = true
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
        } else if(this.ended) {
            this.callbacks.forEach(f => f(false))
            this.callbacks = []
        }
    }
    next(cb){
        if(this.destroyed){
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
 