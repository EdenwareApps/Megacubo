
const path = require('path'), fs = require('fs'), Events = require('events'), pLimit = require('p-limit')

class ChannelsData extends Events {
    constructor(){
        super()
        this.emptyEntry = {
            name: global.lang.EMPTY, 
            type: 'action', 
            fa: 'fas fa-info-circle', 
            class: 'entry-empty'
        }
        this.channelsIndex = {}
        this.categories = {}
		global.config.on('change', async (keys, data) => {
            if(['parental-control', 'parental-control-terms'].some(k => keys.includes(k))){
                await this.load()
            }
        })
        this.radioTerms = ['radio', 'fm', 'am']
        this.isChannelCache = {}
        this.load().catch(console.error)
    }
    async updateCategoriesCacheKey(){
        let countries = await global.lang.getActiveCountries(0)
        const type = global.config.get('channel-grid')
        let categoriesCacheKey = 'categories-'+ countries.join('-')
        if(type && type != 'lists') categoriesCacheKey += '-'+ type
        this.categoriesCacheKey = categoriesCacheKey
        return categoriesCacheKey
    }
    async getAdultCategories(){
        return await global.cloud.get('channels/adult')
    }
    async getEPGCategories() {
        const data = await global.lists.epgLiveNowChannelsList()
        return data.categories
    }
    ready(cb){
        if(this.loaded){
            cb()
        } else {
            this.once('loaded', cb)
        }
    }
    readyp(){
        return new Promise(resolve => this.ready(resolve))
    }
    async load(){
        await this.updateCategoriesCacheKey().catch(global.displayErr)
        console.log('channels.load')
        await this.loadCategories()
        this.loaded = true
        this.emit('loaded')
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
            this.isChannelCache = {}
            this.channelsIndex = {}
            keys.forEach(k => this.channelsIndex[k] = index[k])
        }
    }
    async save(){
        let ordering = {}
        Object.keys(this.categories).sort().forEach(k => {
            if(!Array.isArray(this.categories[k])) return
            ordering[k] = this.categories[k].sort((a, b) => {
                let aa = a.indexOf(',')
                let bb = b.indexOf(',')
                aa = aa == -1 ? a : a.substr(0, aa)
                bb = bb == -1 ? b : b.substr(0, bb)
                return aa > bb ? 1 : -1
            })
        })
        this.categories = ordering
        this.updateChannelsIndex(true)
        await global.storage.raw.promises.set(this.categoriesCacheKey, JSON.stringify(this.categories, null, 3), true)
    }
}

