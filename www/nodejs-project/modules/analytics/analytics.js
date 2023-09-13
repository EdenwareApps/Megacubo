const Events = require('events'), http = require('http')

class AnalyticsBase extends Events {
    constructor(){
        super()
        this.debug = false
        this.keepAliveTTL = 600000
    }
    toQS(obj){
        let str = []
        Object.keys(obj).forEach(k => {
            if(typeof(obj[k]) == 'string'){
                str.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
            }
        })
        return str.join('&')
    }
    register(action, data){
        if(!data){
            data = {}
        }
        data.uiLocale = global.lang.locale
        data.arch = process.arch
        data.platform = process.platform
        data.country = global.lang.countryCode
        data.ver = global.MANIFEST.version
        data.verinf = ''
        if(global.options.prm()) {
            data.verinf = global.premium.active
        }
        if(data.url) data.url = this.obfuscateURL(data.url)
        if(data.source && global.lists.isPrivateList(data.source)) data.source = '' // Source URL not shareable.
        data.epg = global.channels.loadedEPG || data.epg || ''
        let postData = this.toQS(data)
        let options = {
            port: 80,
            family: 4, // https://github.com/nodejs/node/issues/5436
            method: 'POST',
            path: '/stats/'+ action,
            hostname: 'app.megacubo.net',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length,
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
            res.once('end', () => {
                if(this.debug){
                    console.log('register('+action+')', data)
                }
            })
        }) 
        req.on('error', (e) => {
            console.error('Houve um erro', e)
        })
        global.isWritable(req) && req.write(postData)
        req.end()
    }
    prepareEntry(entry){
        if(!entry || typeof(entry) != 'object'){
            return {}
        } else {
            return Object.assign({}, entry)
        }
    }
    obfuscateURL(url) {
        const file = url.split('?').shift().split('/').pop() // keep only the original filename as hint to know if it is a 'live' or 'vod' content
        return 'https://localhost/'+ file
    }
}

class AnalyticsEvents extends AnalyticsBase {
    constructor(){
        super()
    }
    data(){
        let data = {}
        if(global.streamer && global.streamer.active){
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
    constructor(){
        super()
        setInterval(this.alive.bind(this), this.keepAliveTTL)
        global.streamer.on('commit', this.success.bind(this))
        global.streamer.on('stop', this.stop.bind(this))
        global.search.on('search', data => {
            this.search(data)
        })
        this.alive()
    }
}

module.exports = Analytics
