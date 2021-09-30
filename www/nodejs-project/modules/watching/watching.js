const path = require('path'), async = require('async'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class Watching extends EntriesGroup {
    constructor(){
        super('watching')
        this.timer = 0
        this.currentEntries = null
        this.currentRawEntries = null
        this.updateIntervalSecs = global.cloud.expires.watching
        global.channels.ready(() => this.update())
        global.channels.on('loaded', () => this.update())
        global.config.on('change', (keys, data) => {
            if(keys.includes('only-known-channels-in-been-watched') || keys.includes('parental-control-policy')){
                this.update()
            }
        })
    }
    ready(cb){
        if(this.currentRawEntries){
            cb()
        } else {
            this.once('ready', cb)
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
            this.emit('ready')
            let nxt = this.entry()
            if(this.showChannelOnHome() && global.explorer.path == '' && (prv.details != nxt.details || prv.name != nxt.name)){
                global.explorer.updateHomeFilters()
            }
        })
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == ''){
                let has, pos = 0, entry = this.entry()
                if(this.currentEntries && this.currentEntries.length && entry.name != global.lang.TRENDING){
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
            if(lists.manager.updatingLists){
                return resolve([global.lists.manager.updatingListsEntry()])
            }
            if(!global.activeLists.length){
                return resolve([global.lists.manager.noListsEntry()])
            }
            this.ready(() => {
                let list = global.deepClone(this.currentEntries, true)
                list = list.map((e, i) => {
                    e.position = (i + 1)
                    return e
                })
                if(!list.length){
                    list = [{name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty'}]
                }
                list = this.prepare(list) 
                global.channels.epgChannelsAddLiveNow(list, false, true).then(resolve).catch(reject)
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
    process(){
        return new Promise((resolve, reject) => {
            global.cloud.get('watching', false).then(data => {
                if(!Array.isArray(data)){
                    data = []
                }
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
                let groups = {}, gcount = {}, gentries = [], onlyKnownChannels = global.config.get('only-known-channels-in-been-watched') && global.config.get('parental-control-policy') != 'only'
                async.eachOf(data, (entry, i, cb) => {
                    let ch = global.channels.isChannel(entry.terms.name)
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
                    cb()
                }, () => {
                    Object.keys(groups).forEach(n => {
                        gentries.push(global.channels.toMetaEntry({
                            name: global.ucWords(n), 
                            type: 'group',
                            fa: 'fas fa-play-circle',
                            users: gcount[n]
                        }))
                    })
                    data = data.filter(e => {
                        return !!e
                    }).concat(gentries).sortByProp('users', true)
                    data = this.applyUsersPercentages(data)
                    this.currentEntries = data
                    resolve(data)
                })
            }).catch(err => {
                console.error(err)
                resolve([])
            })   
        })
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
        const entry = {name: global.lang.TRENDING, details: global.lang.BEEN_WATCHED, fa: 'fas fa-chart-bar', hookId: this.key, type: 'group', renderer: this.entries.bind(this)}
        if(this.currentEntries && this.showChannelOnHome()){
            let top, rootPage = global.explorer.pages['']
            this.currentEntries.some(e => {
                if(!rootPage.some(r => (r.name == e.name && r.hookId != this.key)) && global.channels.isChannel(e.name)){
                    top = e
                    return true
                }
            })
            if(top){
                let s = top.users == 1 ? 'user' : 'users', terms = global.channels.entryTerms(top)
                entry.name = top.name
                entry.servedIcon = global.icons.generate(terms, null)
                entry.details = '<i class="fas fa-'+ s +'"></i> '+ global.lang.X_WATCHING.format(top.users)
                entry.details += ' &middot; '+ global.lang.TRENDING
            }
        }
        return entry
    }
}

module.exports = Watching
