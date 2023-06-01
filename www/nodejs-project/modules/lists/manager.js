const Events = require('events'), Limiter = require('../limiter')

class ManagerCommunityLists extends Events {
    constructor(){
        super()
    }  
    async communityModeKeywords(){
        const badTerms = ['m3u8', 'ts', 'mp4', 'tv', 'channel']
        let terms = [], addTerms = (tms, score) => {
            if(typeof(score) != 'number'){
                score = 1
            }
            tms.forEach(term => {
                if(badTerms.includes(term)){
                    return
                }
                const has = terms.some((r, i) => {
                    if(r.term == term){
                        terms[i].score += score
                        return true
                    }
                })
                if(!has){
                    terms.push({term, score})
                }
            })
        }
        let bterms = global.bookmarks.get()
        if(bterms.length){ // bookmarks terms
            bterms = bterms.slice(-24)
            bterms = [...new Set(bterms.map(e => global.channels.entryTerms(e)).flat())].filter(c => c[0] != '-')
            addTerms(bterms)
        }
        let sterms = await global.search.history.terms()
        if(sterms.length){ // searching terms history
            sterms = sterms.slice(-24)
            sterms = [...new Set(sterms.map(e => global.channels.entryTerms(e)).flat())].filter(c => c[0] != '-')
            addTerms(sterms)
        }
        let hterms = global.histo.get()
        if(hterms.length){ // user history terms
            hterms = hterms.slice(-24)
            hterms = [...new Set(hterms.map(e => channels.entryTerms(e)).flat())].filter(c => c[0] != '-')
            addTerms(hterms)
        }
        addTerms(await global.channels.keywords())
        const max = Math.max(...terms.map(t => t.score))
        let cterms = global.config.get('communitary-mode-interests')
        if(cterms){ // user specified interests
            cterms = this.master.terms(cterms, false).filter(c => c[0] != '-')
            if(cterms.length){
                addTerms(cterms, max)
            }
        }
        terms = terms.sortByProp('score', true).map(t => t.term)
        if(terms.length > 24) {
            terms = terms.slice(0, 24)
        }
        return terms
    }    
    async communityLists(){
        let limit = global.config.get('communitary-mode-lists-amount')
        if(limit){
            let err, lists = await this.allCommunityLists(10000, true).catch(e => err = e)
            if(!err){
                return lists.slice(0, limit)
            }
        }
        return []
    }
    async receivedCommunityListsEntries(){
        const info = await this.master.info()
        let entries = Object.keys(info).filter(u => !info[u].owned).sort((a, b) => {
            if([a, b].some(a => typeof(info[a].score) == 'undefined')) return 0
            if(info[a].score == info[b].score) return 0
            return info[a].score > info[b].score ? -1 : 1
        }).map(url => {
            let data = global.discovery.details(url)
            if(!data){
                console.error('LIST NOT FOUND '+ url)
                return
            }
            let health = global.discovery.averageHealth(data) || -1
            let name = data.name || this.nameFromSourceURL(url)
            let author = data.author || undefined
            let icon = data.icon || undefined
            let length = data.length || 0
            let details = []
            if(author) details.push(author)
            if(health > -1) details.push(global.lang.QUALITY +': '+ parseInt(health * 100) +'%')
            details.push(global.lang.RELEVANCE +': '+ parseInt((info[url].score || 0) * 100) +'%')
            details.push('<i class="fas fa-play-circle" aria-label="hidden"></i> '+ global.kfmt(length, 1))
            details = details.join(' &middot; ')
            return {
                name, url, icon, details,
                fa: 'fas fa-satellite-dish',
                type: 'group',
                class: 'skip-testing',
                renderer: this.directListRenderer.bind(this)
            }
        }).filter(l => l)
        if(!entries.length){
            if(!global.lists.loaded()){
                entries = [this.updatingListsEntry()]
            } else {
                entries = [this.noListsRetryEntry()]
            }
        }
        return entries
    }
    async getAllCommunitySources(){
        const ret = {}, lists = await global.discovery.get(128)
        lists.map(list => {
            let health = -1
            if(list.perceivedHealth >= 0 && list.perceivedHealthTestCount) {
                health = list.perceivedHealth
            } else if(list.health >= 0) {
                health = list.health
            }
            ret[list.url] = parseInt(health == -1 ? -1 : health * 100)
        })
        return ret
    }
    async allCommunityLists(timeout=10000, urlsOnly=true){
        let limit = global.config.get('communitary-mode-lists-amount')
        if(limit){
            let s = await this.getAllCommunitySources()
            if(typeof(s) == 'object'){
                let r = Object.keys(s).map(url => {
                    return {url, health: s[url]}
                })
                if(urlsOnly){
                    r = r.map(e => e.url)
                }
                return r
            }
        }
        return []
    }
    async allCommunityListsEntries(){
        let sources = await this.getAllCommunitySources(), names = {};
        await Promise.allSettled(Object.keys(sources).map(url => {
            return this.name(url, false).then(name => {
                names[url] = name
            })
        }))
        let lists = Object.keys(sources).map(url => {
            const details = sources[url] >= 0 ? global.lang.QUALITY +': '+ sources[url] +'%' : ''
            return {
                url,
                details,
                name: names[url],
                type: 'group',
                fa: 'fas fa-satellite-dish',
                class: 'skip-testing',
                renderer: async data => {
                    let haserr
                    this.openingList = true
                    let ret = await this.directListRenderer(data, {fetch: true}).catch(err => haserr = err)
                    this.openingList = false
                    global.osd.hide('list-open')
                    if(haserr) throw haserr
                    return ret
                }
            } 
        })
        console.error('ret: '+ lists.length)
        if(lists.length){
            if(global.config.get('parental-control') == 'block'){
                lists = this.master.parentalControl.filter(lists)
            }
        } else {
            if(!global.lists.loaded()){
                lists = [this.updatingListsEntry()]
            } else {
                lists = [this.noListsRetryEntry()]
            }
        }
        return lists
    }
    listSharingEntry(){
        return {
            name: global.lang.COMMUNITY_LISTS, type: 'group', fa: 'fas fa-users', details: global.lang.LIST_SHARING,
            renderer: async () => {
                let options = [
                    {name: global.lang.ACCEPT_LISTS, type: 'check', details: global.lang.LIST_SHARING, action: (data, checked) => {
                        if(checked){
                            global.ui.emit('dialog', [
                                {template: 'question', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users'},
                                {template: 'message', text: global.lang.ASK_COMMUNITY_LIST},
                                {template: 'option', id: 'back', fa: 'fas fa-times-circle', text: global.lang.BACK},
                                {template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: global.lang.I_AGREE}
                            ], 'lists-manager', 'back', true)                
                        } else {
                            global.config.set('communitary-mode-lists-amount', 0)
                            global.explorer.softRefresh(global.explorer.path, true) // epg options path
                        }
                    }, checked: () => {
                        return global.config.get('communitary-mode-lists-amount') > 0
                    }}
                ]
                if(global.config.get('communitary-mode-lists-amount') > 0){
                    options.push({name: global.lang.RECEIVED_LISTS, details: global.lang.SHARED_AND_LOADED, fa: 'fas fa-users', type: 'group', renderer: this.receivedCommunityListsEntries.bind(this)})
                    options.push({name: global.lang.ALL_LISTS, details: global.lang.SHARED_FROM_ALL, fa: 'fas fa-users', type: 'group', renderer: this.allCommunityListsEntries.bind(this)})
                    options.push({
                        name: global.lang.AMOUNT_OF_LISTS,
                        details: global.lang.AMOUNT_OF_LISTS_HINT,
                        type: 'slider', 
                        fa: 'fas fa-cog', 
                        mask: '{0} ' + global.lang.COMMUNITY_LISTS.toLowerCase(), 
                        value: () => {
                            return global.config.get('communitary-mode-lists-amount')
                        }, 
                        range: {start: 5, end: 72},
                        action: (data, value) => {
                            global.config.set('communitary-mode-lists-amount', value)
                        }
                    })                                
                    options.push({
                        name: global.lang.INTERESTS,
                        details: global.lang.SEPARATE_WITH_COMMAS, 
                        type: 'input',
                        fa: 'fas fa-edit',
                        action: (e, v) => {
                            if(v !== false && v != global.config.get('communitary-mode-interests')){
                                global.config.set('communitary-mode-interests', v)
                                global.ui.emit('ask-restart')
                            }
                        },
                        value: () => {
                            return global.config.get('communitary-mode-interests')
                        },
                        placeholder: global.lang.COMMUNITY_LISTS_INTERESTS_HINT,
                        multiline: true,
                        safe: true
                    })
                    options.push({
                        name: global.lang.LEGAL_NOTICE,
                        fa: 'fas fa-info-circle',
                        type: 'action',
                        action: this.showInfo.bind(this)
                    })
                }
                return options
            }
        }
    }
    showInfo(){
        global.explorer.dialog([
            {template: 'question', text: global.lang.COUNTRIES, fa: this.icon},
            {template: 'message', text: global.lang.IPTV_INFO},
            {template: 'option', text: 'OK', id: 'ok', fa: 'fas fa-check-circle'},
            {template: 'option', text: global.lang.KNOW_MORE, id: 'know', fa: 'fas fa-info-circle'}
        ], 'ok').then(ret => {
            if(ret == 'know'){
                global.ui.emit('open-external-url', 'https://github.com/efoxbr/megacubo/')
            }
        }).catch(console.error)
    }
}

class ManagerEPG extends ManagerCommunityLists {
    constructor(){
        super()
    }
    parseEPGURL(url, asArray){
        let urls = [url]
        if(url.match(new RegExp(',(https?://|//)'))){
            urls = url.replace(',//', ',http://').split(',http').map((u, i) => {
                if(i){
                    u = 'http'+ u
                }
                return u
            })
        }
        return asArray ? urls : urls.shift()
    }
    async searchEPGs(){
        let epgs = []
        let urls = await this.master.foundEPGs().catch(console.error)
        if(Array.isArray(urls)){
            urls = urls.map(u => this.parseEPGURL(u, true)).flat()
            epgs.push(...urls)
        }
        if(global.config.get('communitary-mode-lists-amount')){
            let c = await cloud.get('configure').catch(console.error)
            if(c && c.epg) {
                let cs = await global.lang.getActiveCountries()
                if(!cs.includes(global.lang.countryCode)){
                    cs.push(global.lang.countryCode)
                }
                cs.forEach(code => {
                    if(c.epg[code] && !epgs.includes(c.epg[code])){
                        epgs.push(c.epg[code])
                    }
                })
            }
            epgs.push(...global.watching.currentRawEntries.map(e => e.epg).filter(e => !!e))
        }
        epgs = [...new Set(epgs)].sort()
        return epgs
    }
    epgLoadingStatus(epgStatus){
        let details = ''
        if(Array.isArray(epgStatus)){
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
                    details = global.lang.ENABLED
                    break
                case 'error':
                    details = 'Error: ' + epgStatus[1]
                    break
            }
        }
        return details
    }
    updateEPGStatus(){
        let p = global.explorer.path
        if(p.indexOf(global.lang.EPG) == -1){
            clearInterval(this.epgStatusTimer)
            this.epgStatusTimer = false
        } else {
            this.master.epg([], 2).then(epgData => {
                let activeEPGDetails = this.epgLoadingStatus(epgData)
                if(activeEPGDetails != this.lastActiveEPGDetails){
                    this.lastActiveEPGDetails = activeEPGDetails
                    this.epgOptionsEntries(activeEPGDetails).then(es => {
                        if(p == global.explorer.path){
                            es = es.map(e => {
                                if(e.name == global.lang.SYNC_EPG_CHANNELS){
                                    e.value = e.checked()
                                }
                                return e
                            })
                            global.explorer.render(es, p, global.channels.epgIcon)
                        }
                    }).catch(console.error)
                }                
            }).catch(err => {
                clearInterval(this.epgStatusTimer)
                this.epgStatusTimer = false
            })
        }
    }
    epgOptionsEntries(activeEPGDetails){
        return new Promise((resolve, reject) => {
            let options = [], epgs = []
            this.searchEPGs().then(urls => {
                epgs.push(...urls)
            }).catch(console.error).finally(() => {
                let activeEPG = global.config.get('epg-'+ global.lang.locale) || global.activeEPG
                if(!activeEPG || activeEPG == 'disabled'){
                    activeEPG = ''
                }
                console.log('SETT-EPG', activeEPG, epgs)
                if(activeEPG){
                    activeEPG = this.formatEPGURL(activeEPG) 
                    if(!epgs.includes(activeEPG)){
                        epgs.push(activeEPG)
                    }
                }
                const next = () => {
                    options = [...new Set(epgs)].sort().map(url => {
                        let details = '', name = this.nameFromSourceURL(url)
                        if(url == activeEPG){
                            if(activeEPGDetails){
                                details = activeEPGDetails
                            } else {
                                if(global.channels.activeEPG == url){
                                    details = global.lang.EPG_LOAD_SUCCESS
                                } else {
                                    details = global.lang.PROCESSING
                                }
                            }
                        }
                        return {
                            name,
                            type: 'action',
                            fa: 'fas fa-th-large',
                            prepend: (url == activeEPG) ? '<i class="fas fa-check-circle faclr-green"></i> ' : '',
                            details,
                            action: () => {
                                if(url == global.config.get('epg-'+ global.lang.locale)){
                                    global.config.set('epg-'+ global.lang.locale, 'disabled')
                                    global.channels.load()
                                    this.setEPG('', true)
                                } else {
                                    global.config.set('epg-'+ global.lang.locale, url)
                                    this.setEPG(url, true)
                                }
                                global.explorer.softRefresh(global.explorer.path, true) // epg options path
                            }
                        }
                    })
                    options.unshift({
                        name: global.lang.SYNC_EPG_CHANNELS,
                        type: 'check',
                        action: (e, checked) => {
                            global.config.set('use-epg-channels-list', checked)
                            if(checked){
                                if(global.activeEPG){
                                    this.importEPGChannelsList(global.activeEPG).catch(console.error)
                                }
                            } else {
                                global.channels.load()
                            }
                        }, 
                        checked: () => global.config.get('use-epg-channels-list')
                    })
                    options.unshift({name: global.lang.ADD, fa: 'fas fa-plus-square', type: 'action', action: () => {
                        global.ui.emit('prompt', global.lang.EPG, 'http://.../epg.xml', global.activeEPG || '', 'set-epg', false, global.channels.epgIcon)
                    }})
                    resolve(options)
                }
                if(activeEPG){
                    const epgNext = () => {
                        if(activeEPGDetails == global.lang.ENABLED){
                            if(this.epgStatusTimer){
                                clearInterval(this.epgStatusTimer)
                                this.epgStatusTimer = false
                            }
                        } else {
                            if(!this.epgStatusTimer){
                                this.epgStatusTimer = setInterval(this.updateEPGStatus.bind(this), 1000)
                            }
                        }
                        next()
                    }
                    if(typeof(activeEPGDetails) == 'string'){
                        epgNext()
                    } else {
                        this.master.epg([], 2).then(epgData => {
                            this.lastActiveEPGDetails = activeEPGDetails = this.epgLoadingStatus(epgData)
                            epgNext()
                        }).catch(err => {
                            console.error(err)
                            activeEPGDetails = ''
                            epgNext()
                        })
                    }
                } else {
                    next()
                }
            })
        })
    }
    shouldImportEPGChannelsList(url){
        return url == global.activeEPG && global.config.get('use-epg-channels-list')
    }
    importEPGChannelsList(url){
        return new Promise((resolve, reject) => {
            this.master.epgLiveNowChannelsList().then(data => {
                let imported = false
                global.channels.updateCategoriesCacheKey()
                if(this.shouldImportEPGChannelsList(url)){ // check again if user didn't changed his mind
                    console.log('CHANNELS LIST IMPORT', data.categories, data.updateAfter, url, global.activeEPG)
                    global.channels.setCategories(data.categories, true)
                    if(this.importEPGChannelsListTimer){
                        clearTimeout(this.importEPGChannelsListTimer)                        
                    }
                    this.importEPGChannelsListTimer = setTimeout(() => {
                        this.importEPGChannelsList(url).catch(console.error)
                    }, data.updateAfter * 1000)
                    imported = true
                }
                global.channels.load()
                resolve(imported)
            }).catch(err => {
                global.osd.show(global.lang.SYNC_EPG_CHANNELS_FAILED, 'fas fa-exclamation-triangle faclr-red', 'epg', 'normal')
                reject(err)
            })
        })
    }
    formatEPGURL(url){        
        const fragment = ',http'
        if(url && url.indexOf(fragment) != -1){
            url = url.split(',http').shift()
        }
        return url
    }
    async setEPG(url, ui){
        console.log('SETEPG', url)
        if(typeof(url) == 'string'){
            if(url){
                url = this.formatEPGURL(url)
            }
            if(!url || global.validateURL(url)){
                global.activeEPG = url
                global.channels.activeEPG = ''
                await this.loadEPG(url, ui)
                let refresh = () => {
                    if(global.explorer.path.indexOf(global.lang.EPG) != -1 || global.explorer.path.indexOf(global.lang.LIVE) != -1){
                        global.explorer.softRefresh(global.explorer.path, true)
                    }
                }
                console.log('SETEPGc', url, ui, global.activeEPG)
                if(!url){
                    global.channels.updateCategoriesCacheKey()
                    global.channels.load()
                    if(ui){
                        global.osd.show(global.lang.EPG_DISABLED, 'fas fa-times-circle', 'epg', 'normal')                            
                    }
                } else if(this.shouldImportEPGChannelsList(url)) {
                    this.importEPGChannelsList(url).catch(console.error)
                }
                refresh()
            } else {
                if(ui){
                    global.osd.show(global.lang.INVALID_URL, 'fas fa-exclamation-triangle faclr-red', 'epg', 'normal')
                }
                throw global.lang.INVALID_URL
            }
        }
    }
    loadEPG(url, ui){
        return new Promise((resolve, reject) => {
            global.channels.activeEPG = ''
            if(!url && global.config.get('epg-'+ global.lang.locale) != 'disabled'){
                url = global.config.get('epg-'+ global.lang.locale)
            }
            if(!url && ui) ui = false
            if(ui){
                global.osd.show(global.lang.EPG_AVAILABLE_SOON, 'fas fa-check-circle', 'epg', 'normal')
            }
            console.log('loadEPG', url)
            this.master.loadEPG(url).then(() => {
                global.channels.activeEPG = url
                global.channels.emit('epg-loaded', url)
                if(ui){
                    global.osd.show(global.lang.EPG_LOAD_SUCCESS, 'fas fa-check-circle', 'epg', 'normal')
                }
                if(global.explorer.path == global.lang.TRENDING || (global.explorer.path.startsWith(global.lang.LIVE) && global.explorer.path.split('/').length == 2)){
                    global.explorer.refresh()
                }
                if(this.shouldImportEPGChannelsList()) {
                    this.importEPGChannelsList(url).then(() => {
                        if(global.explorer.path == global.lang.TRENDING || (global.explorer.path.startsWith(global.lang.LIVE) && global.explorer.path.split('/').length == 2)){
                            global.explorer.refresh()
                        }
                    }).catch(console.error)
                }
                resolve(true)
            }).catch(err => {
                console.error(err)
                global.osd.show(global.lang.EPG_LOAD_FAILURE + ': ' + String(err), 'fas fa-times-circle', 'epg', 'normal')
                reject(err)
            })
        })
    }
    setImportEPGChannelsListTimer(){
        const allow = () => {
            return global.config.get('use-epg-channels-list') && global.config.get('epg-'+ global.lang.locale)
        }
        const disable = () => {            
            if(this.importEPGChannelsListTimer){
                clearInterval(this.importEPGChannelsListTimer)
                delete this.importEPGChannelsListTimer
            }
        }
        if(allow()){
            if(typeof(this.importEPGChannelsListTimer) == 'undefined') {
                this.importEPGChannelsListTimer = setInterval(() => {
                    if(allow()){
                        const url = global.config.get('epg-'+ global.lang.locale)
                        this.importEPGChannelsList(url).catch(console.error)
                    } else {
                        disable()
                    }
                }, 300000) // 5min
            }
        } else {
            disable()
        }
    }
    epgEntry(){
        return {
            name: global.lang.EPG, 
            fa: global.channels.epgIcon, 
            type: 'group', details: 'EPG', 
            renderer: async () => {
                const entries = [
                    {
                        name: global.lang.OPTIONS,
                        type: 'group',
                        fa: 'fas fa-cog',
                        renderer: async () => {
                            const epgData = this.master.epg([], 2)
                            return this.epgOptionsEntries(this.epgLoadingStatus(epgData))
                        }
                    },
                    global.channels.epgSearchEntry()
                ]
                entries.push(...global.channels.getCategories().map(category => {
                    const rawname = global.lang.CATEGORY_KIDS == category.name ? '[fun]'+ category.name +'[|fun]' : category.name
                    return {
                        name: category.name,
                        rawname,
                        type: 'group',
                        renderer: () => {
                            return this.epgCategoryEntries(category)
                        }
                    }
                }))
                return entries
            }            
        }
    }    
    async epgCategoryEntries(category){
        let terms = {}, channels = category.entries.map(e => {
            let data = global.channels.isChannel(e.name)
            if(data){
                e.terms.name = terms[e.name] = data.terms
                return e
            }
        }).filter(e => e)
        const epgData = await global.lists.epg(channels, 72)
        let centries = []
        const kids = global.lang.CATEGORY_KIDS == category.name
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
                    const rawname = kids ? '[fun]'+ current.t +'[|fun]' : current.t
                    centries.push({
                        name: current.t,
                        rawname,
                        details: ch,
                        type: 'group',
                        fa: 'fas fa-play-circle',
                        program: current,
                        renderer: async () => global.channels.epgDataToEntries(epgData[ch], ch, terms[ch])
                    })
                }
            })
        }
        return centries
    }
}

