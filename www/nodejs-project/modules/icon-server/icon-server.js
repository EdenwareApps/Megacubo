const fs = require('fs'), pathm = require('path'), http = require('http')
const crypto = require('crypto'), Icon = require('./icon'), createReader = require('../reader')
const pLimit = require('p-limit'), closed = require('../on-closed')

class IconDefault {
    constructor(){}
    prepareDefaultName(terms){
        if(!Array.isArray(terms)){
            terms = global.lists.terms(terms)
        }
        return global.sanitize(terms.filter(s => s.length && s.charAt(0) != '-').join('-'))
    }
    getDefault(terms){
        return new Promise((resolve, reject) => {
            if(!terms || !terms.length){
                return resolve(false)
            }
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + pathm.sep + name
            fs.stat(file, (err, stat) => {
                if(stat && stat.size){
                    fs.readFile(file, {encoding: null}, (err, content) => {
                        if(err && !content){
                            console.error(err)
                            resolve(false)
                        } else {
                            resolve(content)
                        }
                    })
                } else { 
                    resolve(false)
                }
            })
        })
    }
    getDefaultFile(terms){
        return new Promise((resolve, reject) => {
            if(!terms || !terms.length) {
                return resolve(false)
            }
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + pathm.sep + name
            fs.stat(file, (err, stat) => {
                if(stat && stat.size >= 32) {
                    resolve(file)
                } else { 
                    resolve(false)
                }
            })
        })
    }
    saveDefault(terms, data, cb){
        const updating = !global.lists.loaded() || !global.lists.activeLists.length // we may find a better logo after
        if(!updating && terms && terms.length){
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + pathm.sep + name
            if(this.opts.debug){
                console.log('saveDefault', terms, name, file)
            }
            fs.writeFile(file, data, 'binary', () => {
                if(cb){
                    cb(file)
                }
            })
        } else {
            if(cb){
                cb(false)
            }        
        }
    }
    saveDefaultFile(terms, sourceFile, cb){
        if(!global.lists.loaded() || !global.lists.activeLists.length){ // we may find a better logo later
            if(cb) cb()
            return
        }
        if(terms && terms.length){
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + pathm.sep + name
            if(this.opts.debug){
                console.log('saveDefaultFile', terms, name, sourceFile, file)
            }
            fs.copyFile(sourceFile, file, () => {
                if(cb){
                    cb()
                }
            })
        }
    }
    async adjust(file, options) {
        return await this.limiter.adjust(async () => {
            return await this.doAdjust(file, options)
        })
    }
    async doAdjust(file, options){
        let opts = {
            autocrop: global.config.get('autocrop-logos')
        }
        if(options){
            Object.assign(opts, options)
        }
        return await global.jimp.transform(file, opts)
    }
}

class IconSearch extends IconDefault {
    constructor(){
        super()
        this.watchingIcons = {}
        global.watching.on('watching', () => this.updateWatchingIcons())
    }
    seemsLive(e){
        return (e.gid || global.lists.mi.isLive(e.url)) ? 1 : 0 // gid here serves as a hint of a live stream
    }
    updateWatchingIcons(){
        const watchingIcons = {}
        global.watching.currentRawEntries.forEach(e => {
            if(e.icon){
                if(typeof(watchingIcons[e.icon]) == 'undefined'){
                    watchingIcons[e.icon] = 0
                }
                watchingIcons[e.icon] += parseInt(e.count)
            }
        })
        this.watchingIcons = watchingIcons
    }
    search(ntms, liveOnly){
        if(this.opts.debug){
            console.log('icons.search', ntms, global.traceback())
        }
        return new Promise((resolve, reject) => {
            if(this.opts.debug){
                console.log('is channel', ntms)
            }
            let images = []
            const next = () => {
                global.lists.search(ntms, {
                    type: 'live',
                    safe: !global.lists.parentalControl.lazyAuth()
                }).then(ret => {
                    if(this.opts.debug){
                        console.log('fetch from terms', ntms, liveOnly, JSON.stringify(ret))
                    }
                    if(ret.results.length){
                        const already = {}, alreadySources = {}
                        ret = ret.results.filter(e => {
                            return e.icon && e.icon.indexOf('//') != -1
                        })
                        if(this.opts.debug){
                            console.log('fetch from terms', JSON.stringify(ret))
                        }
                        ret = ret.map((e, i) => {
                            if(typeof(already[e.icon]) == 'undefined'){
                                already[e.icon] = i
                                alreadySources[e.icon] = [e.source]
                                return {
                                    icon: e.icon, 
                                    live: this.seemsLive(e) ? 1 : 0,
                                    hits: 1,
                                    watching: this.watchingIcons[e.icon] || 0,
                                    epg: 0
                                }
                            } else {
                                if(!alreadySources[e.icon].includes(e.source)){
                                    alreadySources[e.icon].push(e.source)
                                    ret[already[e.icon]].hits++
                                }
                                if(!ret[already[e.icon]].live && this.seemsLive(e)){
                                    ret[already[e.icon]].live = true
                                }
                            }
                        }).filter(e => !!e)
                        ret = ret.sortByProp('hits', true).sortByProp('live', true) // gid here serves as a hint of a live stream
                        if(this.opts.debug){
                            console.log('search() result', ret)
                        }
                        images.push(...ret)
                    }
                }).catch(console.error).finally(() => resolve(images))
            }
            if(global.channels.loadedEPG){
                global.lists.epgSearchChannelIcon(ntms).then(srcs => images = srcs.map(src => {
                    return {icon: src, live: true, hits: 1, watching: 1, epg: 1}
                })).catch(console.error).finally(next)
            } else {
                next()
            }
        })
    }
}

