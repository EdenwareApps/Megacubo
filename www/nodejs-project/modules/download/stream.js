const Events = require('events'), http = require('http'), https = require('https'), url = require('url')
const {CookieJar} = require('tough-cookie'), {createCookieAgent} = require('http-cookie-agent'), jar = new CookieJar()
const KeepAliveAgent = require('agentkeepalive'), net = require('net')
const lookup = require('./lookup')

const CkHttpAgent = createCookieAgent(http.Agent)
const CkHttpsAgent = createCookieAgent(https.Agent)
const CkHttpKAAgent = createCookieAgent(KeepAliveAgent)
const CkHttpsKAAgent = createCookieAgent(KeepAliveAgent.HttpsAgent)

const kaAgentOpts = {
    rejectUnauthorized: false,
	keepAlive: true,
	freeSocketTimeout: 4000, // The default server-side timeout is 5000 milliseconds, to avoid ECONNRESET exceptions, we set the default value to 4000 milliseconds.
	maxSockets: 4,
	maxFreeSockets: 2,
	socketActiveTTL: 30,
    cookies: {jar},
    jar
}

const HttpAgent = new CkHttpAgent({cookies: {jar}, jar})
const HttpsAgent = new CkHttpsAgent({cookies: {jar}, jar, rejectUnauthorized: false})
const KHttpAgent = new CkHttpKAAgent(kaAgentOpts)
const KHttpsAgent = new CkHttpsKAAgent.HttpsAgent(kaAgentOpts)

class DownloadStream extends Events {
	constructor(opts){
		super()
		this.opts = opts
        this.ips = null
        this.failedIPs = []
        this.errors = []
        this.timeout = opts.timeout && opts.timeout.response ? opts.timeout.response : 30000
		process.nextTick(() => {
            this.start().catch(err => this.emitError(err))
        })
	}
    options(ip, family){
        const opts = {
            path: encodeURI(this.parsed.path),
            port: this.parsed.port || (this.parsed.protocol == 'http:' ? 80 : 443)
        }
        opts.realHost = this.parsed.hostname
        opts.host = ip
        opts.ip = ip
        opts.family = family
		opts.headers = this.opts.headers || {host: this.parsed.hostname, connection: 'close'}
		opts.timeout = this.timeout
        opts.protocol = this.parsed.protocol
        opts.decompress = false
        if(this.parsed.protocol == 'https:'){
            opts.rejectUnauthorized = false
        }
        if(opts.headers && opts.headers.connection == 'keep-alive'){
            opts.agent = this.parsed.protocol == 'http:' ? KHttpAgent : KHttpsAgent
        } else {
            opts.agent = this.parsed.protocol == 'http:' ? HttpAgent : HttpsAgent
        }
		return opts
	}
    resolve(host){
        return new Promise((resolve, reject) => {
            if(Array.isArray(this.ips)) {
                return resolve(this.ips)
            }
            if(net.isIPv4(host) || net.isIPv6(host)){
                this.ips = [
                    {address: host, family: net.isIPv6(host) ? 6 : 4}
                ]
                return resolve(this.ips)
            } else {
                lookup.lookup(host, {all: true, family: 0}, (err, ips) => {
                    if(err){
                        reject(err)
                    } else {
                        this.ips = ips
                        resolve(ips)
                    }
                })
            }
        })
    }
    async start(){
        let fine
        this.parsed = url.parse(this.opts.url, false)
        await this.resolve(this.parsed.hostname)
        for(let ip of this.ips){
            const options = this.options(ip.address, ip.family)
            fine = await this.get(options)
            if(fine) break
        }
        if(fine){
            this.end()
        } else {
            this.emitError(this.errors.map(s => String(s)).join("\n"))
        }
    }
	get(options){
        return new Promise(resolve => {
            let timer, fine, req, response, resolved
            const close = () => {
                response && response.req && response.req.destroy()
                response && response.destroy()
                req && req.destroy()
                response = req = null
            }
            const fail = error => {
                clearTimer()
                this.errors.push(error)
                if(!resolved){
                    resolved = true
                    if(options.realHost && options.ip){ // before resolving
                        lookup.defer(options.realHost, options.ip) // if it failed with a IP, try some other at next time
                    }
                    resolve(fine)
                }
                close()
            }
            const clearTimer = () => {
                if(timer){
                    clearTimeout(timer)
                }
            }
            const startTimer = () => {
                clearTimer()
                timer = setTimeout(() => {
                    fail('Timeouted')
                    close()
                }, this.timeout)
            }
            const finish = () => {
                clearTimer()
                if(!resolved){
                    resolved = true
                    resolve(fine)
                    close()
                }
            }
            this.on('destroy', close)
            req = (options.protocol == 'http:' ? http : https).request(options, res => {
                if(this.destroyed){
                    fail('destroyed')
                    return close()
                }
                fine = true
                response = res
                this.emit('response', response)
                res.on('data', chunk => {
                    this.emit('data', chunk)
                    startTimer()                  
                })
                res.on('error', fail)
                res.on('end', () => finish())
                res.on('close', () => finish())
                res.on('finish', () => finish())
                res.socket.on('end', () => finish())
                res.socket.on('close', () => finish())
                res.socket.on('finish', () => finish())
                startTimer()
            }).on('error', fail)
            req.end()
            startTimer()
        })
	}
	emitError(error){
		if(this.listenerCount('error')){
			this.emit('error', error)
		}
		this.end()
	}
    end(){
        if(!this.ended){
            this.ended = true
            this.emit('end')
        }
        this.destroy()
    }
	destroy(){
        if(!this.ended){
            this.end()
        }
        if(this.destroyed){
		    this.destroyed = true
        }
        this.emit('destroy')
	}
}

DownloadStream.keepAliveAgents = {KHttpAgent, KHttpsAgent}
module.exports = DownloadStream
