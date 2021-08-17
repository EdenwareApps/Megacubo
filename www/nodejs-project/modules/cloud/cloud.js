
class CloudData {
    constructor(opts){
        this.debug = false
        this.domain = 'app.megacubo.net'
        this.base = 'http://' + this.domain
        this.baseURL = this.base +'/stats/data/'
        this.locale = global.lang.locale
        this.expires = {
            'searching': 6 * 3600,
            'categories': 6 * 3600,
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
    url(key){
        if(key == 'configure'){
            return this.base + '/' + key + '.json'
        } else {
            return this.baseURL + key + '.' + this.locale +'.json'
        }
    }
    get(key, raw, softTimeout){
        return new Promise((resolve, reject) => {
            if(this.debug){
                console.log('cloud: get', key, traceback())
            }
            const store = raw === true ? global.rstorage : global.storage
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
                            retry: 10,
                            headers: {
                                'host': this.domain,
                                'accept-encoding': 'identity' // not needed and problematic
                            }
                        }).then(body => {
                            if(!body){
                                error('Server returned empty')
                            } else {
                                if(this.debug){
                                    console.log('cloud: got', key, body, this.expires[key])
                                }
                                if(typeof(this.expires[key]) != 'undefined'){
                                    store.set(this.cachingDomain + key, body, this.expires[key])
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
