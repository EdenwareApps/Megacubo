const pLimit = require('p-limit')

class CloudConfiguration {
    constructor(opts){
        this.debug = false
        this.defaultServer = 'http://app.megacubo.net'
        this.server = global.config.get('config-server') || this.defaultServer
        this.locale = global.lang.locale
        this.expires = {
            'searching': 6 * 3600,
            'channels': 6 * 3600,
            'configure': 3600,
            'promos': 300,
            'country-sources': 6 * 3600,
            'watching-country': 300
        }
        this.notFound = []
		if(opts){
			Object.keys(opts).forEach(k => this[k] = opts[k])
        }
        if(this.locale.length > 2){
            this.locale = this.locale.substr(0, 2)
        }
        this.cachingDomain = 'cloud-' + this.locale + '-'
    }
    getCountry(ip){
        return new Promise((resolve, reject) => {
            const postData = 'ip='+ ip, http = require('http')
            const options = {
                port: 80,
                family: 4, // https://github.com/nodejs/node/issues/5436
                method: 'POST',
                path: '/stats/get_country_low',
                hostname: global.Download.domain(this.server),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': postData.length,
                    'Cache-Control': 'no-cache'
                }
            }
            const req = http.request(options, res => {
                res.setEncoding('utf8')
                let data = ''
                res.on('data', (d) => {
                    data += d
                })
                res.on('error', reject)
                res.once('end', () => {
                    try {
                        data = JSON.parse(data)
                        if(!data || !data.country_code) throw 'invalid response: '+ data
                        resolve(data.country_code)
                    } catch(e) {
                        reject(e)
                    }
                })
            }).on('error', reject)
            req.on('error', reject)
            req.write(postData)
            req.end()
        })
    }
    async testConfigServer(baseUrl){
        let data = await global.Download.get({url: baseUrl + '/configure.json', responseType: 'json'})
        if(data && data.version) return true
        throw 'Bad config server URL'
    }
    url(key){
        if(['configure', 'promos', 'themes'].includes(key)){
            return this.server + '/' + key + '.json'
        } else if(key.indexOf('/') != -1 || key.indexOf('.') != -1) {
            return this.server + '/stats/data/' + key + '.json'
        } else {
            return this.server + '/stats/data/' + key + '.' + this.locale +'.json'
        }
    }
    async get(key, raw, validator){
        if(this.debug){
            console.log('cloud: get', key, traceback())
        }        
        if(this.notFound.includes(key)) {
            throw "cloud data \'"+ key +"\' not found"
        }
        const expiralKey = key.split('/')[0].split('.')[0]
        const permanent = 'configure' == expiralKey
        let data = await global.storage.get(this.cachingDomain + key).catch(console.error)
        if(data){
            if(this.debug){
                console.log('cloud: got cache', key)
            }
            return data
        }
        if(this.debug){
            console.log('cloud: no cache fallback', key)
        }
        const url = this.url(key)
        let err, err2, body = await global.Download.get({
            url,
            retry: 10,
            timeout: 60,
            responseType: raw === true ? 'text' : 'json',
            cacheTTL: this.expires[expiralKey] || 300,
            encoding: 'utf8'
        }).catch(e => err = e)
        if(this.debug){
            console.log('cloud: got '+ JSON.stringify({key, err, body}))
        }
        // use validator here only for minor overhead, so we'll not cache any bad data
        const succeeded = !err && body && (typeof(validator) != 'function' || validator(body))
        if(this.debug){
            console.log('cloud: got '+ JSON.stringify({key, succeeded}))
        }
        if(succeeded){
            if(this.debug){
                console.log('cloud: got', key, body, this.expires[expiralKey])
            }
            if(typeof(this.expires[expiralKey]) != 'undefined'){
                global.storage.set(this.cachingDomain + key, body, {ttl: this.expires[expiralKey], permanent})
                global.storage.set(this.cachingDomain + key + '-fallback', body, {expiration: true, permanent})
            } else {
                console.error('"'+ key +'" is not cacheable (no expires set)')
            }
            if(this.debug){
                console.log('cloud: got', key, body, this.expires[expiralKey])
            }
            return body
        }
        if(this.debug){
            console.log('cloud: get fallback '+ JSON.stringify({key}))
        }
        data = await global.storage.get(this.cachingDomain + key + '-fallback').catch(e => err2 = e)
        if(this.debug){
            console.log('cloud: get fallback* '+ JSON.stringify({key, data, err2}))
        }
        if(data && !err2){
            return data
        }
        if(err && String(err).endsWith('404')) {
            this.notFound.push(key)
        }
        if(this.debug){
            console.log('cloud: get fallback** '+ JSON.stringify({key, err, url}))
        }
        if(!err) err = 'empty response, no fallback for '+ url
        throw err
    }
}

module.exports = CloudConfiguration
