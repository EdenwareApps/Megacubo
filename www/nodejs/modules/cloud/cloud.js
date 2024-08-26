import Download from '../download/download.js'
import lang from '../lang/lang.js'
import storage from '../storage/storage.js'
import fs from 'fs'
import http from 'http'
import config from '../config/config.js'
import paths from '../paths/paths.js'
import { EventEmitter } from 'events'
import { getDirname } from 'cross-dirname'
import { parseJSON } from '../utils/utils.js'

class CloudConfiguration extends EventEmitter {
    constructor(opts) {
        super()
        this.debug = false
        this.defaultServer = 'http://app.megacubo.net/stats/data'
        this.server = config.get('config-server') || this.defaultServer
        this.expires = {
            'configure': 3600,
            'promos': 300,
            'searches': 6 * 3600,
            'channels': 6 * 3600,
            'sources': 6 * 3600,
            'watching': 300
        }
        this.reading = {}
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
        return this.server +'/'+ key +'.json'
    }
    file(key) {
        return paths.cwd +'/dist/defaults/'+ key +'.json'
    }
    async get(...args) {
        let prom
        const key = args[0], original = !this.reading[key]
        if(original) {
            this.reading[key] = true
            prom = this.read(...args)
            prom.then(r => this.emit(key, null, r)).catch(e => this.emit(key, e))
        } else {
            prom = new Promise((rs, rj) => {
                this.once(key, (err, data) => (err ? rj(err) : rs(data)))
            })
        }
        return await new Promise((resolve, reject) => {
            let resolved, timer = 0
            prom.then(resolve).catch(reject).finally(() => {
                resolved = true
                clearTimeout(timer)
                if(original) {
                    delete this.reading[key]
                }
            })
            if(args.length > 1 && args[1].timeoutMs) {
                timer = setTimeout(() => {
                    if(resolved) return
                    resolved = true
                    const err = 'cloud: get timeout ' + JSON.stringify(args)
                    console.error(err)
                    reject(err)
                }, args[1].timeoutMs)
            }
        })
    }
    async fetch(key, opts={}) {
        let err
        const url = this.url(key), body = await Download.get({
            url,
            debug: this.debug,
            retry: 2,
            timeout: 30,
            responseType: 'json',
            cacheTTL: this.expires[opts.expiralKey] || 300,
            encoding: 'utf8'
        }).catch(e => err = e)
        if (this.debug) {
            console.log('cloud: got ' + JSON.stringify({ key, err, body }));
        }
        // use validator here only for minor overhead, so we'll not cache any bad data
        const succeeded = !err && body && (typeof (opts.validator) != 'function' || opts.validator(body))
        if (this.debug) {
            console.log('cloud: got ' + JSON.stringify({key, succeeded}))
        }
        if (succeeded) {
            if (this.debug) {
                console.log('cloud: got', key, body, this.expires[opts.expiralKey]);
            }
            this.save(key, body, opts)
            return body
        }
        if (err && String(err).endsWith('404')) {
            this.notFound.push(key)
        }
        throw err || 'unknown download error'
    }
    async read(key, opts={}) {
        if (this.debug) {
            console.log('cloud: get', key)
        }
        opts.expiralKey = key.split('/')[0].split('.')[0]
        opts.cachingDomain = this.cachingDomain()
        let rerr, serr, data = await storage.get(opts.cachingDomain + key).catch(console.error);
        if (data) {
            if (this.debug) {
                console.log('cloud: got cache', key);
            }
            return data
        }
        let ferr
        const fetching = this.fetch(key, opts).then(ret => {
            this.save(key, ret, opts).catch(console.error)
        }).catch(e => ferr = e)
        if(opts.shadow === false) { // shadow=true is default
            data = await fetching
            if (!ferr) {
                return data
            } else if (this.debug) {
                console.log('cloud: fetch failure', key, ferr)
            }
        }
        data = await storage.get(opts.cachingDomain + key + '-fallback').catch(e => serr = e)
        if (data && !serr) {
            this.emit(key, null, data)
            return data
        }
        if (this.debug) {
            console.log('cloud: get fallback** ' + JSON.stringify({ key, url }));
        }
        data = await this.fromDefaults(key).catch(e => rerr = e)
        if (data && !rerr) {
            return data
        }
        return await fetching
    }
    async fromDefaults(key) {    
        let err
        const file = this.file(key)
        const stat = await fs.promises.stat(file).catch(e => err = e)
        if(stat && stat.size) {
            const content = await fs.promises.readFile(file)
            return parseJSON(content)
        }
        err = 'empty response, no fallback for ' + key
        this.emit(key, err)
        throw err
    }
    async save(key, body, opts) {
        const permanent = key === 'configure'
        if (typeof (this.expires[opts.expiralKey]) != 'undefined') {
            storage.set(opts.cachingDomain + key, body, { ttl: this.expires[opts.expiralKey], permanent });
            storage.set(opts.cachingDomain + key + '-fallback', body, { expiration: true, permanent });
        } else {
            console.error('"' + key + '" is not cacheable (no expires set)');
        }
    }
}

export default new CloudConfiguration()
