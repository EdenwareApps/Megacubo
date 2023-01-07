const Events = require('events'), http = require('http'), https = require('https'), url = require('url')
const {CookieJar} = require('tough-cookie')
const KeepAliveAgent = require('agentkeepalive'), net = require('net')
const lookup = require('./lookup'), DownloadStreamBase = require('./stream-base')

const httpJar = new CookieJar()
const httpsJar = new CookieJar()

const kaAgentOpts = {
    rejectUnauthorized: false,
	keepAlive: true,
	freeSocketTimeout: 4000, // The default server-side timeout is 5000 milliseconds, to avoid ECONNRESET exceptions, we set the default value to 4000 milliseconds.
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
            this.response && this.response.destroy()
        })
	}
    async options(ip, family){
        const opts = {
            path: this.parsed.path,
            port: this.parsed.port || (this.parsed.protocol == 'http:' ? 80 : 443)
        }
        opts.path = this.encodeURI(opts.path)
        opts.realHost = this.parsed.hostname
        opts.host = ip
        opts.ip = ip
        opts.family = family
		opts.headers = this.opts.headers || {host: this.parsed.hostname, connection: 'close'}
        const cookie = await this.getCookies()
        if(cookie){
            opts.headers.cookie = cookie
        }
		opts.timeout = this.timeout.connect
        opts.protocol = this.parsed.protocol
        opts.decompress = false
        if(this.parsed.protocol == 'https:'){
            opts.rejectUnauthorized = false
        }
        if(opts.headers.connection == 'keep-alive'){
            opts.agent = this.parsed.protocol == 'http:' ? KHttpAgent : KHttpsAgent
        } else {
            opts.agent = this.parsed.protocol == 'http:' ? HttpAgent : HttpsAgent
        }        
		return opts
	}
    resolve(host){
        return new Promise((resolve, reject) => {
            if(this.ended || this.destroyed) {
                return reject('Connection already ended')
            }
            if(Array.isArray(this.ips)) {
                return resolve(this.ips)
            }
            if(net.isIPv4(host) || net.isIPv6(host)){
                this.ips = [
                    {address: host, family: net.isIPv6(host) ? 6 : 4}
                ]
                return resolve(this.ips)
            } else {
                lookup.lookup(host, {all: true, family: -1}, (err, ips) => {
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
    skipWait(){
        if(this.delay){
            clearTimeout(this.delay.timer)
            this.delay.resolve()
            this.delay = null
        }
    }
    async wait(ms){
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
        const start = global.time()
        let fine
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
            fine = await this.get(options).catch(console.error)
            if(fine === true) {
                break
            }
        }
        if(fine){
            this.end()
        } else {
            this.emitError(this.errors.map(s => String(s)).join("\n"), true)
        }
    }
	get(options){
        return new Promise(resolve => {
            let timer, fine, req, resolved
            const close = () => {
                this.removeListener('destroy', close)
                this.response && this.response.end()
                req && req.destroy()
                this.response = req = null
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
                if(this.response){
                    this.response.emitError(error)
                }
                close()
            }
            const clearTimer = () => {
                if(timer){
                    clearTimeout(timer)
                }
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
                timer = setTimeout(() => {
                    fail('Timeouted')
                    close()
                }, this.timeout[state])
            }
            const finish = () => {
                clearTimer()
                if(!resolved){
                    this.finishTraceback = global.traceback()
                    resolved = true
                    resolve(fine)
                    close()
                }
            }
            this.once('destroy', close)
            req = (options.protocol == 'http:' ? http : https).request(options, res => {
                if(this.destroyed){
                    fail('destroyed')
                    return close()
                }
                fine = true
                this.response = new DownloadStreamBase.Response(res.statusCode, res.headers)
                if(this.response.headers['set-cookie']){
                    if (this.response.headers['set-cookie'] instanceof Array) {
                        this.response.headers['set-cookie'].map(c => this.setCookies(c).catch(console.error))
                    } else {
                        this.setCookies(this.response.headers['set-cookie']).catch(console.error)
                    }
                    delete this.response.headers['set-cookie']
                }
                res.on('error', fail)
                res.on('timeout', fail)
                res.once('end', () => finish())
                res.on('close', () => finish())
                res.on('finish', () => finish())
                res.socket.once('end', () => finish())
                res.socket.on('close', () => finish())
                res.socket.on('finish', () => finish())
                this.emit('response', this.response)
                res.on('data', chunk => {
                    if(this.ended || this.destroyed){
                        console.error('RECEIVING DATA AFTER END')
                    }
                    this.response && this.response.write(chunk)
                    startTimer('response')                  
                })
                startTimer('response')
            }).on('error', fail)
            req.end()
            startTimer('connect')
        })
	}
    async getCookies(){
        return new Promise((resolve, reject) => {
            (this.parsed.protocol == 'http:' ? httpJar : httpsJar).getCookies(this.opts.url, (err, cookies) => {
                if(err){
                    resolve('')
                }
                resolve(cookies.join('; '))
            })
        })
    }
    async setCookies(header){
        return new Promise((resolve, reject) => {
            (this.parsed.protocol == 'http:' ? httpJar : httpsJar).setCookie(header, this.opts.url, err => {
                if(err){
                    return reject(err)
                }
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

DownloadStreamHttp.keepAliveAgents = {KHttpAgent, KHttpsAgent}
module.exports = DownloadStreamHttp
