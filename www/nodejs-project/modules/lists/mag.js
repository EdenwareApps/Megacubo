const Events = require('events')

class Mag extends Events {
    constructor(addr, debug) { // addr = http://mac@server
        super()
        if(debug === true) this.debugInfo = []

        let parts = addr.split('#')
        let authAddr = parts[0]
        this.flags = parts.length > 1 ? parts[1] : ''
        
        this.method = 'POST'
        this.url = addr
        this.mac = authAddr.split('@')[0].split('/').pop()
        this.addr = authAddr.replace(this.mac +'@', '')    
        if(this.addr.endsWith('/')) {
            this.addr = this.addr.substr(0, this.addr.length - 1)
        }
        this.headers = {
            'user-agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 4 rev: 1812 Mobile Safari/533.3',
            'cookie': 'mac='+ encodeURIComponent(this.mac) +'; stb_lang=en; timezone=Europe%2FAmsterdam',
			'accept' : '*/*',
			'x-user-agent' : 'Model: MAG254; Link: Ethernet'
        }

        this.fakeHost = 'http://mag.null/'
        this.progress = 0
        this.genres = {}
        this.meta = {}
        this.foundStreams = 0
    }
    emitProgress(p) {
        p = parseInt(p)
        if(p != this.progress) {
            this.progress = p
            this.emit('progress', p)
        }
    }
    async execute(atts, progress, endpoint='/portal.php', retries=2) {
        let err
        let path = endpoint
        const options = {
            timeout: 15,
            responseType: 'json',
            keepalive: true,
        	maxAuthErrors: 0,
			maxAbortErrors: 1,
			redirectionLimit: 1,
            headers: this.headers,
            progress
        }
        path += (path.indexOf('?') == -1) ? '?' : '&'
        path += Object.keys(atts).map(k => k +'='+ atts[k]).join('&')
        if(this.method != 'GET') {
            options.post = Object.keys(atts).map(k => k +'='+ atts[k]).join('&')
        }
        options.url = this.addr + path
        const data = await global.Download.get(options).catch(e => err = e)
        this.debugInfo && this.debugInfo.push({url: options.url, data, err})
        if(err) {
            if(retries) {
                retries--
                if(String(err).toLowerCase().indexOf('method not allowed') != -1) {
                    this.method = this.method == 'GET' ? 'POST' : 'GET'
                    return await this.execute(atts, progress, endpoint, retries)
                }
                if(String(err).indexOf('end of JSON input') != -1) {
                    return await this.execute(atts, progress, endpoint, retries)
                }
            }
            throw err
        }
        return data.js || data
    }    
    async getVODStreams(progress) {
        if(!this.genres.vod) {
            const genres = await this.execute({
                action: 'get_categories',
                type: 'vod',
                JsHttpRequest: '1-xml'
            })
            this.genres.vod = {}
            for(const genre of genres) {
                this.genres.vod[genre.id] = genre.title
            }
        }
        let i = 0
        const genreIds = Object.keys(this.genres.vod)
        for(const genre of genreIds) {
            i++
            const streams = await this.execute({
                type: 'vod',
                action: 'get_ordered_list',
                genre,
                force_ch_link_check: '',
                fav: '0',
                sortby: 'number',
                hd: '0',
                p: '1',
                JsHttpRequest: '1-xml'
            })
            this.emitEntries(streams.data, 'vod')
            progress && progress(parseInt(i * (100 / genreIds.length)))
        }
    }    
    async getLiveStreams(progress) {
        if(!this.genres.live) {
            const genres = await this.execute({
                type: 'itv',
                action: 'get_genres',
                p: 1,
                JsHttpRequest: '1-xml'
            })
            this.genres.live = {}
            for(const genre of genres) {
                this.genres.live[genre.id] = genre.title
            }
        }
        const channels = await this.execute({
            type: 'itv',
            action: 'get_all_channels',
            JsHttpRequest: '1-xml'
        }, progress)
        this.emitEntries(channels.data, 'live')
    }
    async prepare() {
        if(this.headers.authorization) return
        const firstToken  = (await this.execute({action: 'handshake', type: 'stb', token: ''})).token
        this.headers.authorization = 'Bearer '+ firstToken
        try {
            const secondToken = (await this.execute({action: 'handshake', type: 'stb', token: ''})).token
            if(secondToken) headers.authorization = 'Bearer '+ secondToken
        } catch(e) {}
        this.meta.epg = this.url
        this.emit('meta', this.meta)
    }
    async link(cmd) {
        if(cmd.startsWith(this.fakeHost)) {
            cmd = cmd.substr(this.fakeHost.length)
        }
        let err, type = cmd.split('#mag-').pop()
        if(type == 'live') type = 'itv'
        cmd = cmd.split('#')[0]
        const payload = {
            type,
            action: 'create_link', cmd: encodeURIComponent(cmd),
            forced_storage: 'undefined', disable_ad: 0,
            download: '0', JsHttpRequest: '1-xml'
        }
        const data = await this.execute(payload).catch(e => err = e)
        if(err) {
            if(cmd.startsWith('http')) {
                return cmd
            }
            throw err
        }
        if(data && data.cmd) {
            const ncmd = data.cmd.split(' ').pop()
            if(!cmd.startsWith('http') || ncmd.length > cmd) {
                return ncmd
            }
        }
        return cmd
    }
    async run() {
        const firstStepWeight = 2
        const rp = (100 - firstStepWeight) / 2
        this.emit('progress', 1)
        await this.prepare()
        this.emit('progress', firstStepWeight)
        await this.getLiveStreams(p => {
            this.emitProgress((rp / 100) * p)
        })
        await this.getVODStreams(p => {
            this.emitProgress(rp + ((rp / 100) * p))
        })
    }
    emitEntries(streams, type) {
        if(Array.isArray(streams)) {
            const category = type == 'live' ? global.lang.LIVE : global.lang.CATEGORY_MOVIES_SERIES
            for(const stream of streams) {
                let cmd = stream.cmd.split(' ').pop()
                if(!cmd.startsWith('http')) {
                    cmd = this.fakeHost + cmd
                }
                const entry = {
                    name: stream.name,
                    group: category +'/'+ this.genres[type][stream.tv_genre_id || stream.category_id || stream.genre_id],
                    icon: stream.screenshot_uri || stream.logo || '',
                    url: cmd +'#mag-'+ type
                }
                if(stream.censored) {
                    entry.name = '[XXX] '+ entry.name
                }
                this.emit('entry', entry)
                this.foundStreams++
            }
        }
    }
    destroy(){        
        this.emit('finish')
    }
}

