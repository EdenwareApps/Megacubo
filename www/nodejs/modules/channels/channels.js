const { EventEmitter } = require('events')

class ChannelsList extends EventEmitter {
    constructor(type, countries) {
        super()
        this.type = type
        this.countries = countries
        this.key = 'categories-'+ countries.join('-')
        this.isChannelCache = {}
        this.channelsIndex = {}
        this.categories = {}
        this.key += '-'+ this.type        
    }
    ready() {
        return new Promise(resolve => {
            if(this.loaded) return resolve()
            this.once('loaded', resolve)
        })
    }
    async load(refresh) {
        let fine, data = await global.storage.get(this.key).catch(console.error)
        if(data){
            this.categories = data
            fine = true
        }
        if(!fine || refresh) {
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
                await this.save(this.key)
                fine = true
            }
        }
        this.updateChannelsIndex(false)
        if(!this.categories || typeof(this.categories) != 'object'){
            this.categories = {}
        }
        this.loaded = true
        this.emit('loaded')
        global.rendererReady(() => global.menu.updateHomeFilters())
    }
    async reset() {        
        delete this.categories
        await global.storage.delete(this.key).catch(console.error)
        global.config.set('channel-grid', '')
        await this.load(true)
    }
    async getAdultCategories(){
        const cloud = require('../cloud')
        return await cloud.get('channels/adult')
    }
    async getEPGCategories() {
        const lists = require('../lists')
        const data = await lists.epgLiveNowChannelsList()
        return data.categories
    }
    async getPublicListsCategories() {
        const ret = {}
        const discovery = require('../discovery')
        await discovery.ready()
        const groups = await discovery.providers.find(p => p[1] == 'public')[0].entries(true, true)
        for(const group of groups) {
            if(!group.renderer) continue
            const entries = await group.renderer(group).catch(console.error)
            if(Array.isArray(entries)) {
                ret[group.name] = entries.filter(e => e.type != 'action').map(e => e.name).unique()
            }
        }
        return ret
    }
    async getListsCategories() {
        const ret = {}
        const lists = require('../lists')
        const groups = await lists.groups(['live'], true)
        for(const group of groups) {
            const entries = await lists.group(group).catch(console.error)
            if(Array.isArray(entries)) {
                let es = entries.map(e => {
                    return e.name.split(' ').filter(w => {
                        return w && !lists.stopWords.includes(w.toLowerCase())
                    }).join(' ')
                }).unique()
                if(es.length) ret[group.name] = es
            }
        }
        return ret
    }
    async getAppRecommendedCategories(amount=256) {
        let data = {}
        const cloud = require('../cloud')
        const completed = c => {
            return this.mapSize(data) >= amount
        }
        for(const country of this.countries) {
            let err
            const isMainCountry = this.countries[0] == country
            if(!isMainCountry && completed()) break
            const map = await cloud.get('channels/'+ country).catch(e => err = e)
            if(err) continue
            data = await this.applyMapCategories(map, data, amount, !isMainCountry)
        }
        return data
    }
    updateChannelsIndex(refresh){
        if(refresh === true || !this.channelsIndex || !Object.keys(this.channelsIndex).length){
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
    async getDefaultCategories(){
        switch(this.type) {
            case 'public':
                return await this.getPublicListsCategories()
            case 'lists':
                return await this.getListsCategories()
            case 'xxx':
                return await this.getAdultCategories()
            case 'epg':
                return await this.getEPGCategories()
        }
        return await this.getAppRecommendedCategories()
    }   
    getCategories(compact){
        return compact ? this.categories : this.expand(this.categories)
    }
    async setCategories(data, silent){
        this.categories = data
        this.channelsIndex = null
        await this.save()
        console.log('Categories file imported')
        if(silent !== true){
            global.osd.show(global.lang.IMPORTED_FILE, 'fas fa-check-circle', 'options', 'normal')
        }
    }
    compactName(name, terms){
        if(terms && terms.length > 1 && terms != name){
            name += ', ' + (typeof(terms) == 'string' ? terms : terms.join(' '))
        }
        return name
    }
    expandName(name){
        const lists = require('../lists')
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
        terms = lists.terms(terms)
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
    async save(){
        let ordering = {}
        Object.keys(this.categories).sort().forEach(k => {
            if(!Array.isArray(this.categories[k])) return
            ordering[k] = this.categories[k].map(String).sort((a, b) => { // TypeError: a.indexOf is not a function
                let aa = a.indexOf(',')
                let bb = b.indexOf(',')
                aa = aa == -1 ? a : a.substr(0, aa)
                bb = bb == -1 ? b : b.substr(0, bb)
                return aa > bb ? 1 : -1
            })
        })
        this.categories = ordering
        this.updateChannelsIndex(true)
        await global.storage.set(this.key, this.categories, {
            permanent: true,
            expiration: true
        })
    }
    destroy() {
        this.destroyed = true
        this.loaded = true
        this.emit('loaded')
    }
}

class ChannelsData extends EventEmitter {
    constructor(){
        super()
        this.emptyEntry = {
            name: global.lang.EMPTY, 
            type: 'action', 
            fa: 'fas fa-info-circle', 
            class: 'entry-empty'
        }
		global.config.on('change', async (keys, data) => {
            if(['parental-control', 'parental-control-terms', 'lists'].some(k => keys.includes(k))){
                await this.load(true)
            }
        })
        this.radioTerms = ['radio', 'fm', 'am']
        this.load().catch(console.error)

        const lists = require('../lists')
        lists.manager.waitListsReady().then(() => this.load()).catch(console.error)
    }
    ready(cb){
        if(this.loaded){
            cb()
        } else {
            this.once('loaded', cb)
        }
    }
    async load(refresh){
        const lists = require('../lists')
        const hasOwnLists = global.config.get('lists').length
        const publicMode = global.config.get('public-lists') && !lists.loaded(true) // no list available on index beyound public lists
        const countries = await global.lang.getActiveCountries(0)
        const parentalControlActive = ['remove', 'block'].includes(global.config.get('parental-control'))
        let type = global.config.get('channel-grid')
        if(!type || (type == 'lists' && !hasOwnLists) || (type == 'xxx' && parentalControlActive)) {
            type = hasOwnLists ? 'lists' : (publicMode ? 'public' : 'app')
        }
        if(
            !this.channelList || 
            this.channelList.type != type || 
            JSON.stringify(this.channelList.countries) != JSON.stringify(countries)
        ) {
            this.channelList && this.channelList.destroy()
            this.channelList = new ChannelsList(type, countries)
        }
        await this.channelList.load(refresh)
        this.loaded = true
        this.emit('loaded')
    }
}

class ChannelsEPG extends ChannelsData {
    constructor(){
        super()
        this.epgStatusTimer = false
        this.epgIcon = 'fas fa-th'
        this.clockIcon = '<i class="fas fa-clock"></i> '
        const aboutInsertEPGTitle = async data => {
            const streamer = require('../streamer/main')
            if(streamer.active.mediaType != 'live'){
                throw 'local file'
            }
            if(!this.isChannel(streamer.active.data.originalName || streamer.active.data.name)){
                throw 'not a channel'
            }
            const ret = await this.epgChannelLiveNowAndNext(streamer.active.data)
            let ks = Object.keys(ret)
            return ks.map((k, i) => {
                if(i == 0){
                    return {template: 'question', text: ret[k]}
                } else {
                    return {template: 'message', text: k +': '+ ret[k]}
                }
            })
        }
        global.renderer.once('streamer-ready', () => {
            const streamer = require('../streamer/main')
            streamer.aboutRegisterEntry('epg', aboutInsertEPGTitle, null, 1)
            streamer.aboutRegisterEntry('epg', aboutInsertEPGTitle, null, 1, true)
            streamer.aboutRegisterEntry('epg-more', () => {
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
                        global.menu.render(entries, global.lang.EPG, 'fas fa-plus', '/')
                        global.renderer.emit('menu-playing')
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
                        const search = require('../search')
                        let path = global.menu.path.split('/').filter(s => s != global.lang.SEARCH).join('/')
                        entries.unshift(this.epgSearchEntry())
                        global.menu.render(entries, path + '/' + global.lang.SEARCH, 'fas fa-search', path)
                        search.history.add(value)
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
            const lists = require('../lists')
            if(typeof(terms) == 'string'){
                terms = lists.terms(terms)
            }
            lists.epgSearch(terms, liveNow).then(epgData => {                                
                let entries = []
                console.warn('epgSearch', epgData)
                Object.keys(epgData).forEach(ch => {
                    let terms = lists.terms(ch)
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
        const lists = require('../lists')
        if(typeof(limit) != 'number') limit = 72
        let data = this.epgPrepareSearch(e)
        return await lists.epg(data, limit)
    }
    async epgChannelEntries(e, limit, detached){
        const lists = require('../lists')
        if(typeof(limit) != 'number'){
            limit = 72
        }
        let data = this.epgPrepareSearch(e)
        const epgData = await lists.epg(data, limit)
        let centries = []
        if(epgData){
            if(typeof(epgData[0]) != 'string'){
                centries = this.epgDataToEntries(epgData, data.name, data.terms)
                if(!centries.length){
                    centries.push(global.menu.emptyEntry(global.lang.NOT_FOUND))
                }
            }
        }
        centries.unshift(this.adjustEPGChannelEntry(e, detached))
        return centries
    }
    async epgChannelLiveNow(entry){
        if(!global.activeEPG) throw 'epg not loaded'
        const lists = require('../lists')
        let channel = this.epgPrepareSearch(entry)
        let epgData = await lists.epg(channel, 1)
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
        const lists = require('../lists')
        let channel = this.epgPrepareSearch(entry)
        let epgData = await lists.epg(channel, 2)
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
                const moment = require('moment-timezone')
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
        const lists = require('../lists')
        let channels = entries.map(e => this.epgPrepareSearch(e))
        let epgData = await lists.epg(channels, 1)
        let ret = {}
        Object.keys(epgData).forEach(ch => {
            ret[ch] = epgData[ch] ? Object.values(epgData[ch]).shift() : false
            if(!ret[ch] && ret[ch] !== false) ret[ch] = false
        })
        return ret
    }
    async epgChannelsAddLiveNow(entries, keepIcon){
        if(this.loadedEPG){
            let err
            const cs = entries.filter(e => e.terms || e.type == 'select').map(e => this.isChannel(e.name)).filter(e => e)
            const epg = await this.epgChannelsLiveNow(cs).catch(e => err = e)
            if(!err && epg) {
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
            }
        }
        return entries
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
        const lists = require('../lists')
        const terms = this.entryTerms(e).filter(t => !t.startsWith('-'))
        const options = [], results = await lists.epgSearchChannel(terms, 99)
        //console.log('adjustEPGChannelEntryRenderer', e, terms, results)
        Object.keys(results).forEach(name => {
            let keys = Object.keys(results[name])
            if(!keys.length) return
            let details = results[name][keys[0]].t
            if(keys.length > 1) {
                details += '&nbsp;<span style="opacity: var(--opacity-level-3);">&middot;</span> +'+ (keys.length - 1)
            }
            options.push({
                name,
                details,
                fa: 'fas fa-th-large',
                type: 'action',
                icon: results[name][keys[0]].i,
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
                        const streamer = require('../streamer/main')
                        streamer.aboutTrigger('epg-more').catch(console.error)
                    } else {
                        global.menu.back(null, true)
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
                global.menu.back(null, true)
            }
        })
        //console.log('adjustEPGChannelEntryRenderer', options)
        return options
    }
    epgProgramAction(start, ch, programme, terms, icon){
        const now = global.time()
        if(programme.e < now){ // missed
            const moment = require('moment-timezone')
            let text = global.lang.START_DATE +': '+ moment(start * 1000).format('L LT') +'<br />'+ global.lang.ENDED +': '+ moment(programme.e * 1000).format('L LT')
            if(programme.c && programme.c.length){
                text += '<br />'+ global.lang.CATEGORIES +': '+ programme.c.join(', ')
            }
            global.menu.dialog([
                {template: 'question', text: programme.t +' &middot; '+ ch, fa: 'fas fa-calendar-alt'},
                {template: 'message', text},
                {template: 'option', id: 'ok', fa: 'fas fa-check-circle', text: 'OK'}
            ], 'ok').catch(console.error)
        } else if(start <= (now + 300)){ // if it will start in less than 5 min, open it anyway
            const streamer = require('../streamer/main')
            const mega = require('../mega')
            let url = mega.build(ch, {terms})
            streamer.play({
                name: ch,
                type: 'stream', 
                fa: 'fas fa-play-circle',
                icon, 
                url,
                terms: {name: terms, group: []}
            })
        } else {            
            const moment = require('moment-timezone')
            let text = global.lang.START_DATE +': '+ moment(start * 1000).format('L LT')
            if(programme.c && programme.c.length){
                text += '<br />'+ global.lang.CATEGORIES +': '+ programme.c.join(', ')
            }
            global.menu.dialog([
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
    } 
    shareChannelEntry(e){
        return {
            name: global.lang.SHARE,
            type: 'action',
            fa: 'fas fa-share-alt',
            action: () => {
                global.renderer.emit('share', global.paths.manifest.window.title, e.name, 'https://megacubo.tv/w/' + encodeURIComponent(e.name))
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
                        const icons = require('../icon-server')
                        let images = []
                        const ms = await icons.search(terms).catch(console.error)
                        Array.isArray(ms) && images.push(...ms.map(m => m.icon))
                        let ret = images.map((image, i) => {
                            const e =  {
                                name: String(i + 1) + String.fromCharCode(186),
                                type: 'action',
                                icon: image,
                                class: 'entry-icon-no-fallback',
                                fa: 'fa-mega spin-x-alt',
                                action: async () => {
                                    global.menu.setLoadingEntries([e], true, global.lang.PROCESSING)
                                    let err
                                    const r = await icons.fetchURL(image)
                                    const ret = await icons.adjust(r.file, {shouldBeAlpha: false}).catch(global.displayErr)
                                    const destFile = await icons.saveDefaultFile(terms, ret.file).catch(e => err = e)
                                    this.emit('edited', 'icon', e, destFile)
                                    global.menu.setLoadingEntries([e], false)
                                    if(err) throw err
                                    console.log('icon changed', terms, destFile)
                                    global.menu.refreshNow()
                                    global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                                }
                            }
                            return e
                        })
                        ret.push({name: global.lang.OPEN_URL, type: 'input', fa: 'fas fa-link', action: async (err, val) => {   
                            console.log('from-url', terms, '') 
                            const fetched = await icons.fetchURL(val)
                            const ret = await icons.adjust(fetched.file, {shouldBeAlpha: false})
                            const destFile = await icons.saveDefaultFile(terms, ret.file)
                            this.emit('edited', 'icon', e, destFile)
                            console.log('icon changed', terms, destFile)
                            global.menu.refreshNow()
                            global.osd.show(global.lang.ICON_CHANGED, 'fas fa-check-circle', 'channels', 'normal')
                        }})
                        ret.push({name: global.lang.NO_ICON, type: 'action', fa: 'fas fa-ban', action: async () => {
                            console.log('saveDefault', terms, '') 
                            await icons.saveDefaultFile(terms, 'no-icon')
                            this.emit('edited', 'icon', e, null)
                            global.menu.refreshNow()
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
                            this.channelList.categories[category].some((n, j) => {
                                if(n.substr(0, name.length) == name){
                                    i = j
                                    return true
                                }
                            })
                            if(i != -1){
                                let t = (o.terms || e.terms || terms)
                                t = t && t.name ? t.name : (Array.isArray(t) ? t.join(' ') : name)
                                this.channelList.categories[category][i] = this.channelList.compactName(val, t)
                                this.emit('edited', 'rename', e.name, val, e)
                                console.warn('RENAMED', this.channelList.categories[category][i], category, i)
                                this.channelList.save().then(() => {
                                    const category = _category
                                    console.warn('RENAMED*', this.channelList.categories[category][i], category, i)
                                    let destPath = global.menu.path.replace(name, val).replace('/'+ global.lang.RENAME, '')
                                    console.log('opening', destPath)
                                    global.menu.refresh(true, destPath)
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
                        if(!this.channelList.categories[category]) return console.error('Category not found')
                        let i = -1
                        this.channelList.categories[category].some((n, j) => {
                            if(n.substr(0, name.length) == name){
                                i = j
                                return true
                            }
                        })
                        if(i != -1){
                            const lists = require('../lists')
                            this.channelList.channelsIndex = null
                            this.channelList.categories[category][i] = this.channelList.compactName(name, val)
                            this.emit('edited', 'searchTerms', e, val)
                            e.terms = o.terms = {name: lists.terms(val), group: []}
                            await this.channelList.save()
                            global.menu.refreshNow()
                        }
                    }},
                    {name: global.lang.REMOVE, fa: 'fas fa-trash', type: 'action', details: o.name, action: async () => {
                        const category = _category
                        console.warn('REMOVE', name)
                        if(!this.channelList.categories[category]) {
                            global.menu.open(global.lang.LIVE).catch(displayErr)
                            return
                        }
                        this.channelList.categories[category] = this.channelList.categories[category].filter(c => {
                            return c.split(',')[0] != name
                        })
                        await this.channelList.save()
                        global.menu.refresh(true, global.menu.dirname(global.menu.dirname(global.menu.path)))
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
            let categories = this.channelList.getCategories()
            if(val && !categories.map(c => c.name).includes(val)){
                console.warn('ADD', val)
                this.channelList.categories[val] = []
                await this.channelList.save()
                console.warn('saved', global.lang.LIVE +'/'+ val +'/'+ global.lang.EDIT_CATEGORY)
                delete global.menu.pages[global.lang.LIVE]
                global.menu.open(global.lang.LIVE +'/'+ val +'/'+ global.lang.EDIT_CATEGORY +'/'+ global.lang.EDIT_CHANNELS).catch(displayErr)
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
                return this.channelList.getCategories(false).map(c => this.editCategoryEntry(c, true))
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
                    if(val && val != cat.name && typeof(this.channelList.categories[val]) == 'undefined'){
                        let o = this.channelList.categories[cat.name]
                        delete this.channelList.categories[cat.name]
                        this.channelList.categories[val] = o
                        await this.channelList.save()
                        let destPath = global.menu.path.replace(cat.name, val).replace('/'+ global.lang.RENAME_CATEGORY, '')
                        global.menu.refresh(true, destPath)
                        global.osd.show(global.lang.CATEGORY_RENAMED, 'fas fa-check-circle', 'channels', 'normal')
                    }
                }},
                {name: global.lang.REMOVE_CATEGORY, fa: 'fas fa-trash', type: 'action', details: cat.name, action: async () => {
                    delete this.channelList.categories[cat.name]
                    await this.channelList.save()
                    global.menu.open(global.lang.LIVE).catch(displayErr)
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
                this.disableWatchNowAuto = true
                if(val && !Object.keys(this.channelList.categories).map(c => c.name).includes(val)){
                    if(this.channelList.categories[catName] && !this.channelList.categories[catName].includes(val)){
                        this.channelList.categories[catName].push(val)
                        await this.channelList.save()
                        let targetPath = global.menu.path
                        if(inline !== true){
                            targetPath = global.menu.dirname(targetPath)
                        }
                        global.menu.refreshNow()
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
        global.rendererReady(() => {
            global.menu.on('render', (entries, path) => {
                if(path != this.watchNowAuto){
                    this.watchNowAuto = false
                }
            })
            const streamer = require('../streamer/main')
            streamer.on('stop-from-client', () => {
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
        global.rendererReady(() => {
            global.menu.addFilter(async (entries, path) => { 
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
            const streamer = require('../streamer/main')
            if(streamer.active){
                name = streamer.active.data.originalName || streamer.active.data.name
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
        global.renderer.emit('open-external-url', url)
    }
    getAllChannels(){
        let list = []
        this.channelList.getCategories().forEach(category => {
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
        let ct, sure, cats = this.channelList.getCategories(true)
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
				if(t.startsWith('-')){
					if(stackTerms.includes(t.substr(1))){
						return true
					}
				} else {
					nTerms.push(t)
				}
			}) || stackTerms.some(t => {
				if(t.startsWith('-')){
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
        const lists = require('../lists')
        let tms, tmsKey, chs = this.channelList.channelsIndex || {}
        if(Array.isArray(terms)){
            tms = terms
            tmsKey = tms.join(' ')
            if(this.channelList.isChannelCache[tmsKey]) return this.channelList.isChannelCache[tmsKey]
        } else {
            tmsKey = terms
            if(this.channelList.isChannelCache[tmsKey]) return this.channelList.isChannelCache[tmsKey] // before terms()
            if(typeof(chs[terms]) != 'undefined'){
                tms = chs[terms]
            } else {
                tms = lists.terms(terms)
            }
        }
        let chosen, chosenScore = -1
        Object.keys(chs).forEach(name => {
            let score = lists.match(chs[name], tms, false)
            if(score){
                if(score > chosenScore){
                    chosen = name
                    chosenScore = score
                }
            }
        })
        if(chosenScore > 1){
            if(typeof(this.channelList.isChannelCache[chosen]) == 'undefined'){
                let alts = {}, excludes = [], chTerms = global.deepClone(chs[chosen])
                Object.keys(chs).forEach(name => {
                    if(name == chosen) return
                    let score = lists.match(chTerms, chs[name], false)
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
                this.channelList.isChannelCache[chosen] = {name: chosen, terms: chTerms, alts, excludes}
            }
            if(tmsKey != chosen) this.channelList.isChannelCache[tmsKey] = this.channelList.isChannelCache[chosen]
            return this.channelList.isChannelCache[chosen]
        }
    }
    expandTerms(terms){
        if(typeof(terms) == 'string'){
            const lists = require('../lists')
            terms = lists.terms(terms)
        }
        let ch = this.isChannel(terms)
        if(ch){
            return ch.terms
        }
        return terms
    }
    async get(terms){
        const lists = require('../lists')
        if(typeof(terms) == 'string'){
            terms = lists.terms(terms)
        }
        console.warn('channels.get', terms)
        let ret = await lists.search(terms, {
            safe: !lists.parentalControl.lazyAuth(),
            type: 'live',
            limit: 1024
        })
        let entries = ret.results
        const watching = require('../watching')
        await watching.order(entries).then(es => entries = es).catch(console.error)
        return entries
    }
    search(terms, partial){
        return new Promise((resolve, reject) => {
            if(typeof(terms) == 'string'){
                const lists = require('../lists')
                terms = lists.terms(terms)
            }
            let epgEntries = [], entries = [], already = {}
            let matchAll = !terms.length || (terms.length == 1 && terms[0] == '*')
            Object.keys(this.channelList.channelsIndex).sort().forEach(name => {
                if(typeof(already[name]) == 'undefined'){
                    let score = matchAll ? 1 : this.cmatch(this.channelList.channelsIndex[name], terms, partial)
                    if(score){
                        already[name] = null
                        entries.push({
                            name,
                            terms: {name: this.channelList.channelsIndex[name]}
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
        const lists = require('../lists')
        let terms
        if(e.originalName) {
            terms = lists.terms(e.originalName)
        } else if(Array.isArray(e.terms) && e.terms.length) {
            terms = e.terms
        } else if(typeof(e.terms) != 'undefined' && typeof(e.terms.name) != 'undefined' && Array.isArray(e.terms.name) && e.terms.name.length) {
            terms = e.terms.name
        } else {
            terms = lists.terms(e.programme ? e.programme.ch : e.name)
        }
        return this.expandTerms(terms)
    }
    async toMetaEntryRenderer(e, _category, epgNow){
        let category, channelName = e.originalName || (e.programme ? e.programme.ch : e.name)
        if(_category === false){
            category = false
        } else if(_category && typeof(_category) == 'string') {
            category = _category
        } else if(_category && typeof(_category) == 'object') {
            category = _category.name
        } else {
            let c = this.getChannelCategory(e.originalName || e.name)
            if(c){
                category = c
            } else {
                category = false
            }
        }
        console.error('CATEGORY=='+ JSON.stringify({category, channelName, _category}))
        let terms = this.entryTerms(e), streamsEntry, epgEntry, entries = [], moreOptions = [], url = e.url
        if(!url){
            let name = channelName
            let ch = this.isChannel(name)
            if(ch){
                channelName = name = ch.name
                terms = ch.terms
            }
            const mega = require('../mega')
            e.url = url = mega.build(name, {terms})
        }
        const autoplay = this.autoplay(), streams = await this.get(terms)
        streams.forEach((e, i) => {
            if(!streams[i].group){
                streams[i].group = category
            }
        })
        if(autoplay){
            if(streams.length){
                const streamer = require('../streamer/main')
                streamer.play(e, streams)
                return -1
            } else {
                throw global.lang.NONE_STREAM_FOUND
            }
        } else {
            const lists = require('../lists')
            if(streams.length) {
                let call = lists.mi.isRadio(channelName +' '+ category) ? global.lang.LISTEN_NOW : global.lang.WATCH_NOW
                entries.push({
                    name: call, 
                    type: 'action',
                    fa: 'fas fa-play-circle',
                    url,
                    group: category,
                    action: data => {
                        const streamer = require('../streamer/main')
                        data.name = e.name
                        streamer.play(data, streams)
                        this.watchNowAuto = global.menu.path
                    }
                })
                streamsEntry = {
                    name: global.lang.STREAMS + ' (' + streams.length + ')', 
                    type: 'group', 
                    renderer: async () => streams
                }
                if(this.loadedEPG) {
                    epgEntry =  {
                        name: global.lang.EPG, 
                        type: 'group',
                        fa: this.epgIcon,
                        details: (epgNow && epgNow != category) ? epgNow : '',
                        renderer: this.epgChannelEntries.bind(this, e)
                    }
                }
            } else {
                const name = lists.loaded(true) ? global.lang.NONE_STREAM_FOUND : global.lang.NO_LISTS_ADDED
                entries.push(Object.assign(this.emptyEntry, { name }))
                if(lists.activeLists.my.length) {
                    lists.manager.checkListExpiral(
                        lists.activeLists.my.map(source => ({source}))
                    ).catch(console.error)
                }
            }
        }
        if(entries.length){
            const bookmarks = require('../bookmarks')
            let bookmarkable = {name: channelName, type: 'stream', label: e.group || '', url}
            if(bookmarks.has(bookmarkable)){
                entries.push({
                    type: 'action',
                    fa: 'fas fa-star-half',
                    name: global.lang.REMOVE_FROM.format(global.lang.BOOKMARKS),
                    action: () => {
                        bookmarks.remove(bookmarkable)
                        global.menu.refreshNow()
                        global.osd.show(global.lang.BOOKMARK_REMOVED.format(bookmarkable.name), 'fas fa-star-half', 'bookmarks', 'normal')
                    }
                })
            } else {
                entries.push({
                    type: 'action',
                    fa: 'fas fa-star',
                    name: global.lang.ADD_TO.format(global.lang.BOOKMARKS),
                    action: () => {
                        bookmarks.add(bookmarkable)
                        global.menu.refreshNow()
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
                this.goChannelWebsite(channelName).catch(global.displayErr)
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
        const mega = require('../mega')
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
            meta.url = mega.build(name, {terms})
        }
        if(mega.isMega(meta.url)){
            let atts = Object.assign({}, mega.parse(meta.url))
            Object.assign(atts, meta)
            if(['all', 'video'].includes(atts.mediaType)){
                Object.assign(meta, {
                    type: 'group',
                    class: 'entry-meta-stream',
                    fa: 'fas fa-play-circle' ,
                    renderer: async () => {
                        const lists = require('../lists')
                        let terms = atts.terms && Array.isArray(atts.terms) ? atts.terms : lists.terms(atts.name)
                        let es = await lists.search(terms, {
                            type: atts.mediaType,
                            group: true,
                            safe: !lists.parentalControl.lazyAuth(),
                            limit: 1024
                        })
                        return lists.tools.paginateList(es.results)
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
    async keywords(){
        let err, keywords = [], badChrs = ['|', '-']
        const data = await this.channelList.getAppRecommendedCategories().catch(e => err = e)
        if(!err) {
            keywords.push(...Object.values(data).flat().map(n => this.channelList.expandName(n).terms.name).flat())
        }
        keywords = keywords.unique().filter(w => !badChrs.includes(w.charAt(0)))
        return keywords
    }
    async setGridType(type){
        global.osd.show(global.lang.PROCESSING, 'fas fa-circle-notch fa-spin', 'channel-grid', 'persistent')
        global.config.set('channel-grid', type)
        let err
        await this.load(true).catch(e => err = e)
        if(err) return global.osd.show(err, 'fas fa-exclamation-triangle faclr-red', 'channel-grid', 'normal')
        this.emit('channel-grid-updated')
        global.menu.once('render', () => {
            global.osd.show('OK', 'fas fa-check-circle faclr-green', 'channel-grid', 'normal')
        })
        global.menu.refreshNow()
    }
    async entries(){
        const lists = require('../lists')
        if(!lists.loaded()) {
            return [lists.manager.updatingListsEntry()]
        }
        let list
        const publicMode = global.config.get('public-lists') && !(global.ALLOW_ADDING_LISTS && lists.loaded(true)) // no list available on index beyound public lists
        const type = publicMode ? 'public' : global.config.get('channel-grid')
        const editable = !type && global.config.get('allow-edit-channel-list')
        const categories = await this.channelList.getCategories()
        if(publicMode) {
            list = []
            for(const category of Object.keys(categories)) {
                let channels = categories[category].entries.map(e => this.isChannel(e.name)).filter(e => !!e)
                const ret = await lists.has(channels, {partial: false})
                let entries = categories[category].entries.filter(e => ret[e.name])
                entries = entries.map(e => this.toMetaEntry(e, categories[category]))
                entries = await this.epgChannelsAddLiveNow(entries, true)
                list.push(...entries)
            }
            list = lists.sort(list)
        } else {
            list = categories.map(category => {
                category.renderer = async (c, e) => {
                    let channels = category.entries.map(e => this.isChannel(e.name)).filter(e => !!e)
                    const ret = await lists.has(channels, {partial: false})
                    let entries = category.entries.filter(e => ret[e.name])
                    entries = entries.map(e => this.toMetaEntry(e, category))
                    entries = await this.epgChannelsAddLiveNow(entries, true)
                    entries = this.sortCategoryEntries(entries)
                    editable && entries.push(this.editCategoryEntry(c))
                    return entries
                }
                return category
            })
            list = lists.sort(list)
            list.push(this.allCategoriesEntry())
        }
        editable && !publicMode && list.push(this.getCategoryEntry())
        publicMode || list.unshift(this.chooseChannelGridOption())
        publicMode && global.ALLOW_ADDING_LISTS && list.unshift(lists.manager.noListsEntry())
        return list
    }
    allCategoriesEntry() {
        return {
            name: global.lang.ALL_CHANNELS,
            type: 'group',
            renderer: async () => {
                const lists = require('../lists')
                let entries = [], already = {}
                for(const category of this.channelList.getCategories()) {
                    category.entries.map(e => this.isChannel(e.name)).filter(e => {
                        if(!e || already[e.name]) return
                        return already[e.name] = true
                    }).forEach(e => {
                        const entry = this.toMetaEntry(e, category)
                        entry.details = category.name
                        entries.push(entry)
                    })
                }
                entries = await this.epgChannelsAddLiveNow(entries, true)
                entries = lists.sort(entries)
                return lists.tools.paginateList(lists.sort(entries))
            }
        }
    }
    chooseChannelGridOption(epgFocused){
        return {
            name: global.lang.CHOOSE_CHANNEL_GRID,
            type: 'select',
            fa: 'fas fa-th',
            renderer: async () => {
                const def = global.config.get('channel-grid'), opts = [
                    {name: global.lang.AUTO +' ('+ global.lang.RECOMMENDED +')', type: 'action', selected: !def, action: () => {
                        this.setGridType('').catch(console.error)
                    }},
                    {name: global.lang.DEFAULT, type: 'action', selected: def == 'app', action: () => {
                        this.setGridType('app').catch(console.error)
                    }},
                    {name: global.lang.EPG, type: 'action', selected: def == 'epg', action: () => {
                        this.setGridType('epg').catch(console.error)
                    }}
                ]
                if(epgFocused !== true) {
                    if(global.config.get('lists').length) {
                        opts.push({
                            name: global.lang.MY_LISTS, type: 'action', 
                            selected: def == 'lists',
                            action: () => {
                                this.setGridType('lists').catch(console.error)
                            }
                        })
                    }
                    opts.push(this.exportImportOption())
                }
                if(global.config.get('parental-control') != 'remove') {
                    opts.splice(opts.length - 2, 0, {name: global.lang.ADULT_CONTENT, type: 'action', selected: def == 'xxx', action: () => {
                        this.setGridType('xxx').catch(console.error)
                    }})
                }
                return opts
            }
        }
    }
    sortCategoryEntries(entries){
        const lists = require('../lists')
        entries = lists.sort(entries)                                
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
                    const lists = require('../lists')
                    return lists.sort(es.map(e => {
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
                this.channelList.setCategories(data)
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
                        const fs = require('fs')
                        const downloads = require('../downloads')
                        const filename = 'categories.json', file = downloads.folder +'/'+ filename
                        fs.writeFile(file, JSON.stringify(this.channelList.getCategories(true), null, 3), {encoding: 'utf-8'}, err => {
                            if(err) return global.displayErr(err)
                            downloads.serve(file, true, false).catch(global.displayErr)
                        })
                    }
                },
                {
                    name: global.lang.IMPORT,
                    type: 'action',
                    fa: 'fas fa-file-import', 
                    action: async () => {
                        global.config.set('channel-grid', '')
                        const fs = require('fs')
                        const file = await global.menu.chooseFile('application/json')
                        this.importFile(await fs.promises.readFile(file))
                    }
                },
                {
                    name: global.lang.RESET,
                    type: 'action',
                    fa: 'fas fa-undo-alt', 
                    action: async () => {
                        global.osd.show(global.lang.PROCESSING, 'fa-mega spin-x-alt', 'options', 'persistent')
                        await this.channelList.reset()
                        await this.load()
                        global.osd.show('OK', 'fas fa-check-circle faclr-green', 'options', 'normal')
                    }
                }
            ]
        }
    }
    options(){
        return new Promise((resolve, reject) => {
            const lists = require('../lists')
            let entries = []
            if(!global.config.get('channel-grid') && global.config.get('allow-edit-channel-list')){
                entries.push(this.editCategoriesEntry())
            }
            entries.push(this.exportImportOption())
            global.ALLOW_ADDING_LISTS && entries.push(lists.manager.listsEntry(true))
            entries.push(...[
                {
                    name: global.lang.ALLOW_EDIT_CHANNEL_LIST,
                    type: 'check',
                    action: (e, checked) => {
                        global.config.set('allow-edit-channel-list', checked)
                        global.menu.refreshNow()
                    }, 
                    checked: () => {
                        return global.config.get('allow-edit-channel-list')
                    }
                },
                {
                    name: global.lang.ONLY_KNOWN_CHANNELS_IN_X.format(global.lang.TRENDING),
                    type: 'check',
                    action: (e, checked) => {
                        const watching = require('../watching')
                        global.config.set('only-known-channels-in-trending', checked)
                        watching.update().catch(console.error)
                    }, 
                    checked: () => {
                        return global.config.get('only-known-channels-in-trending')
                    }
                },
                {
                    name: global.lang.SHOW_POPULAR_SEARCHES.format(global.lang.TRENDING),
                    type: 'check',
                    action: (e, checked) => {
                        const watching = require('../watching')
                        global.config.set('popular-searches-in-trending', checked)
                        watching.update().catch(console.error)
                    }, 
                    checked: () => {
                        return global.config.get('popular-searches-in-trending')
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
                        return new Promise(resolve => {
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
        const lists = require('../lists')
        if(!lists.loaded()){
            return [lists.manager.updatingListsEntry()]
        }
        const isSeries = type == 'series'
        let groups = await lists.groups(type ? [type] : ['series', 'vod'], opts.myListsOnly)
        if(!groups.length && !lists.loaded(true)){
            if(global.ALLOW_ADDING_LISTS) {
                return [lists.manager.noListsEntry()]
            }
            return []
        }
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
                entries = lists.parentalControl.filter(entries)
            } else if(acpolicy == 'remove'){
                entries = lists.parentalControl.filter(entries)		
            } else if(acpolicy == 'only') {
                entries = lists.parentalControl.only(entries)
            }
            return entries
        }        
        const renderer = async group => {
            let entries = await lists.group(group).catch(global.displayErr)
            if(Array.isArray(entries)) {
                let gentries = (group.entries || []).map(g => groupToEntry(g))
                while(entries.length == 1){
                    const entry = entries[0]
                    if(entry.entries){
                        entries = entry.entries
                    } else if(typeof(entry.renderer) == 'function') {
                        entries = await entry.renderer(entry)
                    } else if(typeof(entry.renderer) == 'string') {
                        entries = await global.storage.get(entry.renderer)
                    } else {
                        break
                    }
                }
                gentries.push(...entries)
                gentries = parentalFilter(gentries).sortByProp('name')
                const deepEntries = await lists.tools.deepify(gentries, {source: group.url}).catch(console.error)
                if(Array.isArray(deepEntries)) {
                    gentries = deepEntries
                }
                return gentries
            } else {
                return []
            }
        }
        let pentries = parentalFilter(groups).map(group => groupToEntry(group))
        if(opts.deepify !== false) {
            const deepEntries = await lists.tools.deepify(pentries).catch(console.error)
            if(Array.isArray(deepEntries)) {
                pentries = deepEntries
            }
        }
        return pentries
    }
    async hook(entries, path){
        if(!path) {
            const options = require('../options')
            const liveEntry = {name: global.lang.LIVE, fa: 'fas fa-tv', details: '<i class="fas fa-th"></i>&nbsp; '+ global.lang.ALL_CHANNELS, type: 'group', renderer: this.entries.bind(this)}
            options.insertEntry(liveEntry, entries, 1, global.lang.MY_LISTS)
            if(global.ALLOW_ADDING_LISTS) {
                const moviesEntry = {
                    name: global.lang.CATEGORY_MOVIES_SERIES,
                    fa: 'fas fa-th', details: '', type: 'group',
                    renderer: () => this.groupsRenderer('')
                }
                options.insertEntry(moviesEntry, entries, -1, [global.lang.OPTIONS, global.lang.TOOLS], [global.lang.LIVE])
            }
        }
        return entries
    }
}

module.exports = Channels
