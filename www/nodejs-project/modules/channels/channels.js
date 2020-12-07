
const path = require('path'), fs = require('fs'), Events = require('events'), async = require('async')

class ChannelsData extends Events {
    constructor(opts){
        super()
        this.emptyEntry = {name: global.lang.EMPTY, type: 'action', fa: 'fas fa-info-circle', class: 'entry-empty'}
        this.categories = []
		global.config.on('change', (key, data) => {
            console.warn('CONFIG CHANGED', key)
            if(['parental-control-policy', 'parental-control-terms'].indexOf(key) != -1){
                this.setup()
            }
        })
        this.setup()
    }
    setup(cb){
        const adult = global.config.get('parental-control-policy') == 'only'
        this.categoriesCacheKey = 'categories-' + global.lang.locale
        if(adult){
            this.categoriesCacheKey += '-adult'
        }
        global.rstorage.get(this.categoriesCacheKey, data => {
            if(data){
                this.channelsIndex = null
                this.categories = JSON.parse(data)
                if(typeof(cb) == 'function'){
                    cb()
                }
            } else {
                const next = () => {
                    this.categories = []
                    if(typeof(cb) == 'function'){
                        cb()
                    }
                }
                if(adult){
                    next()
                } else {
                    global.cloud.get('categories').then(data => {
                        this.channelsIndex = null
                        this.categories = this.compact(data)
                        this.save(cb)
                    }).catch(next)
                }
            }
        })
    }
    getCategories(compact){
        return compact ? this.categories : this.expand(this.categories)
    }
    setCategories(data){
        this.categories = data
        this.channelsIndex = null
        this.save(() => {
            console.log('Categories file imported')
            global.osd.show(global.lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal')
        })
    }
    compactName(name, terms){
        if(terms && terms.length > 1 && terms != name){
            name += ', ' + (typeof(terms) == 'string' ? terms : terms.join(' '))
        }
        return name
    }
    expandName(name){
        let terms
        if(name.indexOf(',') != -1){
            terms = name.split(',').map(s => s = s.trim())
            name = terms.shift()
            if(!terms.length){
                terms = name
            } else {
                terms = terms.join(' ')
            }
        } else {
            terms = name
        }
        terms = global.lists.terms(terms, true)
        return {name, terms: {name: terms, group: []}}
    }
    compact(data, withTerms){
        let ret = {}
        data.forEach(c => {
            ret[c.name] = c.entries.map(e => {
                return this.compactName(e.name, withTerms ? e.terms : false)
            })
        })
        return ret
    }
    expand(data){
        return Object.keys(data).map(name => {
            return {
                name, 
                type: 'group', 
                group: name,
                entries: data[name].map(name => {
                    return Object.assign(this.expandName(name), {type: 'option'})
                })
            }
        })
    }
    save(cb){
        let ordering = {}
        Object.keys(this.categories).sort().forEach(k => ordering[k] = this.categories[k])
        this.categories = ordering
        global.rstorage.set(this.categoriesCacheKey, JSON.stringify(this.categories, null, 3), true, cb)
    }
}

class ChannelsEPG extends ChannelsData {
    constructor(opts){
        super(opts)
        this.epgStatusTimer = false
        this.epgIcon = 'fas fa-th'
        this.clockIcon = '<i class="fas fa-clock"></i> '
    }
    epgEntry(e, name){
        return {
            name: global.lang.EPG,
            type: 'group',
            fa: this.epgIcon,
            renderer: () => {
                return new Promise((resolve, reject) => {
                    global.lists.epg(e, 12).then(epgData => {
                        let pentries = []
                        if(epgData){
                            Object.keys(epgData).some(start => {
                                pentries.push({
                                    name: epgData[start].t,
                                    details: '<i class="fas fa-clock"></i> ' + global.ts2clock(start) + ' - ' + global.ts2clock(epgData[start].e),
                                    type: 'action',
                                    fa: 'fas fa-play-circle',
                                    icon: e.icon,
                                    servedIcon: e.servedIcon,
                                    action: () => {}
                                })
                            })
                        } else {
                            pentries.push({name: global.lang.EPG_NOT_AVAILABLE, fa: 'fas fa-info-circle', type: 'action'})
                        }
                        resolve(pentries)
                    })
                })
            }
        }
    }
    clock(start, data, includeEnd){
        let t = this.clockIcon
        t += global.ts2clock(start)
        if(includeEnd){
            t += ' - ' + global.ts2clock(data.e)
        }
        return t
    }
    epgLoadingEntry(epgStatus){
        let details = ''
        switch(epgStatus[0]){
            case 'uninitialized':
                details = '<i class="fas fa-clock"></i>'
                break
            case 'loading':
                details = global.lang.LOADING
                break
            case 'connecting':
                details = global.lang.CONNECTING
                break
            case 'connected':
                details = global.lang.PROCESSING + ' ' + epgStatus[1] + '%'
                break
            case 'loaded':
                details = 'OK'
                break
            case 'error':
                details = 'Error: ' + epgStatus[1]
                break
        }
        return {
            name: ['connected'].includes(epgStatus[0]) ? global.lang.EPG_AVAILABLE_SOON : global.lang.EPG_NOT_AVAILABLE, 
            details, 
            fa: 'fas fa-info-circle', 
            type: 'action'
        }
    }
    updateStatus(){
        let p = global.explorer.path
        if(p.indexOf(global.lang.EPG) == -1){
            clearInterval(this.epgStatusTimer)
            this.epgStatusTimer = false
        } else {
            this.epgEntries(this.currentCategory).then(es => {
                global.explorer.render(es, p, this.epgIcon)
            }).catch(global.displayErr)
        }
    }
    epgSearchEntry(){
        return {
            name: global.lang.SEARCH,
            type: 'input',
            fa: 'fas fa-search',
            action: (e, value) => {
                if(value){
                    global.lists.epgSearch(global.lists.terms(value, true)).then(epgData => {                                
                        let entries = []
                        console.warn('epgSearch', epgData)
                        Object.keys(epgData).forEach(ch => {
                            let terms = global.lists.terms(ch), servedIcon = global.icons.generate(terms)
                            entries = entries.concat(this.epgDataToEntries(epgData[ch], ch, terms, servedIcon))
                        })
                        entries.unshift(this.epgSearchEntry())
                        let path = global.explorer.path.split('/').filter(s => s != global.lang.SEARCH).join('/')
                        global.explorer.render(entries, path + '/' + global.lang.SEARCH, 'fas fa-search', path)
                    }).catch(global.displayErr)
                }
            },
            value: () => {
                return ''
            },
            placeholder: global.lang.SEARCH_PLACEHOLDER
        }
    }
    epgEntries(category){
        if(this.currentCategory != category){
            this.currentCategory = category
        }
        return new Promise((resolve, reject) => {
            let terms = {}, channels = category.entries.map(e => {
                let data = this.isChannel(e.name)
                if(data){
                    terms[e.name] = e.terms.name
                    return e
                }
            }).filter(e => e)
            global.lists.epg(channels, 72).then(epgData => {
                let centries = []
                if(Array.isArray(epgData)){
                    if(!this.epgStatusTimer){
                        this.epgStatusTimer = setInterval(this.updateStatus.bind(this), 3000)
                    }
                    centries.push(this.epgLoadingEntry(epgData))
                } else {
                    if(this.epgStatusTimer){
                        clearInterval(this.epgStatusTimer)
                        this.epgStatusTimer = false
                    }
                    centries.push(this.epgSearchEntry())
                    Object.keys(epgData).forEach((ch, i) => {
                        if(!epgData[ch]) return
                        console.log('epge', ch, terms[ch])
                        let current, next, servedIcon = global.icons.generate(terms[ch])
                        Object.keys(epgData[ch]).some(start => {
                            if(!current){
                                current = epgData[ch][start]
                                current.start = start
                            } else {
                                if(!next) {
                                    next = epgData[ch][start]
                                    next.start = start
                                }
                                return true
                            }
                        })
                        if(current){                         
                            centries.push({
                                name: current.t,
                                details: ch,
                                type: 'group',
                                fa: 'fas fa-play-circle',
                                servedIcon,
                                renderer: () => {
                                    return new Promise((resolve, reject) => {
                                        resolve(this.epgDataToEntries(epgData[ch], ch, terms[ch], servedIcon))
                                    })
                                }
                            })
                        }
                    })
                    if(!centries.length){
                        centries.push({name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action'})
                    }
                }
                resolve(centries)
            }).catch(reject)
        })
    }
    epgDataToEntries(epgData, ch, terms, servedIcon){
        console.warn('epgDataToEntries', epgData, ch, terms, servedIcon)
        return Object.keys(epgData).map((start, i) => {
            return {
                name: epgData[start].t,
                details: ch + ' | ' + (i ? this.clock(start, epgData[start]) : global.lang.LIVE),
                type: 'action',
                fa: 'fas fa-play-circle',
                servedIcon,
                program: {start, ch},
                action: this.epgProgramAction.bind(this, start, ch, epgData[start], terms, servedIcon)
            }
        })
    }
    epgChannelEntries(e){
        return new Promise((resolve, reject) => {
            let terms = this.entryTerms(e), name = e.name
            console.log('epgChannelEntries', name, terms)
            global.lists.epg({name, terms}, 72).then(epgData => {
                let centries = []
                if(epgData){
                    if(typeof(epgData[0]) == 'string'){
                        if(!this.epgStatusTimer){
                            this.epgStatusTimer = setInterval(this.updateStatus.bind(this), 3000)
                        }
                        centries.push(this.epgLoadingEntry(epgData))
                    } else {
                        if(this.epgStatusTimer){
                            clearInterval(this.epgStatusTimer)
                            this.epgStatusTimer = false
                        }
                        console.log('epge', name, terms)
                        let current, next, servedIcon = global.icons.generate(terms)
                        Object.keys(epgData).some(start => {
                            if(!current){
                                current = epgData[start]
                                current.start = start
                            } else {
                                if(!next) {
                                    next = epgData[start]
                                    next.start = start
                                }
                                return true
                            }
                        })
                        if(current){
                            centries = this.epgDataToEntries(epgData, name, terms, servedIcon)
                        }
                    }
                }
                if(!centries.length){
                    centries.push({name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action'})
                }
                resolve(centries)
            }).catch(reject)
        })
    }
    epgProgramAction(start, ch, program, terms, servedIcon){
        let url = global.mega.build(ch, {terms})
        global.streamer.play({
            name: ch,
            type: 'stream', 
            fa: 'fas fa-play-circle',
            icon: servedIcon, 
            url,
            terms: {name: terms, group: []}
        })
    }
}

class ChannelsEditing extends ChannelsEPG {
    constructor(opts){
        super(opts)
        global.ui.on('channels-import-file', this.importFile.bind(this))
    } 
    shareChannelEntry(e){
        return {
            name: global.lang.SHARE,
            type: 'action',
            fa: 'fas fa-share-alt',
            action: () => {
                ui.emit('share', 'Megacubo', e.name, 'https://megacubo.tv/assistir/' + encodeURIComponent(e.name))
            }
        }
    }
    editChannelEntry(o, category, atts){ // category name
        let e = Object.assign({}, o), terms = this.entryTerms(o)
        Object.assign(e, {icon: global.icons.generate(terms, o.icon), fa: 'fas fa-play-circle', type: 'group'})
        Object.assign(e, atts)
        e.renderer = () => {
            return new Promise((resolve, reject) => {
                let entries = []
                if(global.config.get('show-logos')){
                    entries.push({name: global.lang.SELECT_ICON, type: 'group', servedIcon: global.icons.generate(terms, o.icon), renderer: () => {
                        console.warn('render icons', terms)
                        return new Promise((resolve, reject) => {
                            let images = []
                            global.icons.search(terms).then(srcs => {
                                console.warn('render icons', srcs, terms)
                                images = images.concat(srcs)
                            }).catch(console.error).finally(() => {
                                let ret = images.map((image, i) => {
                                    return {
                                        name: String(i + 1) + String.fromCharCode(186),
                                        type: 'action',
                                        icon: image,
                                        fa: 'fas fa-play-circle',
                                        servedIcon: global.icons.proxify(image),
                                        action: () => {
                                            console.log(image)
                                            global.icons.fetchURL(image).then(content => {
                                                global.icons.saveCache(terms, content, () => {
                                                    console.log('icon changed', terms, content)
                                                    global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                                    global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                                })
                                            }).catch(console.error)
                                        }
                                    }
                                })
                                ret.push({name: global.lang.OPEN_URL, type: 'input', fa: 'fas fa-link', action: (err, val) => {   
                                    console.log('from-url', terms, '') 
                                    global.icons.fetchURL(val).then(content => {
                                        global.icons.saveCache(terms, content, () => {
                                            global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                            global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                        })
                                    }).catch(console.error)
                                }})
                                ret.push({name: global.lang.NO_ICON, type: 'action', fa: 'fas fa-play-circle', action: () => {   
                                    console.log('savecache', terms, '') 
                                    global.icons.saveCache(terms, 'no-icon', () => {
                                        global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                        global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                    })
                                }})
                                console.warn('icons ret', ret)
                                resolve(ret)
                            })
                        })
                    }})                    
                }
                if(category){
                    entries = entries.concat([
                        {name: global.lang.RENAME, type: 'input', value: o.name, action: (data, val) => {
                            console.warn('RENAME', o.name, 'TO', val)
                            if(val && val != o.name){
                                let i = -1
                                this.categories[category].some((n, j) => {
                                    if(n.substr(0, o.name.length) == o.name){
                                        i = j
                                        return true
                                    }
                                })
                                if(i != -1){
                                    this.categories[category][i] = this.compactName(val, o.terms.name)
                                    this.save(() => {
                                        console.log('opening', global.explorer.dirname(global.explorer.path) + '/' + val)
                                        global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path) + '/' + val)
                                        global.osd.show(global.lang.CHANNEL_RENAMED, 'fas fa-check-circle', 'channels', 'normal')
                                    })
                                } 
                            }
                        }},
                        {name: global.lang.SEARCH_TERMS, type: 'input', details: global.lang.SEPARATE_WITH_COMMAS, value: () => {
                            let t = (o.terms || e.terms)
                            t = t ? t.name.join(' ') : (o.name || e.name)
                            return t
                        }, action: (entry, val) => {
                            console.warn('ALIASES', this.categories[category], category, val, o)
                            let i = -1
                            this.categories[category].some((n, j) => {
                                if(n.substr(0, o.name.length) == o.name){
                                    i = j
                                    return true
                                }
                            })
                            if(i != -1){
                                this.channelsIndex = null
                                this.categories[category][i] = this.compactName(o.name, val)
                                e.terms = o.terms = {name: global.lists.terms(val, true), group: []}
                                console.warn('ALIASES SET', JSON.stringify(this.categories[category], null, 3), category, JSON.stringify(this.categories, null, 3), e.terms)
                                this.save()
                                console.warn('ALIASES SET', JSON.stringify(this.categories, null, 3), this.categories[category], e.terms)
                                global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                            }
                        }},
                        {name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'action', action: () => {
                            console.warn('REMOVE', o.name)
                            this.categories[category] = this.categories[category].filter(c => c != o.name)
                            this.save(() => {
                                console.log('REMOVING')
                                global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                global.osd.show(global.lang.CHANNEL_REMOVED, 'fas fa-check-circle', 'channels', 'normal')
                            })
                        }}
                    ])
                }
                resolve(entries)
            })
        };
        ['cnt', 'count', 'label', 'users'].forEach(k => { if(e[k]) delete e[k] })
        return e
    }
    addCategoryEntry(){
        return {name: global.lang.ADD_CATEGORY, fa: 'fas fa-plus-square', type: 'input', action: (data, val) => {
            let categories = this.getCategories()
            if(val && !categories.map(c => c.name).includes(val)){
                console.warn('ADD', val)
                this.categories[val] = []
                this.save(() => {
                    console.warn('saved', data, global.explorer.path, global.explorer.dirname(global.explorer.path))
                    global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                })
            }
        }}
    }
    editCategoriesEntry(){
        return {
            name: global.lang.EDIT,
            type: 'group',
            fa: 'fas fa-tasks',
            renderer: () => {
                return new Promise((resolve, reject) => {
                    let list = [
                        this.emptyEntry
                    ]
                    resolve(this.getCategories(false).map(c => this.editCategoryEntry(c, true)))
                })
            }
        }
    }
    editCategoryEntry(cat, useCategoryName){
        let category = Object.assign({}, cat)
        Object.assign(category, {fa: 'fas fa-tasks', path: undefined})
        if(useCategoryName !== true){
            Object.assign(category, {name: global.lang.EDIT_CATEGORY})
        }
        category.renderer = (c, e) => {
            return new Promise((resolve, reject) => {
                let entries = [
                    {name: global.lang.EDIT_CHANNELS, type: 'group', renderer: () => {
                        return new Promise((resolve, reject) => {
                            let entries = c.entries.map(e => {
                                return this.editChannelEntry(e, cat.name, {})
                            })
                            entries.unshift({name: global.lang.ADD_CHANNEL, fa: 'fas fa-plus-square', type: 'input', placeholder: global.lang.SEARCH_PLACEHOLDER, action: (data, val) => {
                                if(val && !Object.keys(this.categories).map(c => c.name).includes(val)){
                                    console.warn('ADD', val)
                                    if(!this.categories[cat.name].includes(val)){
                                        this.categories[cat.name].push(val)
                                        this.save(() => {
                                            console.log('REMOVING')
                                            global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                            global.osd.show(global.lang.CHANNEL_ADDED, 'fas fa-check-circle', 'channels', 'normal')
                                        })
                                    }
                                }
                            }})
                            resolve(entries)
                        })
                    }},
                    {name: global.lang.RENAME, type: 'input', details: cat.name, value: cat.name, action: (e, val) => {
                        console.warn('RENAME', cat.name, 'TO', val)
                        if(val && val != cat.name && typeof(this.categories[val]) == 'undefined'){
                            let o = this.categories[cat.name]
                            delete this.categories[cat.name]
                            this.categories[val] = o
                            this.save(() => {
                                global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path) + '/' + val)
                                global.osd.show(global.lang.CATEGORY_RENAMED, 'fas fa-check-circle', 'channels', 'normal')
                            })
                        }
                    }},
                    {name: global.lang.REMOVE_CATEGORY, fa: 'fas fa-trash', type: 'action', details: cat.name, action: () => {
                        delete this.categories[cat.name]
                        this.save(() => {
                            global.explorer.deepRefresh(global.explorer.dirname(global.explorer.dirname(global.explorer.path)))
                            global.osd.show(global.lang.CATEGORY_REMOVED, 'fas fa-check-circle', 'channels', 'normal')
                        })
                    }}
                ]
                console.warn('editcat entries', entries)
                resolve(entries)
            })
        }
        return category
    }
}

class Channels extends ChannelsEditing {
    constructor(opts){
        super()
		if(opts){
			Object.keys(opts).forEach((k) => {
				this[k] = opts[k]
			})
		}
    }
    getAllChannels(){
        let list = []
        this.getCategories().forEach(category => {
            category.entries.forEach(e => {
                list.push(e)
            })
        })
        return list
    }
    getAllChannelsNames(){
        return this.getAllChannels().map(c => c.name)
    }
    getChannelsIndex(){
        if(!this.channelsIndex || !Object.keys(this.channelsIndex).length){
            let index = {}
            this.getCategories().forEach(cat => {
                cat.entries.forEach(e => {
                    index[e.name] = e.terms.name
                })
            })
            let keys = Object.keys(index)
            keys.sort((a, b) => { return index[a].length > index[b].length ? -1 : (index[a].length < index[b].length) ? 1 : 0 })
            this.channelsIndex = {}
            keys.forEach(k => {
                this.channelsIndex[k] = index[k] 
            })
        }
        return this.channelsIndex
    }
    getChannelCategory(name){
        let ct, sure, cats = this.getCategories(true)
        Object.keys(cats).some(c => {
            let i = -1
            cats[c].some((n, j) => {
                if(n == name){
                    ct = c
                    sure = true
                } else if(n.substr(0, name.length) == name){
                    ct = c
                }
                return sure
            })
        })
        return ct
    }
    isChannel(terms, partial){
        let tms = Array.isArray(terms) ? terms : global.lists.terms(terms, true), chs = this.getChannelsIndex()
        let chosen, alts = {}, chosenScore = -1
        Object.keys(chs).forEach(name => {
            if(chosenScore < 3){
                let score = global.lists.match(chs[name], tms, partial)
                if(score){
                    if(score > chosenScore){
                        if(chosen){
                            alts[chosen] = chs[chosen]
                        }
                        chosen = name
                        chosenScore = score
                    } else {
                        alts[name] = chs[name]
                    }
                } else {
                    let exs = chs[name].filter(t => !tms.includes(t))
                    if(exs.length < chs[name].length){
                        alts[name] = chs[name]
                    }
                }
            }
        })
        if(chosenScore > 1){
            let excludes = []
            Object.keys(alts).forEach(n => {
                excludes = excludes.concat(alts[n].filter(t => !chs[chosen].includes(t)))
            })
            return {name: chosen, terms: chs[chosen].concat(excludes.map(s => '-' + s)), alts, excludes}
        }
    }
    get(terms){
        return new Promise((resolve, reject) => {
            if(typeof(terms) == 'string'){
                terms = global.lists.terms(terms)
            }
            global.lists.search(terms, {
                partial: false, 
                safe: (global.config.get('parental-control-policy') == 'block'),
                type: 'live',
                typeStrict: false
            }).then(sentries => {
                console.warn('sentries', sentries)
                let entries = sentries.results
                console.warn('entries', entries)
                global.watching.order(entries).then(resolve).catch(err => {
                    console.warn('entries', entries)
                    resolve(entries)
                })
            }).catch(reject)
        })
    }
    search(terms, partial){
        return new Promise((resolve, reject) => {
            if(typeof(terms) == 'string'){
                terms = global.lists.terms(terms)
            }
            let entries = [], chs = this.getChannelsIndex()
            Object.keys(chs).forEach(name => {
                let score = global.lists.match(terms, chs[name], partial)
                if(score){
                    entries.push(this.toMetaEntry({
                        name,
                        terms: {name: chs[name]}
                    }))
                }
            })
            resolve(entries)
        })
    }
    entryTerms(e){        
        let terms, ch
        if(Array.isArray(e.terms)){
            terms = e.terms
        } else if(typeof(e.terms) == 'undefined') {
            terms = global.lists.terms(e.name)
        } else {
            terms = e.terms.name
        }
        ch = this.isChannel(terms)
        if(ch){
            terms = ch.terms
        }
        return terms
    }
    toMetaEntryRenderer(e, category){
        return new Promise((resolve, reject) => {
            if(typeof(category) != 'string' && category !== false){
                category = ''
                let c = this.getChannelCategory(e.name)
                if(c){
                    this.toMetaEntryRenderer(e, c).then(resolve).catch(reject)
                    return
                }
            }
            let terms = this.entryTerms(e), streamsEntry, epgEntry, entries = [], url = e.url || global.mega.build(e.name, {terms})
            this.get(terms).then(sentries => {
                if(sentries.length){
                    entries.push({
                        name: e.name,
                        details: '<i class="fas fa-play-circle"></i> ' + global.lang.PLAY, 
                        type: 'action', 
                        icon: e.servedIcon, 
                        fa: 'fas fa-play-circle',
                        url
                    })
                    streamsEntry = {
                        name: global.lang.STREAMS + ' (' + sentries.length + ')', 
                        type: 'group', 
                        renderer: () => {
                            return new Promise((resolve, reject) => {
                                resolve(sentries)
                            })
                        }
                    }
                    if(global.config.get('epg')){
                        epgEntry =  {
                            name: global.lang.EPG, 
                            type: 'group', 
                            fa: this.epgIcon,
                            renderer: this.epgChannelEntries.bind(this, e)
                        }
                    }
                } else {    
                    entries.push(Object.assign(this.emptyEntry, {name: global.lang.NONE_STREAM_FOUND}))
                }
            }).catch(e => {
                console.error(e)
                category = false
            }).finally(() => {
                if(entries.length){
                    let bookmarking = {name: e.name, type: 'stream', label: e.group || '', url}
                    if(global.bookmarks.has(bookmarking)){
                        entries.push({
                            type: 'action',
                            fa: 'fas fa-star-half',
                            name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                            action: () => {
                                global.bookmarks.remove(bookmarking)
                                global.explorer.refresh()
                                global.osd.show(global.lang.FAV_REMOVED.format(bookmarking.name), 'fas fa-star-half', 'bookmarks', 'normal')
                            }
                        })
                    } else {
                        entries.push({
                            type: 'action',
                            fa: 'fas fa-star',
                            name: global.lang.ADD_TO.format(global.lang.BOOKMARKS),
                            action: () => {
                                global.bookmarks.add(bookmarking)
                                global.explorer.refresh()
                                global.osd.show(global.lang.FAV_ADDED.format(bookmarking.name), 'fas fa-star', 'bookmarks', 'normal')
                            }
                        })
                    } 
                }
                if(streamsEntry){
                    if(epgEntry){
                        entries.push(epgEntry)
                    }
                    entries.push(this.shareChannelEntry(e))
                    entries.push(streamsEntry)
                }
                entries.push(this.editChannelEntry(e, category, {name: category ? global.lang.EDIT_CHANNEL : global.lang.EDIT, details: '', class: 'no-icon', fa: 'fas fa-edit', path: undefined, servedIcon: undefined, url: undefined}))
                resolve(entries)
            })
        })
    }
    toMetaEntry(e, category){
        let meta = Object.assign({}, e), terms = this.entryTerms(e)        
        if(typeof(meta.url) == 'undefined'){
            meta.url = global.mega.build(e.name, {terms})
        }
        if(global.mega.isMega(meta.url)){
            meta = Object.assign(meta, {
                type: 'group',
                class: 'entry-meta-stream',
                fa: 'fas fa-play-circle' ,
                renderer: () => {
                    return this.toMetaEntryRenderer(meta, category)
                }
            })
        }
        if(global.config.get('show-logos') ){
            meta.servedIcon = global.icons.generate(terms, e.icon)
        }
        return meta
    }
    entries(){
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
            if(!global.activeLists.length){ // one list available on index beyound meta watching list
                return resolve([global.lists.manager.noListsEntry()])
            }
            let categories = this.getCategories(), list = categories.map(category => {
                category.renderer = (c, e) => {
                    return new Promise((resolve, reject) => {
                        global.lists.has(category.entries.map(e => e.name), {}).then(ret => {
                            let entries = category.entries.filter(e => ret[e.name])
                            if(global.config.get('show-logos')  && global.config.get('search-missing-logos')){
                               // global.icons.prefetch(entries.map(e => this.entryTerms(e)).slice(0, global.config.get('view-size-x')))
                            }
                            entries = entries.map(e => this.toMetaEntry(e, category))
                            if(global.config.get('epg')){
                                entries.unshift({name: global.lang.EPG, fa: this.epgIcon, type: 'group', renderer: () => {
                                    return this.epgEntries(category)
                                }})
                            }
                            entries.push(this.editCategoryEntry(c))
                            resolve(entries)
                        })
                    })
                }
                return category
            })
            if(global.config.get('allow-edit-channel-list')){
                list.push(this.addCategoryEntry())
            }
            resolve(list)
        })
    }
    importFileCallback(data){
        console.log('Categories file', data)
        try {
            data = JSON.parse(data)
            if(typeof(data) == 'object'){
                this.setCategories(data)
            } else {
                throw new Error('Not a JSON file.')
            }
        } catch(e) {
            global.displayErr('Invalid file', e)
        }
    }
    importFile(data){
        console.warn('!!! IMPORT FILE !!!', data)
        global.importFileFromClient(data).then(ret => this.importFileCallback(ret)).catch(err => {
            global.displayErr(err)
        })
    }
    options(){
        return new Promise((resolve, reject) => {
            let entries = [
                this.editCategoriesEntry(),
                {
                    name: global.lang.IMPORT + ' | ' + global.lang.EXPORT,
                    type: 'group',
                    fa: 'fas fa-file-import',
                    entries: [
                        {
                            name: global.lang.EXPORT,
                            type: 'action',
                            fa: 'fas fa-file-export', 
                            action: () => {
                                const filename = 'categories.json', file = global.serve.folder + path.sep + filename
                                fs.writeFile(file, JSON.stringify(this.getCategories(true), null, 3), {encoding: 'utf-8'}, err => {
                                    global.serve.serve(file, true, false).catch(global.displayErr)
                                })
                            }
                        },
                        {
                            name: global.lang.IMPORT,
                            type: 'action',
                            fa: 'fas fa-file-import', 
                            action: () => {
                                global.ui.emit('open-file', global.ui.uploadURL, 'channels-import-file', 'application/json')
                            }
                        },
                        {
                            name: global.lang.RESET,
                            type: 'action',
                            fa: 'fas fa-undo-alt', 
                            action: () => {
                                global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'options', 'persistent')
                                delete this.categories
                                global.rstorage.delete(this.categoriesCacheKey, () => {
                                    this.setup(() => {
                                        global.osd.show('OK', 'fas fa-check-circle', 'options', 'normal')
                                    })
                                })
                            }
                        }
                    ]
                },
                {name: 'EPG', fa: this.epgIcon, type: 'action', action: () => {
                    global.ui.emit('prompt', 'EPG', 'http://.../epg.xml', global.config.get('epg'), 'set-epg', false, this.epgIcon)
                }},
                {
                    name: global.lang.ALLOW_EDIT_CHANNEL_LIST,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('allow-edit-channel-list', checked)
                    }, 
                    checked: () => {
                        return global.config.get('allow-edit-channel-list')
                    }
                },
                {
                    name: global.lang.ONLY_KNOWN_CHANNELS_IN_X.format(global.lang.BEEN_WATCHED),
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('only-known-channels-in-been-watched', checked)
                    }, 
                    checked: () => {
                        return global.config.get('only-known-channels-in-been-watched')
                    }
                }
            ]
            if(global.config.get('epg')){
                entries[1].entries.splice(2, 0, {
                    name: global.lang.IMPORT_FROM_EPG,
                    type: 'action',
                    fa: 'fas fa-file-import', 
                    action: () => {
                        global.askEPGImport()
                    }
                })
            }
            resolve(entries)
        })
    }
    more(){
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
            if(!global.activeLists.length){ // one list available on index beyound meta watching list
                return resolve([global.lists.manager.noListsEntry()])
            }
            global.lists.allListsMerged().then(resolve).catch(reject)
        })
    }
}

module.exports = Channels
