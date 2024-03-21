
const EntriesGroup = require('../entries-group')

class Bookmarks extends EntriesGroup {
    constructor(){
        super('bookmarks')
        this.storeInConfig = true
        this.currentBookmarkAddingByName = {
            name: '',
            live: true,
            icon: ''
        }
        this.uiReady(() => {
            global.renderer.on('toggle-fav', () => {
                if(this.current()){
                    this.toggle()
                } else {
                    global.menu.open(global.lang.BOOKMARKS).catch(displayErr)
                }
            })
            const streamer = require('../streamer/main')
            streamer.aboutRegisterEntry('fav', data => {
                if(!data.isLocal){
                    if(this.has(this.simplify(data))){
                        return {template: 'option', fa: 'fas fa-star-half', text: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS), id: 'fav'}
                    } else {
                        return {template: 'option', fa: 'fas fa-star', text: global.lang.ADD_TO.format(global.lang.BOOKMARKS), id: 'fav'}
                    }
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
        if(!path) {
            const options = require('../options')
            const bmEntry = {name: global.lang.BOOKMARKS, fa: 'fas fa-star', top: true, type: 'group', renderer: this.entries.bind(this)}
            if(this.data.length) bmEntry.details = this.data.map(e => e.name).unique().slice(0, 3).join(', ') +'...'
            options.insertEntry(bmEntry, entries, -3, global.lang.OPTIONS, global.lang.OPEN_URL)
            return entries
        }
        let isBookmarkable = path.startsWith(global.lang.CATEGORY_MOVIES_SERIES) || path.startsWith(global.lang.SEARCH) || path.startsWith(global.lang.LIVE +'/'+ global.lang.MORE) || path.startsWith(global.lang.BOOKMARKS)
        if(!isBookmarkable && path.startsWith(global.lang.MY_LISTS) && !entries.some(this.groupFilter)){
            isBookmarkable = true
        }
        if(isBookmarkable && entries.some(this.streamFilter)){
            let name = path.split('/').pop(), ges = entries.filter(e => e.url)
            if(ges.length){
                let gs = ges.map(e => e.groupName).unique()
                if(gs.length == 1 && gs[0]){
                    name = gs[0]
                }
            }
            ges = null
            let bookmarker, bookmarkable = {name, type: 'group', entries: entries.filter(this.streamFilter)}
            if(this.has(bookmarkable)){
                bookmarker = {
                    type: 'action',
                    fa: 'fas fa-star-half',
                    name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                    action: () => {
                        this.remove(bookmarkable)
                        global.menu.refreshNow()
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
                        global.menu.refreshNow()
                        global.osd.show(global.lang.BOOKMARK_ADDED.format(bookmarkable.name), 'fas fa-star', 'bookmarks', 'normal')
                    }
                }
            } 
            if(bookmarker) entries.unshift(bookmarker)
        }
        return entries
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
            global.menu.refreshNow()
        }
    }
    current(){
        const streamer = require('../streamer/main')
        if(streamer.active){
            return this.simplify(streamer.active.data)
        } else {
            let streams = global.menu.currentEntries.filter(e => e.url)
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
                const lists = require('../lists')
                terms = lists.terms(terms)
            }
            this.get().forEach(e => {
                
            })
        })
    }
    async entries(){
        const streamer = require('../streamer/main')
        let es = [], current
        if(streamer && streamer.active){
            current = streamer.active.data
        }
        if(!current){
            const history = require('../history')
            let cs = history.get().filter(c => {
                return !this.has(c)
            })
            if(cs.length){
                current = cs.shift()
            }
        }
        if(current && !this.has(current)){
            es.push({name: global.lang.ADD + ': ' + current.name, fa: 'fas fa-star', icon: current.icon, type: 'action', action: () => {
                this.add(current)
                global.menu.refreshNow()
            }})
        }
        es.push({name: global.lang.ADD_BY_NAME, fa: 'fas fa-star', type: 'group', renderer: this.addByNameEntries.bind(this)})
        const epgAddLiveNowMap = {}
        let gentries = this.get().map((e, i) => {
            const mega = require('../mega')
            const isMega = e.url && mega.isMega(e.url)
            e.fa = 'fas fa-star'
            e.details = '<i class="fas fa-star"></i> ' + e.bookmarkId
            if(isMega){
                let atts = mega.parse(e.url)
                if(atts.mediaType == 'live'){
                    return (epgAddLiveNowMap[i] = global.channels.toMetaEntry(e, false))
                } else {
                    const lists = require('../lists')
                    let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : lists.terms(atts.name)
                    e.url = mega.build(global.ucWords(terms.join(' ')), {terms, mediaType: 'video'})
                    e = global.channels.toMetaEntry(e)
                }
            } else if(e.type != 'group'){
                e.type = 'stream'
            }
            return e
        })
        let err
        const entries = await global.channels.epgChannelsAddLiveNow(Object.values(epgAddLiveNowMap), false).catch(e => err = e)
        if(!err) {
            const ks = Object.keys(epgAddLiveNowMap)
            entries.forEach((e, i) => {
                gentries[ks[i]] = e
            })
        }
        es.push(...gentries)
        if(gentries.length){
            if(!global.paths.cordova && global.config.get('bookmarks-desktop-icons')) {
                es.push({name: global.lang.BOOKMARK_ICONS_SYNC, fa: 'fas fa-sync-alt', type: 'action', action: () => this.desktopIconsSync().catch(console.error)})
            }
            es.push({name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'group', renderer: this.removalEntries.bind(this)})
        }
        return es
    }
    async addByNameEntries(){
        return [
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
        ]
    }
    addByNameEntries2(){
        return new Promise((resolve, reject) => {
            if(!this.currentBookmarkAddingByName.name){
                resolve([])
                return setTimeout(() => {
                    global.menu.back(2)
                }, 50)
            }
            const lists = require('../lists')
            lists.search(this.currentBookmarkAddingByName.name, {
                partial: true,
                group: !this.currentBookmarkAddingByName.live,
                safe: !lists.parentalControl.lazyAuth(),
                limit: 1024
            }).then(results => {                
                if(!this.currentBookmarkAddingByName.url || this.currentBookmarkAddingByName.url.indexOf('/') == -1){
                    let mediaType = 'all', entries = []
                    if(this.currentBookmarkAddingByName.live){
                        mediaType = 'live'
                    } else {
                        mediaType = 'video'
                    }
                    this.currentBookmarkAddingByName.url = mega.build(this.currentBookmarkAddingByName.name, {mediaType})
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
        let backLvl = typeof(n) == 'number' ? n : 2
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
        global.menu.back(backLvl)
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
    async desktopIconsSync() {
        global.osd.show(global.lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'bookmarks-desktop-icons', 'persistent')
        for(const e of this.get()) {
            await this.createDesktopShortcut(e).catch(console.error)
        }
        global.osd.show('OK', 'fas fa-check-circle faclr-green', 'bookmarks-desktop-icons', 'normal')
    }
    getWindowsDesktop() {
        return new Promise((resolve, reject) => {
            const fs = require('fs'), iconv = require('iconv-lite')
            const { exec } = require('child_process')

            const command = 'REG QUERY "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders" /v Desktop'
            const child = exec(command, { encoding: 'buffer' }, (error, stdout, stderr) => {
                if (error) {
                    return reject('Error querying registry:' + error)
                }
                const output = iconv.decode(stdout, 'cp850') // 'cp850' is the default command prompt encoding
                const outputLines = output.split('\n')
                const desktopDirLine = outputLines.find(line => line.includes('REG_SZ'))
                if (!desktopDirLine) return reject('Folder not found')

                const desktopDir = desktopDirLine.match(new RegExp('REG_SZ +(.*)'))
                const desktopPath = desktopDir ? desktopDir[1] : null
                if (!desktopPath) return reject('Folder not found')
                if (!fs.existsSync(desktopPath)) return reject('Folder not exists: ' + desktopPath)
                resolve(desktopPath)
            })
            child.stdout.setEncoding('binary')
            child.stderr.setEncoding('binary')
        })
    }
    async createDesktopShortcut(entry) {
        if(global.paths.cordova || !global.config.get('bookmarks-desktop-icons')) return
        let outputPath, icon = global.paths.cwd +'/default_icon.png'
        if(process.platform == 'win32') {
            const folder = await this.getWindowsDesktop().catch(console.error)
            if(typeof(folder) == 'string') {
                outputPath = folder
            }
            icon = global.paths.cwd +'/default_icon.ico'
        }
        let err, noEPGEntry = entry
        if(noEPGEntry.programme) delete noEPGEntry.programme
        const icons = require('../icon-server')
        const nicon = await icons.get(noEPGEntry).catch(e => err = e)
        if(!err) {
            if(!nicon.file) {
                const fs = require('fs')
                const file = await global.Download.file({url: nicon.url})
                const stat = await fs.promises.stat(file).catch(e => err = e)
                if(!err && stat.size >= 512) {
                    nicon.file = file
                }
            }
            if(nicon.file) {
                const jimp = require('../jimp-worker/main')
                const file = await jimp.iconize(nicon.file).catch(e => err = e)
                if(!err) {
                    icon = file
                    const cachedFile = await icons.saveDefaultIcon(entry.name, file).catch(e => err = e)
                    if(!err && cachedFile) {
                        icon = cachedFile
                    }
                }
            }
        }
        const values = {
            name: entry.name,
            filePath: process.execPath,
            arguments: '"'+ entry.url +'"',
            icon,
            outputPath
        }
        const options = {
            windows: values,
            linux: values,
            osx: values
        }
        if(!this.createShortcut) {
            this.createShortcut = require('create-desktop-shortcuts')
        }
        this.createShortcut(options)
    }
    add(entry) {
        super.add(entry)
        this.createDesktopShortcut(entry).catch(console.error)
        global.updateUserTasks().catch(console.error)
    }
}

module.exports = new Bookmarks()
