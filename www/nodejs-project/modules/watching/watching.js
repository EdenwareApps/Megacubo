const path = require('path'), async = require('async'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class Watching extends EntriesGroup {
    constructor(){
        super('watching')
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == '' && !entries.some(e => e.name == global.lang.BEEN_WATCHED)) {
                entries.push(this.entry())
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
    entries(e){
        return new Promise((resolve, reject) => {
            if(global.updatingLists){
                return resolve([{
                    name: global.lang.UPDATING_LISTS, 
                    fa: 'fa-mega spin-x-alt',
                    type: 'action',
                    action: () => {
                        global.explorer.refresh()
                    }
                }])
            }
            if(!global.activeLists.length){
                return resolve([global.lists.manager.noListsEntry()])
            }
            this.getWatching(true).then(entries => {
                let list = entries
                list = global.lists.parentalControl.filter(list)
                if(!list.length){
                    list = [{name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty'}]
                }
                list = this.prepare(list)
                resolve(list)
            }).catch(err => {
                reject(err)
            })       
        })
    }
    lists(){
        return new Promise((resolve, reject) => {
            this.getWatching(false).then(es => {
                let lists = {}
                es.forEach(e => {
                    if(e.source){
                        if(typeof(lists[e.source]) == 'undefined'){
                            lists[e.source] = 0
                        }
                        lists[e.source] += parseInt(e.count)
                    }
                })
                lists = Object.keys(lists).sort((a,b) => {
                    return lists[b]-lists[a]
                })
                lists = lists.map(url => {
                    return {name: global.lists.manager.nameFromSourceURL(url), url, type: "group", fa: "fas fa-shopping-bag"}
                })
                resolve(lists)
            }).catch(e => {
                console.error('lists err', e)
            })
        })
    }
    getWatching(removeAliases, softTimeout){
        return new Promise((resolve, reject) => {
            global.cloud.get('watching', false, softTimeout).then(data => {
                if(!Array.isArray(data)){
                    data = []
                }
                let recoverNameFromMegaURL = true, ex = !global.config.get('shared-mode-lists-amount') // we'll make entries URLless for exclusive mode, to use the provided lists only
                data = global.lists.prepareEntries(data)
                data = data.map(e => {
                    if(e && typeof(e) == 'object' && typeof(e.name) == 'string'){
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
                    }
                    return e
                })
                this.watching = data
                if(removeAliases === true){
                    let groups = {}, gcount = {}, gentries = [], onlyKnownChannels = global.config.get('only-known-channels-in-been-watched')
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
                                let e, already = [], megas = [], streams = []
                                gentries.push(global.channels.toMetaEntry({
                                    name: global.ucWords(n), 
                                    type: 'group',
                                    fa: 'fas fa-play-circle',
                                    users: gcount[n]
                                }))
                            })
                            data = data.filter(e => {
                                return !!e
                            }).concat(gentries).sort((a, b) => {
                                return (a.users > b.users) ? -1 : ((b.users > a.users) ? 1 : 0)
                            })
                            if(data.length) {
                                this.data = data
                            }
                            resolve(data)
                        })
                } else {
                    resolve(data)
                }
            }).catch(err => {
                console.error(err)
                this.watching = []
                resolve(this.watching)
            })   
        })
    }
    order(entries){
        return new Promise((resolve, reject) => {
            let up = [], es = entries.slice(0)
            this.getWatching(false, 0).then(ret => {
                ret.forEach((r, i) => {
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
            }).catch(reject)          
        })
    }
    entry(){
        return {name: global.lang.BEEN_WATCHED, fa: 'fas fa-users', hookId: this.key, type: 'group', renderer: this.entries.bind(this)}
    }
}

module.exports = Watching