class IconServerStore extends IconSearch {
    constructor(){
        super()
        this.ttlHTTPCache = 24 * 3600
        this.ttlBadHTTPCache = 1800
    }
    key(url){
        return crypto.createHash('md5').update(url).digest('hex')
    }
    isHashKey(key){
        return key.length == 32 && key.indexOf(',') == -1
    }
    file(url, isKey){
        return this.opts.folder + '/logo-' + (isKey === true ? url : this.key(url)) + '.cache'
    }
    validate(content){
        if (content && content.length > 25) {
            const jsign = content.readUInt16BE(0)
            if(jsign === 0xFFD8) {
                return 1 // is JPEG
            } else {
                const gsign = content.toString('ascii', 0, 3)
                if(gsign === 'GIF') {
                    return 0 // no GIF please, too problematic
                }
            }
            const magic = content.toString('hex', 0, 4)
            if (magic === '89504e47') {
                const chunkType = content.toString('ascii', 12, 16)
                if (chunkType === 'IHDR') {
                    const colorType = content.readUInt8(25)
                    const hasAlpha = (colorType & 0x04) !== 0
                    if (hasAlpha) {
                        return 2 // valid, has alpha
                    }
                }
                return 1
            } else {
                console.error('BAD MAGIC', magic, content)
            }
        }
    }
    validateFile(file){
        return new Promise((resolve, reject) => {
            fs.access(file, err => {
                if(err) return reject(err)
                fs.open(file, 'r', (err, fd) => {
                    if(err) return reject(err)
                    const readSize = 32
                    fs.read(fd, Buffer.alloc(readSize), 0, readSize, 0, (err, bytesRead, content) => {
                        if(err) return reject(err)
                        let v = this.validate(content)
                        if(v) {
                            resolve(v)
                        } else {
                            reject('file not validated')
                        }
                    })
                })
            })
        })
    }
    resolveHTTPCache(key){
        return global.storage.rawTemp.resolve('icons-cache-'+ key)
    }
    checkHTTPCache(key){
        return new Promise((resolve, reject) => {
            global.storage.rawTemp.has('icons-cache-' + key, has => {
                if(has !== false){
                    resolve(this.resolveHTTPCache(key))
                } else {
                    reject('no http cache')
                }
            })
        })
    }
    getHTTPCache(key){
        return new Promise((resolve, reject) => {
            global.storage.rawTemp.get('icons-cache-'+ key, data => {
                if(data){
                    resolve({data})
                } else {
                    reject('no cache*')
                }
            }, null)
        })
    }
    saveHTTPCache(key, data, cb){
        const time = data && data.length ? this.ttlHTTPCache : this.ttlBadHTTPCache
        global.storage.rawTemp.set('icons-cache-' + key, data, time, cb || (() => {}))
    }
    async saveHTTPCacheExpiration(key, size){
        let stat
        const file = global.storage.rawTemp.resolve('icons-cache-' + key)
        if(typeof(size) != 'number') {
            let err
            stat = await fs.promises.stat(file).catch(e => err = e)
            err || (size = stat.size)
        }
        let time = this.ttlBadHTTPCache
        if(stat && stat.size){
            time = this.ttlHTTPCache
        }
        global.storage.rawTemp.setExpiration('icons-cache-'+ key, time, () => {})
    }
    async fetchURL(url){
        const suffix = 'data:image/png;base64,'
        if(String(url).startsWith(suffix)) {
            const key = this.key(url)
            const file = this.resolveHTTPCache(key)
            await fs.promises.writeFile(file, Buffer.from(url.replace(suffix, ''), 'base64'))
            const ret = await this.validateFile(file)
            return {key, file, isAlpha: ret == 2}
        }
        if(typeof(url) != 'string' || url.indexOf('//') == -1){
            throw 'bad url '+ global.crashlog.stringify(url)
        }
        const key = this.key(url)
        if(this.opts.debug){
            console.warn('WILLFETCH', url)
        }
        let err
        const cfile = await this.checkHTTPCache(key).catch(e => err = e)
        if(!err) { // has cache
            if(this.opts.debug){
                console.log('fetchURL', url, 'cached')
            }
            const ret = await this.validateFile(cfile).catch(e => err = e)
            if(!err) {
                return {key, file: cfile, isAlpha: ret == 2}
            }
        }
        if(this.opts.debug){
            console.log('fetchURL', url, 'request', err)
        }
        const file = this.resolveHTTPCache(key)
        err = null
        await this.limiter.download(async () => {
            await global.Download.file({
                url,
                downloadLimit: this.opts.downloadLimit,
                retries: 3,
                headers: {
                    'content-encoding': 'identity'
                },
                file
            }).catch(e => err = e)
        })
        if(err){
            await fs.promises.unlink(file).catch(console.error)
            throw err
        }
        await this.saveHTTPCacheExpiration(key)
        const ret2 = await this.validateFile(file)
        const atts = {key, file, isAlpha: ret2 == 2}
        if(this.opts.debug){
            console.log('fetchURL', url, 'validated')
        }
        return Object.assign({}, atts)
    }
}

