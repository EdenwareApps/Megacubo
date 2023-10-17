
const EntriesGroup = require('../entries-group'), EPGHistory = require('./epg-history')

class History extends EntriesGroup {
    constructor(){
        super('history')
        this.limit = 36
        this.resumed = false
        this.uiReady(() => {
            global.streamer.on('commit', () => {
                if(!streamer.active.info.isLocalFile){
                    let time = global.time()
                    if(this.timer){
                        clearTimeout(this.timer)
                    }
                    this.timer = setTimeout(() => {
                        if(global.streamer.active){
                            let entry = global.streamer.active.data
                            entry.historyTime = time
                            this.remove(entry)
                            this.add(entry)
                            global.updateUserTasks().catch(console.error)
                        }
                    }, 90000)
                }
            })
            global.streamer.on('uncommit', () => {
                if(this.timer){
                    clearTimeout(this.timer)
                }
            })
        })
        this.on('load', () => {
            this.uiReady(() => {
                if(explorer.path == ''){
                    explorer.updateHomeFilters()
                }
            })
        })
        this.epg = new EPGHistory()
    }
    get(...args){
        let ret = super.get(...args)        
        const port = global.icons ? global.icons.opts.port : 0
        if(ret && port) {
            const fixIcon = e => {
                if(e.icon && e.icon.startsWith('http://127.0.0.1:') && e.icon.match(rgx)) {
                    e.icon = e.icon.replace(rgx, '$1'+ port +'$2')
                }
                return e
            }
            const rgx = new RegExp('^(http://127\.0\.0\.1:)[0-9]+(/[A-Za-z0-9,]+)$')
            if(Array.isArray(ret)) {
                ret = ret.map(fixIcon)
            } else {
                ret = fixIcon(ret)
            }
        }
        for(let i=0; i<ret.length; i++) {
            if(!ret[i].originalUrl) {
                const ch = global.channels.isChannel(ret[i].name)
                if(ch) {
                    ret[i].originalUrl = global.mega.build(ch.name, {terms: ch.terms})
                }
            }
        }
        return ret
    }
    resume(){
        this.ready(() => {
            if(!this.resumed && global.streamer){
                this.resumed = true
                let es = this.get()
                console.log('resuming', es)
                if(es.length){
                    console.log('resuming', es[0], es)
                    global.streamer.play(es[0])
                }
            }
        })
    }
    entry(){
        return {name: global.lang.KEEP_WATCHING, details: global.lang.WATCHED, fa: 'fas fa-history', type: 'group', hookId: this.key, renderer: this.entries.bind(this)}
    }
    async hook(entries, path){
        if(path == global.lang.TOOLS){
            entries.push(this.entry())
        } else if(path == '') {
            let pos = -1, es = this.get()
            entries = entries.filter(e => {
                return e.hookId != this.key
            })
            entries.some((e, i) => {
                if(e.name == global.lang.IPTV_LISTS){
                    pos = i
                    return true
                }
            })
            if(es.length){
                pos = 0
                let defs = {hookId: this.key, fa: 'fas fa-redo-alt', class: 'entry-icon', details: '<i class="fas fa-play-circle"></i> '+ global.lang.KEEP_WATCHING}
                entries.splice(pos, 0, Object.assign(Object.assign({}, es[0]), defs))
            } else {
                entries.splice(pos > 0 ? pos : entries.length - 3, 0, this.entry())
            }
        }
        entries = await this.epg.hook(entries, path)
        return entries
    }
    async entries(e){
        const epgAddLiveNowMap = {}
        let gentries = this.get().map((e, i) => {
            e.details = global.ucFirst(global.moment(e.historyTime * 1000).fromNow(), true)
            const isMega = e.url && global.mega.isMega(e.url)
            if(isMega){
                let atts = global.mega.parse(e.url)
                if(atts.mediaType == 'live'){
                    return (epgAddLiveNowMap[i] = global.channels.toMetaEntry(e, false))
                } else {
                    e.type = 'group'
                    e.renderer = async () => {
                        let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : global.lists.terms(atts.name, true)
                        const es = await global.lists.search(terms, {
                            type: 'video',
                            group: true,
                            safe: !global.lists.parentalControl.lazyAuth()
                        })
                        return es.results
                    }
                }
            } else if(e.type != 'group'){
                e.type = 'stream'
            }
            return e
        })
        let entries = await global.channels.epgChannelsAddLiveNow(Object.values(epgAddLiveNowMap), true).catch(console.error)
        if(Array.isArray(entries)) {
            const ks = Object.keys(epgAddLiveNowMap)
            entries.forEach((e, i) => gentries[ks[i]] = e)
        }
        if(gentries.length){
            gentries.push({name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.removalEntries.bind(this)})
        }
        return gentries
    }
}

module.exports = History
