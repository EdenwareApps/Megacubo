const path = require('path'), fs = require('fs'), http = require('http'), async = require('async'), os = require('os'), decodeEntities = require('decode-entities'), crypto = require('crypto');

class IconTerms {
    constructor(){
        this.opts = {
            addr: '127.0.0.1',
            port: 0, // let the http.server sort
            downloadLimit: 4 * (1024 * 1024), // 4Mb
            folder: './cache',
            debug: false
        }
        this.termsKey = 'trms' // should be regexp safe
    }
    terms(url, asArray){
        let terms = url.match(new RegExp(';'+ this.termsKey + ',([^&]+)&?'))
        if(terms && terms.length > 1 && terms[1].length > 2){
            terms = global.lists.terms(decodeURIComponent(terms[1]), true)
            if(terms.length){
                return asArray ? terms : terms.join(' ')
            }
        }
        return asArray ? [] : ''
    }
    addTerms(url, terms){
        if(terms){
            if(Array.isArray(terms)){
                terms = terms.join(' ')
            }
            if(typeof(terms) == 'string'){
                if(terms.indexOf(' ') != -1){
                    terms = encodeURIComponent(terms)
                }
                if(url.indexOf(this.termsKey + ',') == -1){
                    url += ';'+ this.termsKey + ',' + terms
                }
            } else {
                console.error('bad terms', terms, typeof(terms))
            }
        }
        return url
    }
    stripTerms(url){
        url = url.replace(new RegExp(';'+ this.termsKey + ',([^&]+)&?'), '')
        if(['?', '&'].indexOf(url.charAt(url.length - 1)) != -1){
            url = url.substr(0, url.length - 1)
        }
        return url
    }
}

