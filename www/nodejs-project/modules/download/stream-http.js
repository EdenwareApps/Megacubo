const http = require('http'), https = require('https'), url = require('url')
const {CookieJar} = require('tough-cookie')
const AbortController = require("abort-controller")
const KeepAliveAgent = require('agentkeepalive'), net = require('net')
const lookup = require('./lookup'), DownloadStreamBase = require('./stream-base')

const httpJar = new CookieJar()
const httpsJar = new CookieJar()

const kaAgentOpts = {
    rejectUnauthorized: false,
	keepAlive: true,
	freeSocketTimeout: 9000, // The default server-side timeout is 10000 milliseconds, to avoid ECONNRESET exceptions, we set the default value to 9000 milliseconds.
	maxSockets: 4,
	maxFreeSockets: 2,
	socketActiveTTL: 30
}

const HttpAgent = new http.Agent()
const HttpsAgent = new https.Agent({rejectUnauthorized: false})
const KHttpAgent = new KeepAliveAgent(kaAgentOpts)
const KHttpsAgent = new KeepAliveAgent.HttpsAgent(kaAgentOpts)

class DownloadStreamHttp extends DownloadStreamBase {
	constructor(opts){
		super(opts)
        this.type = 'http'
        this.ips = null
        this.failedIPs = []
        this.errors = []
        this.once('destroy', () => {
            this.responder && this.responder.end()
        })
	}
    async options(ip, family){
        const opts = {
            ip, family, 
            path: this.encodeURI(this.parsed.path),
            port: this.parsed.port || (this.parsed.protocol == 'http:' ? 80 : 443),
            realHost: this.parsed.hostname,
            host: ip,
            headers: this.opts.headers || {host: this.parsed.hostname, connection: 'close'},
            timeout: this.timeout.connect,
            protocol: this.parsed.protocol,
            decompress: false
        }
        const cookie = await this.getCookies()
        if(cookie){
            opts.headers.cookie = cookie
        }
        if(this.parsed.protocol == 'https:'){
            opts.rejectUnauthorized = false
            opts.insecureHTTPParser = true
        }
        if(opts.headers.connection == 'keep-alive'){
            opts.agent = this.parsed.protocol == 'http:' ? KHttpAgent : KHttpsAgent
        } else {
            opts.agent = this.parsed.protocol == 'http:' ? HttpAgent : HttpsAgent
        }        
		return opts
	}
    async resolve(host){
        if(this.ended || this.destroyed) throw 'Connection already ended (on resolve)'
        if(!Array.isArray(this.ips)) {
            if(net.isIPv4(host) || net.isIPv6(host)){
                this.ips = [{address: host, family: net.isIPv6(host) ? 6 : 4}]
            } else {
                const ips = await lookup.lookup(host, {all: true, family: 0})
                this.ips = ips
            }
        }
        return this.ips
    }
    skipWait(){
        if(this.delay){
            clearTimeout(this.delay.timer)
            this.delay.resolve()
            this.delay = null
        }
    }
    wait(ms){
        return new Promise(resolve => {
            this.delay = {
                timer: setTimeout(() => {
                    this.delay = null
                    resolve()
                }, ms),
                resolve
            }
        })
    }
    async start(){
        if(this.ended) {
            throw 'Connection already ended (on start) '+ (this.error || this.ended || this.destroyed)
        }
        if(this.destroyed) {
            throw 'Connection already destroyed (on start) '+ (this.error || this.ended || this.destroyed)
        }
        const start = global.time()
        this.parsed = url.parse(this.opts.url, false)
        this.jar = this.parsed.protocol == 'http:' ? httpJar : httpsJar
        await this.resolve(this.parsed.hostname)
        if(this.opts.connectDelay){
            const diffMs = (global.time() - start) * 1000
            if(diffMs < this.opts.connectDelay){
                await this.wait(this.opts.connectDelay - diffMs)
            }
        }
        for(let ip of this.ips){
            const options = await this.options(ip.address, ip.family)
            await this.get(options).catch(console.error)
            if(this.responder || this.ended) break
        }
        if(this.responder) {
            this.responder.end()
            this.end()
        } else {
            console.error('ERROR', this.opts.url, this.errors)
            const err = this.errors.map(s => String(s)).unique().join("\n") || 'Unknown error'
            console.error('ERROR', this.opts.url, err)
            this.emitError(err, true)
        }
    }
    /*
	get(options){
        return new Promise((resolve, reject) => {
            let timer, fine, req, res, resolved, closed
            const controller = new AbortController()  
            const close = force => {
                this.removeListener('destroy', close)
                this.responder && this.responder.end()
                if(closed && force !== true) return
                closed = true
                if(req) {
                    req.abort()
                    req.destroy()
                }
                if(res) {
                    force && controller.abort()
                    res.destroy()
                }
            }
            const fail = error => {
                clearTimer()
                this.errors.push(error)
                if(!resolved){
                    resolved = true
                    close(true)
                    if(options.realHost && options.ip){ // before resolving
                        lookup.defer(options.realHost, options.ip) // if it failed with a IP, try some other at next time
                    }
                    reject(error)
                }
                this.responder && this.responder.emitError(error)
            }
            const clearTimer = () => {
                timer && clearTimeout(timer)
            }
            let currentState = 'connect'
            const startTimer = state => {
                clearTimer()
                if(!state){
                    state = currentState
                }
                if(state != currentState){
                    currentState = state
                }
                timer = setTimeout(() => fail('Timeouted after '+ this.timeout.connect +'ms ('+ state +')'), this.timeout[state])
            }
            const finish = () => {
                clearTimer()
                if(!resolved){
                    this.finishTraceback = true
                    resolved = true
                    resolve(fine)
                }
                close()
            }
            this.once('destroy', () => close(true))
            options.signal = controller.signal
            req = (options.protocol == 'http:' ? http : https).request(options, response => {
                if(this.destroyed) return fail('destroyed')
                fine = true
                res = response
                this.responder = new DownloadStreamBase.Response(res.statusCode, res.headers)
                if(this.responder.headers['set-cookie']){
                    if (this.responder.headers['set-cookie'] instanceof Array) {
                        this.responder.headers['set-cookie'].map(c => this.setCookies(c).catch(console.error))
                    } else {
                        this.setCookies(this.responder.headers['set-cookie']).catch(console.error)
                    }
                    delete this.responder.headers['set-cookie']
                }
                res.once('error', fail)
                res.once('timeout', fail)
                //res.once('end', () => finish())
                res.once('close', () => finish())
                res.once('finish', () => finish())
                res.socket.once('end', () => finish())
                res.socket.once('close', () => finish())
                res.socket.once('finish', () => finish())
                res.on('data', chunk => {
                    if(this.ended || this.destroyed) {
                        console.error('RECEIVING DATA AFTER END ', this.ended, this.destroyed, this.errors)
                        close(true)
                    }
                    this.responder && this.responder.write(chunk)
                    startTimer('response')                  
                })
                this.once('destroy', () => (resolved || finish()))
                this.emit('response', this.responder)
                startTimer('response')
            }).on('error', fail)
            req.end()
            startTimer('connect')
        })
	}
    */
	async get(options){
        let timer, req, res, closed, currentState = 'connect'
        const controller = new AbortController()
        const via = options.protocol == 'http:' ? http : https
        const clearTimer = () => {
            timer && clearTimeout(timer)
        }
        return await new Promise((resolve, reject) => {
            const close = err => {
                clearTimer()
                if(closed) return
                closed = true
                if(err) {
                    this.errors.push(err)
                    if(options.realHost && options.ip){ // before resolving
                        lookup.defer(options.realHost, options.ip) // if it failed with a IP, try some other at next time
                    }
                    reject(err)
                } else {
                    resolve()
                }
                if(req) {
                    req.abort()
                    req.destroy()
                }
                if(res) {
                    res.destroy()
                }
            }
            const requested = response => {
                if(this.destroyed) return
                res = response
                this.responder = new DownloadStreamBase.Response(res.statusCode, res.headers)
                if(this.responder.headers['set-cookie']){
                    if (this.responder.headers['set-cookie'] instanceof Array) {
                        this.responder.headers['set-cookie'].map(c => this.setCookies(c).catch(console.error))
                    } else {
                        this.setCookies(this.responder.headers['set-cookie']).catch(console.error)
                    }
                    delete this.responder.headers['set-cookie']
                }
                res.once('error', e => close(e))
                res.once('timeout', e => close(e))
                //res.once('end', close)
                res.once('close', close)
                res.once('finish', close)
                res.socket.once('end', close)
                res.socket.once('close', close)
                res.socket.once('finish', close)
                res.on('data', chunk => {
                    if(this.ended || this.destroyed) {
                        console.error('RECEIVING DATA AFTER END ', this.ended, this.destroyed, this.errors)
                        return controller.abort()
                    }
                    this.responder.write(chunk)
                    startTimer('response')                  
                })
                this.emit('response', this.responder)
                startTimer('response')
            }
            const startTimer = state => {
                clearTimer()
                if(!state) state = currentState
                if(state != currentState) currentState = state
                timer = setTimeout(() => close('Timeouted after '+ this.timeout.connect +'ms ('+ state +')'), this.timeout[state])
            }
            this.once('destroy', close)
            options.signal = controller.signal            
            req = via.request(options, requested).on('error', close).on('abort', close)
            startTimer('connect')
            req.end()
        })
	}
    getCookies(){
        return new Promise((resolve, reject) => {
            (this.parsed.protocol == 'http:' ? httpJar : httpsJar).getCookies(this.opts.url, (err, cookies) => {
                if(err) return resolve('')
                resolve(cookies.join('; '))
            })
        })
    }
    setCookies(header){
        return new Promise((resolve, reject) => {
            (this.parsed.protocol == 'http:' ? httpJar : httpsJar).setCookie(header, this.opts.url, err => {
                if(err) return reject(err) 
                resolve(true)
            })
        })
    }
    encodeURI(url){
        if(!url.match(new RegExp('^[A-Za-z0-9-._~:/?%#\\[\\]@!$&\'()*+,;=]+$'))) {
            return url.replace(new RegExp('[^A-Za-z0-9-._~:/?%#\\[\\]@!$&\'()*+,;=]+', 'g'), txt => encodeURIComponent(txt))
        }
        return url
    }
}

DownloadStreamHttp.lookup = lookup
DownloadStreamHttp.keepAliveAgents = {KHttpAgent, KHttpsAgent}
module.exports = DownloadStreamHttp
