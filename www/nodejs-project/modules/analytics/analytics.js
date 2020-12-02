const Events = require('events'), http = require('http')

class AnalyticsBase extends Events {
    constructor(){
        super()
        this.debug = false
        this.keepAliveTTL = 600000
    }
    serialize(obj){
        let str = []
        for(let p in obj){
            if(obj.hasOwnProperty(p)){
                str.push(encodeURIComponent(p) + '=' + encodeURIComponent(obj[p]))
            }
        }
        return str.join('&')
    }
    register(action, data){
        if(!data){
            data = {}
        }
        data.uiLocale = global.lang.locale
        data.arch = process.arch
        data.platform = process.platform
        data.ver = global.MANIFEST.version
        data.verinf = ''
        if(data.source && global.config.get('shared-mode-lists-amount') == 0){
            console.log('Source URL not shareable.')
            data.source = ''
        }
        let postData = this.serialize(data)
        let options = {
            port: 80,
            family: 4, // https://github.com/nodejs/node/issues/5436
            method: 'POST',
            path: '/analytics/' + action,
            hostname: 'app.megacubo.net',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData),
                'Cache-Control': 'no-cache'
            }
        }
        if(this.debug){
            console.log('register', options, postData)
        }
        let req = http.request(options, res => {
            res.setEncoding('utf8')
            let data = ''
            res.on('data', (d) => {
                data += d
            })
            res.on('end', () => {
                if(this.debug){
                    console.log('register('+action+')', data)
                }
            })
        }) 
        req.on('error', (e) => {
            console.error('Houve um erro', e)
        })
        if(req.writable){
            req.write(postData)
        }
        req.end()
    }
    prepareEntry(entry){
        if(!entry || typeof(entry)!='object'){
            entry = {}
        }
        return entry
    }
}

class AnalyticsEvents extends AnalyticsBase {
    constructor(){
        super()
    }
    data(){
        let data = {}
        if(global.streamer.active){
            data = global.streamer.active.data
        }
        return this.prepareEntry(data)
    }
    alive(){
        this.register('alive', this.data())
    }
    success(){
        this.register('success', this.data())
    }
    error(e){
        if(e){
            this.register('error', this.prepareEntry(e))
        }
    }
    stop(){
        this.register('stop')
    }
    search(e){
        if(e){
            this.register('search', e)
        }
    }
}

class Analytics extends AnalyticsEvents {
    init(){
        setInterval(this.alive.bind(this), this.keepAliveTTL)
        global.streamer.on('commit', this.success.bind(this))
        global.streamer.on('stop', this.stop.bind(this))
        global.search.on('search', data => {
            this.search(data)
        })
    }
}

module.exports = Analytics
