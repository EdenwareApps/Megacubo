const fs = require('fs'), path = require('path'), http = require('http')
const crypto = require('crypto'), Icon = require('./icon'), closed = require('../on-closed')

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
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + path.sep + name
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
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + path.sep + name
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
        const updating = global.lists.manager.updatingLists || !global.activeLists.length // we may find a better logo after
        if(!updating && terms && terms.length){
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + path.sep + name
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
        if(global.lists.manager.updatingLists || !global.activeLists.length){ // we may find a better logo later
            if(cb) cb()
            return
        }
        if(terms && terms.length){
            let name = this.prepareDefaultName(terms) + '.png', file = this.opts.folder + path.sep + name
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
    adjust(file, options){
        return new Promise((resolve, reject) => {
            let opts = {
                autocrop: global.config.get('autocrop-logos')
            }
            if(options){
                Object.assign(opts, options)
            }
            global.jimp.transform(file, opts).then(resolve).catch(reject)
        })
    }
}

class IconSearch extends IconDefault {
    constructor(){
        super()
        this.watchingIcons = {}
        global.watching.on('watching', () => this.updateWatchingIcons())
    }
    seemsLive(e){
        return (e.gid || global.lists.msi.isLive(e.url)) ? 1 : 0 // gid here serves as a hint of a live stream
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
                        images = images.concat(ret)
                    }
                }).catch(console.error).finally(() => resolve(images))
            }
            if(global.channels.activeEPG){
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
        if(content && content.length > 25){
            let magic = content.toString('hex', 0, 4)
            if([
                    'ffd8ffe0', // jpeg
                    'ffd8ffe8', // jpeg spif
                    'ffd8ffe1', // jpeg exif
                    'ffd8ffed', // adobe jpeg, photoshop cmyk buffer
                    'ffd8ffee', // adobe jpeg 
                    'ffd8ffe2', // canon jpeg
                    'ffd8ffe3', // samsung jpeg, e.g. samsung d500
                    'ffd8ffdb', // samsung jpeg, e.g. samsung d807
                    '47494638'  // gif
                ].includes(magic)){
                return 1 // valid, no alpha
            } else if(magic == '89504e47') {
                const uint8arr = new Uint8Array(content.byteLength)
                content.copy(uint8arr, 0, 0, content.byteLength)
                const view = new DataView(uint8arr.buffer)
                if([4, 6].includes(view.getUint8(8 + 8 + 9))){
                    return 2 // valid, has alpha
                } else {
                    return 1
                }
            } else {
                console.log('BAD MAGIC', magic, content)
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
                        if(v){
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
    saveHTTPCacheExpiration(key, cb){
        fs.stat(global.storage.rawTemp.resolve('icons-cache-' + key), (err, stat) => {
            if(stat){
                let time = this.ttlBadHTTPCache
                if(stat.size){
                    time = this.ttlHTTPCache
                }
                global.storage.rawTemp.setExpiration('icons-cache-' + key, time, cb)
            } else {
                cb()
            }
        })
    }
}

class IconFetchSem extends IconServerStore {
    constructor(opts){    
        super()
        this.fetching = {}
    }
    isFetching(url){
        return typeof(this.fetching[url]) != 'undefined'
    }
    setFetching(url){
        if(!this.isFetching(url)){
            this.fetching[url] = []
        }
    }
    waitFetching(url, resolve, reject){
        this.fetching[url].push({resolve, reject})
    }
    releaseFetching(url, ret){
        const cbs = this.fetching[url].map(r => r.resolve)
        delete this.fetching[url]
        cbs.forEach(cb => cb(ret))
    }
    releaseFetchingErr(url, ret){
        const cbs = this.fetching[url].map(r => r.reject)
        delete this.fetching[url]
        cbs.forEach(cb => cb(ret))
    }
    fetchURL(url){  
        return new Promise((resolve, reject) => { 
            if(String(url).startsWith('data:image/png;base64,')) {
                const key = this.key(url)
                const file = this.resolveHTTPCache(key)
                return fs.writeFile(file, global.base64.decode(url), err => {
                    if(err){
                        return reject(err)
                    }
                    this.validateFile(file).then(ret => {
                        resolve({key, file, isAlpha: ret == 2})
                    }).catch(reject)
                })
            }
            if(typeof(url) != 'string' || url.indexOf('//') == -1){
                return reject('bad url')
            }
            if(this.isFetching(url)){
                return this.waitFetching(url, resolve, reject)
            }
            const key = this.key(url)
            if(this.opts.debug){
                console.warn('WILLFETCH', url)
            }
            this.setFetching(url)
            this.checkHTTPCache(key).then(file => {
                if(this.opts.debug){
					console.log('fetchURL', url, 'cached')
                }
                this.validateFile(file).then(ret => {
                    let atts = {key, file, isAlpha: ret == 2}
                    this.releaseFetching(url, atts)
                    resolve(Object.assign({}, atts))
                }).catch(err => {
                    this.releaseFetchingErr(url, err)
                    reject(err)
                })
            }).catch(err => {
                if(this.opts.debug){
					console.log('fetchURL', url, 'request', err)
                }
                this.schedule('download', done => {
                    const file = this.resolveHTTPCache(key)
                    global.Download.file({
                        url,
                        downloadLimit: this.opts.downloadLimit,
                        retries: 3,
                        headers: {
                            'content-encoding': 'identity'
                        },
                        file
                    }).then(ret => {
                        this.saveHTTPCacheExpiration(key, () => {
                            this.validateFile(file).then(ret => {
                                const atts = {key, file, isAlpha: ret == 2}
                                if(this.opts.debug){
                                    console.log('fetchURL', url, 'validated')
                                }
                                resolve(Object.assign({}, atts))
                                this.releaseFetching(url, atts)
                            }).catch(err => {
                                if(this.opts.debug){
                                    console.log('fetchURL', url, 'NOT validated')
                                }
                                reject(err)
                                this.releaseFetchingErr(url, err)
                            }).finally(done)
                        })
                    }).catch(err => {
                        err = 'Failed to read URL (2): '+ url +' '+ err
                        if(this.opts.debug){
                            console.log('fetchURL', err)
                        }
                        reject(err)
                        this.releaseFetchingErr(url, err)
                        done()
                    })
                })
            })
        })
    }
}

class IconServer extends IconFetchSem {
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
        this.opts.folder = path.resolve(this.opts.folder)
		fs.access(this.opts.folder, err => {
			if(err !== null) {
				fs.mkdir(this.opts.folder, () => {})
			}
		})
        this.closed = false
        this.server = false
        this.schedulingLimits = {download: 6, adjust: 1}
        this.activeSchedules = {}
        this.schedules = {}
        this.rendering = {}
        this.renderingPath = null
        this.listen()
    }
    listsLoaded(){
        return !global.lists.manager.updatingLists && global.activeLists.length
    }
    debug(...args){
        global.osd.show(Array.from(args).map(s => String(s)).join(', '), 'fas fa-info-circle', 'active-downloads', 'persistent')
    }
    schedule(id, cb){
        if(typeof(this.activeSchedules[id]) == 'undefined'){
            this.activeSchedules[id] = 0
            this.schedules[id] = []
        }
        if(this.activeSchedules[id] >= this.schedulingLimits[id]){
            this.schedules[id].push(cb)
            //this.debug('activeSchedules', 'scheduled')
        } else {
            this.activeSchedules[id]++
            //this.debug('activeSchedules', Object.keys(this.activeSchedules).map(d => { return d +'='+ this.activeSchedules[d] }).join(','))
            let finished
            cb(() => {
                if(!finished){
                    finished = true
                    process.nextTick(this.scheduleFinished.bind(this, id)) // stacking breaker
                }
            })
        }
    }
    scheduleFinished(id){
        this.activeSchedules[id]--
        //this.debug('activeSchedules', Object.keys(this.activeSchedules).map(d => { return d +'='+ this.activeSchedules[d] }).join(','))
        this.goNextSchedule(id)
    }
    goNextSchedule(id){
        if(this.activeSchedules[id] < this.schedulingLimits[id] && this.schedules[id].length){
            const cb = this.schedules[id].shift()
            this.activeSchedules[id]++
            //console.log('activeSchedules unschedule', this.activeSchedules[id])
            let finished
            cb(() => {
                if(!finished){
                    finished = true
                    this.scheduleFinished(id)
                }
            })
        }
    }
    absolutize(path, url){
        let uri = new URL(path, url)
        return uri.href
    }
    qualifyEntry(e){
        if(!e || (e.class && e.class.indexOf('no-icon') != -1)){
            return false
        }
        if(e.icon || e.program){
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
            this.rendering[-1] = new Icon(parentEntry, parentEntry.path, -1, this)
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
                        this.rendering[range.start + i] = new Icon(e, path, range.start + i, this)
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
                        this.rendering[range.start + i] = new Icon(e, path, range.start + i, this)
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
                        let stream = fs.createReadStream(file)
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
