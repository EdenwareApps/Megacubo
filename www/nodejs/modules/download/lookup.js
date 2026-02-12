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
    // OPTIMIZATION: Increased save interval from 10s to 60s to reduce storage write frequency
    // This prevents lock timeouts on 'global/lookup' key
    this.limiter = new Limiter(() => this._save(), 60000);

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
   * Otherwise, returns on first valid result (or waits for second at most) and caches immediately.
   * All DNS resolvers continue testing in background to consolidate and update cache with mature result.
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
  
    // Fast response: return on first valid result, or wait for second at maximum
    // All tasks continue in background for consolidation (not cancelled)
    let fastResult = [];
    let validResultCount = 0;
    let completedCount = 0;
    let failureCount = 0;
    const maxWaitForResults = 2; // Wait for up to 2 valid results before returning
    const minFailuresForQuickReturn = 3; // Return immediately if this many resolvers fail quickly without success
    const quickFailureThreshold = 500; // Consider failures within this time as "quick failures"
    
    const fastResultPromise = new Promise((resolveFast) => {
      const collectedResults = [];
      let resolved = false;
      const startTime = Date.now();
      const quickFailures = []; // Track failures that happened quickly
      
      tasks.forEach((task) => {
        task
          .then(result => {
            completedCount++;
            if (result && Array.isArray(result) && result.length > 0) {
              validResultCount++;
              collectedResults.push(...result);
              
              // Return immediately on first valid result
              if (!resolved && validResultCount === 1) {
                resolved = true;
                fastResult = [...new Set(collectedResults)];
                // Cache immediately with fast result
                if (fastResult.length || !this.data?.[hostname]) {
                  this.data[hostname] = fastResult;
                }
                this.ttlData[hostname] = fastResult.length ? now + this.ttl : now + this.failureTTL;
                resolveFast(fastResult);
              }
              // Or return after second valid result (at most)
              else if (!resolved && validResultCount === maxWaitForResults) {
                resolved = true;
                fastResult = [...new Set(collectedResults)];
                if (fastResult.length || !this.data[hostname]) {
                  this.data[hostname] = fastResult;
                }
                this.ttlData[hostname] = fastResult.length ? now + this.ttl : now + this.failureTTL;
                resolveFast(fastResult);
              }
            }
            
            // If all tasks completed and no valid result, return empty
            if (!resolved && completedCount === tasks.length && validResultCount === 0) {
              resolved = true;
              resolveFast([]);
            }
          })
          .catch(() => {
            completedCount++;
            failureCount++;
            const elapsed = Date.now() - startTime;
            
            // Track quick failures (failures that happen quickly)
            if (elapsed < quickFailureThreshold) {
              quickFailures.push(elapsed);
            }
            
            // If multiple resolvers failed quickly without any success, return immediately
            if (!resolved && quickFailures.length >= minFailuresForQuickReturn && validResultCount === 0) {
              resolved = true;
              resolveFast([]);
            }
            
            // If all tasks failed and we have no result, resolve with empty
            if (!resolved && completedCount === tasks.length && validResultCount === 0) {
              resolved = true;
              resolveFast([]);
            }
          });
      });
      
      // Shorter timeout for failures: if no success after 1 second and multiple failures, return
      setTimeout(() => {
        if (!resolved && validResultCount === 0 && failureCount >= minFailuresForQuickReturn) {
          resolved = true;
          resolveFast([]);
        }
      }, 1000); // Quick timeout for failures
      
      // Safety timeout: return after reasonable time even if we don't have 2 results
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          if (collectedResults.length > 0) {
            fastResult = [...new Set(collectedResults)];
            if (fastResult.length || !this.data[hostname]) {
              this.data[hostname] = fastResult;
            }
            this.ttlData[hostname] = fastResult.length ? now + this.ttl : now + this.failureTTL;
            resolveFast(fastResult);
          } else {
            resolveFast([]);
          }
        }
      }, 2000); // Reduced from 3s to 2s for faster failure detection
    });
    
    // Wait for fast result (first valid or second at most)
    await fastResultPromise;
  
    // In background: continue collecting all responses and update cache with consolidated result
    // This doesn't block the return, runs in parallel
    Promise.allSettled(tasks)
      .then(results => {
        if (options.debug) {
          console.log('lookup* background consolidation', hostname, results);
        }
        const fulfilledValues = results
          .filter(r => r.status === 'fulfilled')
          .flatMap(r => r.value);
        
        if (fulfilledValues.length > 0) {
          // Consolidate: count IP occurrences across all resolvers
          const counts = fulfilledValues.reduce((acc, ip) => {
            acc[ip] = (acc[ip] || 0) + 1;
            return acc;
          }, {});
          
          // Sort by frequency (most common IPs first)
          const consolidatedIps = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .map(([ip]) => ip);
          
          // Update cache with consolidated result (overwrites fast result)
          this.data[hostname] = consolidatedIps;
          this.ttlData[hostname] = now + this.ttl;
          // OPTIMIZATION: Use save() instead of _save() to respect limiter and reduce write frequency
          this.save();
          
          if (options.debug) {
            console.log('lookup* consolidated result', hostname, consolidatedIps);
          }
        } else {
          // All resolvers failed - mark as failure in cache
          if (!this.data[hostname]?.length) {
            this.data[hostname] = [];
            this.ttlData[hostname] = now + this.failureTTL;
            // OPTIMIZATION: Use save() instead of _save() to respect limiter and reduce write frequency
            this.save();
          }
        }
      })
      .catch(err => console.error('Error in DNS resolution in background:', err));
  
    // Prepare the fast result for return, removing duplicates
    let resultArray = Array.isArray(fastResult) ? fastResult : [fastResult];
    resultArray = [...new Set(resultArray)];

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
      // OPTIMIZATION: Use save() instead of _save() to respect limiter and reduce write frequency
      this.save();
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