class Manager extends ManagerEPG {
    constructor(master){
        super()
        this.master = master
        this.listFaIcon = 'fas fa-satellite-dish'
        // this.listFaIcon = 'fas fa-broadcast-tower'
        this.key = 'lists'
        this.lastProgress = 0
        this.openingList = false    
        global.uiReady(() => {
            global.explorer.addFilter(async (es, path) => {
                es = await this.expandEntries(es, path)
                es = this.master.tools.dedup(es) // apply dedup here again for expanded entries 
                return this.labelify(es)
            })
        })
        global.ui.on('explorer-back', () => {
            if(this.openingList){
                global.osd.hide('list-open')
            }
        })
        global.config.on('change', (keys, data) => {
            if(keys.includes('use-epg-channels-list')){
                this.setImportEPGChannelsListTimer(data['use-epg-channels-list'])
            }
        })
    }
    async expandEntries(entries, path){
        let shouldExpand = entries.some(e => typeof(e._) == 'number' && !e.url)
        if(shouldExpand){
            let source
            entries.some(e => {
                if(e.source){
                    source = e.source
                    return true
                }
            })
            if(source){
                let list = global.lists.lists[source]
                if(!list) {
                    const fetch = new this.master.Fetcher(source, {}, this.master)
                    await fetch.ready()
                    list = fetch.list
                }
                entries = await list.indexer.expandMap(entries)
            }
        }
        return entries
    }
	labelify(list){
		for (let i=0; i<list.length; i++){
			if(list[i] && (typeof(list[i].type) == 'undefined' || list[i].type == 'stream')) {
				list[i].details = list[i].groupName || this.basename(list[i].path || list[i].group || '')
			}
		}
		return list
	}
    basename(path){
        let i = path.lastIndexOf('/')
        if(i == 0){
            return path.substr(1)
        } else if(i == -1) {
            return path
        } else {
            return path.substr(i + 1)
        }
    }
    waitListsReady(timeoutSecs=0){
        return new Promise((resolve, reject) => {
            const info = this.master.status()
            if(info.satisfied) {
                return resolve(true)
            }
            const listener = () => resolve(true)
            this.master.once('satisfied', listener)
            timeoutSecs && setTimeout(() => resolve(false), timeoutSecs * 1000)
        })
    }
    inChannelPage(){
        return global.explorer.currentEntries.some(e => global.lang.SHARE == e.name)
    }
    maybeRefreshChannelPage(){
        if(global.tuning && !global.tuning.destroyed) return
        let mega, streamsCount = 0
        global.explorer.currentEntries.some(e => {
            if(e.url && global.mega.isMega(e.url)){
                mega = global.mega.parse(e.url)
                return true
            }
        })
        global.explorer.currentEntries.some(e => {
            if(e.name.indexOf(global.lang.STREAMS) != -1){
                let match = e.name.match(new RegExp('\\(([0-9]+)\\)'))
                if(match){
                    streamsCount = parseInt(match[1])
                }
                return true
            }
        })
        console.log('maybeRefreshChannelPage', streamsCount, mega)
        if(mega && mega.terms){
            this.master.search(mega.terms.split(','), {
                safe: !this.master.parentalControl.lazyAuth(),
                type: mega.mediaType, 
                group: mega.mediaType != 'live'
            }).then(es => {
                if(es.results.length > streamsCount){
                    global.explorer.refresh()
                }
            }).catch(console.error)
        }
    }
    get(){
        let r = false, lists = global.config.get(this.key) || []
        for(let i=0; i<lists.length; i++){
            if(!Array.isArray(lists[i])){
                delete lists[i]
                r = true
            }
        }
        if(r){
            lists = lists.filter(s => Array.isArray(s)).slice(0)
        }
        return lists.map(l => {
            l[1] = global.forwardSlashes(l[1])
            return l
        })
    }
    async getURLs(){
        return this.get().map(l => l[1])
    }
    async add(url, name, uid){
        url = String(url).trim()
        if(url.substr(0, 2) == '//'){
            url = 'http:'+ url
        }
        let isURL = global.validateURL(url), isFile = this.isLocal(url)
        if(!isFile && !isURL){
            throw global.lang.INVALID_URL_MSG
        }
        let lists = this.get()
        for(let i in lists){
            if(lists[i][1] == url){
                return reject(global.lang.LIST_ALREADY_ADDED)
            }
        }
        this.addingList = true
        global.explorer.path.endsWith(global.lang.MY_LISTS) && global.explorer.softRefresh(global.explorer.path, true)
        const fetch = new this.master.Fetcher(url, {
            progress: p => {
                global.osd.show(global.lang.RECEIVING_LIST +' '+ p +'%', 'fa-mega spin-x-alt', 'add-list-progress-'+ uid, 'persistent')
            }
        }, this.master)
        let entries = await fetch.getMap().catch(console.error)
        this.addingList = false
        global.explorer.path.endsWith(global.lang.MY_LISTS) && global.explorer.softRefresh(global.explorer.path, true)
        this.master.status()
        if(Array.isArray(entries) && entries.length){
            if(!name){
                let meta = await fetch.meta()
                if(meta.name){
                    name = meta.name
                } else {
                    await this.name(url).then(n => name = n).catch(() => {})
                }
            }
            let lists = this.get()
            lists.push([name, url])
            global.config.set(this.key, lists)
            return true
        } else {                    
            throw global.lang.INVALID_URL_MSG
        }
    }
    async addList(value, name, skipSharing){
        let err
        const uid = parseInt(Math.random() * 100000)
        global.osd.show(global.lang.RECEIVING_LIST, 'fa-mega spin-x-alt', 'add-list-progress-'+ uid, 'persistent')
        value = global.forwardSlashes(value)
        await this.add(value, name, uid).catch(e => err = String(e))
        global.osd.hide('add-list-progress-'+ uid)
        if(typeof(err) != 'undefined'){
            if(err.match('http error') != -1){
                err = global.lang.INVALID_URL_MSG
            }
            throw err
        } else {
            global.osd.show(global.lang.LIST_ADDED, 'fas fa-check-circle', 'add-list', 'normal')
            const currentEPG = global.config.get('epg-'+ global.lang.locale)            
            let chosen = (!skipSharing && global.validateURL(value)) ? await global.explorer.dialog([
                {template: 'question', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users'},
                {template: 'message', text: global.lang.WANT_SHARE_COMMUNITY},
                {template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-lock'},
                {template: 'option', text: lang.SHARE, id: 'yes', fa: 'fas fa-users'}
            ], 'no') : 'no' // set local files as private
            if(chosen == 'yes'){
                global.osd.show(global.lang.COMMUNITY_THANKS_YOU, 'fas fa-heart faclr-purple', 'community-lists-thanks', 'normal')
            }
            this.setMeta(value, 'private', chosen != 'yes')
            let info, i = 10
            if(currentEPG != 'disabled'){
                while(i && (!info || !info[value])){
                    i--
                    await this.wait(500)
                    info = await this.master.info()
                }
            }
            if(info[value] && info[value].epg){
                info[value].epg = this.parseEPGURL(info[value].epg, false)
                if(global.validateURL(info[value].epg) && info[value].epg != currentEPG){
                    let chosen = await global.explorer.dialog([
                        {template: 'question', text: ucWords(MANIFEST.name), fa: 'fas fa-star'},
                        {template: 'message', text: global.lang.ADDED_LIST_EPG},
                        {template: 'option', text: lang.YES, id: 'yes', fa: 'fas fa-check-circle'},
                        {template: 'option', text: lang.NO_THANKS, id: 'no', fa: 'fas fa-times-circle'}
                    ], 'yes')
                    if(chosen == 'yes'){
                        global.config.set('epg-'+ global.lang.locale, info[value].epg)
                        await this.setEPG(info[value].epg, true)
                        console.error('XEPG', chosen)
                    }
                }
            }
            global.explorer.softRefresh(global.explorer.path, true) // epg options path
            return true
        }
    }
    remove(url){
        let lists = global.config.get(this.key)
        if(typeof(lists)!='object'){
            lists = []
        }
        for(let i in lists){
            if(!Array.isArray(lists[i]) || lists[i][1] == url){
                delete lists[i]
            }
        }
        lists = lists.filter(item => {
            return item !== undefined
        })
        global.config.set(this.key, lists) 
        return lists
    }
    urls(){
        let urls = [], lists = this.get()
        for(let i=0; i<lists.length; i++){
            urls.push(lists[i][1])
        }
        return urls
    }
    has(url){
        return this.get().some(l => {
            return url == l[1]
        })
    }
    nameFromContent(content){
        if(content){
            let match = content.match(new RegExp('(iptv|pltv)\\-name *= *[\'"]([^\'"]+)'));
            if(match){
                return match[2]
            }
        }
    }
    nameFromSourceURL(url){
        let name
        if(url.indexOf('?') != -1){
            let qs = {}
            url.split('?')[1].split('&').forEach(s => {
                s = s.split('=')
                if(s.length > 1){
                    if(['name', 'dn', 'title'].includes(s[0])){
                        if(!name || name.length < s[1].length){
                            name = s[1]
                        }
                    }
                }
            })
        }
        if(name){
            name = global.decodeURIComponentSafe(name)
            if(name.indexOf(' ') == -1 && name.indexOf('+') != -1){
                name = name.replaceAll('+', ' ')
            }
            return name
        }
        if(this.isLocal(url)){
            return url.split('/').pop().replace(new RegExp('\\.[A-Za-z0-9]{2,4}$', 'i'), '')
        } else {
            url = String(url).replace(new RegExp('^[a-z]*://', 'i'), '').split('/').filter(s => s.length)
            if(!url.length){
                return 'Untitled '+ parseInt(Math.random() * 9999)
            } else if(url.length == 1) {
                return url[0]
            } else {
                return (url[0].split('.')[0] + ' ' + url[url.length - 1]).replace(new RegExp('\\?.*$'), '')
            }
        }
    }
    async name(url, content=''){
        let name = this.getMeta(url, 'name')
        if(!name){
            if(content){
                name = this.nameFromContent(content)
            }
            if(typeof(name) != 'string' || !name){
                name = this.nameFromSourceURL(url)
            }
        }
        return name
    }
	isLocal(file){
		if(typeof(file) != 'string'){
			return
		}
		let m = file.match(new RegExp('^([a-z]{1,6}):', 'i'))
		if(m && m.length && (m[1].length == 1 || m[1].toLowerCase() == 'file')){ // drive letter or file protocol
			return true
		} else {
			if(file.length >= 2 && file.charAt(0) == '/' && file.charAt(1) != '/'){ // unix path
				return true
			}
		}
	}
	validate(content){
        // technically, a m3u8 may contain one stream only, so it can be really small
		return typeof(content) == 'string' && content.length >= 32 && content.toLowerCase().indexOf('#ext') != -1
	}
    rename(url, name){
        this.setMeta(url, 'name', name)
    }
    merge(entries, ns){
        let es = entries.slice(0)
        ns.forEach(n => {
            let ok = false
            es.forEach(e => {
                if(!ok && e.url == n.url){
                    ok = true
                }
            })
            if(!ok){
                es.push(n)
            }
        })
        return es
    }
    setMeta(url, key, val){
        let lists = global.deepClone(this.get()) // clone it
        for(let i in lists){
            if(lists[i][1] == url){
                if(key == 'name'){
                    lists[i][0] = val
                } else {
                    let obj = lists[i][2] || {};
                    obj[key] = val
                    lists[i][2] = obj
                }
                global.config.set('lists', lists)
            }
        }
    }
    getMeta(url, key){
        let lists = this.get()
        for(let i in lists){
            if(lists[i][1] == url){
                let obj = lists[i][2] || {};
                return key ? (obj[key] ? obj[key] : null) : obj
            }
        }
    }
    wait(ms){
        return new Promise(resolve => setTimeout(resolve, ms))
    }
	getUniqueLists(urls){ // remove duplicated lists even from different protocols
		let already = []
		return urls.filter(u => {
			let i = u.indexOf('//')
			u = i == -1 ? u : u.substr(i + 2)
			if(!already.includes(u)){
				already.push(u)
				return true
			}
		})
	}
    update(){
        let p = this.master.status()

        const c = global.config.get('communitary-mode-lists-amount')
        const m = p.progress ? (global.lang[p.firstRun ? 'STARTING_LISTS_FIRST_TIME_WAIT' : 'UPDATING_LISTS'] +' '+ p.progress +'%') : (c ? global.lang.SEARCH_COMMUNITY_LISTS : global.lang.STARTING_LISTS)
        
        if(p.satisfied || this.isUpdating) return

        let lastProgress = 0
        const listener = c => p = c
        const processStatus = p => {
            if(lastProgress === p.progress) return
            lastProgress = p.progress
            let m, fa = 'fa-mega spin-x-alt', duration = 'persistent'
            if(p.satisfied) {
                clearInterval(this.isUpdating)
                this.isUpdating = 0
                m = global.lang.LISTS_UPDATED
                fa = 'fas fa-check-circle'
                duration = 'normal'
                this.master.removeListener('status', listener)
                this.setImportEPGChannelsListTimer(global.config.get('use-epg-channels-list'))
            } else {
                m = global.lang[p.firstRun ? 'STARTING_LISTS_FIRST_TIME_WAIT' : 'UPDATING_LISTS'] +' '+ p.progress +'%'
            }
            global.osd.show(m, fa, 'update-progress', duration)
            if(global.explorer && global.explorer.currentEntries) {
                const updateEntryNames = [global.lang.PROCESSING, global.lang.UPDATING_LISTS, global.lang.STARTING_LISTS]
                const updateBaseNames = [global.lang.TRENDING, global.lang.COMMUNITY_LISTS, global.lang.RECEIVED_LISTS]
                if(
                    updateBaseNames.includes(global.explorer.basename(global.explorer.path)) || 
                    global.explorer.currentEntries.some(e => updateEntryNames.includes(e.name))
                ) {
                    global.explorer.softRefresh(global.explorer.path, true)
                } else if(this.inChannelPage()) {
                    this.maybeRefreshChannelPage()
                }
            }
        }
        this.master.on('status', listener)
        this.isUpdating = setInterval(() => {
            if(!p) p = global.lists.status()
            processStatus(p)
            p = false
        }, 1000)

        global.osd.show(m, 'fa-mega spin-x-alt', 'update-progress', 'persistent')
    }
    noListsRetryDialog(err){
        if(global.Download.isNetworkConnected) {
            const opts = [
                {template: 'question', text: global.lang.NO_COMMUNITY_LISTS_FOUND, fa: 'fas fa-users'},
                {template: 'message', text: String(err)},
                {template: 'option', id: 'retry', fa: 'fas fa-redo', text: global.lang.RETRY},
                {template: 'option', id: 'list-open', fa: 'fas fa-plus-square', text: global.lang.ADD_LIST}
            ]
            if(!err){
                opts.splice(1, 1)
            }
            global.ui.emit('dialog', opts, 'lists-manager', 'retry', true) 
        } else {
            global.displayErr(global.lang.NO_INTERNET_CONNECTION)
        }
    }
    noListsEntry(){        
        if(global.config.get('communitary-mode-lists-amount') > 0){
            return this.noListsRetryEntry()
        } else {
            if(this.addingList) {
                return this.updatingListsEntry()
            } else {
                return {
                    name: global.lang.NO_LISTS_ADDED,
                    fa: 'fas fa-plus-square',
                    type: 'action',
                    action: () => {
                        global.explorer.open(global.lang.IPTV_LISTS).catch(console.error)
                    }
                }
            }
        }
    }
    noListsRetryEntry(){
        return {
            name: global.lang.LOAD_COMMUNITY_LISTS,
            fa: 'fas fa-plus-square',
            type: 'action',
            action: () => this.update()
        }
    }
    updatingListsEntry(name){
        return {
            name: name || global.lang[global.lists.isFirstRun ? 'STARTING_LISTS' : 'UPDATING_LISTS'],
            fa: 'fa-mega spin-x-alt',
            type: 'action',
            action: () => {
                global.explorer.refresh()
            }
        }
    }
    addListEntry(){
        return {
            name: global.lang.ADD_LIST, 
            fa: 'fas fa-plus-square', 
            type: 'action', 
            action: () => {
                const offerCommunityMode = !global.config.get('communitary-mode-lists-amount')
                this.addListDialog(offerCommunityMode).catch(err => global.displayErr(err))
            }
        }
    }
    async addListDialog(offerCommunityMode){        
        let extraOpts = []
        extraOpts.push({template: 'option', text: 'OK', id: 'submit', fa: 'fas fa-check-circle'})
        extraOpts.push({template: 'option', text: global.lang.OPEN_M3U_FILE, id: 'file', fa: 'fas fa-folder-open'})
        extraOpts.push({template: 'option', text: global.lang.ADD_USER_PASS, id: 'code', fa: 'fas fa-key'})
        if(offerCommunityMode){
            extraOpts.push({template: 'option', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users', id: 'sh'})
        }
        let id = await global.explorer.prompt(global.lang.ASK_IPTV_LIST, 'http://', '', true, 'fas fa-info-circle', null, extraOpts)
        if(id == 'file'){
            return await this.addListDialogFile()
        } else if(id == 'code') {
            return await this.addListUserPassDialogFile()
        } else if(id == 'sh') {
            let active = await this.communityModeDialog()
            if(active){
                return true
            } else {
                return await this.addListDialog(offerCommunityMode)
            }
        } else {
            return await this.addList(id)
        }
    }
    addListDialogFile(){
        return new Promise((resolve, reject) => {
            const id = 'add-list-dialog-file-'+ parseInt(10000000 * Math.random())
            global.ui.once(id, data => {
                console.warn('!!! IMPORT M3U FILE !!!', data)
                global.ui.resolveFileFromClient(data).then(file => {
                    this.addList(file).then(resolve).catch(reject)
                }).catch(reject)
            })
            global.ui.emit('open-file', global.ui.uploadURL, id, 'audio/x-mpegurl', global.lang.OPEN_M3U_FILE)
        })
    }
    async communityModeDialog(){     
        let choose = await global.explorer.dialog([
            {template: 'question', text: global.lang.COMMUNITY_LISTS, fa: 'fas fa-users'},
            {template: 'message', text: global.lang.SUGGEST_COMMUNITY_LIST +"\r\n"+ global.lang.ASK_COMMUNITY_LIST},
            {template: 'option', id: 'agree', fa: 'fas fa-check-circle', text: global.lang.I_AGREE},
            {template: 'option', id: 'back', fa: 'fas fa-chevron-circle-left', text: global.lang.BACK}
        ], 'agree')
        if(choose == 'agree'){
            global.ui.localEmit('lists-manager', 'agree')
            return true
        }
    }
    async addListUserPassDialogFile(){     
        let server = await global.explorer.prompt(global.lang.PASTE_SERVER_ADDRESS, 'http://host:port', '', false, 'fas fa-globe', '', [])
        if(!server) throw 'no server provided'
        const user = await global.explorer.prompt(global.lang.USERNAME, global.lang.USERNAME, '', false, 'fas fa-user', '', [])
        if(!user) throw 'no user provided'
        const pass = await global.explorer.prompt(global.lang.PASSWORD, global.lang.PASSWORD, '', false, 'fas fa-key', '', [])
        if(!pass) throw 'no pass provided'
        if(server.charAt(server.length - 1) == '/') {
            server = server.substr(0, server.length - 1)
        }
        const url = server +'/get.php?username='+ encodeURIComponent(user) +'&password='+ encodeURIComponent(pass) +'&output=ts&type=m3u_plus'            
        return await this.addList(url)
    }
    isListExpired(url){
        if(this.master.loader.results[url]){
            const ret = String(this.master.loader.results[url] || '')
            return ret.substr(0, 6) == 'failed' && ['401', '403', '404', '410'].includes(result.substr(-3))
        }        
    }
    myListsEntry(){
        return {
            name: global.lang.MY_LISTS, 
            details: global.lang.IPTV_LISTS, 
            type: 'group', 
            renderer: async () => {
                let lists = this.get()
                const extInfo = await this.master.info(true)
                const doNotShareHint = !global.config.get('communitary-mode-lists-amount')
                let ls = lists.map(row => {
                    let url = row[1]
                    if(!extInfo[url]) extInfo[url] = {}
                    let name = extInfo[url].name || row[0] || this.nameFromSourceURL(url)
                    let details = extInfo[url].author || ''
                    let icon = extInfo[url].icon || undefined
                    let priv = (row.length > 2 && typeof(row[2]['private']) != 'undefined') ? row[2]['private'] : doNotShareHint 
                    let expired = this.isListExpired(url)
                    let flag = expired ? 'fas fa-exclamation-triangle faclr-red' : (priv ? 'fas fa-lock' : 'fas fa-users')
                    return {
                        prepend: '<i class="'+ flag +'"></i>&nbsp;',
                        name, url, icon, details,
                        fa: 'fas fa-satellite-dish',
                        type: 'group',
                        class: 'skip-testing',
                        renderer: async () => {
                            let es = await this.directListRenderer({url}, {
                                raw: true,
                                fetch: false
                            }).catch(err => global.displayErr(err))
                            if(!Array.isArray(es)){
                                es = []
                            }
                            if(es && es.length){
                                es = this.master.parentalControl.filter(es)
                                es = await this.master.tools.deepify(es, url)  
                            }
                            es.unshift({
                                name: global.lang.OPTIONS,
                                fa: 'fas fa-edit', 
                                type: 'select',
                                entries: [
                                    {
                                        name: global.lang.RENAME, 
                                        fa: 'fas fa-edit', 
                                        type: 'input', 
                                        class: 'skip-testing', 
                                        action: (e, v) => {
                                            if(v !== false){
                                                let path = global.explorer.path, parentPath = global.explorer.dirname(global.explorer.dirname(path))
                                                if(path.indexOf(name) != -1){
                                                    path = path.replace('/'+ name, '/'+ v)
                                                } else {
                                                    path = false
                                                }
                                                name = v
                                                this.rename(url, v)
                                                if(path){
                                                    delete global.explorer.pages[parentPath]
                                                    global.explorer.open(path).catch(global.displayErr)
                                                } else {
                                                    global.explorer.back(1, true)
                                                }
                                            }
                                        },
                                        value: () => {
                                            return name
                                        },
                                        safe: true
                                    },
                                    {
                                        name: global.lang.RELOAD, 
                                        fa: 'fas fa-sync', 
                                        type: 'action', url, 
                                        class: 'skip-testing', 
                                        action: this.refreshList.bind(this)
                                    },
                                    {
                                        name: global.lang.REMOVE_LIST, 
                                        fa: 'fas fa-trash', 
                                        type: 'action', url, 
                                        class: 'skip-testing', 
                                        action: this.removeList.bind(this)
                                    }
                                ]
                            })
                            return es
                        }
                    }
                })
                if(this.addingList){
                    ls.push({
                        name: global.lang.RECEIVING_LIST,
                        fa: 'fa-mega spin-x-alt',
                        type: 'action',
                        action: () => global.explorer.refresh()
                    })
                }
                ls.push(this.addListEntry())
                return ls
            }
        }
    }
    listsEntries(){
        return new Promise((resolve, reject) => {
            let options = []
            options.push(this.myListsEntry())
            options.push(this.listSharingEntry())
            options.push(this.epgEntry())
            resolve(options)
        })
    }
    async refreshList(data){
        let updateErr
        global.osd.show(global.lang.UPDATING_LISTS, 'fa-mega spin-x-alt', 'refresh-list', 'persistent')
        await this.master.loader.reload(data.url).catch(e => updateErr = e)
        if(updateErr){
            if(updateErr == 'empty list'){
                let haserr, msg = updateErr
                const ret = await global.Download.head({url: data.url}).catch(err => haserr = err)
                if(ret && typeof(ret.statusCode) == 'number'){
                    switch(String(ret.statusCode)){
                        case '400':
                        case '401':
                        case '403':
                            msg = 'List expired.'
                            break
                        case '-1':
                        case '404':
                        case '410':
                            msg = 'List expired or deleted from the server.'
                            break
                        case '0':
                        case '421':
                        case '453':
                        case '500':
                        case '502':
                        case '503':
                        case '504':
                            msg = 'Server temporary error: '+ ret.statusCode
                            break
                    }
                } else {
                    msg = haserr || 'Server offline error'
                }
                updateErr = msg
            }
            global.displayErr(updateErr)
        } else {
            await global.lists.loadList(data.url).catch(err => updateErr = err)
            if(updateErr){
                global.displayErr(updateErr)
            } else {
                global.osd.show('OK', 'fas fa-check-circle', 'refresh-list', 'normal')
                global.explorer.softRefresh(global.explorer.path, true) // epg options path
                return true // return here, so osd will not hide
            }
        }
        global.osd.hide('refresh-list')
    }
    async removeList(data){
        const info = await this.master.info(true), key = 'epg-'+ global.lang.locale
        if(info[data.url] && info[data.url].epg && this.parseEPGURL(info[data.url].epg) == global.config.get(key)) {
            global.config.set(key, '')
        }
        global.explorer.suspendRendering()
        try { // Ensure that we'll resume rendering
            this.remove(data.url)   
        } catch(e) { }
        global.osd.show(global.lang.LIST_REMOVED, 'fas fa-info-circle', 'list-open', 'normal')
        global.explorer.resumeRendering()
        global.explorer.back(1, true)
    }
    async directListRenderer(data, opts={}){
        let v = Object.assign({}, data), isMine = global.lists.activeLists.my.includes(v.url), isCommunity = global.lists.activeLists.community.includes(v.url)
        global.osd.show(global.lang.OPENING_LIST, 'fa-mega spin-x-alt', 'list-open', 'persistent')
        let list = await this.master.directListRenderer(v, {
            fetch: opts.fetch,
            progress: p => {
                global.osd.show(global.lang.OPENING_LIST +' '+ parseInt(p) +'%', 'fa-mega spin-x-alt', 'list-open', 'persistent')
            }
        }).catch(global.displayErr)
        if(!Array.isArray(list)){
            list = []
        }
        if(!list.length){
            list.push({name: global.lang.EMPTY, fa: 'fas fa-info-circle', type: 'action', class: 'entry-empty'})
        }
        if(!opts.raw){
            const actionIcons = ['fas fa-minus-square', 'fas fa-plus-square']
            if(!list.some(e => actionIcons.includes(e.fa))){
                if(this.has(v.url)){
                    list.unshift({
                        type: 'action',
                        name: global.lang.LIST_ALREADY_ADDED,
                        details: global.lang.REMOVE_LIST, 
                        fa: 'fas fa-minus-square',
                        action: () => {             
                            this.remove(v.url)
                            global.osd.show(global.lang.LIST_REMOVED, 'fas fa-info-circle', 'list-open', 'normal')
                            global.explorer.softRefresh(global.explorer.path, true) // epg options path
                        }
                    })
                } else {
                    list.unshift({
                        type: 'action',
                        fa: 'fas fa-plus-square',
                        name: global.lang.ADD_TO.format(global.lang.MY_LISTS),
                        action: () => {
                            this.addList(v.url, '', true).catch(console.error).finally(() => {
                                setTimeout(() => global.explorer.softRefresh(global.explorer.path, true), 100)
                            })
                        }
                    })
                }
            }
        }
        this.openingList = false
        global.osd.hide('list-open')
        return list
    }
    async hook(entries, path){
        if(path == '' && !entries.some(e => e.name == global.lang.IPTV_LISTS)){
            entries.push({name: global.lang.IPTV_LISTS, details: global.lang.CONFIGURE, fa: 'fas fa-list', type: 'group', renderer: this.listsEntries.bind(this)})
        }
        return entries
    }
}

module.exports = Manager
