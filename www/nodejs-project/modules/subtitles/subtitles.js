const Events = require('events')

class Subtitles extends Events {
    constructor() {
        super()
        const OpenSubtitles = require('opensubtitles.com')
        this.opts = {
            addr: '127.0.0.1',
            ua: 'Megacubo v17.2.9'
        }
        this.os = new OpenSubtitles({apikey: 'Jl8VNRL9aZQO0jPM2aaGG1NFD4SoHwR4'})
        this.os._settings.headers['User-Agent'] = this.opts.ua
    }
    ready() {
        return new Promise((resolve, reject) => {
            if(this.loaded) return resolve()
            if(this.loading) {
                return this.once('ready', () => {
                    if(this.token) {
                        resolve()
                    } else {
                        reject('Could not get Opensubtitles token.')
                    }
                })
            }
            this.loading = true
            this.load().then(token => {
                this.loaded = true
                resolve()
            }).catch(reject).finally(() => {
                this.loading = false
                this.emit('ready')
            })
        })
    } 
    async load() {
        await Promise.allSettled([
            this.autoLogin(),
            this.listen()
        ])
    }
    async autoLogin() {
        let err
        const username = global.config.get('os-username')
        const password = global.config.get('os-password')        
        await this.login(username, password).catch(e => err = e)
        if(err) {
            await this.askCredentials()
        }
    }
    async login(username, password) {
        this.token = await this.os.login({username, password})
    }
    async askCredentials(defaultUsername='', defaultPassword=''){
        let extraOpts = []
        extraOpts.push({template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'})
        extraOpts.push({template: 'option', text: global.lang.REGISTER, id: 'register', fa: 'fas fa-plus'})
        let username = await global.explorer.prompt({
            question: global.lang.OPENSUBTITLES_REGISTER.format(global.lang.REGISTER),
            fa: 'fas fa-user',
            text: 'text',
            message: 'message',
            defaultValue: defaultUsername,
            placeholder: global.lang.USERNAME
        })
        if(!user) throw 'No username provided'
        const password = await global.explorer.prompt({
            question: global.lang.PASSWORD,
            placeholder: global.lang.PASSWORD,
            fa: 'fas fa-key',
            isPassword: true,
            defaultValue: defaultPassword
        })
        if(!pass) throw 'No pass provided'
        let err
        await this.login(username, password).catch(e => err = e)
        if(err) {
            global.displayErr(err)
            return await this.askCredentials(username, password)
        }
        global.config.set('os-username', username)
        global.config.set('os-password', password)
        return true
    }
	srt2vtt(srt) {
		return "WEBVTT\n\n"+ srt.replace(new RegExp(':([0-9]{2}),', 'g'), ':$1.').trim()
	}
    listen() {
        return new Promise((resolve, reject) => {
            if(this.server) return resolve()
            const http = require('http'), { URL } = require('url')
            this.server = http.createServer((req, response) => {
                const parsedUrl = new URL(req.url, 'http://' + req.headers.host)
                const resHeaders = {
                    'Connection': 'close',
                    'Cache-Control': 'max-age=0, no-cache, no-store'
                }
                global.prepareCORS(response, req)
                const file_id = parsedUrl.searchParams.get('id')
                const fail = err => {
                    response.writeHead(500, resHeaders)
                    response.write(String(err))
                    response.end()
                }
                if(file_id) {
                    const dl = async() => {
                        let err
                        const cacheKey = 'os-sub-'+ file_id
                        const cached = await global.storage.get(cacheKey).catch(console.error)
                        if(cached && typeof(cached) == 'string') return cached
                        const ret = await this.os.download({file_id}).catch(e => err = e)
                        if(err) return fail(err)
                        const body = await global.Download.get({
                            url: ret.link,
                            responseType: 'text',
                            headers: {
                                'Accept': '*/*',
                                'User-Agent': this.opts.ua
                            }
                        }).catch(e => err = e)
                        if(err) return fail(err)
                        body = this.srt2vtt(body)
                        await global.storage.set(cacheKey, body, {ttl: 24 * 3600})
                        resHeaders['Content-Type'] = 'text/vtt'
                        response.writeHead(200, resHeaders)
                        response.write(body)
                        response.end()
                    }
                    return dl().catch(console.error)
                }
                fail('No ID specified')
            })
            this.server.listen(0, this.opts.addr, err => {
                console.log('Subtitles server started', err)
                if(err) return reject(err)
                this.opts.port = this.server.address().port
                this.host = 'http://' + this.opts.addr + ':' + this.opts.port
                resolve()
            })
        })
    }
    language() {
        let langCode
        const matched = global.lang.languageHint.match(new RegExp(global.lang.locale +'\-[A-Z]{2}'))
        if(matched && matched.length) {
            langCode = matched[0]
        } else {
            langCode = global.lang.locale +'-'+ global.lang.countryCode
        }
        return langCode.toLowerCase() +','+ global.lang.locale
    }
    async search(query) {
        const cacheKey = 'os-search-'+ query
        const cached = await global.storage.get(cacheKey).catch(console.error)
        if(Array.isArray(cached)) return cached
        await this.ready()
        let results = await this.os.subtitles({
            languages: this.language(),
            query
        })
        const ret = results.data.map(r => {
            if(!r.attributes.files.length) return
            const ret = {}
            ret.id = r.attributes.files[0].file_id
            ret.name = r.attributes.release
            ret.language = r.attributes.language
            ret.url = this.host +'/?id='+ ret.id
            return ret
        }).filter(r => r)
        await global.storage.set(cacheKey, ret, {ttl: 24 * 3600})
        return ret
    } 
}

module.exports = Subtitles
