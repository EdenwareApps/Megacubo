
class CloudData {
    constructor(opts){
        this.debug = false
        this.defaultServer = 'http://app.megacubo.net'
        this.server = global.config.get('config-server') || this.defaultServer
        this.locale = global.lang.locale
        this.expires = {
            'searching': 6 * 3600,
            'channels': 6 * 3600,
            'configure': 1 * 3600,
            'country-sources': 6 * 3600,
            'sources': 6 * 3600,
            'watching': 300
        }
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
        if(['configure', 'themes'].includes(key)){
            return this.server + '/' + key + '.json'
        } else if(key.indexOf('/') != -1 || key.indexOf('.') != -1) {
            return this.server + '/stats/data/' + key + '.json'
        } else {
            return this.server + '/stats/data/' + key + '.' + this.locale +'.json'
        }
    }
    async get(key, raw, softTimeout){
        if(this.debug){
            console.log('cloud: get', key, traceback())
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
            let p2p = key != 'configure' && !key.startsWith('channels') && global.config.get('p2p') 
            let url = this.url(key)
            let err, err2, body = await global.Download.get({
                url,
                responseType: raw === true ? 'text' : 'json',
                timeout: 60,
                retry: 10,
                p2p,
                cacheTTL: this.expires[expiralKey] || 300
            }).catch(e => err = e)
            if(this.debug){
                console.log('cloud: got', key, err, body)
            }
            data = await store.promises.get(this.cachingDomain + key + '-fallback').catch(e => err2 = e)
            if(err || !body){
                if(data && !err2){
                    return data
                } else {
                    throw err || 'empty response, no fallback'
                }
            } else {
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
            }
        }
    }
}

module.exports = CloudData
