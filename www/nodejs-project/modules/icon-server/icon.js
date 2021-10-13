
const fs = require('fs'), async = require('async')

class IconFetcher {
    constructor(){
        this.isAlphaRegex = new RegExp('\.png', 'i')
        this.isNonAlphaRegex = new RegExp('\.(jpe?g|webp|gif)', 'i')
    }
    fetchURL(url, shouldContinue){  
        return new Promise((resolve, reject) => {
            if(typeof(url) != 'string' || url.indexOf('//') == -1){
                return reject('bad url')
            }
            const key = this.master.key(url)
            if(this.master.opts.debug){
                console.warn('WILLFETCH', url)
            }
            this.master.checkHTTPCache(key).then(file => {
                if(this.master.opts.debug){
					console.log('fetchURL', url, 'cached')
                }
                this.master.validateFile(file).then(() => {
                    resolve({key, file})
                }).catch(reject)
            }).catch(err => {
                if(this.master.opts.debug){
					console.log('fetchURL', url, 'request', err)
                }
                this.master.schedule('download', done => {
                    if(shouldContinue && !shouldContinue()){
                        done()
                        return reject('cancelled')
                    }
                    let file = this.master.resolveHTTPCache(key)
                    let req = global.Download.file({
                        url,
                        responseType: 'buffer',
                        resolveBodyOnly: true,
                        downloadLimit: this.master.opts.downloadLimit,
                        retries: 2,
                        headers: {
                            'content-encoding': 'identity'
                        },
                        file
                    })
                    this.requests.push({req, done})
                    req.then(file => {
                        this.master.saveHTTPCacheExpiration(key, () => {
                            this.master.validateFile(file).then(() => {
                                resolve({key, file})
                            }).catch(reject)
                        })
                    }).catch(err => {
                        if(String(err).indexOf('Promise was cancelled') == -1){
                            this.master.saveHTTPCache(key, '', () => {
                                console.error('Failed to read URL', err, req, url)
                                reject('Failed to read URL (2): ' + url)
                            })
                        } else {               
                            fs.unlink(file, () => reject('cancelled'))
                        }
                    }).finally(() => {
                        done()
                    })
                })
            })
        })
    }
    hasPriority(prev, next, images){
        const prevImage = images.filter(m => m.icon == prev.icon)[0]
        const nextImage = images.filter(m => m.icon == next.icon)[0]
        if(prevImage.hits < nextImage.hits){
            return true
        } else if(prevImage.hits == nextImage.hits){
            if(prevImage.watching < nextImage.watching){
                return true
            } else if(prevImage.watching == nextImage.watching){
                if(!prevImage.epg && nextImage.epg){
                    return true
                } else {                    
                    if(!prevImage.live && nextImage.live){
                        return true
                    }
                }
            }
        }
    }
    fetchFromTerms(){
        return new Promise((resolve, reject) => {
            if(this.terms && this.terms.length){
                this.master.search(this.terms, true).then(images => {
                    let done
                    if(this.master.opts.debug){
                        console.log('GOFETCH', images)
                    }
                    async.eachOfLimit(images, 1, (image, i, acb) => {
                        if(image.icon.match(this.isNonAlphaRegex) && !image.icon.match(this.isAlphaRegex)){
                            return acb() // non alpha url
                        }
                        if(this.master.opts.debug){
                            console.log('GOFETCH', image)
                        }
                        this.fetchURL(image.icon, () => {
                            return !this.destroyed && (!done || this.hasPriority(done.image, image, images))
                        }).then(ret => {
                            if(this.master.opts.debug){
                                console.log('GOFETCH', image, 'THEN', ret)
                            }
                            this.master.validateFile(ret.file).then(type => {
                                if(type != 2){
                                    return acb() // not an alpha png
                                }
                                this.master.schedule('adjust', finish => {
                                    if(done && !this.hasPriority(done.image, image, images)){
                                        acb()
                                        return finish()
                                    }
                                    const key = ret.key
                                    this.master.adjust(ret.file, {shouldBeAlpha: true}).then(ret => {
                                        this.master.saveHTTPCacheExpiration(key, () => {
                                            if(ret.alpha){
                                                if(!done || this.hasPriority(done.image, image, images)){
                                                    done = ret
                                                    done.key = key
                                                    done.image = image
                                                    this.ready(key, true)
                                                }
                                            }
                                            acb()
                                            finish()
                                        })
                                    }).catch(err => {
                                        console.error(err, image.icon)
                                        acb()
                                        finish()
                                    })
                                })
                            }).catch(err => {
                                console.error(err)
                                acb()
                            })
                        }).catch(err => {
                            if(this.master.opts.debug){
                                console.log('GOFETCH', image, 'CATCH', err)
                            }
                            console.error(err)
                            acb()
                        })
                    }, () => {
                        if(this.destroyed){
                            return reject('destroyed')
                        }
                        if(this.master.opts.debug){
                            console.log('GOFETCH', images, 'OK', done, this.destroyed)
                        }
                        if(done){
                            resolve(done)
                        } else {
                            reject('Couldn\'t find a logo for: ' + JSON.stringify(this.terms) + '  ' + JSON.stringify(images))
                        }
                    })
                }).catch(err => {
                    console.error(err)
                    reject(err)
                })
            } else {
                reject('no terms, no url')
            }
        })
    }
    get(){
        let noEPGIcon = () => {
            let next = () => {
                if(this.destroyed) return
                if(this.isChannel){
                    this.master.getDefaultFile(this.terms).then(file => {
                        if(this.destroyed) return
                        if(this.master.opts.debug){
                            console.log('get > getDefault', this.entry.icon, this.terms, file)
                        }
                        const search = () => {                            
                            if(global.config.get('search-missing-logos')){
                                this.fetchFromTerms().then(ret => {
                                    if(this.master.opts.debug){
                                        console.log('get > fetch', this.terms, ret)
                                    }
                                    if(this.master.listsLoaded()){
                                        this.master.saveDefaultFile(this.terms, ret.file, () => {})
                                    }
                                }).catch(err => {
                                    if(this.destroyed) return
                                    console.error(err)
                                })
                            }
                        }
                        if(file){
                            const noIcon = 'no-icon'
                            fs.stat(file, (err, stat) => {
                                if(err){
                                    search()
                                } else if(stat.size == noIcon.length) {
                                    return
                                } else {
                                    this.ready(this.terms.join(','))
                                }
                            })
                        } else {
                            search()
                        }
                    }).catch(console.error)
                }
            }
            if(!this.entry.class || this.entry.class.indexOf('entry-icon-no-fallback') == -1){
                this.terms = global.channels.entryTerms(this.entry)
                this.isChannel = global.channels.isChannel(this.terms)
                if(this.isChannel){
                    this.terms = this.isChannel.terms
                }
                this.fetchURL(this.entry.icon).then(ret => this.ready(ret.key)).catch(err => {
                    if(this.destroyed) return
                    next()
                })
            } else {
                this.fetchURL(this.entry.icon).then(ret => this.ready(ret.key)).catch(err => {})
            }
        }
        if(this.entry.program && this.entry.program.i){
            this.fetchURL(this.entry.program.i).then(ret => this.ready(ret.key)).catch(noEPGIcon)
        } else {
            noEPGIcon()
        }
    }
}

class Icon extends IconFetcher {
    constructor(entry, path, tabIndex, master){
        super(entry, path, tabIndex, master)
        this.master = master
        this.entry = entry
        this.path = path
        this.tabIndex = tabIndex
        this.requests = []
        this.readyState = 0 // 0=icon not sent, 1=sent non alpha icon, 2=sent alpha icon
        this.lastEmittedKey = ''
        this.get()
    }
    cancelRequests(){
        this.requests.forEach(r => {
            if(r.req.cancel) r.req.cancel()
            r.done()
        })
    }
    destroy(){
        this.cancelRequests()
        this.destroyed = true
    }
    ready(key, force){
        if(!this.destroyed){
            this.lastEmittedKey = key
            if(!force && !this.master.isHashKey(key)) force = true
            if(this.master.opts.debug){
                console.log('icon', this.master.url + key, this.path, this.tabIndex, this.entry.name, this.entry, force)
            }
            global.ui.emit('icon', this.master.url + key, this.path, this.tabIndex, this.entry.name, force)
        }
    }
}

module.exports = Icon