class IconCache extends IconTerms {
    constructor(opts){
        super()
    }
    validate(content){
        return new Promise((resolve, reject) => {
            if(content && content.length >= 128){
                resolve(content)
            } else {
                console.error('bad image content', content)
                reject('Bad image content')
            }
        })
    }
    prepareCacheName(terms){
        if(!Array.isArray(terms)){
            terms = global.lists.terms(terms)
        }
        return terms.filter(s => s.length && s.charAt(0) != '-').join('-')
    }
    getCache(terms){
        return new Promise((resolve, reject) => {
            if(!terms || !terms.length){
                return resolve(false)
            }
            let name = this.prepareCacheName(terms) + '.png', file = this.opts.folder + path.sep + name
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
    saveCache(terms, content, cb){
        if(global.lists.manager.updatingLists || !global.activeLists.length){ // we may find a better logo after
            return
        }
        if(terms && terms.length){
            let name = this.prepareCacheName(terms) + '.png', file = this.opts.folder + path.sep + name
            if(this.opts.debug){
                console.log('saveCache', terms, content, name, file)
            }
            fs.writeFile(file, content, 'binary', cb || (() => {}))
        }
    }
    getHTTPCache(url){
        return new Promise((resolve, reject) => {
            if(url.indexOf('127.0.0.1') != -1){
                return reject('no cache')
            }
            global.rstorage.get('icons-http-' + url, data => {
                if(data){
                    resolve(data)
                } else {
                    reject('no cache')
                }
            }, null)
        })
    }
    saveHTTPCache(url, content, cb){
        if(url.indexOf('127.0.0.1') == -1){
            let time = content && content.length ? 24 * 3600 : 1800
            global.rstorage.set('icons-http-' + url, content, time, cb || (() => {}))
        }
    }
}

class IconSearch extends IconCache {
    constructor(opts){
        super(opts)
    }
    name(terms){
        return new Promise((resolve, reject) => {
            let tms = typeof(terms) == 'string' ? global.lists.terms(terms) : terms, ch = global.channels.isChannel(tms)
            if(ch){
                resolve(ch.terms)
            } else {
                reject('not a channel')
            }
        })
    }
    sortImages(srcs){
        let c = {}
        srcs.forEach(src => {
            if(typeof(c[src]) == 'undefined'){
                c[src] = 0
            }
            c[src]++
        });
        return [...new Set(srcs)].sort((a, b) => (c[a] < c[b]) ? 1 : ((c[b] < c[a]) ? -1 : 0))
    }
    search(ntms, liveOnly){
        if(this.opts.debug){
            console.log('icons.search', ntms, global.traceback())
        }
        return new Promise((resolve, reject) => {
            if(this.opts.debug){
                console.log('is channel', ntms)
            }
            global.lists.search(ntms, {
                type: liveOnly ? 'live' : null,
                group: !liveOnly,
                typeStrict: true
            }).then(ret => {
                if(this.opts.debug){
                    console.log('fetch from terms', ntms, liveOnly, JSON.stringify(ret))
                }
                if(ret.results.length){
                    ret = ret.results.filter(e => {
                        return e.icon && e.icon.indexOf('//') != -1
                    }).sortByProp('score', true).sortByProp('gid', true) // gid here serves as a hint of a live stream
                    if(this.opts.debug){
                        console.log('fetch from terms', JSON.stringify(ret))
                    }
                    ret = ret.map(e => e.icon)
                    ret = this.sortImages(ret)
                    if(this.opts.debug){
                        console.log('search() result', ret)
                    }
                    resolve(ret)   
                } else {
                    resolve([])
                }
            })
        })
    }
}

class IconTransform extends IconSearch {
    constructor(opts){
        super(opts)
    }
    transform(data){
        return new Promise((resolve, reject) => {
            global.jimp.transform(data, {
                autocrop: global.config.get('autocrop-logos')
            }).then(resolve).catch(reject)
        })
    }
}

class IconFetcher extends IconTransform {
    constructor(opts){
        super(opts)
		if(opts){
			Object.keys(opts).forEach((k) => {
				this.opts[k] = opts[k]
			})
        }
        this.opts.folder = path.resolve(this.opts.folder)
		fs.stat(this.opts.folder, (err, stat) => {
			if(err !== null) {
				fs.mkdir(this.opts.folder, () => {})
			}
		})
    }
    fetchURLCallback(content, url){
        return new Promise((resolve, reject) => { 
            if(!content || !content.length){
                return reject('Image not found or empty')
            }
            this.validate(content).then(body => {
                this.transform(body).then(resolve).catch(err => {
                    reject('Invalid image data* ' + String(err))
                })
            }).catch(err => {
                reject('Invalid image data ' + String(err))
            })
        })
    }
    fetchURL(url, rcb){  
        return new Promise((resolve, reject) => { 
            if(this.opts.debug){
                console.warn('WILLFETCH', url, typeof(url))
            }
            if(url.indexOf('//') == -1){
                return reject('bad url')
            }
            url = this.stripTerms(url)
            if(this.opts.debug){
                console.warn('WILLFETCH', url)
            }
            this.getHTTPCache(url).then(content => {
                if(this.opts.debug){
					console.log('fetchURL', url, 'cached')
                }
                this.fetchURLCallback(content, url).then(resolve).catch(reject)
            }).catch(err => {
                if(this.opts.debug){
					console.log('fetchURL', url, 'request')
                }
                let req = global.Download.promise({
                    url,
                    responseType: 'buffer',
                    resolveBodyOnly: true,
                    downloadLimit: this.opts.downloadLimit,
                    retries: 2
                })
                if(typeof(rcb) == 'function'){
                    rcb(req)
                }
                req.then(content => {
                    this.saveHTTPCache(url, content)
                    if(!content){
                        console.error('Failed to read URL', err, url)
                        reject('Failed to read URL (1): ' + url)
                    } else {
                        this.fetchURLCallback(content, url).then(resolve).catch(reject)
                    }
                }).catch(err => {
                    if(String(err).indexOf('Promise was cancelled') == -1){
                        this.saveHTTPCache(url, '')
                        console.error('Failed to read URL', err, req, url)
                        reject('Failed to read URL (2): ' + url)
                    }
                }).finally(() => {
                    req = null
                })
            })
        })
    }
    fetch(terms, url){
        return new Promise((resolve, reject) => {
            if(url && url.indexOf('//') == -1){
                url = ''
            }
            if(terms && terms.length){
                if(this.queue(terms, resolve, reject)){
                    this.search(terms, true).then(srcs => {
                        let done, maybe, requests = [], images = []
                        if(url){
                            images.push(url)
                        }
                        images = [...new Set(images.concat(srcs))]
                        if(this.opts.debug){
                            console.log('GOFETCH', images)
                        }
                        async.eachOfLimit(images, 8, (src, i, acb) => {
                            if(done || src.indexOf('/blank.png') != -1){
                                if(this.opts.debug){
                                    console.log('GOFETCH', src, 'SKIP', done)
                                }
                                return acb()
                            }
                            this.fetchURL(src, req => {
                                requests.push(req)
                            }).then(ret => {
                                if(this.opts.debug){
                                    console.log('GOFETCH', src, 'THEN')
                                }
                                if(ret.alpha){
                                    done = ret.data
                                } else if(!maybe || ret.data.length > maybe.length){
                                    maybe = ret.data
                                }
                            }).catch(err => {
                                if(this.opts.debug){
                                    console.log('GOFETCH', src, 'CATCH', err)
                                }
                                console.error(err)
                            }).finally(acb)
                        }, () => {
                            if(maybe && !done){
                                done = maybe
                            }
                            if(this.opts.debug){
                                console.log('GOFETCH', images, 'OK', done)
                            }
                            if(done){
                                this.unqueue(terms, 'resolve', done)
                                requests.forEach(r => {
                                    if(r.cancel) r.cancel() 
                                })
                                requests = null
                            } else {
                                this.unqueue(terms, 'reject', 'Couldn\'t find a logo for: ' + JSON.stringify(terms) + '  ' + JSON.stringify(images))
                            }
                        })
                    }).catch(err => {
                        console.error(err)
                        if(url && url.indexOf('/blank.png') == -1){
                            this.fetchURL(url).then(ret => {
                                this.unqueue(terms, 'resolve', ret.data)
                            }).catch(err => {
                                this.unqueue(terms, 'reject', err)
                            })
                        } else {
                            this.unqueue(terms, 'reject', err)
                            reject(err)
                        }
                    })
                }
            } else {
                if(url){
                    this.fetchURL(url).then(ret => resolve(ret.data)).catch(reject)
                } else {
                    reject('no terms, no url')
                }
            }
        })
    }
    get(url){
        return new Promise((resolve, reject) => {
            let isCH, terms = this.terms(url, true)
            this.name(terms).then(ntms => {
                isCH = true
                terms = ntms
            }).catch(console.error).finally(() => {
                if(isCH){
                    this.getCache(terms).then(content => {
                        if(this.opts.debug){
                            console.log('get > getCache', url, terms, content)
                        }
                        if(content){
                            if(content == 'no-icon'){
                                reject('No icon setting')
                            } else {
                                resolve(content)
                            }
                        } else {
                            if(global.config.get('search-missing-logos')){
                                this.fetch(terms, this.stripTerms(url)).then(content => {
                                    if(this.opts.debug){
                                        console.log('get > fetch', terms, content)
                                    }
                                    this.saveCache(terms, content)
                                    resolve(content)
                                }).catch(err => {
                                    console.error(err)
                                    reject(err)
                                })
                            } else {
                                this.fetchURL(url).then(ret => resolve(ret.data)).catch(reject)
                            }
                        }
                    }).catch(console.error)
                } else {
                    this.fetchURL(url).then(ret => resolve(ret.data)).catch(reject)
                }
            })
        })
    }
    prefetch(termsArr){ // warm up cache
        if(this.opts.debug){
            console.log('prefetch > terms', termsArr)
        }
        async.eachOfLimit(termsArr, global.config.get('view-size-x'), terms => {
            this.name(terms).then(ntms => {
                terms = ntms
            }).catch(err => {
                console.error(err, terms)
            }).finally(() => {
                this.getCache(terms).then(content => {
                    if(content){
                        if(this.opts.debug){
                            console.log('prefetch > already cached', terms, content)
                        }
                    } else {
                        this.fetch(terms).then(content => {
                            if(this.opts.debug){
                                console.log('prefetch > fetch', terms, content)
                            }
                            this.saveCache(terms, content)
                        }).catch(err => {
                            console.error(err)
                        })
                    }
                })
            })
        }, () => {})
    }
    domain(u){
        if(u && u.indexOf('//')!=-1){
            var domain = u.split('//')[1].split('/')[0];
            if(domain == 'localhost' || domain.indexOf('.') != -1){
                return domain.split(':')[0]
            }
        }
        return ''
    }
    ext(url){
        return String(url).split('?')[0].split('#')[0].split('.').pop().toLowerCase()   
    }
    key(url){
        return crypto.createHash('md5').update(url).digest('hex')
    }
    file(url){
        return this.opts.folder + '/logo-' + this.key(url) + '.cache'
    }
}

class IconFetchQueue extends IconFetcher {
    constructor(opts){    
        super(opts)
        this.callbacks = {}
    }
    queue(name, resolve, reject){
        // console.log('name', JSON.stringify(name))
        let ret, k = name.join('-')
        if(typeof(this.callbacks[k]) == 'undefined'){
            this.callbacks[k] = []
            ret = true
        }
        this.callbacks[k].push({resolve, reject})
        return ret
    }
    unqueue(name, type, body){
        let ret, k = name.join('-')
        if(typeof(this.callbacks[k]) != 'undefined'){
            this.callbacks[k].forEach(r => {
                r[type](body)
            })
            delete this.callbacks[k]
        }        
    }
}

class IconServer extends IconFetchQueue {
    constructor(opts){    
        super(opts)
        this.closed = false
        this.server = false
		if(opts){
			Object.keys(opts).forEach((k) => {
				this.opts[k] = opts[k]
			})
		}
        this.listen()
    }
    isSupported(url){
        return url && url.indexOf('//') != -1 && url.indexOf('//127.0.0.1/') == -1 && url.indexOf('//127.0.0.1:') == -1
    }
    generate(terms, url){
        if(typeof(url) != 'string' || url.indexOf('//') == -1){
            if(terms){
                url = this.blank
            } else {
                url = false
            }
        } else {
            url = this.proxify(url)
        }
        return url ? this.addTerms(url, terms) : ''
    }
    proxify(url){
        if(typeof(url)=='string' && url.indexOf('//') != -1){
            if(!this.opts.port){
                return url // srv not ready
            }
            url = this.unproxify(url)
            url = url.replace(new RegExp('^(http://|//)', 'i'), 'http://'+this.opts.addr+':'+this.opts.port+'/').replace(new RegExp('^https://', 'i'), 'http://'+this.opts.addr+':'+this.opts.port+'/s/')
        }
        return url
    }
    unproxify(url){
        if(typeof(url)=='string'){
            if(url.substr(0, 3) == '/s/'){
                url = 'https://' + url.substr(3)
            } else if(url.charAt(0) == '/' && url.charAt(1) != '/'){
                url = 'http://' + url.substr(1)
            } else if(url.indexOf('//') != -1){
                var addrp = this.opts.addr.split('.').slice(0, 3).join('.')
                if(url.indexOf(addrp) != -1){
                    url = url.replace(new RegExp('^(http://|//)'+addrp.replaceAll('.', '\\.')+'\\.[0-9]{0,3}:('+ this.opts.port +')/', 'g'), '$1').replace('://s/', 's://')
                }  
            }                      
            if(url.indexOf('&') != -1 && url.indexOf(';') != -1){
                url = decodeEntities(url)
            }
        }
        return url
    }
    absolutize(path, url){
        let uri = new URL(path, url)
        return uri.href
    }
    prepareEntries(entries){
        return entries.map(this.prepareEntry.bind(this))
    }
    prepareEntry(e){
        if(!e.class || e.class.indexOf('no-icon') == -1){
            if(!e.servedIcon || e.servedIcon.indexOf(':'+ this.opts.port +'/') == -1){
                if(e.logo && !e.icon){
                    e.icon = e.logo // TMP
                    delete e.logo
                }
                e.servedIcon = this.iconFromEntry(e)
            }
        }
        return e
    }
    iconFromEntry(e){
        let ret = ''
        if(e.type && !['group', 'stream', 'action'].includes(e.type)){
            return ret
        }
        let ch = (e.url && global.mega.isMega(e.url)) ? global.channels.isChannel(e.terms ? e.terms.name : global.lists.terms(e.name)) : false
        if(e.icon && e.icon.indexOf('//') != -1){
            ret = this.proxify(e.icon)
            if(ch){
                ret = this.addTerms(ret, ch.terms)
            }
        } else if(ch) {
            ret = this.generate(ch ? ch.terms : false, e.icon)
        }
        return ret
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
                let url = this.unproxify(req.url.split('#')[0]), domain = this.domain(url), ext = this.ext(url), port = url.match(new RegExp(':([0-9]+)'))
                if(this.opts.debug){
					console.log('serving', url, req.url)
                }
                port = port ? parseInt(port[1]) : 80    
                if(this.opts.debug){
					console.log('serving', domain, port)            
                }
                let headers = req.headers, directURL = url
                headers.connection = 'close'
                headers.host = domain
                if(this.opts.debug){
					console.log('open', url, req, ext)
                }
                req.url = url
                if(this.opts.debug){
                    console.log('get()', url)
                }
                if(url.indexOf('.json') != -1 && url.indexOf(this.termsKey) == -1){
                    let file = path.resolve(this.opts.folder + path.sep + path.basename(url))
                    fs.stat(file, (err, stat) => {
                        if(err) { 
                            response.statusCode = 404
                            response.end(`File ${pathname} not found!`)
                            return
                        }
                        response.setHeader('Content-type', 'application/json')
                        response.setHeader('Content-Disposition', 'attachment; filename=categories.json')
                        response.setHeader('Access-Control-Allow-Origin', '*')
                        response.setHeader('Access-Control-Allow-Methods', 'GET')
                        response.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization')
                        response.setHeader('Cache-Control', 'max-age=0, no-cache, no-store')
                        response.setHeader('Connection', 'close')
                        fs.createReadStream(file).pipe(response, {end: true})
                    })
                } else {
                    this.get(url).then(data => {
                        if(data && data.length){
                            if(this.opts.debug){
                                console.log('get() resolved', data)
                            }
                            response.writeHead(200, {
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'GET',
                                'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                                'Content-Length': data.length,
                                'Connection': 'close',
                                'Cache-Control': 'max-age=0, no-cache, no-store',
                                'Content-Type': 'image/png'
                            })
                            response.end(Buffer.from(data))
                        } else {
                            if(this.opts.debug){
                                console.log('BADDATA', url, data)
                            }
                            response.writeHead(404, {
                                'Access-Control-Allow-Origin': '*',
                                'Access-Control-Allow-Methods': 'GET',
                                'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                                'Connection': 'close',
                                'Cache-Control': 'max-age=0, no-cache, no-store'
                            })
                            response.end()
                        }
                    }).catch(err => {
                        if(this.opts.debug){
                            console.log('get() catched', url, global.traceback())
                        }
                        response.writeHead(404, {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET',
                            'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Cache-Control, Accept, Authorization',
                            'Connection': 'close',
                            'Cache-Control': 'max-age=0, no-cache, no-store'
                        })
                        response.end(err+' - '+this.unproxify(req.url.split('#')[0]) + ' - ' + req.url.split('#')[0])
                    })
                }
            }).listen(this.opts.port, this.opts.addr, err => {
				if (err) {
					console.error('unable to listen on port', err)
					return
				}
                this.opts.port = this.server.address().port
                this.blank = 'http://'+ this.opts.addr +':'+ this.opts.port +'/blank.png'
			})
        }
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
    }
}

module.exports = IconServer
