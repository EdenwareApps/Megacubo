
const path = require('path'), fs = require('fs'), Events = require('events')

class ChannelsData extends Events {
    constructor(opts){
        super()
        this.emptyEntry = {
            name: global.lang.EMPTY, 
            type: 'action', 
            fa: 'fas fa-info-circle', 
            class: 'entry-empty'
        }
        this.channelsIndex = {}
        this.categories = {}
		global.config.on('change', (keys, data) => {
            if(['parental-control-policy', 'parental-control-terms'].some(k => keys.includes(k))){
                this.load()
            }
        })
        this.radioTerms = ['radio', 'fm', 'am']
        this.load()
    }
    updateCategoriesCacheKey(){
        const adult = global.config.get('parental-control-policy') == 'only'
        const useEPGChannels = !adult && global.activeEPG && global.config.get('use-epg-channels-list')
        let categoriesCacheKey = 'categories-'+ global.lang.locale
        if(useEPGChannels) {
            if(this.activeEPG || global.storage.raw.hasSync(categoriesCacheKey +'-epg')){
                categoriesCacheKey += '-epg'
            }
        } else if(adult) {
            categoriesCacheKey += '-adult'
        }
        this.categoriesCacheKey = categoriesCacheKey
        return categoriesCacheKey
    }
    ready(cb){
        if(this.loaded){
            cb()
        } else {
            this.once('loaded', cb)
        }
    }
    load(cb){
        this.updateCategoriesCacheKey()
        const adult = this.categoriesCacheKey.substr(-6) == '-adult'
        console.log('channels.load')
        global.storage.raw.get(this.categoriesCacheKey, data => {
            const next = () => {
                this.updateChannelsIndex(false)
                if(!this.categories || typeof(this.categories) != 'object'){
                    this.categories = {}
                }
                if(typeof(cb) == 'function'){
                    cb()
                }
                this.loaded = true
                this.emit('loaded')
            }
            if(data){
                try {
                    let cs = JSON.parse(data)
                    this.categories = cs
                } catch(e) {
                    console.error(e)
                }
                next()
            } else {
                if(adult){
                    next()
                } else {
                    global.cloud.get('categories').then(data => {
                        if(!Object.keys(data).length){
                            console.log('channel.load', data)
                        }
                        this.channelsIndex = null
                        this.categories = this.compact(data)
                        this.save(next)
                    }).catch(err => {
                        console.error('channel.load error: '+ err)
                        next()
                    })
                }
            }
        })
    }
    getCategories(compact){
        return compact ? this.categories : this.expand(this.categories)
    }
    setCategories(data, silent){
        console.log('channels.setCategories')
        this.updateCategoriesCacheKey()
        this.categories = data
        this.channelsIndex = null
        this.save(() => {
            console.log('Categories file imported')
            if(silent !== true){
                global.osd.show(global.lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal')
            }
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
    updateChannelsIndex(refresh){
        if(refresh === true || !this.channelsIndex || !Object.keys(this.channelsIndex).length || this.categoriesCacheKey != this.lastChannelsIndexCategoriesCacheKey){
            this.lastChannelsIndexCategoriesCacheKey = this.categoriesCacheKey
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
    }
    save(cb){
        let ordering = {}
        Object.keys(this.categories).sort().forEach(k => ordering[k] = this.categories[k].sort())
        this.categories = ordering
        this.updateChannelsIndex(true)
        global.storage.raw.set(this.categoriesCacheKey, JSON.stringify(this.categories, null, 3), true, cb)
    }
}

class ChannelsEPG extends ChannelsData {
    constructor(opts){
        super(opts)
        this.epgStatusTimer = false
        this.epgIcon = 'fas fa-th'
        this.clockIcon = '<i class="fas fa-clock"></i> '
        global.streamer.aboutDialogRegisterOption('epg', () => {
            return new Promise((resolve, reject) => {
                global.channels.epgChannelLiveNowAndNext(global.streamer.active.data).then(ret => {
                    let ks = Object.keys(ret)
                    ret = ks.map((k, i) => {
                        if(i == 0){
                            return {template: 'question', text: ret[k]}
                        } else {
                            return {template: 'message', text: k +': '+ ret[k]}
                        }
                    })
                    resolve(ret)
                }).catch(reject)
            })
        }, null, 1)
    }
    clock(start, data, includeEnd){
        let t = this.clockIcon
        t += global.ts2clock(start)
        if(includeEnd){
            t += ' - ' + global.ts2clock(data.e)
        }
        return t
    }
    epgSearchEntry(){
        return {
            name: global.lang.SEARCH,
            type: 'input',
            fa: 'fas fa-search',
            details: global.lang.EPG,
            action: (e, value) => {
                if(value){
                    global.lists.epgSearch(global.lists.terms(value, true)).then(epgData => {                                
                        let entries = []
                        console.warn('epgSearch', epgData)
                        Object.keys(epgData).forEach(ch => {
                            let terms = global.lists.terms(ch)
                            entries = entries.concat(this.epgDataToEntries(epgData[ch], ch, terms))
                        })
                        entries = entries.sort((a, b) => {
                            return a.program.start - b.program.start 
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
    epgCategoryEntries(category){
        return new Promise((resolve, reject) => {
            let terms = {}, channels = category.entries.map(e => {
                let data = this.isChannel(e.name)
                if(data){
                    e.terms.name = terms[e.name] = data.terms
                    return e
                }
            }).filter(e => e)
            global.lists.epg(channels, 72).then(epgData => {
                let centries = []
                if(!Array.isArray(epgData)){
                    Object.keys(epgData).forEach((ch, i) => {
                        if(!epgData[ch]) return
                        let current, next
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
                            current.ch = ch
                            centries.push({
                                name: current.t,
                                details: ch,
                                type: 'group',
                                fa: 'fas fa-play-circle',
                                program: current,
                                renderer: () => {
                                    return new Promise((resolve, reject) => {
                                        resolve(this.epgDataToEntries(epgData[ch], ch, terms[ch]))
                                    })
                                }
                            })
                        }
                    })
                }
                resolve(centries)
            }).catch(reject)
        })
    }
    epgDataToEntries(epgData, ch, terms){
        console.warn('epgDataToEntries', epgData, ch, terms)
        let now = global.time()
        let at = start => {
            if(start <= now && epgData[start].e > now){
                return global.lang.LIVE
            }
            return this.clock(start, epgData[start], true)
        }
        return Object.keys(epgData).filter(start => epgData[start].e > now).map((start, i) => {
            let epgIcon = ''
            if(epgData[start].i && epgData[start].i.indexOf('//') != -1){
                epgIcon = epgData[start].i
            }
            return {
                name: epgData[start].t,
                details: ch + ' | ' + at(start),
                type: 'action',
                fa: 'fas fa-play-circle',
                program: {start, ch, i: epgIcon},
                action: this.epgProgramAction.bind(this, start, ch, epgData[start], terms, epgIcon)
            }
        })
    }
    epgPrepareSearch(e){
        let ret = {name: e.originalName || e.name}, map = global.config.get('epg-map')
        Object.keys(map).some(n => {
            if(n == ret.name){
                ret.searchName = map[n]
                return true
            }
        })
        ret.terms = e.terms && Array.isArray(e.terms) ? e.terms : this.entryTerms(e)
        return ret
    }
    epgChannel(e, limit){
        return new Promise((resolve, reject) => {
            if(typeof(limit) != 'number'){
                limit = 72
            }
            let data = this.epgPrepareSearch(e)
            global.lists.epg(data, limit).then(resolve).catch(reject)
        })
    }
    epgChannelEntries(e, limit){
        return new Promise((resolve, reject) => {
            if(typeof(limit) != 'number'){
                limit = 72
            }
            let data = this.epgPrepareSearch(e)
            global.lists.epg(data, limit).then(epgData => {
                let centries = []
                if(epgData){
                    if(typeof(epgData[0]) != 'string'){
                        centries = this.epgDataToEntries(epgData, data.name, data.terms)
                        if(!centries.length){
                            centries.push(global.explorer.emptyEntry(global.lang.NOT_FOUND))
                        }
                    }
                }
                centries.unshift(this.adjustEPGChannelEntry(e))
                resolve(centries)
            }).catch(reject)
        })
    }
    epgChannelLiveNow(entry){
        return new Promise((resolve, reject) => {
            let channel = this.epgPrepareSearch(entry)
            global.lists.epg(channel, 1).then(epgData => {
                let ret = Object.values(epgData).shift()
                if(ret){
                    resolve(ret.t)
                } else {
                    reject('not found')
                }
            }).catch(reject)
        })
    }
    epgChannelLiveNowAndNext(entry){
        return new Promise((resolve, reject) => {
            let channel = this.epgPrepareSearch(entry)
            global.lists.epg(channel, 2).then(epgData => {
                let now = Object.values(epgData).shift()
                if(now){
                    let ret = {
                        now: now.t
                    }
                    let ks = Object.keys(epgData)
                    if(ks.length > 1){
                        let start = ks.pop()
                        let next = epgData[start]
                        start = moment(start * 1000).fromNow()
                        start = start.charAt(0).toUpperCase() + start.slice(1)
                        ret[start] = next.t
                    }
                    resolve(ret)
                } else {
                    reject('not found')
                }
            }).catch(reject)
        })
    }
    epgChannelsLiveNow(entries){
        return new Promise((resolve, reject) => {
            let channels = entries.map(e => this.epgPrepareSearch(e))
            global.lists.epg(channels, 1).then(epgData => {
                let ret = {}
                Object.keys(epgData).forEach(ch => {
                    ret[ch] = Object.values(epgData[ch]).shift()
                    ret[ch] = ret[ch] ? ret[ch] : false
                })
                resolve(ret)
            }).catch(reject)
        })
    }
    epgChannelsAddLiveNow(entries, keepIcon, checkIsChannel){
        return new Promise((resolve, reject) => {
            if(global.channels.activeEPG){
                let cs = entries.filter(e => e.type == 'group')
                if(checkIsChannel){
                    cs = cs.map(e => global.channels.isChannel(e.name))
                }
                cs = cs.filter(e => e)
                global.channels.epgChannelsLiveNow(cs).then(epg => {
                    entries.forEach((e, i) => {
                        if(typeof(epg[e.name]) != 'undefined' && epg[e.name].t){
                            if(entries[i].details){
                                entries[i].details += ' &middot; '+ epg[e.name].t
                            } else {
                                entries[i].details = epg[e.name].t
                            }
                        }
                    })
                }).catch(console.error).finally(() => resolve(entries))
            } else {
                resolve(entries)
            }
        })
    }
    adjustEPGChannelEntry(e){
        return {
            name: global.lang.SELECT,
            fa: 'fas fa-th-large',
            type: 'group',
            renderer: this.adjustEPGChannelEntryRenderer.bind(this, e)
        }
    }
    adjustEPGChannelEntryRenderer(e){
        return new Promise((resolve, reject) => {
            let terms = this.entryTerms(e)
            //console.log('adjustEPGChannelEntryRenderer', e, terms)
            terms = terms.filter(t => t.charAt(0) != '-')
            global.lists.epgSearchChannel(terms).then(results => {
                let options = []
                //console.log('adjustEPGChannelEntryRenderer', results)
                Object.keys(results).forEach(name => {
                    let keys = Object.keys(results[name])
                    options.push({
                        name,
                        details: results[name][keys[0]].t,
                        fa: 'fas fa-th-large',
                        type: 'action',
                        action: () => {
                            //console.log('adjustEPGChannelEntryRenderer RESULT', e.name, name)
                            let map = global.config.get('epg-map') || {}
                            if(e.name != name){
                                map[e.name] = name
                            } else if(map[e.name]) {
                                delete map[e.name]
                            }
                            global.config.set('epg-map', map)
                            global.explorer.back(null, true)
                        }
                    })
                })
                options.push({
                    name: global.lang.NONE,
                    details: global.lang.DISABLED,
                    fa: 'fas fa-ban',
                    type: 'action',
                    action: () => {
                        //console.log('adjustEPGChannelEntryRenderer RESULT', e.name, '-')
                        let map = global.config.get('epg-map') || {}
                        map[e.name] = '-'
                        global.config.set('epg-map', map)
                        global.explorer.back(null, true)
                    }
                })
                //console.log('adjustEPGChannelEntryRenderer', options)
                resolve(options)
            }).catch(reject)
        })
    }
    epgProgramAction(start, ch, program, terms, icon){
        if(start <= (global.time() + 300)){ // if it will start in less than 5 min, open it anyway
            let url = global.mega.build(ch, {terms})
            global.streamer.play({
                name: ch,
                type: 'stream', 
                fa: 'fas fa-play-circle',
                icon, 
                url,
                terms: {name: terms, group: []}
            })
        } else {
            let text = global.lang.START_DATE +': '+ global.moment(start * 1000).format('L LT')
            global.ui.emit('dialog', [
                {template: 'question', text: program.t +' &middot; '+ ch, fa: 'fas fa-users'},
                {template: 'message', text},
                {template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
            ], 'epg-future-program', 'ok')
        }
    }
}

class ChannelsEditing extends ChannelsEPG {
    constructor(opts){
        super(opts)
        global.ui.on('channels-import-file', data => {
            console.warn('!!! IMPORT FILE !!!', data)
            global.importFileFromClient(data).then(ret => this.importFile(ret)).catch(err => {
                global.displayErr(err)
            })
        })
    } 
    shareChannelEntry(e){
        return {
            name: global.lang.SHARE,
            type: 'action',
            fa: 'fas fa-share-alt',
            action: () => {
                global.ui.emit('share', 'Megacubo', e.name, 'https://megacubo.tv/assistir/' + encodeURIComponent(e.name))
            }
        }
    }
    editChannelEntry(o, _category, atts){ // category name
        const category = _category
        let e = Object.assign({}, o), terms = this.entryTerms(o)
        Object.assign(e, {fa: 'fas fa-play-circle', type: 'group', details: global.lang.EDIT_CHANNEL})
        Object.assign(e, atts)
        e.renderer = () => {
            return new Promise((resolve, reject) => {
                const category = _category
                let entries = []
                if(global.config.get('show-logos')){
                    entries.push({name: global.lang.SELECT_ICON, details: o.name, type: 'group', renderer: () => {
                        console.warn('render icons', terms)
                        return new Promise((resolve, reject) => {
                            let images = []
                            global.icons.search(terms).then(ms => {
                                console.warn('render icons', ms, terms)
                                images = images.concat(ms.map(m => m.icon))
                            }).catch(console.error).finally(() => {
                                let ret = images.map((image, i) => {
                                    const e =  {
                                        name: String(i + 1) + String.fromCharCode(186),
                                        type: 'action',
                                        icon: image,
                                        class: 'entry-icon-no-fallback',
                                        fa: 'fa-mega spin-x-alt',
                                        action: () => {
                                            global.explorer.setLoadingEntries([e], true, global.lang.PROCESSING)
                                            global.icons.fetchURL(image).then(file => {
                                                global.icons.adjust(file, {shouldBeAlpha: false}).then(ret => {
                                                    global.icons.saveDefaultFile(terms, ret.file, destFile => {
                                                        console.log('icon changed', terms, destFile)
                                                        global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                                        global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                                    })
                                                }).catch(global.displayErr)
                                            }).catch(global.displayErr)
                                        }
                                    }
                                    return e
                                })
                                ret.push({name: global.lang.OPEN_URL, type: 'input', fa: 'fas fa-link', action: (err, val) => {   
                                    console.log('from-url', terms, '') 
                                    global.icons.fetchURL(val).then(file => {
                                        global.icons.adjust(file, {shouldBeAlpha: false}).then(ret => {
                                            global.icons.saveDefaultFile(terms, ret.file, destFile => {
                                                console.log('icon changed', terms, destFile)
                                                global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                                global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                            })
                                        })
                                    }).catch(global.displayErr)
                                }})
                                ret.push({name: global.lang.NO_ICON, type: 'action', fa: 'fas fa-ban', action: () => {   
                                    console.log('saveDefault', terms, '') 
                                    global.icons.saveDefault(terms, 'no-icon', () => {
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
                        {name: global.lang.RENAME, type: 'input', details: o.name, value: o.name, action: (data, val) => {
                            const category = _category
                            console.warn('RENAME', o.name, 'TO', val, category)
                            if(val && val != o.name){
                                let i = -1
                                this.categories[category].some((n, j) => {
                                    if(n.substr(0, o.name.length) == o.name){
                                        i = j
                                        return true
                                    }
                                })
                                if(i != -1){
                                    let t = (o.terms || e.terms)
                                    t = t ? t.name.join(' ') : (o.name || e.name)
                                    this.categories[category][i] = this.compactName(val, t)
                                    console.warn('RENAMED', this.categories[category][i], category, i)
                                    this.save(() => {
                                        const category = _category
                                        console.warn('RENAMED*', this.categories[category][i], category, i)
                                        let destPath = global.explorer.path.replace(o.name, val).replace('/'+ global.lang.RENAME, '')
                                        console.log('opening', destPath)
                                        global.explorer.deepRefresh(destPath)
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
                            const category = _category
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
                        {name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'action', details: o.name, action: () => {
                            const category = _category
                            console.warn('REMOVE', o.name)
                            this.categories[category] = this.categories[category].filter(c => {
                                return c.split(',')[0] != o.name
                            })
                            this.save(() => {
                                console.log('REMOVING')
                                global.explorer.deepRefresh(global.explorer.dirname(global.explorer.dirname(global.explorer.path)))
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
            name: global.lang.EDIT_CHANNEL_LIST,
            type: 'group',
            fa: 'fas fa-tasks',
            renderer: () => {
                return new Promise((resolve, reject) => {
                    resolve(this.getCategories(false).map(c => this.editCategoryEntry(c, true)))
                })
            }
        }
    }
    editCategoryEntry(cat, useCategoryName){
        let category = Object.assign({}, cat)
        Object.assign(category, {fa: 'fas fa-tasks', path: undefined})
        if(useCategoryName !== true){
            Object.assign(category, {name: global.lang.EDIT_CATEGORY, details: category.name})
        }
        category.renderer = (c, e) => {
            return new Promise((resolve, reject) => {
                let entries = [
                    {name: global.lang.EDIT_CHANNELS, details: cat.name, type: 'group', renderer: () => {
                        return new Promise((resolve, reject) => {
                            let entries = c.entries.map(e => {
                                return this.editChannelEntry(e, cat.name, {})
                            })
                            entries.unshift({name: global.lang.ADD_CHANNEL, details: cat.name, fa: 'fas fa-plus-square', type: 'input', placeholder: global.lang.CHANNEL_NAME, action: (data, val) => {
                                if(val && !Object.keys(this.categories).map(c => c.name).includes(val)){
                                    console.warn('ADD', val)
                                    if(!this.categories[cat.name].includes(val)){
                                        this.categories[cat.name].push(val)
                                        this.save(() => {
                                            console.log('ADDING')
                                            global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
                                            global.osd.show(global.lang.CHANNEL_ADDED, 'fas fa-check-circle', 'channels', 'normal')
                                        })
                                    }
                                }
                            }})
                            resolve(entries)
                        })
                    }},
                    {name: global.lang.RENAME_CATEGORY, type: 'input', details: cat.name, value: cat.name, action: (e, val) => {
                        console.warn('RENAME', cat.name, 'TO', val)
                        if(val && val != cat.name && typeof(this.categories[val]) == 'undefined'){
                            let o = this.categories[cat.name]
                            delete this.categories[cat.name]
                            this.categories[val] = o
                            this.save(() => {
                                let destPath = global.explorer.path.replace(cat.name, val).replace('/'+ global.lang.RENAME_CATEGORY, '')
                                global.explorer.deepRefresh(destPath)
                                global.osd.show(global.lang.CATEGORY_RENAMED, 'fas fa-check-circle', 'channels', 'normal')
                            })
                        }
                    }},
                    {name: global.lang.REMOVE_CATEGORY, fa: 'fas fa-trash', type: 'action', details: cat.name, action: () => {
                        delete this.categories[cat.name]
                        this.save(() => {
                            global.explorer.deepRefresh(global.explorer.dirname(global.explorer.path))
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
    isChannel(terms){
        let tms = Array.isArray(terms) ? terms : global.lists.terms(terms, true), chs = this.channelsIndex
        let chosen, alts = {}, chosenScore = -1
        Object.keys(chs).forEach(name => {
            let score = global.lists.match(chs[name], tms, false)
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
                let stms = chs[name].filter(t => t.charAt(0) != '-')
                if(stms.some(s => tms.includes(s))){
                    alts[name] = chs[name]
                }
            }
        })
        if(chosenScore > 1){
            let excludes = [], chTerms = chs[chosen]
            Object.keys(alts).forEach(n => {
                excludes = excludes.concat(alts[n].filter(t => {
                    return t.charAt(0) != '-' && !chTerms.includes(t)
                }))
            })
            if(!chTerms.some(c => this.radioTerms.includes(c))){ // is not radio
                this.radioTerms.forEach(rterm => {
                    if(!chTerms.some(cterm => cterm.substr(0, rterm.length) == rterm)){ // this radio term can mess with our search (specially AM)
                        chTerms.push('-'+ rterm)
                    }
                })
            }
            return {name: chosen, terms: [...new Set(chTerms.concat(excludes.map(s => '-' + s)))], alts, excludes}
        }
    }
    expandTerms(terms){
        if(typeof(terms) == 'string'){
            terms = global.lists.terms(terms)
        }
        if(!terms.some(t => t.charAt(0) == '-')){
            let ch = this.isChannel(terms)
            if(ch){
                return ch.terms
            }
        }
        return terms
    }
    get(terms){
        return new Promise((resolve, reject) => {
            console.warn('sentries', terms)
            if(typeof(terms) == 'string'){
                terms = global.lists.terms(terms)
            }
            console.warn('sentries', terms)
            global.lists.search(terms, {
                partial: false, 
                safe: (global.config.get('parental-control-policy') == 'block'),
                type: 'live',
                typeStrict: false
            }).then(sentries => {
                console.warn('sentries', sentries)
                let entries = sentries.results
                global.watching.order(entries).then(resolve).catch(err => {
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
            let entries = [], chs = this.channelsIndex
            Object.keys(chs).forEach(name => {
                let score = global.lists.match(terms, chs[name], partial)
                if(score){
                    entries.push({
                        name,
                        terms: {name: chs[name]}
                    })
                }
            })
            this.epgChannelsAddLiveNow(entries, true, false).then(resolve).catch(reject)
        })
    }
    entryTerms(e){
        let terms
        if(Array.isArray(e.terms) && e.terms.length){
            terms = e.terms
        } else if(typeof(e.terms) != 'undefined' && typeof(e.terms.name) != 'undefined' && Array.isArray(e.terms.name) && e.terms.name.length) {
            terms = e.terms.name
        } else {
            terms = global.lists.terms(e.program ? e.program.ch : e.name)
        }
        return this.expandTerms(terms)
    }
    toMetaEntryRenderer(e, _category, epgNow){
        return new Promise((resolve, reject) => {
            let category
            if(_category === false){
                category = false
            } else if(_category && typeof(_category) == 'string') {
                category = _category
            } else if(_category && typeof(_category) == 'object') {
                category = _category.name
            } else {
                let c = this.getChannelCategory(e.name)
                if(c){
                    category = c
                } else {
                    category = false
                }
            }
            let terms = this.entryTerms(e), streamsEntry, epgEntry, entries = [], url = e.url || global.mega.build(e.name, {terms})
            this.get(terms).then(sentries => {
                if(sentries.length){
                    entries.push({
                        name: e.name,
                        details: '<i class="fas fa-play-circle"></i> '+ global.lang.WATCH_NOW, 
                        type: 'action',
                        fa: 'fas fa-play-circle',
                        url,
                        action: data => {
                            global.streamer.play(data, sentries)
                        }
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
                    console.warn('EPG DEBUG', this.activeEPG, epgNow, category)
                    if(this.activeEPG){
                        epgEntry =  {
                            name: global.lang.EPG, 
                            type: 'group', 
                            fa: this.epgIcon,
                            details: (epgNow && epgNow != category) ? epgNow : '',
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
                    let bookmarkable = {name: e.name, type: 'stream', label: e.group || '', url}
                    if(global.bookmarks.has(bookmarkable)){
                        entries.push({
                            type: 'action',
                            fa: 'fas fa-star-half',
                            name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                            action: () => {
                                global.bookmarks.remove(bookmarkable)
                                global.explorer.refresh()
                                global.osd.show(global.lang.BOOKMARK_REMOVED.format(bookmarkable.name), 'fas fa-star-half', 'bookmarks', 'normal')
                            }
                        })
                    } else {
                        entries.push({
                            type: 'action',
                            fa: 'fas fa-star',
                            name: global.lang.ADD_TO.format(global.lang.BOOKMARKS),
                            action: () => {
                                global.bookmarks.add(bookmarkable)
                                global.explorer.refresh()
                                global.osd.show(global.lang.BOOKMARK_ADDED.format(bookmarkable.name), 'fas fa-star', 'bookmarks', 'normal')
                            }
                        })
                    } 
                }
                if(epgEntry){
                    entries.push(epgEntry)
                }
                if(streamsEntry){
                    console.warn('EPG DEBUG', epgEntry)
                    entries.push(this.shareChannelEntry(e))
                    entries.push(streamsEntry)
                }
                if(global.config.get('allow-edit-channel-list')){
                    const editEntry = this.editChannelEntry(e, category, {name: category ? global.lang.EDIT_CHANNEL : global.lang.EDIT, details: e.name, class: 'no-icon', fa: 'fas fa-edit', users: undefined, usersPercentage: undefined, path: undefined, url: undefined})
                    entries.push(editEntry)
                }
                resolve(entries)
            })
        })
    }
    toMetaEntry(e, category, details){
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
                    console.log(meta, category, details)
                    return this.toMetaEntryRenderer(meta, category, details)
                }
            })
        }
        if(details){
            meta.details = details
        }
        return meta
    }
    keywords(cb){
        if(!this.loaded){
            return this.once('loaded', () => this.keywords(cb))
        }
        let keywords = [];
        ['histo', 'bookmarks'].forEach(k => {
            if(global[k]){
                global[k].get().forEach(e => {
                    keywords = keywords.concat(this.entryTerms(e))
                })
            }
        })
        this.getAllChannels().forEach(e => {
            keywords = keywords.concat(this.entryTerms(e))
        })
        keywords = [...new Set(keywords.filter(w => w.charAt(0) != '-'))]
        cb(keywords)
    }
    entries(){
        return new Promise((resolve, reject) => {
            if(lists.manager.updatingLists){
                return resolve([global.lists.manager.updatingListsEntry()])
            }
            if(!global.activeLists.length){ // one list available on index beyound meta watching list
                return resolve([global.lists.manager.noListsEntry()])
            }
            const editable = global.config.get('allow-edit-channel-list') && !global.config.get('use-epg-channels-list')
            let categories = this.getCategories(), list = categories.map(category => {
                category.renderer = (c, e) => {
                    return new Promise((resolve, reject) => {
                        let channels = category.entries.map(e => this.isChannel(e.name)).filter(e => !!e)
                        global.lists.has(channels, {
                            partial: false
                        }).then(ret => {
                            let entries = category.entries.filter(e => ret[e.name])
                            entries = entries.map(e => {
                                return this.toMetaEntry(e, category, c.name)
                            })
                            global.channels.epgChannelsAddLiveNow(entries, true, false).then(entries => {
                                if(editable){
                                    entries.push(this.editCategoryEntry(c))
                                }
                                resolve(entries)
                            }).catch(reject)
                        })
                    })
                }
                return category
            })
            if(editable){
                list.push(this.addCategoryEntry())
            }            
            if(this.activeEPG){
                list.unshift(this.epgEntry(categories))
            }
            resolve(list)
        })
    }
    epgEntry(categories){
        let entries = [this.epgSearchEntry()]
        entries = entries.concat(categories.map(category => {
            return {
                name: category.name,
                type: 'group',
                renderer: () => {
                    return this.epgCategoryEntries(category)
                }
            }
        }))
        return {
            name: global.lang.EPG, 
            fa: this.epgIcon, 
            type: 'group', 
            entries            
        }
    }
    importFile(data){
        console.log('Categories file', data)
        try {
            data = JSON.parse(data)
            if(typeof(data) == 'object'){
                this.setCategories(data)
                global.osd.show('OK', 'fas fa-check-circle', 'options', 'normal')
            } else {
                throw new Error('Not a JSON file.')
            }
        } catch(e) {
            global.displayErr('Invalid file', e)
        }
    }
    options(){
        return new Promise((resolve, reject) => {
            let entries = []
            if(global.config.get('allow-edit-channel-list')){
                entries.push(this.editCategoriesEntry())
            }
            entries = entries.concat([
                {
                    name: global.lang.EXPORT_IMPORT,
                    type: 'group',
                    fa: 'fas fa-file-import',
                    entries: [
                        {
                            name: global.lang.EXPORT,
                            type: 'action',
                            fa: 'fas fa-file-export', 
                            action: () => {
                                const filename = 'categories.json', file = global.downloads.folder + path.sep + filename
                                fs.writeFile(file, JSON.stringify(this.getCategories(true), null, 3), {encoding: 'utf-8'}, err => {
                                    global.downloads.serve(file, true, false).catch(global.displayErr)
                                })
                            }
                        },
                        {
                            name: global.lang.IMPORT,
                            type: 'action',
                            fa: 'fas fa-file-import', 
                            action: () => {
                                global.ui.emit('open-file', global.ui.uploadURL, 'channels-import-file', 'application/json', global.lang.IMPORT)
                            }
                        },
                        {
                            name: global.lang.RESET,
                            type: 'action',
                            fa: 'fas fa-undo-alt', 
                            action: () => {
                                global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'options', 'persistent')
                                delete this.categories
                                global.storage.raw.delete(this.categoriesCacheKey, () => {
                                    this.load(() => {
                                        global.osd.show('OK', 'fas fa-check-circle', 'options', 'normal')
                                    })
                                })
                            }
                        }
                    ]
                },
                {name: global.lang.EPG, fa: this.epgIcon, type: 'action', details: 'EPG', action: () => {
                    global.ui.emit('prompt', global.lang.EPG, 'http://.../epg.xml', this.activeEPG, 'set-epg', false, this.epgIcon)
                }},
                {
                    name: global.lang.ALLOW_EDIT_CHANNEL_LIST,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('allow-edit-channel-list', checked)
                        global.explorer.refresh()
                    }, 
                    checked: () => {
                        return global.config.get('allow-edit-channel-list')
                    }
                },
                {
                    name: global.lang.ONLY_KNOWN_CHANNELS_IN_X.format(global.lang.TRENDING),
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('only-known-channels-in-been-watched', checked)
                    }, 
                    checked: () => {
                        return global.config.get('only-known-channels-in-been-watched')
                    }
                }
            ])
            resolve(entries)
        })
    }
    more(){
        return new Promise((resolve, reject) => {
            if(lists.manager.updatingLists){
                return resolve([global.lists.manager.updatingListsEntry()])
            }
            if(!global.activeLists.length){ // one list available on index beyound meta watching list
                return resolve([global.lists.manager.noListsEntry()])
            }		
            global.lists.groups().then(es => this.moreGroupsToEntries(es).then(resolve).catch(reject)).catch(reject)
        })
    }
    moreGroupsToEntries(groups){		
        this.moreGroups = groups
        return new Promise((resolve, reject) => {
            let entries = [], already = []
            const next = () => {
                this.moreGroups.forEach(group => {
                    let p = group.split('/')[0]
                    if(already.includes(p)) return
                    already.push(p)
                    entries.push({
                        name: p,
                        type: 'group',
                        renderer: this.moreRenderGroup.bind(this, p)
                    })
                })		
                already = null
                entries = global.lists.tools.deepify(entries)		
                resolve(entries)
                entries = null		
            }
            if(this.moreGroups < 96){
                global.lists.group('').then(es => {
                    entries = es.map(e => {
                        e.group = ''
                        return e
                    })	
                }).catch(console.error).finally(next)
            } else {
                next()
            }
        })
    }
    moreRenderGroup(p){
        return new Promise((resolve, reject) => {
            let entries = []
            let next = () => {
                let gentries = []
                this.moreGroups.forEach(g => {
                    if(g.substr(0, p.length) == p && g != p){
                        let gp, pos = g.indexOf('/', p.length + 1)
                        if(pos == -1){
                            gp = g
                        } else {
                            gp = g.substr(0, pos)
                        }
                        gentries.push({
                            name: gp.split('/').pop(),
                            type: 'group',
                            renderer: this.moreRenderGroup.bind(this, gp)
                        })
                    }
                })
                entries = global.lists.tools.deepify(entries.concat(gentries))
                gentries = null
                if(entries.length == 1){
                    if(typeof(entries[0].renderer) == 'function'){
                        return entries[0].renderer().then(resolve).catch(reject)
                    } else if(Array.isArray(entries[0].entries)) {
                        entries = entries[0].entries
                    }
                }
                resolve(entries)
                entries = null
            }
            if(this.moreGroups.includes(p)){
                global.lists.group(p).then(es => entries = es.map(e => {
                    e.group = ''
                    return e
                })).catch(console.error).finally(next)
            } else {
                next()
            }
        })
    }
}

module.exports = Channels
