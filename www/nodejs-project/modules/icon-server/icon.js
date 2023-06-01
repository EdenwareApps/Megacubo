
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
    async fetchFromTerms(){
        if(!this.terms || !this.terms.length) throw 'no terms, no url'
        let done
        const images = await this.master.search(this.terms)
        if(this.master.opts.debug){
            console.log('GOFETCH', images)
        }
        const tasks = images.map(async image => {
            if(image.icon.match(this.isNonAlphaRegex) && !image.icon.match(this.isAlphaRegex)){
                return false // non alpha url
            }
            if(done && !this.hasPriority(done.image, image, images)){
                console.error('ICON DOWNLOADING CANCELLED')
                return false
            }
            if(this.master.opts.debug){
                console.log('GOFETCH', image)
            }
            const ret = await this.master.fetchURL(image.icon)
            const key = ret.key
            if(this.master.opts.debug){
                console.log('GOFETCH', image, 'THEN', ret.file)
            }
            const type = await this.master.validateFile(ret.file)
            if(type != 2){
                return false // not an alpha png
            }
            if(done && !this.hasPriority(done.image, image, images)){
                if(this.master.opts.debug){
                    console.warn('ICON ADJUSTING CANCELLED')
                }
                return false
            }
            const ret2 = await this.master.adjust(ret.file, {shouldBeAlpha: true, minWidth: 100, minHeight: 100})
            await this.master.saveHTTPCacheExpiration(key)
            if(ret2.alpha){
                if(!done || this.hasPriority(done.image, image, images)){
                    done = ret2
                    done.key = key
                    done.image = image
                    this.ready(key, true, true)
                }
            }
        })
        await Promise.allSettled(tasks)
        if(this.destroyed){
            throw 'destroyed'
        }
        if(this.master.opts.debug){
            console.log('GOFETCH', images, 'OK', done, this.destroyed)
        }
        if(done){
            return done
        } else {
            throw 'Couldn\'t find a logo for: ' + JSON.stringify(this.terms) + ' ' + JSON.stringify(images)
        }
    }
    async get(){
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
                                this.ready(this.terms.join(','), false, true)
                            }
                        })
                    } else {
                        search()
                    }
                }).catch(console.error)
            }
            this.master.fetchURL(this.entry.icon).then(ret => this.ready(ret.key, false, ret.isAlpha)).catch(err => {
                if(!this.entry.class || this.entry.class.indexOf('entry-icon-no-fallback') == -1) {
                    let atts
                    this.terms = global.channels.entryTerms(this.entry)
                    this.isChannel = global.channels.isChannel(this.terms)
                    if(this.isChannel){
                        this.terms = this.isChannel.terms
                        fromTerms()
                    } else if(atts = global.mega.parse(this.entry.url)) {
                        if(!atts.terms){
                            atts.terms = this.entry.name
                        }
                        if(!Array.isArray(atts.terms)){
                            atts.terms = global.lists.terms(atts.terms)
                        }
                        this.terms = atts.terms
                        fromTerms()
                    } else {
                        this.error = err
                    }
                }
            })
        }
        if(this.entry.program && this.entry.program.i){
            this.master.fetchURL(this.entry.program.i).then(ret => this.ready(ret.key, false, ret.isAlpha)).catch(noEPGIcon)
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
        this.get().catch(console.error)
    }
    destroy(){
        this.destroyed = true
    }
    ready(key, force, alpha){
        if(!this.destroyed){
            this.lastEmittedKey = key
            if(!force && !this.master.isHashKey(key)) force = true
            if(this.master.opts.debug){
                console.log('icon', this.master.url + key, this.path, this.tabIndex, this.entry.name, this.entry, force)
            }
            global.ui.emit('icon', {
                url: this.master.url + key, 
                path: this.path, 
                tabindex: this.tabIndex, 
                name: this.entry.name, 
                force, 
                alpha
            })
        }
    }
}

module.exports = Icon
