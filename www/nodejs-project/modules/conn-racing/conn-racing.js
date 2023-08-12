const Events = require('events'), pLimit = require('p-limit')

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
        this.triggerInterval = 0
        this.uid = parseInt(Math.random() * 10000000000000)
        this.start().catch(console.error)
    }
    wait(ms){
        return new Promise(resolve => setTimeout(resolve, ms))
    }
    async start(){
        if(!this.urls.length){
            return this.end()
        }
        const limit = pLimit(20)
        const tasks = this.urls.map((url, i) => {
            return async () => {
                if(!url.match(new RegExp('^(//|https?://)'))){ // url not testable
                    throw 'url not testable'
                }
                if(this.triggerInterval && i) {
                    const delay = i * this.triggerInterval
                    await this.wait(delay)
                }
                if(this.ended){
                    return false
                }
                const start = global.time(), prom = global.Download.head({
                    url,
                    followRedirect: true,
                    acceptRanges: false,
                    keepalive: false,
                    retries: 1
                })
                this.downloads.push(prom)
                const ret = await prom.catch(console.error)
                this.readyIterator++
                if(ret && ret.statusCode){
                    const status = ret.statusCode, valid = status >= 200 && status < 300
                    const result = {
                        time: global.time() - start,
                        url, valid, status,
                        headers: ret.headers
                    }
                    this.results.push(result)
                    this.pump()
                    return status
                } else {
                    return false
                }
            }
        }).map(limit)
        await Promise.allSettled(tasks)
        this.racingEnded = true
        this.end()
    }
    pump(){
        if(this.destroyed){
            return
        }
        if(this.results.length && this.callbacks.length){
            let cb = this.callbacks.shift(), res = this.results.shift()
            cb(res)
            this.pump()
        } else if(this.ended || (this.racingEnded && !this.results.length)) {
            this.ended = true
            let cbs = this.callbacks.slice(0)
            this.callbacks = []
            cbs.forEach(f => f(false))
        }
    }
    next(){
        return new Promise((resolve, reject) => {
            if(this.results.length){
                return resolve(this.results.shift())
            }
            this.callbacks.push(resolve)
            this.pump()
            if(this.ended){
                return resolve(false)
            }
        })
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
            this.downloads.forEach(d => d.cancel())
            this.downloads = []
            this.removeAllListeners()
        }
    }
}

module.exports = ConnRacing
 