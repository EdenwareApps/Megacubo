import Download from '../download/download.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import http from 'http'
import config from '../config/config.js'
import { EventEmitter } from 'events'

class CloudConfiguration extends EventEmitter {
    constructor(opts) {
        super()
        this.debug = false
        this.defaultServer = 'http://app.megacubo.net'
        this.server = config.get('config-server') || this.defaultServer
        this.expires = {
            'searching': 6 * 3600,
            'channels': 6 * 3600,
            'configure': 3600,
            'promos': 300,
            'country-sources': 6 * 3600,
            'watching-country': 300
        }
        this.downloading = {}
        this.notFound = []
        if (opts) {
            Object.keys(opts).forEach(k => this[k] = opts[k])
        }
    }
    cachingDomain() {
        return 'cloud-' + lang.locale + '-'
    }
    getCountry(ip) {
        return new Promise((resolve, reject) => {
            const postData = 'ip='+ ip
            const options = {
                port: 80,
                family: 4,
                method: 'POST',
                path: '/stats/get_country_low',
                hostname: Download.getDomain(this.server),
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': postData.length,
                    'Cache-Control': 'no-cache'
                }
            }
            const req = http.request(options, res => {
                res.setEncoding('utf8');
                let data = ''
                res.on('data', d => data += d)
                res.on('error', reject)
                res.once('end', () => {
                    try {
                        data = JSON.parse(data)
                        if (!data || !data.country_code) throw 'invalid response: '+ data
                        resolve(data.country_code)
                    } catch (e) { reject(e) }
                });
            }).on('error', reject)
            req.on('error', reject)
            req.write(postData)
            req.end()
        })
    }
    async testConfigServer(baseUrl) {
        let data = await Download.get({ url: baseUrl + '/configure.json', responseType: 'json' });
        if (data && data.version)
            return true;
        throw 'Bad config server URL';
    }
    url(key) {
        if (['configure', 'promos', 'themes'].includes(key)) {
            return this.server + '/' + key + '.json';
        } else if (key.indexOf('/') != -1 || key.indexOf('.') != -1) {
            return this.server + '/stats/data/' + key + '.json';
        } else {
            return this.server + '/stats/data/' + key + '.' + lang.locale + '.json';
        }
    }
    get(...args) {
        return new Promise((resolve, reject) => {
            let resolved, timer = 0
            if(args.length > 1 && args[1].timeoutMs) {
                timer = setTimeout(() => {
                    if(resolved) return
                    resolved = true
                    const err = 'cloud: get timeout ' + JSON.stringify(args)
                    console.error(err)
                    reject(err)
                }, args[1].timeoutMs)
            }
            this._get(...args).then(resolve).catch(reject).finally(() => {
                resolved = true
                clearTimeout(timer)
            })
        })
    }
    async _get(key, opts={}) {
        if (this.debug) {
            console.log('cloud: get', key)
        }
        if (this.notFound.includes(key)) {
            throw 'cloud data \'' + key + '\' not found';
        }
        const expiralKey = key.split('/')[0].split('.')[0];
        const permanent = 'configure' == expiralKey;
        const cachingDomain = this.cachingDomain();
        let data = await storage.get(cachingDomain + key).catch(console.error);
        if (data) {
            if (this.debug) {
                console.log('cloud: got cache', key);
            }
            return data
        }
        if (this.debug) {
            console.log('cloud: no cache fallback', key);
        }
        if(this.downloading[key]) {
            return new Promise((resolve, reject) => {
                this.once(key, (err, data) => {
                    if(err) return reject(err)
                    resolve(data)
                })
            })
        }
        this.downloading[key] = true
        const url = this.url(key)
        let err, err2, body = await Download.get({
            url,
            debug: this.debug,
            retry: 10,
            timeout: 60,
            responseType: opts.raw === true ? 'text' : 'json',
            cacheTTL: this.expires[expiralKey] || 300,
            encoding: 'utf8'
        }).catch(e => err = e);
        if (this.debug) {
            console.log('cloud: got ' + JSON.stringify({ key, err, body }));
        }
        // use validator here only for minor overhead, so we'll not cache any bad data
        const succeeded = !err && body && (typeof (opts.validator) != 'function' || opts.validator(body))
        if (this.debug) {
            console.log('cloud: got ' + JSON.stringify({ key, succeeded }));
        }
        if (succeeded) {
            if (this.debug) {
                console.log('cloud: got', key, body, this.expires[expiralKey]);
            }
            if (typeof (this.expires[expiralKey]) != 'undefined') {
                storage.set(cachingDomain + key, body, { ttl: this.expires[expiralKey], permanent });
                storage.set(cachingDomain + key + '-fallback', body, { expiration: true, permanent });
            } else {
                console.error('"' + key + '" is not cacheable (no expires set)');
            }
            if (this.debug) {
                console.log('cloud: got', key, body, this.expires[expiralKey]);
            }
            delete this.downloading[key]
            this.emit(key, null, body)
            return body
        }
        if (this.debug) {
            console.log('cloud: get fallback ' + JSON.stringify({ key }));
        }
        data = await storage.get(cachingDomain + key + '-fallback').catch(e => err2 = e);
        if (this.debug) {
            console.log('cloud: get fallback* ' + JSON.stringify({ key, data, err2 }));
        }
        if (data && !err2) {
            delete this.downloading[key]
            this.emit(key, null, data)
            return data
        }
        if (err && String(err).endsWith('404')) {
            this.notFound.push(key);
        }
        if (this.debug) {
            console.log('cloud: get fallback** ' + JSON.stringify({ key, err, url }));
        }
        if (!err) err = 'empty response, no fallback for ' + url        
        delete this.downloading[key]
        this.emit(key, err)
        throw err
    }
}

export default new CloudConfiguration()
