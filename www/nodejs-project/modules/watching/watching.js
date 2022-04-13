const path = require('path'), async = require('async'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class Watching extends EntriesGroup {
    constructor(){
        super('watching')
        this.timer = 0
        this.title = global.lang.TRENDING
        this.currentEntries = null
        this.currentRawEntries = null
        this.updateIntervalSecs = global.cloud.expires.watching
        global.channels.ready(() => {
            this.update()
            global.channels.on('loaded', () => this.update()) // on each "loaded"
        })
        global.config.on('change', (keys, data) => {
            if(keys.includes('only-known-channels-in-been-watched') || keys.includes('parental-control-policy') || keys.includes('parental-control-terms')){
                this.update()
            }
        })
    }
    ready(cb){
        if(this.currentRawEntries){
            cb()
        } else {
            this.once('update', cb)
        }
    }
    showChannelOnHome(){
        return global.lists.manager.get().length || global.config.get('shared-mode-reach')
    }
    update(){
        clearTimeout(this.timer)
        let prv = this.entry()
        this.process().then(() => {}).catch(err => {
            console.error('watching '+ err)
            if(!this.currentRawEntries){
                this.currentEntries = []
                this.currentRawEntries = []
            }
        }).finally(() => {
            clearTimeout(this.timer) // clear again to be sure
            this.timer = setTimeout(() => this.update(), this.updateIntervalSecs * 1000)
            this.emit('update')
            let nxt = this.entry()
            if(this.showChannelOnHome() && global.explorer.path == '' && (prv.details != nxt.details || prv.name != nxt.name)){
                global.explorer.updateHomeFilters()
            } else {
                this.updateView()
            }
        })
    }
    updateView(){
        if(global.explorer.path == this.title){
            global.explorer.refresh()
        }
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == ''){
                let has, pos = 0, entry = this.entry()
                if(this.currentEntries && this.currentEntries.length && entry.details != global.lang.BEEN_WATCHED){
                    entries.some((e, i) => {
                        if(i == 0 && e.hookId == 'history'){ // let continue option as first
                            pos = 1
                        }
                        if(e.hookId == this.key){
                            has = e.name
                            return true
                        }
                    })
                }
                if(has){
                    entries = entries.filter(e => e.hookId != this.key)
                    entries.splice(pos, 0, entry)
                } else if(!entries.some(e => e.hookId == this.key)) {
                    entries.push(entry)
                }
            }
            resolve(entries)
        })
    }
    extractUsersCount(e){
        if(e.users){
            return e.users
        }
        let n = String(e.label || e.details).match(new RegExp('([0-9]+)($|[^&])'))
        return n && n.length ? parseInt(n[1]) : 0 
    }
    entries(){
        return new Promise((resolve, reject) => {
            if(global.lists.manager.updatingLists){
                return resolve([global.lists.manager.updatingListsEntry()])
            }
            if(!global.activeLists.length){
                return resolve([global.lists.manager.noListsEntry()])
            }
            this.ready(() => {
                let list = this.currentEntries ? global.deepClone(this.currentEntries, true) : []
                list = list.map((e, i) => {
                    e.position = (i + 1)
                    return e
                })
                if(!list.length){
                    list = [{name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty'}]
                } else {
                    const acpolicy = global.config.get('parental-control-policy')
                    if(acpolicy == 'block'){
                        list = global.lists.parentalControl.filter(list)		
                    } else if(acpolicy == 'only') {
                        list = global.lists.parentalControl.only(list)
                    }     
                }
                list = this.prepare(list) 
                global.channels.epgChannelsAddLiveNow(list, false).then(resolve).catch(reject)
            })       
        })
    }
    applyUsersPercentages(entries){
        let totalUsersCount = 0
        entries.forEach(e => totalUsersCount += e.users)
        let pp = totalUsersCount / 100
        entries.forEach((e, i) => {
            entries[i].usersPercentage = e.users / pp
        })
        return entries
    }
    async process(){
        let data = await global.cloud.get('watching', false)
        if(!Array.isArray(data)){
            data = []
        }
        data.forEach((e, i) => {
            if(e.logo && !e.icon){
                data[i].icon = e.logo
                delete data[i].logo
            }
        })
        let recoverNameFromMegaURL = true, ex = !global.config.get('shared-mode-reach') // we'll make entries URLless for exclusive mode, to use the provided lists only
        data = global.lists.prepareEntries(data)
        data = data.filter(e => (e && typeof(e) == 'object' && typeof(e.name) == 'string')).map(e => {
            let isMega = global.mega.isMega(e.url)
            if(isMega && recoverNameFromMegaURL){
                let n = global.mega.parse(e.url)
                if(n && n.name){
                    e.name = global.ucWords(n.name)
                }
            }
            e.name = global.lists.parser.sanitizeName(e.name)
            e.users = this.extractUsersCount(e)
            e.details = ''
            if(ex && !isMega){
                e.url = global.mega.build(e.name)
            }
            return e
        })
        data = global.lists.parentalControl.filter(data)
        this.currentRawEntries = data.slice(0)
        const adultContentOnly = global.config.get('parental-control-policy') == 'only', onlyKnownChannels = !adultContentOnly && global.config.get('only-known-channels-in-been-watched')
        let groups = {}, gcount = {}, gentries = []
        let sentries = await global.search.searchSuggestionEntries()
        let gsearches = [], searchTerms = sentries.map(s => s.search_term).filter(s => !global.channels.isChannel(s)).filter(s => global.lists.parentalControl.allow(s)).map(s => global.lists.terms(s))
        data.forEach((entry, i) => {
            let ch = global.channels.isChannel(entry.terms.name)
            if(!ch){
                searchTerms.some(terms => {
                    if(global.lists.match(terms, entry.terms.name)){
                        const name = terms.join(' ')
                        if(!gsearches.includes(name)){
                            gsearches.push(name)
                        }
                        ch = {name}
                        return true
                    }
                })
            }
            if(ch){ 
                let term = ch.name
                if(typeof(groups[term]) == 'undefined'){
                    groups[term] = []
                    gcount[term] = 0
                }
                if(typeof(entry.users) != 'undefined'){
                    entry.users = this.extractUsersCount(entry)
                }
                gcount[term] += entry.users
                delete data[i]
            } else {
                if(onlyKnownChannels){
                    delete data[i]
                } else if(global.mega.isMega(entry.url)) {
                    data[i] = global.channels.toMetaEntry(entry)
                }
            }
        })
        Object.keys(groups).forEach(n => {
            const name = global.ucWords(n)
            gentries.push(global.channels.toMetaEntry({
                name, 
                type: 'group',
                fa: 'fas fa-play-circle',
                users: gcount[n],
                url: gsearches.includes(n) ? global.mega.build(name, {terms: n.split(' '), mediaType: 'all'}) : undefined
            }))
        })
        data = data.filter(e => {
            return !!e
        }).concat(gentries).sortByProp('users', true)
        data = this.applyUsersPercentages(data)
        this.currentEntries = data
        return data
    }
    order(entries){
        return new Promise((resolve, reject) => {
            if(this.currentRawEntries){
                let up = [], es = entries.slice(0)
                this.currentRawEntries.forEach(r => {
                    es.some((e, i) => {
                        if(r.url == e.url){
                            e.users = r.users
                            up.push(e)
                            delete es[i]
                            return true
                        }
                    })
                })
                resolve(up.concat(es.filter(e => { return !!e })))
            } else {
                resolve(entries)
            }     
        })
    }
    entry(){
        const entry = {name: this.title, details: global.lang.BEEN_WATCHED, fa: 'fas fa-chart-bar', hookId: this.key, type: 'group', renderer: this.entries.bind(this)}
        if(this.currentEntries && this.showChannelOnHome()){
            let top, rootPage = global.explorer.pages['']
            this.currentEntries.some(e => {
                if(!rootPage.some(r => (r.name == e.name && r.hookId != this.key)) && global.channels.isChannel(e.name)){
                    top = e
                    return true
                }
            })
            if(top){
                let s = top.users == 1 ? 'user' : 'users'
                entry.name = this.title
                entry.class = 'entry-icon' 
                entry.channelName = top.name
                entry.prepend = '<i class="fas fa-chart-bar"></i> '
                entry.details = top.name + ' &middot; <i class="fas fa-'+ s +'"></i> '+ global.lang.X_WATCHING.format(top.users)
            }
        }
        return entry
    }
}

module.exports = Watching
