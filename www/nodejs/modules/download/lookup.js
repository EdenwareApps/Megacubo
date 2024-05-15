import storage from '../storage/storage.js'
import { EventEmitter } from 'events';
import { NOTFOUND, promises, getServers } from 'dns';
import config from "../config/config.js"

const { Resolver: AsyncResolver } = promises

// To bypass any DNS censorship, we'll use the local DNS plus external DNS resolvers
// Returns the first response, but caches the more trustful results
class UltimateLookup extends EventEmitter {
    constructor(servers) {
        super();
        this.debug = false;
        this.data = {};
        this.ttlData = {};
        this.queue = {};
        this.ttl = 3600;
        this.failureTTL = 30;
        this.cacheKey = 'lookup';
        this.servers = servers;
        this.isReady = false;
        this.readyQueue = [];
        this.saveDelayMs = 3000;
        this.resolvers = {};
        this.failedIPs = {};
        this.lastResolvedIP = {};
        const local = getServers();
        if (Array.isArray(local) && local.length) {
            const already = Object.keys(servers).some(s => {
                return servers[s].some(ip => local.includes(ip));
            });
            if (!already) {
                servers.local = local;
            }
        }
        Object.keys(servers).forEach(s => {
            this.resolvers[s] = new AsyncResolver()
            this.resolvers[s].setServers(servers[s])
        })
        this.load().catch(e => menu.displayErr(e));
    }
    family(ip) {
        if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ip)) {
            return 4;
        }
        return 6;
    }
    preferableIpVersion() {
        return config.get('preferred-ip-version') == 6 ? 6 : 4;
    }
    promotePreferableIpVersion(hostname, ips, keepAll) {
        let family, pref = this.preferableIpVersion()
        let nips = ips.filter(ip => this.family(ip) == pref)
        if (nips.length) {
            family = pref;
            if (keepAll) {
                family = -1
                nips.push(...ips.filter(ip => this.family(ip) != pref))
            }
            ips = nips
        } else {
            family = pref == 4 ? 6 : 4;
        }
        if (ips.length > 1) {
            ips = ips.unique().sort((a, b) => {
                if (!this.failedIPs[hostname])
                    return 0;
                let aa = this.failedIPs[hostname].indexOf(a);
                let bb = this.failedIPs[hostname].indexOf(b);
                return aa > bb ? 1 : (bb > aa ? -1 : 0);
            })
        }
        return { ips, family }
    }
    ready() {
        return new Promise((resolve, reject) => {
            if (this.isReady) {
                resolve();
            } else {
                this.readyQueue.push(resolve);
            }
        });
    }
    reset() {
        if (this.debug) {
            console.log('lookup->reset', domain);
        }
        Object.keys(this.data).forEach(k => {
            if (!Array.isArray(this.data[k])) {
                delete this.data[k];
            }
        });
    }
    async get(domain, family) {
        if (this.debug) {
            console.log('lookup->get', domain, family);
        }
        if (![4, 6].includes(family)) {
            let aresults, bresults
            await Promise.allSettled([
                this.get(domain, 4).then(a => aresults = a),
                this.get(domain, 6).then(b => bresults = b)
            ])
            if (!Array.isArray(aresults)) aresults = []
            if (Array.isArray(bresults)) aresults.push(...bresults)
            aresults = this.promotePreferableIpVersion(domain, aresults, true)
            return aresults.ips;
        }
        const now = (Date.now() / 1000), key = domain + family;
        if (typeof (this.data[key]) != 'undefined') { // cached
            if (Array.isArray(this.data[key]) && this.data[key].length) {
                if (this.ttlData[key] >= now) {
                    if (this.debug) {
                        console.log('lookup->get cached cb', this.data[key]);
                    }
                    return this.data[key].slice(0); // clone it, no ref
                }
            } else {
                let locked = now < this.ttlData[key];
                if (locked) {
                    if (this.debug) {
                        console.log('lookup->get cached failure cb', false);
                    }
                    return false;
                }
            }
        }
        return await this.process(domain, family);
    }
    process(domain, family) {
        return new Promise(resolve => {
            const queueKey = domain + family
            if (typeof (this.queue[queueKey]) != 'undefined') {
                if (this.debug) {
                    console.log('lookup->queued', domain);
                }
                return this.queue[queueKey].push(resolve);
            }
            this.queue[queueKey] = [resolve]
            let resultIps = {}
            const tasks = Object.keys(this.resolvers).map(k => {
                return async () => {
                    if (this.debug) {
                        console.log('lookup->get solving', domain)
                    }
                    let err
                    const ips = await this.resolvers[k]['resolve' + family](domain).catch(e => err = e)
                    if (err) {
                        if (this.debug) {
                            console.error('lookup->get err on ' + k, err)
                        }
                        return
                    }
                    this.finishQueue(domain, queueKey, ips, false) // this will make it respond ASAP, but we'll still be looking for most trusteable results on other resolvers
                    ips.forEach(ip => {
                        if (typeof (resultIps[ip]) == 'undefined') {
                            resultIps[ip] = 0
                        }
                        resultIps[ip]++
                    })
                }
            })
            Promise.allSettled(tasks.map(f => f())).catch(console.error).finally(() => {
                if (this.debug) {
                    console.log('lookup->get solved', domain)
                }
                // all resolvers checked, time to a final response and/or caching
                let sortedIps = Object.keys(resultIps).sort((a, b) => resultIps[b] - resultIps[a])
                if (!sortedIps.length) {
                    this.finishQueue(domain, queueKey, false, true)
                } else {
                    let max = resultIps[sortedIps[0]]; // ensure to get the most trusteables by score
                    let ips = sortedIps.filter(s => resultIps[s] == max)
                    this.finishQueue(domain, queueKey, ips, true)
                }
            })
        })
    }
    finishQueue(domain, queueKey, value, isFinal) {
        if (Array.isArray(value) && !value.length) value = false
        this.ttlData[queueKey] = (Date.now() / 1000) + (Array.isArray(value) ? this.ttl : this.failureTTL) // before possibly alter value with cached one
        if (!value && this.ttlData[queueKey] && Array.isArray(this.ttlData[queueKey])) value = this.ttlData[queueKey] // keep cached one
        this.data[queueKey] = value;
        if (this.queue[queueKey] && (Array.isArray(value) || isFinal)) {
            if (this.debug) {
                console.log('lookup->finish', domain, queueKey, value)
            }
            this.queue[queueKey].forEach(f => f(value, false))
            delete this.queue[queueKey]
        }
        if (isFinal && !Object.keys(this.queue).length)
            this.save()
    }
    async lookup(hostname, options) {
        if (typeof (options) == 'function') {
            options = {};
        }
        await this.ready();
        let family = typeof (options.family) == 'undefined' ? 0 : options.family;
        let policy = config.get('preferred-ip-version');
        if ([4, 6].includes(policy)) {
            family = policy;
        }
        let ips = await this.get(hostname, options.family);
        if (!ips || !Array.isArray(ips) || !ips.length) {
            console.warn('Cannot resolve "' + hostname + '"');
            const error = new Error('cannot resolve "' + hostname + '"');
            error.code = NOTFOUND;
            throw error;
        }
        if (options && options.all) {
            if (this.debug) {
                console.log('lookup callback', ips, family);
            }
            if (family === 0) {
                let ret = this.promotePreferableIpVersion(hostname, ips);
                ips = ret.ips;
            }
            ips = ips.map(address => {
                return { address, family: this.family(address) };
            });
            return ips;
        }
        let ip;
        if (family > 0) {
            ip = ips[Math.floor(Math.random() * ips.length)];
        } else {
            let ret = this.promotePreferableIpVersion(hostname, ips);
            ips = ret.ips;
            ip = ips[0];
        }
        this.lastResolvedIP[hostname] = ip;
        if (this.debug) {
            console.log('lookup callback', ip, family);
        }
        return ip;
    }
    defer(hostname, ip) {
        if (typeof (this.failedIPs[hostname]) == 'undefined') {
            this.failedIPs[hostname] = [];
        } else {
            this.failedIPs[hostname] = this.failedIPs[hostname].filter(i => i != ip);
        }
        this.failedIPs[hostname].push(ip);
    }
    clean() {
        const deadline = (Date.now() / 1000) - (7 * (24 * 3600));
        Object.keys(this.ttlData).forEach(k => {
            if (this.ttlData[k] < deadline) {
                delete this.data[k];
                delete this.ttlData[k];
            }
        });
    }
    async load() {
        let data = await storage.get(this.cacheKey);
        if (data && data.data) {
            this.data = Object.assign(data.data, this.data);
            this.ttlData = Object.assign(data.ttlData, this.ttlData);
        }
        if (this.debug) {
            console.log('lookup->ready');
        }
        this.isReady = true;
        this.readyQueue.forEach(f => f());
        this.readyQueue.length = 0;
    }
    save() {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(() => {
            this.clean();
            storage.set(this.cacheKey, { data: this.data, ttlData: this.ttlData }, {
                permanent: true,
                expiration: true
            });
        }, this.saveDelayMs);
    }
}
const lookup = new UltimateLookup({
    gg: ['8.8.4.4', '8.8.8.8'],
    cf: ['1.1.1.1', '1.0.0.1'] // cloudflare
});
//lookup.debug = true
lookup.lookup = lookup.lookup.bind(lookup);
export default lookup;
