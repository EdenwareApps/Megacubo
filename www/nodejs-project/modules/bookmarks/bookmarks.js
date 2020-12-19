
const path = require('path'), EntriesGroup = require(path.resolve(__dirname, '../entries-group'))

class Bookmarks extends EntriesGroup {
    constructor(){
        super('bookmarks')
        this.currentBookmarkAddingByName = {
            name: '',
            live: true,
            icon: ''
        }
        global.ui.on('toggle-fav', () => {
            if(this.current()){
                this.toggle()
            } else {
                global.explorer.open(global.lang.BOOKMARKS)
            }
        })
        global.streamer.aboutDialogRegisterOption('addfav', data => {
            if(!this.has(data)){
                return {template: 'option', fa: 'fas fa-star', text: global.lang.ADD_TO.format(global.lang.BOOKMARKS), id: 'addfav'}
            }
        }, this.toggle.bind(this))
        global.streamer.aboutDialogRegisterOption('remfav', data => {
            if(this.has(data)){
                return {template: 'option', fa: 'fas fa-star-half', text: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS), id: 'remfav'}
            }
        }, this.toggle.bind(this))
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == '' && !entries.some(e => e.name == global.lang.BOOKMARKS)){
                entries.push({name: global.lang.BOOKMARKS, fa: 'fas fa-star', type: 'group', renderer: this.entries.bind(this)})
            }
            resolve(entries)
        })
    }
    toggle(){
        let data = this.current()
        if(data){
            if(this.has(data)){
                this.remove(data)
                global.osd.show(global.lang.FAV_REMOVED.format(data.name), 'fas fa-star-half', 'bookmarks', 'normal')
            } else {
                this.add(data)
                global.osd.show(global.lang.FAV_ADDED.format(data.name), 'fas fa-star', 'bookmarks', 'normal')
            }
        }
    }
    current(){
        if(global.streamer.active){
            return this.simplify(global.streamer.active.data)
        } else {
            let streams = global.explorer.currentEntries.filter(e => e.url)
            if(streams.length){
                return this.simplify(streams[0])
            }
        }
    }
    simplify(e){
        return {name: e.name, type: 'stream', details: e.group || '', terms: {'name': global.channels.entryTerms(e)}, url: e.url}
    }
    entries(e){
        return new Promise((resolve, reject) => {
            let es = [], current
            if(global.streamer && global.streamer.active){
                current = global.streamer.active.data
            }
            if(!current && global.histo){
                let cs = global.histo.get().filter(c => {
                    return !this.has(c)
                })
                if(cs.length){
                    current = cs.shift()
                }
            }
            if(current){
                es.push({name: global.lang.ADD + ': ' + current.name, fa: 'fas fa-star', icon: current.icon, type: 'action', action: () => {
                    this.add(current)
                    global.explorer.refresh()
                }})
            }
            es.push({name: global.lang.ADD_BY_NAME, fa: 'fas fa-star', type: 'group', renderer: this.addByNameEntries.bind(this)})
            es = es.concat(this.get().map((e, i) => {
                const isMega = global.mega.isMega(e.url)
                e.fa = 'fas fa-star'
                e.details = '<i class="fas fa-star"></i> ' + e.bookmarkId
                if(isMega){
                    let atts = global.mega.parse(e.url)
                    if(atts.mediaType == 'live'){
                        return global.channels.toMetaEntry(e, false)
                    } else {
                        e.type = 'group'
                        e.renderer = () => {
                            return new Promise((resolve, reject) => {
                                let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : global.lists.terms(atts.name, true)
                                global.lists.search(terms, {type: 'video'}).then(es => {
                                    resolve(es.results)
                                }).catch(reject)
                            })
                        }
                    }
                } else {
                    e.type = 'stream'
                }
                return e
            }))
            if(this.get().length){
                es.push({name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.removalEntries.bind(this)})
            }
            resolve(es)
        })
    }
    addByNameEntries(){
        return new Promise((resolve, reject) => {
            resolve([
                {name: global.lang.CHANNEL_OR_CONTENT_NAME, type: 'input', value: this.currentBookmarkAddingByName.name, details: global.lang.CHANNEL_OR_CONTENT_NAME, action: (data, value) => {
                    this.currentBookmarkAddingByName['name'] = value
                }},
                {name: global.lang.LIVE, type: 'check', checked: () => {
                    return this.currentBookmarkAddingByName.live
                }, action: (e, value) => {
                    this.currentBookmarkAddingByName.live = value
                }},
                {name: global.lang.SAVE, fa: 'fas fa-save', type: 'group', renderer: this.addByNameEntries2.bind(this)}
            ])
        })
    }
    addByNameEntries2(){
        return new Promise((resolve, reject) => {
            if(!this.currentBookmarkAddingByName.name){
                resolve([])
                return setTimeout(() => {
                    global.explorer.back(2)
                }, 50)
            }
            global.lists.search(this.currentBookmarkAddingByName.name, {
                partial: true
            }).then(results => {
                let mediaType = 'all', entries = []
                if(this.currentBookmarkAddingByName.live){
                    mediaType = 'live'
                } else {
                    mediaType = 'video'
                }
                this.currentBookmarkAddingByName.url = global.mega.build(this.currentBookmarkAddingByName.name, {mediaType})
                if(global.config.get('show-logos')){
                    Array.from(new Set(results.results.map(entry => { return entry.icon }))).slice(0, 96).forEach((logoUrl) => {
                        entries.push({
                            name: global.lang.SELECT_ICON,
                            fa: 'fas fa-play',
                            icon: logoUrl,
                            url: logoUrl,
                            value: logoUrl,
                            type: 'action',
                            action: this.addByNameEntries3.bind(this)
                        })
                    })
                    entries.push({
                        name: global.lang.SELECT_ICON,
                        type: 'action',
                        fa: 'fas fa-play',
                        url: '',
                        action: () => {
                            this.addByNameEntries3({value: ''})
                        }
                    })
                    resolve(entries)
                } else {
                    this.addByNameEntries3({value: ''}, 1)
                }
            })
        })
    }
    addByNameEntries3(e, n){
        let backLvl = 2
        if(typeof(n) == 'number'){
            backLvl = n
        }
        console.warn('ZAZZ', e, this.currentBookmarkAddingByName, backLvl)
        this.currentBookmarkAddingByName.icon = e.value
        this.add({
            name: this.currentBookmarkAddingByName.name,
            icon: this.currentBookmarkAddingByName.icon,
            url: this.currentBookmarkAddingByName.url
        })
        global.explorer.back(backLvl)
    }
    removalEntries(){
        return new Promise((resolve, reject) => {
            let entries = []
            this.get().forEach(e => {
                if(e.name){
                    entries.push({
                        name: global.lang.REMOVE + ': ' + e.name, 
                        fa: 'fas fa-trash',
                        type: 'action',
                        action: (data) => {
                            this.remove(e)
                            if(this.get().length){
                                global.explorer.refresh()
                            } else {
                                global.explorer.back()
                            }
                        }
                    })
                }
            })            
            if(!entries.length){
                entries = []
            }
            resolve(entries)
        })
    }
    prepare(_entries){
        var knownBMIDs = [], entries = _entries.slice(0)
        entries.forEach((bm, i) => {
            if(typeof(bm.bookmarkId) == 'string'){
                bm.bookmarkId = parseInt(bm.bookmarkId)
            }
            if(typeof(bm.bookmarkId) != 'undefined'){
                knownBMIDs.push(bm.bookmarkId)
            }
        })
        entries.forEach((bm, i) => {
            if(typeof(bm.bookmarkId) == 'undefined'){
                var j = 1
                while(knownBMIDs.indexOf(j) != -1){
                    j++;
                }
                knownBMIDs.push(j)
                entries[i].bookmarkId = j
            }
        })
        return entries.sort((a, b) => {
            if (a.bookmarkId < b.bookmarkId){
                return -1;
            }
            if (a.bookmarkId > b.bookmarkId){
                return 1;
            }
            return 0;
        }).slice(0)
    }
}

module.exports = Bookmarks