class ChannelsCategories extends ChannelsData {
    constructor(){
        super()
    }    
    async loadCategories(){
        let fine, data = await global.storage.raw.promises.get(this.categoriesCacheKey).catch(console.error)
        if(data){
            try {
                let cs = global.parseJSON(data)
                if(!Object.keys(cs).length){
                    throw 'Empty list'
                }
                this.categories = cs
                fine = true
            } catch(e) {
                console.error(e)
            }
        }
        if(!fine) {
            let err
            data = await this.getDefaultCategories().catch(e => err = e)
            if(err) {
                console.error('channel.getDefaultCategories error: '+ err)
            } else {
                if(!Object.keys(data).length){
                    console.log('channel.load', data)
                }
                this.channelsIndex = null
                this.categories = data
                await this.save()
                fine = true
            }
        }
        this.updateChannelsIndex(false)
        if(!this.categories || typeof(this.categories) != 'object'){
            this.categories = {}
        }
    }
    mapSize(n) { // count strings (channel names) in channel maps
        return Object.values(n).map(k => Array.isArray(k) ? k.length : 0).reduce((s, v) => s + v, 0)
    }
    applyMapCategories(map, target, amount, weighted = false) {
        const categories = Object.keys(target).concat(Object.keys(map).map(k => this.translateKey(k)).filter(k => !(k in target)))
        const quota = amount / Math.max(categories.length, 5)
        for (const k of Object.keys(map)) {
            const cat = this.translateKey(k)
            target[cat] = target[cat] || []
            const left = quota - target[cat].length
            if (left > 0 && Array.isArray(map[k])) {
                const slice = map[k].filter(s => !target[cat].includes(s)).slice(0, weighted ? left : map[k].length)
                if (slice.length) {
                    target[cat].push(...slice)
                }
            }
        }
        return target
    }
    translateKey(k){
        let lk = 'CATEGORY_' + k.replaceAll(' & ', ' ').replace(new RegExp(' +', 'g'), '_').toUpperCase()
        let nk = global.lang[lk] || k
        return nk
    }
    async getDefaultCategories(amount=256){
        const type = global.config.get('channel-grid')
        if(type == 'xxx') {
            return await this.getAdultCategories()
        } else if(type == 'epg') {
            return await this.getEPGCategories()
        }
        let data = {}, weighted = true
        const countries = await global.lang.getActiveCountries(0)
        const completed = c => {
            return this.mapSize(data) >= amount
        }
        const processCountry = async country => {
            let err
            const isMainCountry = countries[0] == country
            if(!isMainCountry && completed()) throw 'completed'
            const map = await global.cloud.get('channels/' + country).catch(e => err = e)
            if(err) return
            if(!isMainCountry && completed()) throw 'completed'
            data = await this.applyMapCategories(map, data, amount, isMainCountry ? false : weighted)
        }
        const limit = pLimit(2)
        const tasks = () => countries.map(country => {
            return limit(async () => {
                return await processCountry(country)
            })
        })
        if(countries.length) {
            await Promise.allSettled(tasks()).catch(console.error)
            if(!completed()){
                data = {}
                weighted = false
                await Promise.allSettled(tasks()).catch(console.error)
            }
        }
        return data
    }   
    getCategories(compact){
        return compact ? this.categories : this.expand(this.categories)
    }
    setCategories(data, silent){
        this.updateCategoriesCacheKey().catch(global.displayErr).finally(() => {
            this.categories = data
            this.channelsIndex = null
            this.save().finally(() => {
                console.log('Categories file imported')
                if(silent !== true){
                    global.osd.show(global.lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal')
                }
            })
        })
    }
}

class ChannelsEPG extends ChannelsCategories {
    constructor(){
        super()
        this.epgStatusTimer = false
        this.epgIcon = 'fas fa-th'
        this.clockIcon = '<i class="fas fa-clock"></i> '
        const aboutInsertEPGTitle = async data => {
            if(global.streamer.active.mediaType != 'live'){
                throw 'local file'
            }
            if(!this.isChannel(global.streamer.active.data.originalName || global.streamer.active.data.name)){
                throw 'not a channel'
            }
            const ret = await this.epgChannelLiveNowAndNext(global.streamer.active.data)
            let ks = Object.keys(ret)
            ret = ks.map((k, i) => {
                if(i == 0){
                    return {template: 'question', text: ret[k]}
                } else {
                    return {template: 'message', text: k +': '+ ret[k]}
                }
            })
            return ret
        }
        global.ui.once('streamer-ready', () => { 
            global.streamer.aboutRegisterEntry('epg', aboutInsertEPGTitle, null, 1)
            global.streamer.aboutRegisterEntry('epg', aboutInsertEPGTitle, null, 1, true)
            global.streamer.aboutRegisterEntry('epg-more', () => {
                if(streamer.active.mediaType == 'live'){
                    return {template: 'option', text: global.lang.EPG, id: 'epg-more', fa: this.epgIcon}
                }
            }, async data => {
                const name = data.originalName || data.name
                const category = this.getChannelCategory(name)
                if(!global.activeEPG) {
                    global.displayErr(global.lang.EPG_DISABLED)
                } else if(!this.loadedEPG) {
                    global.displayErr(global.lang.EPG_AVAILABLE_SOON)
                } else if(category) {
                    let err
                    await this.epgChannelLiveNow(data).catch(e => {
                        err = e
                        global.displayErr(global.lang.CHANNEL_EPG_NOT_FOUND +' *')
                    })
                    if(!err) {
                        const entries = await this.epgChannelEntries({name}, null, true)
                        global.explorer.render(entries, global.lang.EPG, 'fas fa-plus', '/')
                        global.ui.emit('menu-playing')
                    }
                } else {
                    global.displayErr(global.lang.CHANNEL_EPG_NOT_FOUND)
                }
            }, null, true)
        })
    }
    isEPGEnabled(){
        return global.activeEPG || global.config.get('lang-'+ global.lang.locale)
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
                    this.epgSearch(value).then(entries => {
                        entries.unshift(this.epgSearchEntry())
                        let path = global.explorer.path.split('/').filter(s => s != global.lang.SEARCH).join('/')
                        global.explorer.render(entries, path + '/' + global.lang.SEARCH, 'fas fa-search', path)
                        global.search.history.add(value)
                    }).catch(global.displayErr)
                }
            },
            value: () => {
                return ''
            },
            placeholder: global.lang.SEARCH_PLACEHOLDER
        }
    }
    epgSearch(terms, liveNow){
        return new Promise((resolve, reject) => {
            if(typeof(terms) == 'string'){
                terms = global.lists.terms(terms, true)
            }
            global.lists.epgSearch(terms, liveNow).then(epgData => {                                
                let entries = []
                console.warn('epgSearch', epgData)
                Object.keys(epgData).forEach(ch => {
                    let terms = global.lists.terms(ch)
                    entries.push(...this.epgDataToEntries(epgData[ch], ch, terms))
                })
                entries = entries.sort((a, b) => {
                    return a.programme.start - b.programme.start 
                })
                resolve(entries)
            }).catch(reject)
        })
    }
    epgDataToEntries(epgData, ch, terms){
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
                programme: {start, ch, i: epgIcon},
                action: this.epgProgramAction.bind(this, start, ch, epgData[start], terms, epgIcon)
            }
        })
    }
    epgPrepareSearch(e){
        let ret = {name: e.originalName || e.name}, map = global.config.get('epg-map')
        if(map[ret.name]){
            ret.searchName = map[ret.name]
        }
        ret.terms = e.terms && Array.isArray(e.terms) ? e.terms : this.entryTerms(e)
        ret.terms = this.expandTerms(ret.terms)
        return ret
    }
    async epgChannel(e, limit){
        if(typeof(limit) != 'number') limit = 72
        let data = this.epgPrepareSearch(e)
        return await global.lists.epg(data, limit)
    }
    async epgChannelEntries(e, limit, detached){
        if(typeof(limit) != 'number'){
            limit = 72
        }
        let data = this.epgPrepareSearch(e)
        const epgData = await global.lists.epg(data, limit)
        let centries = []
        if(epgData){
            if(typeof(epgData[0]) != 'string'){
                centries = this.epgDataToEntries(epgData, data.name, data.terms)
                if(!centries.length){
                    centries.push(global.explorer.emptyEntry(global.lang.NOT_FOUND))
                }
            }
        }
        centries.unshift(this.adjustEPGChannelEntry(e, detached))
        return centries
    }
    async epgChannelLiveNow(entry){
        if(!global.activeEPG) throw 'epg not loaded'
        let channel = this.epgPrepareSearch(entry)
        let epgData = await global.lists.epg(channel, 1)
        let ret = Object.values(epgData).shift()
        if(ret){
            return ret.t
        } else {
            throw 'not found 2'
        }
    }
    async epgChannelLiveNowAndNext(entry){
        let ret = await this.epgChannelLiveNowAndNextInfo(entry)
        Object.keys(ret).forEach(k => ret[k] = ret[k].t)
        return ret
    }
    async epgChannelLiveNowAndNextInfo(entry){
        if(!global.activeEPG) throw 'epg not loaded'
        let channel = this.epgPrepareSearch(entry)
        let epgData = await global.lists.epg(channel, 2)
        if(typeof(epgData) == 'string') {
            throw 'epg is loading'
        }
        if(Array.isArray(epgData)){
            throw 'not found 1'
        }
        let now = Object.values(epgData).shift()
        if(now && now.t){
            let ret = {now}
            let ks = Object.keys(epgData)
            if(ks.length > 1){
                let start = ks.pop()
                let next = epgData[start]
                start = moment(start * 1000).fromNow()
                start = start.charAt(0).toUpperCase() + start.slice(1)
                ret[start] = next
            }
            return ret
        } else {
            throw 'not found 2'
        }
    }
    async epgChannelsLiveNow(entries){
        if(!global.activeEPG) throw 'epg not loaded'
        let channels = entries.map(e => this.epgPrepareSearch(e))
        let epgData = await global.lists.epg(channels, 1)
        let ret = {}
        Object.keys(epgData).forEach(ch => {
            ret[ch] = epgData[ch] ? Object.values(epgData[ch]).shift() : false
            if(!ret[ch] && ret[ch] !== false) ret[ch] = false
        })
        return ret
    }
    epgChannelsAddLiveNow(entries, keepIcon){
        return new Promise((resolve, reject) => {
            if(this.loadedEPG){
                const cs = entries.filter(e => e.terms || e.type == 'select').map(e => this.isChannel(e.name)).filter(e => e)
                this.epgChannelsLiveNow(cs).then(epg => {
                    //console.warn('epgChannelsAddLiveNow', cs, entries, epg)
                    entries.forEach((e, i) => {
                        if(typeof(epg[e.name]) != 'undefined' && epg[e.name].t){
                            if(entries[i].details){
                                entries[i].details += ' &middot; '+ epg[e.name].t
                            } else {
                                entries[i].details = epg[e.name].t
                            }
                            entries[i].programme = epg[e.name]
                        }
                    })
                }).catch(console.error).finally(() => resolve(entries))
            } else {
                resolve(entries)
            }
        })
    }
    adjustEPGChannelEntry(e, detached){
        return {
            name: global.lang.SELECT,
            fa: 'fas fa-th-large',
            type: 'group',
            renderer: async () => {
                return await this.adjustEPGChannelEntryRenderer(e, detached)
            }
        }
    }
    async adjustEPGChannelEntryRenderer(e, detached){
        const terms = this.entryTerms(e).filter(t => t.charAt(0) != '-')
        const options = [], results = await global.lists.epgSearchChannel(terms)
        //console.log('adjustEPGChannelEntryRenderer', e, terms, results)
        Object.keys(results).forEach(name => {
            let keys = Object.keys(results[name])
            if(!keys.length) return
            options.push({
                name,
                details: results[name][keys[0]].t,
                fa: 'fas fa-th-large',
                type: 'action',
                action: () => {
                    console.log('adjustEPGChannelEntryRenderer RESULT', e.name, name)
                    let map = global.config.get('epg-map') || {}
                    if(e.name != name){
                        map[e.name] = name
                    } else if(map[e.name]) {
                        delete map[e.name]
                    }
                    global.config.set('epg-map', map)
                    if(detached) {
                        global.streamer.aboutTrigger('epg-more').catch(console.error)
                    } else {
                        global.explorer.back(null, true)
                    }
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
        return options
    }
    epgProgramAction(start, ch, programme, terms, icon){
        const now = global.time()
        if(programme.e < now){ // missed
            let text = global.lang.START_DATE +': '+ global.moment(start * 1000).format('L LT') +'<br />'+ global.lang.ENDED +': '+ global.moment(programme.e * 1000).format('L LT')
            if(programme.c && programme.c.length){
                text += '<br />'+ global.lang.CATEGORIES +': '+ programme.c.join(', ')
            }
            global.explorer.dialog([
                {template: 'question', text: programme.t +' &middot; '+ ch, fa: 'fas fa-calendar-alt'},
                {template: 'message', text},
                {template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
            ], 'ok').catch(console.error)
        } else if(start <= (now + 300)){ // if it will start in less than 5 min, open it anyway
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
            if(programme.c && programme.c.length){
                text += '<br />'+ global.lang.CATEGORIES +': '+ programme.c.join(', ')
            }
            global.explorer.dialog([
                {template: 'question', text: programme.t +' &middot; '+ ch, fa: 'fas fa-calendar-alt'},
                {template: 'message', text},
                {template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
            ], 'ok').catch(console.error)
        }
    }
}

class ChannelsEditing extends ChannelsEPG {
    constructor(){
        super()
        global.ui.on('channels-import-file', data => {
            console.warn('!!! IMPORT FILE !!!', data)
            global.ui.importFileFromClient(data).then(ret => this.importFile(ret)).catch(err => {
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
                global.ui.emit('share', global.MANIFEST.window.title, e.name, 'https://megacubo.tv/w/' + encodeURIComponent(e.name))
            }
        }
    }
    editChannelEntry(o, _category, atts){ // category name
        let e = Object.assign({}, o), terms = this.entryTerms(o)
        Object.assign(e, {fa: 'fas fa-play-circle', type: 'group', details: global.lang.EDIT_CHANNEL})
        Object.assign(e, atts)
        e.renderer = async () => {
            const category = _category
            let entries = []
            if(global.config.get('show-logos')) {
                entries.push({
                    name: global.lang.SELECT_ICON, 
                    details: o.name, type: 'group', 
                    renderer: async () => {
                        let images = []
                        const ms = await global.icons.search(terms).catch(console.error)
                        Array.isArray(ms) && images.push(...ms.map(m => m.icon))
                        let ret = images.map((image, i) => {
                            const e =  {
                                name: String(i + 1) + String.fromCharCode(186),
                                type: 'action',
                                icon: image,
                                class: 'entry-icon-no-fallback',
                                fa: 'fa-mega spin-x-alt',
                                action: async () => {
                                    global.explorer.setLoadingEntries([e], true, global.lang.PROCESSING)
                                    let err
                                    const r = await global.icons.fetchURL(image)
                                    const ret = await global.icons.adjust(r.file, {shouldBeAlpha: false}).catch(global.displayErr)
                                    const destFile = await global.icons.saveDefaultFile(terms, ret.file).catch(e => err = e)
                                    this.emit('edited', 'icon', e, destFile)
                                    global.explorer.setLoadingEntries([e], false)
                                    if(err) throw err
                                    console.log('icon changed', terms, destFile)
                                    global.explorer.refreshNow()
                                    global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                }
                            }
                            return e
                        })
                        ret.push({name: global.lang.OPEN_URL, type: 'input', fa: 'fas fa-link', action: async (err, val) => {   
                            console.log('from-url', terms, '') 
                            const fetched = await global.icons.fetchURL(val)
                            const ret = await global.icons.adjust(fetched.file, {shouldBeAlpha: false})
                            const destFile = await global.icons.saveDefaultFile(terms, ret.file)
                            this.emit('edited', 'icon', e, destFile)
                            console.log('icon changed', terms, destFile)
                            global.explorer.refreshNow()
                            global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                        }})
                        ret.push({name: global.lang.NO_ICON, type: 'action', fa: 'fas fa-ban', action: async () => {
                            console.log('saveDefault', terms, '') 
                            await global.icons.saveDefaultFile(terms, 'no-icon')
                            this.emit('edited', 'icon', e, null)
                            global.explorer.refreshNow()
                            global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                        }})
                        console.warn('icons ret', ret)
                        return ret
                    }
                })
            }
            if(category) {
                const name = o.originalName || o.name
                entries.push(...[
                    {name: global.lang.RENAME, type: 'input', details: name, value: name, action: (data, val) => {
                        const category = _category
                        const name = o.originalName || o.name
                        console.warn('RENAME', name, 'TO', val, category)
                        if(val && val != name) {
                            let i = -1
                            this.categories[category].some((n, j) => {
                                if(n.substr(0, name.length) == name){
                                    i = j
                                    return true
                                }
                            })
                            if(i != -1){
                                let t = (o.terms || e.terms || terms)
                                t = t && t.name ? t.name : (Array.isArray(t) ? t.join(' ') : name)
                                this.categories[category][i] = this.compactName(val, t)
                                this.emit('edited', 'rename', e.name, val, e)
                                console.warn('RENAMED', this.categories[category][i], category, i)
                                this.save().then(() => {
                                    const category = _category
                                    console.warn('RENAMED*', this.categories[category][i], category, i)
                                    let destPath = global.explorer.path.replace(name, val).replace('/'+ global.lang.RENAME, '')
                                    console.log('opening', destPath)
                                    global.explorer.refresh(true, destPath)
                                    global.osd.show(global.lang.CHANNEL_RENAMED, 'fas fa-check-circle', 'channels', 'normal')
                                }).catch(console.error)
                            } 
                        }
                    }},
                    {name: global.lang.SEARCH_TERMS, type: 'input', value: () => {
                        let t = (o.terms || e.terms || terms)
                        t = t && t.name ? t.name : (Array.isArray(t) ? t.join(' ') : name)
                        return t
                    }, action: async (entry, val) => {
                        const category = _category
                        if(!this.categories[category]) return console.error('Category not found')
                        console.warn('ALIASES', this.categories[category], category, val, o)
                        let i = -1
                        this.categories[category].some((n, j) => {
                            if(n.substr(0, name.length) == name){
                                i = j
                                return true
                            }
                        })
                        if(i != -1){
                            this.channelsIndex = null
                            this.categories[category][i] = this.compactName(name, val)
                            this.emit('edited', 'searchTerms', e, val)
                            e.terms = o.terms = {name: global.lists.terms(val, true), group: []}
                            await this.save()
                            global.explorer.refreshNow()
                        }
                    }},
                    {name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'action', details: o.name, action: async () => {
                        const category = _category
                        console.warn('REMOVE', name)
                        if(!this.categories[category]) {
                            global.explorer.open(global.lang.LIVE).catch(displayErr)
                            return
                        }
                        this.categories[category] = this.categories[category].filter(c => {
                            return c.split(',')[0] != name
                        })
                        await this.save()
                        console.log('REMOVING')
                        global.explorer.refresh(true, global.explorer.dirname(global.explorer.dirname(global.explorer.path)))
                        global.osd.show(global.lang.CHANNEL_REMOVED, 'fas fa-check-circle', 'channels', 'normal')
                    }}
                ])
            }
            return entries
        };
        ['cnt', 'count', 'label', 'users'].forEach(k => { if(e[k]) delete e[k] })
        return e
    }
    getCategoryEntry(){
        return {name: global.lang.ADD_CATEGORY, fa: 'fas fa-plus-square', type: 'input', action: async (data, val) => {
            let categories = this.getCategories()
            if(val && !categories.map(c => c.name).includes(val)){
                console.warn('ADD', val)
                this.categories[val] = []
                await this.save()
                console.warn('saved', global.lang.LIVE +'/'+ val +'/'+ global.lang.EDIT_CATEGORY)
                delete global.explorer.pages[global.lang.LIVE]
                global.explorer.open(global.lang.LIVE +'/'+ val +'/'+ global.lang.EDIT_CATEGORY +'/'+ global.lang.EDIT_CHANNELS).catch(displayErr)
            }
        }}
    }
    editCategoriesEntry(){
        return {
            name: global.lang.EDIT_CHANNEL_LIST,
            type: 'group',
            fa: 'fas fa-tasks',
            renderer: async () => {
                this.disableWatchNowAuto = true
                return this.getCategories(false).map(c => this.editCategoryEntry(c, true))
            }
        }
    }
    editCategoryEntry(cat, useCategoryName){
        let category = Object.assign({}, cat)
        Object.assign(category, {fa: 'fas fa-tasks', path: undefined})
        if(useCategoryName !== true){
            Object.assign(category, {name: global.lang.EDIT_CATEGORY, rawname: global.lang.EDIT_CATEGORY, type: 'select', details: category.name})
        }
        category.renderer = async (c, e) => {
            this.disableWatchNowAuto = true
            let entries = [
                this.addChannelEntry(category, false),
                {name: global.lang.EDIT_CHANNELS, fa: 'fas fa-th', details: cat.name, type: 'group', renderer: () => {
                    return new Promise((resolve, reject) => {
                        let entries = c.entries.map(e => {
                            return this.editChannelEntry(e, cat.name, {})
                        })
                        entries.unshift(this.addChannelEntry(cat))
                        resolve(entries)
                    })
                }},
                {name: global.lang.RENAME_CATEGORY, fa: 'fas fa-edit', type: 'input', details: cat.name, value: cat.name, action: async (e, val) => {
                    console.warn('RENAME', cat.name, 'TO', val)
                    if(val && val != cat.name && typeof(this.categories[val]) == 'undefined'){
                        let o = this.categories[cat.name]
                        delete this.categories[cat.name]
                        this.categories[val] = o
                        await this.save()
                        let destPath = global.explorer.path.replace(cat.name, val).replace('/'+ global.lang.RENAME_CATEGORY, '')
                        global.explorer.refresh(true, destPath)
                        global.osd.show(global.lang.CATEGORY_RENAMED, 'fas fa-check-circle', 'channels', 'normal')
                    }
                }},
                {name: global.lang.REMOVE_CATEGORY, fa: 'fas fa-trash', type: 'action', details: cat.name, action: async () => {
                    delete this.categories[cat.name]
                    await this.save()
                    global.explorer.open(global.lang.LIVE).catch(displayErr)
                    global.osd.show(global.lang.CATEGORY_REMOVED, 'fas fa-check-circle', 'channels', 'normal')
                }}
            ]
            console.warn('editcat entries', entries)
            return entries
        }
        return category
    }
    addChannelEntry(cat, inline){
        return {
            name: global.lang.ADD_CHANNEL, 
            details: cat.name, 
            fa: 'fas fa-plus-square', 
            type: 'input', 
            placeholder: global.lang.CHANNEL_NAME, 
            action: async (data, val) => {
                const catName = cat.name
                console.warn('ADD', data, '|||', val)
                this.disableWatchNowAuto = true
                if(val && !Object.keys(this.categories).map(c => c.name).includes(val)){
                    console.warn('ADD', val, this.categories[catName], cat)
                    if(this.categories[catName] && !this.categories[catName].includes(val)){
                        this.categories[catName].push(val)
                        await this.save()
                        console.log('ADDING')
                        let targetPath = global.explorer.path
                        if(inline !== true){
                            targetPath = global.explorer.dirname(targetPath)
                        }
                        global.explorer.refreshNow()
                        global.osd.show(global.lang.CHANNEL_ADDED, 'fas fa-check-circle', 'channels', 'normal')
                    }
                }
            }
        }
    }
}

class ChannelsAutoWatchNow extends ChannelsEditing {
    constructor(){
        super()
        this.watchNowAuto = false
        this.disableWatchNowAuto = false
        global.uiReady(() => {
            global.explorer.on('render', (entries, path) => {
                if(path != this.watchNowAuto){
                    this.watchNowAuto = false
                }
            })
            global.streamer.on('stop-from-client', () => {
                this.watchNowAuto = false
            })
        })
    }
    autoplay(){
        const watchNowAuto = global.config.get('watch-now-auto')
        if(watchNowAuto == 'always') return true
        if(this.disableWatchNowAuto || watchNowAuto == 'never') return false
        return (watchNowAuto == 'auto' && this.watchNowAuto)
    }
}

class ChannelsKids extends ChannelsAutoWatchNow {
    constructor(){
        super()
        global.uiReady(() => {
            global.explorer.addFilter(async (entries, path) => { 
                const term = global.lang.CATEGORY_KIDS // lang can change in runtime, check the term here so
                if(path.substr(term.length * -1) == term){
                    entries = entries.map(e => {
                        if((e.rawname || e.name).indexOf('[') == -1 && (
                            (!e.type || e.type == 'stream') || 
                            (e.class && e.class.indexOf('entry-meta-stream') != -1)
                        )){
                            e.rawname = '[fun]'+ e.name +'[|fun]'
                        }
                        return e
                    })
                } else if([global.lang.LIVE, global.lang.CATEGORY_MOVIES_SERIES].includes(path)) {
                    entries = entries.map(e => {
                        if((e.rawname || e.name).indexOf('[') == -1 && e.name == term){
                            e.rawname = '[fun]'+ e.name +'[|fun]'
                        }
                        return e
                    })
                }
                return entries
            })
        })
    }
}

class Channels extends ChannelsKids {
    constructor(){
        super()
    }
    async goChannelWebsite(name){
        if(!name){
            if(global.streamer.active){
                name = global.streamer.active.data.originalName || global.streamer.active.data.name
            } else {
                return false
            }
        }
        let url = 'https://www.google.com/search?btnI=1&lr=lang_{0}&q={1}'.format(global.lang.locale, encodeURIComponent('"'+ name +'" site'))
        const body = String(await global.Download.get({url}).catch(console.error))
        const matches = body.match(new RegExp('href *= *["\']([^"\']*://[^"\']*)'))
        if(matches && matches[1] && matches[1].indexOf('google.com') == -1){
            url = matches[1]
        }        
        global.ui.emit('open-external-url', url)
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
	cmatch(needleTerms, stackTerms){ 
        // partial=true will match "starts with" terms too
        // the difference from lists.match() is that cmatch will check partials from stackTerms instead
		//console.log(needleTerms, stackTerms)
		if(needleTerms.includes('|')){
			let needles = needleTerms.join(' ').split('|').map(s => s.trim()).filter(s => s).map(s => s.split(' '))
			let score = 0
			needles.forEach(needle => {
				let s = this.cmatch(needle, stackTerms)
				if(s > score){
					score = s
				}
			})
			return score
		}
		if(needleTerms.length && stackTerms.length){
			let score = 0, sTerms = [], nTerms = []
			let excludeMatch = needleTerms.some(t => {
				if(t.charAt(0) == '-'){
					if(stackTerms.includes(t.substr(1))){
						return true
					}
				} else {
					nTerms.push(t)
				}
			}) || stackTerms.some(t => {
				if(t.charAt(0) == '-'){
					if(needleTerms.includes(t.substr(1))){
						return true
					}
				} else {
					sTerms.push(t)
				}
			})
			if(excludeMatch || !sTerms.length || !nTerms.length){
				return 0
			}
			nTerms.forEach(term => {
                let len = term.length
                sTerms.some(strm => {
                    //console.log(term, strm)
                    if(len == strm.length){
                        if(strm == term){
                            score++
                            return true
                        }
                    } else if(term.length > strm.length && strm == term.substr(0, strm.length)){
                        score++
                        return true
                    }
                })
			})
			if(score){
				if(score == sTerms.length) { // all search terms are present
					if(score == nTerms.length){ // terms are equal
						return 3
					} else {
						return 2
					}
				} else if(sTerms.length >= 3 && score == (sTerms.length - 1)){
					return 1
				}
			}
		}
		return 0
	}
    isChannel(terms){
        let tms, chs = this.channelsIndex || {}
        if(Array.isArray(terms)){
            tms = terms
        } else {
            if(typeof(chs[terms]) != 'undefined'){
                tms = chs[terms]
            } else {
                tms = global.lists.terms(terms, true)
            }
        }
        let chosen, chosenScore = -1
        Object.keys(chs).forEach(name => {
            let score = global.lists.match(chs[name], tms, false)
            if(score){
                if(score > chosenScore){
                    chosen = name
                    chosenScore = score
                }
            }
        })
        if(chosenScore > 1){
            if(typeof(this.isChannelCache[chosen]) == 'undefined'){
                let alts = {}, excludes = [], chTerms = global.deepClone(chs[chosen])
                Object.keys(chs).forEach(name => {
                    if(name == chosen) return
                    let score = global.lists.match(chTerms, chs[name], false)
                    if(score){
                        alts[name] = chs[name]
                    }
                })
                const skipChrs = ['-', '|']
                Object.keys(alts).forEach(n => {
                    excludes.push(...alts[n].filter(t => {
                        return !skipChrs.includes(t.charAt(0)) && !chTerms.includes(t)
                    }))
                })
                excludes = excludes.unique()
                const seemsRadio = chTerms.some(c => this.radioTerms.includes(c))
                chTerms = chTerms.join(' ').split(' | ').map(s => s.split(' ')).filter(s => s).map(t => {
                    t.push(...excludes.map(s => '-' + s))
                    if(!seemsRadio){
                        this.radioTerms.forEach(rterm => {
                            if(!t.some(cterm => cterm.substr(0, rterm.length) == rterm)){ // this radio term can mess with our search (specially AM)
                                t.push('-'+ rterm)
                            }
                        })
                    }
                    return t
                }).map(s => s.join(' ')).join(' | ').split(' ')
                this.isChannelCache[chosen] = {name: chosen, terms: chTerms, alts, excludes}
            }
            return this.isChannelCache[chosen]
        }
    }
    expandTerms(terms){
        if(typeof(terms) == 'string'){
            terms = global.lists.terms(terms)
        }
        let ch = this.isChannel(terms)
        if(ch){
            return ch.terms
        }
        return terms
    }
    async get(terms){
        if(typeof(terms) == 'string'){
            terms = global.lists.terms(terms)
        }
        console.warn('channels.get', terms)
        let ret = await global.lists.search(terms, {
            safe: !global.lists.parentalControl.lazyAuth(),
            type: 'live',
            limit: 1024
        })
        let entries = ret.results
        await global.watching.order(entries).then(es => entries = es).catch(console.error)
        return entries
    }
    search(terms, partial){
        return new Promise((resolve, reject) => {
            if(typeof(terms) == 'string'){
                terms = global.lists.terms(terms)
            }
            let epgEntries = [], entries = [], already = {}
            Object.keys(this.channelsIndex).sort().forEach(name => {
                if(typeof(already[name]) == 'undefined'){
                    let score = this.cmatch(this.channelsIndex[name], terms, partial)
                    if(score){
                        already[name] = null
                        entries.push({
                            name,
                            terms: {name: this.channelsIndex[name]}
                        })
                    }
                }
            })
            console.log(global.deepClone(entries))
            this.epgChannelsAddLiveNow(entries, true).then(es => {
                this.epgSearch(terms, true).then(ees => {
                    epgEntries = ees.map(e => {
                        let ch = this.isChannel(e.programme.ch)
                        if(ch){
                            if(typeof(already[ch.name]) == 'undefined'){
                                already[ch.name] = null
                                if(e.details){
                                    e.details = e.details.replace(e.programme.ch, ch.name)
                                }
                                e.programme.ch = ch.name
                                return e
                            }
                        }
                    }).filter(e => !!e)
                }).catch(console.error).finally(() => {
                    es.push(...epgEntries)
                    resolve(es)
                })
            }).catch(reject)
            
        })
    }
    entryTerms(e){
        let terms
        if(e.originalName) {
            terms = global.lists.terms(e.originalName)
        } else if(Array.isArray(e.terms) && e.terms.length) {
            terms = e.terms
        } else if(typeof(e.terms) != 'undefined' && typeof(e.terms.name) != 'undefined' && Array.isArray(e.terms.name) && e.terms.name.length) {
            terms = e.terms.name
        } else {
            terms = global.lists.terms(e.programme ? e.programme.ch : e.name)
        }
        return this.expandTerms(terms)
    }
    async toMetaEntryRenderer(e, _category, epgNow){
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
        let terms = this.entryTerms(e), streamsEntry, epgEntry, entries = [], moreOptions = [], url = e.url
        if(!url){
            let name = e.programme ? e.programme.ch : e.name
            let ch = this.isChannel(name)
            if(ch){
                name = ch.name
                terms = ch.terms
            }
            e.url = url = global.mega.build(name, {terms})
        }
        const autoplay = this.autoplay(), streams = await this.get(terms)
        streams.forEach((e, i) => {
            if(!streams[i].group){
                streams[i].group = category
            }
        })
        if(autoplay){
            if(streams.length){
                global.streamer.play(e, streams)
                return -1
            } else {
                throw global.lang.NONE_STREAM_FOUND
            }
        } else {
            if(streams.length){
                let call = global.lists.mi.isRadio(e.name +' '+ category) ? global.lang.LISTEN_NOW : global.lang.WATCH_NOW
                entries.push({
                    name: call, 
                    type: 'action',
                    fa: 'fas fa-play-circle',
                    url,
                    group: category,
                    action: data => {
                        data.name = e.name
                        global.streamer.play(data, streams)
                        this.watchNowAuto = global.explorer.path
                    }
                })
                streamsEntry = {
                    name: global.lang.STREAMS + ' (' + streams.length + ')', 
                    type: 'group', 
                    renderer: async () => streams
                }
                if(this.loadedEPG){
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
                if(global.lists.activeLists.my.length) {
                    global.lists.manager.checkListExpiral(
                        global.lists.activeLists.my.map(source => ({source}))
                    ).catch(console.error)
                }
            }
        }
        if(entries.length){
            let bookmarkable = {name: e.name, type: 'stream', label: e.group || '', url}
            if(global.bookmarks.has(bookmarkable)){
                entries.push({
                    type: 'action',
                    fa: 'fas fa-star-half',
                    name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                    action: () => {
                        global.bookmarks.remove(bookmarkable)
                        global.explorer.refreshNow()
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
                        global.explorer.refreshNow()
                        global.osd.show(global.lang.BOOKMARK_ADDED.format(bookmarkable.name), 'fas fa-star', 'bookmarks', 'normal')
                    }
                })
            } 
        }
        if(epgEntry){
            entries.push(epgEntry)
        }
        if(streamsEntry){
            moreOptions.push(this.shareChannelEntry(e))
            moreOptions.push(streamsEntry)
        }
        if(!global.config.get('channel-grid') && global.config.get('allow-edit-channel-list')){
            const editEntry = this.editChannelEntry(e, category, {name: category ? global.lang.EDIT_CHANNEL : global.lang.EDIT, details: undefined, class: 'no-icon', fa: 'fas fa-edit', users: undefined, usersPercentage: undefined, path: undefined, url: undefined})
            moreOptions.push(editEntry)
        }
        moreOptions.push({
            type: 'action',
            fa: 'fas fa-globe',
            name: global.lang.CHANNEL_WEBSITE,
            action: () => {
                this.goChannelWebsite(e.name).catch(global.displayErr)
            }
        })
        entries.push({name: global.lang.MORE_OPTIONS, type: 'select', fa: 'fas fa-ellipsis-v', entries: moreOptions})
        return entries.map(e => {
            if(e.renderer || e.entries) {
                let originalRenderer = e.renderer || e.entries
                e.renderer = data => {
                    if(data.name != global.lang.WATCH_NOW){
                        this.disableWatchNowAuto = true // learn that the user is interested in other functions instead of watchNow directly
                    }
                    if(Array.isArray(originalRenderer)){
                        return new Promise(resolve => resolve(originalRenderer))                                
                    } else {
                        return originalRenderer(data)
                    }
                }
            }
            if(e.action) {
                let originalAction = e.action
                e.action = data => {
                    if(data.name != global.lang.WATCH_NOW){
                        this.disableWatchNowAuto = true // learn that the user is interested in other functions instead of watchNow directly
                    }
                    return originalAction(data)
                }
            }
            return e
        })
    }
    toMetaEntry(e, category, details){
        let meta = Object.assign({}, e), terms = this.entryTerms(e)        
        if(typeof(meta.url) == 'undefined'){
            let name = e.name
            if(e.programme && e.programme.ch){
                name = e.programme.ch
            }
            const ch = this.isChannel(name)
            if(ch && ch.name){
                name = ch.name
                terms = ch.terms
            }
            meta.url = global.mega.build(name, {terms})
        }
        if(global.mega.isMega(meta.url)){
            let atts = Object.assign({}, global.mega.parse(meta.url))
            Object.assign(atts, meta)
            if(['all', 'video'].includes(atts.mediaType)){
                Object.assign(meta, {
                    type: 'group',
                    class: 'entry-meta-stream',
                    fa: 'fas fa-play-circle' ,
                    renderer: async () => {
                        let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : global.lists.terms(atts.name, true)
                        let es = await global.lists.search(terms, {
                            type: atts.mediaType,
                            group: true,
                            safe: !global.lists.parentalControl.lazyAuth(),
                            limit: 1024
                        })
                        return global.lists.tools.paginateList(es.results)
                    }
                })
            } else {
                Object.assign(meta, {
                    type: 'select',
                    class: 'entry-meta-stream',
                    fa: 'fas fa-play-circle',
                    renderer: () => this.toMetaEntryRenderer(atts, category, details)
                })
            }
        }
        if(details){
            meta.details = details
        }
        return meta
    }
    keywords(){
        return new Promise((resolve, reject) => {
            this.ready(() => {
                let keywords = [], badChrs = ['|', '-']
                this.getDefaultCategories().then(data => {
                    keywords.push(...Object.values(data).flat().map(n => this.expandName(n).terms.name).flat())
                }).catch(reject).finally(() => {
                    keywords = keywords.unique().filter(w => !badChrs.includes(w.charAt(0)))
                    resolve(keywords)
                })
            })
        })
    }
    async setGridType(type){
        global.osd.show(global.lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'channel-grid', 'persistent')
        global.config.set('channel-grid', type)
        let err
        await this.load().catch(e => err = e)
        if(err) return global.osd.show(err, 'fas fa-exclamation-triangle faclr-red', 'channel-grid', 'normal')
        this.emit('channel-grid-updated')
        global.explorer.once('render', () => {
            global.osd.show('OK', 'fas fa-check-circle faclr-green', 'channel-grid', 'normal')
        })
        global.explorer.refreshNow()
    }
    async entries(){
        if(!global.lists.loaded()){
            return [global.lists.manager.updatingListsEntry()]
        }
        if(!global.lists.activeLists.length){ // one list available on index beyound meta watching list
            return [global.lists.manager.noListsEntry()]
        }
        let list
        const type = global.config.get('channel-grid')
        const editable = !type && global.config.get('allow-edit-channel-list')
        if(type == 'lists') {
            list = await this.groupsRenderer('live')
        } else {
            const categories = this.getCategories()
            list = categories.map(category => {
                category.renderer = async (c, e) => {
                    let times = {}, startTime = global.time()
                    let channels = category.entries.map(e => this.isChannel(e.name)).filter(e => !!e)
                    const ret = await global.lists.has(channels, {
                        partial: false
                    })
                    times['has'] = global.time() - startTime
                    let entries = category.entries.filter(e => ret[e.name])
                    entries = entries.map(e => this.toMetaEntry(e, category))
                    times['meta'] = global.time() - startTime - times['has']
                    entries = await this.epgChannelsAddLiveNow(entries, true)
                    entries = this.sortCategoryEntries(entries)
                    if(editable){
                        entries.push(this.editCategoryEntry(c))
                    }
                    times['epg'] = global.time() - startTime - times['has'] - times['meta']
                    return entries
                }
                return category
            })
            list = global.lists.sort(list)
        }
        if(editable){
            list.push(this.getCategoryEntry())
        }
        list.unshift(this.chooseChannelGridOption())
        return list
    }
    chooseChannelGridOption(epgFocused){
        return {
            name: global.lang.CHOOSE_CHANNEL_GRID,
            type: 'select',
            fa: 'fas fa-th',
            renderer: async () => {
                const def = global.config.get('channel-grid'), opts = [
                    {name: global.lang.DEFAULT +' ('+ global.lang.RECOMMENDED +')', type: 'action', selected: !def, action: () => {
                        this.setGridType('').catch(console.error)
                    }},
                    {name: global.lang.EPG, type: 'action', selected: def == 'epg', action: () => {
                        this.setGridType('epg').catch(console.error)
                    }}
                ]
                if(epgFocused !== true) {
                    opts.push(...[
                        {name: global.lang.IPTV_LISTS, type: 'action', selected: def == 'lists', action: () => {
                            this.setGridType('lists').catch(console.error)
                        }},
                        this.exportImportOption()
                    ])
                }
                if(global.config.get('parental-control') != 'remove') {
                    opts.splice(3, 0, {name: global.lang.ADULT_CONTENT, type: 'action', selected: def == 'xxx', action: () => {
                        this.setGridType('xxx').catch(console.error)
                    }})
                }
                return opts
            }
        }
    }
    sortCategoryEntries(entries){
        entries = global.lists.sort(entries)                                
        const policy = global.config.get('channels-list-smart-sorting')
        /*
        0 = Focus on EPG data.
        1 = Focus on channels, without EPG images.
        2 = Focus on channels, with EPG images.
        */
        switch(policy){
            case 1:
                break
                entries = entries.map(e => {
                    delete e.programme
                    return e
                })
            case 2:
                break
            default: // 0
                const adjust = es => {
                    return global.lists.sort(es.map(e => {
                        e.details = e.name
                        e.name = e.programme.t
                        return e
                    }))
                }
                let noEPG = [], noEPGI = []
                entries = entries.filter(e => {
                    if(!e.programme){
                        noEPG.push(e)
                        return false
                    }
                    return true
                })
                entries = adjust(entries)
                entries.push(...noEPG)
                break
        }
        return entries
    }
    importFile(data){
        console.log('Categories file', data)
        try {
            data = global.parseJSON(data)
            if(typeof(data) == 'object'){
                this.setCategories(data)
                global.osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal')
            } else {
                throw new Error('Not a JSON file.')
            }
        } catch(e) {
            global.displayErr('Invalid file', e)
        }
    }
    exportImportOption(){
        return {
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
                            if(err) return global.displayErr(err)
                            global.downloads.serve(file, true, false).catch(global.displayErr)
                        })
                    }
                },
                {
                    name: global.lang.IMPORT,
                    type: 'action',
                    fa: 'fas fa-file-import', 
                    action: () => {
                        global.config.set('channel-grid', '')
                        global.ui.emit('open-file', global.ui.uploadURL, 'channels-import-file', 'application/json', global.lang.IMPORT)
                    }
                },
                {
                    name: global.lang.RESET,
                    type: 'action',
                    fa: 'fas fa-undo-alt', 
                    action: async () => {
                        global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'options', 'persistent')
                        delete this.categories
                        await global.storage.raw.promises.delete(this.categoriesCacheKey).catch(console.error)
                        global.config.set('channel-grid', '')
                        await this.load()
                        global.osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal')
                    }
                }
            ]
        }
    }
    options(){
        return new Promise((resolve, reject) => {
            let entries = []
            if(!global.config.get('channel-grid') && global.config.get('allow-edit-channel-list')){
                entries.push(this.editCategoriesEntry())
            }
            entries.push(...[
                this.exportImportOption(),
                global.lists.manager.listsEntry(true),
                {
                    name: global.lang.ALLOW_EDIT_CHANNEL_LIST,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('allow-edit-channel-list', checked)
                        global.explorer.refreshNow()
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
                        global.watching.update().catch(console.error)
                    }, 
                    checked: () => {
                        return global.config.get('only-known-channels-in-been-watched')
                    }
                },
                {
                    name: global.lang.CHANNEL_LIST_SORTING,
                    type: 'select',
                    fa: 'fas fa-sort-alpha-down',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            let def = global.config.get('channels-list-smart-sorting'), opts = [
                                {name: global.lang.FOCUS_ON_TV_SHOWS, type: 'action', selected: (def == 0), action: () => {
                                    global.config.set('channels-list-smart-sorting', 0)
                                }},
                                {name: global.lang.FOCUS_ON_CHANNELS_WITH_TV_SHOW_IMAGES, type: 'action', selected: (def == 1), action: () => {
                                    global.config.set('channels-list-smart-sorting', 1)
                                }},
                                {name: global.lang.FOCUS_ON_CHANNELS, type: 'action', selected: (def == 2), action: () => {
                                    global.config.set('channels-list-smart-sorting', 2)
                                }}
                            ]
                            resolve(opts)
                        })
                    }
                },
                {
                    name: global.lang.CHOOSE_WATCH_NOW_AUTOMATICALLY.format(global.lang.WATCH_NOW),
                    type: 'select',
                    fa: 'fas fa-step-forward',
                    renderer: () => {
                        return new Promise((resolve, reject) => {
                            let def = global.config.get('watch-now-auto'), opts = [
                                {name: global.lang.AUTO, type: 'action', selected: (def == 'auto'), action: data => {
                                    global.config.set('watch-now-auto', 'auto')
                                }},
                                {name: global.lang.ALWAYS, type: 'action', selected: (def == 'always'), action: data => {
                                    global.config.set('watch-now-auto', 'always')
                                }},
                                {name: global.lang.NEVER, type: 'action', selected: (def == 'never'), action: data => {
                                    global.config.set('watch-now-auto', 'never')
                                }}
                            ]
                            resolve(opts)
                        })
                    }
                }
            ])
            resolve(entries)
        })
    }
    async groupsRenderer(type, opts={}){
        if(!global.lists.loaded()){
            return [global.lists.manager.updatingListsEntry()]
        }
        if(!global.lists.activeLists.length){ // one list available on index beyound meta watching list
            return [global.lists.manager.noListsEntry()]
        }
        const isSeries = type == 'series'
        let groups = await global.lists.groups(type ? [type] : ['series', 'vod'])
        const acpolicy = global.config.get('parental-control')        
        const groupToEntry = group => {
            const name = group.name
            const details = group.group.split('/').filter(n => n != name).join(' &middot; ')
            return {
                name,
                details,
                type: 'group',
                icon: isSeries ? group.icon : undefined,
                safe: true,
                class: isSeries ? 'entry-cover' : undefined,
                fa: isSeries ? 'fas fa-play-circle' : undefined,
                renderer: async () => {
                    return await renderer(group)
                }
            }
        }
        const parentalFilter = entries => {
            if(acpolicy == 'block'){
                entries = global.lists.parentalControl.filter(entries)
            } else if(acpolicy == 'remove'){
                entries = global.lists.parentalControl.filter(entries)		
            } else if(acpolicy == 'only') {
                entries = global.lists.parentalControl.only(entries)
            }
            return entries
        }        
        const renderer = async group => {
            console.error('GROUP='+ JSON.stringify(group))
            let entries = await global.lists.group(group).catch(console.error)
            if(Array.isArray(entries)) {
                let gentries = (group.entries || []).map(g => groupToEntry(g))
                while(entries.length == 1){
                    const entry = entries[0]
                    if(entry.entries){
                        entries = entry.entries
                    } else if(typeof(entry.renderer) == 'function') {
                        entries = await entry.renderer(entry)
                    } else if(typeof(entry.renderer) == 'string') {
                        entries = await global.storage.temp.promises.get(entry.renderer)
                    } else {
                        break
                    }
                }
                gentries.push(...entries)
                gentries = parentalFilter(gentries).sortByProp('name')
                const deepEntries = await global.lists.tools.deepify(gentries, {source: group.url}).catch(console.error)
                if(Array.isArray(deepEntries)) {
                    gentries = deepEntries
                }
                return gentries
            } else {
                process.nextTick(() => global.explorer.back(null, true))
                return []
            }
        }
        let pentries = parentalFilter(groups).map(group => groupToEntry(group))
        const deepEntries = await global.lists.tools.deepify(pentries).catch(console.error)
        if(Array.isArray(deepEntries)) {
            pentries = deepEntries
        }
        return pentries
    }
    async hook(entries, path){
        if(!path) {
            const liveEntry = {name: global.lang.LIVE, fa: 'fas fa-tv', details: '<i class="fas fa-satellite-dish"></i>&nbsp; '+ global.lang.CATEGORIES, type: 'group', renderer: this.entries.bind(this)}
            const moviesEntry = {name: global.lang.CATEGORY_MOVIES_SERIES,  fa: 'fas fa-th', details: '', type: 'group', renderer: () => this.groupsRenderer('')}
            global.options.insertEntry(liveEntry, entries, 1, global.lang.MY_LISTS)
            global.options.insertEntry(moviesEntry, entries, 2, global.lang.MY_LISTS)
        }
        return entries
    }
}

module.exports = Channels