class IconServer extends IconServerStore {
    constructor(opts){    
        super()
        this.opts = {
            addr: '127.0.0.1',
            port: 0, // let the http.server sort
            downloadLimit: 0.5 * (1024 * 1024), // 1mb
            folder: './cache',
            debug: false
        }
		if(opts){
			Object.keys(opts).forEach((k) => {
				this.opts[k] = opts[k]
			})
		}
        this.opts.folder = pathm.resolve(this.opts.folder)
		fs.access(this.opts.folder, err => {
			if(err !== null) {
				fs.mkdir(this.opts.folder, () => {})
			}
		})
        this.closed = false
        this.server = false
        this.limiter = {
            download: pLimit(20),
            adjust: pLimit(1)
        }
        this.rendering = {}
        this.renderingPath = null
        this.listen()
    }
    get(e) {        
        const icon = new Icon(e, this)
        const promise = icon.get()
        promise.icon = icon
        promise.entry = e
        promise.destroy = () => icon.destroy()
        return promise
    }
    result(e, path, tabindex, ret){
        if(!this.destroyed){
            if(this.opts.debug){
                console.log('icon', e.name, JSON.stringify(ret), path, tabindex, e)
            }
            global.ui.emit('icon', {
                url: ret.url, 
                path, 
                tabindex, 
                name: e.name, 
                force: ret.force, 
                alpha: ret.alpha
            })
        }
    }
    listsLoaded(){
        return global.lists.loaded() && global.lists.activeLists.length
    }
    debug(...args){
        global.osd.show(Array.from(args).map(s => String(s)).join(', '), 'fas fa-info-circle', 'active-downloads', 'persistent')
    }
    qualifyEntry(e){
        if(!e || (e.class && e.class.indexOf('no-icon') != -1)){
            return false
        }
        if(e.icon || e.programme){
            return true
        }
        const t = e.type || 'stream'
        if(t == 'stream' || ['entry-meta-stream', 'entry-icon'].some(c => {
            return e.class && e.class.indexOf(c) != -1
        })){
            return true
        }
        if(t == 'action' && e.fa == 'fas fa-play-circle'){
            return true
        }
    }
    addRenderTolerance(range, limit){
        let vx = global.config.get('view-size-x')
        range.start = Math.max(range.start - vx, 0)
        range.end = Math.min(range.end + vx, limit)
        return range
    }
    render(entries, path, parentEntry){
        if(!global.config.get('show-logos')){
            return
        }
        let vs = global.config.get('view-size-x') * global.config.get('view-size-y'), range = {
            start: 0, 
            end: vs
        }
        range = this.addRenderTolerance(range, entries.length)
        this.renderRange(range, path)
        if(parentEntry && typeof(parentEntry) != 'string'){
            this.rendering[-1] = this.get(parentEntry) // do not use then directly to avoid losing destroy method
            this.rendering[-1].icon.on('result', ret => {
                this.result(parentEntry, path, -1, ret)
            })
            this.rendering[-1].catch(console.error)
        }
    }
    renderRange(range, path){
        if(!global.config.get('show-logos')){
            return
        }
        if(path == global.explorer.path && Array.isArray(global.explorer.pages[path])){
            range = this.addRenderTolerance(range, global.explorer.pages[path].length)
            if(path != this.renderingPath){
                Object.keys(this.rendering).forEach(i => {
                    if(i != -1 && this.rendering[i]){
                        this.rendering[i].destroy()
                        delete this.rendering[i]
                    }
                })
                this.renderingPath = path
                global.explorer.pages[path].slice(range.start, range.end).map((e, i) => {
                    if(this.qualifyEntry(e)){
                        this.rendering[range.start + i] = this.get(e) // do not use then directly to avoid losing destroy method
                        this.rendering[range.start + i].icon.on('result', ret => {
                            let _path = pathm.dirname(e.path)
                            if(_path == '.') _path = ''
                            this.result(e, _path, range.start + i, ret)
                        })
                        this.rendering[range.start + i].catch(console.error)
                    } else {
                        this.rendering[range.start + i] = null
                    }
                })
            } else {
                Object.keys(this.rendering).forEach(i => {
                    if(i != -1 && this.rendering[i] && (i < range.start || i > range.end)){
                        this.rendering[i].destroy()
                        delete this.rendering[i]
                    }
                })
                global.explorer.pages[path].slice(range.start, range.end).map((e, i) => {
                    if((!this.rendering[range.start + i] || this.rendering[range.start + i].entry.name != e.name) && this.qualifyEntry(e)){
                        this.rendering[range.start + i] = this.get(e) // do not use then directly to avoid losing destroy method
                        this.rendering[range.start + i].icon.on('result', ret => {
                            this.result(e, path, range.start + i, ret)
                        })
                        this.rendering[range.start + i].catch(console.error)
                    }
                })
            }
        }
    }
    listen(){
        if(!this.server){
            if(this.server){
                this.server.close()
            }
            this.server = http.createServer((req, response) => {
                if(this.opts.debug){
                    console.log('req starting...', req)
                }
                if(req.method == 'OPTIONS' || this.closed){
                    response.writeHead(200, {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET',
                        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                        'Content-Length': 0,
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    })
                    response.end()
                    return
                }
                let key = req.url.split('/').pop(), send = file => {
                    if(file){
                        if(this.opts.debug){
                            console.log('get() resolved', file)
                        }
                        response.writeHead(200, {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET',
                            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                            'Connection': 'close',
                            'Cache-Control': 'max-age=0, no-cache, no-store',
                            'Content-Type': 'image/png'
                        })
                        let stream = createReader(file)
                        closed(req, response, () => {
                            if(stream){
                                stream.destroy()
                                stream = null
                            }
                            response.end()
                        })
                        stream.pipe(response)
                    } else {
                        if(this.opts.debug){
                            console.log('BADDATA', file)
                        }
                        console.error('icons.get() not validated', req.url, file)
                        response.writeHead(404, {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET',
                            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                            'Connection': 'close',
                            'Cache-Control': 'max-age=0, no-cache, no-store'
                        })
                        response.end()
                    }
                }
                if(this.opts.debug){
					console.log('serving', req.url, key)
                }
                const onerr = err => {
                    console.error('icons.get() catch', err, req.url, global.traceback())
                    if(this.opts.debug){
                        console.log('get() catch', err, req.url, global.traceback())
                    }
                    response.writeHead(404, {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'GET',
                        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                        'Connection': 'close',
                        'Cache-Control': 'max-age=0, no-cache, no-store'
                    })
                    response.end(err +' - '+ req.url.split('#')[0])
                }
                if(this.isHashKey(key)){
                    this.checkHTTPCache(key).then(send).catch(onerr)
                } else {
                    this.getDefaultFile(global.decodeURIComponentSafe(key).split(',')).then(send).catch(onerr)
                }                
            }).listen(this.opts.port, this.opts.addr, err => {
				if (err) {
					console.error('unable to listen on port', err)
					return
				}
                this.opts.port = this.server.address().port
                this.url = 'http://'+ this.opts.addr +':'+ this.opts.port +'/'
			})
        }
    }
    refresh(){
        Object.values(this.rendering).forEach(r => r && r.destroy())
        this.rendering = {}
        this.render(explorer.pages[explorer.path], explorer.path)
    }
    destroy(){
        if(this.opts.debug){
            console.log('closing...')
        }
        this.closed = true
        if(this.server){
            this.server.close()
            this.server = null
        }
        this.removeAllListeners()
    }
}

module.exports = IconServer
