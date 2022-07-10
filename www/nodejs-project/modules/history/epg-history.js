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
            if(this.session.lastInfo) {
                this.session.lastInfo.forEach(inf => {
                    if(!info.some(f => f.t == inf.t)) {
                        info.unshift(inf)
                    }
                })
            }
            let save
            info.forEach(f => {
                data.watched = this.getWatchingTime(f)
                if(data.watched.time > this.minWatchingTime) {
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
                            global.explorer.refresh()
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
    entry(){
        return {
            name: global.lang.RECOMMENDED_FOR_YOU, 
            fa: 'fas fa-solid fa-thumbs-up', 
            type: 'group',
            renderer: this.entries.bind(this)
        }
    }
    inSection(entries, path){
        if(!Array.isArray(entries)){
            entries = global.explorer.currentEntries
        }
        if(typeof(path) != 'string') {
            path = global.explorer.path
        }
        if(this.data.length && global.channels.activeEPG){
            if(path == (global.lang.LIVE +'/'+ global.lang.EPG)){
                return 3
            } else if(path == global.lang.BOOKMARKS){
                return 2
            } else if(path.indexOf(global.lang.RECOMMENDED_FOR_YOU) != -1){
                return 1
            }
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            let i = this.inSection(entries, path)
            if(i == 3){
                entries.splice(1, 0, this.entry())
            } else if(i == 2){
                entries.push(this.entry())
            }
            resolve(entries)
        })
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
                global.explorer.refresh()
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
        let es = await this.suggestions.get()
        if(!es.length){
            es.push({
                name: global.lang.NO_SUGGESTIONS_FOUND, 
                type: 'action', 
                fa: 'fas fa-info-circle', 
                class: 'entry-empty'
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
