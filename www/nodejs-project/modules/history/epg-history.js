const EntriesGroup = require('../entries-group'), Suggestions = require('./suggestions')

class EPGHistory extends EntriesGroup {
    constructor(){
        super('epg-history')
        this.suggestions = new Suggestions(this)
        this.limit = 48
        this.minWatchingTime = 240
        this.checkingInterval = 60 // to prevent losing data on program closing, we'll save it periodically
        this.resumed = false
        this.session = null
        this.allowDupes = true
        global.streamer.on('commit', async () => {
            await this.busy()
            const data = this.currentStreamData()
            const name = data.originalName || data.name
            if(this.session && this.session.name != name){
                await this.finishSession().catch(console.error)
            }
            if(!global.streamer.active) return
            if(!this.session){
                let validate = !global.streamer.active.info.isLocalFile && global.streamer.active.mediaType == 'live' && global.channels.isChannel(name)
                if(validate){
                    console.warn('Session started')
                    this.startSession()
                } else {
                    console.warn('Session not started, not a channel')
                }
            } else {
                console.warn('Session already started')
            }
        })
        global.streamer.on('uncommit', () => {
            console.warn('Session finished')
            this.finishSession()
        })
        global.channels.on('epg-loaded', () => {
            if(this.inSection()){
                global.explorer.refresh()
            }
        })
    }
    currentStreamData(){
        return Object.assign({}, global.streamer.active ? global.streamer.active.data : global.streamer.lastActiveData)
    }
    startSession(){
        this.session = this.currentStreamData()
        if(this.session.originalName){
            this.session.name = this.session.originalName
        }
        this.session.startTime = global.time()
        this.startSessionTimer()
    }
    async finishSession(){
        if(this.session){
            this.setBusy(true)
            clearInterval(this.session.timer)
            await this.check().catch(console.error)
            this.session = null
            this.setBusy(false)
        }
    }
    startSessionTimer(){
        clearInterval(this.session.timer)
        this.session.timer = setInterval(() => {
            this.check().catch(console.error)
        }, this.checkingInterval * 1000)
    }
    finishSessionTimer(){
        clearInterval(this.session.timer)
    }
    async check(){
        if(!this.session) return
        const now = global.time(), data = this.currentStreamData()
        let nextRunTime = 0, info = await global.channels.epgChannelLiveNowAndNextInfo(data)
        if(info) {
            info = Object.values(info)
            if(this.session && this.session.lastInfo) {
                this.session.lastInfo.forEach(inf => {
                    if(!info.some(f => f.t == inf.t)) {
                        info.unshift(inf)
                    }
                })
            }
            let save
            info.forEach(f => {
                data.watched = this.getWatchingTime(f)
                if(data.watched && data.watched.time > this.minWatchingTime) {
                    const updated = this.data.some((entry, i) => {
                        if(entry.watched.name == data.watched.name){
                            if(entry.watched.start == data.watched.start) {
                                this.data[i] = this.cleanAtts(data)
                                save = true
                                return true
                            } else {
                                let diff = data.watched.start - entry.watched.end
                                if(diff < 120) {
                                    data.watched.start = entry.watched.start
                                    data.watched.time = data.watched.end - data.watched.start
                                    this.data[i] = this.cleanAtts(data)
                                    save = true
                                    return true
                                }
                            }
                        }
                    })
                    if(!updated) {
                        save = false
                        if(this.data.length >= this.limit){
                            this.data = this.data.slice(this.data.length - (this.limit - 1))
                        }
                        this.add(data)
                        if(this.inSection() == 1){
                            global.explorer.refreshNow()
                        }
                    }
                }
                [f.s, f.e].forEach(s => {
                    if(s > now && (!nextRunTime || s < nextRunTime)){
                        nextRunTime = s
                    }
                })
            })
            if(save){
                this.save(true)
            }
        }
    }
    getWatchingTime(epgEntry){
        if(this.session){
            const start = Math.max(this.session.startTime, epgEntry.s)
            const end = Math.min(global.time(), epgEntry.e)
            return {
                start, end, 
                time: end - start, 
                name: epgEntry.t, 
                icon: epgEntry.i, 
                categories: [...new Set(epgEntry.c)]
            }
        }
        return null
    }
    async entry(){
        const featured = await this.suggestions.featuredEntry().catch(console.error)
        const e = {
            name: global.lang.RECOMMENDED_FOR_YOU, 
            fa: 'fas fa-solid fa-thumbs-up', 
            type: 'group',
            hookId: this.key, 
            renderer: this.entries.bind(this)
        }
        if(featured && featured.program){
            e.details = featured.program.t
            e.program = featured.program
        }
        return e
    }
    inSection(entries, path){
        if(!Array.isArray(entries)){
            entries = global.explorer.currentEntries
        }
        if(typeof(path) != 'string') {
            path = global.explorer.path
        }
        if(this.data.length && global.channels.activeEPG){
            if(path == global.lang.LIVE){
                return 3
            } else if(path == global.lang.BOOKMARKS){
                return 2
            } else if(path.indexOf(global.lang.RECOMMENDED_FOR_YOU) != -1){
                return 1
            }
        }
    }
    async hook(entries, path){
        const hookup = async () => {
            let index = 1
            const entry = await this.entry()
            if(entries.some(e => e.hookId == entry.hookId)){
                entries = entries.filter(e => e.hookId != entry.hookId)
            }
            if(!entry.program){
                entries.some((e, i) => {
                    if(e.name == global.lang.TOOLS){
                        index = i + 1
                        return true
                    }
                })
            }
            if(index){
                entries.splice(index, 0, entry)
            } else {
                entries.push(entry)
            }
        }
        let i = this.inSection(entries, path)
        if(!path){
            if(entries.length > 2){
                await hookup()
            }
        } else if(i == 2){
            await hookup()
        }
        return entries
    }
    async historyRemovalEntries(e){
        let es = this.get()
        es = es.map((o, i) => {
            const details = global.moment(o.watched.start * 1000).fromNow()
            const e = Object.assign({}, o)
            e.details = details
            if(e.icon){
                delete e.icon
            }
            e.name = e.watched.name
            e.details += ' <i class="fas fa-clock"></i> '+ global.ts2clock(e.watched.start) +'-'+ global.ts2clock(e.watched.end) // [e.category].concat(e.programme.c).join(', ') + ''            
            e.type = 'action'
            e.action = () => {
                this.remove(o)
                global.explorer.refreshNow()
            }
            e.fa = 'fas fa-trash'
            delete e.url
            return e
        })
        return es
    }
    async historyEntries(e){
        let es = this.get()
        es = es.map(e => {
            e.details = global.moment(e.watched.start * 1000).fromNow()
            e = global.channels.toMetaEntry(e, false)
            if(e.watched.icon){
                e.icon = e.watched.icon
            }
            e.name = e.watched.name
            e.details += ' <i class="fas fa-clock"></i> '+ global.ts2clock(e.watched.start) +'-'+ global.ts2clock(e.watched.end) // [e.category].concat(e.programme.c).join(', ') + ''            
            e.type = 'action'
            e.action = () => {
                global.channels.epgProgramAction(e.watched.start, e.originalName, {t: e.watched.name, e: e.watched.end, c: [...new Set(e.watched.categories)]}, e.terms)
            }
            e.fa = 'fas fa-history'
            delete e.url
            return e
        })
        if(es.length){
            es.push({name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.historyRemovalEntries.bind(this)})
        }
        return es
    }
    async entries(){
        let es = await this.suggestions.get().catch(console.error)
        if(!Array.isArray(es)){
            es = []
        }
        if(!es.length){
            if(global.activeEPG || global.config.get('epg-'+ global.lang.locale)) {
                es.push({
                    name: global.lang.NO_RECOMMENDATIONS_YET, 
                    type: 'action', 
                    fa: 'fas fa-info-circle', 
                    class: 'entry-empty',
                    action: async () => {                    
                        await global.explorer.dialog([
                            {template: 'question', text: global.lang.NO_RECOMMENDATIONS_YET, fa: 'fas fa-info-circle'},
                            {template: 'message', text: global.lang.RECOMMENDATIONS_INITIAL_HINT},
                            {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                        ])
                    }
                })
            } else {
                es.push({
                    name: global.lang.EPG_DISABLED, 
                    type: 'action', 
                    fa: 'fas fa-times-circle', 
                    class: 'entry-empty',
                    action: async () => {                    
                        const path = global.lang.IPTV_LISTS +'/'+ global.lang.EPG
                        await global.explorer.open(path)
                    }
                })
            }
        } else if(this.get().length <= 5) {
            es.push({
                name: global.lang.IMPROVE_YOUR_RECOMMENDATIONS, 
                type: 'action', 
                fa: 'fas fa-info-circle', 
                class: 'entry-empty',
                action: async () => {                    
                    await global.explorer.dialog([
                        {template: 'question', text: global.lang.IMPROVE_YOUR_RECOMMENDATIONS, fa: 'fas fa-thumbs-up'},
                        {template: 'message', text: global.lang.RECOMMENDATIONS_IMPROVE_HINT},
                        {template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'}
                    ])
                }
            })
        }
        if(this.data.length){
            es.push({
                name: global.lang.WATCHED, 
                fa: 'fas fa-history', 
                type: 'group', 
                renderer: this.historyEntries.bind(this)
            })
        }
        return es
    }
    setBusy(set){
        this.isBusy = set
        if(!this.isBusy){
            this.emit('release')
        }
    }
    busy(){
        return new Promise((resolve, reject) => {
            if(this.isBusy){
                this.once('release', async () => {
                    this.check().catch(console.error).finally(resolve)
                })
            } else {
                this.check().catch(console.error).finally(resolve)
            }
        })
    }
}

module.exports = EPGHistory
