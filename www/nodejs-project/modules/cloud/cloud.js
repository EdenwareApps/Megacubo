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
            'promote': 300,
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
    async testConfigServer(baseUrl){
        let data = await Download.get({url: baseUrl + '/configure.json', responseType: 'json'})
        if(data && data.version) return true
        throw 'Bad config server URL'
    }
    url(key){
        if(['configure', 'promote', 'themes'].includes(key)){
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
        const store = raw === true ? global.storage.raw : global.storage
        let data = await store.promises.get(this.cachingDomain + key).catch(console.error)
        if(data){
            if(this.debug){
                console.log('cloud: got cache', key)
            }
            return data
        } else {
            if(this.debug){
                console.log('cloud: no cache', key)
            }
            if(this.debug){
                console.log('cloud: fallback', key)
            }
            const p2p = key != 'configure' && global.config.get('p2p') 
            const url = this.url(key)
            let err, err2, body = await global.Download.get({
                url,
                responseType: raw === true ? 'text' : 'json',
                timeout: 60,
                retry: 10,
                p2p,
                p2pWaitMs: 500,
                cacheTTL: this.expires[expiralKey] || 300
            }).catch(e => err = e)
            if(this.debug){
                console.log('cloud: got', key, err, body)
            }
            // use validator here only for minor overhead, so we'll not cache any bad data
            const succeeded = !err && body && (typeof(validator) != 'function' || validator(body))
            if(succeeded){
                if(this.debug){
                    console.log('cloud: got', key, body, this.expires[expiralKey])
                }
                if(typeof(this.expires[expiralKey]) != 'undefined'){
                    store.set(this.cachingDomain + key, body, this.expires[expiralKey])
                    store.set(this.cachingDomain + key + '-fallback', body, true)
                } else {
                    console.error('"'+ key +'" is not cacheable (no expires set)')
                }
                if(this.debug){
                    console.log('cloud: got', key, body, this.expires[expiralKey])
                }
                return body
            } else {
                data = await store.promises.get(this.cachingDomain + key + '-fallback').catch(e => err2 = e)
                if(data && !err2){
                    return data
                } else {
                    if(err && String(err).endsWith('404')) this.notFound.push(key)
                    throw err || 'empty response, no fallback'
                }
            }
        }
    }    
    async discovery(adder){
        const timeoutMs = 30000
        const limit = pLimit(3)
        let data = {}, locs = await global.lang.getActiveCountries(), solved = []
        await Promise.allSettled(locs.map(loc => {
            return async () => {
                const es = await this.get('country-sources.'+ loc, false, timeoutMs).catch(console.error)
                solved.push(loc)
                Array.isArray(es) && adder(es)
            }
        }).map(limit))
        return [] // used 'adder'
    }
}

module.exports = CloudConfiguration
