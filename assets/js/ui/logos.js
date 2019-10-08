
class LogoFinder {
    constructor(opts){
        this.j = window.jQuery
        this.debug = false
        this.concurrency = 2
        this.image = '<img src="{0}" />';
        ['log', 'warn', 'error'].forEach(f => {
            this[f] = this.debug ? console[f] : () => {}
        })
		Object.keys(opts).forEach(k => {
			this[k] = opts[k]
        })
        if(!this.container){
            this.container = this.j('body')
        }
        this.processing = 0
        this.lookupLock = {};
        this.pool = []
    }
    go(){
        entriesViewportFilter(this.container.find('a.entry-stream, a.entry-meta-stream')).forEach((element, i) => {
            if(this.pool.indexOf(element) == -1){
                this.pool.push(element)
            }
        })
        this.next()
    }
    add(element){
        if(this.pool.indexOf(element) == -1){
            this.pool.push(element)
            this.next()
        }
    }
    next(){
        if(this.pool.length && this.processing < this.concurrency){
            this.processing++
            this.process(this.pool.shift(), () => {
                this.processing--
                this.next()
            })
        }
    }
    apply(j, src){
        let c = j.find('.entry-logo-fa-c')
        this.log('LogoFinder.apply()', src, c)
        if(c.length){
            c.removeClass('entry-logo-fa-c').addClass('entry-logo-img-c').html(this.image.format(src))
            this.log('LogoFinder.apply()', src, c, c.get(0).parentNode)
        }
    }
    process(element, cb){
        let src, found, j = jQuery(element), entry = j.data('entry-data'), shouldCancel = () => {
            return (found || !element || !element.parentNode)
        }, deeper = () => {
            if(
                ((typeof(entry.url) != 'undefined' || entry.type == 'stream') && (!entry.mediaType || ['all', 'live'].indexOf(entry.mediaType) != -1)) || 
                (entry.class && entry.class.indexOf('entry-meta-stream') != -1)
            ){
                this.log('LogoFinder.process(), STEP 2', entry)
                let ret = this.lookup(entry, (ret) => {
                    this.log('LogoFinder.process(), STEP 2, RESULT', ret, j)
                    if(ret){
                        this.log('LogoFinder.process(), STEP 2, RESULT', ret, j)
                        this.apply(j, ret)
                    }
                    cb()
                })
            } else {
                this.log('LogoFinder.process() NOT FOUND', entry)
                cb()
            }
        }
        this.log('LogoFinder.process()', element)
        if(!shouldCancel()){
            let srcs = (entry && entry.logos) ? entry.logos : []
            if(srcs.length){
                this.log('LogoFinder.process()', element, srcs)
                return async.eachOfLimit(srcs, 1, (src, i, acb) => {
                    if(shouldCancel()){
                        acb()
                    } else {
                        checkImage(src, () => {
                            if(!shouldCancel()){
                                this.log('LogoFinder.process() FOUND', src, j, this.image.format(src))
                                this.apply(j, src)
                                found = true
                            }
                            acb()
                        }, () => {
                            acb()
                        })
                    }
                }, () => {
                    if(shouldCancel()){
                        cb()
                    } else {
                        deeper()
                    }
                })
            } else {
                deeper()
            }
        }
        cb()
    }
    lookup(entry, lcb){
        let terms = playingStreamKeyword(entry) || entry.name, t = typeof(this.lookupLock[terms])
        if(t == 'object' && Array.isArray(this.lookupLock[terms])) { // cb array
            this.log('LogoFinder.process(), LOOKUP QUEUED', this.lookupLock[terms], terms, t, Array.isArray(this.lookupLock[terms]))
            this.lookupLock[terms].push(lcb)
            return '3.3-'+t+'-'+terms
        } else if(t == 'string' || t === false) {
            this.log('LogoFinder.process(), LOOKUP CACHED', this.lookupLock[terms])
            lcb(this.lookupLock[terms])
            return 3.2
        } else {
            this.log('LogoFinder.process(), LOOKUP', terms)
            this.lookupLock[terms] = [lcb]
            search(entries => {
                let found
                this.log('LogoFinder.process(), LOOKUP RESULTS', terms, entries)
                async.eachOfLimit(entries, 1, (e, i, acb) => {
                    if(found || !e.logo || e.logo.indexOf('//') == -1){
                        return acb()
                    }
                    if(typeof(entry.isAudio) != 'undefined' && typeof(e.isAudio) != 'undefined' && entry.isAudio != e.isAudio){
                        return acb()
                    }
                    if(typeof(entry.isSafe) != 'undefined' && typeof(e.isSafe) != 'undefined' && entry.isSafe != e.isSafe){
                        return acb()
                    }
                    checkImage(e.logo, () => {
                        found = e.logo
                        this.log('LogoFinder.process(), LOGO FOUND AT', e, terms)
                        acb()
                    }, () => {
                        acb()
                    })
                }, () => {
                    this.log('LogoFinder.process(), LOOKUP '+(found?'SUCCESS':'FAILED'), terms, found)
                    if(Array.isArray(this.lookupLock[terms])){
                        let a = this.lookupLock[terms]
                        this.lookupLock[terms] = found
                        a.forEach(f => {
                            f(found)
                        })
                    } else {
                        this.lookupLock[terms] = found
                    }
                })
            }, entry.mediaType || 'live', terms, false, false, null, false)
            return 3.1
        } 
    }
}

const LogoFind = new LogoFinder({j: jQuery, container: jQuery('#menu .list div > div'), debug: debugAllow(true)})

const processLogos = () => {
    LogoFind.go()
}
LogoFind.container.on('scrollend', () => {
    process.nextTick(processLogos)
})
Menu.on('render', () => {
    process.nextTick(processLogos)
})

function applyIconFramingMode(){
    let css = '', mode = Theme.get('icon-framing')
    switch(mode){
        case 'y':
            css = ' .entry-logo img { width: auto; height: 100%; } '
            break
        case 'x':
            css = ' .entry-logo img { width: 100%; height: auto; } '
            break
        default:
            css = ' .entry-logo img { width: 100%; height: 100%; } '
            break
    }
    console.warn('APPLY ICON FRAMING', css);
    stylizer(css, 'icon-framing', window)
}

addAction('afterLoadTheming', applyIconFramingMode)
applyIconFramingMode()

