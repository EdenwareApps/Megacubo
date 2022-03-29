
const fs = require('fs'), async = require('async')

class IconFetcher {
    constructor(){
        this.isAlphaRegex = new RegExp('\.png', 'i')
        this.isNonAlphaRegex = new RegExp('\.(jpe?g|webp|gif)', 'i')
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
                this.master.search(this.terms).then(images => {
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
                        this.master.fetchURL(image.icon).then(ret => {
                            const key = ret.key
                            if(this.master.opts.debug){
                                console.log('GOFETCH', image, 'THEN', ret.file)
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
                                    this.master.adjust(ret.file, {shouldBeAlpha: true, minWidth: 100, minHeight: 100}).then(ret => {
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
            let fromTerms = () => {
                if(this.destroyed) return
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
            this.master.fetchURL(this.entry.icon).then(ret => this.ready(ret.key)).catch(err => {
                if(!this.entry.class || this.entry.class.indexOf('entry-icon-no-fallback') == -1){
                    this.terms = global.channels.entryTerms(this.entry)
                    this.isChannel = global.channels.isChannel(this.terms)
                    if(this.isChannel){
                        this.terms = this.isChannel.terms
                        fromTerms()
                    } else {
                        this.error = err
                    }
                }
            })
        }
        if(this.entry.program && this.entry.program.i){
            this.master.fetchURL(this.entry.program.i).then(ret => this.ready(ret.key)).catch(noEPGIcon)
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
        this.readyState = 0 // 0=icon not sent, 1=sent non alpha icon, 2=sent alpha icon
        this.lastEmittedKey = ''
        this.get()
    }
    destroy(){
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
