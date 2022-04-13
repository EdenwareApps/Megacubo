
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
        let data = await Download.promise({url: baseUrl + '/configure.json', responseType: 'json'})
        if(data && data.version) return true
        throw 'Bad config server URL'
    }
    url(key){
        if(['configure', 'themes'].includes(key)){
            return this.server + '/' + key + '.json'
        } else if(key.indexOf('/') != -1) {
            return this.server + '/stats/data/' + key + '.json'
        } else {
            return this.server + '/stats/data/' + key + '.' + this.locale +'.json'
        }
    }
    get(key, raw, softTimeout){
        return new Promise((resolve, reject) => {
            if(this.debug){
                console.log('cloud: get', key, traceback())
            }
            const expiralKey = key.split('/')[0]
            const store = raw === true ? global.storage.raw : global.storage
            store.get(this.cachingDomain + key, data => {
                if(data){
                    if(this.debug){
                        console.log('cloud: get cached', key)
                    }
                    return resolve(data)
                } else {
                    if(this.debug){
                        console.log('cloud: no stored data', key)
                    }
                    store.get(this.cachingDomain + key + '-fallback', data => {
                        if(this.debug){
                            console.log('cloud: get', key)
                        }
                        let solved, error = err => {   
                            if(this.debug){
                                console.log('cloud: solve', err, solved) 
                            }
                            if(!solved){
                                solved = true
                                if(data){
                                    //console.warn(err, key)
                                    resolve(data) // fallback
                                } else {
                                    console.error('cloud: error', key, err)
                                    reject('connection error')
                                }
                            }
                        }
                        let url = this.url(key)
                        if(this.debug){
                            console.log('cloud: get', key, url)
                        }
                        global.Download.promise({
                            url,
                            responseType: raw === true ? 'text' : 'json',
                            timeout: 60,
                            retry: 10
                        }).then(body => {
                            if(!body){
                                error('Server returned empty')
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
                                if(!solved){
                                    solved = true
                                    resolve(body)
                                }
                            }
                        }).catch(err => {
                            console.log('cloud: error: '+ String(err))
                            error(err)
                        })
                        if(typeof(softTimeout) != 'number'){
                            softTimeout = 10000
                        }
                        setTimeout(() => {
                            if(data || softTimeout == 0){
                                error('cloud: soft timeout ('+ key +', '+ softTimeout+'), keeping request to update data in background', data)
                            }
                        }, softTimeout)
                    })
                }
            })
        })
    }
}

module.exports = CloudData
