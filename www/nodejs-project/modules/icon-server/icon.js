
const fs = require('fs'), Events = require('events'), pLimit = require('p-limit')

class IconFetcher extends Events {
    constructor(){
        super()
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
        const limit = pLimit(3)
        const tasks = images.map(image => {
            return async () => {
                if(image.icon.match(this.isNonAlphaRegex) && !image.icon.match(this.isAlphaRegex)){
                    return false // non alpha url
                }
                if(done && !this.hasPriority(done.image, image, images)){
                    if(this.master.opts.debug){
                        console.log('ICON DOWNLOADING CANCELLED')
                    }
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
                if(!done || this.hasPriority(done.image, image, images)){
                    done = ret2
                    if(!done.key) done.key = key
                    done.image = image                        
                    done.url = this.master.url + done.key
                    this.succeeded = true
                    this.result = done
                    this.emit('result', done)
                }
            }
        }).map(limit)
        await Promise.allSettled(tasks)
        if(this.destroyed) throw 'destroyed'
        if(this.master.opts.debug){
            console.log('GOFETCH', images, 'OK', done, this.destroyed)
        }
        if(done){
            return done
        } else {
            throw 'Couldn\'t find a logo for: ' + JSON.stringify(this.terms) + ' ' + JSON.stringify(images)
        }
    }
    async resolve() {
        if(this.entry.programme && this.entry.programme.i){
            let err
            const ret = await this.master.fetchURL(this.entry.programme.i).catch(e => err = e)
            if(!err) return [ret.key, true, ret.isAlpha]
        }
        let err
        const ret = await this.master.fetchURL(this.entry.icon).catch(e => err = e)
        if(!err) return [ret.key, true, ret.isAlpha]
        if(!this.entry.class || this.entry.class.indexOf('entry-icon-no-fallback') == -1) {
            let atts
            this.terms = global.channels.entryTerms(this.entry)
            this.isChannel = global.channels.isChannel(this.terms)
            if(this.isChannel){
                this.terms = this.isChannel.terms
            } else if(atts = global.mega.parse(this.entry.url)) {
                if(!atts.terms){
                    atts.terms = this.entry.name
                }
                if(!Array.isArray(atts.terms)){
                    atts.terms = global.lists.terms(atts.terms)
                }
                this.terms = atts.terms
            }
            if(this.destroyed) throw 'destroyed'
            const file = await this.master.getDefaultFile(this.terms)
            if(this.destroyed) throw 'destroyed'
            if(this.master.opts.debug){
                console.log('get > getDefault', this.entry.icon, this.terms, file)
            }
            if(file){
                let err
                const noIcon = 'no-icon'
                const stat = await fs.promises.stat(file).catch(e => err = e)
                if(!err){
                    if(stat.size == noIcon.length) {
                        throw 'icon not found'
                    } else {
                        return [this.terms.join(','), false, true]
                    }
                }
            }                           
            if(global.config.get('search-missing-logos')){
                const ret = await this.fetchFromTerms()
                if(this.master.opts.debug){
                    console.log('get > fetch', this.terms, ret)
                }
                if(this.master.listsLoaded()){
                    await this.master.saveDefaultFile(this.terms, ret.file)
                }
                return [ret.key, false, ret.isAlpha]
            }
        }
        throw 'icon not found'
    }
}

class Icon extends IconFetcher {
    constructor(entry, master){
        super()
        this.master = master
        this.entry = entry
        this.start().catch(console.error)
    }
    async start(){
        let err
        const ret = await this.resolve().catch(e => err = e)
        this.succeeded = Array.isArray(ret)
        if(this.succeeded) {
            const key = ret[0]
            const url = this.master.url + key
            const force = ret[1]
            const alpha = ret[2]
            this.result = {key, url, force, alpha}
        } else {
            this.result = err
        }
        this.emit('result', this.result)
    }
    get() {
        return new Promise((resolve, reject) => {
            let cb = () => {
                (this.succeeded ? resolve : reject)(this.result)
                cb = () => {}
            }
            if(typeof(this.result) != 'undefined') {
                cb()
            } else {
                this.once('result', cb)
            }
        })
    }
    destroy(){
        this.destroyed = true
    }
}

module.exports = Icon
