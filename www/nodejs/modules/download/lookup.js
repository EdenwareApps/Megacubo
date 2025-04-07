import storage from '../storage/storage.js';
import { promises as dnsPromises } from 'dns';
import config from "../config/config.js";
import Limiter from '../limiter/limiter.js';

class Lookup {
  constructor(servers) {
    this.cacheKey = 'lookup';
    this.ttl = 3600; // default TTL: 1 hour
    this.failureTTL = 30; // default TTL in case of failure: 30 seconds
    this.data = {};
    this.ttlData = {};
    this.promises = {};    
    this.limiter = new Limiter(() => this._save(), 10000);

    // Create custom resolvers
    this.resolvers = Object.keys(servers).map(key => {
      const resolver = new dnsPromises.Resolver();
      resolver.setServers(servers[key]);
      return resolver;
    });
    // Add also the default system resolver
    this.resolvers.push(new dnsPromises.Resolver());

    // Load cached data (asynchronously)
    this.initialized = this.load().catch(err => console.error(err));
  }

  /**
   * Returns the DNS resolution for the specified hostname.
   * If the cache is valid, returns the cached result.
   * Otherwise, uses a Promise.race for fast response and updates the cache in the background.
   *
   * @param {string} hostname - The domain to be resolved.
   * @param {object} options - Additional options. If options.family is not provided,
   *                           uses config.get('preferred-ip-version') or 0 (all versions).
   *                           If options.all is true, returns all formatted IPs.
   * @returns {Promise<string|object>} - The first IP or, if options.all, a list of objects.
   * @throws {Error} - If the hostname cannot be resolved.
   */
  async lookup(hostname, options = {}) {

    await this.initialized

    const now = Date.now() / 1000;

    if (options.debug !== true) {
      if (this.promises?.[hostname]) {
        await this.promises[hostname].catch(() => false) // await concurrent promise to use reuse its cache
      }
  
      // Return the cached result if it is valid
      if (this.data?.[hostname] && this.ttlData[hostname] > now) {
        return this._format(hostname, options);
      }
    }

    let resolve
    this.promises[hostname] = new Promise(res => resolve = res)
    this.promises[hostname].resolve = resolve
  
    // Create tasks for each resolver, according to the family type
    const tasks = this.resolvers.map(resolver => {
      return Promise.allSettled([
        resolver.resolve4(hostname),
        resolver.resolve6(hostname)
      ]).then(results => {
        if (options.debug) {
          console.log('lookup*', hostname, results);
        }
        const ret = []
        if (results[0].status === 'fulfilled') {
          ret.push(...results[0].value);
        }
        if (results[1].status === 'fulfilled') {
          ret.push(...results[1].value);
        }
        if(!ret.length) {
          throw new Error('No IP addresses found');
        }
        return ret;
      });
    });
  
    // Fast response: uses Promise.any to get the first valid result, ignoring failures
    let fastResult;
    try {
      fastResult = await Promise.any(tasks);
    } catch (e) {
      fastResult = [];
    }
  
    // In background: collects all responses and updates the cache with the best result
    Promise.allSettled(tasks)
      .then(results => {
        if (options.debug) {
          console.log('lookup*', hostname, results);
        }
        const fulfilledValues = results
          .filter(r => r.status === 'fulfilled')
          .flatMap(r => r.value);
        const counts = fulfilledValues.reduce((acc, ip) => {
          acc[ip] = (acc[ip] || 0) + 1;
          return acc;
        }, {});
        const ips = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .map(([ip]) => ip);
        if (ips.length || !this.data?.[hostname]?.length) {
          this.data[hostname] = ips;
        }
        this.ttlData[hostname] = this.data[hostname]?.length ? now + this.ttl : now + this.failureTTL;
        this._save();
      })
      .catch(err => console.error('Error in DNS resolution in background:', err));
  
    // Prepare the fast result, removing duplicates
    let resultArray = Array.isArray(fastResult) ? fastResult : [fastResult];
    resultArray = [...new Set(resultArray)];
  
    if (resultArray.length || !this.data[hostname]) {
      this.data[hostname] = resultArray;
    }
    this.ttlData[hostname] = now + this.failureTTL;

    this.promises[hostname].resolve();
    delete this.promises[hostname];

    if (options.debug) {
      console.log('lookup', hostname, resultArray);
    }

    return this._format(hostname, options);
  } 

  // Private method that selects the preferred IPs according to the configuration
  _promotePreferableIpVersion(ips, family) {
    const pref = family || config.get('preferred-ip-version') || 4;
    const targetFamily = pref === 6 ? 6 : 4;
    const preferred = ips.filter(ip => this.family(ip) === targetFamily);
    return preferred.length ? preferred : ips;
  }

  _format(hostname, options) {
    if (this.data?.[hostname]?.length) {
      let ips = this._promotePreferableIpVersion(this.data[hostname], options.family);
      return options.all
        ? ips.map(ip => ({ address: ip, family: this.family(ip) }))
        : ips[0];
    }
    throw new Error(`Cannot resolve "${hostname}"`);
  }

  defer(hostname, ip) {
    if (this.data?.[hostname]?.length && this.data[hostname].includes(ip)) {
      this.data[hostname] = this.data[hostname].filter(ip => ip !== ip);
      this.data[hostname].push(ip);
      this._save();
    }
  }

  // Determines the family of an IP address (4 or 6)
  family(ip) {
    return ip.includes(':') ? 6 : 4;
  }

  // Loads the stored cache via storage
  async load() {
    const data = await storage.get(this.cacheKey);
    if (data) {
      this.data = data.data || {};
      this.ttlData = data.ttlData || {};
      for (const key in this.data) {
        if (!this.data[key].length) {
          delete this.data[key]
          delete this.ttlData[key]
          continue
        }
        if (this.promises?.[key] && this.data[key].length) {
          this.promises[key].resolve()
        }
      }
    }
  }

  save() {
    this.limiter.call()
  }

  // Saves the cache using storage
  _save() {
    storage.set(
      this.cacheKey,
      { data: this.data, ttlData: this.ttlData },
      { permanent: true, expiration: true }
    );
  }
}

// Creates an instance with the configured DNS servers
const lookup = new Lookup({
  google: ['8.8.4.4', '8.8.8.8'], // Google
  cloudflare: ['1.1.1.1', '1.0.0.1'], // Cloudflare
  quad9: ['9.9.9.9'], // Quad9
  dnsWatch: ['84.200.69.80', '84.200.70.40'], // DNS.Watch
  uncensoredDNS: ['91.239.100.100'] // UncensoredDNS
});

export default lookup;
