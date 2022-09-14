
const EntriesGroup = require('../entries-group')

class Bookmarks extends EntriesGroup {
    constructor(){
        super('bookmarks')
        this.currentBookmarkAddingByName = {
            name: '',
            live: true,
            icon: ''
        }
        this.uiReady(() => {
            global.ui.on('toggle-fav', () => {
                if(this.current()){
                    this.toggle()
                } else {
                    global.explorer.open(global.lang.BOOKMARKS)
                }
            })
            global.streamer.aboutRegisterEntry('addfav', data => {
                if(!data.isLocal && !this.has(this.simplify(data))){
                    return {template: 'option', fa: 'fas fa-star', text: global.lang.ADD_TO.format(global.lang.BOOKMARKS), id: 'addfav'}
                }
            }, this.toggle.bind(this), 3)
            global.streamer.aboutRegisterEntry('remfav', data => {
                if(!data.isLocal && this.has(this.simplify(data))){
                    return {template: 'option', fa: 'fas fa-star-half', text: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS), id: 'remfav'}
                }
            }, this.toggle.bind(this), 3)
        })
    }
    streamFilter(e){
        return e.url && (!e.type || e.type == 'stream')
    }
    groupFilter(e){
        return e.type && e.type == 'group'
    }
    hook(entries, path){
        return new Promise((resolve, reject) => {
            if(path == '' && !entries.some(e => e.name == global.lang.BOOKMARKS)){ // add home option
                entries.push({name: global.lang.BOOKMARKS, fa: 'fas fa-star', type: 'group', renderer: this.entries.bind(this)})
            }
            let isBookmarkable = path.startsWith(global.lang.SERIES) || path.startsWith(global.lang.MOVIES) || path.startsWith(global.lang.LIVE +'/'+ global.lang.MORE) || path.startsWith(global.lang.BOOKMARKS)
            if(!isBookmarkable && (path.startsWith(global.lang.IPTV_LISTS) || path.startsWith(global.lang.TRENDING)) && !entries.some(this.groupFilter)){
                isBookmarkable = true
            }
            if(isBookmarkable && entries.some(this.streamFilter)){
                let name = path.split('/').pop(), ges = entries.filter(e => e.url)
                if(ges.length){
                    let gs = [...new Set(ges.map(e => e.groupName))]
                    if(gs.length == 1 && gs[0]){
                        name = gs[0]
                    }
                }
                ges = null
                let bookmarker, bookmarkable = {name, type: 'group', entries: entries.filter(this.streamFilter)}
                console.log('bookmarkable', bookmarkable)
                if(this.has(bookmarkable)){
                    bookmarker = {
                        type: 'action',
                        fa: 'fas fa-star-half',
                        name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                        action: () => {
                            this.remove(bookmarkable)
                            global.explorer.refresh()
                            global.osd.show(global.lang.BOOKMARK_REMOVED.format(bookmarkable.name), 'fas fa-star-half', 'bookmarks', 'normal')
                        }
                    }
                } else if(path.indexOf(global.lang.BOOKMARKS) == -1) {
                    bookmarker = {
                        type: 'action',
                        fa: 'fas fa-star',
                        name: global.lang.ADD_TO.format(global.lang.BOOKMARKS),
                        action: () => {
                            this.add(bookmarkable)
                            global.explorer.refresh()
                            global.osd.show(global.lang.BOOKMARK_ADDED.format(bookmarkable.name), 'fas fa-star', 'bookmarks', 'normal')
                        }
                    }
                } 
                if(bookmarker) entries.unshift(bookmarker)
            }
            resolve(entries)
        })
    }
    toggle(){
        let data = this.current()
        if(data){
            if(this.has(data)){
                this.remove(data)
                global.osd.show(global.lang.BOOKMARK_REMOVED.format(data.name), 'fas fa-star-half', 'bookmarks', 'normal')
            } else {
                this.add(data)
                global.osd.show(global.lang.BOOKMARK_ADDED.format(data.name), 'fas fa-star', 'bookmarks', 'normal')
            }
            global.explorer.refresh()
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
        if(e.type == 'group'){
            return this.cleanAtts(e)
        }
        return {name: e.originalName || e.name, type: 'stream', details: e.group || '', icon: e.originalIcon || e.icon || '', terms: {'name': global.channels.entryTerms(e)}, url: e.originalUrl || e.url}
    }
    search(terms){
        return new Promise((resolve, reject) => {
            if(typeof(terms) == 'string'){
                terms = global.lists.terms(terms)
            }
            this.get().forEach(e => {
                
            })
        })
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
            if(current && !this.has(current)){
                es.push({name: global.lang.ADD + ': ' + current.name, fa: 'fas fa-star', icon: current.icon, type: 'action', action: () => {
                    this.add(current)
                    global.explorer.refresh()
                }})
            }
            es.push({name: global.lang.ADD_BY_NAME, fa: 'fas fa-star', type: 'group', renderer: this.addByNameEntries.bind(this)})
            const epgAddLiveNowMap = {}
            let gentries = this.get().map((e, i) => {
                const isMega = e.url && global.mega.isMega(e.url)
                e.fa = 'fas fa-star'
                e.details = '<i class="fas fa-star"></i> ' + e.bookmarkId
                if(isMega){
                    let atts = global.mega.parse(e.url)
                    if(atts.mediaType == 'live'){
                        return (epgAddLiveNowMap[i] = global.channels.toMetaEntry(e, false))
                    } else {
                        let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : global.lists.terms(atts.name, true)
                        e.url = global.mega.build(global.ucWords(terms.join(' ')), {terms, mediaType: 'video'})
                        e = global.channels.toMetaEntry(e)
                    }
                } else if(e.type != 'group'){
                    e.type = 'stream'
                }
                return e
            })
            global.channels.epgChannelsAddLiveNow(Object.values(epgAddLiveNowMap), false).then(entries => {
                const ks = Object.keys(epgAddLiveNowMap)
                entries.forEach((e, i) => {
                    gentries[ks[i]] = e
                })
            }).catch(console.error).finally(() => {
                es = es.concat(gentries)
                if(this.get().length){
                    es.push({name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.removalEntries.bind(this)})
                }
                resolve(es)
            })
        })
    }
    addByNameEntries(){
        return new Promise((resolve, reject) => {
            resolve([
                {name: global.lang.CHANNEL_OR_CONTENT_NAME, type: 'input', value: this.currentBookmarkAddingByName.name, action: (data, value) => {
                    this.currentBookmarkAddingByName.name = value
                }},
                {name: global.lang.ADVANCED, type: 'select', fa: 'fas fa-cog', entries: [
                    {name: global.lang.STREAM_URL, type: 'input', value: this.currentBookmarkAddingByName.url, details: global.lang.LEAVE_EMPTY, placeholder: global.lang.LEAVE_EMPTY, action: (data, value) => {
                        this.currentBookmarkAddingByName.url = value
                    }},
                    {name: global.lang.ICON_URL, type: 'input', value: this.currentBookmarkAddingByName.icon, details: global.lang.LEAVE_EMPTY, placeholder: global.lang.LEAVE_EMPTY, action: (data, value) => {
                        this.currentBookmarkAddingByName.icon = value
                    }}
                ]},
                {name: global.lang.LIVE, type: 'check', checked: () => {
                    return this.currentBookmarkAddingByName.live
                }, action: (e, value) => {
                    this.currentBookmarkAddingByName.live = value
                }},
                {name: global.lang.SAVE, fa: 'fas fa-check-circle', type: 'group', renderer: this.addByNameEntries2.bind(this)}
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
                partial: true,
                group: !this.currentBookmarkAddingByName.live,
                safe: !global.lists.parentalControl.lazyAuth(),
                limit: 1024
            }).then(results => {                
                if(!this.currentBookmarkAddingByName.url || this.currentBookmarkAddingByName.url.indexOf('/') == -1){
                    let mediaType = 'all', entries = []
                    if(this.currentBookmarkAddingByName.live){
                        mediaType = 'live'
                    } else {
                        mediaType = 'video'
                    }
                    this.currentBookmarkAddingByName.url = global.mega.build(this.currentBookmarkAddingByName.name, {mediaType})
                }
                if(global.config.get('show-logos') && (!this.currentBookmarkAddingByName.icon || this.currentBookmarkAddingByName.icon.indexOf('/') == -1)){
                    let entries = []
                    Array.from(new Set(results.results.map(entry => { return entry.icon }))).slice(0, 96).forEach((logoUrl) => {
                        entries.push({
                            name: global.lang.SELECT_ICON,
                            fa: 'fa-mega spin-x-alt',
                            icon: logoUrl,
                            url: logoUrl,
                            value: logoUrl,
                            type: 'action',
                            action: this.addByNameEntries3.bind(this)
                        })
                    })
                    if(entries.length){
                        entries.push({
                            name: global.lang.NO_ICON,
                            type: 'action',
                            fa: 'fas fa-ban',
                            url: '',
                            action: () => {
                                this.addByNameEntries3({value: ''})
                            }
                        })
                        resolve(entries)
                    } else {
                        resolve([])
                        this.addByNameEntries3({value: this.currentBookmarkAddingByName.icon}, 1)
                    }
                } else {
                    resolve([])
                    this.addByNameEntries3({value: this.currentBookmarkAddingByName.icon}, 1)
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
        this.currentBookmarkAddingByName = {
            name: '',
            live: true,
            icon: ''
        }
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
                        action: data => {
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
        return entries.slice(0).sortByProp('bookmarkId')
    }
}

module.exports = Bookmarks