class MagEPG extends Events {
    constructor(url) {
        super()
        this.url = url
        this.map = {}
        process.nextTick(() => {
            this.start().catch(err => this.emitError(err)).finally(() => this.emit('end'))
        })
    }
    async start() {
        this.mag = new Mag(this.url)
        await this.mag.prepare()
        await this.getChannels()
        await this.getProgrammes()
    }
    async getChannels() {
        const channels = await this.mag.execute({type: 'itv', action: 'get_all_channels', JsHttpRequest: '1-xml'})
        channels.data.forEach(ch => {
            this.map[ch.id] = ch.name
            this.emit('channel', {
                name: ch.name,
                id: ch.name, // do not passthrough 'id'
                icon: ch.logo
            })
        })
    }
    async getProgrammes() {
        const programmes = await this.mag.execute({type: 'itv', action: 'get_epg_info', period: 6, JsHttpRequest: '1-xml'})
        Object.keys(programmes.data).forEach(id => {
            if(!this.map[id]) return
            programmes.data[id].forEach(prog => {
                this.emit('programme', {
                    channel: this.map[id],
                    title: [prog.name],
                    start: prog.start_timestamp,
                    end: prog.stop_timestamp,
                    icon: '',
                    category: prog.category
                })
            })
        })
    }
    emitError(err) {
        this.listenerCount('error') && this.emit('error', err)
    }
    destroy() {
        this.map = {}
        this.removeAllListeners()
    }
}

Mag.EPG = MagEPG
module.exports = Mag
